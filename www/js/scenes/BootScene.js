// ============================================
// BOOT SCENE - Asset Loading
// ============================================

// Config imports not needed - using hardcoded values for loading

export class BootScene extends Phaser.Scene {
    constructor() {
        super({ key: 'BootScene' });
    }

    preload() {
        const width = this.cameras.main.width;
        const height = this.cameras.main.height;

        // === BEAUTIFUL LOADING SCREEN ===

        // Background gradient (ice blue)
        const bg = this.add.graphics();
        bg.fillGradientStyle(0x1a5276, 0x1a5276, 0x85c1e9, 0x85c1e9, 1);
        bg.fillRect(0, 0, width, height);

        // Snowflakes decoration (static)
        const snowflakes = [];
        for (let i = 0; i < 30; i++) {
            const x = Math.random() * width;
            const y = Math.random() * height;
            const size = 12 + Math.random() * 20;
            const sf = this.add.text(x, y, '❄️', {
                fontSize: `${size}px`
            }).setOrigin(0.5).setAlpha(0.3 + Math.random() * 0.4);
            snowflakes.push(sf);
        }

        // Game title
        const titleEmoji = this.add.text(width / 2, height / 2 - 140, '🐭', {
            fontSize: '80px'
        }).setOrigin(0.5);

        const titleText = this.add.text(width / 2, height / 2 - 60, 'МЫШОНОК ПИ', {
            fontFamily: 'Arial Black, Arial',
            fontSize: '48px',
            color: '#ffffff',
            stroke: '#1a5276',
            strokeThickness: 8
        }).setOrigin(0.5);

        const subtitleText = this.add.text(width / 2, height / 2 - 10, '❄️ Снежные битвы ❄️', {
            fontFamily: 'Arial',
            fontSize: '24px',
            color: '#d5f5e3',
            stroke: '#1a5276',
            strokeThickness: 3
        }).setOrigin(0.5);

        // Progress bar container (rounded style)
        const barWidth = 350;
        const barHeight = 30;
        const barX = width / 2 - barWidth / 2;
        const barY = height / 2 + 60;

        const progressBox = this.add.graphics();
        progressBox.fillStyle(0x0e3a5c, 0.9);
        progressBox.fillRoundedRect(barX - 5, barY - 5, barWidth + 10, barHeight + 10, 10);

        const progressBar = this.add.graphics();

        // Loading text
        const loadingText = this.add.text(width / 2, barY + barHeight + 30, 'Загрузка...', {
            fontFamily: 'Arial',
            fontSize: '18px',
            color: '#ffffff'
        }).setOrigin(0.5);

        // Percentage text
        const percentText = this.add.text(width / 2, barY + barHeight / 2, '0%', {
            fontFamily: 'Arial Black',
            fontSize: '16px',
            color: '#ffffff',
            stroke: '#0e3a5c',
            strokeThickness: 2
        }).setOrigin(0.5);

        // Tips at bottom
        const tips = [
            '💡 Используй крюк (E) чтобы раскачиваться!',
            '💡 Бей снежками в противников!',
            '💡 Собирай бонусы для усиления!',
            '💡 Прыгай с помощью ПРОБЕЛ или W'
        ];
        const tipText = this.add.text(width / 2, height - 50, tips[Math.floor(Math.random() * tips.length)], {
            fontFamily: 'Arial',
            fontSize: '16px',
            color: '#aed6f1'
        }).setOrigin(0.5);

        // Progress event
        this.load.on('progress', (value) => {
            progressBar.clear();
            progressBar.fillStyle(0x3498db, 1);
            progressBar.fillRoundedRect(barX, barY, barWidth * value, barHeight, 8);

            // Shine effect on progress bar
            progressBar.fillStyle(0x5dade2, 0.5);
            progressBar.fillRoundedRect(barX, barY, barWidth * value, barHeight / 3, 5);

            percentText.setText(Math.floor(value * 100) + '%');
        });

        // Store all UI elements for cleanup
        this.loadingUI = [bg, ...snowflakes, titleEmoji, titleText, subtitleText,
            progressBox, progressBar, loadingText, percentText, tipText];

        this.load.on('complete', () => {
            // Fade out animation
            this.tweens.add({
                targets: this.loadingUI,
                alpha: 0,
                duration: 300,
                onComplete: () => {
                    this.loadingUI.forEach(el => el.destroy());
                }
            });
        });

        // Log load errors
        this.load.on('loaderror', (file) => {
            console.error('[BootScene] Failed to load:', file.key, file.src);
        });

        // === TILEMAP ===
        this.load.image('ice-tiles', 'assets/snow/sheet.png');
        this.load.tilemapTiledJSON('ice-map', 'assets/maps/ice-arena.json');
        this.load.image('bg', 'assets/bg.png');

        // === BUNNY PLAYER SPRITES (individual images) ===
        // Player 1 - Brown bunny
        this.load.image('p1-stand', 'assets/characters/bunny1/bunny1_stand.png');
        this.load.image('p1-walk1', 'assets/characters/bunny1/bunny1_walk1.png');
        this.load.image('p1-walk2', 'assets/characters/bunny1/bunny1_walk2.png');
        this.load.image('p1-jump', 'assets/characters/bunny1/bunny1_jump.png');
        this.load.image('p1-hurt', 'assets/characters/bunny1/bunny1_hurt.png');

        // Player 2 - Gray bunny
        this.load.image('p2-stand', 'assets/characters/bunny2/bunny2_stand.png');
        this.load.image('p2-walk1', 'assets/characters/bunny2/bunny2_walk1.png');
        this.load.image('p2-walk2', 'assets/characters/bunny2/bunny2_walk2.png');
        this.load.image('p2-jump', 'assets/characters/bunny2/bunny2_jump.png');
        this.load.image('p2-hurt', 'assets/characters/bunny2/bunny2_hurt.png');

        // Player 3 - Use brown bunny with different tint (will be tinted in game)
        this.load.image('p3-stand', 'assets/characters/bunny1/bunny1_stand.png');
        this.load.image('p3-walk1', 'assets/characters/bunny1/bunny1_walk1.png');
        this.load.image('p3-walk2', 'assets/characters/bunny1/bunny1_walk2.png');
        this.load.image('p3-jump', 'assets/characters/bunny1/bunny1_jump.png');
        this.load.image('p3-hurt', 'assets/characters/bunny1/bunny1_hurt.png');

        // === INDIVIDUAL SPRITES ===
        this.load.image('snowball', 'assets/ice/tiles/snowBall.png');
        this.load.image('water-tile', 'assets/ice/tiles/iceWaterDeep.png');

        // === SOUND EFFECTS ===
        this.load.audio('sfx-snowball-shot', 'assets/sounds/snowball-shot.wav');
        this.load.audio('sfx-snowball-hit', 'assets/sounds/snowball-hit.ogg');
        this.load.audio('sfx-hook-fired', 'assets/sounds/hook-fired.wav');
        this.load.audio('sfx-hook-attached', 'assets/sounds/hook-attached.wav');
        this.load.audio('sfx-jump', 'assets/sounds/jump.mp3');

        // === MENU MUSIC ===
        this.load.audio('bgm-menu', 'assets/sounds/KleptoLindaCavernsA_Loopable.ogg');

        // Rex plugins removed - using nipplejs for joystick, worldView for UI positioning
    }

    create() {
        // Create player animations
        this.createAnimations();

        // Check if we should skip menu (direct launch via URL params)
        const config = window.gameConfig || {};
        const mode = config.mode || 'menu';

        const directModes = ['solo', 'host', 'join', 'online'];
        // If we're being launched directly OR MenuScene isn't registered → go to GameScene
        const hasMenu = this.scene.manager.keys && this.scene.manager.keys['MenuScene'];
        if (mode === 'transylvania') {
            // New HTML menu lives at transylvania-menu.html. We only stay in Phaser
            // when a runMode is already chosen (story/endless) — then jump straight
            // into DungeonScene. Otherwise, hand off to the native HTML menu so we
            // avoid spinning up Phaser just to render menu chrome.
            const runMode = config.runMode || null;
            if (runMode === 'story' || runMode === 'endless') {
                console.log('[BootScene] mode=transylvania runMode=' + runMode + ' → DungeonScene');
                this.scene.start('DungeonScene', { runMode, chapter: 1 });
            } else {
                console.log('[BootScene] mode=transylvania → redirect to transylvania-menu.html');
                try { window.location.replace('transylvania-menu.html'); }
                catch (e) {
                    console.warn('[BootScene] redirect failed, falling back to TransylvaniaScene', e);
                    this.scene.start('TransylvaniaScene');
                }
            }
        } else if (directModes.includes(mode) || !hasMenu) {
            console.log('[BootScene] mode=' + mode + ' → GameScene');
            this.scene.start('GameScene');
        } else {
            console.log('[BootScene] mode=' + mode + ' → MenuScene');
            this.scene.start('MenuScene');
        }
    }

    createAnimations() {
        // Create animations for each player using individual images
        const players = ['p1', 'p2', 'p3'];

        players.forEach(p => {
            // Idle animation (single frame)
            this.anims.create({
                key: `${p}-idle`,
                frames: [{ key: `${p}-stand` }],
                frameRate: 1
            });

            // Walk animation (alternating between walk1 and walk2)
            this.anims.create({
                key: `${p}-walk`,
                frames: [
                    { key: `${p}-walk1` },
                    { key: `${p}-walk2` }
                ],
                frameRate: 8,
                repeat: -1
            });

            // Jump animation (single frame)
            this.anims.create({
                key: `${p}-jump`,
                frames: [{ key: `${p}-jump` }],
                frameRate: 1
            });

            // Hurt animation (single frame)
            this.anims.create({
                key: `${p}-hurt`,
                frames: [{ key: `${p}-hurt` }],
                frameRate: 1
            });
        });
    }
}
