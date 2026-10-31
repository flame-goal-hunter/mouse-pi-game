// ============================================================================
// SpaceFun.js — Космический Футбол с воротами и табло, Сырный Краскомёт (салки)
// и упругие бампер-столкновения ракет (синхронизация с авторитетным сервером)
// ============================================================================

import { SpaceNetwork } from './SpaceNetwork.js';
import { PlayerProfile } from '../core/PlayerProfile.js';
import { SpaceAudio } from '../core/SpaceAudio.js';

const FIELD = { cx: 0, cy: 110, hw: 295, hh: 175, goalH: 72, ballR: 32 };
const PAINT_COLORS = ['#f472b6', '#a3e635', '#38bdf8', '#facc15', '#c084fc', '#fb923c'];
const EMOJIS = ['😜', '🧀', '❤️', '😂'];

export class SpaceFun {
    constructor(rocket, env) {
        Object.assign(this, {
            rocket, env, ball: { x: FIELD.cx, y: FIELD.cy, vx: 0, vy: 0, r: FIELD.ballR, angle: 0 },
            score: { blue: 0, pink: 0 }, goalBannerTimer: 0, shots: [], fx: [], Emotes: [],
            shakeTime: 0, lastKickAt: 0, lastBumpAt: 0
        });
        SpaceNetwork.onFunEvent = (ev) => this._onNetEvent(ev);
        SpaceNetwork.onFxEvent = (ev) => this._onServerFx(ev);
        SpaceNetwork.onServerImpulse = (imp) => {
            this.rocket.applyServerImpulse(imp);
            this.shakeTime = 0.22;
            SpaceAudio.playBumperBounce();
        };
    }

    firePaint() {
        const r = this.rocket, color = PAINT_COLORS[Math.floor(Math.random() * PAINT_COLORS.length)], emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
        r.triggerHorn(emoji);
        SpaceAudio.playHorn();
        SpaceAudio.playPaintShoot();
        const sx = r.x + Math.cos(r.angle) * 30, sy = r.y + Math.sin(r.angle) * 30;
        const shot = { ownerId: PlayerProfile.playerId, x: Math.round(sx), y: Math.round(sy), vx: Math.round(r.vx * 0.35 + Math.cos(r.angle) * 690), vy: Math.round(r.vy * 0.35 + Math.sin(r.angle) * 690), color, emoji, life: 1.35 };
        if (!SpaceNetwork.connected) this._spawnShot(shot);
        SpaceNetwork.shootPaint(shot);
    }

    _spawnShot(s) {
        this.shots.push({ ...s, life: 1.35 });
        this.Emotes.push({ x: s.rx ?? s.x, y: (s.ry ?? s.y) - 34, text: s.emoji || '😜', life: 1.2 });
    }

    _spawnSplat(x, y, color, count = 16, isConfetti = false, baseR = 8) {
        for (let i = 0; i < count; i++) {
            const a = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.35, spd = (isConfetti ? 240 : 140) + Math.random() * 160;
            this.fx.push({ x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, r: (isConfetti ? 6 : baseR) + Math.random() * (baseR * 0.6), life: 1, color: isConfetti ? PAINT_COLORS[i % PAINT_COLORS.length] : color });
        }
    }

    _applyPaintToRocket(targetId, color, x, y) {
        this._spawnSplat(x, y, color, 20, false); SpaceAudio.playPaintSplat();
        if (targetId === PlayerProfile.playerId) Object.assign(this.rocket, { paintColor: color, paintTimer: 6.0, spinTimer: 1.0, flipTimer: 0.65 });
        else { const peer = SpaceNetwork.peers.get(targetId); if (peer) Object.assign(peer, { paintColor: color, paintTimer: 6.0, spinTimer: 1.0 }); }
    }

    _onServerFx(ev) {
        if (!ev?.type) return;
        if (ev.type === 'paint_splat') {
            if (ev.targetId) this._applyPaintToRocket(ev.targetId, ev.color || '#f472b6', ev.x, ev.y);
            else { this._spawnSplat(ev.x, ev.y, ev.color || '#f472b6', 14, false); SpaceAudio.playPaintSplat(); }
        } else if (ev.type === 'bumper_hit') {
            this._spawnSplat(ev.x, ev.y, '#fde047', 8, false, 3.5);
            this.shakeTime = Math.max(this.shakeTime, 0.14);
            SpaceAudio.playBumperBounce();
        } else if (ev.type === 'goal') {
            if (ev.score) this.score = ev.score;
            Object.assign(this.ball, { x: FIELD.cx, y: FIELD.cy, vx: 0, vy: 0 });
            this.goalBannerTimer = 2.6;
            this._spawnSplat(FIELD.cx, FIELD.cy, '#facc15', 36, true);
            SpaceAudio.playGoalFanfare();
        } else if (ev.type === 'cheese_picked') {
            this.env?.onServerCheesePicked(ev);
        } else if (ev.type === 'horn') {
            if (ev.playerId !== PlayerProfile.playerId) SpaceAudio.playHorn();
            this.Emotes.push({ x: ev.x || 0, y: (ev.y || 0) - 36, text: ev.emoji || '😜', life: 1.2 });
        }
    }

    _onNetEvent(ev) {
        if (!ev?.type) return;
        if (ev.type === 'ballKick') { Object.assign(this.ball, { x: ev.x, y: ev.y, vx: ev.vx, vy: ev.vy }); if (ev.score) this.score = ev.score; }
        else if (ev.type === 'goal') this._onServerFx({ type: 'goal', score: ev.score });
        else if (ev.type === 'paintShot') this._spawnShot(ev);
        else if (ev.type === 'paintHit') this._applyPaintToRocket(ev.targetId, ev.color, ev.x, ev.y);
        else if (ev.type === 'bumperHit' && ev.targetId === PlayerProfile.playerId) { this.rocket.bounceOff(ev.nx, ev.ny, 320); this.shakeTime = 0.22; SpaceAudio.playBumperBounce(); this._spawnSplat(this.rocket.x, this.rocket.y, '#fde047', 12, false); }
    }

    update(dt, turboHeld) {
        if (this.shakeTime > 0) this.shakeTime = Math.max(0, this.shakeTime - dt);
        if (this.goalBannerTimer > 0) this.goalBannerTimer = Math.max(0, this.goalBannerTimer - dt);
        const b = this.ball, r = this.rocket;
        const srvBall = SpaceNetwork.smoother?.smoothBall;
        if (SpaceNetwork.connected && srvBall) {
            if (srvBall.score) this.score = srvBall.score;
            b.x = srvBall.x;
            b.y = srvBall.y;
            b.rawX = srvBall.rawX ?? srvBall.x;
            b.rawY = srvBall.rawY ?? srvBall.y;
            b.vx = srvBall.vx;
            b.vy = srvBall.vy;
            b.angle = srvBall.angle;
        } else {
            b.x += b.vx * dt; b.y += b.vy * dt; b.angle += Math.hypot(b.vx, b.vy) * 0.012 * dt;
            const drag = Math.pow(0.985, dt * 60); b.vx *= drag; b.vy *= drag;
        }

        const dxB = b.x - r.x, dyB = b.y - r.y, distB = Math.hypot(dxB, dyB);
        if (distB < b.r + 26 && distB > 0.001 && performance.now() - this.lastKickAt > 110) {
            this.lastKickAt = performance.now();
            const nx = dxB / distB, ny = dyB / distB, boost = turboHeld ? 1.55 : 1.25;
            b.vx = r.vx * boost + nx * (turboHeld ? 360 : 230); b.vy = r.vy * boost + ny * (turboHeld ? 360 : 230);
            b.x = r.x + nx * (b.r + 28); b.y = r.y + ny * (b.r + 28); r.vx *= 0.7; r.vy *= 0.7;
            if (!SpaceNetwork.connected) { this._spawnSplat(b.x - nx * b.r, b.y - ny * b.r, '#fde047', 8, false, 3.5); SpaceAudio.playBumperBounce(); }
        }

        const minX = FIELD.cx - FIELD.hw, maxX = FIELD.cx + FIELD.hw, minY = FIELD.cy - FIELD.hh, maxY = FIELD.cy + FIELD.hh;
        if (b.y - b.r < minY) { b.y = minY + b.r; b.vy = Math.abs(b.vy) * 0.85; }
        if (b.y + b.r > maxY) { b.y = maxY - b.r; b.vy = -Math.abs(b.vy) * 0.85; }
        const inGoal = Math.abs(b.y - FIELD.cy) < FIELD.goalH;
        if (b.x - b.r < minX && !inGoal) { b.x = minX + b.r; b.vx = Math.abs(b.vx) * 0.85; }
        else if (b.x + b.r > maxX && !inGoal) { b.x = maxX - b.r; b.vx = -Math.abs(b.vx) * 0.85; }

        if (this.env?.asteroids) {
            const netProjs = SpaceNetwork.smoother?.smoothProjectiles || [];
            for (let i = netProjs.length - 1; i >= 0; i--) {
                const s = netProjs[i];
                const hitAst = this.env.asteroids.find(a => Math.hypot(s.x - a.x, s.y - a.y) < a.r + 8);
                if (hitAst) {
                    hitAst.hitFlash = 1;
                    try { SpaceNetwork.room?.send('hit_asteroid', { id: s.id, x: s.x, y: s.y }); } catch (_) {}
                    netProjs.splice(i, 1);
                }
            }
        }

        for (let i = this.shots.length - 1; i >= 0; i--) {
            const s = this.shots[i]; s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
            let hit = false;
            if (this.env?.asteroids) for (const a of this.env.asteroids) if (Math.hypot(s.x - a.x, s.y - a.y) < a.r + 8) {
                a.hitFlash = 1; this._spawnSplat(s.x, s.y, s.color, 12, false); SpaceAudio.playPaintSplat(); hit = true; break;
            }
            if (hit || s.life <= 0) this.shots.splice(i, 1);
        }
        for (let i = this.fx.length - 1; i >= 0; i--) { const f = this.fx[i]; f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.94; f.vy *= 0.94; if ((f.life -= dt * 1.45) <= 0) this.fx.splice(i, 1); }
        for (let i = this.Emotes.length - 1; i >= 0; i--) { const em = this.Emotes[i]; em.y -= 36 * dt; if ((em.life -= dt) <= 0) this.Emotes.splice(i, 1); }
    }

    drawWorld(ctx) {
        const { cx, cy, hw, hh, goalH } = FIELD;
        ctx.save();
        ctx.strokeStyle = 'rgba(125, 211, 252, 0.26)'; ctx.lineWidth = 3;
        ctx.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2);
        ctx.beginPath(); ctx.moveTo(cx, cy - hh); ctx.lineTo(cx, cy + hh); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, 52, 0, Math.PI * 2); ctx.stroke();

        this._drawGoal(ctx, cx - hw, cy, -34, goalH, '#38bdf8', 'rgba(56,189,248,0.22)');
        this._drawGoal(ctx, cx + hw, cy, 34, goalH, '#f472b6', 'rgba(244,114,182,0.22)');

        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)'; ctx.strokeStyle = '#facc15'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.roundRect(cx - 88, cy - hh - 42, 176, 32, 16); ctx.fill(); ctx.stroke();
        ctx.font = '900 16px "Nunito", sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fef08a';
        ctx.fillText(`⚽ ${this.score.blue}  :  ${this.score.pink} ⚽`, cx, cy - hh - 20);

        const b = this.ball;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.angle);
        for (let i = 0; i < 6; i++) {
            ctx.fillStyle = PAINT_COLORS[i]; ctx.beginPath(); ctx.moveTo(0, 0);
            ctx.arc(0, 0, b.r, (i * Math.PI) / 3, ((i + 1) * Math.PI) / 3); ctx.closePath(); ctx.fill();
        }
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, b.r, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#fef08a'; ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
        ctx.restore();

        const netProjectiles = SpaceNetwork.smoother?.smoothProjectiles || [];
        const allShots = netProjectiles.length ? netProjectiles : this.shots;
        for (const s of allShots) { ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(s.x, s.y, 10, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
        for (const f of this.fx) { ctx.globalAlpha = Math.max(0, f.life); ctx.fillStyle = f.color; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * f.life, 0, Math.PI * 2); ctx.fill(); }
        ctx.globalAlpha = 1;
        for (const em of this.Emotes) { ctx.globalAlpha = Math.min(1, em.life); ctx.font = '24px "Nunito", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(em.text, em.x, em.y); }
        ctx.restore();
    }

    _drawGoal(ctx, x, y, depth, gh, col, fill) {
        ctx.fillStyle = fill; ctx.strokeStyle = col; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.rect(depth < 0 ? x + depth : x, y - gh, Math.abs(depth), gh * 2); ctx.fill(); ctx.stroke();
    }

    drawScreenBanner(ctx, viewW, viewH) {
        if (this.goalBannerTimer <= 0) return;
        ctx.save(); ctx.font = '900 clamp(28px, 6vw, 52px) "Nunito", sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = '#fde047'; ctx.shadowColor = '#ec4899'; ctx.shadowBlur = 18;
        ctx.fillText('ГОООЛ! ⚽🎉', viewW / 2, viewH * 0.24); ctx.restore();
    }
}
