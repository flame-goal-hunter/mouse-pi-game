// ============================================
// AudioManager — single owner of all sound playback
// - 4 channels (master / sfx / music / ui) backed by ProgressStore.audioPrefs
// - Sampled SFX driven by SoundMap (pitch jitter + retrigger guards)
// - ProceduralSfx stays as the fallback when a sample is missing from the cache
// - Looping music streamed through an HTMLAudioElement (never decoded to PCM) with fade-in / cross-fade
// - Listens on EventBus for audio:* events from gameplay code
// - Handles mobile autoplay (resume on first pointerdown)
// - Pauses on document.hidden, resumes on visible
// ============================================

import { Progress } from '../storage/ProgressStore.js';
import { bus } from './EventBus.js';
import { SFX, UI, BGM } from './SoundKeys.js';
import { ProceduralSfx } from './ProceduralSfx.js';
import { ProceduralBgm, BGM_PRESETS } from './ProceduralBgm.js';
import { SFX_FILES, BGM_FILES, EVENT_MAP, FOOTSTEPS, BIOME_BGM } from './SoundMap.js';

const DEFAULT_PREFS = { master: 1.0, sfx: 0.85, music: 0.60, ui: 0.80, muted: false };

function safeGetPrefs() {
    try {
        if (Progress && typeof Progress.getAudioPrefs === 'function') {
            const p = Progress.getAudioPrefs();
            if (p && typeof p === 'object') return { ...DEFAULT_PREFS, ...p };
        }
    } catch (e) {}
    return { ...DEFAULT_PREFS };
}

// Queue every mapped sample into a scene loader.
// Phaser skips keys that are already in the cache, so scene restarts cost nothing.
// SFX only: they are short and want WebAudio. The four music loops are 55-137 s each and
// would decode to ~166 MB of PCM in the audio cache — they stream from <audio> instead.
export function preloadAudio(scene) {
    if (!scene || !scene.load) return;
    for (const [key, entry] of Object.entries(SFX_FILES)) {
        if (scene.cache?.audio?.exists(key)) continue;
        scene.load.audio(key, `assets/audio/sfx/${entry[0]}.ogg`);
    }
}

// event → ProceduralSfx method — used only when the sample is missing, so a failed
// download never means silence. Mirrors the pre-sample wiring one for one.
const FALLBACK = {
    [UI.BUTTON_CLICK]:   'uiClick',
    [UI.BUTTON_BACK]:    'uiBack',
    [UI.SHOP_BUY]:       'uiBuy',
    [UI.SHOP_DENY]:      'uiDeny',
    [UI.MENU_OPEN]:      'uiMenuOpen',
    [UI.MENU_CLOSE]:     'uiBack',
    [UI.HEARTBEAT_TICK]: 'uiHeartbeat',
    [SFX.FIRE_PIE]:      'firePie',
    [SFX.HIT_ENEMY]:     'hitEnemy',
    [SFX.HIT_WALL]:      'hitWall',
    [SFX.TAKE_DAMAGE]:   'takeDamage',
    [SFX.PLAYER_DASH]:   'playerDash',
    [SFX.PLAYER_DEATH]:  'playerDeath',
    [SFX.ENEMY_DEATH]:   'enemyDeath',
    [SFX.BOSS_HIT]:      'bossHit',
    [SFX.SLIME_SQUELCH]: 'slimeSquelch',
    [SFX.COLLECT_CHEESE]:  'collectCheese',
    [SFX.COLLECT_HEART]:   'collectHeart',
    [SFX.COLLECT_POWERUP]: 'collectPowerup',
    [SFX.KEY_GRAB]:        'keyGrab',
    [SFX.OPEN_CHEST]:      'openChest',
    [SFX.CHEST_COINS]:     'collectCheese',
    [SFX.LIGHT_TORCH]:     'lightTorch',
    [SFX.DOOR_OPEN]:       'openChest',
    [SFX.ALARM_TRIGGER]:    'alarmTrigger',
    [SFX.SUSPICION_TICK]:   'suspicionTick',
    [SFX.DISTRACTION_THUD]: 'distractionThud',
    [SFX.GHOST_RUN]:        'ghostRun',
    [SFX.BOSS_INTRO]:  'bossIntro',
    [SFX.BOSS_PHASE]:  'bossPhase',
    [SFX.WIN_STORY]:   'winStory',
    [SFX.LOSE_STORY]:  'loseStory',
    [SFX.FLOOR_ENTER]: 'floorEnter',
    // SFX.FOOTSTEP has no synth voice on purpose — a beep 2-3× a second is worse than silence.
};

export class AudioManager {
    constructor(game) {
        this.game = game;
        this.proc = new ProceduralSfx();
        this.bgm  = new ProceduralBgm(this.proc);
        this._bgmEls = {};             // track key → HTMLAudioElement (streamed, created on first use)
        this._bgmEl = null;            // element currently owning the music channel
        this._bgmKey = null;
        this._bgmWasPlaying = false;   // was music running when the page went hidden?
        this._pendingBgm = null;       // requested before the audio context was unlocked
        this._activePresetName = null; // procedural BGM preset name (fallback only)
        this._unlocked = false;
        this._last = {};               // event → last play time (retrigger guard)
        this._biome = 'dungeon';
        this._cheeseCombo = 0;
        this._cheeseAt = 0;

        // Load prefs (with fallback for older cached ProgressStore)
        this.prefs = safeGetPrefs();
        this.applyPrefs(this.prefs);

        // Wire EventBus → playback
        this._wireEvents();

        // Mobile autoplay unlock — first pointerdown anywhere
        const unlock = () => {
            if (this._unlocked) return;
            this._unlocked = true;
            this.proc.resume();
            this.bgm.resume();
            if (game?.sound?.context?.state === 'suspended') {
                game.sound.context.resume().catch(() => {});
            }
            // If a preset was requested before unlock, kick it off now.
            if (this._activePresetName) {
                this.bgm.play(this._activePresetName);
            }
            if (this._pendingBgm) {
                const name = this._pendingBgm;
                this._pendingBgm = null;
                this.playBgm(name);
            }
            window.removeEventListener('pointerdown', unlock);
            window.removeEventListener('touchstart', unlock);
            window.removeEventListener('keydown', unlock);
        };
        // Capture phase on document — Phaser canvas handlers can't stop propagation
        document.addEventListener('pointerdown', unlock, { capture: true });
        document.addEventListener('touchstart', unlock, { capture: true });
        document.addEventListener('keydown', unlock, { capture: true });
        document.addEventListener('mousedown', unlock, { capture: true });

        // Pause / resume on visibility change
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.pauseAll();
            else this.resumeAll();
        });
    }

    applyPrefs(prefs) {
        prefs = { ...DEFAULT_PREFS, ...(prefs || {}) };
        this.prefs = prefs;
        const muteMul = prefs.muted ? 0 : 1;
        this.proc.setVolume('master', prefs.master * muteMul);
        this.proc.setVolume('sfx',    prefs.sfx);
        this.proc.setVolume('ui',     prefs.ui);
        if (this.game?.sound) {
            this.game.sound.volume = prefs.master * muteMul;
            this.game.sound.mute = !!prefs.muted;
        }
        // Mute works even mid-fade; the volume ramp would fight a direct write, so only
        // re-level when no fade is in flight — a running fade lands on the new target anyway.
        for (const el of Object.values(this._bgmEls)) {
            try { el.muted = !!prefs.muted; } catch (e) {}
        }
        if (this._bgmEl && !this._bgmEl._fadeTimer) {
            try { this._bgmEl.volume = this._musicVolume(this._bgmKey); } catch (e) {}
        }
        // Procedural BGM gets the music channel too
        if (this.bgm) {
            this.bgm.setVolume(prefs.music * muteMul);
        }
    }

    setPref(key, value) {
        try { if (Progress.setAudioPref) Progress.setAudioPref(key, value); } catch (e) {}
        this.applyPrefs(safeGetPrefs());
    }

    toggleMute() {
        try { if (Progress.toggleMute) Progress.toggleMute(); } catch (e) {}
        this.applyPrefs(safeGetPrefs());
        return safeGetPrefs().muted;
    }

    isMuted() { return Progress.getAudioPrefs().muted; }

    // The scene tells us which floor it built — footsteps pick their surface from it.
    setBiome(id) { this._biome = id || 'dungeon'; }

    // === Sampled playback ===
    _catVolume(cat) {
        const p = this.prefs || DEFAULT_PREFS;
        if (cat === 'ui')    return p.ui;
        if (cat === 'music') return p.music;
        return p.sfx;
    }

    _play(event, opts = {}) {
        const cfg = EVENT_MAP[event];
        if (!cfg) return;
        const now = performance.now();
        if (cfg.guard && this._last[event] && now - this._last[event] < cfg.guard) return;
        this._last[event] = now;
        if (this.prefs && this.prefs.muted) return;
        const keys = opts.keys || cfg.keys;
        if (!keys || !keys.length) return;
        const key = keys[(Math.random() * keys.length) | 0];
        const entry = SFX_FILES[key];
        if (!entry || !this.game?.cache?.audio?.exists(key)) { this._fallback(event); return; }
        const rate = (opts.rate ?? cfg.rate ?? 1) * (1 + (Math.random() * 2 - 1) * (cfg.jitter || 0));
        const vol = entry[1] * (opts.vol ?? 1) * this._catVolume(cfg.cat || 'sfx');
        try {
            // >1 is legal: Phaser's WebAudio volume is a gain node, so a gain above unity is
            // the only way the 27 RMS-matched samples with vol > 1 reach their intended loudness.
            // Clamping at 1 silently undid the match and left them ~3x too quiet.
            this.game.sound.play(key, { volume: Math.min(3, vol), rate });
        } catch (e) {
            this._fallback(event);
        }
    }

    _fallback(event) {
        const method = FALLBACK[event];
        if (!method || typeof this.proc[method] !== 'function') return;
        try { this.proc[method](); } catch (e) {}
    }

    // Consecutive cheese rises in pitch. The scene may pass its own {combo};
    // otherwise we count internally and let the streak decay after 1.2 s.
    _playCheese(payload) {
        const now = performance.now();
        let combo = (payload && typeof payload.combo === 'number') ? payload.combo : null;
        if (combo === null) {
            this._cheeseCombo = (now - this._cheeseAt < 1200) ? this._cheeseCombo + 1 : 0;
            combo = this._cheeseCombo;
        }
        this._cheeseAt = now;
        this._play(SFX.COLLECT_CHEESE, { rate: 1 + Math.min(combo, 8) * 0.06 });
    }

    // === Wire EventBus → playback ===
    _wireEvents() {
        const wire = (event, fn) => bus.on(event, fn);
        // Everything declared in the sound map plays from a sample
        for (const event of Object.keys(EVENT_MAP)) {
            if (event === SFX.COLLECT_CHEESE || event === SFX.FOOTSTEP) continue;
            wire(event, (opts) => this._play(event, opts || {}));
        }
        wire(SFX.COLLECT_CHEESE, (opts) => this._playCheese(opts));
        wire(SFX.FOOTSTEP, (opts) => {
            const o = opts || {};
            const biome = o.biome || this._biome;
            this._play(SFX.FOOTSTEP, { ...o, keys: FOOTSTEPS[biome] || FOOTSTEPS.dungeon });
        });
        // Ambience stays procedural — it is a continuous bed, not a sample
        wire(SFX.AMBIENCE_START, (opts) => this.proc.startAmbience(opts || {}));
        wire(SFX.AMBIENCE_STOP,  () => this.proc.stopAmbience());
        // Music: bgm:<biome> → track key via BIOME_BGM
        for (const name of Object.values(BGM)) wire(name, () => this.playBgm(name));
    }

    // === Procedural BGM (preset-based, no files required) — fallback only now ===
    playBgmPreset(name) {
        this._activePresetName = name;
        if (this._unlocked) {
            this.bgm.play(name);
        }
        // Apply current music volume
        const prefs = this.prefs || safeGetPrefs();
        this.bgm.setVolume(prefs.music * (prefs.muted ? 0 : 1));
    }

    stopBgmPreset() {
        this._activePresetName = null;
        this.bgm.stop();
    }

    // === Music (streamed <audio>, looping) ===
    // Volume = per-track match x music channel x master, silenced by the mute pref.
    _musicVolume(key) {
        const p = this.prefs || DEFAULT_PREFS;
        const track = (BGM_FILES[key] && BGM_FILES[key][1]) || 1;
        return Math.max(0, Math.min(1, track * p.music * p.master * (p.muted ? 0 : 1)));
    }

    // One element per track, built on demand and kept forever — a scene restart reuses it,
    // so the document never holds more than BGM_FILES worth of <audio> tags.
    _bgmElement(key) {
        const entry = BGM_FILES[key];
        if (!entry) return null;
        let el = this._bgmEls[key];
        if (el) return el;
        el = new Audio(`assets/audio/bgm/${entry[0]}.ogg`);
        el.loop = true;
        el.preload = 'auto';
        el.volume = 0;
        el.muted = !!(this.prefs && this.prefs.muted);
        el.onerror = () => {
            delete this._bgmEls[key];
            if (this._bgmKey === key) {
                this._stopRamp(el);
                this._bgmEl = null;
                this._bgmKey = null;
                const preset = this._presetFor(key);
                if (preset) this.playBgmPreset(preset);
            }
        };
        this._bgmEls[key] = el;
        return el;
    }

    // The procedural preset that stands in for a track when its file will not load.
    _presetFor(key) {
        for (const [biome, k] of Object.entries(BIOME_BGM)) {
            if (k === key && BGM_PRESETS[biome]) return biome;
        }
        return BGM_PRESETS[this._biome] ? this._biome : null;
    }

    // Manual ramp — the manager owns music across scene restarts, so it can't borrow a
    // scene's tween manager (the tween would die with the scene). One timer per element,
    // cancelled whenever a new ramp starts on it.
    _stopRamp(el) {
        if (el && el._fadeTimer) { clearInterval(el._fadeTimer); el._fadeTimer = null; }
    }

    _ramp(el, target, ms, onDone) {
        if (!el) return;
        this._stopRamp(el);
        const from = (typeof el.volume === 'number') ? el.volume : 0;
        const to = Math.max(0, Math.min(1, target));
        const t0 = performance.now();
        const finish = () => {
            this._stopRamp(el);
            if (onDone) { try { onDone(); } catch (e) {} }
        };
        el._fadeTimer = setInterval(() => {
            const k = ms > 0 ? Math.min(1, (performance.now() - t0) / ms) : 1;
            try { el.volume = Math.max(0, Math.min(1, from + (to - from) * k)); } catch (e) { finish(); return; }
            if (k >= 1) finish();
        }, 33);
    }

    // play() rejects when autoplay is still blocked — park the key so the first-gesture
    // unlock hook can retry it once.
    _startEl(el, key) {
        let p = null;
        try { p = el.play(); } catch (e) { this._pendingBgm = key; return; }
        if (p && typeof p.catch === 'function') {
            p.then(() => { if (this._pendingBgm === key) this._pendingBgm = null; })
             .catch(() => { this._stopRamp(el); try { el.volume = 0; } catch (e) {} this._pendingBgm = key; });
        }
    }

    // Accepts a track key ('cavern'), a biome id ('garden') or an event name ('bgm:garden').
    playBgm(name) {
        const id = String(name || '').replace(/^bgm:/, '');
        const key = BGM_FILES[name] ? name
            : (BIOME_BGM[id] || (id === 'menu' ? 'hall' : null));
        if (!key) return;
        const el = this._bgmElement(key);
        if (!el) {
            // No such track — keep the floor from being silent with the procedural preset
            if (BGM_PRESETS[id]) this.playBgmPreset(id);
            return;
        }
        if (this._bgmKey === key && this._bgmEl === el) {
            // Same track: only nudge it if a blocked autoplay (or a stall) left it paused
            if (el.paused && !document.hidden) {
                this._startEl(el, key);
                this._ramp(el, this._musicVolume(key), 800);
            }
            return;
        }
        if (this._activePresetName) this.stopBgmPreset();
        const old = this._bgmEl;
        if (old && old !== el) {
            this._ramp(old, 0, 600, () => { try { old.pause(); old.currentTime = 0; } catch (e) {} });
        }
        this._bgmEl = el;
        this._bgmKey = key;
        this._stopRamp(el);
        try { el.volume = 0; el.currentTime = 0; } catch (e) {}
        this._startEl(el, key);
        this._ramp(el, this._musicVolume(key), 800);
    }

    stopBgm() {
        this._pendingBgm = null;
        if (this._activePresetName) this.stopBgmPreset();
        const old = this._bgmEl;
        this._bgmEl = null;
        this._bgmKey = null;
        this._bgmWasPlaying = false;
        if (!old) return;
        this._ramp(old, 0, 600, () => { try { old.pause(); old.currentTime = 0; } catch (e) {} });
    }

    pauseAll() {
        try {
            this._bgmWasPlaying = !!(this._bgmEl && !this._bgmEl.paused);
            if (this._bgmEl) this._bgmEl.pause();
        } catch (e) {}
        try { this.bgm?.pause(); } catch (e) {}
        if (this.game?.sound) this.game.sound.pauseAll?.();
    }
    resumeAll() {
        try { if (this._bgmEl && this._bgmWasPlaying) this._startEl(this._bgmEl, this._bgmKey); } catch (e) {}
        try { this.bgm?.resume(); } catch (e) {}
        if (this.game?.sound) this.game.sound.resumeAll?.();
    }

    // === Convenience: direct emit shortcuts ===
    emit(event, data) { bus.emit(event, data); }
}

// Singleton helper — call from main.js after game boots
let _instance = null;
export function initAudioManager(game) {
    if (_instance) return _instance;
    _instance = new AudioManager(game);
    return _instance;
}
export function getAudioManager() { return _instance; }
