// ============================================================================
// SpaceEnvironment.js — Пояса астероидов (с упругим отскоком), кометы
// и скопления «Дикого Звёздного Сыра» с магнитным притяжением в багажник ракеты
// ============================================================================

import { SPACE_CONFIG } from './SpaceConfig.js';
import { PlayerProfile } from '../core/PlayerProfile.js';
import { SpaceAudio } from '../core/SpaceAudio.js';
import { SpaceNetwork } from './SpaceNetworkClient.js';

export class SpaceEnvironment {
    constructor() {
        this.asteroids = [];
        this.comets = [];
        this.cheeseItems = [];
        this.popups = [];
        this._initAsteroids();
        this._initComets();
        this._initCheese();
    }

    _isNearPlanet(x, y, pad = 175) {
        return SPACE_CONFIG.planets.some(p => Math.hypot(x - p.x, y - p.y) < p.radius + pad);
    }

    _initAsteroids() {
        const { halfWidth: hw, halfHeight: hh } = SPACE_CONFIG.world;
        const palettes = [
            { fill: '#475569', rim: '#94a3b8', crystal: '#38bdf8' },
            { fill: '#4c1d95', rim: '#a78bfa', crystal: '#f472b6' },
            { fill: '#7c2d12', rim: '#fb923c', crystal: '#facc15' }
        ];
        const count = SPACE_CONFIG.environment.asteroidCount;
        for (let i = 0; i < count; i++) {
            let x = 0, y = 0;
            for (let t = 0; t < 15; t++) {
                const a = (i / count) * Math.PI * 4 + t * 0.4;
                const d = 280 + (i * 37) % 1180;
                x = Math.cos(a) * d; y = Math.sin(a) * d;
                if (!this._isNearPlanet(x, y, 165)) break;
            }
            const r = 18 + (i % 4) * 6;
            const verts = Array.from({ length: 7 }, (_, v) => {
                const a = (v / 7) * Math.PI * 2;
                const rad = r * (0.78 + ((i * 13 + v * 7) % 10) * 0.035);
                return { x: Math.cos(a) * rad, y: Math.sin(a) * rad };
            });
            this.asteroids.push({
                id: i, x, y, r, verts,
                vx: (i % 2 === 0 ? 1 : -1) * (12 + (i % 5) * 4),
                vy: (i % 3 === 0 ? 1 : -1) * (10 + (i % 4) * 4),
                rot: i, rotSpd: (i % 2 === 0 ? 1 : -1) * 0.55,
                pal: palettes[i % palettes.length], hitFlash: 0, hw, hh
            });
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

    _initCheese() {
        let cid = 1;
        SPACE_CONFIG.environment.cheeseClusters.forEach((cl, ci) => {
            for (let i = 0; i < cl.count; i++) {
                const a = (i / cl.count) * Math.PI * 2 + ci;
                const d = 18 + (i % 3) * (cl.spread * 0.38);
                const x = cl.x + Math.cos(a) * d, y = cl.y + Math.sin(a) * d;
                this.cheeseItems.push({ id: cid++, x, y, homeX: x, homeY: y, vx: 0, vy: 0, phase: ci + i * 0.7, respawnTimer: 0 });
            }
        });
    }

    onServerCheesePicked(ev) {
        const ch = this.cheeseItems.find(c => c.id === ev.id);
        if (ch && ch.respawnTimer <= 0) {
            ch.respawnTimer = 14;
            if (ev.byPlayerId === PlayerProfile.playerId) {
                PlayerProfile.addPocketCheese(1);
                SpaceAudio.playCheesePickup();
                this.onCheeseCollected?.();
            }
        }
        this.popups.push({ x: ev.x || ch?.x || 0, y: (ev.y || ch?.y || 0) - 24, life: 0.85, maxLife: 0.85 });
    }

    update(dt, rocket, onCheeseCollected) {
        this.onCheeseCollected = onCheeseCollected;
        const { halfWidth: hw, halfHeight: hh } = SPACE_CONFIG.world;
        const envCfg = SPACE_CONFIG.environment;
        const srvSnap = SpaceNetwork.interpolator.getLatestWorldEntities();

        for (const a of this.asteroids) {
            a.x += a.vx * dt; a.y += a.vy * dt; a.rot += a.rotSpd * dt;
            const sa = srvSnap?.asteroids?.get(a.id);
            if (sa) {
                if (Math.hypot(sa.x - a.x, sa.y - a.y) > 300) { a.x = sa.x; a.y = sa.y; }
                else { a.x += (sa.x - a.x) * Math.min(1, dt * 8); a.y += (sa.y - a.y) * Math.min(1, dt * 8); }
            }
            if (a.hitFlash > 0) a.hitFlash = Math.max(0, a.hitFlash - dt * 4);
            if (a.x < -hw) a.x = hw; else if (a.x > hw) a.x = -hw;
            if (a.y < -hh) a.y = hh; else if (a.y > hh) a.y = -hh;

            const dx = rocket.x - a.x, dy = rocket.y - a.y;
            const dist = Math.hypot(dx, dy), minDist = a.r + 22;
            if (dist > 0 && dist < minDist && !rocket.zoomTargetPlanet) {
                const nx = dx / dist, ny = dy / dist;
                rocket.x = a.x + nx * (minDist + 2);
                rocket.y = a.y + ny * (minDist + 2);
                rocket.bounceOff(nx, ny, 290);
                a.hitFlash = 1;
                SpaceAudio.playBumperBounce();
                try { navigator.vibrate?.(12); } catch (_) {}
            }
        }

        for (const c of this.comets) {
            c.x += c.vx * dt; c.y += c.vy * dt;
            if (Math.abs(c.x) > hw + 300 || Math.abs(c.y) > hh + 300) Object.assign(c, this._spawnComet(Math.random() * 10));
        }

        for (const ch of this.cheeseItems) {
            if (srvSnap?.spaceCheese) {
                const sc = srvSnap.spaceCheese.get(ch.id);
                if (!sc) { ch.respawnTimer = Math.max(0.5, ch.respawnTimer); continue; }
                ch.respawnTimer = 0;
                ch.x += (sc.x - ch.x) * Math.min(1, dt * 10);
                ch.y += (sc.y - ch.y) * Math.min(1, dt * 10);
            } else if (ch.respawnTimer > 0) {
                if ((ch.respawnTimer -= dt) <= 0) { ch.x = ch.homeX; ch.y = ch.homeY; ch.vx = 0; ch.vy = 0; }
                continue;
            }
            const dx = rocket.x - ch.x, dy = rocket.y - ch.y, dist = Math.hypot(dx, dy);
            if (dist < envCfg.cheeseMagnetRadius && dist > 0.1) {
                const pull = (1 - dist / envCfg.cheeseMagnetRadius) * envCfg.cheeseMagnetPull;
                ch.vx += (dx / dist) * pull * dt * 5;
                ch.vy += (dy / dist) * pull * dt * 5;
            } else { ch.vx *= 0.92; ch.vy *= 0.92; }
            ch.x += ch.vx * dt; ch.y += ch.vy * dt;

            if (dist < envCfg.cheeseCollectRadius) {
                ch.respawnTimer = 14;
                PlayerProfile.addPocketCheese(1);
                SpaceAudio.playCheesePickup();
                if (onCheeseCollected) onCheeseCollected();
                try { navigator.vibrate?.(10); } catch (_) {}
                this.popups.push({ x: rocket.x, y: rocket.y - 24, life: 0.85, maxLife: 0.85 });
            }
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

        for (const a of this.asteroids) {
            ctx.save();
            ctx.translate(a.x, a.y); ctx.rotate(a.rot);
            ctx.fillStyle = a.hitFlash > 0 ? '#fef08a' : a.pal.fill;
            ctx.strokeStyle = a.pal.rim; ctx.lineWidth = 2.5;
            ctx.beginPath();
            a.verts.forEach((v, idx) => idx === 0 ? ctx.moveTo(v.x, v.y) : ctx.lineTo(v.x, v.y));
            ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.fillStyle = a.pal.crystal;
            ctx.beginPath(); ctx.arc(a.r * 0.25, -a.r * 0.2, a.r * 0.22, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        }

        for (const ch of this.cheeseItems) {
            if (ch.respawnTimer > 0) continue;
            const bob = Math.sin(timeSec * 3.5 + ch.phase) * 4;
            ctx.save();
            ctx.translate(ch.x, ch.y + bob);
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

        for (const p of this.popups) {
            ctx.save();
            ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
            ctx.font = '900 15px "Nunito", sans-serif'; ctx.fillStyle = '#fde047'; ctx.textAlign = 'center';
            ctx.fillText('+1 🧀', p.x, p.y);
            ctx.restore();
        }
    }
}
