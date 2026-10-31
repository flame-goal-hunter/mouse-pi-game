// ============================================================================
// SpaceSmoothRender.js — Плавная интерполяция 60 FPS (@geckos.io/snapshot-interpolation)
// Снапшоты 20 Hz от Colyseus -> SI.vault.add(snapshot) -> SI.calcInterpolation('x y angle(rad)')
// ЖЕЛЕЗНОЕ ПРАВИЛО: координаты своей ракеты (mySessionId) НИКОГДА не трогаем!
// ============================================================================

import { SnapshotInterpolation } from '../../lib/snapshot-interpolation.esm.js';
import { RemotePlayerEntity } from './RemotePlayerEntity.js';
import { SpaceNetDebug } from './SpaceNetDebug.js';

export class SpaceSmoothRender {
    constructor() {
        this.SI = new SnapshotInterpolation(20);
        this.smoothBall = null;
        this.smoothProjectiles = [];
        this.smoothCheese = new Map();
    }

    onColyseusState(state, mySessionId, peersMap, onSaveHome, myTabSid = '') {
        if (!state) return;
        const entities = [];
        const activePlayerIds = new Set();

        if (state.players) {
            state.players.forEach((p, sessionId) => {
                // ЖЕЛЕЗНОЕ ПРАВИЛО: свою ракету (mySessionId / myTabSid) НИКОГДА не берем из state.players!
                if (sessionId === mySessionId || (myTabSid && sessionId === myTabSid)) return;
                const rawId = p.id || sessionId;
                const pid = (typeof window !== 'undefined' && rawId === window.PlayerProfile?.playerId) ? `${rawId}_${sessionId.slice(0, 4)}` : rawId;
                activePlayerIds.add(pid);

                entities.push({
                    id: `p_${pid}`,
                    x: Number(p.x) || 0,
                    y: Number(p.y) || 0,
                    angle: Number(p.angle) || 0
                });

                let peer = peersMap.get(pid);
                const pkt = {
                    playerId: pid,
                    sessionId,
                    nickname: p.nickname || 'Пи',
                    skinId: p.skinId || 'blue',
                    equippedSkinId: p.skinId || 'blue',
                    activityStatus: p.activityStatus || 'space',
                    currentLocation: p.activityStatus || 'space',
                    x: p.x, y: p.y, vx: p.vx, vy: p.vy, angle: p.angle,
                    isThrusting: Boolean(p.isThrusting),
                    isTurbo: Boolean(p.isTurbo),
                    paintColor: p.paintColor || null,
                    paintTimer: Number(p.paintTimer) || 0,
                    homeAngle: Number(p.homeAngle) || 0,
                    facing: Number(p.facing) || 1,
                    moving: Boolean(p.moving),
                    homeSnapshot: {
                        storedCheese: Number(p.storedCheese) || 50,
                        unlockedSkins: ['blue'],
                        planetAppearance: { biome: p.planetBiome || 'cheese', ringType: p.planetRing || 'none' }
                    }
                };
                if (!peer) {
                    peer = new RemotePlayerEntity(pkt);
                    peersMap.set(pid, peer);
                } else {
                    peer.applyPacket(pkt);
                }
                peer.rawX = Number(p.x) || 0;
                peer.rawY = Number(p.y) || 0;
                if (onSaveHome) onSaveHome(pkt);
            });
        }

        for (const [pid, peer] of Array.from(peersMap.entries())) {
            if (!activePlayerIds.has(pid)) {
                if (peer.isExternal && Date.now() - (peer.lastSeen || 0) < 6000) {
                    entities.push({ id: `p_${pid}`, x: Number(peer.targetX) || 0, y: Number(peer.targetY) || 0, angle: Number(peer.targetAngle) || 0 });
                } else {
                    peersMap.delete(pid);
                }
            } else {
                peer.isExternal = false;
            }
        }

        if (state.ball) {
            const rawBx = Number.isFinite(Number(state.ball.x)) ? Number(state.ball.x) : 0;
            const rawBy = Number.isFinite(Number(state.ball.y)) ? Number(state.ball.y) : 110;
            entities.push({
                id: 'ball',
                x: rawBx,
                y: rawBy,
                angle: Number(state.ball.angle) || 0
            });
            if (!this.smoothBall) {
                this.smoothBall = { x: rawBx, y: rawBy, rawX: rawBx, rawY: rawBy, vx: state.ball.vx, vy: state.ball.vy, angle: state.ball.angle, score: { blue: state.ball.scoreBlue || 0, pink: state.ball.scorePink || 0 } };
            } else {
                this.smoothBall.rawX = rawBx;
                this.smoothBall.rawY = rawBy;
                this.smoothBall.vx = state.ball.vx;
                this.smoothBall.vy = state.ball.vy;
                this.smoothBall.score = { blue: state.ball.scoreBlue || 0, pink: state.ball.scorePink || 0 };
            }
        }

        const projs = [];
        if (state.projectiles) {
            state.projectiles.forEach((pr, id) => {
                entities.push({ id: `pr_${id}`, x: Number(pr.x) || 0, y: Number(pr.y) || 0, angle: 0 });
                projs.push({ id, ownerId: pr.ownerId, x: pr.x, y: pr.y, vx: pr.vx, vy: pr.vy, color: pr.color || '#f472b6' });
            });
        }
        this.smoothProjectiles = projs;

        if (state.spaceCheese) {
            const cMap = new Map();
            state.spaceCheese.forEach((ch, id) => cMap.set(Number(id), { x: ch.x, y: ch.y }));
            this.smoothCheese = cMap;
        }

        if (entities.length > 0) {
            const snapshot = this.SI.snapshot.create(entities);
            this.SI.addSnapshot(snapshot);
        }
    }

    onExternalPeer(pkt, mySessionId, peersMap, onSaveHome, isColyseusConnected = false, myTabSid = '') {
        if (!pkt || (pkt.sessionId && (pkt.sessionId === mySessionId || pkt.sessionId === myTabSid)) || (myTabSid && pkt.tabSid === myTabSid)) return;
        const rawId = pkt.playerId || pkt.sessionId;
        if (!rawId) return;
        const sid = pkt.sessionId || rawId;
        const pid = (typeof window !== 'undefined' && rawId === window.PlayerProfile?.playerId) ? `${rawId}_${ String(sid).slice(0, 4)}` : rawId;
        let peer = peersMap.get(pid);
        if (peer && !peer.isExternal && isColyseusConnected) return;
        const fullPkt = {
            ...pkt, playerId: pid, sessionId: sid,
            equippedSkinId: pkt.skinId || pkt.equippedSkinId || 'blue',
            currentLocation: pkt.activityStatus || pkt.currentLocation || 'space',
            homeSnapshot: pkt.homeSnapshot || { storedCheese: Number(pkt.storedCheese) || 50, unlockedSkins: ['blue'], planetAppearance: { biome: pkt.planetBiome || 'cheese', ringType: pkt.planetRing || 'none' } }
        };
        if (!peer) { peer = new RemotePlayerEntity(fullPkt); peersMap.set(pid, peer); }
        else peer.applyPacket(fullPkt);
        peer.rawX = Number(pkt.x) || 0;
        peer.rawY = Number(pkt.y) || 0;
        peer.isExternal = true;
        peer.sessionId = sid;
        if (onSaveHome) onSaveHome(fullPkt);
        if (!isColyseusConnected) {
            const ents = [];
            for (const [k, pr] of peersMap) ents.push({ id: `p_${k}`, x: Number(pr.targetX) || 0, y: Number(pr.targetY) || 0, angle: Number(pr.targetAngle) || 0 });
            if (ents.length > 0) this.SI.addSnapshot(this.SI.snapshot.create(ents));
        }
    }

    update60Fps(dt, peersMap) {
        const interpolated = this.SI.calcInterpolation('x y angle(rad)');
        const interpMap = new Map();
        if (interpolated && Array.isArray(interpolated.state)) {
            for (const ent of interpolated.state) interpMap.set(ent.id, ent);
        }
        const vSize = this.SI.vault?.size || 0;

        const bEnt = interpMap.get('ball');
        if (this.smoothBall) {
            if (bEnt) {
                this.smoothBall.x = bEnt.x;
                this.smoothBall.y = bEnt.y;
                this.smoothBall.angle = bEnt.angle;
            }
            SpaceNetDebug.recordEntityFrame('ball', this.smoothBall.rawX ?? this.smoothBall.x, this.smoothBall.rawY ?? this.smoothBall.y, this.smoothBall.x, this.smoothBall.y, this.smoothBall.angle || 0, dt, bEnt ? 'SI' : 'fallback_raw', vSize);
        }

        for (const pr of this.smoothProjectiles) {
            const pEnt = interpMap.get(`pr_${pr.id}`);
            if (pEnt) { pr.x = pEnt.x; pr.y = pEnt.y; }
            else { pr.x += (pr.vx || 0) * dt; pr.y += (pr.vy || 0) * dt; }
        }

        for (const [pid, peer] of peersMap) {
            const ent = interpMap.get(`p_${pid}`);
            peer.update(dt, ent ? { x: ent.x, y: ent.y, angle: ent.angle, vx: peer.targetVx, vy: peer.targetVy, isThrusting: peer.isThrusting, isTurbo: peer.isTurbo } : null);
            if (peer.currentLocation === 'space') {
                SpaceNetDebug.recordEntityFrame(`player_${peer.nickname || pid}`, peer.rawX ?? peer.targetX, peer.rawY ?? peer.targetY, peer.renderX, peer.renderY, peer.renderAngle, dt, ent ? 'SI' : 'fallback_raw', vSize);
            }
        }
    }
}

