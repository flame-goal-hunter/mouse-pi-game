// ============================================================================
// RocketController.js — Физика ракеты Мышонка Пи, звёздный шлейф и камера
// ============================================================================

import { SPACE_CONFIG } from './SpaceConfig.js';

export class RocketController {
    constructor() {
        const cfg = SPACE_CONFIG.rocket;
        this.x = cfg.startX;
        this.y = cfg.startY;
        this.vx = 0;
        this.vy = 0;
        this.angle = -Math.PI / 2;
        this.thrustPower = 0;
        this.particles = [];
        this.trailTimer = 0;
        this.camX = this.x;
        this.camY = this.y;
        this.camZoom = 1;
        this.zoomTargetPlanet = null;
        this.zoomProgress = 0;
        this.pilotImage = new Image();
        this.pilotImage.src = cfg.pilotImg;
    }

    startPlanetZoom(planet) {
        this.zoomTargetPlanet = planet;
        this.zoomProgress = 0;
    }

    update(dt, input) {
        const rCfg = SPACE_CONFIG.rocket;
        const cCfg = SPACE_CONFIG.camera;
        const wCfg = SPACE_CONFIG.world;

        if (this.zoomTargetPlanet) {
            this.zoomProgress = Math.min(1, this.zoomProgress + (dt * 1000) / cCfg.dockZoomDurationMs);
            const ease = 1 - Math.pow(1 - this.zoomProgress, 3);
            this.camX += (this.zoomTargetPlanet.x - this.camX) * 0.22;
            this.camY += (this.zoomTargetPlanet.y - this.camY) * 0.22;
            this.camZoom = 1 + (cCfg.dockZoomTarget - 1) * ease;
            this._updateParticles(dt);
            return this.zoomProgress >= 1;
        }

        if (input.angle !== null) {
            let diff = input.angle - this.angle;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            this.angle += diff * Math.min(1, rCfg.turnSpeed * dt);
        }

        const isThrusting = input.mag > 0.06 || input.turbo;
        const mult = input.turbo ? rCfg.turboMultiplier : 1;
        this.thrustPower = isThrusting ? Math.max(input.mag, input.turbo ? 1 : 0) * mult : 0;

        if (this.thrustPower > 0) {
            const accel = rCfg.thrust * this.thrustPower;
            this.vx += Math.cos(this.angle) * accel * dt;
            this.vy += Math.sin(this.angle) * accel * dt;
        }

        const frameDrag = Math.pow(rCfg.drag, dt * 60);
        this.vx *= frameDrag;
        this.vy *= frameDrag;

        const maxSpd = input.turbo ? rCfg.maxTurboSpeed : rCfg.maxSpeed;
        const spd = Math.hypot(this.vx, this.vy);
        if (spd > maxSpd) {
            this.vx = (this.vx / spd) * maxSpd;
            this.vy = (this.vy / spd) * maxSpd;
        }

        this.x = Math.max(-wCfg.width / 2, Math.min(wCfg.width / 2, this.x + this.vx * dt));
        this.y = Math.max(-wCfg.height / 2, Math.min(wCfg.height / 2, this.y + this.vy * dt));

        this.trailTimer += dt * 1000;
        if ((this.thrustPower > 0.08 || spd > 45) && this.trailTimer >= rCfg.trailIntervalMs) {
            this.trailTimer = 0;
            const count = input.turbo ? 2 : 1;
            for (let i = 0; i < count; i++) {
                const ejAngle = this.angle + Math.PI + (Math.random() - 0.5) * 0.7;
                const ejSpd = 60 + Math.random() * 90 + (input.turbo ? 70 : 0);
                const colors = rCfg.trailColors;
                this.particles.push({
                    x: this.x - Math.cos(this.angle) * 26 + (Math.random() - 0.5) * 8,
                    y: this.y - Math.sin(this.angle) * 26 + (Math.random() - 0.5) * 8,
                    vx: Math.cos(ejAngle) * ejSpd + this.vx * 0.2,
                    vy: Math.sin(ejAngle) * ejSpd + this.vy * 0.2,
                    size: (input.turbo ? 8 : 6) + Math.random() * 4,
                    color: colors[Math.floor(Math.random() * colors.length)],
                    life: 0,
                    maxLife: rCfg.trailLifeMs * (0.75 + Math.random() * 0.4),
                    rot: Math.random() * Math.PI * 2
                });
            }
        }

        this._updateParticles(dt);
        const lerp = 1 - Math.pow(1 - cCfg.lerp, dt * 60);
        this.camX += (this.x - this.camX) * lerp;
        this.camY += (this.y - this.camY) * lerp;
        return false;
    }

    _updateParticles(dt) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.life += dt * 1000;
            if (p.life >= p.maxLife) { this.particles.splice(i, 1); continue; }
            p.x += p.vx * dt; p.y += p.vy * dt; p.rot += 4 * dt;
        }
    }

    draw(ctx) {
        for (const p of this.particles) {
            const t = 1 - p.life / p.maxLife;
            const r = p.size * t;
            ctx.save();
            ctx.translate(p.x, p.y); ctx.rotate(p.rot);
            ctx.globalAlpha = t * 0.92; ctx.fillStyle = p.color;
            ctx.beginPath();
            for (let s = 0; s < 5; s++) {
                const a1 = (s * Math.PI * 2) / 5, a2 = a1 + Math.PI / 5;
                ctx.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
                ctx.lineTo(Math.cos(a2) * (r * 0.45), Math.sin(a2) * (r * 0.45));
            }
            ctx.closePath(); ctx.fill();
            ctx.restore();
        }

        ctx.save();
        ctx.translate(this.x, this.y); ctx.rotate(this.angle);
        if (this.thrustPower > 0.05) {
            const fl = 16 + this.thrustPower * 16 + Math.random() * 6;
            ctx.fillStyle = '#38bdf8';
            ctx.beginPath(); ctx.moveTo(-20, -8); ctx.lineTo(-20 - fl, 0); ctx.lineTo(-20, 8); ctx.fill();
            ctx.fillStyle = '#fef08a';
            ctx.beginPath(); ctx.moveTo(-20, -4); ctx.lineTo(-20 - fl * 0.65, 0); ctx.lineTo(-20, 4); ctx.fill();
        }
        ctx.fillStyle = '#e11d48';
        ctx.beginPath();
        ctx.moveTo(-8, -14); ctx.lineTo(-24, -24); ctx.lineTo(-20, -10); ctx.closePath();
        ctx.moveTo(-8, 14);  ctx.lineTo(-24, 24);  ctx.lineTo(-20, 10);  ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#f8fafc'; ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(2, 0, 26, 15, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

        ctx.fillStyle = '#f43f5e';
        ctx.beginPath(); ctx.arc(14, 0, 14, -Math.PI * 0.42, Math.PI * 0.42); ctx.closePath(); ctx.fill();

        ctx.fillStyle = '#38bdf8';
        ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 2.5; ctx.stroke();
        if (this.pilotImage.complete && this.pilotImage.naturalWidth > 0) {
            ctx.save();
            ctx.beginPath(); ctx.arc(0, 0, 8.5, 0, Math.PI * 2); ctx.clip();
            ctx.rotate(-Math.PI / 2);
            ctx.drawImage(this.pilotImage, -10, -10, 20, 22);
            ctx.restore();
        }
        ctx.restore();
    }
}
