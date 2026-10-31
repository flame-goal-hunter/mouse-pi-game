// ============================================================================
// WorldInterpolator.js — Буфер интерполяции снапшотов (Snapshot Interpolation)
// Хранит снапшоты за 500 мс, рендерит с задержкой 80 мс на 60 FPS (до 190 строк)
// ============================================================================

const INTERP_DELAY_MS = 80;
const MAX_BUFFER_MS = 500;

export function lerpAngleShortest(a0, a1, t) {
    const da = Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0));
    return a0 + da * t;
}

export class WorldInterpolator {
    constructor() {
        this.snapshots = [];
        this.clockOffset = null;
        this.hasServerWorld = false;
    }

    pushSnapshot(snap) {
        if (!snap || typeof snap.serverTime !== 'number') return;
        const now = performance.now();
        const sampleOffset = now - snap.serverTime;
        this.clockOffset = this.clockOffset === null
            ? sampleOffset
            : this.clockOffset * 0.9 + sampleOffset * 0.1;

        const playersMap = new Map();
        if (Array.isArray(snap.players)) {
            for (const p of snap.players) if (p?.playerId) playersMap.set(p.playerId, p);
        }
        const projMap = new Map();
        if (Array.isArray(snap.projectiles)) {
            for (const pr of snap.projectiles) if (pr?.id) projMap.set(pr.id, pr);
        }
        const astMap = new Map();
        if (Array.isArray(snap.asteroids)) {
            for (const a of snap.asteroids) astMap.set(a[0], { x: a[1], y: a[2], rot: a[3] });
        }
        const cheeseMap = new Map();
        if (Array.isArray(snap.spaceCheese)) {
            for (const c of snap.spaceCheese) cheeseMap.set(c[0], { x: c[1], y: c[2] });
        }

        const entry = {
            serverTime: snap.serverTime,
            recvTime: now,
            ball: snap.ball || null,
            players: playersMap,
            projectiles: projMap,
            asteroids: astMap,
            spaceCheese: cheeseMap
        };

        this.snapshots.push(entry);
        this.hasServerWorld = true;
        const cutoff = snap.serverTime - MAX_BUFFER_MS;
        while (this.snapshots.length > 2 && this.snapshots[0].serverTime < cutoff) {
            this.snapshots.shift();
        }
    }

    _getBracket() {
        const n = this.snapshots.length;
        if (n === 0) return null;
        if (n === 1) return { s0: this.snapshots[0], s1: this.snapshots[0], alpha: 0, extrapSec: 0 };

        const renderTime = (performance.now() - (this.clockOffset ?? 0)) - INTERP_DELAY_MS;
        for (let i = n - 2; i >= 0; i--) {
            const s0 = this.snapshots[i], s1 = this.snapshots[i + 1];
            if (renderTime >= s0.serverTime && renderTime <= s1.serverTime) {
                const span = Math.max(1, s1.serverTime - s0.serverTime);
                return { s0, s1, alpha: Math.max(0, Math.min(1, (renderTime - s0.serverTime) / span)), extrapSec: 0 };
            }
        }
        const last = this.snapshots[n - 1];
        if (renderTime > last.serverTime) {
            const extrapSec = Math.min(0.18, (renderTime - last.serverTime) / 1000);
            return { s0: last, s1: last, alpha: 1, extrapSec };
        }
        return { s0: this.snapshots[0], s1: this.snapshots[0], alpha: 0, extrapSec: 0 };
    }

    getInterpolatedPlayer(playerId) {
        const br = this._getBracket();
        if (!br) return null;
        const p0 = br.s0.players.get(playerId);
        const p1 = br.s1.players.get(playerId) || p0;
        if (!p1) return null;
        if (!p0 || br.s0 === br.s1) {
            return {
                ...p1,
                x: p1.x + (p1.vx || 0) * br.extrapSec,
                y: p1.y + (p1.vy || 0) * br.extrapSec
            };
        }
        const t = br.alpha;
        let x = p0.x + (p1.x - p0.x) * t;
        let y = p0.y + (p1.y - p0.y) * t;
        if (Math.hypot(p1.x - p0.x, p1.y - p0.y) > 600) { x = p1.x; y = p1.y; }
        return {
            ...p1,
            x,
            y,
            vx: p0.vx + (p1.vx - p0.vx) * t,
            vy: p0.vy + (p1.vy - p0.vy) * t,
            angle: lerpAngleShortest(p0.angle || 0, p1.angle || 0, t),
            homeAngle: (p0.homeAngle || 0) + ((p1.homeAngle || 0) - (p0.homeAngle || 0)) * t
        };
    }

    getInterpolatedBall() {
        const br = this._getBracket();
        if (!br || !br.s1.ball) return null;
        const b0 = br.s0.ball || br.s1.ball, b1 = br.s1.ball;
        if (br.s0 === br.s1 || Math.hypot(b1.x - b0.x, b1.y - b0.y) > 260) {
            return {
                ...b1,
                x: b1.x + (b1.vx || 0) * br.extrapSec,
                y: b1.y + (b1.vy || 0) * br.extrapSec
            };
        }
        const t = br.alpha;
        return {
            ...b1,
            x: b0.x + (b1.x - b0.x) * t,
            y: b0.y + (b1.y - b0.y) * t,
            vx: b0.vx + (b1.vx - b0.vx) * t,
            vy: b0.vy + (b1.vy - b0.vy) * t,
            angle: lerpAngleShortest(b0.angle || 0, b1.angle || 0, t)
        };
    }

    getInterpolatedProjectiles() {
        const br = this._getBracket();
        if (!br) return [];
        const out = [];
        for (const [id, pr1] of br.s1.projectiles) {
            const pr0 = br.s0.projectiles.get(id);
            if (!pr0 || br.s0 === br.s1) {
                out.push({ ...pr1, x: pr1.x + (pr1.vx || 0) * br.extrapSec, y: pr1.y + (pr1.vy || 0) * br.extrapSec });
            } else {
                const t = br.alpha;
                out.push({ ...pr1, x: pr0.x + (pr1.x - pr0.x) * t, y: pr0.y + (pr1.y - pr0.y) * t });
            }
        }
        return out;
    }

    getLatestWorldEntities() {
        const n = this.snapshots.length;
        return n > 0 ? this.snapshots[n - 1] : null;
    }
}
