// ============================================
// MAIN - Phaser Game Entry Point  v-online-1
// ============================================
const BUILD_VERSION = 'v-multipipeline-2026-06-04';
console.log('%c[Mousie Pi] BUILD: ' + BUILD_VERSION, 'background:#e8b54a;color:#140820;font-size:14px;padding:4px 8px;border-radius:4px;');
window.__BUILD_VERSION__ = BUILD_VERSION;

import { GAME, PHYS } from './config.js?v=20261030_5';
import { BootScene } from './scenes/BootScene.js?v=20261030_5';
import { MenuScene } from './scenes/MenuScene.js?v=20261030_5';
import { GameScene } from './scenes/GameScene.js?v=20261030_5';
import { TransylvaniaScene } from './scenes/TransylvaniaScene.js';
import { DungeonScene } from './scenes/DungeonScene.js';
import { SneakScene } from './scenes/SneakScene.js';
import { initAudioManager } from './audio/AudioManager.js';
import { Progress } from './storage/ProgressStore.js';
import { DifficultyConfig } from '../src/config/DifficultyConfig.js';

// Read URL parameters for direct game launch
const urlParams = new URLSearchParams(window.location.search);
const mode = urlParams.get('mode') || 'menu';
// Device-pixel rendering for the Transylvania mode only (other modes keep RESIZE at 1×).
// Fractional DPR is fine (e.g. Pixel 9a → 2.625): with roundPixels the vertex shader snaps to device pixels for any zoom, which keeps tile edges seam-free.
let _dprStored = null;
try { _dprStored = localStorage.getItem('dpr'); } catch (e) {}   // device A/B without a rebuild: localStorage.setItem('dpr', '2')
const _dprParam = parseFloat(urlParams.get('dpr') ?? _dprStored);
const DPR = (mode === 'transylvania')
    ? Math.max(1, Math.min(3, Number.isFinite(_dprParam) ? _dprParam : (window.devicePixelRatio || 1)))
    : 1;
window.__GAME_DPR = DPR;
const _cssSize = () => {
    const el = document.getElementById('game-container');
    const w = (el && el.clientWidth) || window.innerWidth, h = (el && el.clientHeight) || window.innerHeight;
    return { w: Math.max(1, Math.floor(w)), h: Math.max(1, Math.floor(h)) };
};
const botCount = parseInt(urlParams.get('botCount')) || 2;
const onlineBots = urlParams.has('botCount') ? parseInt(urlParams.get('botCount')) : undefined;
const character = parseInt(urlParams.get('character')) || 1;
const peerId = urlParams.get('peerId') || null;
const roomCode = (urlParams.get('roomCode') || '').toUpperCase().slice(0, 6);
const isPrivate = urlParams.get('private') === '1' || roomCode.length > 0;
const nickname = urlParams.get('nickname') || 'Игрок';
const remoteNickname = urlParams.get('remoteNickname') || null;
const defaultWsHost = (typeof window !== 'undefined' && window.location?.host)
    ? ((window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host)
    : 'ws://localhost:8080';
const serverUrl = urlParams.get('server') || defaultWsHost;
const runMode = urlParams.get('runMode') || null;
const diffLevel = urlParams.get('diff') || window.parent?.__currentGameDifficulty?.level || window.parent?.PlayerProfile?.difficulty || 'normal';
const diffProfile = DifficultyConfig.get(mode === 'transylvania' ? 'transylvania' : 'snowball', diffLevel);

// Store config globally for scenes to access
window.gameConfig = {
    mode: mode,           // 'solo', 'host', 'join', 'online', or 'menu'
    botCount: botCount,
    onlineBots: onlineBots,
    roomCode: roomCode,
    isPrivate: isPrivate,
    character: character, // 1 = brown bunny (Пи), 2 = gray bunny (Пу)
    isHost: mode === 'host',
    peerId: peerId,
    nickname: nickname,
    remoteNickname: remoteNickname,
    serverUrl: serverUrl,
    runMode: runMode,     // 'story' | 'endless' | null (Transylvania mode)
    difficulty: diffProfile
};

// Choose scenes based on mode - skip menu for solo mode
const scenes = (mode === 'solo' || mode === 'host' || mode === 'join' || mode === 'online')
    ? [BootScene, GameScene, TransylvaniaScene, DungeonScene, SneakScene]
    : [BootScene, MenuScene, GameScene, TransylvaniaScene, DungeonScene, SneakScene];

// Phaser configuration (physics handled by Rapier2D, not Phaser)
// CRITICAL: autoMobilePipeline: false forces the desktop MultiPipeline instead of
// Phaser's "MobilePipeline" (auto-enabled on Android in 3.60+). MobilePipeline is
// tuned for low-end phones and hits a pathological code path on Pixel 9a / Tensor G4
// causing ~1 fps in WebGL. MultiPipeline on this flagship GPU runs at 60 fps.
// Refs: phaser/changelog/3.60/MobilePerformance.md, phaser issue #6989.
const config = {
    type: Phaser.AUTO,
    width: GAME.WIDTH,
    height: GAME.HEIGHT,
    parent: 'game-container',
    backgroundColor: '#93d5f0',
    input: {
        activePointers: 5  // Поддержка до 5 одновременных касаний для мультитач
    },
    scale: (mode === 'transylvania')
        ? { mode: Phaser.Scale.NONE, parent: 'game-container', autoCenter: Phaser.Scale.NO_CENTER,
            width: Math.round(_cssSize().w * DPR), height: Math.round(_cssSize().h * DPR), zoom: 1 / DPR }
        : { mode: Phaser.Scale.RESIZE, parent: 'game-container', autoCenter: Phaser.Scale.CENTER_BOTH, width: '100%', height: '100%' },
    render: {
        antialias: true,
        antialiasGL: true,
        pixelArt: false,
        roundPixels: (mode === 'transylvania'),
        powerPreference: 'high-performance',
        autoMobilePipeline: false,  // ← THE FIX. Bypass mobile-tuned shader path.
        batchSize: 1024,
        maxTextures: 8,
        failIfMajorPerformanceCaveat: false,
    },
    fps: { target: 60, forceSetTimeOut: false },
    plugins: {},
    scene: scenes
};

// Wait for Nunito so the first Text textures don't bake a fallback font (bounded to 1.5 s).
let game = null;
const _boot = () => {
    if (game) return;
    // The fonts wait can take up to 1.5 s; re-read the CSS size right before boot (Android bars/iframe may have settled).
    if (mode === 'transylvania') { const s = _cssSize(); config.scale.width = Math.round(s.w * DPR); config.scale.height = Math.round(s.h * DPR); }
    game = new Phaser.Game(config);
    window.__game = game;
    window.game = game;

    // Single owner of all audio playback (procedural SFX + BGM + EventBus routing)
    window.audio = initAudioManager(game);
};
if (document.fonts && document.fonts.load) {
    Promise.race([
        Promise.all([document.fonts.load('400 16px Nunito', 'Aa0Пример'), document.fonts.load('700 16px Nunito', 'Aa0Пример'), document.fonts.load('900 16px Nunito', 'Aa0Пример'), document.fonts.load('700 16px Comfortaa', 'Aa0Пример')]),
        new Promise((r) => setTimeout(r, 1500)),
    ]).then(_boot, _boot);
} else {
    _boot();
}

function _isAppMuted() {
    try {
        if (localStorage.getItem('mousie_muted') === '1') return true;
        if (localStorage.getItem('mousie_muted') === '0') return false;
        return !!Progress.getAudioPrefs().muted;
    } catch (e) {
        return false;
    }
}

// Suppress DAC pop + resume the Phaser AudioContext on first gesture.
// Capture phase + document so Phaser canvas handlers can't stop propagation.
function _unlockAllAudio() {
    if (!game) return;
    document.removeEventListener('touchstart', _unlockAllAudio, true);
    document.removeEventListener('pointerdown', _unlockAllAudio, true);
    document.removeEventListener('mousedown', _unlockAllAudio, true);
    document.removeEventListener('keydown', _unlockAllAudio, true);
    const ctx = game.sound.context;
    if (ctx && ctx.state === 'suspended') {
        game.sound.mute = true;
        // Restore the stored preference, not `false` — unlocking must not un-mute a muted game.
        ctx.resume().then(() => setTimeout(() => {
            game.sound.mute = _isAppMuted();
        }, 150)).catch(() => {});
    }
}
document.addEventListener('touchstart', _unlockAllAudio, { capture: true });
document.addEventListener('pointerdown', _unlockAllAudio, { capture: true });
document.addEventListener('mousedown', _unlockAllAudio, { capture: true });
document.addEventListener('keydown', _unlockAllAudio, { capture: true });

// Handle window resize — debounced so Android URL-bar storms don't trigger refresh storms.
// Phaser already refreshes internally on its 'resize' event; this is a safety net only.
let _resizeRefreshTimer = null;
window.addEventListener('resize', () => {
    if (_resizeRefreshTimer) clearTimeout(_resizeRefreshTimer);
    _resizeRefreshTimer = setTimeout(() => {
        if (!game) return;
        if (mode === 'transylvania') { const s = _cssSize(); game.scale.resize(Math.round(s.w * DPR), Math.round(s.h * DPR)); }
        else game.scale.refresh();
    }, 200);
});

let _restoreMuteTimer = null;
let _wasPausedByBackground = false;

function _pauseAllGameAudio() {
    _wasPausedByBackground = true;
    if (_restoreMuteTimer) {
        clearTimeout(_restoreMuteTimer);
        _restoreMuteTimer = null;
    }
    try { window.audio?.pauseAll?.(); } catch (_) {}
    if (!game) return;
    try {
        const gs = game.scene?.getScene?.('GameScene');
        if (gs) {
            gs._appBackgrounded = true;
            if (gs.bgm && gs.bgm.isPlaying) gs.bgm.pause();
        }
    } catch (_) {}
    try { game.sound.pauseAll(); } catch (_) {}
    try { game.sound.context?.suspend?.().catch(() => {}); } catch (_) {}
}

function _resumeAllGameAudio() {
    if (!_wasPausedByBackground) return;
    try {
        if (document.hidden) return;
        if (window.parent && window.parent !== window && window.parent.document?.hidden) return;
    } catch (_) {}
    _wasPausedByBackground = false;
    try { window.audio?.resumeAll?.(); } catch (_) {}
    if (!game) return;
    const muted = _isAppMuted();
    try {
        const gs = game.scene?.getScene?.('GameScene');
        if (gs) {
            gs._appBackgrounded = false;
            gs._soundMuted = muted;
            if (gs.hudMusic) gs.hudMusic.textContent = muted ? '🔇' : '🔊';
            if (!muted && gs.bgm && gs.bgm.isPaused) {
                try { gs.bgm.resume(); } catch (_) {}
            }
        }
    } catch (_) {}
    if (muted) {
        game.sound.mute = true;
        return;
    }
    game.sound.mute = true;
    try { game.sound.context?.resume?.().catch(() => {}); } catch (_) {}
    try { game.sound.resumeAll(); } catch (_) {}
    if (_restoreMuteTimer) clearTimeout(_restoreMuteTimer);
    _restoreMuteTimer = setTimeout(() => {
        _restoreMuteTimer = null;
        if (!game) return;
        game.sound.mute = _isAppMuted();
    }, 200);
}

// Pause/resume on visibilitychange, pagehide/pageshow, window blur/focus, and parent message
document.addEventListener('visibilitychange', () => {
    if (document.hidden) _pauseAllGameAudio();
    else _resumeAllGameAudio();
});
window.addEventListener('pagehide', _pauseAllGameAudio);
window.addEventListener('blur', _pauseAllGameAudio);
window.addEventListener('focus', _resumeAllGameAudio);
window.addEventListener('pageshow', _resumeAllGameAudio);
document.addEventListener('pointerdown', _resumeAllGameAudio, { capture: true });
document.addEventListener('touchstart', _resumeAllGameAudio, { capture: true });
window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'appVisibility') {
        if (e.data.hidden) _pauseAllGameAudio();
        else _resumeAllGameAudio();
    }
});
