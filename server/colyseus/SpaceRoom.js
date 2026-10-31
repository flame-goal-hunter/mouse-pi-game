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
        Object.assign(this, { projMeta: new Map(), cheeseMeta: new Map(), bumpCooldowns: new Map(), kickCooldowns: new Map(), externalSeen: new Map(), nextProjId: 1 });
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
            for (const k of ['x', 'y', 'vx', 'vy']) if (typeof m[k] === 'number') p[k] = Math.round(m[k]);
            if (typeof m.angle === 'number') p.angle = Number(m.angle.toFixed(3));
            if (typeof m.isThrusting === 'boolean') p.isThrusting = m.isThrusting;
            if (typeof m.isTurbo === 'boolean') p.isTurbo = m.isTurbo;
            if (typeof m.homeAngle === 'number') p.homeAngle = Number(m.homeAngle.toFixed(3));
            if (typeof m.facing === 'number') p.facing = m.facing;
            if (typeof m.moving === 'boolean') p.moving = m.moving;
        });

        this.onMessage('status', (client, s) => {
            const p = this.state.players.get(client.sessionId);
            if (!p || !s) return;
            if (s.tabSid && this.state.players.has(s.tabSid)) { this.state.players.delete(s.tabSid); this.externalSeen.delete(s.tabSid); }
            if (s.playerId && p.id === client.sessionId) {
                let pid = String(s.playerId);
                for (const ep of this.state.players.values()) if (ep !== p && ep.id === pid) { pid = `${pid}_${client.sessionId.slice(0, 4)}`; break; }
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

        this.onMessage('peer_bridge', (_client, list) => {
            if (Array.isArray(list)) list.forEach(pkt => this.syncExternalPlayer(pkt));
        });

        this.onMessage('shoot_paint', (client, d) => {
            const p = this.state.players.get(client.sessionId);
            if (!p || !d) return;
            const id = String(this.nextProjId++), pr = new ProjectileState();
            pr.id = id; pr.ownerId = client.sessionId;
            pr.x = Math.round(Number(d.x) || p.x); pr.y = Math.round(Number(d.y) || p.y);
            pr.vx = Math.round(Number(d.vx) || 0); pr.vy = Math.round(Number(d.vy) || 0);
            pr.color = d.color || '#f472b6';
            this.state.projectiles.set(id, pr);
            this.projMeta.set(id, { ttl: 1.35, sessionId: client.sessionId });
            this.broadcast('fx_event', { type: 'horn', playerId: p.id, sessionId: client.sessionId, emoji: d.emoji || '😜', x: pr.x, y: pr.y });
        });

        this.onMessage('hit_asteroid', (_client, d) => {
            const id = String(d?.id || '');
            const pr = this.state.projectiles.get(id);
            if (!pr) return;
            this.state.projectiles.delete(id);
            this.projMeta.delete(id);
            this.broadcast('fx_event', { type: 'paint_splat', x: Math.round(Number(d.x) || pr.x), y: Math.round(Number(d.y) || pr.y), color: pr.color });
        });

        this.onMessage('hit_player', (client, d) => {
            const id = String(d?.id || '');
            const pr = this.state.projectiles.get(id);
            if (pr) { this.state.projectiles.delete(id); this.projMeta.delete(id); }
            const target = (d?.targetSid && this.state.players.get(d.targetSid)) || Array.from(this.state.players.values()).find(p => p.id === d?.targetId && p.sessionId !== client.sessionId);
            const color = d?.color || pr?.color || '#f472b6';
            if (target) { target.paintColor = color; target.paintTimer = 6.0; }
            this.broadcast('fx_event', {
                type: 'paint_splat',
                x: Math.round(Number(d?.x) || target?.x || pr?.x || 0),
                y: Math.round(Number(d?.y) || target?.y || pr?.y || 0),
                color,
                targetId: target?.id || d?.targetId || '',
                targetSid: target?.sessionId || d?.targetSid || ''
            });
        });

        this.onMessage('bumper_hit', (client, d) => {
            if (!d) return;
            const now = Date.now();
            const target = (d.targetSid && this.state.players.get(d.targetSid)) || Array.from(this.state.players.values()).find(p => p.id === d.targetId && p.sessionId !== client.sessionId);
            if (target && now - (this.bumpCooldowns.get(target.sessionId) || 0) > 220) {
                this.bumpCooldowns.set(target.sessionId, now);
                this.bumpCooldowns.set(client.sessionId, now);
                const nx = Number(d.nx) || 0, ny = Number(d.ny) || 0;
                this._sendImpulse(target, target.vx * 0.4 + nx * 320, target.vy * 0.4 + ny * 320, target.x + nx * 24, target.y + ny * 24);
                this.broadcast('fx_event', { type: 'bumper_hit', x: Math.round(Number(d.x) || target.x), y: Math.round(Number(d.y) || target.y) });
            }
        });
    }

    onJoin(client, opts = {}) {
        if (opts.tabSid && this.state.players.has(opts.tabSid)) { this.state.players.delete(opts.tabSid); this.externalSeen.delete(opts.tabSid); }
        let pid = String(opts.playerId || client.sessionId);
        for (const ep of this.state.players.values()) if (ep.id === pid) { pid = `${pid}_${client.sessionId.slice(0, 4)}`; break; }
        const p = new PlayerState();
        Object.assign(p, {
            sessionId: client.sessionId, id: pid,
            nickname: String(opts.nickname || 'Мышонок Пи').slice(0, 18), skinId: String(opts.skinId || 'blue'),
            activityStatus: String(opts.activityStatus || 'space'), storedCheese: Number(opts.storedCheese) || 50,
            planetBiome: String(opts.planetBiome || 'cheese'), planetRing: String(opts.planetRing || 'none'),
            x: Number(opts.x) || 0, y: Number(opts.y) || 165
        });
        this.state.players.set(client.sessionId, p);
        upsertPlayerFromPacket({
            playerId: p.id, nickname: p.nickname, skinId: p.skinId, equippedSkinId: p.skinId,
            homeSnapshot: opts.homeSnapshot || { storedCheese: p.storedCheese, planetAppearance: { biome: p.planetBiome, ringType: p.planetRing } }
        });
        this.clock.setTimeout(() => client.send('saved_homes', getAllSavedPlayers()), 120);
    }

    onLeave(client) { this.state.players.delete(client.sessionId); this.externalSeen.delete(client.sessionId); }

    syncExternalPlayer(pkt) {
        if (!pkt?.sessionId || this.clients.some(c => c.sessionId === pkt.sessionId)) return;
        let p = this.state.players.get(pkt.sessionId);
        if (!p) {
            let pid = String(pkt.playerId || pkt.sessionId);
            for (const ep of this.state.players.values()) if (ep.id === pid) { pid = `${pid}_${pkt.sessionId.slice(0, 4)}`; break; }
            p = new PlayerState(); p.sessionId = pkt.sessionId; p.id = pid;
            this.state.players.set(pkt.sessionId, p);
        }
        if (pkt.nickname) p.nickname = String(pkt.nickname).slice(0, 18);
        for (const k of ['skinId', 'activityStatus', 'planetBiome', 'planetRing']) if (pkt[k]) p[k] = String(pkt[k]);
        for (const k of ['x', 'y', 'vx', 'vy']) if (typeof pkt[k] === 'number') p[k] = Math.round(pkt[k]);
        if (typeof pkt.angle === 'number') p.angle = Number(pkt.angle.toFixed(3));
        if (typeof pkt.isThrusting === 'boolean') p.isThrusting = pkt.isThrusting;
        if (typeof pkt.isTurbo === 'boolean') p.isTurbo = pkt.isTurbo;
        if (typeof pkt.storedCheese === 'number') p.storedCheese = pkt.storedCheese;
        this.externalSeen.set(pkt.sessionId, Date.now());
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

    update(dt) {
        this.state.serverTick = (this.state.serverTick + 1) % 1000000;
        const now = Date.now(), spacePlayers = [];
        for (const [sid, seenAt] of this.externalSeen.entries()) {
            if (now - seenAt > 6000) { this.state.players.delete(sid); this.externalSeen.delete(sid); }
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
                    this._sendImpulse(a, a.vx * 0.4 + nx * 320, a.vy * 0.4 + ny * 320, mx + nx * 28, my + ny * 28);
                    this._sendImpulse(b, b.vx * 0.4 - nx * 320, b.vy * 0.4 - ny * 320, mx - nx * 28, my - ny * 28);
                    this.broadcast('fx_event', { type: 'bumper_hit', x: Math.round(mx), y: Math.round(my) });
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
                this.broadcast('fx_event', { type: 'bumper_hit', x: Math.round(b.x - nx * FIELD.ballR), y: Math.round(b.y - ny * FIELD.ballR) });
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
                this.broadcast('fx_event', { type: 'paint_splat', x: pr.x, y: pr.y, color: pr.color });
            }
            for (const p of spacePlayers) if (!hit && p.sessionId !== meta.sessionId && p.id !== pr.ownerId && Math.hypot(pr.x - p.x, pr.y - p.y) < 36) {
                p.paintColor = pr.color; p.paintTimer = 6.0; hit = true;
                this.broadcast('fx_event', { type: 'paint_splat', x: p.x, y: p.y, color: pr.color, targetId: p.id, targetSid: p.sessionId });
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
                this.broadcast('fx_event', { type: 'cheese_picked', id: Number(id), byPlayerId: p.id, x: ch.x, y: ch.y });
                break;
            }
        }
    }

    _sendImpulse(p, vx, vy, x, y) {
        p.vx = Math.round(vx); p.vy = Math.round(vy); p.x = Math.round(x); p.y = Math.round(y);
        const client = this.clients.find(c => c.sessionId === p.sessionId);
        if (client) client.send('bumper_impulse', { vx: p.vx, vy: p.vy, x: p.x, y: p.y });
    }

    _goal(team) {
        const b = this.state.ball;
        if (team === 'blue') b.scoreBlue += 1; else b.scorePink += 1;
        b.x = FIELD.cx; b.y = FIELD.cy; b.vx = 0; b.vy = 0;
        this.broadcast('fx_event', { type: 'goal', team, score: { blue: b.scoreBlue, pink: b.scorePink }, x: FIELD.cx, y: FIELD.cy });
    }
}
