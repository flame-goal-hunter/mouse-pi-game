// ============================================================================
// SpaceEnvironment.js — Отрисовка поясов астероидов, комет и Дикого Сыра
// Физика и коллизии считаются единым ядром SpaceWorldCore (через ClientWorldSync)
// ============================================================================

import { SPACE_CONFIG } from './SpaceConfig.js';
import { PlayerProfile } from '../core/PlayerProfile.js';
import { SpaceAudio } from '../core/SpaceAudio.js';
import { SpaceNetwork } from './SpaceNetwork.js';

const PALETTES = [
    { fill: '#475569', rim: '#94a3b8', crystal: '#38bdf8' },
    { fill: '#4c1d95', rim: '#a78bfa', crystal: '#f472b6' },
    { fill: '#7c2d12', rim: '#fb923c', crystal: '#facc15' }
];

export class SpaceEnvironment {
    constructor() {
        this.comets = [];
        this.popups = [];
        this.asteroidVisuals = [];
        this._initVisuals();
        this._initComets();
    }

    get asteroids() {
        return SpaceNetwork.worldSync?.world?.asteroids || [];
    }

    _initVisuals() {
        const count = SPACE_CONFIG.environment.asteroidCount;
        for (let i = 0; i < count; i++) {
            const r = 18 + (i % 4) * 6;
            const verts = Array.from({ length: 7 }, (_, v) => {
                const a = (v / 7) * Math.PI * 2;
                const rad = r * (0.78 + ((i * 13 + v * 7) % 10) * 0.035);
                return { x: Math.cos(a) * rad, y: Math.sin(a) * rad };
            });
            this.asteroidVisuals.push({ verts, pal: PALETTES[i % PALETTES.length] });
        }
    }

    _initComets() {
        for (let i = 0; i < SPACE_CONFIG.environment.cometCount; i++) {
            this.comets.push(this._spawnComet(i * 3.1));
        }
    }

    _spawnComet(seed = 0) {
        const { halfWidth: hw, halfHeight: hh } = SPACE_CONFIG.world;
        const a = (seed * 1.7 + Math.random() * 0.8) % (Math.PI * 2);
        const spd = 260 + Math.random() * 140;
        return {
            x: (Math.random() * 2 - 1) * hw, y: (Math.random() * 2 - 1) * hh,
            vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
            color: seed % 2 > 1 ? '#38bdf8' : '#f472b6', size: 5 + (seed % 3)
        };
    }

    onServerCheesePicked(ev) {
        const cid = Number(ev.id), now = performance.now();
        if (!this.pickedAtById) this.pickedAtById = new Map();
        if (now - (this.pickedAtById.get(cid) || 0) < 3000) return;
        this.pickedAtById.set(cid, now);
        const cb = SpaceNetwork.worldSync?.world?.cheese?.get(cid);
        if (cb && cb.respawn <= 0) cb.respawn = 14;
        if (ev.byPlayerId === PlayerProfile.playerId || ev.byPlayerId === '__local__') {
            PlayerProfile.addPocketCheese(1);
            SpaceAudio.playCheesePickup();
            this.onCheeseCollected?.();
            try { navigator.vibrate?.(10); } catch (_) {}
        }
        this.popups.push({ x: ev.hitX ?? ev.x ?? cb?.renderX ?? 0, y: (ev.hitY ?? ev.y ?? cb?.renderY ?? 0) - 24, life: 0.85, maxLife: 0.85 });
    }

    update(dt, _rocket, onCheeseCollected) {
        this.onCheeseCollected = onCheeseCollected;
        const { halfWidth: hw, halfHeight: hh } = SPACE_CONFIG.world;
        for (const c of this.comets) {
            c.x += c.vx * dt; c.y += c.vy * dt;
            if (Math.abs(c.x) > hw + 300 || Math.abs(c.y) > hh + 300) Object.assign(c, this._spawnComet(Math.random() * 10));
        }
        for (let i = this.popups.length - 1; i >= 0; i--) {
            this.popups[i].y -= 38 * dt;
            if ((this.popups[i].life -= dt) <= 0) this.popups.splice(i, 1);
        }
    }

    draw(ctx, timeSec) {
        for (const c of this.comets) {
            ctx.save();
            const tx = c.x - c.vx * 0.22, ty = c.y - c.vy * 0.22;
            const g = ctx.createLinearGradient(c.x, c.y, tx, ty);
            g.addColorStop(0, '#fff'); g.addColorStop(0.3, c.color); g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.strokeStyle = g; ctx.lineWidth = c.size * 1.4; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(tx, ty); ctx.stroke();
            ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(c.x, c.y, c.size, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        }

        const asts = this.asteroids;
        for (let i = 0; i < asts.length; i++) {
            const a = asts[i], vis = this.asteroidVisuals[i] || this.asteroidVisuals[0];
            ctx.save();
            ctx.translate(a.renderX, a.renderY); ctx.rotate(a.renderAngle);
            ctx.fillStyle = a.hitFlash > 0 ? '#fef08a' : vis.pal.fill;
            ctx.strokeStyle = vis.pal.rim; ctx.lineWidth = 2.5;
            ctx.beginPath();
            vis.verts.forEach((v, idx) => idx === 0 ? ctx.moveTo(v.x, v.y) : ctx.lineTo(v.x, v.y));
            ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.fillStyle = vis.pal.crystal;
            ctx.beginPath(); ctx.arc(a.radius * 0.25, -a.radius * 0.2, a.radius * 0.22, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        }

        const cheeseMap = SpaceNetwork.worldSync?.world?.cheese;
        if (cheeseMap) {
            for (const ch of cheeseMap.values()) {
                if (ch.respawn > 0) continue;
                const bob = Math.sin(timeSec * 3.5 + ch.phase) * 4;
                ctx.save();
                ctx.translate(ch.renderX, ch.renderY + bob);
                ctx.rotate(Math.sin(timeSec * 2 + ch.phase) * 0.25);
                const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 22);
                glow.addColorStop(0, 'rgba(250, 204, 21, 0.55)'); glow.addColorStop(1, 'rgba(250, 204, 21, 0)');
                ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#facc15'; ctx.strokeStyle = '#ca8a04'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(-11, 7); ctx.lineTo(12, 7); ctx.lineTo(2, -10); ctx.closePath();
                ctx.fill(); ctx.stroke();
                ctx.fillStyle = '#eab308'; ctx.beginPath(); ctx.arc(-2, 2, 2.3, 0, Math.PI * 2); ctx.fill();
                ctx.restore();
            }
        }

        for (const p of this.popups) {
            ctx.save();
            ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
            ctx.font = '900 15px "Nunito", sans-serif'; ctx.fillStyle = '#fde047'; ctx.textAlign = 'center';
            ctx.fillText('+1 🧀', p.x, p.y);
            ctx.restore();
        }
    }
}
