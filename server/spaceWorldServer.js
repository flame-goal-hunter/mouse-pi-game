// ============================================================================
// spaceWorldServer.js — Авторитетный сервер мира Космоса (30 тиков/сек, 33 мс):
// единая физика ракет, бампер-столкновений, краскомета, мяча, астероидов и сыра
// ============================================================================

import { upsertPlayerFromPacket, getAllSavedPlayers } from './pushService.js';

const HW = 2150, HH = 2050, FIELD = { cx: 0, cy: 110, hw: 295, hh: 175, goalH: 72, ballR: 32 };
const PLANETS = [{ x: -520, y: -240, r: 86 }, { x: 540, y: -240, r: 84 }, { x: -440, y: 440, r: 82 }, { x: 460, y: 440, r: 82 }, { x: 0, y: -590, r: 74 }];
const CLUSTERS = [{ x: 0, y: 0, c: 6, s: 80 }, { x: -340, y: -170, c: 5, s: 75 }, { x: 370, y: -210, c: 5, s: 75 }, { x: -520, y: 260, c: 6, s: 85 }, { x: 510, y: 310, c: 6, s: 85 }, { x: -860, y: -40, c: 5, s: 80 }, { x: 880, y: 110, c: 5, s: 80 }, { x: 40, y: 540, c: 5, s: 75 }];

class SpaceWorldServer {
    constructor() {
        Object.assign(this, { players: new Map(), sockets: new Set(), projectiles: [], nextProjId: 1, ball: { x: FIELD.cx, y: FIELD.cy, vx: 0, vy: 0, r: FIELD.ballR, angle: 0 }, score: { blue: 0, pink: 0 }, asteroids: [], spaceCheese: [], recentFx: [], pendingImpulses: new Map() });
        this._initWorld();
        setInterval(() => this._tick(1 / 30), 33);
    }

    _initWorld() {
        for (let i = 0; i < 34; i++) {
            let x = 0, y = 0;
            for (let t = 0; t < 15; t++) {
                const a = (i / 34) * Math.PI * 4 + t * 0.4, d = 280 + (i * 37) % 1180;
                x = Math.cos(a) * d; y = Math.sin(a) * d;
                if (!PLANETS.some(p => Math.hypot(x - p.x, y - p.y) < p.r + 165)) break;
            }
            this.asteroids.push({ id: i, x, y, r: 18 + (i % 4) * 6, vx: (i % 2 === 0 ? 1 : -1) * (12 + (i % 5) * 4), vy: (i % 3 === 0 ? 1 : -1) * (10 + (i % 4) * 4), rot: i, rotSpd: (i % 2 === 0 ? 1 : -1) * 0.55 });
        }
        let cid = 1;
        CLUSTERS.forEach((cl, ci) => {
            for (let i = 0; i < cl.c; i++) {
                const a = (i / cl.c) * Math.PI * 2 + ci, d = 18 + (i % 3) * (cl.s * 0.38);
                const x = Math.round(cl.x + Math.cos(a) * d), y = Math.round(cl.y + Math.sin(a) * d);
                this.spaceCheese.push({ id: cid++, x, y, homeX: x, homeY: y, vx: 0, vy: 0, respawnTimer: 0 });
            }
        });
    }

    broadcast(obj) {
        const raw = JSON.stringify(obj);
        for (const ws of this.sockets) if (ws.readyState === 1) { try { ws.send(raw); } catch (_) {} }
    }

    emitFx(fx) {
        const ev = { ...fx, ts: Date.now() };
        this.recentFx.push(ev); if (this.recentFx.length > 30) this.recentFx.shift();
        this.broadcast({ type: 'fx_event', event: ev });
    }

    sendImpulse(player, vx, vy, x, y) {
        Object.assign(player, { vx, vy, x, y });
        const imp = { playerId: player.playerId, vx: Math.round(vx), vy: Math.round(vy), x: Math.round(x), y: Math.round(y), ts: Date.now() };
        this.pendingImpulses.set(player.playerId, imp);
        if (player.ws?.readyState === 1) { try { player.ws.send(JSON.stringify({ type: 'server_impulse', impulse: imp })); } catch (_) {} }
    }

    handleMessage(msg, ws = null) {
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'shoot_paint') {
            const p = this.players.get(msg.ownerId), sx = Number(msg.x) || p?.x || 0, sy = Number(msg.y) || p?.y || 0;
            this.projectiles.push({ id: this.nextProjId++, ownerId: msg.ownerId, x: sx, y: sy, vx: Number(msg.vx) || 0, vy: Number(msg.vy) || 0, color: msg.color || '#f472b6', emoji: msg.emoji || '😜', ttl: 1.35 });
            if (p) { p.activeEmoji = msg.emoji || '😜'; p.emojiTimer = 1.2; }
            this.emitFx({ type: 'horn', playerId: msg.ownerId, emoji: msg.emoji || '😜', x: Math.round(sx), y: Math.round(sy) });
            return;
        }
        if (msg.type === 'horn' && msg.playerId) {
            const p = this.players.get(msg.playerId);
            if (p) { p.activeEmoji = msg.emoji || '😜'; p.emojiTimer = 1.2; }
            this.emitFx({ type: 'horn', playerId: msg.playerId, emoji: msg.emoji || '😜', x: Math.round(p?.x || 0), y: Math.round(p?.y || 0) });
            return;
        }
        const pkt = msg.type === 'input_state' ? msg : (msg.playerId ? msg : null);
        if (!pkt?.playerId) return;
        upsertPlayerFromPacket(pkt);
        const prev = this.players.get(pkt.playerId) || { playerId: pkt.playerId, paintColor: null, paintTimer: 0, spinTimer: 0, activeEmoji: null, emojiTimer: 0, lastBumpAt: 0, lastAstAt: 0, lastKickAt: 0 };
        const imp = this.pendingImpulses.get(pkt.playerId), keep = imp && (Date.now() - imp.ts < 140);
        Object.assign(prev, {
            nickname: pkt.nickname || prev.nickname || 'Пи', skinId: pkt.skinId || pkt.equippedSkinId || prev.skinId || 'blue',
            equippedSkinId: pkt.equippedSkinId || pkt.skinId || prev.skinId || 'blue', currentLocation: pkt.currentLocation || prev.currentLocation || 'space',
            x: keep ? prev.x : (Number(pkt.x) || 0), y: keep ? prev.y : (Number(pkt.y) || 0), vx: keep ? prev.vx : (Number(pkt.vx) || 0), vy: keep ? prev.vy : (Number(pkt.vy) || 0),
            angle: Number(pkt.angle) || 0, isThrusting: Boolean(pkt.isThrusting), isTurbo: Boolean(pkt.isTurbo),
            homeAngle: Number(pkt.homeAngle) || 0, facing: pkt.facing || 1, moving: Boolean(pkt.moving),
            homeSnapshot: pkt.homeSnapshot || prev.homeSnapshot, updatedAt: Date.now(), ws: ws || prev.ws
        });
        this.players.set(pkt.playerId, prev);
    }

    _tick(dt) {
        const now = Date.now();
        for (const [id, p] of this.players) {
            if (now - p.updatedAt > 16000) { this.players.delete(id); continue; }
            if (p.paintTimer > 0 && (p.paintTimer = Math.max(0, p.paintTimer - dt)) === 0) p.paintColor = null;
            if (p.spinTimer > 0) p.spinTimer = Math.max(0, p.spinTimer - dt);
            if (p.emojiTimer > 0 && (p.emojiTimer = Math.max(0, p.emojiTimer - dt)) === 0) p.activeEmoji = null;
        }
        const spaceList = Array.from(this.players.values()).filter(p => p.currentLocation === 'space');
        for (let i = 0; i < spaceList.length; i++) {
            for (let j = i + 1; j < spaceList.length; j++) {
                const a = spaceList[i], b = spaceList[j], dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy);
                if (d < 52 && d > 0.01 && now - Math.max(a.lastBumpAt, b.lastBumpAt) > 240) {
                    a.lastBumpAt = b.lastBumpAt = now;
                    const nx = dx / d, ny = dy / d, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
                    this.sendImpulse(a, a.vx * 0.4 + nx * 320, a.vy * 0.4 + ny * 320, mx + nx * 28, my + ny * 28);
                    this.sendImpulse(b, b.vx * 0.4 - nx * 320, b.vy * 0.4 - ny * 320, mx - nx * 28, my - ny * 28);
                    this.emitFx({ type: 'bumper_hit', x: Math.round(mx), y: Math.round(my) });
                }
            }
        }
        this._stepEntities(dt, now, spaceList);
        this.broadcast(this.buildSnapshot(now));
    }

    _stepEntities(dt, now, spaceList) {
        const b = this.ball, minX = FIELD.cx - FIELD.hw, maxX = FIELD.cx + FIELD.hw, minY = FIELD.cy - FIELD.hh, maxY = FIELD.cy + FIELD.hh;
        b.x += b.vx * dt; b.y += b.vy * dt; b.angle += Math.hypot(b.vx, b.vy) * 0.012 * dt; b.vx *= 0.985; b.vy *= 0.985;
        if (b.y - b.r < minY) { b.y = minY + b.r; b.vy = Math.abs(b.vy) * 0.85; }
        if (b.y + b.r > maxY) { b.y = maxY - b.r; b.vy = -Math.abs(b.vy) * 0.85; }
        const inGoal = Math.abs(b.y - FIELD.cy) < FIELD.goalH;
        if (b.x - b.r < minX) { if (inGoal) this._goal('pink'); else { b.x = minX + b.r; b.vx = Math.abs(b.vx) * 0.85; } }
        else if (b.x + b.r > maxX) { if (inGoal) this._goal('blue'); else { b.x = maxX - b.r; b.vx = -Math.abs(b.vx) * 0.85; } }
        for (const p of spaceList) {
            const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy);
            if (d < b.r + 26 && d > 0.01 && now - p.lastKickAt > 110) {
                p.lastKickAt = now;
                const nx = dx / d, ny = dy / d, boost = p.isTurbo ? 1.55 : 1.25, kick = p.isTurbo ? 360 : 230;
                b.vx = p.vx * boost + nx * kick; b.vy = p.vy * boost + ny * kick; b.x = p.x + nx * (b.r + 28); b.y = p.y + ny * (b.r + 28);
                this.emitFx({ type: 'bumper_hit', x: Math.round(b.x - nx * b.r), y: Math.round(b.y - ny * b.r) });
            }
        }
        for (const a of this.asteroids) {
            a.x += a.vx * dt; a.y += a.vy * dt; a.rot += a.rotSpd * dt;
            if (a.x < -HW) a.x = HW; else if (a.x > HW) a.x = -HW;
            if (a.y < -HH) a.y = HH; else if (a.y > HH) a.y = -HH;
            for (const p of spaceList) {
                const dx = p.x - a.x, dy = p.y - a.y, d = Math.hypot(dx, dy), minD = a.r + 22;
                if (d > 0.01 && d < minD && now - p.lastAstAt > 180) {
                    p.lastAstAt = now; const nx = dx / d, ny = dy / d;
                    this.sendImpulse(p, nx * 290, ny * 290, a.x + nx * (minD + 3), a.y + ny * (minD + 3));
                    this.emitFx({ type: 'bumper_hit', x: Math.round(a.x + nx * a.r), y: Math.round(a.y + ny * a.r) });
                }
            }
        }
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const s = this.projectiles[i]; s.x += s.vx * dt; s.y += s.vy * dt; s.ttl -= dt; let hit = false;
            if (Math.hypot(s.x - b.x, s.y - b.y) < b.r + 10) {
                b.vx += s.vx * 0.45; b.vy += s.vy * 0.45; hit = true; this.emitFx({ type: 'paint_splat', x: Math.round(s.x), y: Math.round(s.y), color: s.color });
            }
            for (const p of spaceList) if (!hit && p.playerId !== s.ownerId && Math.hypot(s.x - p.x, s.y - p.y) < 32) {
                p.paintColor = s.color; p.paintTimer = 6.0; p.spinTimer = 1.0; hit = true;
                this.emitFx({ type: 'paint_splat', x: Math.round(p.x), y: Math.round(p.y), color: s.color, targetId: p.playerId });
            }
            if (!hit && this.asteroids.some(a => Math.hypot(s.x - a.x, s.y - a.y) < a.r + 8)) { hit = true; this.emitFx({ type: 'paint_splat', x: Math.round(s.x), y: Math.round(s.y), color: s.color }); }
            if (hit || s.ttl <= 0) this.projectiles.splice(i, 1);
        }
        for (const ch of this.spaceCheese) {
            if (ch.respawnTimer > 0) { if ((ch.respawnTimer -= dt) <= 0) { ch.x = ch.homeX; ch.y = ch.homeY; ch.vx = ch.vy = 0; } continue; }
            for (const p of spaceList) {
                const dx = p.x - ch.x, dy = p.y - ch.y, d = Math.hypot(dx, dy);
                if (d < 38) { ch.respawnTimer = 14; this.emitFx({ type: 'cheese_picked', id: ch.id, byPlayerId: p.playerId, x: Math.round(ch.x), y: Math.round(ch.y) }); break; }
                else if (d < 155 && d > 0.1) { const pull = (1 - d / 155) * 520; ch.vx += (dx / d) * pull * dt * 4; ch.vy += (dy / d) * pull * dt * 4; }
            }
            ch.x += ch.vx * dt; ch.y += ch.vy * dt; ch.vx *= 0.9; ch.vy *= 0.9;
        }
    }

    _goal(team) {
        this.score[team] = (this.score[team] || 0) + 1; Object.assign(this.ball, { x: FIELD.cx, y: FIELD.cy, vx: 0, vy: 0 });
        this.emitFx({ type: 'goal', team, score: this.score, x: FIELD.cx, y: FIELD.cy });
    }

    buildSnapshot(serverTime = Date.now()) {
        return {
            type: 'world_snapshot', serverTime,
            ball: { x: Math.round(this.ball.x), y: Math.round(this.ball.y), vx: Math.round(this.ball.vx), vy: Math.round(this.ball.vy), angle: Number(this.ball.angle.toFixed(2)), score: this.score },
            projectiles: this.projectiles.map(s => ({ id: s.id, ownerId: s.ownerId, x: Math.round(s.x), y: Math.round(s.y), vx: Math.round(s.vx), vy: Math.round(s.vy), color: s.color })),
            asteroids: this.asteroids.map(a => [a.id, Math.round(a.x), Math.round(a.y), Number(a.rot.toFixed(2))]),
            spaceCheese: this.spaceCheese.filter(c => c.respawnTimer <= 0).map(c => [c.id, Math.round(c.x), Math.round(c.y)]),
            players: Array.from(this.players.values()).map(p => ({
                playerId: p.playerId, nickname: p.nickname, skinId: p.skinId, equippedSkinId: p.equippedSkinId, currentLocation: p.currentLocation,
                x: Math.round(p.x), y: Math.round(p.y), vx: Math.round(p.vx), vy: Math.round(p.vy), angle: Number(p.angle.toFixed(2)),
                isThrusting: p.isThrusting, isTurbo: p.isTurbo, paintColor: p.paintColor, paintTimer: Number(p.paintTimer.toFixed(2)),
                spinTimer: Number(p.spinTimer.toFixed(2)), activeEmoji: p.activeEmoji, homeAngle: Number(p.homeAngle.toFixed(3)),
                facing: p.facing, moving: p.moving, homeSnapshot: p.homeSnapshot
            }))
        };
    }
}

export const spaceWorld = new SpaceWorldServer();
export { getAllSavedPlayers };
