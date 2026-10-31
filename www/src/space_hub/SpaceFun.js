// ============================================================================
// SpaceFun.js — Космический Футбол, Сырный Краскомёт и эффекты столкновений
// Вся физика и солвер коллизий работают в едином ядре SpaceWorldCore (50 Hz)
// ============================================================================

import { SpaceNetwork } from './SpaceNetwork.js';
import { PlayerProfile } from '../core/PlayerProfile.js';
import { SpaceAudio } from '../core/SpaceAudio.js';
import { FIELD, createPhysicsBody } from '../shared/SpaceWorldCore.js';

const PAINT_COLORS = ['#f472b6', '#a3e635', '#38bdf8', '#facc15', '#c084fc', '#fb923c'];
const EMOJIS = ['😜', '🧀', '❤️', '😂'];

export class SpaceFun {
    constructor(rocket, env) {
        Object.assign(this, {
            rocket, env, ball: { x: FIELD.cx, y: FIELD.cy, rawX: FIELD.cx, rawY: FIELD.cy, vx: 0, vy: 0, r: FIELD.ballR, angle: 0 },
            score: { blue: 0, pink: 0 }, goalBannerTimer: 0, fx: [], Emotes: [],
            shakeTime: 0, lastBumpAt: 0, lastKickAt: 0, localProjSeq: 1
        });
        SpaceNetwork.onFunEvent = (ev) => this._onServerFx(ev);
        SpaceNetwork.onFxEvent = (ev) => this._onServerFx(ev);
        if (SpaceNetwork.worldSync) {
            SpaceNetwork.worldSync.onWorldEvents = (evs) => this._onLocalWorldEvents(evs);
        }
        SpaceNetwork.onServerImpulse = (imp) => {
            if (performance.now() - this.lastBumpAt > 550) {
                this.lastBumpAt = performance.now();
                this.rocket.applyServerImpulse(imp);
                this._spawnSplat(this.rocket.x, this.rocket.y, '#fde047', 14, false);
                this.shakeTime = 0.22;
                SpaceAudio.playBumperBounce();
            }
        };
    }

    firePaint() {
        const r = this.rocket, color = PAINT_COLORS[Math.floor(Math.random() * PAINT_COLORS.length)], emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
        r.triggerHorn(emoji);
        SpaceAudio.playHorn();
        SpaceAudio.playPaintShoot();
        const sx = Math.round(r.x + Math.cos(r.angle) * 30), sy = Math.round(r.y + Math.sin(r.angle) * 30);
        const vx = Math.round(r.vx * 0.35 + Math.cos(r.angle) * 690), vy = Math.round(r.vy * 0.35 + Math.sin(r.angle) * 690);
        const mySid = SpaceNetwork._mySid?.() || '__local__';
        const shot = { id: `loc_${this.localProjSeq++}`, ownerId: PlayerProfile.playerId, ownerSid: mySid, x: sx, y: sy, vx, vy, color, emoji, ttl: 1.35 };
        this._spawnProjectileBody(shot);
        SpaceNetwork.shootPaint(shot);
    }

    _spawnProjectileBody(s) {
        const world = SpaceNetwork.worldSync?.world;
        if (world) {
            const id = String(s.id || s.projId || `p_${this.localProjSeq++}`);
            world.projectiles.set(id, createPhysicsBody({
                id, type: 'projectile', ownerId: s.ownerId || s.playerId || '', ownerSid: s.ownerSid || s.sessionId || '__local__',
                x: s.x, y: s.y, vx: s.vx, vy: s.vy, radius: 10, invMass: 2.2, restitution: 0.6, color: s.color || '#f472b6', ttl: 1.35
            }));
        }
        this.Emotes.push({ x: s.x, y: s.y - 34, text: s.emoji || '😜', life: 1.2 });
    }

    _spawnSplat(x, y, color, count = 16, isConfetti = false, baseR = 8) {
        for (let i = 0; i < count; i++) {
            const a = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.35, spd = (isConfetti ? 240 : 140) + Math.random() * 160;
            this.fx.push({ x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, r: (isConfetti ? 6 : baseR) + Math.random() * (baseR * 0.6), life: 1, color: isConfetti ? PAINT_COLORS[i % PAINT_COLORS.length] : color });
        }
    }

    _applyPaintToRocket(targetId, color, x, y, targetSid = '') {
        const now = performance.now(), key = `${targetId || targetSid}_${color}`;
        if (this.lastPaintKey === key && now - (this.lastPaintAt || 0) < 220) return;
        this.lastPaintKey = key; this.lastPaintAt = now;
        this._spawnSplat(x, y, color, 20, false); SpaceAudio.playPaintSplat();
        const mySid = SpaceNetwork._mySid?.() || '', myPid = PlayerProfile.playerId;
        if (targetId === '__local__' || (targetSid && (targetSid === mySid || targetSid === SpaceNetwork.tabSid)) || (targetId && (targetId === myPid || String(targetId).startsWith(myPid + '_')))) {
            Object.assign(this.rocket, { paintColor: color, paintTimer: 6.0, spinTimer: 1.0, flipTimer: 0.65 });
        } else {
            const peer = SpaceNetwork.peers.get(targetId) || Array.from(SpaceNetwork.peers.values()).find(p => p.sessionId === targetSid || p.playerId === targetId);
            if (peer) Object.assign(peer, { paintColor: color, paintTimer: 6.0, spinTimer: 1.0 });
        }
    }

    _onLocalWorldEvents(evs) {
        const now = performance.now();
        for (const ev of evs) {
            if (ev.type === 'bumper_hit') {
                this._spawnSplat(ev.hitX, ev.hitY, '#fde047', 14, false);
                this.shakeTime = 0.22;
                SpaceAudio.playBumperBounce();
                try { navigator.vibrate?.(15); } catch (_) {}
                if (now - this.lastBumpAt > 180 && (ev.bodyA?.id === '__local__' || ev.bodyB?.id === '__local__')) {
                    this.lastBumpAt = now;
                    const other = ev.bodyA.id === '__local__' ? ev.bodyB : ev.bodyA;
                    const sign = ev.bodyA.id === '__local__' ? 1 : -1;
                    SpaceNetwork.sendAction('bumper_hit', { targetSid: other.sessionId, targetId: other.playerId || other.id, nx: ev.nx * sign, ny: ev.ny * sign, x: Math.round(ev.hitX), y: Math.round(ev.hitY) });
                }
            } else if (ev.type === 'ball_kick') {
                if (now - this.lastKickAt > 80) {
                    this._spawnSplat(ev.hitX, ev.hitY, '#fde047', 8, false, 3.5);
                    SpaceAudio.playBumperBounce();
                }
                this.lastKickAt = now;
                if (ev.bodyA?.id === '__local__' || ev.bodyB?.id === '__local__') {
                    if (SpaceNetwork.worldSync) SpaceNetwork.worldSync.lastLocalBallKickAt = now;
                    const b = SpaceNetwork.worldSync?.world?.ball;
                    if (b) SpaceNetwork.sendAction('ball_kick', { x: Math.round(b.x), y: Math.round(b.y), vx: Math.round(b.vx), vy: Math.round(b.vy) });
                }
            } else if (ev.type === 'asteroid_bump') {
                this._spawnSplat(ev.hitX, ev.hitY, '#fde047', 8, false, 3.5);
                SpaceAudio.playBumperBounce();
                try { navigator.vibrate?.(12); } catch (_) {}
            } else if (ev.type === 'paint_splat') {
                this.lastSplatAt = now;
                if (ev.targetId || ev.targetSid) {
                    this._applyPaintToRocket(ev.targetId, ev.color || '#f472b6', ev.hitX, ev.hitY, ev.targetSid);
                    SpaceNetwork.sendAction('hit_player', { id: ev.projId, targetSid: ev.targetSid, targetId: ev.targetId === '__local__' ? PlayerProfile.playerId : ev.targetId, color: ev.color, x: Math.round(ev.hitX), y: Math.round(ev.hitY) });
                } else {
                    this._spawnSplat(ev.hitX, ev.hitY, ev.color || '#f472b6', 14, false);
                    SpaceAudio.playPaintSplat();
                    SpaceNetwork.sendAction('hit_asteroid', { id: ev.projId, color: ev.color, x: Math.round(ev.hitX), y: Math.round(ev.hitY) });
                }
            } else if (ev.type === 'cheese_picked') {
                if (ev.byPlayerId === '__local__' || ev.byPlayerId === PlayerProfile.playerId) {
                    SpaceNetwork.sendAction('cheese_pick', { id: ev.id, x: Math.round(ev.hitX), y: Math.round(ev.hitY) });
                }
                this.env?.onServerCheesePicked(ev);
            }
        }
    }

    _onServerFx(ev) {
        if (!ev?.type) return;
        const mySid = SpaceNetwork._mySid?.() || '', myPid = PlayerProfile.playerId, now = performance.now();
        if (ev.type === 'paint_splat') {
            if (ev.targetId || ev.targetSid) this._applyPaintToRocket(ev.targetId, ev.color || '#f472b6', ev.x, ev.y, ev.targetSid);
            else if (now - (this.lastSplatAt || 0) > 250) { this.lastSplatAt = now; this._spawnSplat(ev.x, ev.y, ev.color || '#f472b6', 14, false); SpaceAudio.playPaintSplat(); }
        } else if (ev.type === 'ball_kick') {
            if (ev.bySid && ev.bySid !== mySid && ev.bySid !== SpaceNetwork.tabSid) {
                const wb = SpaceNetwork.worldSync?.world?.ball;
                if (wb) SpaceNetwork.worldSync._applyServerBody(wb, ev, false);
                this._spawnSplat(ev.x, ev.y, '#fde047', 8, false, 3.5);
                SpaceAudio.playBumperBounce();
            }
        } else if (ev.type === 'bumper_hit') {
            if ((ev.targetSid && (ev.targetSid === mySid || ev.targetSid === SpaceNetwork.tabSid)) || (ev.targetId && (ev.targetId === myPid || String(ev.targetId).startsWith(myPid + '_')))) {
                if (now - this.lastBumpAt > 550) {
                    this.lastBumpAt = now;
                    if (ev.nx || ev.ny) this.rocket.bounceOff(ev.nx, ev.ny, 310);
                }
            }
            if (now - (this.lastBumpAt || 0) > 350 && now - (this.lastKickAt || 0) > 350) {
                this._spawnSplat(ev.x, ev.y, '#fde047', 12, false, 3.5);
                this.shakeTime = Math.max(this.shakeTime, 0.16);
                SpaceAudio.playBumperBounce();
            }
        } else if (ev.type === 'goal') {
            if (ev.score) {
                this.score = ev.score;
                if (SpaceNetwork.worldSync?.world) SpaceNetwork.worldSync.world.score = { ...ev.score };
            }
            const wb = SpaceNetwork.worldSync?.world?.ball;
            if (wb) { wb.x = wb.prevX = wb.renderX = FIELD.cx; wb.y = wb.prevY = wb.renderY = FIELD.cy; wb.vx = wb.vy = 0; wb.errorX = wb.errorY = 0; }
            this.goalBannerTimer = 2.6;
            this._spawnSplat(FIELD.cx, FIELD.cy, '#facc15', 36, true);
            SpaceAudio.playGoalFanfare();
        } else if (ev.type === 'cheese_picked') {
            this.env?.onServerCheesePicked(ev);
        } else if (ev.type === 'horn') {
            if (ev.playerId !== myPid && ev.sessionId !== mySid) {
                SpaceAudio.playHorn();
                SpaceAudio.playPaintShoot();
                if (typeof ev.vx === 'number' && typeof ev.vy === 'number') this._spawnProjectileBody(ev);
            }
        }
    }

    update(dt) {
        if (this.shakeTime > 0) this.shakeTime = Math.max(0, this.shakeTime - dt);
        if (this.goalBannerTimer > 0) this.goalBannerTimer = Math.max(0, this.goalBannerTimer - dt);
        const wb = SpaceNetwork.worldSync?.world?.ball;
        if (wb) {
            this.ball.x = wb.renderX;
            this.ball.y = wb.renderY;
            this.ball.rawX = wb.rawX;
            this.ball.rawY = wb.rawY;
            this.ball.vx = wb.vx;
            this.ball.vy = wb.vy;
            this.ball.angle = wb.renderAngle;
            if (SpaceNetwork.worldSync.world.score) this.score = SpaceNetwork.worldSync.world.score;
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

        const projs = SpaceNetwork.worldSync?.world?.projectiles;
        if (projs) {
            for (const s of projs.values()) {
                ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(s.renderX, s.renderY, 10, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
            }
        }
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
