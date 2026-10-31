// ============================================================================
// SpaceRoom.js — Серверная комната Космоса и Глобальных Статусов (Colyseus)
// setPatchRate(50) (20 Hz) + setSimulationInterval(33.3) (30 Hz физика)
// ============================================================================

import { Room } from '@colyseus/core';
import { SpaceState, PlayerState, ProjectileState, CheeseState } from './SpaceState.js';
import { upsertPlayerFromPacket, getAllSavedPlayers } from '../pushService.js';

const FIELD = { cx: 0, cy: 110, hw: 295, hh: 175, goalH: 72, ballR: 32 };
const CLUSTERS = [
    { x: 0, y: 0, c: 6, s: 80 }, { x: -340, y: -170, c: 5, s: 75 }, { x: 370, y: -210, c: 5, s: 75 },
    { x: -520, y: 260, c: 6, s: 85 }, { x: 510, y: 310, c: 6, s: 85 }, { x: -860, y: -40, c: 5, s: 80 },
    { x: 880, y: 110, c: 5, s: 80 }, { x: 40, y: 540, c: 5, s: 75 }
];

export let activeSpaceRoom = null;

export class SpaceRoom extends Room {
    onCreate() {
        activeSpaceRoom = this;
        this.autoDispose = false;
        this.maxClients = 64;
        this.setState(new SpaceState());
        this.setPatchRate(50);
        Object.assign(this, { projMeta: new Map(), cheeseMeta: new Map(), bumpCooldowns: new Map(), kickCooldowns: new Map(), externalSeen: new Map(), recentFx: [], fxSeq: 1, pendingImpulses: new Map(), processedActs: new Set(), nextProjId: 1 });
        this._initCheese();
        this._registerMessages();
        this.setSimulationInterval((dtMs) => this.update(dtMs / 1000), 33.3);
    }

    _initCheese() {
        let cid = 1;
        CLUSTERS.forEach((cl, ci) => {
            for (let i = 0; i < cl.c; i++) {
                const a = (i / cl.c) * Math.PI * 2 + ci, d = 18 + (i % 3) * (cl.s * 0.38);
                const id = String(cid++), x = Math.round(cl.x + Math.cos(a) * d), y = Math.round(cl.y + Math.sin(a) * d);
                const ch = new CheeseState(); ch.id = id; ch.x = x; ch.y = y;
                this.state.spaceCheese.set(id, ch);
                this.cheeseMeta.set(id, { id, homeX: x, homeY: y, respawn: 0 });
            }
        });
    }

    _registerMessages() {
        this.onMessage('move', (client, m) => {
            const p = this.state.players.get(client.sessionId);
            if (!p || !m) return;
            this.externalSeen.set(client.sessionId, Date.now());
            for (const k of ['x', 'y', 'vx', 'vy']) if (typeof m[k] === 'number') p[k] = Math.round(m[k]);
            if (typeof m.angle === 'number') p.angle = Number(m.angle.toFixed(3));
            if (typeof m.isThrusting === 'boolean') p.isThrusting = m.isThrusting;
            if (typeof m.isTurbo === 'boolean') p.isTurbo = m.isTurbo;
            if (typeof m.paintTimer === 'number' && m.paintTimer > 0 && m.paintColor) { p.paintColor = String(m.paintColor); p.paintTimer = Number(m.paintTimer); }
            if (typeof m.homeAngle === 'number') p.homeAngle = Number(m.homeAngle.toFixed(3));
            if (typeof m.facing === 'number') p.facing = m.facing;
            if (typeof m.moving === 'boolean') p.moving = m.moving;
        });

        this.onMessage('status', (client, s) => {
            const p = this.state.players.get(client.sessionId);
            if (!p || !s) return;
            this.externalSeen.set(client.sessionId, Date.now());
            if (s.tabSid && this.state.players.has(s.tabSid)) { this.state.players.delete(s.tabSid); this.externalSeen.delete(s.tabSid); }
            if (s.playerId && p.id === client.sessionId) {
                let pid = String(s.playerId);
                for (const [esid, ep] of this.state.players.entries()) {
                    if (ep !== p && ep.id === pid) {
                        if (Date.now() - (this.externalSeen.get(esid) || 0) > 2500) { this.state.players.delete(esid); this.externalSeen.delete(esid); }
                        else { pid = `${pid}_${client.sessionId.slice(0, 4)}`; break; }
                    }
                }
                p.id = pid;
            }
            if (s.nickname) p.nickname = String(s.nickname).slice(0, 18);
            for (const k of ['skinId', 'activityStatus', 'planetBiome', 'planetRing']) if (s[k]) p[k] = String(s[k]);
            if (typeof s.storedCheese === 'number') p.storedCheese = s.storedCheese;
            upsertPlayerFromPacket({
                playerId: p.id, nickname: p.nickname, skinId: p.skinId, equippedSkinId: p.skinId,
                homeSnapshot: s.homeSnapshot || { storedCheese: p.storedCheese, planetAppearance: { biome: p.planetBiome, ringType: p.planetRing } },
                pushSubscription: s.pushSubscription || null
            });
        });

        this.onMessage('peer_bridge', () => {});

        this.onMessage('shoot_paint', (client, d) => this.handleAction(client.sessionId, 'shoot_paint', d));
        this.onMessage('hit_asteroid', (client, d) => this.handleAction(client.sessionId, 'hit_asteroid', d));
        this.onMessage('hit_player', (client, d) => this.handleAction(client.sessionId, 'hit_player', d));
        this.onMessage('bumper_hit', (client, d) => this.handleAction(client.sessionId, 'bumper_hit', d));
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
            const id = String(this.nextProjId++), pr = new ProjectileState();
            pr.id = id; pr.ownerId = sessionId || d.ownerId || '';
            pr.x = Math.round(Number(d.x) || p?.x || 0); pr.y = Math.round(Number(d.y) || p?.y || 0);
            pr.vx = Math.round(Number(d.vx) || 0); pr.vy = Math.round(Number(d.vy) || 0);
            pr.color = d.color || '#f472b6';
            this.state.projectiles.set(id, pr);
            this.projMeta.set(id, { ttl: 1.35, sessionId: pr.ownerId });
            this._emitFx({ type: 'horn', playerId: p?.id || d.ownerId || '', sessionId: pr.ownerId, emoji: d.emoji || '😜', x: pr.x, y: pr.y, vx: pr.vx, vy: pr.vy, color: pr.color, projId: id });
        } else if (type === 'hit_asteroid') {
            const id = String(d.id || ''), pr = this.state.projectiles.get(id);
            if (pr) { this.state.projectiles.delete(id); this.projMeta.delete(id); }
            this._emitFx({ type: 'paint_splat', x: Math.round(Number(d.x) || pr?.x || 0), y: Math.round(Number(d.y) || pr?.y || 0), color: d.color || pr?.color || '#f472b6' });
        } else if (type === 'hit_player') {
            const id = String(d.id || ''), pr = this.state.projectiles.get(id);
            if (pr) { this.state.projectiles.delete(id); this.projMeta.delete(id); }
            const target = (d.targetSid && this.state.players.get(d.targetSid)) || Array.from(this.state.players.values()).find(p => (p.id === d.targetId || p.id.startsWith(d.targetId + '_')) && p.sessionId !== sessionId);
            const color = d.color || pr?.color || '#f472b6';
            if (target) { target.paintColor = color; target.paintTimer = 6.0; }
            this._emitFx({
                type: 'paint_splat',
                x: Math.round(Number(d.x) || target?.x || pr?.x || 0),
                y: Math.round(Number(d.y) || target?.y || pr?.y || 0),
                color,
                targetId: d.targetId || target?.id || '',
                targetSid: target?.sessionId || d.targetSid || ''
            });
        } else if (type === 'bumper_hit') {
            const now = Date.now();
            const target = (d.targetSid && this.state.players.get(d.targetSid)) || Array.from(this.state.players.values()).find(p => (p.id === d.targetId || p.id.startsWith(d.targetId + '_')) && p.sessionId !== sessionId);
            const tSid = target?.sessionId || d.targetSid || d.targetId || '';
            if (now - (this.bumpCooldowns.get(tSid) || 0) > 200) {
                this.bumpCooldowns.set(tSid, now);
                if (sessionId) this.bumpCooldowns.set(sessionId, now);
                const nx = Number(d.nx) || 0, ny = Number(d.ny) || 0;
                if (target) this._sendImpulse(target, target.vx * 0.4 + nx * 320, target.vy * 0.4 + ny * 320, target.x + nx * 24, target.y + ny * 24, nx, ny);
                this._emitFx({ type: 'bumper_hit', x: Math.round(Number(d.x) || target?.x || 0), y: Math.round(Number(d.y) || target?.y || 0), targetId: d.targetId || target?.id || '', targetSid: tSid, nx, ny });
            }
        }
    }

    onJoin(client, opts = {}) {
        if (opts.tabSid && this.state.players.has(opts.tabSid)) { this.state.players.delete(opts.tabSid); this.externalSeen.delete(opts.tabSid); }
        let pid = String(opts.playerId || client.sessionId);
        for (const [esid, ep] of this.state.players.entries()) {
            if (ep.id === pid) {
                if (Date.now() - (this.externalSeen.get(esid) || 0) > 2500) { this.state.players.delete(esid); this.externalSeen.delete(esid); }
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
        upsertPlayerFromPacket({
            playerId: p.id, nickname: p.nickname, skinId: p.skinId, equippedSkinId: p.skinId,
            homeSnapshot: opts.homeSnapshot || { storedCheese: p.storedCheese, planetAppearance: { biome: p.planetBiome, ringType: p.planetRing } }
        });
        this.clock.setTimeout(() => client.send('saved_homes', getAllSavedPlayers()), 120);
    }

    onLeave(client) { this.state.players.delete(client.sessionId); this.externalSeen.delete(client.sessionId); }

    removePlayer(sid = '', pid = '', tabSid = '') {
        if (sid) { this.state.players.delete(sid); this.externalSeen.delete(sid); }
        if (tabSid) { this.state.players.delete(tabSid); this.externalSeen.delete(tabSid); }
        if (pid) {
            for (const [esid, ep] of this.state.players.entries()) {
                if (ep.id === pid || ep.id.startsWith(pid + '_')) { this.state.players.delete(esid); this.externalSeen.delete(esid); }
            }
        }
    }

    syncExternalPlayer(pkt) {
        if (!pkt?.sessionId) return;
        this.externalSeen.set(pkt.sessionId, Date.now());
        if (pkt.tabSid && pkt.tabSid !== pkt.sessionId && this.state.players.has(pkt.tabSid)) {
            this.state.players.delete(pkt.tabSid); this.externalSeen.delete(pkt.tabSid);
        }
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
                    if (Date.now() - (this.externalSeen.get(esid) || 0) > 2500) { this.state.players.delete(esid); this.externalSeen.delete(esid); }
                    else { pid = `${pid}_${pkt.sessionId.slice(0, 4)}`; break; }
                }
            }
            p = new PlayerState(); p.sessionId = pkt.sessionId; p.id = pid;
            this.state.players.set(pkt.sessionId, p);
        }
        if (pkt.nickname) p.nickname = String(pkt.nickname).slice(0, 18);
        for (const k of ['skinId', 'activityStatus', 'planetBiome', 'planetRing']) if (pkt[k]) p[k] = String(pkt[k]);
        for (const k of ['x', 'y', 'vx', 'vy']) if (typeof pkt[k] === 'number') p[k] = Math.round(pkt[k]);
        if (typeof pkt.angle === 'number') p.angle = Number(pkt.angle.toFixed(3));
        if (typeof pkt.isThrusting === 'boolean') p.isThrusting = pkt.isThrusting;
        if (typeof pkt.isTurbo === 'boolean') p.isTurbo = pkt.isTurbo;
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

    update(dt) {
        this.state.serverTick = (this.state.serverTick + 1) % 1000000;
        const now = Date.now(), spacePlayers = [];
        for (const sid of Array.from(this.state.players.keys())) {
            const seenAt = this.externalSeen.get(sid) || 0;
            if (now - seenAt > 4500) {
                this.state.players.delete(sid);
                this.externalSeen.delete(sid);
                const deadClient = this.clients.find(c => c.sessionId === sid);
                if (deadClient) { try { deadClient.leave(); } catch (_) {} }
            }
        }
        for (const p of this.state.players.values()) {
            if (p.paintTimer > 0 && (p.paintTimer = Math.max(0, Number((p.paintTimer - dt).toFixed(2)))) === 0) p.paintColor = '';
            if (p.activityStatus === 'space') spacePlayers.push(p);
        }

        for (let i = 0; i < spacePlayers.length; i++) {
            for (let j = i + 1; j < spacePlayers.length; j++) {
                const a = spacePlayers[i], b = spacePlayers[j], dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy);
                const lastB = Math.max(this.bumpCooldowns.get(a.sessionId) || 0, this.bumpCooldowns.get(b.sessionId) || 0);
                if (d < 52 && d > 0.01 && now - lastB > 250) {
                    this.bumpCooldowns.set(a.sessionId, now); this.bumpCooldowns.set(b.sessionId, now);
                    const nx = dx / d, ny = dy / d, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
                    this._sendImpulse(a, a.vx * 0.4 + nx * 320, a.vy * 0.4 + ny * 320, mx + nx * 28, my + ny * 28, nx, ny);
                    this._sendImpulse(b, b.vx * 0.4 - nx * 320, b.vy * 0.4 - ny * 320, mx - nx * 28, my - ny * 28, -nx, -ny);
                    this._emitFx({ type: 'bumper_hit', x: Math.round(mx), y: Math.round(my) });
                }
            }
        }

        const b = this.state.ball, minX = FIELD.cx - FIELD.hw, maxX = FIELD.cx + FIELD.hw, minY = FIELD.cy - FIELD.hh, maxY = FIELD.cy + FIELD.hh;
        b.x += b.vx * dt; b.y += b.vy * dt; b.angle = Number((b.angle + Math.hypot(b.vx, b.vy) * 0.012 * dt).toFixed(2));
        b.vx *= 0.985; b.vy *= 0.985;

        for (const p of spacePlayers) {
            const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy);
            if (d < FIELD.ballR + 26 && d > 0.01 && now - (this.kickCooldowns.get(p.sessionId) || 0) > 110) {
                this.kickCooldowns.set(p.sessionId, now);
                const nx = dx / d, ny = dy / d, boost = p.isTurbo ? 1.55 : 1.25, kick = p.isTurbo ? 360 : 230;
                b.vx = Math.round(p.vx * boost + nx * kick); b.vy = Math.round(p.vy * boost + ny * kick);
                b.x = Math.round(p.x + nx * (FIELD.ballR + 28)); b.y = Math.round(p.y + ny * (FIELD.ballR + 28));
                this._emitFx({ type: 'bumper_hit', x: Math.round(b.x - nx * FIELD.ballR), y: Math.round(b.y - ny * FIELD.ballR) });
            }
        }

        if (b.y - FIELD.ballR < minY) { b.y = minY + FIELD.ballR; b.vy = Math.abs(b.vy) * 0.85; }
        if (b.y + FIELD.ballR > maxY) { b.y = maxY - FIELD.ballR; b.vy = -Math.abs(b.vy) * 0.85; }
        const inGoal = Math.abs(b.y - FIELD.cy) < FIELD.goalH;
        if (b.x - FIELD.ballR < minX) { if (inGoal) this._goal('pink'); else { b.x = minX + FIELD.ballR; b.vx = Math.abs(b.vx) * 0.85; } }
        else if (b.x + FIELD.ballR > maxX) { if (inGoal) this._goal('blue'); else { b.x = maxX - FIELD.ballR; b.vx = -Math.abs(b.vx) * 0.85; } }

        for (const [id, pr] of this.state.projectiles.entries()) {
            const meta = this.projMeta.get(id);
            if (!meta) { this.state.projectiles.delete(id); continue; }
            pr.x = Math.round(pr.x + pr.vx * dt); pr.y = Math.round(pr.y + pr.vy * dt); meta.ttl -= dt;
            let hit = false;
            if (Math.hypot(pr.x - b.x, pr.y - b.y) < FIELD.ballR + 10) {
                b.vx += pr.vx * 0.45; b.vy += pr.vy * 0.45; hit = true;
                this._emitFx({ type: 'paint_splat', x: pr.x, y: pr.y, color: pr.color });
            }
            for (const p of spacePlayers) if (!hit && p.sessionId !== meta.sessionId && p.id !== pr.ownerId && Math.hypot(pr.x - p.x, pr.y - p.y) < 36) {
                p.paintColor = pr.color; p.paintTimer = 6.0; hit = true;
                this._emitFx({ type: 'paint_splat', x: p.x, y: p.y, color: pr.color, targetId: p.id, targetSid: p.sessionId });
            }
            if (hit || meta.ttl <= 0) { this.state.projectiles.delete(id); this.projMeta.delete(id); }
        }

        for (const [id, meta] of this.cheeseMeta.entries()) {
            if (meta.respawn > 0) {
                if ((meta.respawn -= dt) <= 0) {
                    const ch = new CheeseState(); ch.id = id; ch.x = meta.homeX; ch.y = meta.homeY;
                    this.state.spaceCheese.set(id, ch);
                }
                continue;
            }
            const ch = this.state.spaceCheese.get(id);
            if (!ch) continue;
            for (const p of spacePlayers) if (Math.hypot(p.x - ch.x, p.y - ch.y) < 38) {
                meta.respawn = 14; this.state.spaceCheese.delete(id);
                this._emitFx({ type: 'cheese_picked', id: Number(id), byPlayerId: p.id, x: ch.x, y: ch.y });
                break;
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

    _goal(team) {
        const b = this.state.ball;
        if (team === 'blue') b.scoreBlue += 1; else b.scorePink += 1;
        b.x = FIELD.cx; b.y = FIELD.cy; b.vx = 0; b.vy = 0;
        this._emitFx({ type: 'goal', team, score: { blue: b.scoreBlue, pink: b.scorePink }, x: FIELD.cx, y: FIELD.cy });
    }
}
