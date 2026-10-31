// ============================================================================
// ClientWorldSync.js — Клиентское предсказание всего мира Космоса (50 Hz)
// + Погашение рывков Visual Error Offset (Teeworlds Anti-Snap Smooth Decay)
// ============================================================================

import { FIXED_DT, ROCKET_PHYS, createWorldCore, createPhysicsBody, stepWorld, shortAngleDist } from '../shared/SpaceWorldCore.js';
import { RemotePlayerEntity } from './RemotePlayerEntity.js';
import { SpaceNetDebug } from './SpaceNetDebug.js';

export class ClientWorldSync {
    constructor() {
        this.world = createWorldCore();
        this.accumulator = 0;
        this.onWorldEvents = null;
        this.myBody = createPhysicsBody({
            id: '__local__', type: 'rocket', x: 0, y: 165, angle: -Math.PI / 2,
            radius: ROCKET_PHYS.radius, invMass: 1.0, restitution: 0.82, drag: ROCKET_PHYS.friction
        });
        this.world.rockets.set('__local__', this.myBody);
    }

    _applyServerBody(body, srv, isFirstSpawn = false) {
        const sx = Number(srv.x) || 0, sy = Number(srv.y) || 0, sa = Number(srv.angle) || 0;
        body.rawX = sx; body.rawY = sy; body.rawAngle = sa;
        if (isFirstSpawn) {
            body.x = body.prevX = body.renderX = sx;
            body.y = body.prevY = body.renderY = sy;
            body.angle = body.prevAngle = body.renderAngle = sa;
            body.vx = Number(srv.vx) || 0; body.vy = Number(srv.vy) || 0;
            body.errorX = 0; body.errorY = 0; body.errorAngle = 0;
            return;
        }
        // 1. Запоминаем текущую точку на экране ДО обновления:
        const oldVisualX = body.x + body.errorX;
        const oldVisualY = body.y + body.errorY;
        const oldVisualAngle = body.angle + body.errorAngle;

        // 2. Обновляем физическое тело данными с сервера:
        body.x = sx;
        body.y = sy;
        body.vx = Number(srv.vx) ?? body.vx;
        body.vy = Number(srv.vy) ?? body.vy;
        body.prevX = body.x;
        body.prevY = body.y;
        body.angle = sa;
        body.prevAngle = body.angle;

        // 3. Компенсируем 100% разницы в визуальный оффсет (скачок на экране = 0.00px!):
        body.errorX = oldVisualX - body.x;
        body.errorY = oldVisualY - body.y;
        body.errorAngle = shortAngleDist(body.angle, oldVisualAngle);
        if (Math.hypot(body.errorX, body.errorY) > 800) {
            body.errorX = 0; body.errorY = 0; body.errorAngle = 0;
        }
    }

    _syncPeer(p, sessionId, mySessionId, myTabSid, peersMap, onSaveHome) {
        if (!p) return null;
        const pid = String(p.playerId || p.id || sessionId);
        const myPid = typeof window !== 'undefined' ? window.PlayerProfile?.playerId : '';
        if (sessionId === mySessionId || (myTabSid && (sessionId === myTabSid || p.tabSid === myTabSid)) || (myPid && (pid === myPid || pid.startsWith(myPid + '_')))) {
            if (sessionId === mySessionId && !this.myBody.docking && Math.hypot((Number(p.x) || 0) - this.myBody.x, (Number(p.y) || 0) - this.myBody.y) > 300) {
                this._applyServerBody(this.myBody, p, false);
            }
            return null;
        }
        const pkt = {
            playerId: pid, sessionId, nickname: p.nickname || 'Пи',
            skinId: p.skinId || p.equippedSkinId || 'blue', equippedSkinId: p.skinId || p.equippedSkinId || 'blue',
            activityStatus: p.activityStatus || p.currentLocation || 'space', currentLocation: p.activityStatus || p.currentLocation || 'space',
            x: p.x, y: p.y, vx: p.vx, vy: p.vy, angle: p.angle,
            isThrusting: Boolean(p.isThrusting), isTurbo: Boolean(p.isTurbo),
            paintColor: p.paintColor || null, paintTimer: Number(p.paintTimer) || 0,
            homeAngle: Number(p.homeAngle) || 0, facing: Number(p.facing) || 1, moving: Boolean(p.moving),
            homeSnapshot: p.homeSnapshot || { storedCheese: Number(p.storedCheese) || 50, unlockedSkins: ['blue'], planetAppearance: { biome: p.planetBiome || 'cheese', ringType: p.planetRing || 'none' } }
        };
        let peer = peersMap.get(pid);
        const isFirst = !peer;
        if (!peer) { peer = new RemotePlayerEntity(pkt); peersMap.set(pid, peer); }
        else peer.applyPacket(pkt);

        let rBody = this.world.rockets.get(pid);
        if (!rBody) {
            rBody = createPhysicsBody({ id: pid, playerId: pid, sessionId, type: 'rocket', x: p.x, y: p.y, vx: p.vx, vy: p.vy, angle: p.angle, radius: ROCKET_PHYS.radius, invMass: 1.0, restitution: 0.82, drag: ROCKET_PHYS.friction });
            this.world.rockets.set(pid, rBody);
            this._applyServerBody(rBody, p, true);
        } else {
            this._applyServerBody(rBody, p, isFirst);
        }
        rBody.isThrusting = Boolean(p.isThrusting); rBody.isTurbo = Boolean(p.isTurbo);
        rBody.activityStatus = pkt.currentLocation; rBody.sessionId = sessionId; rBody.playerId = pid;
        if (onSaveHome) onSaveHome(pkt);
        return pid;
    }

    onServerState(state, mySessionId, peersMap, onSaveHome, myTabSid = '') {
        if (!state) return;
        const activePids = new Set();
        if (state.players) {
            const iter = typeof state.players.forEach === 'function'
                ? (fn) => state.players.forEach((v, k) => fn(v, k || v.sessionId))
                : (fn) => state.players.forEach(v => fn(v, v.sessionId || v.playerId));
            iter((p, sid) => {
                const pid = this._syncPeer(p, sid, mySessionId, myTabSid, peersMap, onSaveHome);
                if (pid) activePids.add(pid);
            });
        }
        for (const pid of Array.from(peersMap.keys())) {
            if (!activePids.has(pid)) { peersMap.delete(pid); this.world.rockets.delete(pid); }
        }
        if (state.ball && this.world.ball) {
            const sb = state.ball;
            if (typeof sb.scoreBlue === 'number') this.world.score = { blue: sb.scoreBlue, pink: sb.scorePink || 0 };
            const recentlyKicked = performance.now() - (this.lastLocalBallKickAt || 0) < 350;
            if (!recentlyKicked && (Math.hypot((Number(sb.x) || 0) - this.myBody.x, (Number(sb.y) || 0) - this.myBody.y) > 72 || Math.hypot((Number(sb.x) || 0) - this.world.ball.x, (Number(sb.y) || 0) - this.world.ball.y) > 160)) {
                this._applyServerBody(this.world.ball, sb, false);
            } else {
                this.world.ball.rawX = Number(sb.x) || 0; this.world.ball.rawY = Number(sb.y) || 0;
            }
        }
        if (state.spaceCheese) {
            const activeCheese = new Set();
            const cIter = typeof state.spaceCheese.forEach === 'function'
                ? (fn) => state.spaceCheese.forEach((v, k) => fn(v, Number(k || v.id)))
                : (fn) => state.spaceCheese.forEach(v => fn(v, Number(v.id)));
            cIter((ch, cid) => {
                activeCheese.add(cid);
                const cb = this.world.cheese.get(cid);
                if (cb && cb.respawn <= 1.5) cb.respawn = 0;
            });
            for (const [cid, cb] of this.world.cheese.entries()) {
                if (!activeCheese.has(cid) && cb.respawn <= 0) cb.respawn = 14;
            }
        }
    }

    stepFrame(frameDt, peersMap) {
        const clampedDt = Math.min(0.1, Math.max(0.001, frameDt));
        this.accumulator += clampedDt;
        while (this.accumulator >= FIXED_DT) {
            this.accumulator -= FIXED_DT;
            const evs = stepWorld(this.world, FIXED_DT, { authoritativeGoals: false });
            if (evs.length && this.onWorldEvents) this.onWorldEvents(evs);
        }
        const alpha = this.accumulator / FIXED_DT;
        const decay = Math.exp(-15 * clampedDt);
        const stepVisual = (b) => {
            b.errorX *= decay; b.errorY *= decay; b.errorAngle *= decay;
            b.renderX = b.prevX + (b.x - b.prevX) * alpha + b.errorX;
            b.renderY = b.prevY + (b.y - b.prevY) * alpha + b.errorY;
            b.renderAngle = b.prevAngle + shortAngleDist(b.prevAngle, b.angle) * alpha + b.errorAngle;
        };
        stepVisual(this.myBody);
        if (this.world.ball) {
            stepVisual(this.world.ball);
            SpaceNetDebug.recordEntityFrame('ball', this.world.ball.rawX, this.world.ball.rawY, this.world.ball.renderX, this.world.ball.renderY, this.world.ball.renderAngle, clampedDt, 'SI', this.world.rockets.size);
        }
        for (const a of this.world.asteroids) stepVisual(a);
        for (const pr of this.world.projectiles.values()) stepVisual(pr);
        for (const ch of this.world.cheese.values()) stepVisual(ch);
        for (const [pid, peer] of peersMap.entries()) {
            const rb = this.world.rockets.get(pid);
            if (rb) {
                stepVisual(rb);
                peer.syncFromBody(clampedDt, rb);
                if (peer.currentLocation === 'space') {
                    SpaceNetDebug.recordEntityFrame(`player_${peer.nickname || pid}`, rb.rawX, rb.rawY, peer.renderX, peer.renderY, peer.renderAngle, clampedDt, 'SI', this.world.rockets.size);
                }
            }
        }
    }
}

