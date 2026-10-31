// ============================================================================
// SpaceNetDebug.js — Визуальный дебаггер «Призраков» (Raw vs Render) на Canvas
// + 15-сек кольцевой сборщик телеметрии SpaceWorldCore (Teeworlds Error Offset)
// Выключен по умолчанию (enabled = false); включается из меню Настроек (⚙️)
// ============================================================================

const WIN_MS = 15000;

class SpaceNetDebugger {
    constructor() {
        Object.assign(this, {
            enabled: false, bootAt: performance.now(), activeRAFLoopsCount: 0, lastRafTs: -1, rafSameFrameHits: 0,
            frames: [], patches: [], sends: [], lags: [], errOffsets: [], anomaliesLog: [], prevEnt: new Map(),
            myOverrides: 0, activeBodies: 0, physHz: 50, netHz: 20, lastPatchAt: 0, lastHudAt: 0
        });
    }

    setEnabled(val) {
        this.enabled = Boolean(val);
        this.bootAt = this._now();
        this.frames.length = 0; this.patches.length = 0; this.sends.length = 0;
        this.lags.length = 0; this.errOffsets.length = 0; this.anomaliesLog.length = 0;
        this.prevEnt.clear(); this.myOverrides = 0; this.rafSameFrameHits = 0; this.lastPatchAt = 0;
        if (this.wrap) this.wrap.style.display = this.enabled ? 'flex' : 'none';
    }

    mountUI(parentEl) {
        if (!parentEl || this.wrap) return;
        const wrap = document.createElement('div');
        wrap.style.cssText = 'position:fixed;bottom:max(14px,env(safe-area-inset-bottom,14px));left:max(14px,env(safe-area-inset-left,14px));display:none;align-items:center;gap:8px;z-index:9996;pointer-events:auto;font-family:"Nunito",sans-serif;';
        const pillStyle = 'background:rgba(15,23,42,0.9);border:1.8px solid #facc15;border-radius:999px;padding:6px 12px;color:#fef08a;font-weight:900;font-size:11.5px;box-shadow:0 4px 12px rgba(0,0,0,0.5);';
        const btnStyle = 'background:rgba(15,23,42,0.9);border:1.8px solid #4ade80;border-radius:999px;padding:6px 12px;color:#bbf7d0;font-weight:900;font-size:12px;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.5);';
        wrap.innerHTML = `<div id="sndHudStat" style="${pillStyle}">🐞 NetDebug: 50Hz Core</div><button type="button" id="sndCopyBtn" style="${btnStyle}">📋 Скопировать лог</button><div id="sndToast" style="position:fixed;bottom:64px;left:16px;background:#166534;border:2px solid #4ade80;color:#fff;padding:8px 14px;border-radius:14px;font-weight:900;font-size:12.5px;opacity:0;pointer-events:none;transition:opacity 0.2s;z-index:9999;">Отчёт скопирован в буфер! ✅</div>`;
        parentEl.appendChild(wrap);
        this.wrap = wrap;
        this.hudEl = wrap.querySelector('#sndHudStat');
        const cBtn = wrap.querySelector('#sndCopyBtn'), toast = wrap.querySelector('#sndToast');
        cBtn.addEventListener('click', () => this.copyReport(toast));
    }

    _now() { return performance.now(); }
    _relMs(t = this._now()) { return Math.round(t - this.bootAt); }
    _pushAnomaly(type, msg, now = this._now()) {
        if (!this.enabled) return;
        this.anomaliesLog.push({ t: now, rel: this._relMs(now), type, msg });
        const cut = now - WIN_MS;
        while (this.anomaliesLog.length > 40 || (this.anomaliesLog.length && this.anomaliesLog[0].t < cut)) this.anomaliesLog.shift();
    }
    _prune(now) {
        const cut = now - WIN_MS;
        while (this.frames.length && this.frames[0].t < cut) this.frames.shift();
        while (this.patches.length && this.patches[0].t < cut) this.patches.shift();
        while (this.sends.length && this.sends[0] < cut) this.sends.shift();
        while (this.lags.length && this.lags[0].t < cut) this.lags.shift();
        while (this.errOffsets.length && this.errOffsets[0].t < cut) this.errOffsets.shift();
    }
    onFrameStep(dtSec, rafNow) {
        if (!this.enabled) return;
        const now = this._now(), dtMs = dtSec * 1000;
        this._prune(now);
        this.frames.push({ t: now, dt: dtMs });
        if (Math.abs(rafNow - this.lastRafTs) < 1.5) {
            this.rafSameFrameHits++;
            this._pushAnomaly('RAF_DUPLICATE', `update() called twice in same frame (dt=${dtMs.toFixed(1)}ms, loops=${this.activeRAFLoopsCount})`, now);
        }
        this.lastRafTs = rafNow;
        if (this.hudEl && now - this.lastHudAt > 250) {
            this.lastHudAt = now;
            const winSec = Math.max(1, Math.min(15, (now - this.bootAt) / 1000));
            const fps = Math.round(1000 / Math.max(1, dtMs));
            const pps = (this.patches.length / winSec).toFixed(1);
            const lastErr = this.errOffsets.length ? this.errOffsets[this.errOffsets.length - 1].err.toFixed(1) : '0.0';
            this.hudEl.textContent = `🐞 FPS: ${fps} | PPS: ${pps} | ErrOff: ${lastErr}px`;
        }
    }
    onPatch(source = 'colyseus') {
        if (!this.enabled) return;
        const now = this._now(), interval = this.lastPatchAt > 0 ? now - this.lastPatchAt : 50;
        this.lastPatchAt = now;
        this.patches.push({ t: now, iv: interval, source });
        if (interval < 10) this._pushAnomaly('PACKET_BURST', `patch interval ${interval.toFixed(1)}ms (<10ms, source=${source})`, now);
        else if (interval > 120) this._pushAnomaly('DROPOUT', `patch interval ${interval.toFixed(1)}ms (>120ms, source=${source})`, now);
    }
    onSend() {
        if (!this.enabled) return;
        this.sends.push(this._now());
    }
    checkMyRocketOverride(prevX, prevY, curX, curY, context = 'net_step') {
        if (!this.enabled) return;
        const d = Math.hypot(curX - prevX, curY - prevY);
        if (d > 0.01) {
            this.myOverrides++;
            this._pushAnomaly('MY_ROCKET_OVERRIDE', `my rocket moved ${d.toFixed(1)}px outside physics (${context}: (${Math.round(prevX)},${Math.round(prevY)})->(${Math.round(curX)},${Math.round(curY)}))`);
        }
    }

    recordEntityFrame(id, rawX, rawY, renderX, renderY, renderAngle, dtSec, errOffset = 0, activeBodies = 1) {
        if (!this.enabled) return;
        const now = this._now(), dtMs = Math.max(1, dtSec * 1000);
        this.activeBodies = activeBodies;
        const numErr = typeof errOffset === 'number' ? errOffset : 0;
        this.errOffsets.push({ t: now, err: numErr });
        const lag = Math.hypot((rawX || 0) - renderX, (rawY || 0) - renderY);
        this.lags.push({ t: now, lag });

        const prev = this.prevEnt.get(id);
        if (prev) {
            const stepDist = Math.hypot(renderX - prev.x, renderY - prev.y);
            const spd = stepDist / dtMs;
            const spdRatio = prev.spd > 0.15 ? spd / prev.spd : 1;
            if (stepDist > 20 || (stepDist > 5.5 && spdRatio > 2.5)) {
                this._pushAnomaly('RENDER_JUMP', `${id} jumped ${stepDist.toFixed(1)}px in ${dtMs.toFixed(1)}ms (spdRatio=${spdRatio.toFixed(1)}x | errOff=${numErr.toFixed(1)}px | old=(${Math.round(prev.x)},${Math.round(prev.y)}) new=(${Math.round(renderX)},${Math.round(renderY)}) raw=(${Math.round(rawX)},${Math.round(rawY)}))`, now);
            }
            const da = Math.abs(Math.atan2(Math.sin(renderAngle - prev.a), Math.cos(renderAngle - prev.a)));
            if (da > 0.35) {
                this._pushAnomaly('ANGLE_SNAP', `${id} angle snapped ${da.toFixed(2)} rad in ${dtMs.toFixed(1)}ms (errOff=${numErr.toFixed(1)}px)`, now);
            }
            this.prevEnt.set(id, { x: renderX, y: renderY, a: renderAngle, spd });
        } else {
            this.prevEnt.set(id, { x: renderX, y: renderY, a: renderAngle, spd: 0 });
        }
    }

    drawWorldOverlay(ctx, peers, ball) {
        if (!this.enabled || !ctx) return;
        ctx.save();
        const drawGhost = (rawX, rawY, renX, renY, r, label) => {
            if (!Number.isFinite(rawX) || !Number.isFinite(renX)) return;
            const lag = Math.hypot(rawX - renX, rawY - renY);
            ctx.strokeStyle = '#facc15'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(rawX, rawY); ctx.lineTo(renX, renY); ctx.stroke();
            ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2.2;
            ctx.beginPath(); ctx.arc(rawX, rawY, r, 0, Math.PI * 2); ctx.stroke();
            ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 2.2;
            ctx.beginPath(); ctx.arc(renX, renY, r - 3, 0, Math.PI * 2); ctx.stroke();
            ctx.fillStyle = '#fef08a'; ctx.font = '900 11px monospace'; ctx.textAlign = 'center';
            ctx.fillText(`${label} Δ${Math.round(lag)}px`, renX, renY - r - 8);
        };
        if (ball && Number.isFinite(ball.rawX)) drawGhost(ball.rawX, ball.rawY, ball.x, ball.y, 34, 'ball');
        for (const p of peers) {
            if (p.currentLocation === 'space') drawGhost(p.rawX ?? p.targetX, p.rawY ?? p.targetY, p.renderX, p.renderY, 26, p.nickname || p.playerId);
        }
        ctx.restore();
    }

    buildReport() {
        const now = this._now();
        this._prune(now);
        const winSec = Math.max(1, Math.min(15, (now - this.bootAt) / 1000));
        const dts = this.frames.map(f => f.dt);
        const avgDt = dts.length ? dts.reduce((a, b) => a + b, 0) / dts.length : 16.6;
        const maxDt = dts.length ? Math.max(...dts) : 16.6;
        const avgFPS = (1000 / Math.max(1, avgDt)).toFixed(1);
        const minFPS = (1000 / Math.max(1, maxDt)).toFixed(1);

        const ivs = this.patches.map(p => p.iv);
        const pps = (this.patches.length / winSec).toFixed(1);
        const avgIv = ivs.length ? (ivs.reduce((a, b) => a + b, 0) / ivs.length).toFixed(1) : '0';
        const minIv = ivs.length ? Math.min(...ivs).toFixed(1) : '0';
        const maxIv = ivs.length ? Math.max(...ivs).toFixed(1) : '0';
        const bursts = ivs.filter(x => x < 10).length;
        const dropouts = ivs.filter(x => x > 120).length;

        const errVals = this.errOffsets.map(e => e.err);
        const avgErr = errVals.length ? (errVals.reduce((a, b) => a + b, 0) / errVals.length).toFixed(1) : '0.0';
        const maxErr = errVals.length ? Math.max(...errVals).toFixed(1) : '0.0';
        const lagVals = this.lags.map(l => l.lag);
        const avgLag = lagVals.length ? (lagVals.reduce((a, b) => a + b, 0) / lagVals.length).toFixed(1) : '0.0';
        const maxLag = lagVals.length ? Math.max(...lagVals).toFixed(1) : '0.0';
        const sendRate = (this.sends.length / winSec).toFixed(1);
        const last25 = this.anomaliesLog.slice(-25).map(a => `[t=${a.rel}ms] ${a.type}: ${a.msg}`);

        return [
            '=== NET DEBUG REPORT (15s window | SpaceWorldCore 50Hz) ===',
            `1. LOOP & FPS: avgFPS=${avgFPS}, minFPS=${minFPS}, maxDt=${maxDt.toFixed(1)}ms, activeRAFLoopsCount=${this.activeRAFLoopsCount || 1}, rafDupHits=${this.rafSameFrameHits}`,
            `2. NETWORK (Colyseus): patchesPerSec(PPS)=${pps}, avgPatchInterval=${avgIv}ms, min/maxInterval=${minIv}/${maxIv}ms, packetBurstsCount=${bursts}, dropoutsCount=${dropouts}`,
            `3. WORLD CORE & ERROR DECAY: physHz=${this.physHz}, netHz=${this.netHz}, activeBodies=${this.activeBodies}, avgErrorOffset=${avgErr}px, maxErrorOffset=${maxErr}px, avgLagDist=${avgLag}px, maxLagDist=${maxLag}px`,
            `4. LOCAL ROCKET: myRocketExternalOverridesCount=${this.myOverrides}, sendRatePerSec=${sendRate}`,
            '5. DETECTED ANOMALIES (Chronological last 25 events):',
            ...(last25.length ? last25 : ['(no anomalies recorded in window)']),
            '==========================================================='
        ].join('\n');
    }

    async copyReport(toastEl) {
        const text = this.buildReport();
        let ok = false;
        try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); ok = true; } } catch (_) {}
        if (!ok) {
            try {
                const ta = document.createElement('textarea');
                ta.value = text; ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
                document.body.appendChild(ta); ta.focus(); ta.select();
                document.execCommand('copy'); ta.remove(); ok = true;
            } catch (_) {}
        }
        if (toastEl) { toastEl.style.opacity = '1'; setTimeout(() => { toastEl.style.opacity = '0'; }, 2200); }
    }
}

export const SpaceNetDebug = new SpaceNetDebugger();
if (typeof window !== 'undefined') window.SpaceNetDebug = SpaceNetDebug;
