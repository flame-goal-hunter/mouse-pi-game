// ============================================
// MENU SCENE - Main Menu with Multiplayer
// ============================================

import { GAME } from '../config.js';

export class MenuScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MenuScene' });
    }

    create() {
        const centerX = GAME.WIDTH / 2;
        const centerY = GAME.HEIGHT / 2;

        // Settings
        this.botCount = 2;
        this.gameMode = 'single';  // 'single', 'host', 'join'

        // Background
        this.cameras.main.setBackgroundColor('#87CEEB');

        // === TITLE ===
        this.add.text(centerX, 100, 'MOUSIE PI', {
            fontFamily: 'Arial Black, sans-serif',
            fontSize: '72px',
            color: '#ffffff',
            stroke: '#2c3e50',
            strokeThickness: 8
        }).setOrigin(0.5);

        // Mouse emoji as decoration
        this.add.text(centerX - 200, 100, '🐭', {
            fontSize: '64px'
        }).setOrigin(0.5);

        this.add.text(centerX + 200, 100, '🐭', {
            fontSize: '64px'
        }).setOrigin(0.5);

        // Subtitle
        this.add.text(centerX, 170, 'Snowball Arena', {
            fontFamily: 'Arial, sans-serif',
            fontSize: '28px',
            color: '#34495e'
        }).setOrigin(0.5);

        // === GAME MODE BUTTONS ===
        const buttonStyle = {
            fontFamily: 'Arial, sans-serif',
            fontSize: '32px',
            color: '#ffffff',
            backgroundColor: '#3498db',
            padding: { x: 30, y: 15 }
        };

        const buttonHoverStyle = {
            color: '#ffffff',
            backgroundColor: '#2980b9'
        };

        // Single Player button
        const singleBtn = this.add.text(centerX, 300, '🎮  Single Player (vs Bots)', buttonStyle)
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true })
            .on('pointerover', () => singleBtn.setStyle(buttonHoverStyle))
            .on('pointerout', () => singleBtn.setStyle(buttonStyle))
            .on('pointerdown', () => this.startSinglePlayer());

        // Host Multiplayer button
        const hostBtn = this.add.text(centerX, 380, '🌐  Host Multiplayer', buttonStyle)
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true })
            .on('pointerover', () => hostBtn.setStyle(buttonHoverStyle))
            .on('pointerout', () => hostBtn.setStyle(buttonStyle))
            .on('pointerdown', () => this.hostMultiplayer());

        // Join Game button
        const joinBtn = this.add.text(centerX, 460, '🔗  Join Game', buttonStyle)
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true })
            .on('pointerover', () => joinBtn.setStyle(buttonHoverStyle))
            .on('pointerout', () => joinBtn.setStyle(buttonStyle))
            .on('pointerdown', () => this.showJoinDialog());

        // Story Mode (Transylvania) — preview button
        const storyStyle = { ...buttonStyle, backgroundColor: '#5a2080' };
        const storyHover = { ...buttonHoverStyle, backgroundColor: '#7a30a0' };
        const storyBtn = this.add.text(centerX, 500, '🦇  Замок Теней (превью)', storyStyle)
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true })
            .on('pointerover', () => storyBtn.setStyle(storyHover))
            .on('pointerout',  () => storyBtn.setStyle(storyStyle))
            // The castle menu is transylvania-menu.html. TransylvaniaScene is the old
            // half-styled Phaser twin and must not be where the button lands.
            .on('pointerdown', () => {
                try { window.location.href = 'transylvania-menu.html'; }
                catch (e) { this.scene.start('TransylvaniaScene'); }
            });

        // === BOT SETTINGS ===
        this.add.text(centerX, 560, 'Bots:', {
            fontFamily: 'Arial, sans-serif',
            fontSize: '28px',
            color: '#2c3e50'
        }).setOrigin(0.5);

        // Bot count display
        this.botCountText = this.add.text(centerX, 610, `${this.botCount}`, {
            fontFamily: 'Arial Black, sans-serif',
            fontSize: '48px',
            color: '#e74c3c'
        }).setOrigin(0.5);

        // Decrease button
        const decBtn = this.add.text(centerX - 100, 610, '◀', {
            fontFamily: 'Arial, sans-serif',
            fontSize: '40px',
            color: '#3498db'
        }).setOrigin(0.5)
            .setInteractive({ useHandCursor: true })
            .on('pointerdown', () => this.changeBotCount(-1));

        // Increase button
        const incBtn = this.add.text(centerX + 100, 610, '▶', {
            fontFamily: 'Arial, sans-serif',
            fontSize: '40px',
            color: '#3498db'
        }).setOrigin(0.5)
            .setInteractive({ useHandCursor: true })
            .on('pointerdown', () => this.changeBotCount(1));

        // === CONTROLS INFO ===
        this.add.text(centerX, 750, 'Controls: WASD / Arrows to move, SPACE to jump, E for hook, LMB to shoot', {
            fontFamily: 'Arial, sans-serif',
            fontSize: '18px',
            color: '#7f8c8d'
        }).setOrigin(0.5);

        this.add.text(centerX, 780, 'Touch: Virtual joystick + buttons', {
            fontFamily: 'Arial, sans-serif',
            fontSize: '18px',
            color: '#7f8c8d'
        }).setOrigin(0.5);

        // === JOIN DIALOG (hidden initially) ===
        this.createJoinDialog();

        // === PEER ID DISPLAY (for multiplayer) ===
        this.peerIdText = this.add.text(centerX, 900, '', {
            fontFamily: 'monospace',
            fontSize: '20px',
            color: '#27ae60'
        }).setOrigin(0.5);

        // === VERSION ===
        this.add.text(GAME.WIDTH - 20, GAME.HEIGHT - 20, 'v2.0', {
            fontFamily: 'Arial, sans-serif',
            fontSize: '16px',
            color: '#bdc3c7'
        }).setOrigin(1);
    }

    changeBotCount(delta) {
        this.botCount = Phaser.Math.Clamp(this.botCount + delta, 0, 4);
        this.botCountText.setText(`${this.botCount}`);
    }

    startSinglePlayer() {
        this.scene.start('GameScene', {
            mode: 'single',
            botCount: this.botCount,
            isHost: false,
            peerId: null
        });
    }

    hostMultiplayer() {
        // Generate a simple room code
        const roomCode = this.generateRoomCode();
        this.peerIdText.setText(`Room Code: ${roomCode}\nShare this code with friends!`);

        // Store for later use
        this.roomCode = roomCode;

        // Wait a moment then start as host
        this.time.delayedCall(2000, () => {
            this.scene.start('GameScene', {
                mode: 'host',
                botCount: this.botCount,
                isHost: true,
                peerId: roomCode
            });
        });
    }

    generateRoomCode() {
        // Use persistent code from FavoritesManager if available (index.html flow)
        if (typeof FavoritesManager !== 'undefined') {
            return FavoritesManager.getPlayerId();
        }
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 4; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    createJoinDialog() {
        const centerX = GAME.WIDTH / 2;
        const centerY = GAME.HEIGHT / 2;

        // Container for dialog
        this.joinDialog = this.add.container(centerX, centerY);
        this.joinDialog.setVisible(false);

        // Background
        const bg = this.add.rectangle(0, 0, 400, 250, 0x2c3e50, 0.95);
        bg.setStrokeStyle(3, 0x3498db);

        // Title
        const title = this.add.text(0, -80, 'Enter Room Code', {
            fontFamily: 'Arial, sans-serif',
            fontSize: '24px',
            color: '#ffffff'
        }).setOrigin(0.5);

        // Input display
        this.joinCodeText = this.add.text(0, 0, '______', {
            fontFamily: 'monospace',
            fontSize: '36px',
            color: '#3498db',
            letterSpacing: 8
        }).setOrigin(0.5);

        // Join button
        const joinBtn = this.add.text(0, 70, 'JOIN', {
            fontFamily: 'Arial, sans-serif',
            fontSize: '24px',
            color: '#ffffff',
            backgroundColor: '#27ae60',
            padding: { x: 30, y: 10 }
        }).setOrigin(0.5)
            .setInteractive({ useHandCursor: true })
            .on('pointerdown', () => this.joinGame());

        // Cancel button
        const cancelBtn = this.add.text(150, -100, '✕', {
            fontFamily: 'Arial, sans-serif',
            fontSize: '28px',
            color: '#e74c3c'
        }).setOrigin(0.5)
            .setInteractive({ useHandCursor: true })
            .on('pointerdown', () => this.hideJoinDialog());

        this.joinDialog.add([bg, title, this.joinCodeText, joinBtn, cancelBtn]);

        // Keyboard input for room code
        this.joinCode = '';
        this.input.keyboard.on('keydown', (event) => {
            if (!this.joinDialog.visible) return;

            const key = event.key.toUpperCase();
            if (/^[A-Z0-9]$/.test(key) && this.joinCode.length < 6) {
                this.joinCode += key;
                this.updateJoinCodeDisplay();
            } else if (event.key === 'Backspace' && this.joinCode.length > 0) {
                this.joinCode = this.joinCode.slice(0, -1);
                this.updateJoinCodeDisplay();
            } else if (event.key === 'Enter' && this.joinCode.length === 6) {
                this.joinGame();
            } else if (event.key === 'Escape') {
                this.hideJoinDialog();
            }
        });
    }

    updateJoinCodeDisplay() {
        const display = this.joinCode.padEnd(6, '_');
        this.joinCodeText.setText(display);
    }

    showJoinDialog() {
        this.joinCode = '';
        this.updateJoinCodeDisplay();
        this.joinDialog.setVisible(true);
    }

    hideJoinDialog() {
        this.joinDialog.setVisible(false);
    }

    joinGame() {
        if (this.joinCode.length !== 6) return;

        this.hideJoinDialog();
        this.peerIdText.setText(`Joining room: ${this.joinCode}...`);

        // Start as client
        this.time.delayedCall(1000, () => {
            this.scene.start('GameScene', {
                mode: 'join',
                botCount: 0,  // Host controls bots
                isHost: false,
                peerId: this.joinCode
            });
        });
    }
}
