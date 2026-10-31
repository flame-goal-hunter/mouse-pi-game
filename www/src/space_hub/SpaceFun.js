// ============================================================================
// SpaceFun.js — Космический Футбол с воротами и табло, Сырный Краскомёт (салки)
// и упругие бампер-столкновения ракет (до 190 строк)
// ============================================================================

import { SpaceNetwork } from './SpaceNetwork.js';
import { PlayerProfile } from '../core/PlayerProfile.js';

const FIELD = { cx: 0, cy: 110, hw: 295, hh: 175, goalH: 72, ballR: 32 };
const PAINT_COLORS = ['#f472b6', '#a3e635', '#38bdf8', '#facc15', '#c084fc', '#fb923c'];
const EMOJIS = ['😜', '🧀', '❤️', '😂'];

export class SpaceFun {
    constructor(rocket, env) {
        Object.assign(this, { rocket, env, ball: { x: FIELD.cx, y: FIELD.cy, vx: 0, vy: 0, r: FIELD.ballR, angle: 0 }, score: { blue: 0, pink: 0 }, goalBannerTimer: 0, shots: [], fx: [], Emotes: [], shakeTime: 0, lastKickAt: 0, lastBumpAt: 0 });
        SpaceNetwork.onFunEvent = (ev) => this._onNetEvent(ev);
    }

    _beep(freq = 540, dur = 0.14) {
        if (localStorage.getItem('mousie_muted') === '1') return;
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            this.ac = this.ac || new Ctx();
            const o = this.ac.createOscillator(), g = this.ac.createGain();
            o.type = 'triangle'; o.frequency.setValueAtTime(freq, this.ac.currentTime);
            o.frequency.exponentialRampToValueAtTime(freq * 1.45, this.ac.currentTime + dur);
            g.gain.setValueAtTime(0.16, this.ac.currentTime);
            g.gain.exponentialRampToValueAtTime(0.001, this.ac.currentTime + dur);
            o.connect(g); g.connect(this.ac.destination);
            o.start(); o.stop(this.ac.currentTime + dur);
        } catch (_) {}
    }

    firePaint() {
        const r = this.rocket, color = PAINT_COLORS[Math.floor(Math.random() * PAINT_COLORS.length)], emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
        r.hopScale = 0.32; this._beep(580, 0.13);
        const sx = r.x + Math.cos(r.angle) * 30, sy = r.y + Math.sin(r.angle) * 30;
        const shot = { ownerId: PlayerProfile.playerId, x: sx, y: sy, vx: r.vx * 0.35 + Math.cos(r.angle) * 690, vy: r.vy * 0.35 + Math.sin(r.angle) * 690, color, emoji, life: 1.35 };
        this._spawnShot(shot);
        SpaceNetwork.sendFunEvent({ type: 'paintShot', ...shot, rx: r.x, ry: r.y });
    }

    _spawnShot(s) {
        this.shots.push({ ...s, life: 1.35 });
        this.Emotes.push({ x: s.rx ?? s.x, y: (s.ry ?? s.y) - 34, text: s.emoji || '😜', life: 1.2 });
    }

    _spawnSplat(x, y, color, count = 16, isConfetti = false) {
        for (let i = 0; i < count; i++) {
            const a = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.35, spd = (isConfetti ? 240 : 140) + Math.random() * 160;
            this.fx.push({ x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, r: (isConfetti ? 6 : 8) + Math.random() * 6, life: 1, color: isConfetti ? PAINT_COLORS[i % PAINT_COLORS.length] : color });
        }
    }

    _applyPaintToRocket(targetId, color, x, y) {
        this._spawnSplat(x, y, color, 20, false); this._beep(420, 0.18);
        if (targetId === PlayerProfile.playerId) Object.assign(this.rocket, { paintColor: color, paintTimer: 6.0, flipTimer: 0.65 });
        else { const peer = SpaceNetwork.peers.get(targetId); if (peer) Object.assign(peer, { paintColor: color, paintUntil: Date.now() + 6000, flipStart: performance.now() }); }
    }

    _onNetEvent(ev) {
        if (!ev?.type) return;
        if (ev.type === 'ballKick') { Object.assign(this.ball, { x: ev.x, y: ev.y, vx: ev.vx, vy: ev.vy }); if (ev.score) this.score = ev.score; }
        else if (ev.type === 'goal') { if (ev.score) this.score = ev.score; Object.assign(this.ball, { x: FIELD.cx, y: FIELD.cy, vx: 0, vy: 0 }); this.goalBannerTimer = 2.6; this._spawnSplat(FIELD.cx, FIELD.cy, '#facc15', 36, true); this._beep(740, 0.28); }
        else if (ev.type === 'paintShot') this._spawnShot(ev);
        else if (ev.type === 'paintHit') this._applyPaintToRocket(ev.targetId, ev.color, ev.x, ev.y);
        else if (ev.type === 'bumperHit' && ev.targetId === PlayerProfile.playerId) { this.rocket.bounceOff(ev.nx, ev.ny, 320); this.shakeTime = 0.22; this._spawnSplat(this.rocket.x, this.rocket.y, '#fde047', 12, false); }
    }

    update(dt, turboHeld) {
        if (this.shakeTime > 0) this.shakeTime = Math.max(0, this.shakeTime - dt);
        if (this.goalBannerTimer > 0) this.goalBannerTimer = Math.max(0, this.goalBannerTimer - dt);
        const b = this.ball, r = this.rocket;
        b.x += b.vx * dt; b.y += b.vy * dt; b.angle += Math.hypot(b.vx, b.vy) * 0.012 * dt;
        const drag = Math.pow(0.985, dt * 60); b.vx *= drag; b.vy *= drag;

        const minX = FIELD.cx - FIELD.hw, maxX = FIELD.cx + FIELD.hw, minY = FIELD.cy - FIELD.hh, maxY = FIELD.cy + FIELD.hh;
        if (b.y - b.r < minY) { b.y = minY + b.r; b.vy = Math.abs(b.vy) * 0.85; }
        if (b.y + b.r > maxY) { b.y = maxY - b.r; b.vy = -Math.abs(b.vy) * 0.85; }
        const inGoal = Math.abs(b.y - FIELD.cy) < FIELD.goalH;
        if (b.x - b.r < minX) { if (inGoal) this._triggerGoal('pink'); else { b.x = minX + b.r; b.vx = Math.abs(b.vx) * 0.85; } }
        else if (b.x + b.r > maxX) { if (inGoal) this._triggerGoal('blue'); else { b.x = maxX - b.r; b.vx = -Math.abs(b.vx) * 0.85; } }

        const dxB = b.x - r.x, dyB = b.y - r.y, distB = Math.hypot(dxB, dyB);
        if (distB < b.r + 26 && distB > 0.001 && performance.now() - this.lastKickAt > 110) {
            this.lastKickAt = performance.now();
            const nx = dxB / distB, ny = dyB / distB, boost = turboHeld ? 1.55 : 1.25;
            b.vx = r.vx * boost + nx * (turboHeld ? 360 : 230); b.vy = r.vy * boost + ny * (turboHeld ? 360 : 230);
            b.x = r.x + nx * (b.r + 28); b.y = r.y + ny * (b.r + 28); r.vx *= 0.7; r.vy *= 0.7;
            this._spawnSplat(b.x - nx * b.r, b.y - ny * b.r, '#fde047', 10, false); this._beep(480, 0.09);
            SpaceNetwork.sendFunEvent({ type: 'ballKick', x: Math.round(b.x), y: Math.round(b.y), vx: Math.round(b.vx), vy: Math.round(b.vy), score: this.score });
        }

        const peers = SpaceNetwork.getOnlinePeers().filter(p => p.currentLocation === 'space');
        for (const p of peers) {
            const dx = r.x - p.rx, dy = r.y - p.ry, d = Math.hypot(dx, dy);
            if (d < 52 && d > 0.001 && performance.now() - this.lastBumpAt > 280) {
                this.lastBumpAt = performance.now();
                const nx = dx / d, ny = dy / d;
                r.bounceOff(nx, ny, 310); this.shakeTime = 0.22; this._beep(320, 0.12);
                this._spawnSplat((r.x + p.rx) / 2, (r.y + p.ry) / 2, '#fde047', 14, false);
                SpaceNetwork.sendFunEvent({ type: 'bumperHit', targetId: p.playerId, nx: -nx, ny: -ny });
                SpaceNetwork.broadcastNow();
            }
        }

        for (let i = this.shots.length - 1; i >= 0; i--) {
            const s = this.shots[i]; s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
            let hit = false;
            if (Math.hypot(s.x - b.x, s.y - b.y) < b.r + 10) {
                b.vx += s.vx * 0.45; b.vy += s.vy * 0.45; this._spawnSplat(s.x, s.y, s.color, 14, false);
                if (s.ownerId === PlayerProfile.playerId) SpaceNetwork.sendFunEvent({ type: 'ballKick', x: Math.round(b.x), y: Math.round(b.y), vx: Math.round(b.vx), vy: Math.round(b.vy), score: this.score });
                hit = true;
            }
            if (!hit && s.ownerId === PlayerProfile.playerId) {
                for (const p of peers) if (Math.hypot(s.x - p.rx, s.y - p.ry) < 32) {
                    this._applyPaintToRocket(p.playerId, s.color, p.rx, p.ry);
                    SpaceNetwork.sendFunEvent({ type: 'paintHit', targetId: p.playerId, color: s.color, x: Math.round(p.rx), y: Math.round(p.ry) });
                    hit = true; break;
                }
            }
            if (!hit && this.env?.asteroids) for (const a of this.env.asteroids) if (Math.hypot(s.x - a.x, s.y - a.y) < a.r + 8) { this._spawnSplat(s.x, s.y, s.color, 12, false); hit = true; break; }
            if (hit || s.life <= 0) this.shots.splice(i, 1);
        }

        for (let i = this.fx.length - 1; i >= 0; i--) { const f = this.fx[i]; f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.94; f.vy *= 0.94; if ((f.life -= dt * 1.45) <= 0) this.fx.splice(i, 1); }
        for (let i = this.Emotes.length - 1; i >= 0; i--) { const em = this.Emotes[i]; em.y -= 36 * dt; if ((em.life -= dt) <= 0) this.Emotes.splice(i, 1); }
    }

    _triggerGoal(team) {
        this.score[team] = (this.score[team] || 0) + 1;
        Object.assign(this.ball, { x: FIELD.cx, y: FIELD.cy, vx: 0, vy: 0 });
        this.goalBannerTimer = 2.6; this._spawnSplat(FIELD.cx, FIELD.cy, '#facc15', 36, true); this._beep(740, 0.28);
        SpaceNetwork.sendFunEvent({ type: 'goal', score: this.score });
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

        for (const s of this.shots) { ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(s.x, s.y, 10, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
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
