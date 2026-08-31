// ============================================
// AudioManager — single owner of all sound playback
// - 4 channels (master / sfx / music / ui) backed by ProgressStore.audioPrefs
// - Sampled SFX driven by SoundMap (pitch jitter + retrigger guards)
// - ProceduralSfx stays as the fallback when a sample is missing from the cache
// - Looping music from OGG with fade-in / cross-fade
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
export function preloadAudio(scene) {
    if (!scene || !scene.load) return;
    for (const [key, entry] of Object.entries(SFX_FILES)) {
        if (scene.cache?.audio?.exists(key)) continue;
        scene.load.audio(key, `assets/audio/sfx/${entry[0]}.ogg`);
    }
    for (const [key, entry] of Object.entries(BGM_FILES)) {
        if (scene.cache?.audio?.exists(key)) continue;
        scene.load.audio(key, `assets/audio/bgm/${entry[0]}.ogg`);
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
        this._bgmSound = null;         // Phaser looping music
        this._bgmKey = null;
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
        // Don't stomp on a fade in flight — it will land on the new target anyway
        if (this._bgmSound && !this._bgmSound._fadeTimer) {
            try { this._bgmSound.setVolume(this._musicVolume()); } catch (e) {}
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
            this.game.sound.play(key, { volume: Math.min(1, vol), rate });
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

    // === Music (sampled, looping) ===
    _musicVolume() {
        const p = this.prefs || DEFAULT_PREFS;
        return p.music * (p.muted ? 0 : 1);
    }

    // Manual fade — the manager owns music across scene restarts, so it can't
    // borrow a scene's tween manager (the tween would die with the scene).
    _fade(sound, target, ms, onDone) {
        if (!sound) return;
        if (sound._fadeTimer) { clearInterval(sound._fadeTimer); sound._fadeTimer = null; }
        const from = (typeof sound.volume === 'number') ? sound.volume : 0;
        const t0 = performance.now();
        const finish = () => {
            clearInterval(sound._fadeTimer);
            sound._fadeTimer = null;
            if (onDone) { try { onDone(); } catch (e) {} }
        };
        sound._fadeTimer = setInterval(() => {
            if (sound.pendingRemove) { finish(); return; }
            const k = ms > 0 ? Math.min(1, (performance.now() - t0) / ms) : 1;
            try { sound.setVolume(from + (target - from) * k); } catch (e) { finish(); return; }
            if (k >= 1) finish();
        }, 33);
    }

    // Accepts a track key ('cavern'), a biome id ('garden') or an event name ('bgm:garden').
    playBgm(name) {
        const id = String(name || '').replace(/^bgm:/, '');
        const key = BGM_FILES[name] ? name
            : (BIOME_BGM[id] || (id === 'menu' ? 'hall' : null));
        if (!key) return;
        if (!this.game?.cache?.audio?.exists(key)) {
            // No sample — keep the floor from being silent with the procedural preset
            if (BGM_PRESETS[id]) this.playBgmPreset(id);
            return;
        }
        if (this._bgmKey === key && this._bgmSound && !this._bgmSound.pendingRemove) return;
        // Defer until the context is allowed to make noise, or the track is lost silently
        if (!this._unlocked && this.game?.sound?.context?.state === 'suspended') {
            this._pendingBgm = key;
            return;
        }
        if (this._activePresetName) this.stopBgmPreset();
        const old = this._bgmSound;
        if (old) this._fade(old, 0, 600, () => { try { old.stop(); old.destroy(); } catch (e) {} });
        let sound = null;
        try {
            sound = this.game.sound.add(key, { loop: true, volume: 0 });
            sound.play();
        } catch (e) {
            this._bgmSound = null;
            this._bgmKey = null;
            return;
        }
        this._bgmSound = sound;
        this._bgmKey = key;
        this._fade(sound, this._musicVolume(), 800);
    }

    stopBgm() {
        this._pendingBgm = null;
        if (this._activePresetName) this.stopBgmPreset();
        const old = this._bgmSound;
        this._bgmSound = null;
        this._bgmKey = null;
        if (!old) return;
        this._fade(old, 0, 600, () => { try { old.stop(); old.destroy(); } catch (e) {} });
    }

    pauseAll() {
        try { if (this._bgmSound) this._bgmSound.pause(); } catch (e) {}
        try { this.bgm?.pause(); } catch (e) {}
        if (this.game?.sound) this.game.sound.pauseAll?.();
    }
    resumeAll() {
        try { if (this._bgmSound) this._bgmSound.resume(); } catch (e) {}
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
