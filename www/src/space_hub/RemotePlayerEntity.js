// ============================================================================
// RemotePlayerEntity.js — Единый рендерер ракеты (drawSharedRocket) + плавная
// интерполяция на 60 FPS (SnapshotInterpolation + Lerp), пламя, Турбо, пузыри и гудок
// ============================================================================

import { SPACE_CONFIG } from './SpaceConfig.js';
import { getPlayerSkinSprite } from '../core/PlayerProfile.js';

export function drawSharedRocket(ctx, r, timeSec) {
    for (const p of r.particles) {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, p.life);
        const rad = p.size * p.life;
        ctx.beginPath();
        if (p.bubble) {
            ctx.strokeStyle = p.color; ctx.lineWidth = 2; ctx.arc(0, 0, rad * 1.1, 0, Math.PI * 2); ctx.stroke();
        } else {
            ctx.fillStyle = p.color;
            for (let i = 0; i < 10; i++) {
                const d = i % 2 === 0 ? rad : rad * 0.44, a = (i * Math.PI) / 5;
                if (i === 0) ctx.moveTo(Math.cos(a) * d, Math.sin(a) * d); else ctx.lineTo(Math.cos(a) * d, Math.sin(a) * d);
            }
            ctx.closePath(); ctx.fill();
        }
        ctx.restore();
    }

    const skin = getPlayerSkinSprite(r.skinId);
    const pCol = r.paintTimer > 0 ? r.paintColor : null;
    const sc = 1 + (r.hopScale || 0);
    const spin = r.spinTimer > 0 ? (1 - r.spinTimer) * Math.PI * 2 : 0;

    ctx.save();
    ctx.translate(r.x, r.y);
    if (r.waveTimer > 0) {
        const prog = 1 - r.waveTimer / 0.55;
        ctx.save();
        ctx.strokeStyle = `rgba(56, 189, 248, ${(1 - prog) * 0.85})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, 22 + prog * 48, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
    }
    ctx.scale(sc, sc);
    ctx.save();
    ctx.rotate(r.angle + spin);

    if (r.isTurbo) {
        ctx.save();
        ctx.shadowColor = '#38bdf8'; ctx.shadowBlur = 18;
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.ellipse(2, 0, 29, 18, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
    }

    const vib = r.isTurbo ? (Math.random() - 0.5) * 2.2 : 0;
    ctx.fillStyle = '#334155'; ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.roundRect(-27, -6 + vib, 8, 12, 3); ctx.fill(); ctx.stroke();

    if (r.isThrusting || r.isTurbo || r.speed > 45) {
        const flLen = (r.isTurbo ? 42 : 22) + Math.sin(timeSec * 36) * (r.isTurbo ? 10 : 5);
        const fg = ctx.createLinearGradient(-25, 0, -25 - flLen, 0);
        fg.addColorStop(0, '#ffffff');
        fg.addColorStop(0.35, r.isTurbo ? '#38bdf8' : '#fde047');
        fg.addColorStop(0.75, r.isTurbo ? '#f472b6' : '#fb923c');
        fg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = fg;
        ctx.beginPath(); ctx.moveTo(-25, -7); ctx.lineTo(-25 - flLen, vib); ctx.lineTo(-25, 7); ctx.closePath(); ctx.fill();
    }

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
    if (r.activeEmoji) { ctx.font = '22px "Nunito", sans-serif'; ctx.fillText(r.activeEmoji, 0, -48); ctx.font = '900 12px "Nunito", sans-serif'; }
    if (pCol) { ctx.fillStyle = pCol; ctx.fillText('Догоняй! 😜', 0, r.nickname ? -40 : -28); }
    if (r.nickname) {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        const w = Math.max(48, ctx.measureText(r.nickname).width + 14);
        ctx.beginPath(); ctx.roundRect(-w / 2, -36, w, 18, 9); ctx.fill();
        ctx.fillStyle = '#fef08a'; ctx.fillText(r.nickname, 0, -23);
    }
    ctx.restore();
}

export class RemotePlayerEntity {
    constructor(pkt = {}) {
        Object.assign(this, {
            playerId: pkt.playerId || '', targetX: pkt.x || 0, targetY: pkt.y || 0, targetVx: pkt.vx || 0, targetVy: pkt.vy || 0,
            targetAngle: pkt.angle || 0, renderX: pkt.x || 0, renderY: pkt.y || 0, renderAngle: pkt.angle || 0,
            rx: pkt.x || 0, ry: pkt.y || 0, rAngle: pkt.angle || 0, rHomeAngle: pkt.homeAngle || 0,
            isThrusting: false, isTurbo: false, paintColor: null, paintTimer: 0, spinTimer: 0, hopScale: 0, waveTimer: 0, activeEmoji: null, emojiTimer: 0,
            particles: [], exhaustAccum: 0, lastPktTs: 0, lastSeen: Date.now()
        });
        this.applyPacket(pkt);
    }

    triggerHorn(emoji = '😜') { Object.assign(this, { hopScale: 0.32, waveTimer: 0.55, activeEmoji: emoji, emojiTimer: 1.2 }); }

    applyPacket(pkt) {
        if (this.lastPktTs && pkt.ts && pkt.ts < this.lastPktTs) return;
        Object.assign(this, {
            lastPktTs: pkt.ts || this.lastPktTs, lastSeen: Date.now(),
            nickname: pkt.nickname || this.nickname || 'Пи',
            skinId: pkt.skinId || pkt.equippedSkinId || this.skinId || 'blue',
            equippedSkinId: pkt.skinId || pkt.equippedSkinId || this.skinId || 'blue',
            currentLocation: pkt.currentLocation || this.currentLocation || 'space',
            homeSnapshot: pkt.homeSnapshot || this.homeSnapshot,
            homeAngle: pkt.homeAngle ?? this.homeAngle ?? 0, facing: pkt.facing || this.facing || 1, moving: Boolean(pkt.moving),
            targetX: Number(pkt.x) || 0, targetY: Number(pkt.y) || 0, targetVx: Number(pkt.vx) || 0, targetVy: Number(pkt.vy) || 0,
            targetAngle: Number(pkt.angle) || 0, isThrusting: Boolean(pkt.isThrusting), isTurbo: Boolean(pkt.isTurbo)
        });
        if (pkt.paintTimer > 0 && pkt.paintColor) {
            if (this.paintTimer <= 0) this.spinTimer = 1.0;
            this.paintColor = pkt.paintColor; this.paintTimer = pkt.paintTimer;
        }
        if (pkt.spinTimer > this.spinTimer) this.spinTimer = pkt.spinTimer;
        if (pkt.activeEmoji) { this.activeEmoji = pkt.activeEmoji; this.emojiTimer = Math.max(this.emojiTimer, 0.5); }
        if (Math.hypot(this.targetX - this.renderX, this.targetY - this.renderY) > 600) {
            this.renderX = this.targetX; this.renderY = this.targetY; this.renderAngle = this.targetAngle;
        }
    }

    update(dt, interp = null) {
        if (interp) {
            this.targetX = interp.x; this.targetY = interp.y;
            this.targetVx = interp.vx || 0; this.targetVy = interp.vy || 0;
            this.targetAngle = interp.angle || 0;
            this.isThrusting = Boolean(interp.isThrusting); this.isTurbo = Boolean(interp.isTurbo);
        } else if (Date.now() - this.lastSeen < 450) {
            this.targetX += this.targetVx * dt; this.targetY += this.targetVy * dt;
        }
        const k = 1 - Math.exp(-16 * dt);
        this.renderX += (this.targetX - this.renderX) * k; this.renderY += (this.targetY - this.renderY) * k;
        const da = Math.atan2(Math.sin(this.targetAngle - this.renderAngle), Math.cos(this.targetAngle - this.renderAngle));
        this.renderAngle += da * (1 - Math.exp(-18 * dt));
        this.rHomeAngle += ((this.homeAngle || 0) - this.rHomeAngle) * k;
        this.rx = this.x = this.renderX; this.ry = this.y = this.renderY; this.rAngle = this.renderAngle;

        if (this.paintTimer > 0 && (this.paintTimer = Math.max(0, this.paintTimer - dt)) === 0) this.paintColor = null;
        if (this.spinTimer > 0) this.spinTimer = Math.max(0, this.spinTimer - dt * 1.5);
        if (this.hopScale > 0) this.hopScale = Math.max(0, this.hopScale - dt * 2.2);
        if (this.waveTimer > 0) this.waveTimer = Math.max(0, this.waveTimer - dt);
        if (this.emojiTimer > 0 && (this.emojiTimer = Math.max(0, this.emojiTimer - dt)) === 0) this.activeEmoji = null;

        const speed = Math.hypot(this.targetVx, this.targetVy);
        if (this.currentLocation === 'space' && (this.isThrusting || this.isTurbo || speed > 45)) {
            const rate = SPACE_CONFIG.rocket.exhaustRateMs;
            this.exhaustAccum += dt * 1000 * (this.isTurbo ? 2.5 : 1.15);
            while (this.exhaustAccum >= rate) { this.exhaustAccum -= rate; this._spawnParticle(); }
        }
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += 3.5 * dt;
            if ((p.life -= p.decay * dt) <= 0) this.particles.splice(i, 1);
        }
    }

    _spawnParticle() {
        const colors = this.isTurbo ? ['#38bdf8', '#fde047', '#f472b6', '#2dd4bf', '#a855f7'] : SPACE_CONFIG.rocket.exhaustColors;
        const bx = this.renderX - Math.cos(this.renderAngle) * 26, by = this.renderY - Math.sin(this.renderAngle) * 26;
        const spread = (Math.random() - 0.5) * (this.isTurbo ? 0.55 : 0.75), spd = (this.isTurbo ? 195 : 105) + Math.random() * 65;
        this.particles.push({
            x: bx + (Math.random() - 0.5) * 7, y: by + (Math.random() - 0.5) * 7,
            vx: -Math.cos(this.renderAngle + spread) * spd, vy: -Math.sin(this.renderAngle + spread) * spd,
            size: (this.isTurbo ? 9.5 : 6.8) + Math.random() * 4, life: 1, decay: 1.5 + Math.random() * 0.85,
            rot: Math.random() * Math.PI * 2, bubble: this.paintTimer > 0,
            color: this.paintColor || colors[Math.floor(Math.random() * colors.length)]
        });
    }

    draw(ctx, timeSec) {
        drawSharedRocket(ctx, {
            x: this.renderX, y: this.renderY, angle: this.renderAngle, skinId: this.skinId, nickname: this.nickname,
            isThrusting: this.isThrusting, isTurbo: this.isTurbo, speed: Math.hypot(this.targetVx, this.targetVy),
            paintColor: this.paintColor, paintTimer: this.paintTimer, spinTimer: this.spinTimer,
            hopScale: this.hopScale, waveTimer: this.waveTimer, activeEmoji: this.activeEmoji, particles: this.particles
        }, timeSec);
    }
}
