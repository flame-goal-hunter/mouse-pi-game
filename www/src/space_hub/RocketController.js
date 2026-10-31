// ============================================================================
// RocketController.js — Контроллер своей ракеты поверх единого ядра SpaceWorldCore
// Физика (тяга, инерция, столкновения) считается в SpaceWorldCore.stepWorld (50 Hz)
// ============================================================================

import { SPACE_CONFIG } from './SpaceConfig.js';
import { PlayerProfile } from '../core/PlayerProfile.js';
import { drawSharedRocket } from './RemotePlayerEntity.js';
import { SpaceNetwork } from './SpaceNetwork.js';

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

    get body() { return SpaceNetwork.worldSync?.myBody; }

    setPosition(x, y, vx = 0, vy = -90, angle = -Math.PI / 2) {
        this.x = this.camX = x;
        this.y = this.camY = y;
        this.vx = vx; this.vy = vy; this.angle = angle;
        const b = this.body;
        if (b) {
            b.x = b.prevX = b.renderX = x;
            b.y = b.prevY = b.renderY = y;
            b.vx = vx; b.vy = vy;
            b.angle = b.prevAngle = b.renderAngle = angle;
            b.errorX = 0; b.errorY = 0; b.errorAngle = 0;
        }
    }

    startPlanetZoom(planet) {
        this.zoomTargetPlanet = planet;
        this.zoomElapsedMs = 0;
        this.vx = 0; this.vy = 0;
        if (this.body) { this.body.vx = 0; this.body.vy = 0; this.body.docking = true; }
    }

    bounceOff(nx, ny, minBounce = 270) {
        const b = this.body || this;
        const dot = b.vx * nx + b.vy * ny;
        b.vx = (b.vx - 2 * dot * nx) * 0.85 + nx * minBounce;
        b.vy = (b.vy - 2 * dot * ny) * 0.85 + ny * minBounce;
        this.vx = b.vx; this.vy = b.vy;
    }

    applyServerImpulse(imp) {
        if (!imp || this.zoomTargetPlanet) return;
        const b = this.body;
        if (b) {
            if (typeof imp.vx === 'number') b.vx = imp.vx;
            if (typeof imp.vy === 'number') b.vy = imp.vy;
            this.vx = b.vx; this.vy = b.vy;
        }
    }

    triggerHorn(emoji = '😜') {
        this.hopScale = 0.32;
        this.waveTimer = 0.55;
        this.activeEmoji = emoji;
        this.emojiTimer = 1.2;
    }

    update(dt, input) {
        const cfg = SPACE_CONFIG.rocket;
        const b = this.body;
        if (this.zoomTargetPlanet) {
            this.zoomElapsedMs += dt * 1000;
            const t = Math.min(1, this.zoomElapsedMs / cfg.zoomDurationMs);
            const ease = 1 - Math.pow(1 - t, 3);
            this.camX += (this.zoomTargetPlanet.x - this.camX) * Math.min(1, dt * 12);
            this.camY += (this.zoomTargetPlanet.y - this.camY) * Math.min(1, dt * 12);
            this.camZoom = 1 + (cfg.zoomTargetScale - 1) * ease;
            this.x += (this.zoomTargetPlanet.x - this.x) * Math.min(1, dt * 8);
            this.y += (this.zoomTargetPlanet.y - this.y) * Math.min(1, dt * 8);
            if (b) { b.x = b.prevX = b.renderX = this.x; b.y = b.prevY = b.renderY = this.y; b.docking = true; }
            this._updateParticles(dt);
            return t >= 1;
        }

        if (b) {
            b.docking = false;
            b.playerId = PlayerProfile.playerId;
            b.sessionId = SpaceNetwork._mySid?.() || '';
            b.inputX = Number(input.moveX) || 0;
            b.inputY = Number(input.moveY) || 0;
            b.isTurbo = Boolean(input.turboHeld);
            this.isThrusting = Math.hypot(b.inputX, b.inputY) > 0.01;
            this.isTurbo = b.isTurbo;
        }
        return false;
    }

    syncAfterPhysics(dt) {
        const cfg = SPACE_CONFIG.rocket;
        const b = this.body;
        if (b && !this.zoomTargetPlanet) {
            this.x = b.renderX;
            this.y = b.renderY;
            this.vx = b.vx;
            this.vy = b.vy;
            this.angle = b.renderAngle;
        }
        const speed = Math.hypot(this.vx, this.vy);
        if (this.isThrusting || this.isTurbo || speed > 55) {
            this.exhaustAccum += dt * 1000 * (this.isTurbo ? 2.4 : 1.1);
            while (this.exhaustAccum >= cfg.exhaustRateMs) {
                this.exhaustAccum -= cfg.exhaustRateMs;
                this._spawnStarParticle(this.isTurbo);
            }
        }
        if (this.paintTimer > 0 && (this.paintTimer = Math.max(0, this.paintTimer - dt)) === 0) this.paintColor = null;
        if (this.flipTimer > 0) this.flipTimer = Math.max(0, this.flipTimer - dt);
        if (this.spinTimer > 0) this.spinTimer = Math.max(0, this.spinTimer - dt * 1.5);
        if (this.hopScale > 0) this.hopScale = Math.max(0, this.hopScale - dt * 2.2);
        if (this.waveTimer > 0) this.waveTimer = Math.max(0, this.waveTimer - dt);
        if (this.emojiTimer > 0 && (this.emojiTimer = Math.max(0, this.emojiTimer - dt)) === 0) this.activeEmoji = null;

        this._updateParticles(dt);
        if (!this.zoomTargetPlanet) {
            const lerpF = Math.min(1, cfg.cameraLerp * dt);
            this.camX += (this.x - this.camX) * lerpF;
            this.camY += (this.y - this.camY) * lerpF;
        }
    }

    _spawnStarParticle(isTurbo) {
        const colors = isTurbo ? ['#38bdf8', '#fde047', '#f472b6', '#2dd4bf', '#a855f7'] : SPACE_CONFIG.rocket.exhaustColors;
        const backX = this.x - Math.cos(this.angle) * 26, backY = this.y - Math.sin(this.angle) * 26;
        const spread = (Math.random() - 0.5) * (isTurbo ? 0.55 : 0.75);
        const spd = (isTurbo ? 195 : 105) + Math.random() * 65;
        this.particles.push({
            x: backX + (Math.random() - 0.5) * 7, y: backY + (Math.random() - 0.5) * 7,
            vx: -Math.cos(this.angle + spread) * spd, vy: -Math.sin(this.angle + spread) * spd,
            size: (isTurbo ? 9.5 : 6.8) + Math.random() * 4, life: 1, decay: 1.5 + Math.random() * 0.85,
            rot: Math.random() * Math.PI * 2, bubble: this.paintTimer > 0,
            color: this.paintColor || colors[Math.floor(Math.random() * colors.length)]
        });
    }

    _updateParticles(dt) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx * dt; p.y += p.vy * dt; p.rot += 3.5 * dt;
            if ((p.life -= p.decay * dt) <= 0) this.particles.splice(i, 1);
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
