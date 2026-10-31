// ============================================================================
// RocketController.js — Свободный аркадный полёт ракеты Мышонка Пи,
// единый рендерер ракеты (drawSharedRocket), server_impulse, пламя, Турбо и камера
// ============================================================================

import { SPACE_CONFIG } from './SpaceConfig.js';
import { PlayerProfile } from '../core/PlayerProfile.js';
import { drawSharedRocket } from './RemotePlayerEntity.js';

export class RocketController {
    constructor() {
        const cfg = SPACE_CONFIG.rocket;
        Object.assign(this, {
            x: cfg.startX, y: cfg.startY, vx: 0, vy: 0, angle: cfg.startAngle,
            camX: cfg.startX, camY: cfg.startY, camZoom: 1,
            particles: [], exhaustAccum: 0, zoomTargetPlanet: null, zoomElapsedMs: 0,
            paintColor: null, paintTimer: 0, flipTimer: 0, spinTimer: 0,
            hopScale: 0, waveTimer: 0, activeEmoji: null, emojiTimer: 0,
            isThrusting: false, isTurbo: false, trailStyle: 'stars'
        });
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

    applyServerImpulse(imp) {
        if (!imp || this.zoomTargetPlanet) return;
        if (typeof imp.x === 'number') this.x = imp.x;
        if (typeof imp.y === 'number') this.y = imp.y;
        if (typeof imp.vx === 'number') this.vx = imp.vx;
        if (typeof imp.vy === 'number') this.vy = imp.vy;
    }

    triggerHorn(emoji = '😜') {
        this.hopScale = 0.32;
        this.waveTimer = 0.55;
        this.activeEmoji = emoji;
        this.emojiTimer = 1.2;
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
            const diff = Math.atan2(Math.sin(targetAngle - this.angle), Math.cos(targetAngle - this.angle));
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
            this.exhaustAccum += dt * 1000 * (input.turboHeld ? 2.4 : 1.1);
            while (this.exhaustAccum >= cfg.exhaustRateMs) {
                this.exhaustAccum -= cfg.exhaustRateMs;
                this._spawnStarParticle(input.turboHeld);
            }
        }

        if (this.paintTimer > 0 && (this.paintTimer = Math.max(0, this.paintTimer - dt)) === 0) this.paintColor = null;
        if (this.flipTimer > 0) this.flipTimer = Math.max(0, this.flipTimer - dt);
        if (this.spinTimer > 0) this.spinTimer = Math.max(0, this.spinTimer - dt * 1.5);
        if (this.hopScale > 0) this.hopScale = Math.max(0, this.hopScale - dt * 2.2);
        if (this.waveTimer > 0) this.waveTimer = Math.max(0, this.waveTimer - dt);
        if (this.emojiTimer > 0 && (this.emojiTimer = Math.max(0, this.emojiTimer - dt)) === 0) this.activeEmoji = null;

        this._updateParticles(dt);
        const lerpF = Math.min(1, cfg.cameraLerp * dt);
        this.camX += (this.x - this.camX) * lerpF;
        this.camY += (this.y - this.camY) * lerpF;
        return false;
    }

    _spawnStarParticle(isTurbo) {
        const colors = isTurbo ? ['#38bdf8', '#fde047', '#f472b6', '#2dd4bf', '#a855f7'] : SPACE_CONFIG.rocket.exhaustColors;
        const backX = this.x - Math.cos(this.angle) * 26;
        const backY = this.y - Math.sin(this.angle) * 26;
        const spread = (Math.random() - 0.5) * (isTurbo ? 0.55 : 0.75);
        const spd = (isTurbo ? 195 : 105) + Math.random() * 65;
        this.particles.push({
            x: backX + (Math.random() - 0.5) * 7,
            y: backY + (Math.random() - 0.5) * 7,
            vx: -Math.cos(this.angle + spread) * spd,
            vy: -Math.sin(this.angle + spread) * spd,
            size: (isTurbo ? 9.5 : 6.8) + Math.random() * 4,
            life: 1,
            decay: 1.5 + Math.random() * 0.85,
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

    draw(ctx, timeSec = performance.now() / 1000) {
        drawSharedRocket(ctx, {
            x: this.x, y: this.y, angle: this.angle, skinId: PlayerProfile.equippedSkinId, nickname: null,
            isThrusting: this.isThrusting, isTurbo: this.isTurbo, speed: Math.hypot(this.vx, this.vy),
            paintColor: this.paintColor, paintTimer: this.paintTimer,
            spinTimer: Math.max(this.spinTimer, this.flipTimer > 0 ? this.flipTimer / 0.65 : 0),
            hopScale: this.hopScale, waveTimer: this.waveTimer, activeEmoji: this.activeEmoji, particles: this.particles
        }, timeSec);
    }
}
