// ============================================
// MAIN - Phaser Game Entry Point  v-online-1
// ============================================
const BUILD_VERSION = 'v-multipipeline-2026-06-04';
console.log('%c[Mousie Pi] BUILD: ' + BUILD_VERSION, 'background:#e8b54a;color:#140820;font-size:14px;padding:4px 8px;border-radius:4px;');
window.__BUILD_VERSION__ = BUILD_VERSION;

import { GAME, PHYS } from './config.js';
import { BootScene } from './scenes/BootScene.js';
import { MenuScene } from './scenes/MenuScene.js';
import { GameScene } from './scenes/GameScene.js';
import { TransylvaniaScene } from './scenes/TransylvaniaScene.js';
import { DungeonScene } from './scenes/DungeonScene.js';
import { initAudioManager } from './audio/AudioManager.js';

// Read URL parameters for direct game launch
const urlParams = new URLSearchParams(window.location.search);
const mode = urlParams.get('mode') || 'menu';
const botCount = parseInt(urlParams.get('botCount')) || 2;
const character = parseInt(urlParams.get('character')) || 1;
const peerId = urlParams.get('peerId') || null;
const nickname = urlParams.get('nickname') || 'Игрок';
const remoteNickname = urlParams.get('remoteNickname') || null;
const serverUrl = urlParams.get('server') || 'ws://localhost:2567';
const runMode = urlParams.get('runMode') || null;

// Store config globally for scenes to access
window.gameConfig = {
    mode: mode,           // 'solo', 'host', 'join', 'online', or 'menu'
    botCount: botCount,
    character: character, // 1 = brown bunny (Пи), 2 = gray bunny (Пу)
    isHost: mode === 'host',
    peerId: peerId,
    nickname: nickname,
    remoteNickname: remoteNickname,
    serverUrl: serverUrl,
    runMode: runMode      // 'story' | 'endless' | null (Transylvania mode)
};

// Choose scenes based on mode - skip menu for solo mode
const scenes = (mode === 'solo' || mode === 'host' || mode === 'join' || mode === 'online')
    ? [BootScene, GameScene, TransylvaniaScene, DungeonScene]
    : [BootScene, MenuScene, GameScene, TransylvaniaScene, DungeonScene];

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
    scale: {
        mode: Phaser.Scale.RESIZE,
        parent: 'game-container',
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: '100%',
        height: '100%'
    },
    render: {
        antialias: true,
        antialiasGL: true,
        pixelArt: false,
        roundPixels: true,
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
    game = new Phaser.Game(config);

    // Single owner of all audio playback (procedural SFX + BGM + EventBus routing)
    window.audio = initAudioManager(game);
};
if (document.fonts && document.fonts.load) {
    Promise.race([
        Promise.all([document.fonts.load('400 16px Nunito', 'Aa0Пример'), document.fonts.load('700 16px Nunito', 'Aa0Пример'), document.fonts.load('900 16px Nunito', 'Aa0Пример')]),
        new Promise((r) => setTimeout(r, 1500)),
    ]).then(_boot, _boot);
} else {
    _boot();
}

// Suppress DAC pop + resume both AudioContexts (Phaser + ProceduralSfx) on first gesture.
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
        ctx.resume().then(() => setTimeout(() => { game.sound.mute = false; }, 150));
    }
    // CRITICAL: resume the ProceduralSfx context too — it's a separate AudioContext
    try { window.audio?.proc?.resume(); } catch (e) {}
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
    _resizeRefreshTimer = setTimeout(() => { if (game) game.scale.refresh(); }, 200);
});

// Pause/resume with mute trick to suppress DAC pop on app restore
document.addEventListener('visibilitychange', () => {
    if (!game) return;
    if (document.hidden) {
        game.sound.pauseAll();
    } else {
        game.sound.mute = true;
        game.sound.resumeAll();
        setTimeout(() => { game.sound.mute = false; }, 400);
        // ProceduralSfx ctx also auto-suspends on Android — resume it too
        try { window.audio?.proc?.resume(); } catch (e) {}
    }
});
