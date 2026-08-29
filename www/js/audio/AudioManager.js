// ============================================
// AudioManager — single owner of all sound playback
// - 4 channels (master / sfx / music / ui) backed by ProgressStore.audioPrefs
// - BGM crossfade
// - Procedural SFX for v1 (no asset files yet)
// - Listens on EventBus for audio:* events from gameplay code
// - Handles mobile autoplay (resume on first pointerdown)
// - Pauses on document.hidden, resumes on visible
// ============================================

import { Progress } from '../storage/ProgressStore.js';
import { bus } from './EventBus.js';
import { SFX, UI, BGM } from './SoundKeys.js';
import { ProceduralSfx } from './ProceduralSfx.js';
import { ProceduralBgm, BGM_PRESETS } from './ProceduralBgm.js';

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

export class AudioManager {
    constructor(game) {
        this.game = game;
        this.proc = new ProceduralSfx();
        this.bgm  = new ProceduralBgm(this.proc);
        this._currentBgm = null;       // Phaser-loaded BGM (if any file is preloaded)
        this._currentBgmKey = null;
        this._activePresetName = null; // procedural BGM preset name
        this._unlocked = false;

        // Load prefs (with fallback for older cached ProgressStore)
        const prefs = safeGetPrefs();
        this.applyPrefs(prefs);

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
        const muteMul = prefs.muted ? 0 : 1;
        this.proc.setVolume('master', prefs.master * muteMul);
        this.proc.setVolume('sfx',    prefs.sfx);
        this.proc.setVolume('ui',     prefs.ui);
        if (this.game?.sound) {
            this.game.sound.volume = prefs.master * muteMul;
            this.game.sound.mute = !!prefs.muted;
        }
        if (this._currentBgm) {
            this._currentBgm.setVolume(prefs.music * muteMul);
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

    // === Wire EventBus → playback ===
    _wireEvents() {
        const wire = (event, fn) => bus.on(event, fn);
        // UI
        wire(UI.BUTTON_CLICK,   () => this.proc.uiClick());
        wire(UI.BUTTON_BACK,    () => this.proc.uiBack());
        wire(UI.SHOP_BUY,       () => this.proc.uiBuy());
        wire(UI.SHOP_DENY,      () => this.proc.uiDeny());
        wire(UI.MENU_OPEN,      () => this.proc.uiMenuOpen());
        wire(UI.HEARTBEAT_TICK, () => this.proc.uiHeartbeat());
        // Gameplay
        wire(SFX.FIRE_PIE,       () => this.proc.firePie());
        wire(SFX.HIT_ENEMY,      () => this.proc.hitEnemy());
        wire(SFX.HIT_WALL,       () => this.proc.hitWall());
        wire(SFX.TAKE_DAMAGE,    () => this.proc.takeDamage());
        wire(SFX.PLAYER_DASH,    () => this.proc.playerDash());
        wire(SFX.PLAYER_DEATH,   () => this.proc.playerDeath());
        wire(SFX.ENEMY_DEATH,    () => this.proc.enemyDeath());
        wire(SFX.BOSS_HIT,       () => this.proc.bossHit());
        wire(SFX.SLIME_SQUELCH,  () => this.proc.slimeSquelch());
        // Pickups
        wire(SFX.COLLECT_CHEESE,  () => this.proc.collectCheese());
        wire(SFX.COLLECT_HEART,   () => this.proc.collectHeart());
        wire(SFX.COLLECT_POWERUP, () => this.proc.collectPowerup());
        wire(SFX.KEY_GRAB,        () => this.proc.keyGrab());
        wire(SFX.OPEN_CHEST,      () => this.proc.openChest());
        wire(SFX.LIGHT_TORCH,     () => this.proc.lightTorch());
        // Stealth
        wire(SFX.ALARM_TRIGGER,    () => this.proc.alarmTrigger());
        wire(SFX.SUSPICION_TICK,   () => this.proc.suspicionTick());
        wire(SFX.DISTRACTION_THUD, () => this.proc.distractionThud());
        wire(SFX.GHOST_RUN,        () => this.proc.ghostRun());
        // Story / boss
        wire(SFX.BOSS_INTRO,  () => this.proc.bossIntro());
        wire(SFX.BOSS_PHASE,  () => this.proc.bossPhase());
        wire(SFX.WIN_STORY,   () => this.proc.winStory());
        wire(SFX.LOSE_STORY,  () => this.proc.loseStory());
        wire(SFX.FLOOR_ENTER, () => this.proc.floorEnter());
        wire(SFX.AMBIENCE_START, (opts) => this.proc.startAmbience(opts || {}));
        wire(SFX.AMBIENCE_STOP,  () => this.proc.stopAmbience());
    }

    // === Procedural BGM (preset-based, no files required) ===
    // Call this from scenes: window.audio.playBgmPreset('menu') / 'dungeon' / 'kitchen' / etc.
    // Available presets in BGM_PRESETS.
    playBgmPreset(name) {
        this._activePresetName = name;
        // Stop any file-based BGM that might be playing
        if (this._currentBgm) {
            try { this._currentBgm.stop(); this._currentBgm.destroy(); } catch (e) {}
            this._currentBgm = null;
            this._currentBgmKey = null;
        }
        if (this._unlocked) {
            this.bgm.play(name);
        }
        // Apply current music volume
        const prefs = safeGetPrefs();
        this.bgm.setVolume(prefs.music * (prefs.muted ? 0 : 1));
    }

    stopBgmPreset() {
        this._activePresetName = null;
        this.bgm.stop();
    }

    // === BGM (file-based — kept for future when real OGG tracks are added) ===
    playBgm(key, scene) {
        if (this._currentBgmKey === key) return;
        if (!scene || !scene.cache?.audio?.has?.(key)) {
            // No asset for this key yet — silent, but track the intent
            this._currentBgmKey = key;
            return;
        }
        const prefs = Progress.getAudioPrefs();
        const muteMul = prefs.muted ? 0 : 1;
        const targetVol = prefs.music * muteMul;
        // Crossfade out previous
        if (this._currentBgm) {
            const old = this._currentBgm;
            scene.tweens.add({
                targets: old, volume: 0, duration: 1000,
                onComplete: () => { try { old.stop(); old.destroy(); } catch (e) {} }
            });
        }
        try {
            const sound = scene.sound.add(key, { loop: true, volume: 0 });
            sound.play();
            scene.tweens.add({ targets: sound, volume: targetVol, duration: 1000 });
            this._currentBgm = sound;
            this._currentBgmKey = key;
        } catch (e) {
            // Sound doesn't exist — silent
            this._currentBgmKey = key;
        }
    }

    stopBgm(scene) {
        if (!this._currentBgm) return;
        const old = this._currentBgm;
        if (scene?.tweens) {
            scene.tweens.add({
                targets: old, volume: 0, duration: 600,
                onComplete: () => { try { old.stop(); old.destroy(); } catch (e) {} }
            });
        } else {
            try { old.stop(); old.destroy(); } catch (e) {}
        }
        this._currentBgm = null;
        this._currentBgmKey = null;
    }

    pauseAll() {
        try { if (this._currentBgm) this._currentBgm.pause(); } catch (e) {}
        try { this.bgm?.pause(); } catch (e) {}
        if (this.game?.sound) this.game.sound.pauseAll?.();
    }
    resumeAll() {
        try { if (this._currentBgm) this._currentBgm.resume(); } catch (e) {}
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
