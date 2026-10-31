// ============================================================================
// RocketController.js — Свободный аркадный полёт ракеты Мышонка Пи,
// скин в иллюминаторе, отскок от астероидов, шлейф звёздочек и камера (lerp + Zoom-In)
// ============================================================================

import { SPACE_CONFIG } from './SpaceConfig.js';
import { getPlayerSkinSprite } from '../core/PlayerProfile.js';

export class RocketController {
    constructor() {
        const cfg = SPACE_CONFIG.rocket;
        this.x = cfg.startX;
        this.y = cfg.startY;
        this.vx = 0;
        this.vy = 0;
        this.angle = cfg.startAngle;
        this.camX = this.x;
        this.camY = this.y;
        this.camZoom = 1;
        this.particles = [];
        this.exhaustAccum = 0;
        this.zoomTargetPlanet = null;
        this.zoomElapsedMs = 0;
        this.paintColor = null;
        this.paintTimer = 0;
        this.flipTimer = 0;
        this.hopScale = 0;
        this.isThrusting = false;
        this.isTurbo = false;
        this.trailStyle = 'stars';
    }

    startPlanetZoom(planet) {
        this.zoomTargetPlanet = planet;
        this.zoomElapsedMs = 0;
        this.vx = 0;
        this.vy = 0;
    }

    bounceOff(nx, ny, minBounce = 270) {
        const dot = this.vx * nx + this.vy * ny;
        this.vx = (this.vx - 2 * dot * nx) * 0.85 + nx * minBounce;
        this.vy = (this.vy - 2 * dot * ny) * 0.85 + ny * minBounce;
    }

    update(dt, input) {
        const cfg = SPACE_CONFIG.rocket;
        if (this.zoomTargetPlanet) {
            this.zoomElapsedMs += dt * 1000;
            const t = Math.min(1, this.zoomElapsedMs / cfg.zoomDurationMs);
            const ease = 1 - Math.pow(1 - t, 3);
            this.camX += (this.zoomTargetPlanet.x - this.camX) * Math.min(1, dt * 12);
            this.camY += (this.zoomTargetPlanet.y - this.camY) * Math.min(1, dt * 12);
            this.camZoom = 1 + (cfg.zoomTargetScale - 1) * ease;
            this.x += (this.zoomTargetPlanet.x - this.x) * Math.min(1, dt * 8);
            this.y += (this.zoomTargetPlanet.y - this.y) * Math.min(1, dt * 8);
            this._updateParticles(dt);
            return t >= 1;
        }

        const mag = Math.hypot(input.moveX, input.moveY);
        const moving = mag > 0.01;
        this.isThrusting = moving;
        this.isTurbo = Boolean(input.turboHeld);
        if (moving) {
            const targetAngle = Math.atan2(input.moveY, input.moveX);
            let diff = targetAngle - this.angle;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            this.angle += diff * Math.min(1, cfg.turnLerp * dt);

            const acc = input.turboHeld ? cfg.turboAccel : cfg.accel;
            const thrust = Math.min(1, mag) * acc;
            this.vx += Math.cos(this.angle) * thrust * dt;
            this.vy += Math.sin(this.angle) * thrust * dt;
        }

        const drag = Math.pow(cfg.friction, dt * 60);
        this.vx *= drag;
        this.vy *= drag;

        const maxSpd = input.turboHeld ? cfg.turboMaxSpeed : cfg.maxSpeed;
        const speed = Math.hypot(this.vx, this.vy);
        if (speed > maxSpd) {
            this.vx = (this.vx / speed) * maxSpd;
            this.vy = (this.vy / speed) * maxSpd;
        }

        this.x += this.vx * dt;
        this.y += this.vy * dt;

        const { halfWidth, halfHeight } = SPACE_CONFIG.world;
        this.x = Math.max(-halfWidth, Math.min(halfWidth, this.x));
        this.y = Math.max(-halfHeight, Math.min(halfHeight, this.y));

        if (moving || input.turboHeld || speed > 55) {
            this.exhaustAccum += dt * 1000 * (input.turboHeld ? 2.2 : 1);
            while (this.exhaustAccum >= cfg.exhaustRateMs) {
                this.exhaustAccum -= cfg.exhaustRateMs;
                this._spawnStarParticle(input.turboHeld);
            }
        }

        if (this.paintTimer > 0 && (this.paintTimer = Math.max(0, this.paintTimer - dt)) === 0) this.paintColor = null;
        if (this.flipTimer > 0) this.flipTimer = Math.max(0, this.flipTimer - dt);
        if (this.hopScale > 0) this.hopScale = Math.max(0, this.hopScale - dt * 2.2);
        this._updateParticles(dt);
        const lerpF = Math.min(1, cfg.cameraLerp * dt);
        this.camX += (this.x - this.camX) * lerpF;
        this.camY += (this.y - this.camY) * lerpF;
        return false;
    }

    _spawnStarParticle(isTurbo) {
        const colors = isTurbo ? ['#38bdf8', '#fde047', '#f472b6', '#2dd4bf'] : SPACE_CONFIG.rocket.exhaustColors;
        const backX = this.x - Math.cos(this.angle) * 26;
        const backY = this.y - Math.sin(this.angle) * 26;
        const spread = (Math.random() - 0.5) * 0.7;
        const spd = (isTurbo ? 175 : 95) + Math.random() * 65;
        this.particles.push({
            x: backX + (Math.random() - 0.5) * 8,
            y: backY + (Math.random() - 0.5) * 8,
            vx: -Math.cos(this.angle + spread) * spd,
            vy: -Math.sin(this.angle + spread) * spd,
            size: (isTurbo ? 9 : 6.5) + Math.random() * 4,
            life: 1,
            decay: 1.5 + Math.random() * 0.9,
            rot: Math.random() * Math.PI * 2,
            bubble: this.paintTimer > 0,
            color: this.paintColor || colors[Math.floor(Math.random() * colors.length)]
        });
    }

    _updateParticles(dt) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.rot += 3.5 * dt;
            p.life -= p.decay * dt;
            if (p.life <= 0) this.particles.splice(i, 1);
        }
    }

    draw(ctx) {
        for (const p of this.particles) {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.globalAlpha = Math.max(0, p.life);
            ctx.fillStyle = p.color;
            const r = p.size * p.life;
            ctx.beginPath();
            if (p.bubble) {
                ctx.strokeStyle = p.color; ctx.lineWidth = 2;
                ctx.arc(0, 0, r * 1.1, 0, Math.PI * 2);
                ctx.stroke();
            } else {
                for (let i = 0; i < 10; i++) {
                    const rad = i % 2 === 0 ? r : r * 0.44;
                    const a = (i * Math.PI) / 5;
                    if (i === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
                    else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
                }
                ctx.closePath();
                ctx.fill();
            }
            ctx.restore();
        }

        ctx.save();
        ctx.translate(this.x, this.y);
        const sc = 1 + this.hopScale;
        ctx.scale(sc, sc);
        const spin = this.flipTimer > 0 ? (1 - this.flipTimer / 0.65) * Math.PI * 2 : 0;
        ctx.save();
        ctx.rotate(this.angle + spin);

        const vib = this.isTurbo ? (Math.random() - 0.5) * 2.2 : 0;
        ctx.fillStyle = '#334155'; ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.roundRect(-27, -6 + vib, 8, 12, 3); ctx.fill(); ctx.stroke();

        if (this.isThrusting || this.isTurbo || Math.hypot(this.vx, this.vy) > 45) {
            const flLen = (this.isTurbo ? 38 : 20) + Math.sin(performance.now() * 0.036) * (this.isTurbo ? 9 : 5);
            const fg = ctx.createLinearGradient(-25, 0, -25 - flLen, 0);
            fg.addColorStop(0, '#ffffff');
            fg.addColorStop(0.35, this.isTurbo ? '#38bdf8' : '#fde047');
            fg.addColorStop(0.75, this.isTurbo ? '#f472b6' : '#fb923c');
            fg.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = fg;
            ctx.beginPath(); ctx.moveTo(-25, -6.5); ctx.lineTo(-25 - flLen, vib); ctx.lineTo(-25, 6.5); ctx.closePath(); ctx.fill();
        }

        ctx.fillStyle = this.paintColor || '#ef4444';
        ctx.beginPath();
        ctx.moveTo(-10, -14); ctx.lineTo(-24, -24); ctx.lineTo(-18, -8); ctx.closePath();
        ctx.moveTo(-10, 14);  ctx.lineTo(-24, 24);  ctx.lineTo(-18, 8);  ctx.closePath();
        ctx.fill();

        ctx.fillStyle = this.paintColor || '#f8fafc';
        ctx.strokeStyle = this.paintColor ? '#fde047' : '#38bdf8';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(2, 0, 25, 14, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(17, 0, 10, -Math.PI / 2.2, Math.PI / 2.2);
        ctx.fill();

        const skin = getPlayerSkinSprite();
        ctx.fillStyle = '#0ea5e9';
        ctx.strokeStyle = skin.bodyColor || '#fde047';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(3, 0, 9.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        if (skin.idle && skin.idle.complete && skin.idle.naturalWidth > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(3, 0, 8.2, 0, Math.PI * 2);
            ctx.clip();
            ctx.rotate(Math.PI / 2);
            ctx.drawImage(skin.idle, -9, -11, 18, 18);
            ctx.restore();
        } else {
            ctx.fillStyle = skin.bodyColor || '#cbd5e1';
            ctx.beginPath();
            ctx.arc(3, 1, 5, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
        if (this.paintTimer > 0) {
            ctx.font = '900 12px "Nunito", sans-serif'; ctx.textAlign = 'center';
            ctx.fillStyle = this.paintColor || '#f472b6';
            ctx.fillText('Догоняй! 😜', 0, -28);
        }
        ctx.restore();
    }
}
