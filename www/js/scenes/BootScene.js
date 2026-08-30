// ============================================
// BOOT SCENE - Asset Loading
// ============================================

// Config imports not needed - using hardcoded values for loading

export class BootScene extends Phaser.Scene {
    constructor() {
        super({ key: 'BootScene' });
    }

    preload() {
        const mode = new URLSearchParams(window.location.search).get('mode') || 'menu';
        const isCastle = (mode === 'transylvania');

        let width = this.cameras.main.width;
        let height = this.cameras.main.height;

        // === BEAUTIFUL LOADING SCREEN ===
        if (!isCastle) {
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
        } else {
            const dpr = window.__GAME_DPR || 1;
            this.cameras.main.setOrigin(0, 0).setZoom(dpr);
            width = this.cameras.main.width / dpr;
            height = this.cameras.main.height / dpr;

            const F = '"Nunito", "Roboto", system-ui, sans-serif';
            const bg = this.add.graphics();
            bg.fillGradientStyle(0x1a0c2e, 0x1a0c2e, 0x07030f, 0x07030f, 1);
            bg.fillRect(0, 0, width, height);
            // Moon + glow
            const moon = this.add.graphics();
            moon.fillStyle(0xfff4c8, 0.12); moon.fillCircle(width * 0.82, height * 0.22, 74);
            moon.fillStyle(0xfff4c8, 1);    moon.fillCircle(width * 0.82, height * 0.22, 46);
            moon.fillStyle(0x1a0c2e, 1);    moon.fillCircle(width * 0.85, height * 0.20, 40);
            // Castle silhouette (three towers with battlements)
            const castle = this.add.graphics();
            castle.fillStyle(0x0b0616, 1);
            castle.fillRect(0, height * 0.78, width, height * 0.22);
            const tk = Math.min(1, height / 600);   // shorter towers on short (landscape) screens so they never reach the title
            for (const [cx, w, h0] of [[width * 0.18, 70, 150], [width * 0.5, 110, 210], [width * 0.8, 70, 150]]) {
                const h = Math.round(h0 * tk), m = Math.round(16 * tk);
                castle.fillRect(cx - w / 2, height * 0.78 - h, w, h);
                for (let i = -2; i <= 2; i++) castle.fillRect(cx + i * (w / 4) - 6, height * 0.78 - h - m, 12, m);
            }
            const titleText = this.add.text(width / 2, height * 0.27, 'МЫШОНОК ПИ', {
                fontFamily: F, fontSize: '54px', fontStyle: '900', color: '#f3d27a', stroke: '#1a0a2e', strokeThickness: 8, resolution: dpr,
            }).setOrigin(0.5);
            const subtitleText = this.add.text(width / 2, height * 0.27 + 46, 'и Замок Теней', {
                fontFamily: F, fontSize: '26px', fontStyle: '700', color: '#d8c0f0', stroke: '#1a0a2e', strokeThickness: 5, resolution: dpr,
            }).setOrigin(0.5);
            const barWidth = Math.min(420, width * 0.6), barHeight = 22, barX = width / 2 - barWidth / 2, barY = height * 0.58;
            const progressBox = this.add.graphics();
            progressBox.fillStyle(0x0d0618, 0.95); progressBox.fillRoundedRect(barX - 4, barY - 4, barWidth + 8, barHeight + 8, 12);
            progressBox.lineStyle(2, 0xe8b54a, 0.8); progressBox.strokeRoundedRect(barX - 4, barY - 4, barWidth + 8, barHeight + 8, 12);
            const progressBar = this.add.graphics();
            const loadingText = this.add.text(width / 2, barY + barHeight + 28, 'Замок просыпается…', {
                fontFamily: F, fontSize: '18px', fontStyle: '700', color: '#c8b0e8', resolution: dpr,
            }).setOrigin(0.5);
            const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
            const tips = isTouch
                ? ['Левый стик — ходьба, правый — прицел и огонь', 'Кнопка рывка спасает от укуса', 'Крадись мимо спящих стражей', 'Сыр — это деньги лавки дядюшки']
                : ['WASD — ходьба, мышь — прицел, ЛКМ — огонь', 'SHIFT — рывок, C — красться, B — бросить книгу', 'Сыр — это деньги лавки дядюшки'];
            const tipText = this.add.text(width / 2, height - 44, tips[Math.floor(Math.random() * tips.length)], {
                fontFamily: F, fontSize: '15px', color: '#8a70b0', resolution: dpr,
            }).setOrigin(0.5);
            this.load.on('progress', (value) => {
                progressBar.clear();
                progressBar.fillStyle(0xe8b54a, 1);
                progressBar.fillRoundedRect(barX, barY, Math.max(8, barWidth * value), barHeight, 10);
                progressBar.fillStyle(0xfff0c0, 0.35);
                progressBar.fillRoundedRect(barX, barY, Math.max(8, barWidth * value), barHeight / 3, 6);
            });

            // Store all UI elements for cleanup
            this.loadingUI = [bg, moon, castle, titleText, subtitleText, progressBox, progressBar, loadingText, tipText];
        }

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
