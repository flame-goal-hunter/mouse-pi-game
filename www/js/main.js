// ============================================
// MAIN - Phaser Game Entry Point  v-online-1
// ============================================
console.log('[main.js] loaded — version v-online-1', new Date().toISOString());

import { GAME, PHYS } from './config.js';
import { BootScene } from './scenes/BootScene.js';
import { MenuScene } from './scenes/MenuScene.js';
import { GameScene } from './scenes/GameScene.js';
import { TransylvaniaScene } from './scenes/TransylvaniaScene.js';

// Read URL parameters for direct game launch
const urlParams = new URLSearchParams(window.location.search);
const mode = urlParams.get('mode') || 'menu';
const botCount = parseInt(urlParams.get('botCount')) || 2;
const character = parseInt(urlParams.get('character')) || 1;
const peerId = urlParams.get('peerId') || null;
const nickname = urlParams.get('nickname') || 'Игрок';
const remoteNickname = urlParams.get('remoteNickname') || null;
const serverUrl = urlParams.get('server') || 'ws://localhost:2567';

// Store config globally for scenes to access
window.gameConfig = {
    mode: mode,           // 'solo', 'host', 'join', 'online', or 'menu'
    botCount: botCount,
    character: character, // 1 = brown bunny (Пи), 2 = gray bunny (Пу)
    isHost: mode === 'host',
    peerId: peerId,
    nickname: nickname,
    remoteNickname: remoteNickname,
    serverUrl: serverUrl
};

// Choose scenes based on mode - skip menu for solo mode
const scenes = (mode === 'solo' || mode === 'host' || mode === 'join' || mode === 'online')
    ? [BootScene, GameScene, TransylvaniaScene]
    : [BootScene, MenuScene, GameScene, TransylvaniaScene];

// Phaser configuration (physics handled by Rapier2D, not Phaser)
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
        mode: Phaser.Scale.RESIZE,  // Заполняет весь экран
        parent: 'game-container',
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: '100%',
        height: '100%'
    },
    render: {
        antialias: true,
        pixelArt: false,
        roundPixels: false
    },
    plugins: {},
    scene: scenes
};

// Create Phaser game immediately (DOM and scripts are already loaded
// by the time this module is imported after Rapier WASM init)
const game = new Phaser.Game(config);

// Suppress DAC pop: on first user touch, resume AudioContext while muted
document.addEventListener('touchstart', function _unlockAudio() {
    document.removeEventListener('touchstart', _unlockAudio, true);
    const ctx = game.sound.context;
    if (ctx && ctx.state === 'suspended') {
        game.sound.mute = true;
        ctx.resume().then(() => {
            setTimeout(() => { game.sound.mute = false; }, 150);
        });
    }
}, { capture: true, once: true });

// Handle window resize
window.addEventListener('resize', () => {
    game.scale.refresh();
});

// Pause/resume with mute trick to suppress DAC pop on app restore
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        game.sound.pauseAll();
    } else {
        game.sound.mute = true;
        game.sound.resumeAll();
        setTimeout(() => { game.sound.mute = false; }, 400);
    }
});
