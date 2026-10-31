// ============================================================================
// SpaceSmoothRender.js — Плавная интерполяция 60 FPS (@geckos.io/snapshot-interpolation)
// Снапшоты 20 Hz от Colyseus -> SI.vault.add(snapshot) -> SI.calcInterpolation('x y angle(rad)')
// ЖЕЛЕЗНОЕ ПРАВИЛО: координаты своей ракеты (mySessionId) НИКОГДА не трогаем!
// ============================================================================

import { SnapshotInterpolation } from '../../lib/snapshot-interpolation.esm.js';
import { RemotePlayerEntity } from './RemotePlayerEntity.js';

export class SpaceSmoothRender {
    constructor() {
        this.SI = new SnapshotInterpolation(20);
        this.smoothBall = null;
        this.smoothProjectiles = [];
        this.smoothCheese = new Map();
    }

    onColyseusState(state, mySessionId, peersMap, onSaveHome) {
        if (!state) return;
        const entities = [];
        const activePlayerIds = new Set();

        if (state.players) {
            state.players.forEach((p, sessionId) => {
                // ЖЕЛЕЗНОЕ ПРАВИЛО: свою ракету (mySessionId) НИКОГДА не берем из state.players!
                if (sessionId === mySessionId) return;
                const pid = p.id || sessionId;
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
                if (onSaveHome) onSaveHome(pkt);
            });
        }

        for (const pid of Array.from(peersMap.keys())) {
            if (!activePlayerIds.has(pid)) peersMap.delete(pid);
        }

        if (state.ball) {
            entities.push({
                id: 'ball',
                x: Number(state.ball.x) || 0,
                y: Number(state.ball.y) || 110,
                angle: Number(state.ball.angle) || 0
            });
            if (!this.smoothBall) {
                this.smoothBall = { x: state.ball.x, y: state.ball.y, vx: state.ball.vx, vy: state.ball.vy, angle: state.ball.angle, score: { blue: state.ball.scoreBlue || 0, pink: state.ball.scorePink || 0 } };
            } else {
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

    update60Fps(dt, peersMap) {
        const interpolated = this.SI.calcInterpolation('x y angle(rad)');
        const interpMap = new Map();
        if (interpolated && Array.isArray(interpolated.state)) {
            for (const ent of interpolated.state) interpMap.set(ent.id, ent);
        }

        const bEnt = interpMap.get('ball');
        if (bEnt && this.smoothBall) {
            this.smoothBall.x = bEnt.x;
            this.smoothBall.y = bEnt.y;
            this.smoothBall.angle = bEnt.angle;
        }

        for (const pr of this.smoothProjectiles) {
            const pEnt = interpMap.get(`pr_${pr.id}`);
            if (pEnt) { pr.x = pEnt.x; pr.y = pEnt.y; }
            else { pr.x += (pr.vx || 0) * dt; pr.y += (pr.vy || 0) * dt; }
        }

        for (const [pid, peer] of peersMap) {
            const ent = interpMap.get(`p_${pid}`);
            peer.update(dt, ent ? { x: ent.x, y: ent.y, angle: ent.angle, vx: peer.targetVx, vy: peer.targetVy, isThrusting: peer.isThrusting, isTurbo: peer.isTurbo } : null);
        }
    }
}
