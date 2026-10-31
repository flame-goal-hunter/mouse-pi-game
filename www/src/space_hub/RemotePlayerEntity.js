// ============================================================================
// RemotePlayerEntity.js — Плавная интерполяция на 60 FPS (Dead Reckoning + Lerp),
// кратчайшая дуга поворота, локальный генератор частиц выхлопа, сопло и Турбо-пламя (до 180 строк)
// ============================================================================

import { SPACE_CONFIG } from './SpaceConfig.js';
import { getPlayerSkinSprite } from '../core/PlayerProfile.js';

export class RemotePlayerEntity {
    constructor(pkt = {}) {
        Object.assign(this, {
            playerId: pkt.playerId || '', targetX: pkt.x || 0, targetY: pkt.y || 0, targetVx: pkt.vx || 0, targetVy: pkt.vy || 0,
            targetAngle: pkt.angle || 0, renderX: pkt.x || 0, renderY: pkt.y || 0, renderAngle: pkt.angle || 0,
            rx: pkt.x || 0, ry: pkt.y || 0, rAngle: pkt.angle || 0, rHomeAngle: pkt.homeAngle || 0,
            isThrusting: false, isTurbo: false, trailStyle: 'stars', paintColor: null, paintTimer: 0, paintUntil: 0, flipStart: 0,
            particles: [], exhaustAccum: 0, lastPktTs: 0, lastSeen: Date.now()
        });
        this.applyPacket(pkt);
    }

    applyPacket(pkt) {
        if (this.lastPktTs && pkt.ts && pkt.ts < this.lastPktTs) return;
        this.lastPktTs = pkt.ts || this.lastPktTs;
        this.lastSeen = Date.now();
        this.nickname = pkt.nickname || this.nickname || 'Пи';
        this.skinId = pkt.skinId || pkt.equippedSkinId || this.skinId || 'blue';
        this.equippedSkinId = this.skinId;
        this.currentLocation = pkt.currentLocation || this.currentLocation || 'space';
        this.homeSnapshot = pkt.homeSnapshot || this.homeSnapshot;
        this.homeAngle = pkt.homeAngle ?? this.homeAngle ?? 0;
        this.facing = pkt.facing || this.facing || 1;
        this.moving = Boolean(pkt.moving);

        this.targetX = Number(pkt.x) || 0; this.targetY = Number(pkt.y) || 0;
        this.targetVx = Number(pkt.vx) || 0; this.targetVy = Number(pkt.vy) || 0;
        this.targetAngle = Number(pkt.angle) || 0;
        this.isThrusting = Boolean(pkt.isThrusting);
        this.isTurbo = Boolean(pkt.isTurbo);
        this.trailStyle = pkt.trailStyle || 'stars';

        if (pkt.paintTimer > 0 && pkt.paintColor) {
            if (this.paintTimer <= 0) this.flipStart = performance.now();
            this.paintColor = pkt.paintColor; this.paintTimer = pkt.paintTimer;
        }
        if (Math.hypot(this.targetX - this.renderX, this.targetY - this.renderY) > 600) {
            this.renderX = this.targetX; this.renderY = this.targetY; this.renderAngle = this.targetAngle;
        }
    }

    update(dt) {
        if (Date.now() - this.lastSeen < 450) {
            this.targetX += this.targetVx * dt; this.targetY += this.targetVy * dt;
        } else {
            const drag = Math.pow(0.92, dt * 60);
            this.targetVx *= drag; this.targetVy *= drag;
        }

        const lerpFactor = 1 - Math.exp(-12 * dt);
        this.renderX += (this.targetX - this.renderX) * lerpFactor;
        this.renderY += (this.targetY - this.renderY) * lerpFactor;

        const diff = Math.atan2(Math.sin(this.targetAngle - this.renderAngle), Math.cos(this.targetAngle - this.renderAngle));
        this.renderAngle += diff * (1 - Math.exp(-14 * dt));
        this.rHomeAngle += ((this.homeAngle || 0) - this.rHomeAngle) * lerpFactor;

        this.rx = this.renderX; this.ry = this.renderY; this.rAngle = this.renderAngle;
        this.x = this.targetX; this.y = this.targetY;

        if (this.paintUntil && Date.now() < this.paintUntil) this.paintTimer = Math.max(this.paintTimer, (this.paintUntil - Date.now()) / 1000);
        if (this.paintTimer > 0 && (this.paintTimer = Math.max(0, this.paintTimer - dt)) === 0) this.paintColor = null;

        const speed = Math.hypot(this.targetVx, this.targetVy);
        if (this.currentLocation === 'space' && (this.isThrusting || this.isTurbo || speed > 45)) {
            const rate = SPACE_CONFIG.rocket.exhaustRateMs;
            this.exhaustAccum += dt * 1000 * (this.isTurbo ? 2.4 : 1.1);
            while (this.exhaustAccum >= rate) { this.exhaustAccum -= rate; this._spawnParticle(); }
        }

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx * dt; p.y += p.vy * dt; p.rot += 3.5 * dt;
            if ((p.life -= p.decay * dt) <= 0) this.particles.splice(i, 1);
        }
    }

    _spawnParticle() {
        const colors = this.isTurbo ? ['#38bdf8', '#fde047', '#f472b6', '#2dd4bf'] : SPACE_CONFIG.rocket.exhaustColors;
        const bx = this.renderX - Math.cos(this.renderAngle) * 26, by = this.renderY - Math.sin(this.renderAngle) * 26;
        const spread = (Math.random() - 0.5) * (this.isTurbo ? 0.55 : 0.75);
        const spd = (this.isTurbo ? 195 : 105) + Math.random() * 65;
        this.particles.push({
            x: bx + (Math.random() - 0.5) * 7, y: by + (Math.random() - 0.5) * 7,
            vx: -Math.cos(this.renderAngle + spread) * spd, vy: -Math.sin(this.renderAngle + spread) * spd,
            size: (this.isTurbo ? 9.5 : 6.8) + Math.random() * 4,
            life: 1, decay: 1.55 + Math.random() * 0.85, rot: Math.random() * Math.PI * 2,
            bubble: this.paintTimer > 0,
            color: this.paintColor || colors[Math.floor(Math.random() * colors.length)]
        });
    }

    draw(ctx, timeSec) {
        for (const p of this.particles) {
            ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
            ctx.globalAlpha = Math.max(0, p.life);
            const r = p.size * p.life;
            ctx.beginPath();
            if (p.bubble) {
                ctx.strokeStyle = p.color; ctx.lineWidth = 2; ctx.arc(0, 0, r * 1.1, 0, Math.PI * 2); ctx.stroke();
            } else {
                ctx.fillStyle = p.color;
                for (let i = 0; i < 10; i++) {
                    const rad = i % 2 === 0 ? r : r * 0.44, a = (i * Math.PI) / 5;
                    if (i === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad); else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
                }
                ctx.closePath(); ctx.fill();
            }
            ctx.restore();
        }

        const skin = getPlayerSkinSprite(this.skinId);
        const pCol = this.paintTimer > 0 ? this.paintColor : null;
        const flipAge = this.flipStart ? (performance.now() - this.flipStart) / 650 : 1;
        const spin = flipAge < 1 ? flipAge * Math.PI * 2 : 0;

        ctx.save();
        ctx.translate(this.renderX, this.renderY);
        ctx.save();
        ctx.rotate(this.renderAngle + spin);

        // Реактивное сопло (труба) и живое пламя двигателя / Турбо-шлейф
        const vib = this.isTurbo ? (Math.random() - 0.5) * 2.2 : 0;
        ctx.fillStyle = '#334155'; ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.roundRect(-27, -6 + vib, 8, 12, 3); ctx.fill(); ctx.stroke();

        if (this.isThrusting || this.isTurbo || Math.hypot(this.targetVx, this.targetVy) > 45) {
            const flLen = (this.isTurbo ? 38 : 20) + Math.sin(timeSec * 36) * (this.isTurbo ? 9 : 5);
            const fg = ctx.createLinearGradient(-25, 0, -25 - flLen, 0);
            fg.addColorStop(0, '#ffffff');
            fg.addColorStop(0.35, this.isTurbo ? '#38bdf8' : '#fde047');
            fg.addColorStop(0.75, this.isTurbo ? '#f472b6' : '#fb923c');
            fg.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = fg;
            ctx.beginPath(); ctx.moveTo(-25, -6.5); ctx.lineTo(-25 - flLen, vib); ctx.lineTo(-25, 6.5); ctx.closePath(); ctx.fill();
        }

        // Корпус, плавники, нос и иллюминатор со скином мышонка (1-в-1 как у локальной ракеты)
        ctx.fillStyle = pCol || '#ef4444';
        ctx.beginPath();
        ctx.moveTo(-10, -14); ctx.lineTo(-24, -24); ctx.lineTo(-18, -8); ctx.closePath();
        ctx.moveTo(-10, 14);  ctx.lineTo(-24, 24);  ctx.lineTo(-18, 8);  ctx.closePath(); ctx.fill();
        ctx.fillStyle = pCol || '#f8fafc'; ctx.strokeStyle = pCol ? '#fde047' : (skin.bodyColor || '#38bdf8'); ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(2, 0, 25, 14, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(17, 0, 10, -Math.PI / 2.2, Math.PI / 2.2); ctx.fill();
        ctx.fillStyle = '#0ea5e9'; ctx.strokeStyle = skin.bodyColor || '#fde047'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(3, 0, 9.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (skin.idle && skin.idle.complete && skin.idle.naturalWidth > 0) {
            ctx.save(); ctx.beginPath(); ctx.arc(3, 0, 8.2, 0, Math.PI * 2); ctx.clip();
            ctx.rotate(Math.PI / 2); ctx.drawImage(skin.idle, -9, -11, 18, 18); ctx.restore();
        }
        ctx.restore();

        ctx.font = '900 12px "Nunito", sans-serif'; ctx.textAlign = 'center';
        if (pCol) { ctx.fillStyle = pCol; ctx.fillText('Догоняй! 😜', 0, -42); }
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        const w = Math.max(48, ctx.measureText(this.nickname).width + 14);
        ctx.beginPath(); ctx.roundRect(-w / 2, -36, w, 18, 9); ctx.fill();
        ctx.fillStyle = '#fef08a'; ctx.fillText(this.nickname, 0, -23);
        ctx.restore();
    }
}
