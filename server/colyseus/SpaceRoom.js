// ============================================================================
// SpaceRoom.js — Серверная комната Космоса на едином ядре SpaceWorldCore (50 Hz)
// setPatchRate(50) (20 Hz) + setSimulationInterval(20) (50 Hz физика SpaceWorldCore)
// ============================================================================

import { Room } from '@colyseus/core';
import { SpaceState, PlayerState, ProjectileState, CheeseState } from './SpaceState.js';
import { upsertPlayerFromPacket, getAllSavedPlayers } from '../pushService.js';
import { FIXED_DT, ROCKET_PHYS, createWorldCore, createPhysicsBody, stepWorld } from '../../www/src/shared/SpaceWorldCore.js';

export let activeSpaceRoom = null;

export class SpaceRoom extends Room {
    onCreate() {
        activeSpaceRoom = this;
        this.autoDispose = false;
        this.maxClients = 64;
        this.setState(new SpaceState());
        this.setPatchRate(50);
        this.world = createWorldCore();
        Object.assign(this, { externalSeen: new Map(), recentFx: [], fxSeq: 1, pendingImpulses: new Map(), processedActs: new Set(), nextProjId: 1 });
        this._syncCheeseToSchema();
        this._registerMessages();
        this.setSimulationInterval(() => this.update(FIXED_DT), 20);
    }

    _syncCheeseToSchema() {
        for (const [cid, cb] of this.world.cheese.entries()) {
            const id = String(cid);
            if (cb.respawn <= 0) {
                let ch = this.state.spaceCheese.get(id);
                if (!ch) { ch = new CheeseState(); ch.id = id; this.state.spaceCheese.set(id, ch); }
                ch.x = Math.round(cb.x); ch.y = Math.round(cb.y);
            } else if (this.state.spaceCheese.has(id)) {
                this.state.spaceCheese.delete(id);
            }
        }
    }

    _ensureRocketBody(sid, p) {
        let rb = this.world.rockets.get(sid);
        if (!rb) {
            rb = createPhysicsBody({
                id: sid, sessionId: sid, playerId: p.id, type: 'rocket',
                x: p.x, y: p.y, vx: p.vx, vy: p.vy, angle: p.angle,
                radius: ROCKET_PHYS.radius, invMass: 1.0, restitution: 0.82, drag: ROCKET_PHYS.friction,
                activityStatus: p.activityStatus || 'space'
            });
            this.world.rockets.set(sid, rb);
        }
        rb.playerId = p.id;
        rb.activityStatus = p.activityStatus || 'space';
        return rb;
    }

    _registerMessages() {
        this.onMessage('move', (client, m) => {
            const p = this.state.players.get(client.sessionId);
            if (!p || !m) return;
            this.externalSeen.set(client.sessionId, Date.now());
            const rb = this._ensureRocketBody(client.sessionId, p);
            for (const k of ['x', 'y', 'vx', 'vy']) if (typeof m[k] === 'number') { p[k] = Math.round(m[k]); rb[k] = m[k]; }
            if (typeof m.angle === 'number') { p.angle = Number(m.angle.toFixed(3)); rb.angle = p.angle; }
            if (typeof m.isThrusting === 'boolean') { p.isThrusting = m.isThrusting; rb.isThrusting = m.isThrusting; }
            if (typeof m.isTurbo === 'boolean') { p.isTurbo = m.isTurbo; rb.isTurbo = m.isTurbo; }
            if (typeof m.paintTimer === 'number' && m.paintTimer > 0 && m.paintColor) { p.paintColor = String(m.paintColor); p.paintTimer = Number(m.paintTimer); }
            if (typeof m.homeAngle === 'number') p.homeAngle = Number(m.homeAngle.toFixed(3));
            if (typeof m.facing === 'number') p.facing = m.facing;
            if (typeof m.moving === 'boolean') p.moving = m.moving;
        });

        this.onMessage('status', (client, s) => {
            const p = this.state.players.get(client.sessionId);
            if (!p || !s) return;
            this.externalSeen.set(client.sessionId, Date.now());
            if (s.tabSid && this.state.players.has(s.tabSid)) this.removePlayer(s.tabSid);
            if (s.playerId && p.id === client.sessionId) {
                let pid = String(s.playerId);
                for (const [esid, ep] of this.state.players.entries()) {
                    if (ep !== p && ep.id === pid) {
                        if (Date.now() - (this.externalSeen.get(esid) || 0) > 2500) this.removePlayer(esid);
                        else { pid = `${pid}_${client.sessionId.slice(0, 4)}`; break; }
                    }
                }
                p.id = pid;
            }
            if (s.nickname) p.nickname = String(s.nickname).slice(0, 18);
            for (const k of ['skinId', 'activityStatus', 'planetBiome', 'planetRing']) if (s[k]) p[k] = String(s[k]);
            if (typeof s.storedCheese === 'number') p.storedCheese = s.storedCheese;
            this._ensureRocketBody(client.sessionId, p);
            upsertPlayerFromPacket({
                playerId: p.id, nickname: p.nickname, skinId: p.skinId, equippedSkinId: p.skinId,
                homeSnapshot: s.homeSnapshot || { storedCheese: p.storedCheese, planetAppearance: { biome: p.planetBiome, ringType: p.planetRing } },
                pushSubscription: s.pushSubscription || null
            });
        });

        this.onMessage('peer_bridge', () => {});
        for (const t of ['shoot_paint', 'hit_asteroid', 'hit_player', 'bumper_hit', 'ball_kick']) {
            this.onMessage(t, (client, d) => this.handleAction(client.sessionId, t, d));
        }
    }

    _emitFx(ev) {
        const fullEv = { ...ev, seq: ++this.fxSeq, ts: Date.now() };
        this.broadcast('fx_event', fullEv);
        this.recentFx.push(fullEv);
        if (this.recentFx.length > 30) this.recentFx.shift();
    }

    handleAction(sessionId, type, d) {
        if (!d || !type) return;
        if (d.actId) {
            if (this.processedActs.has(d.actId)) return;
            this.processedActs.add(d.actId);
            if (this.processedActs.size > 80) this.processedActs.delete(this.processedActs.values().next().value);
        }
        if (type === 'shoot_paint') {
            const p = this.state.players.get(sessionId) || Array.from(this.state.players.values()).find(ep => ep.id === d.ownerId);
            const id = String(this.nextProjId++), ownerSid = sessionId || d.ownerSid || d.ownerId || '';
            const pb = createPhysicsBody({
                id, ownerSid, ownerId: p?.id || d.ownerId || ownerSid, type: 'projectile',
                x: Math.round(Number(d.x) || p?.x || 0), y: Math.round(Number(d.y) || p?.y || 0),
                vx: Math.round(Number(d.vx) || 0), vy: Math.round(Number(d.vy) || 0),
                radius: 10, invMass: 2.2, restitution: 0.6, color: d.color || '#f472b6', ttl: 1.35
            });
            this.world.projectiles.set(id, pb);
            const pr = new ProjectileState();
            Object.assign(pr, { id, ownerId: pb.ownerSid, x: pb.x, y: pb.y, vx: pb.vx, vy: pb.vy, color: pb.color });
            this.state.projectiles.set(id, pr);
            this._emitFx({ type: 'horn', playerId: pb.ownerId, sessionId: pb.ownerSid, emoji: d.emoji || '😜', x: pb.x, y: pb.y, vx: pb.vx, vy: pb.vy, color: pb.color, projId: id });
        } else if (type === 'ball_kick') {
            const b = this.world.ball;
            if (b && typeof d.vx === 'number' && typeof d.vy === 'number') {
                b.vx = d.vx; b.vy = d.vy;
                if (typeof d.x === 'number' && Math.hypot(d.x - b.x, d.y - b.y) < 120) { b.x = d.x; b.y = d.y; }
                this._emitFx({ type: 'bumper_hit', x: Math.round(b.x), y: Math.round(b.y) });
            }
        } else if (type === 'hit_asteroid') {
            const id = String(d.id || '');
            this.world.projectiles.delete(id); this.state.projectiles.delete(id);
            this._emitFx({ type: 'paint_splat', x: Math.round(Number(d.x) || 0), y: Math.round(Number(d.y) || 0), color: d.color || '#f472b6' });
        } else if (type === 'hit_player') {
            const id = String(d.id || '');
            const pb = this.world.projectiles.get(id);
            this.world.projectiles.delete(id); this.state.projectiles.delete(id);
            const target = (d.targetSid && this.state.players.get(d.targetSid)) || Array.from(this.state.players.values()).find(p => (p.id === d.targetId || p.id.startsWith(d.targetId + '_')) && p.sessionId !== sessionId);
            const color = d.color || pb?.color || '#f472b6';
            if (target) { target.paintColor = color; target.paintTimer = 6.0; }
            this._emitFx({ type: 'paint_splat', x: Math.round(Number(d.x) || target?.x || 0), y: Math.round(Number(d.y) || target?.y || 0), color, targetId: d.targetId || target?.id || '', targetSid: target?.sessionId || d.targetSid || '' });
        } else if (type === 'bumper_hit') {
            const target = (d.targetSid && this.state.players.get(d.targetSid)) || Array.from(this.state.players.values()).find(p => (p.id === d.targetId || p.id.startsWith(d.targetId + '_')) && p.sessionId !== sessionId);
            const tSid = target?.sessionId || d.targetSid || d.targetId || '';
            const nx = Number(d.nx) || 0, ny = Number(d.ny) || 0;
            if (target) this._sendImpulse(target, target.vx * 0.4 + nx * 310, target.vy * 0.4 + ny * 310, target.x + nx * 18, target.y + ny * 18, nx, ny);
            this._emitFx({ type: 'bumper_hit', x: Math.round(Number(d.x) || target?.x || 0), y: Math.round(Number(d.y) || target?.y || 0), targetId: d.targetId || target?.id || '', targetSid: tSid, nx, ny });
        }
    }

    onJoin(client, opts = {}) {
        if (opts.tabSid && this.state.players.has(opts.tabSid)) this.removePlayer(opts.tabSid);
        let pid = String(opts.playerId || client.sessionId);
        for (const [esid, ep] of this.state.players.entries()) {
            if (ep.id === pid) {
                if (Date.now() - (this.externalSeen.get(esid) || 0) > 2500) this.removePlayer(esid);
                else { pid = `${pid}_${client.sessionId.slice(0, 4)}`; break; }
            }
        }
        const p = new PlayerState();
        Object.assign(p, {
            sessionId: client.sessionId, id: pid,
            nickname: String(opts.nickname || 'Мышонок Пи').slice(0, 18), skinId: String(opts.skinId || 'blue'),
            activityStatus: String(opts.activityStatus || 'space'), storedCheese: Number(opts.storedCheese) || 50,
            planetBiome: String(opts.planetBiome || 'cheese'), planetRing: String(opts.planetRing || 'none'),
            x: Number(opts.x) || 0, y: Number(opts.y) || 165
        });
        this.state.players.set(client.sessionId, p);
        this.externalSeen.set(client.sessionId, Date.now());
        this._ensureRocketBody(client.sessionId, p);
        upsertPlayerFromPacket({
            playerId: p.id, nickname: p.nickname, skinId: p.skinId, equippedSkinId: p.skinId,
            homeSnapshot: opts.homeSnapshot || { storedCheese: p.storedCheese, planetAppearance: { biome: p.planetBiome, ringType: p.planetRing } }
        });
        this.clock.setTimeout(() => client.send('saved_homes', getAllSavedPlayers()), 120);
    }

    onLeave(client) { this.removePlayer(client.sessionId); }

    removePlayer(sid = '', pid = '', tabSid = '') {
        for (const k of [sid, tabSid]) if (k) { this.state.players.delete(k); this.externalSeen.delete(k); this.world.rockets.delete(k); }
        if (pid) {
            for (const [esid, ep] of this.state.players.entries()) {
                if (ep.id === pid || ep.id.startsWith(pid + '_')) {
                    this.state.players.delete(esid); this.externalSeen.delete(esid); this.world.rockets.delete(esid);
                }
            }
        }
    }

    syncExternalPlayer(pkt) {
        if (!pkt?.sessionId) return;
        this.externalSeen.set(pkt.sessionId, Date.now());
        if (pkt.tabSid && pkt.tabSid !== pkt.sessionId && this.state.players.has(pkt.tabSid)) this.removePlayer(pkt.tabSid);
        if (this.clients.some(c => c.sessionId === pkt.sessionId)) {
            const wp = this.state.players.get(pkt.sessionId);
            if (wp && typeof pkt.paintTimer === 'number' && pkt.paintTimer > 0 && pkt.paintColor) { wp.paintColor = String(pkt.paintColor); wp.paintTimer = Number(pkt.paintTimer); }
            return;
        }
        let p = this.state.players.get(pkt.sessionId);
        if (!p) {
            let pid = String(pkt.playerId || pkt.sessionId);
            for (const [esid, ep] of this.state.players.entries()) {
                if (ep.id === pid) {
                    if (Date.now() - (this.externalSeen.get(esid) || 0) > 2500) this.removePlayer(esid);
                    else { pid = `${pid}_${pkt.sessionId.slice(0, 4)}`; break; }
                }
            }
            p = new PlayerState(); p.sessionId = pkt.sessionId; p.id = pid;
            this.state.players.set(pkt.sessionId, p);
        }
        if (pkt.nickname) p.nickname = String(pkt.nickname).slice(0, 18);
        for (const k of ['skinId', 'activityStatus', 'planetBiome', 'planetRing']) if (pkt[k]) p[k] = String(pkt[k]);
        const rb = this._ensureRocketBody(pkt.sessionId, p);
        for (const k of ['x', 'y', 'vx', 'vy']) if (typeof pkt[k] === 'number') { p[k] = Math.round(pkt[k]); rb[k] = pkt[k]; }
        if (typeof pkt.angle === 'number') { p.angle = Number(pkt.angle.toFixed(3)); rb.angle = p.angle; }
        if (typeof pkt.isThrusting === 'boolean') { p.isThrusting = pkt.isThrusting; rb.isThrusting = pkt.isThrusting; }
        if (typeof pkt.isTurbo === 'boolean') { p.isTurbo = pkt.isTurbo; rb.isTurbo = pkt.isTurbo; }
        if (typeof pkt.paintTimer === 'number' && pkt.paintTimer > 0 && pkt.paintColor) { p.paintColor = String(pkt.paintColor); p.paintTimer = Number(pkt.paintTimer); }
        if (typeof pkt.storedCheese === 'number') p.storedCheese = pkt.storedCheese;
    }

    getSyncSnapshot() {
        const out = [];
        this.state.players.forEach((p, sid) => out.push({
            sessionId: sid, playerId: p.id, nickname: p.nickname, skinId: p.skinId, activityStatus: p.activityStatus,
            x: p.x, y: p.y, vx: p.vx, vy: p.vy, angle: p.angle, isThrusting: p.isThrusting, isTurbo: p.isTurbo,
            paintColor: p.paintColor, paintTimer: p.paintTimer, storedCheese: p.storedCheese, planetBiome: p.planetBiome, planetRing: p.planetRing
        }));
        return out;
    }

    getFullSyncState(mySid = '', sinceFxSeq = 0, myPid = '') {
        const b = this.state.ball, projs = [], cheese = [], now = Date.now();
        this.state.projectiles.forEach((pr, id) => projs.push({ id, ownerId: pr.ownerId, x: pr.x, y: pr.y, vx: pr.vx, vy: pr.vy, color: pr.color }));
        this.state.spaceCheese.forEach((ch, id) => cheese.push({ id: Number(id), x: ch.x, y: ch.y }));
        const imp = (mySid && this.pendingImpulses.get(mySid)) || (myPid && this.pendingImpulses.get(myPid)) || null;
        if (imp) {
            if (mySid) this.pendingImpulses.delete(mySid);
            if (myPid) this.pendingImpulses.delete(myPid);
        }
        return {
            players: this.getSyncSnapshot(),
            ball: b ? { x: b.x, y: b.y, vx: b.vx, vy: b.vy, angle: b.angle, scoreBlue: b.scoreBlue, scorePink: b.scorePink } : null,
            projectiles: projs,
            spaceCheese: cheese,
            fxEvents: this.recentFx.filter(e => now - e.ts < 2500 && e.seq > sinceFxSeq),
            fxSeq: this.fxSeq,
            impulse: imp
        };
    }

    update(dt = FIXED_DT) {
        this.state.serverTick = (this.state.serverTick + 1) % 1000000;
        const now = Date.now();
        for (const sid of Array.from(this.state.players.keys())) {
            if (now - (this.externalSeen.get(sid) || 0) > 4500) {
                this.removePlayer(sid);
                const deadClient = this.clients.find(c => c.sessionId === sid);
                if (deadClient) { try { deadClient.leave(); } catch (_) {} }
            }
        }
        for (const [sid, p] of this.state.players.entries()) {
            if (p.paintTimer > 0 && (p.paintTimer = Math.max(0, Number((p.paintTimer - dt).toFixed(2)))) === 0) p.paintColor = '';
            this._ensureRocketBody(sid, p);
        }

        const events = stepWorld(this.world, dt, { authoritativeGoals: true });

        for (const [sid, rb] of this.world.rockets.entries()) {
            const p = this.state.players.get(sid);
            if (!p) { this.world.rockets.delete(sid); continue; }
            p.x = Math.round(rb.x); p.y = Math.round(rb.y);
            p.vx = Math.round(rb.vx); p.vy = Math.round(rb.vy);
        }

        const wb = this.world.ball, sb = this.state.ball;
        if (wb && sb) {
            sb.x = Math.round(wb.x); sb.y = Math.round(wb.y);
            sb.vx = Math.round(wb.vx); sb.vy = Math.round(wb.vy);
            sb.angle = Number(wb.angle.toFixed(2));
            sb.scoreBlue = this.world.score.blue; sb.scorePink = this.world.score.pink;
        }

        for (const id of Array.from(this.state.projectiles.keys())) {
            const pb = this.world.projectiles.get(id);
            if (!pb) this.state.projectiles.delete(id);
            else { const sp = this.state.projectiles.get(id); sp.x = Math.round(pb.x); sp.y = Math.round(pb.y); }
        }
        this._syncCheeseToSchema();

        for (const ev of events) {
            if (ev.type === 'bumper_hit') {
                const pA = this.state.players.get(ev.bodyA.id), pB = this.state.players.get(ev.bodyB.id);
                if (pA) this._sendImpulse(pA, ev.bodyA.vx, ev.bodyA.vy, ev.bodyA.x, ev.bodyA.y, -ev.nx, -ev.ny);
                if (pB) this._sendImpulse(pB, ev.bodyB.vx, ev.bodyB.vy, ev.bodyB.x, ev.bodyB.y, ev.nx, ev.ny);
                this._emitFx({ type: 'bumper_hit', x: Math.round(ev.hitX), y: Math.round(ev.hitY) });
            } else if (ev.type === 'ball_kick') {
                this._emitFx({ type: 'bumper_hit', x: Math.round(ev.hitX), y: Math.round(ev.hitY) });
            } else if (ev.type === 'goal') {
                this._emitFx({ type: 'goal', team: ev.team, score: ev.score, x: Math.round(ev.hitX), y: Math.round(ev.hitY) });
            } else if (ev.type === 'paint_splat') {
                if (ev.targetSid) {
                    const tp = this.state.players.get(ev.targetSid);
                    if (tp) { tp.paintColor = ev.color; tp.paintTimer = 6.0; }
                }
                this._emitFx({ type: 'paint_splat', x: Math.round(ev.hitX), y: Math.round(ev.hitY), color: ev.color, targetId: ev.targetId || '', targetSid: ev.targetSid || '' });
            } else if (ev.type === 'cheese_picked') {
                this._emitFx({ type: 'cheese_picked', id: ev.id, byPlayerId: ev.byPlayerId, x: Math.round(ev.hitX), y: Math.round(ev.hitY) });
            }
        }
    }

    _sendImpulse(p, vx, vy, x, y, nx = 0, ny = 0) {
        p.vx = Math.round(vx); p.vy = Math.round(vy); p.x = Math.round(x); p.y = Math.round(y);
        const imp = { vx: p.vx, vy: p.vy, x: p.x, y: p.y, nx, ny };
        this.pendingImpulses.set(p.sessionId, imp);
        if (p.id) this.pendingImpulses.set(p.id, imp);
        const client = this.clients.find(c => c.sessionId === p.sessionId);
        if (client) client.send('bumper_impulse', imp);
    }
}
