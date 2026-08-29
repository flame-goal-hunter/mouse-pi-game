// ============================================
// ProceduralBgm — generative music engine
// Layered atmospheric BGM with biome-aware composition.
// No audio files needed; everything synthesized via Web Audio.
//
// Layers:
//   1. Bass drone (sub-octave detune pad)
//   2. Mid pad (sawtooth filtered, slow LFO)
//   3. Sparse melody (sine + reverb tail, gated by random walker)
//   4. Soft percussion (low thump on downbeats, optional)
//
// Presets per scene/biome adjust scale, tempo, density, instrument timbre.
// Smooth crossfade between presets via master gain ramp.
// ============================================

// === Music theory helpers ===
// Note number → frequency. n=0 is A2 (110Hz). Equal temperament.
const A2 = 110;
const NOTE_HZ = (n) => A2 * Math.pow(2, n / 12);

// Scales as semitone offsets from root
const SCALES = {
    minorPentatonic: [0, 3, 5, 7, 10],         // dark, mysterious
    naturalMinor:    [0, 2, 3, 5, 7, 8, 10],   // sad
    harmonicMinor:   [0, 2, 3, 5, 7, 8, 11],   // gothic, exotic
    phrygian:        [0, 1, 3, 5, 7, 8, 10],   // sinister, spanish
    dorian:          [0, 2, 3, 5, 7, 9, 10],   // melancholic
    locrian:         [0, 1, 3, 5, 6, 8, 10],   // unstable, dread
};

// === Biome presets ===
// Each preset defines a complete musical character.
export const BGM_PRESETS = {
    // Main menu / character select — gothic atmosphere, slow + melodic
    menu: {
        rootSemi: -5,           // E2-ish
        scale: 'harmonicMinor',
        tempoMs: 1800,          // ms per "tick" — slow
        bassFreq: 55,           // A1
        padFreq: 165,           // E3
        melodyOctave: 2,        // melody one octave above pad
        melodyDensity: 0.55,    // chance of note per tick
        melodyTimbre: 'sine',
        padCutoff: 380,
        padQ: 4,
        lfoSpeed: 0.06,
        lfoDepth: 90,
        kickEvery: 0,           // no kick for menu
        vol: 0.18,
    },

    // Dungeon entrance — heavier, darker
    dungeon: {
        rootSemi: -7,           // D2 — even lower
        scale: 'naturalMinor',
        tempoMs: 1400,
        bassFreq: 49,
        padFreq: 147,
        melodyOctave: 1,
        melodyDensity: 0.40,
        melodyTimbre: 'triangle',
        padCutoff: 320,
        padQ: 5,
        lfoSpeed: 0.08,
        lfoDepth: 70,
        kickEvery: 4,           // soft thump every 4 ticks
        vol: 0.16,
    },

    // Kitchen — slightly warmer, ticking clock feel
    kitchen: {
        rootSemi: 0,            // A2
        scale: 'dorian',
        tempoMs: 1100,          // a bit faster
        bassFreq: 82,
        padFreq: 220,
        melodyOctave: 2,
        melodyDensity: 0.55,
        melodyTimbre: 'triangle',
        padCutoff: 500,
        padQ: 3,
        lfoSpeed: 0.10,
        lfoDepth: 60,
        kickEvery: 2,           // ticking heartbeat
        vol: 0.15,
    },

    // Library — quietest, almost ASMR
    library: {
        rootSemi: -3,           // G2
        scale: 'phrygian',
        tempoMs: 2200,          // very slow
        bassFreq: 49,
        padFreq: 196,
        melodyOctave: 3,        // sparse high tinkles
        melodyDensity: 0.30,
        melodyTimbre: 'sine',
        padCutoff: 280,
        padQ: 6,
        lfoSpeed: 0.04,
        lfoDepth: 50,
        kickEvery: 0,
        vol: 0.13,
    },

    // Garden — hopeful but eerie
    garden: {
        rootSemi: -2,           // G#2
        scale: 'dorian',
        tempoMs: 1500,
        bassFreq: 65,
        padFreq: 196,
        melodyOctave: 2,
        melodyDensity: 0.50,
        melodyTimbre: 'sine',
        padCutoff: 600,
        padQ: 3,
        lfoSpeed: 0.07,
        lfoDepth: 70,
        kickEvery: 0,
        vol: 0.15,
    },

    // Throne / boss — heavy, dramatic, more rhythm
    throne: {
        rootSemi: -10,          // C2 — very low
        scale: 'locrian',
        tempoMs: 900,           // fast/tense
        bassFreq: 41,
        padFreq: 123,
        melodyOctave: 2,
        melodyDensity: 0.60,
        melodyTimbre: 'sawtooth',
        padCutoff: 380,
        padQ: 5,
        lfoSpeed: 0.12,
        lfoDepth: 120,
        kickEvery: 2,
        vol: 0.20,
    },

    // Victory / win screen — major-feeling resolution
    victory: {
        rootSemi: 0,
        scale: 'dorian',
        tempoMs: 1200,
        bassFreq: 110,
        padFreq: 330,
        melodyOctave: 2,
        melodyDensity: 0.70,
        melodyTimbre: 'triangle',
        padCutoff: 800,
        padQ: 2,
        lfoSpeed: 0.10,
        lfoDepth: 100,
        kickEvery: 0,
        vol: 0.18,
    },
};

export class ProceduralBgm {
    constructor(sfx) {
        // Reuse the ProceduralSfx AudioContext so we share unlock logic.
        this.sfx = sfx;
        this._activePreset = null;
        this._activeName = null;
        this._nodes = null;     // active nodes (drone/pad/lfo)
        this._tickTimer = null; // setInterval handle for melody/kick
        this._musicGain = null; // user-controlled volume layer
        this._musicVolume = 0.6;
        this._melodyState = 0;  // random walker position in scale
        this._tickCount = 0;
        this._reverbDelay = null;
    }

    setVolume(v) {
        this._musicVolume = Math.max(0, Math.min(1.5, v));
        if (this._musicGain) {
            const ctx = this.sfx._ctx;
            if (!ctx) return;
            this._musicGain.gain.cancelScheduledValues(ctx.currentTime);
            this._musicGain.gain.linearRampToValueAtTime(
                this._activePreset ? this._activePreset.vol * this._musicVolume : 0,
                ctx.currentTime + 0.3
            );
        }
    }

    // Switch to a named preset with crossfade. No-op if already active.
    play(name) {
        if (this._activeName === name) return;
        const preset = BGM_PRESETS[name];
        if (!preset) { console.warn('[ProceduralBgm] unknown preset:', name); return; }
        const ctx = this.sfx._ensureCtx();
        if (!ctx) return;

        // Crossfade out previous, then start new.
        if (this._nodes) {
            this._fadeOutCurrent(0.8);
        }
        this._activeName = name;
        this._activePreset = preset;
        // Small delay so the fade-out doesn't clash with start
        setTimeout(() => this._startPreset(preset), 200);
    }

    stop() {
        this._fadeOutCurrent(1.0);
        this._activeName = null;
        this._activePreset = null;
    }

    pause() {
        // Tickers stop; audio nodes mute via gain ramp.
        if (this._tickTimer) { clearInterval(this._tickTimer); this._tickTimer = null; }
        if (this._musicGain && this.sfx._ctx) {
            const ctx = this.sfx._ctx;
            this._musicGain.gain.cancelScheduledValues(ctx.currentTime);
            this._musicGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
        }
    }

    resume() {
        if (!this._activePreset) return;
        const ctx = this.sfx._ensureCtx();
        if (!ctx) return;
        if (ctx.state === 'suspended') ctx.resume();
        if (this._musicGain) {
            this._musicGain.gain.cancelScheduledValues(ctx.currentTime);
            this._musicGain.gain.linearRampToValueAtTime(
                this._activePreset.vol * this._musicVolume,
                ctx.currentTime + 0.6
            );
        }
        if (!this._tickTimer) this._startTicker(this._activePreset);
    }

    // === internal ===
    _fadeOutCurrent(seconds) {
        const n = this._nodes;
        if (!n) return;
        const ctx = this.sfx._ctx;
        try {
            n.musicGain.gain.cancelScheduledValues(ctx.currentTime);
            n.musicGain.gain.linearRampToValueAtTime(0, ctx.currentTime + seconds);
            const cleanup = () => {
                try {
                    n.bass1.stop(); n.bass2.stop(); n.pad.stop(); n.lfo.stop();
                } catch (e) {}
            };
            setTimeout(cleanup, seconds * 1000 + 200);
        } catch (e) {}
        if (this._tickTimer) { clearInterval(this._tickTimer); this._tickTimer = null; }
        this._nodes = null;
    }

    _startPreset(preset) {
        const ctx = this.sfx._ensureCtx();
        if (!ctx) return;

        // Music sits on the master gain (not sfxGain) so its volume is independent.
        const musicGain = ctx.createGain();
        musicGain.gain.value = 0;
        musicGain.connect(this.sfx._masterGain);
        // Fade in
        musicGain.gain.linearRampToValueAtTime(
            preset.vol * this._musicVolume,
            ctx.currentTime + 2.0
        );

        // Reverb-ish: a feedback delay gives melody a tail without convolution
        const reverbDelay = ctx.createDelay(2.0);
        reverbDelay.delayTime.value = 0.36;
        const reverbFeedback = ctx.createGain();
        reverbFeedback.gain.value = 0.42;
        const reverbDamp = ctx.createBiquadFilter();
        reverbDamp.type = 'lowpass';
        reverbDamp.frequency.value = 2200;
        reverbDelay.connect(reverbDamp).connect(reverbFeedback).connect(reverbDelay);
        reverbDelay.connect(musicGain);
        this._reverbDelay = reverbDelay;

        // 1) Bass drone — two slightly detuned sines for warble
        const bass1 = ctx.createOscillator();
        bass1.type = 'sine';
        bass1.frequency.value = preset.bassFreq;
        const bass2 = ctx.createOscillator();
        bass2.type = 'sine';
        bass2.frequency.value = preset.bassFreq * 1.006;
        const bassGain = ctx.createGain();
        bassGain.gain.value = 0.45;
        bass1.connect(bassGain);
        bass2.connect(bassGain);
        bassGain.connect(musicGain);

        // 2) Mid pad — filtered sawtooth, LFO-modulated cutoff
        const pad = ctx.createOscillator();
        pad.type = 'sawtooth';
        pad.frequency.value = preset.padFreq;
        const padFilter = ctx.createBiquadFilter();
        padFilter.type = 'lowpass';
        padFilter.frequency.value = preset.padCutoff;
        padFilter.Q.value = preset.padQ;
        const padGain = ctx.createGain();
        padGain.gain.value = 0.35;
        pad.connect(padFilter).connect(padGain).connect(musicGain);

        // 3) LFO for filter movement
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = preset.lfoSpeed;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = preset.lfoDepth;
        lfo.connect(lfoGain).connect(padFilter.frequency);

        bass1.start(); bass2.start(); pad.start(); lfo.start();

        this._nodes = { bass1, bass2, pad, lfo, padFilter, musicGain, reverbDelay };
        this._musicGain = musicGain;
        this._tickCount = 0;
        this._melodyState = 0;
        this._startTicker(preset);
    }

    _startTicker(preset) {
        if (this._tickTimer) clearInterval(this._tickTimer);
        this._tickTimer = setInterval(() => this._tick(preset), preset.tempoMs);
    }

    _tick(preset) {
        this._tickCount++;
        const ctx = this.sfx._ctx;
        if (!ctx || ctx.state === 'suspended') return;

        // === Sparse melody — random walker through scale ===
        if (Math.random() < preset.melodyDensity) {
            const scale = SCALES[preset.scale] || SCALES.harmonicMinor;
            // Random walker: ±1 step, occasionally jump
            const step = (Math.random() < 0.15)
                ? Math.floor(Math.random() * scale.length) - this._melodyState
                : (Math.random() < 0.5 ? -1 : 1);
            this._melodyState = Math.max(0, Math.min(scale.length * 2 - 1,
                this._melodyState + step));
            const octave = Math.floor(this._melodyState / scale.length);
            const idx = this._melodyState % scale.length;
            const semi = preset.rootSemi + scale[idx] + 12 * (preset.melodyOctave + octave);
            const freq = NOTE_HZ(semi);
            this._playMelodyNote(freq, preset);
        }

        // === Soft kick on downbeats ===
        if (preset.kickEvery > 0 && (this._tickCount % preset.kickEvery) === 0) {
            this._playKick(preset);
        }
    }

    _playMelodyNote(freq, preset) {
        const ctx = this.sfx._ctx;
        if (!ctx) return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        osc.type = preset.melodyTimbre || 'sine';
        osc.frequency.value = freq;
        const env = ctx.createGain();
        env.gain.value = 0;
        // Soft attack, long release
        env.gain.linearRampToValueAtTime(0.18, now + 0.08);
        env.gain.exponentialRampToValueAtTime(0.001, now + 1.4);
        // Tiny pitch waver
        osc.frequency.setValueAtTime(freq, now);
        osc.frequency.linearRampToValueAtTime(freq * 1.002, now + 0.4);
        osc.connect(env);
        // Send to both direct mix and reverb tail
        env.connect(this._musicGain);
        env.connect(this._reverbDelay);
        osc.start(now);
        osc.stop(now + 1.5);
    }

    _playKick(preset) {
        const ctx = this.sfx._ctx;
        if (!ctx) return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        // Pitch envelope: punchy click
        osc.frequency.setValueAtTime(120, now);
        osc.frequency.exponentialRampToValueAtTime(35, now + 0.18);
        const env = ctx.createGain();
        env.gain.value = 0;
        env.gain.linearRampToValueAtTime(0.30, now + 0.005);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.connect(env).connect(this._musicGain);
        osc.start(now);
        osc.stop(now + 0.3);
    }
}
