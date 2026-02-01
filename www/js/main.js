// ============================================
// MAIN - Phaser Game Entry Point
// ============================================

import { GAME, PHYS } from './config.js';
import { BootScene } from './scenes/BootScene.js';
import { MenuScene } from './scenes/MenuScene.js';
import { GameScene } from './scenes/GameScene.js';

// Read URL parameters for direct game launch
const urlParams = new URLSearchParams(window.location.search);
const mode = urlParams.get('mode') || 'menu';
const botCount = parseInt(urlParams.get('botCount')) || 2;
const character = parseInt(urlParams.get('character')) || 1;
const peerId = urlParams.get('peerId') || null;
const nickname = urlParams.get('nickname') || 'Игрок';
const remoteNickname = urlParams.get('remoteNickname') || null;

// Store config globally for scenes to access
window.gameConfig = {
    mode: mode,           // 'solo', 'host', 'join', or 'menu'
    botCount: botCount,
    character: character, // 1 = brown bunny (Пи), 2 = gray bunny (Пу)
    isHost: mode === 'host',
    peerId: peerId,
    nickname: nickname,
    remoteNickname: remoteNickname
};

// Choose scenes based on mode - skip menu for solo mode
const scenes = (mode === 'solo' || mode === 'host' || mode === 'join')
    ? [BootScene, GameScene]    // Skip menu, go directly to game
    : [BootScene, MenuScene, GameScene];  // Normal flow with menu

// Phaser configuration with Matter.js physics
const config = {
    type: Phaser.AUTO,
    width: GAME.WIDTH,
    height: GAME.HEIGHT,
    parent: 'game-container',
    backgroundColor: '#87CEEB',
    input: {
        activePointers: 5  // Поддержка до 5 одновременных касаний для мультитач
    },
    physics: {
        default: 'matter',
        matter: {
            gravity: { y: PHYS.GRAVITY },
            debug: false,
            enableSleeping: false
        }
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
    scene: scenes
};

// Wait for DOM to load
window.addEventListener('load', () => {
    const game = new Phaser.Game(config);

    // Handle window resize
    window.addEventListener('resize', () => {
        game.scale.refresh();
    });

    // Pause/resume Phaser sounds when app goes to background
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            game.sound.pauseAll();
        } else {
            game.sound.resumeAll();
        }
    });
});
