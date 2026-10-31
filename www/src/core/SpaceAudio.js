// ============================================================================
// SpaceAudio.js — Процедурный Web Audio синтезатор музыки и SFX Космоса и Дома
// Авто-разблокировка на мобильных, эмбиент/шкатулка, гул двигателя и 7 SFX (до 190 строк)
// ============================================================================

const PENTA = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99, 880.00];
const SPACE_CHORDS = [
    [130.81, 196.00, 246.94, 329.63], // Cmaj7
    [110.00, 164.81, 220.00, 261.63], // Am7
    [174.61, 220.00, 261.63, 349.23], // Fmaj7
    [146.83, 196.00, 246.94, 293.66]  // G6
];
const HOME_NOTES = [523.25, 659.25, 783.99, 659.25, 587.33, 783.99, 659.25, 523.25, 440.00, 523.25, 659.25, 587.33];

class SpaceAudioEngine {
    constructor() {
        Object.assign(this, { ctx: null, master: null, delay: null, mode: 'off', stepIdx: 0, chordIdx: 0, flightEnergy: 0, wasTurbo: false, comboCount: 0, lastComboAt: 0, engOsc: null, engGain: null, noiseGain: null });
        this._bindUnlock();
        setInterval(() => this._tickMusic(), 420);
    }

    isMuted() {
        try { return localStorage.getItem('mousie_muted') === '1'; } catch (_) { return false; }
    }

    setMuted(muted) {
        try { localStorage.setItem('mousie_muted', muted ? '1' : '0'); } catch (_) {}
        if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.85, this.ctx.currentTime, 0.06);
    }

    _bindUnlock() {
        if (typeof window === 'undefined') return;
        const unlock = () => {
            this._ensureCtx();
            if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
        };
        ['pointerdown', 'touchstart', 'keydown'].forEach(ev => window.addEventListener(ev, unlock, { passive: true }));
    }

    _ensureCtx() {
        if (this.ctx) return this.ctx;
        const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
        if (!Ctx) return null;
        const ctx = new Ctx();
        this.ctx = ctx;
        this.master = ctx.createGain();
        this.master.gain.value = this.isMuted() ? 0 : 0.85;
        this.master.connect(ctx.destination);

        // Космическое эхо (Delay + мягкий Lowpass)
        this.delay = ctx.createDelay(1.0);
        this.delay.delayTime.value = 0.34;
        const fb = ctx.createGain(), df = ctx.createBiquadFilter();
        fb.gain.value = 0.32; df.type = 'lowpass'; df.frequency.value = 1450;
        this.delay.connect(df); df.connect(fb); fb.connect(this.delay);
        this.delay.connect(this.master);

        // Непрерывный двигатель ракеты (басовый тон + lowpass-шум)
        this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
        const engFilter = ctx.createBiquadFilter(); engFilter.type = 'lowpass'; engFilter.frequency.value = 190;
        this.engOsc = ctx.createOscillator(); this.engOsc.type = 'sawtooth'; this.engOsc.frequency.value = 52;
        this.engOsc.connect(engFilter); engFilter.connect(this.engGain); this.engGain.connect(this.master);
        this.engOsc.start();

        const buf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
        this.noiseFilter = ctx.createBiquadFilter(); this.noiseFilter.type = 'bandpass'; this.noiseFilter.frequency.value = 260;
        this.noiseGain = ctx.createGain(); this.noiseGain.gain.value = 0;
        noise.connect(this.noiseFilter); this.noiseFilter.connect(this.noiseGain); this.noiseGain.connect(this.master);
        noise.start();
        return ctx;
    }

    setMode(mode) {
        if (this.mode === mode) return;
        this.mode = mode; this.stepIdx = 0;
        if (mode !== 'space' && this.engGain && this.ctx) {
            this.engGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
            this.noiseGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
        }
    }

    updateEngine(speed = 0, maxSpeed = 390, turboHeld = false) {
        if (this.mode !== 'space' || this.isMuted()) return;
        const ctx = this._ensureCtx();
        if (!ctx || ctx.state !== 'running') return;
        const norm = Math.min(1.4, speed / (maxSpeed || 390));
        this.flightEnergy = Math.min(1, norm * 0.85 + (turboHeld ? 0.35 : 0));
        const t = ctx.currentTime;
        this.engOsc.frequency.setTargetAtTime(48 + norm * 68 + (turboHeld ? 32 : 0), t, 0.07);
        this.engGain.gain.setTargetAtTime(norm > 0.04 ? 0.025 + norm * 0.055 : 0.006, t, 0.08);
        this.noiseFilter.frequency.setTargetAtTime(220 + norm * 580 + (turboHeld ? 350 : 0), t, 0.07);
        this.noiseGain.gain.setTargetAtTime(norm > 0.05 ? 0.015 + norm * 0.045 + (turboHeld ? 0.035 : 0) : 0, t, 0.08);
        if (turboHeld && !this.wasTurbo) this._tone(160, 520, 0.26, 'sawtooth', 0.12, true);
        this.wasTurbo = turboHeld;
    }

    _tone(fStart, fEnd, dur, type = 'sine', vol = 0.14, useEcho = false, delaySec = 0) {
        if (this.isMuted()) return;
        const ctx = this._ensureCtx();
        if (!ctx || ctx.state !== 'running') return;
        const t = ctx.currentTime + delaySec;
        const osc = ctx.createOscillator(), g = ctx.createGain(), flt = ctx.createBiquadFilter();
        osc.type = type; flt.type = 'lowpass'; flt.frequency.value = type === 'sawtooth' ? 1200 : 2800;
        osc.frequency.setValueAtTime(fStart, t);
        if (fEnd && fEnd !== fStart) osc.frequency.exponentialRampToValueAtTime(Math.max(20, fEnd), t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(vol, t + Math.min(0.03, dur * 0.25));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(flt); flt.connect(g); g.connect(this.master);
        if (useEcho && this.delay) g.connect(this.delay);
        osc.start(t); osc.stop(t + dur + 0.02);
    }

    _tickMusic() {
        if (this.mode === 'off' || this.isMuted() || !this.ctx || this.ctx.state !== 'running') return;
        const s = this.stepIdx++;
        if (this.mode === 'space') {
            if (s % 8 === 0) {
                const chord = SPACE_CHORDS[this.chordIdx++ % SPACE_CHORDS.length];
                chord.forEach(freq => this._tone(freq, freq * 1.002, 3.2, 'triangle', 0.036, true));
            }
            if (s % 3 === 0 && Math.random() < 0.72) {
                const note = PENTA[Math.floor(Math.random() * PENTA.length)];
                this._tone(note, note, 0.65, 'sine', 0.042, true);
            }
            if (this.flightEnergy > 0.18 && s % 2 === 0) {
                const root = SPACE_CHORDS[(this.chordIdx - 1 + SPACE_CHORDS.length) % SPACE_CHORDS.length][0];
                this._tone(root * 0.5, root * 0.5, 0.24, 'triangle', 0.075 * this.flightEnergy, false);
            }
        } else if (this.mode === 'home') {
            const note = HOME_NOTES[s % HOME_NOTES.length];
            this._tone(note, note, 0.52, 'sine', 0.055, true);
            if (s % 4 === 0) this._tone(note * 0.5, note * 0.5, 1.4, 'triangle', 0.04, false);
        }
    }

    playCheesePickup() {
        const now = performance.now();
        this.comboCount = (now - this.lastComboAt < 1800) ? Math.min(9, this.comboCount + 1) : 0;
        this.lastComboAt = now;
        const base = PENTA[this.comboCount % PENTA.length];
        this._tone(base, base * 1.25, 0.12, 'sine', 0.16, false, 0);
        this._tone(base * 1.5, base * 2, 0.18, 'triangle', 0.14, true, 0.05);
    }

    playPaintShoot() { this._tone(240, 680, 0.13, 'sine', 0.18, false); }

    playPaintSplat() {
        this._tone(420, 110, 0.22, 'sawtooth', 0.16, false, 0);
        for (let i = 0; i < 4; i++) this._tone(380 + i * 140, 620 + i * 160, 0.08, 'sine', 0.12, false, 0.04 + i * 0.045);
    }

    playHorn() {
        this._tone(440, 466.16, 0.11, 'triangle', 0.16, false, 0);
        this._tone(587.33, 622.25, 0.16, 'triangle', 0.17, true, 0.12);
    }

    playBumperBounce() {
        this._tone(150, 340, 0.11, 'sine', 0.18, false, 0);
        this._tone(340, 130, 0.16, 'triangle', 0.15, false, 0.08);
    }

    playGoalFanfare() {
        [523.25, 659.25, 783.99, 1046.5].forEach((n, i) => this._tone(n, n, i === 3 ? 0.55 : 0.18, 'triangle', 0.2, true, i * 0.12));
    }

    playCheeseUnload() {
        const f = 660 + Math.random() * 240;
        this._tone(f, f * 1.35, 0.11, 'sine', 0.13, false);
    }

    playRadioCall() {
        this._tone(980, 1240, 0.08, 'square', 0.12, false, 0);
        this._tone(1240, 980, 0.08, 'square', 0.12, false, 0.09);
        this._tone(783.99, 1046.5, 0.24, 'triangle', 0.18, true, 0.19);
    }
}

export const SpaceAudio = new SpaceAudioEngine();
if (typeof window !== 'undefined') window.SpaceAudio = SpaceAudio;
