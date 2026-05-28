// ============================================
// TRANSYLVANIA SCENE - Story mode character preview
// ============================================

export class TransylvaniaScene extends Phaser.Scene {
    constructor() {
        super({ key: 'TransylvaniaScene' });
    }

    preload() {
        const base = 'assets/characters/transylvania/';
        // Load SVGs at 2x render resolution for crisp scaling
        this.load.svg('tr_pi',     base + 'pi.svg',     { width: 400, height: 440 });
        this.load.svg('tr_zombie', base + 'zombie.svg', { width: 480, height: 520 });
        this.load.svg('tr_cat',    base + 'cat.svg',    { width: 440, height: 400 });
        this.load.svg('tr_slime',  base + 'slime.svg',  { width: 480, height: 360 });
    }

    create() {
        this.build();
        this.scale.on('resize', () => this.rebuild());
    }

    rebuild() {
        this.children.removeAll();
        this.tweens.killAll();
        this.build();
    }

    build() {
        const W = this.scale.width;
        const H = this.scale.height;

        this.drawNightSky(W, H);
        this.drawMoon(W * 0.78, H * 0.16);
        this.drawCastleSilhouette(W, H);
        this.drawGround(W, H);

        // Title — scaled to canvas size
        const titleSize = Math.max(28, Math.min(56, W * 0.05));
        this.add.text(W / 2, H * 0.07, 'ЗАМОК ТЕНЕЙ', {
            fontFamily: 'Arial Black, sans-serif',
            fontSize: titleSize + 'px',
            color: '#f0d8ff',
            stroke: '#2a0040',
            strokeThickness: Math.max(4, titleSize * 0.14)
        }).setOrigin(0.5);

        this.add.text(W / 2, H * 0.07 + titleSize * 0.9, 'Превью персонажей', {
            fontFamily: 'Arial, sans-serif',
            fontSize: Math.max(14, titleSize * 0.4) + 'px',
            color: '#b08ad0',
            fontStyle: 'italic'
        }).setOrigin(0.5);

        // Stage characters — scale fits canvas width
        const nativeWidthSum = 200 + 240 + 220 + 240;
        const charScale = Math.min(0.55, (W * 0.86 - 80) / nativeWidthSum);

        const groundY = H - Math.max(120, H * 0.18);
        const slot = W / 4;
        this.placeCharacter('tr_pi',     'Мышонок Пи',      slot * 0.5,   groundY,         charScale, 'idle');
        this.placeCharacter('tr_zombie', 'Зомби-дворецкий', slot * 1.5,   groundY,         charScale, 'sway');
        this.placeCharacter('tr_cat',    'Демон-кот',       slot * 2.5,   groundY,         charScale, 'breathe');
        this.placeCharacter('tr_slime',  'Слайм',           slot * 3.5,   groundY + 8,     charScale, 'wobble');

        // Back button — postMessage to parent if in iframe, else go to MenuScene
        const backBtn = this.add.text(20, 20, '← Меню', {
            fontFamily: 'Arial, sans-serif',
            fontSize: Math.max(16, Math.min(24, W * 0.022)) + 'px',
            color: '#ffffff',
            backgroundColor: '#5a2080',
            padding: { x: 16, y: 8 }
        }).setOrigin(0, 0)
          .setInteractive({ useHandCursor: true })
          .on('pointerover', () => backBtn.setBackgroundColor('#7a30a0'))
          .on('pointerout',  () => backBtn.setBackgroundColor('#5a2080'))
          .on('pointerdown', () => {
              if (window.parent && window.parent !== window) {
                  window.parent.postMessage('closePhaserSnowball', '*');
              } else if (this.scene.manager.keys && this.scene.manager.keys['MenuScene']) {
                  this.scene.start('MenuScene');
              }
          });

        this.spawnStars(W, H * 0.5);
        this.spawnFireflies(W, H);
    }

    // ---------- Background ----------

    drawNightSky(W, H) {
        const gfx = this.add.graphics();
        // Vertical gradient via stacked rects
        const stops = [
            { y: 0,         color: 0x1a0a2e },
            { y: H * 0.35,  color: 0x3a1a5a },
            { y: H * 0.65,  color: 0x5a2a7a },
            { y: H,         color: 0x2a0a3a }
        ];
        for (let i = 0; i < stops.length - 1; i++) {
            const a = stops[i], b = stops[i + 1];
            const steps = 30;
            for (let s = 0; s < steps; s++) {
                const t = s / steps;
                const c = Phaser.Display.Color.Interpolate.ColorWithColor(
                    Phaser.Display.Color.IntegerToColor(a.color),
                    Phaser.Display.Color.IntegerToColor(b.color),
                    1, t
                );
                const col = Phaser.Display.Color.GetColor(c.r, c.g, c.b);
                const y = a.y + (b.y - a.y) * t;
                const yNext = a.y + (b.y - a.y) * ((s + 1) / steps);
                gfx.fillStyle(col, 1);
                gfx.fillRect(0, y, W, yNext - y + 2);
            }
        }
    }

    drawMoon(x, y) {
        // Glow halo
        for (let r = 110; r > 60; r -= 10) {
            const alpha = (110 - r) / 200 + 0.05;
            this.add.circle(x, y, r, 0xffe8a0, alpha);
        }
        // Moon disc
        this.add.circle(x, y, 60, 0xfff4c8);
        // Craters
        this.add.circle(x - 18, y - 10, 8, 0xe8d8a0);
        this.add.circle(x + 12, y + 8, 6, 0xe8d8a0);
        this.add.circle(x + 22, y - 22, 4, 0xe8d8a0);
    }

    drawCastleSilhouette(W, H) {
        const gfx = this.add.graphics();
        gfx.fillStyle(0x180828, 1);
        const baseY = H * 0.62;

        // Far castle silhouette
        gfx.beginPath();
        gfx.moveTo(0, baseY + 40);
        gfx.lineTo(0, baseY);
        gfx.lineTo(W * 0.08, baseY);
        // Tower 1
        gfx.lineTo(W * 0.08, baseY - 90);
        gfx.lineTo(W * 0.11, baseY - 110);
        gfx.lineTo(W * 0.14, baseY - 90);
        gfx.lineTo(W * 0.14, baseY - 30);
        gfx.lineTo(W * 0.22, baseY - 30);
        gfx.lineTo(W * 0.22, baseY - 60);
        gfx.lineTo(W * 0.30, baseY - 60);
        // Big central tower
        gfx.lineTo(W * 0.30, baseY - 140);
        gfx.lineTo(W * 0.34, baseY - 170);
        gfx.lineTo(W * 0.38, baseY - 140);
        gfx.lineTo(W * 0.38, baseY - 60);
        gfx.lineTo(W * 0.50, baseY - 60);
        gfx.lineTo(W * 0.50, baseY - 100);
        gfx.lineTo(W * 0.58, baseY - 100);
        gfx.lineTo(W * 0.58, baseY - 40);
        // Right tower
        gfx.lineTo(W * 0.72, baseY - 40);
        gfx.lineTo(W * 0.72, baseY - 130);
        gfx.lineTo(W * 0.76, baseY - 150);
        gfx.lineTo(W * 0.80, baseY - 130);
        gfx.lineTo(W * 0.80, baseY - 50);
        gfx.lineTo(W * 0.92, baseY - 50);
        gfx.lineTo(W * 0.92, baseY);
        gfx.lineTo(W, baseY);
        gfx.lineTo(W, baseY + 40);
        gfx.closePath();
        gfx.fillPath();

        // Tiny lit windows
        const windows = [
            [W * 0.11, baseY - 70],
            [W * 0.34, baseY - 100],
            [W * 0.34, baseY - 60],
            [W * 0.54, baseY - 80],
            [W * 0.76, baseY - 95]
        ];
        windows.forEach(([wx, wy]) => {
            this.add.rectangle(wx, wy, 6, 8, 0xffc060);
        });

        // Bats
        for (let i = 0; i < 4; i++) {
            const bx = Phaser.Math.Between(W * 0.2, W * 0.85);
            const by = Phaser.Math.Between(180, 280);
            this.drawBat(bx, by);
        }
    }

    drawBat(x, y) {
        const bat = this.add.graphics();
        bat.lineStyle(2, 0x180828, 1);
        bat.fillStyle(0x180828, 1);
        // Body
        bat.fillCircle(0, 0, 3);
        // Wings (simple "m" shape)
        bat.beginPath();
        bat.moveTo(-3, 0);
        bat.lineTo(-12, -5);
        bat.lineTo(-8, 2);
        bat.lineTo(-3, 0);
        bat.closePath();
        bat.fillPath();
        bat.beginPath();
        bat.moveTo(3, 0);
        bat.lineTo(12, -5);
        bat.lineTo(8, 2);
        bat.lineTo(3, 0);
        bat.closePath();
        bat.fillPath();
        bat.setPosition(x, y);

        // Slight float motion
        this.tweens.add({
            targets: bat,
            x: x + Phaser.Math.Between(-40, 40),
            y: y + Phaser.Math.Between(-20, 20),
            duration: Phaser.Math.Between(3000, 5000),
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
    }

    drawGround(W, H) {
        const gfx = this.add.graphics();
        const groundTop = H - 160;
        // Foreground ground
        gfx.fillStyle(0x2a1240, 1);
        gfx.fillRect(0, groundTop, W, H - groundTop);
        // Highlight strip
        gfx.fillStyle(0x4a2060, 1);
        gfx.fillRect(0, groundTop, W, 6);
        // Gravestones (decorative)
        this.drawGravestone(W * 0.07, groundTop);
        this.drawGravestone(W * 0.95, groundTop);
        // Small mushrooms
        for (let i = 0; i < 6; i++) {
            const mx = Phaser.Math.Between(40, W - 40);
            const my = groundTop + Phaser.Math.Between(40, 120);
            this.drawMushroom(mx, my);
        }
    }

    drawGravestone(x, topY) {
        const gfx = this.add.graphics();
        gfx.fillStyle(0x4a3858, 1);
        gfx.lineStyle(3, 0x1a1024, 1);
        gfx.fillRoundedRect(x - 22, topY - 60, 44, 70, { tl: 22, tr: 22, bl: 0, br: 0 });
        gfx.strokeRoundedRect(x - 22, topY - 60, 44, 70, { tl: 22, tr: 22, bl: 0, br: 0 });
        // RIP text
        this.add.text(x, topY - 35, 'RIP', {
            fontFamily: 'Arial Black, sans-serif',
            fontSize: '14px',
            color: '#1a1024'
        }).setOrigin(0.5);
    }

    drawMushroom(x, y) {
        const gfx = this.add.graphics();
        gfx.fillStyle(0xf0f0e0, 1);
        gfx.fillRect(x - 3, y - 4, 6, 8);
        gfx.fillStyle(0xd03060, 1);
        gfx.lineStyle(1.5, 0x1a1024, 1);
        gfx.fillCircle(x, y - 6, 7);
        gfx.strokeCircle(x, y - 6, 7);
        gfx.fillStyle(0xfff0f0, 1);
        gfx.fillCircle(x - 3, y - 7, 1.5);
        gfx.fillCircle(x + 2, y - 5, 1);
    }

    // ---------- Characters ----------

    placeCharacter(key, label, x, y, scale, animMode) {
        const sprite = this.add.image(x, y, key).setOrigin(0.5, 1).setScale(scale);

        // Drop shadow
        const shadow = this.add.ellipse(x, y + 4, sprite.displayWidth * 0.55, 14, 0x000000, 0.45);
        shadow.setDepth(sprite.depth - 1);

        // Label plaque
        const labelBg = this.add.rectangle(x, y + 36, 0, 32, 0x2a0a3a, 0.85)
            .setStrokeStyle(2, 0x9a6cc4);
        const labelText = this.add.text(x, y + 36, label, {
            fontFamily: 'Arial Black, sans-serif',
            fontSize: '20px',
            color: '#f0d8ff'
        }).setOrigin(0.5);
        labelBg.width = labelText.width + 24;

        // Animation
        this.applyIdleAnim(sprite, shadow, animMode);
    }

    applyIdleAnim(sprite, shadow, mode) {
        const baseScaleX = sprite.scaleX;
        const baseScaleY = sprite.scaleY;
        const baseY = sprite.y;
        const baseShadowW = shadow.width;

        if (mode === 'idle') {
            // Mousie: light bounce + ear wiggle
            this.tweens.add({
                targets: sprite,
                y: baseY - 6,
                scaleY: baseScaleY * 0.97,
                scaleX: baseScaleX * 1.03,
                duration: 600,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });
            this.tweens.add({
                targets: shadow,
                scaleX: 0.85,
                alpha: 0.5,
                duration: 600,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });
        } else if (mode === 'sway') {
            // Zombie: tilt side to side (T-pose scarecrow swaying)
            sprite.setOrigin(0.5, 0.95);
            this.tweens.add({
                targets: sprite,
                angle: -4,
                duration: 1400,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });
            this.tweens.add({
                targets: sprite,
                y: baseY - 2,
                duration: 700,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });
        } else if (mode === 'breathe') {
            // Cat: slow breathing scale pulse
            this.tweens.add({
                targets: sprite,
                scaleX: baseScaleX * 1.04,
                scaleY: baseScaleY * 0.96,
                duration: 1100,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });
        } else if (mode === 'wobble') {
            // Slime: jiggle wobble (heavy squash & stretch)
            this.tweens.add({
                targets: sprite,
                scaleX: baseScaleX * 1.08,
                scaleY: baseScaleY * 0.88,
                duration: 800,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });
            this.tweens.add({
                targets: shadow,
                scaleX: 1.1,
                duration: 800,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });
        }
    }

    // ---------- Atmosphere ----------

    spawnStars(W, maxY) {
        for (let i = 0; i < 60; i++) {
            const x = Phaser.Math.Between(0, W);
            const y = Phaser.Math.Between(0, maxY);
            const size = Phaser.Math.FloatBetween(0.8, 2.2);
            const star = this.add.circle(x, y, size, 0xffffff, Phaser.Math.FloatBetween(0.4, 1));
            this.tweens.add({
                targets: star,
                alpha: 0.1,
                duration: Phaser.Math.Between(1500, 3500),
                yoyo: true,
                repeat: -1,
                delay: Phaser.Math.Between(0, 2000)
            });
        }
    }

    spawnFireflies(W, H) {
        for (let i = 0; i < 12; i++) {
            const x = Phaser.Math.Between(100, W - 100);
            const y = Phaser.Math.Between(H * 0.55, H - 200);
            const fly = this.add.circle(x, y, 3, 0xb4ff70, 0.9);
            const glow = this.add.circle(x, y, 8, 0xb4ff70, 0.2);

            const path = () => {
                const nx = x + Phaser.Math.Between(-150, 150);
                const ny = y + Phaser.Math.Between(-80, 80);
                this.tweens.add({
                    targets: [fly, glow],
                    x: nx,
                    y: ny,
                    duration: Phaser.Math.Between(2500, 4500),
                    ease: 'Sine.easeInOut',
                    onComplete: path
                });
            };
            path();

            this.tweens.add({
                targets: [fly, glow],
                alpha: 0.2,
                duration: Phaser.Math.Between(800, 1400),
                yoyo: true,
                repeat: -1
            });
        }
    }
}
