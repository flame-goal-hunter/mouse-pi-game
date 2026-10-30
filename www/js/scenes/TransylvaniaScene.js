// ============================================
// TRANSYLVANIA MENU - Character preview + Start + SHOP
// Shows characters; player clicks Start to enter dungeon, or visits Shop
// ============================================

import { Progress, SKINS, PERMANENT_UPGRADES } from '../storage/ProgressStore.js';
import { bus } from '../audio/EventBus.js';
import { UI, BGM } from '../audio/SoundKeys.js';
import {
    C, CS, S, R, STROKE, FONT, TXT, EASE, DUR, STAGGER, SHADOW,
    hex, drawPanel, makeButton, staggerIn,
} from '../ui/theme.js';

export class TransylvaniaScene extends Phaser.Scene {
    constructor() {
        super({ key: 'TransylvaniaScene' });
    }

    init(data) {
        this._autoOpenShop = !!(data && data.openShop);
    }

    preload() {
        const base = 'assets/characters/transylvania/';
        this.load.svg('m_pi',     base + 'pi.svg',     { width: 400, height: 460 });
        this.load.svg('m_zombie', base + 'zombie.svg', { width: 480, height: 560 });
        this.load.svg('m_cat',    base + 'cat.svg',    { width: 440, height: 400 });
        this.load.svg('m_slime',  base + 'slime.svg',  { width: 480, height: 360 });
        // Pi skins for shop previews — nested under transylvania/skins
        const skinBase = 'assets/characters/transylvania/skins/';
        this.load.svg('m_skin_brown',         skinBase + 'brown.svg',         { width: 180, height: 207 });
        this.load.svg('m_skin_pink',          skinBase + 'pink.svg',          { width: 180, height: 207 });
        this.load.svg('m_skin_yellow_antler', skinBase + 'yellow-antler.svg', { width: 180, height: 207 });
        this.load.svg('m_skin_robot',         skinBase + 'robot.svg',         { width: 180, height: 207 });
        this.load.svg('m_skin_green_monster', skinBase + 'green-monster.svg', { width: 180, height: 207 });
        this.load.svg('m_skin_shadow',        skinBase + 'shadow.svg',        { width: 180, height: 207 });
        this.load.svg('m_skin_devil',         skinBase + 'devil.svg',         { width: 180, height: 207 });
        this.load.svg('m_skin_angel',         skinBase + 'angel.svg',         { width: 180, height: 207 });
        this.load.svg('m_skin_yellow_lion',   skinBase + 'yellow-lion.svg',   { width: 180, height: 207 });
        this.load.svg('m_skin_bear',          skinBase + 'bear.svg',          { width: 180, height: 207 });
        this.load.svg('m_skin_frog',          skinBase + 'frog.svg',          { width: 180, height: 207 });
        this.load.svg('m_skin_professor',     skinBase + 'professor.svg',     { width: 180, height: 207 });
        this.load.svg('m_skin_pirate',        skinBase + 'pirate.svg',        { width: 180, height: 207 });
        this.load.svg('m_skin_astronaut',     skinBase + 'astronaut.svg',     { width: 180, height: 207 });
        this.load.svg('m_skin_kitty',         skinBase + 'kitty.svg',         { width: 180, height: 207 });
        this.load.svg('m_skin_beaver',        skinBase + 'beaver.svg',        { width: 180, height: 207 });
        this.load.svg('m_skin_cockroach',     skinBase + 'cockroach.svg',     { width: 180, height: 207 });
        // Icon kit — same SVGs the dungeon HUD uses, at UI resolution
        const uiPx = Math.round(64 * (window.__GAME_DPR || 1));
        for (const n of ['heart', 'bolt', 'dash', 'flame']) {
            this.load.svg('ui_' + n, `assets/ui/${n}.svg`, { width: uiPx, height: uiPx });
        }
        this.load.svg('relic_gift', 'assets/relics/gift.svg', { width: uiPx, height: uiPx });
        this.load.svg('ui_cheese',  base + 'cheese.svg',      { width: uiPx, height: uiPx });
        this.load.svg('m_grandma',  base + 'grandma.svg',     { width: 180, height: 200 });
    }

    _menuIcon(x, y, key, box) {
        const k = this.textures.exists(key) ? key : 'ui_cheese';
        const img = this.add.image(x, y, k);
        const src = this.textures.get(k).getSourceImage();
        const f = box / Math.max(1, src.width, src.height);
        img.setDisplaySize(Math.round(src.width * f), Math.round(src.height * f));
        return img;
    }

    create() {
        // Device-pixel canvas (main.js, transylvania mode): zoom about the origin so scene coords stay CSS px
        // for both scrollFactor-0 and scrollFactor-1 objects; inject Text resolution (3.70 ignores the config value).
        this.dpr = window.__GAME_DPR || 1;
        this.cameras.main.setOrigin(0, 0);
        this.cameras.main.setZoom(this.dpr);
        if (!this.add._origText) this.add._origText = this.add.text;
        const scene = this;
        this.add.text = function (x, y, text, style) {
            return scene.add._origText.call(this, x, y, text, Object.assign({}, style || {}, { resolution: scene.dpr }));
        };
        // Diagnostic: disable input polling on move (research recommendation).
        try { this.input.setPollOnMove?.(false); } catch (e) {}

        this.build();

        // === DIAGNOSTIC FPS COUNTER (top-center, big, visible) ===
        // Shows real-time fps. If this drops below 30, something is throttling Phaser.
        this._fpsText = this.add.text(this.viewW / 2, 4, 'fps ?', {
            fontFamily: 'monospace', fontSize: '12px',
            color: '#80ff80', backgroundColor: '#000000', padding: { x: 6, y: 2 },
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(10000);
        this._fpsLastUpdate = 0;
        this._fpsFrames = 0;
        // Debounce resize — Android URL-bar show/hide fires a storm of resize events
        // that would otherwise call rebuild() many times per second. We only rebuild
        // 250ms after the LAST resize, and skip rebuilds for tiny changes (<24px).
        this._lastW = this.viewW;
        this._lastH = this.viewH;
        const onResize = () => {
            const W = this.viewW, H = this.viewH;
            if (Math.abs(W - this._lastW) < 24 && Math.abs(H - this._lastH) < 24) return;
            if (this._resizeTimer) clearTimeout(this._resizeTimer);
            this._resizeTimer = setTimeout(() => {
                this._lastW = this.viewW;
                this._lastH = this.viewH;
                this.rebuild();
            }, 250);
        };
        this.scale.on('resize', onResize);
        // This legacy menu scene plays no music; the HTML hub owns the menu loop.
        // The hub owns the menu loop whichever way it was entered (boot, exit, win, lose overlay).
        try { bus.emit(BGM.MENU); } catch (e) {}
        this.events.once('shutdown', () => {
            this.scale.off('resize', onResize);
            if (this._resizeTimer) clearTimeout(this._resizeTimer);
            try { window.audio?.stopBgmPreset?.(); } catch (e) {}
        });
    }

    update(time, dt) {
        // Lightweight FPS counter — updates label every 500ms.
        this._fpsFrames++;
        if (time - this._fpsLastUpdate > 500) {
            const fps = Math.round(this._fpsFrames * 1000 / (time - this._fpsLastUpdate));
            const gameLoopFps = Math.round(this.game.loop.actualFps);
            const tweenCount = this.tweens.getTweens().length;
            const objCount = this.children.list.length;
            if (this._fpsText) {
                this._fpsText.setText(
                    `fps ${fps} (loop ${gameLoopFps}) · tw ${tweenCount} · obj ${objCount}`
                );
                // Color-code: green ≥50, yellow 30-49, red <30
                this._fpsText.setColor(fps >= 50 ? '#80ff80' : (fps >= 30 ? '#ffe080' : '#ff8080'));
            }
            this._fpsLastUpdate = time;
            this._fpsFrames = 0;
        }
    }

    get viewW() { return this.scale.width / (this.dpr || 1); }
    get viewH() { return this.scale.height / (this.dpr || 1); }

    rebuild() {
        this.children.removeAll();
        this.tweens.killAll();
        this.build();
    }

    // === GOTHIC UI HELPERS ===
    drawGothicPanel(cx, cy, w, h, opts = {}) {
        const accent = opts.accent || 0xd49920;
        const bgTop = opts.bgTop || 0x3a1248;
        const bgBot = opts.bgBot || 0x18062a;
        const radius = opts.radius != null ? opts.radius : 18;
        const D = opts.depth || 500;
        const out = [];
        const shadow = this.add.graphics().setScrollFactor(0).setDepth(D - 2);
        shadow.fillStyle(0x000000, 0.55);
        shadow.fillRoundedRect(cx - w/2 + 8, cy - h/2 + 10, w, h, radius);
        out.push(shadow);
        const panel = this.add.graphics().setScrollFactor(0).setDepth(D - 1);
        panel.fillGradientStyle(bgTop, bgTop, bgBot, bgBot, 1);
        panel.fillRoundedRect(cx - w/2, cy - h/2, w, h, radius);
        panel.fillStyle(0xffffff, 0.06);
        panel.fillRoundedRect(cx - w/2 + 4, cy - h/2 + 4, w - 8, h * 0.45, radius - 4);
        panel.lineStyle(4, accent, 1);
        panel.strokeRoundedRect(cx - w/2, cy - h/2, w, h, radius);
        panel.lineStyle(1.5, 0xfff0a0, 0.55);
        panel.strokeRoundedRect(cx - w/2 + 5, cy - h/2 + 5, w - 10, h - 10, radius - 5);
        out.push(panel);
        const cornerCurl = (x, y, side) => {
            const c = this.add.graphics().setScrollFactor(0).setDepth(D);
            c.fillStyle(accent, 1);
            c.fillCircle(x, y, 6);
            c.fillStyle(0x1a0820, 1);
            c.fillCircle(x, y, 2.5);
            c.lineStyle(2, accent, 0.95);
            const r = 10;
            const startA = side === 0 ? Math.PI : (side === 1 ? -Math.PI / 2 : (side === 2 ? Math.PI / 2 : 0));
            c.beginPath();
            c.arc(x, y, r, startA, startA + Math.PI / 2);
            c.strokePath();
            out.push(c);
        };
        const inset = 14;
        cornerCurl(cx - w/2 + inset, cy - h/2 + inset, 0);
        cornerCurl(cx + w/2 - inset, cy - h/2 + inset, 1);
        cornerCurl(cx - w/2 + inset, cy + h/2 - inset, 2);
        cornerCurl(cx + w/2 - inset, cy + h/2 - inset, 3);
        const themes = opts.theme || [];
        if (opts.themed !== false && themes.length) {
            const corners = [
                { x: cx - w/2 + 30, y: cy - h/2 + 30 },
                { x: cx + w/2 - 30, y: cy - h/2 + 30 },
                { x: cx - w/2 + 30, y: cy + h/2 - 30 },
                { x: cx + w/2 - 30, y: cy + h/2 - 30 }
            ];
            for (let i = 0; i < 4; i++) {
                const t = this.add.text(corners[i].x, corners[i].y, themes[i % themes.length],
                    { fontSize: '24px' }).setOrigin(0.5)
                    .setScrollFactor(0).setDepth(D + 1).setAlpha(0.55);
                out.push(t);
            }
        }
        return out;
    }

    drawGothicButton(cx, cy, w, h, label, opts = {}) {
        const colorBase = opts.color || 0x7a30a0;
        const colorTop  = opts.colorTop || 0xa050d0;
        const accent = opts.accent || 0xffd040;
        const hoverTop = opts.hoverTop || 0xc070e0;
        const hoverBase = opts.hover || 0x9a50c0;
        const radius = opts.radius != null ? opts.radius : 14;
        const D = opts.depth || 500;
        const out = [];
        // Draw in LOCAL coords (centered at 0,0), then setPosition(cx,cy).
        // This makes setScale pivot around the button center — fixes drift on pulse tween.
        const shadow = this.add.graphics().setScrollFactor(0).setDepth(D - 1);
        shadow.fillStyle(0x000000, 0.55);
        shadow.fillRoundedRect(-w/2 + 4, -h/2 + 5, w, h, radius);
        shadow.setPosition(cx, cy);
        out.push(shadow);
        const body = this.add.graphics().setScrollFactor(0).setDepth(D);
        const drawBody = (top, bot) => {
            body.clear();
            body.fillGradientStyle(top, top, bot, bot, 1);
            body.fillRoundedRect(-w/2, -h/2, w, h, radius);
            body.fillStyle(0xffffff, 0.18);
            body.fillRoundedRect(-w/2 + 4, -h/2 + 4, w - 8, h * 0.42, radius - 3);
            body.lineStyle(3, accent, 0.95);
            body.strokeRoundedRect(-w/2, -h/2, w, h, radius);
        };
        drawBody(colorTop, colorBase);
        body.setPosition(cx, cy);
        out.push(body);
        const fontSize = opts.fontSize || Math.max(16, Math.round(h * 0.4));
        const text = this.add.text(cx, cy, label, {
            fontFamily: 'Arial Black', fontSize: fontSize + 'px',
            color: '#ffffff', stroke: '#1a0a3a', strokeThickness: 3, align: 'center'
        }).setOrigin(0.5).setScrollFactor(0).setDepth(D + 1);
        const hit = this.add.rectangle(cx, cy, w, h, 0xffffff, 0.001)
            .setScrollFactor(0).setDepth(D + 2)
            .setInteractive({ useHandCursor: true })
            .on('pointerover', () => drawBody(hoverTop, hoverBase))
            .on('pointerout',  () => drawBody(colorTop, colorBase))
            .on('pointerdown', () => {
                this.tweens.add({
                    targets: [body, text, shadow], scaleX: 0.96, scaleY: 0.96,
                    duration: 80, yoyo: true, ease: 'Quad.easeOut',
                    onComplete: () => { if (opts.onClick) opts.onClick(); }
                });
            });
        out.push(text, hit);
        return out;
    }

    // ============================================
    // VERTICAL LAYOUT — clean, readable, mobile-first.
    //
    // Stack from top to bottom:
    //   [HEADER]    Back ‹                 cheese balance
    //   [TITLE]     ЗАМОК ТЕНЕЙ
    //               — • —
    //               Глава 1 · Подземелье графа Ратулы
    //   [HERO]      Single big skin sprite, idle bob
    //               Skin name pill
    //   [STORY]     grandma icon · СПАСТИ БАБУШКУ
    //               5 этажей · босс
    //   [ENDLESS]   ∞ БЕСКОНЕЧНЫЙ СПУСК         ▸
    //               Лучший этаж: 8
    //   [FOOTER]    ЛАВКА      КОДЕКС
    //
    // No overlaps. Every block has guaranteed vertical space.
    // ============================================
    build() {
        const W = this.viewW;
        const H = this.viewH;
        const cx = W / 2;

        // === Layout constants — proportional to height, clamped sensibly ===
        const HEADER_H = 60;
        const FOOTER_H = 56;
        const FOOTER_PAD = 12;
        const cardH = Math.max(50, Math.min(86, H * 0.095));
        const cardGap = 6;
        const cardsTotal = cardH * 3 + cardGap * 2;
        const titleSize = Math.max(28, Math.min(46, W * 0.072));
        const titleBlockH = titleSize + 36;   // title + rule + subtitle
        const heroBlockH = Math.max(90, H - HEADER_H - titleBlockH - cardsTotal - FOOTER_H - FOOTER_PAD - 40);

        // === BACKGROUND — MINIMAL (perf-first)
        // Two solid rects + one circle. No 120-strip gradient, no castle silhouette,
        // no stars, no decorations. If menu lags now, the cause is elsewhere.
        const bg = this.add.graphics();
        // Top half — deep gothic violet
        bg.fillStyle(0x1d0b2e, 1);
        bg.fillRect(0, 0, W, H * 0.55);
        // Bottom half — slightly different solid color
        bg.fillStyle(0x12061f, 1);
        bg.fillRect(0, H * 0.55, W, H * 0.45);
        // Moon — single circle
        bg.fillStyle(0xfff4c8, 1);
        bg.fillCircle(W * 0.82, H * 0.16, 50);
        bg.fillStyle(0xffe8a0, 0.18);
        bg.fillCircle(W * 0.82, H * 0.16, 80);

        // === [HEADER] — Back + Balance ===
        this._buildHeader(W, HEADER_H);

        // === [TITLE] — gothic display ===
        const titleCy = HEADER_H + Math.max(24, titleSize * 0.7);
        const ttext = this.add.text(cx, titleCy, 'ЗАМОК ТЕНЕЙ', {
            fontFamily: FONT.display,
            fontSize: titleSize + 'px',
            color: hex(C.accent),
            stroke: hex(C.bgVoid),
            strokeThickness: Math.max(5, titleSize * 0.12),
            fontStyle: '900',
            align: 'center',
        }).setOrigin(0.5).setDepth(420);

        // Thin gold rule under title with center diamond
        const ruleY = titleCy + titleSize * 0.62 + 4;
        const ruleHalf = Math.min(W * 0.32, titleSize * 2.6);
        const rule = this.add.graphics().setDepth(420);
        rule.lineStyle(STROKE.thin, C.accent, 0.85);
        rule.lineBetween(cx - ruleHalf, ruleY, cx - 14, ruleY);
        rule.lineBetween(cx + 14, ruleY, cx + ruleHalf, ruleY);
        rule.fillStyle(C.accent, 1);
        rule.fillCircle(cx, ruleY, 3);

        // Subtitle
        this.add.text(cx, ruleY + 18, 'Глава 1 · Подземелье графа Ратулы', {
            fontFamily: FONT.body,
            fontSize: Math.max(11, titleSize * 0.28) + 'px',
            color: hex(C.textSecond),
            fontStyle: 'italic',
        }).setOrigin(0.5).setDepth(420);

        // === [HERO] — single big skin sprite, centered ===
        const heroBlockTop = HEADER_H + titleBlockH + 8;
        const heroBlockBot = heroBlockTop + heroBlockH;
        this._buildHero(cx, heroBlockTop, heroBlockBot);

        // === [CARDS + FOOTER] anchored to bottom ===
        const sStat = (Progress.getStoryStats ? Progress.getStoryStats() : null) || { wins: 0 };
        const eStat = (Progress.getEndlessStats ? Progress.getEndlessStats() : null) || { bestFloor: 0 };
        const nStat = (Progress.getSneakStats ? Progress.getSneakStats() : null) || { clears: 0 };

        const footerCy = H - FOOTER_PAD - FOOTER_H / 2;
        const sneakCy   = footerCy - FOOTER_H / 2 - 24 - cardH / 2;
        const endlessCy = sneakCy - cardH - cardGap;
        const storyCy   = endlessCy - cardH - cardGap;
        const cardW = Math.min(W * 0.88, 440);

        const startRun = (runMode) => {
            try { bus.emit(UI.BUTTON_CLICK); } catch (e) {}
            try { if (Progress.setLastRunMode) Progress.setLastRunMode(runMode); } catch (e) {}
            this.cameras.main.fadeOut(280, 0, 0, 0);
            this.cameras.main.once('camerafadeoutcomplete', () =>
                this.scene.start('DungeonScene', { runMode, chapter: 1 }));
        };

        this._buildModeCard(cx, storyCy, cardW, cardH, {
            iconKey: 'm_grandma',
            title: 'СПАСТИ БАБУШКУ',
            hint: sStat.wins > 0 ? `Спасений: ${sStat.wins}` : '5 этажей · босс · спасение',
            accent: C.accent, titleColor: C.accentSoft,
            bg: 0x2d104a,
            chevron: true,
            onClick: () => startRun('story'),
        });
        this._buildModeCard(cx, endlessCy, cardW, cardH, {
            icon: '∞',
            title: 'БЕСКОНЕЧНЫЙ СПУСК',
            hint: eStat.bestFloor > 0 ? `Лучший этаж: ${eStat.bestFloor}` : 'Спускайся вечно · растущая сложность',
            accent: C.danger, titleColor: 0xffd2c8,
            bg: 0x300c10,
            chevron: true,
            onClick: () => startRun('endless'),
        });
        this._buildModeCard(cx, sneakCy, cardW, cardH, {
            icon: '🐾',
            title: 'ТИХАЯ ЛАПКА',
            hint: nStat.clears > 0 ? `Ночей пройдено: ${nStat.clears}` : 'Прячься · не дерись · унеси добычу',
            accent: 0x80c090, titleColor: 0xc8e8d0,
            bg: 0x0f2a1c,
            chevron: true,
            onClick: () => {
                try { bus.emit(UI.BUTTON_CLICK); } catch (e) {}
                this.cameras.main.fadeOut(280, 0, 0, 0);
                this.cameras.main.once('camerafadeoutcomplete', () =>
                    this.scene.start('SneakScene', { roomIndex: 0 }));
            },
        });

        this._buildFooterRow(cx, footerCy, cardW);

        // Visible build tag (bottom-left, tiny) — proves which APK you're running.
        this.add.text(6, H - 14, (window.__BUILD_VERSION__ || 'unknown'), {
            fontFamily: 'monospace', fontSize: '9px',
            color: '#7a6a92',
        }).setOrigin(0, 0.5).setDepth(9999).setAlpha(0.55);

        // Single scene fade-in
        this.cameras.main.fadeIn(400, 0, 0, 0);

        if (this._autoOpenShop) {
            this._autoOpenShop = false;
            this.time.delayedCall(420, () => this.openShop());
        }
    }

    // ============================================
    // BLOCK BUILDERS — each is one cohesive UI band
    // ============================================

    _buildHeader(W, headerH) {
        // Subtle bottom-divider line under header strip
        const sep = this.add.graphics().setDepth(498);
        sep.lineStyle(1, C.borderSoft, 0.4);
        sep.lineBetween(S.md, headerH, W - S.md, headerH);

        // Back button (left)
        const backBtn = makeButton(this, S.md + 50, headerH / 2, 96, 38, 'Меню', {
            variant: 'ghost', icon: '‹', textSize: '13px', depth: 500,
            clickEvent: 'ui.button.back',
            onClick: () => {
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage('closePhaserSnowball', '*');
                } else if (this.scene.manager.keys && this.scene.manager.keys['MenuScene']) {
                    this.scene.start('MenuScene');
                }
            }
        });

        // Balance pill (right)
        const balance = Progress.getCheese();
        const balText = String(balance);
        const pillW = Math.max(96, 60 + balText.length * 14);
        const pillH = 36;
        const pillCx = W - S.md - pillW / 2;
        const pillCy = headerH / 2;

        const g = this.add.graphics().setDepth(500);
        g.fillStyle(C.bgVoid, 0.45);
        g.fillRoundedRect(pillCx - pillW/2 + 1, pillCy - pillH/2 + 2, pillW, pillH, R.pill);
        g.fillStyle(C.bgPanel, 0.92);
        g.fillRoundedRect(pillCx - pillW/2, pillCy - pillH/2, pillW, pillH, R.pill);
        g.lineStyle(STROKE.thin, C.accent, 0.85);
        g.strokeRoundedRect(pillCx - pillW/2, pillCy - pillH/2, pillW, pillH, R.pill);

        this._menuIcon(pillCx - pillW/2 + 18, pillCy, 'ui_cheese', 22).setDepth(501);
        this.add.text(pillCx + 10, pillCy, balText, {
            fontFamily: FONT.display, fontSize: '18px',
            color: hex(C.accentSoft), fontStyle: '900',
        }).setOrigin(0.5).setDepth(501);
    }

    _buildHero(cx, top, bot) {
        const skin = Progress.getCurrentSkin();
        const previewKey = (skin?.menuKey && this.textures.exists(skin.menuKey)) ? skin.menuKey : 'm_pi';
        const heroH = bot - top;

        // Determine sprite scale — fit ~80% of the hero block height. Below a
        // cramped block (short landscape viewports) the 140 floor would push the
        // sprite into the title/cards above and below it, so it scales down too.
        const targetH = heroH < 120 ? Math.max(50, heroH * 0.78) : Math.max(140, heroH * 0.78);
        // Source SVG heights vary per character (Pi 460, skins 207)
        // Use texture dimensions for a faithful scale
        const tex = this.textures.get(previewKey);
        const srcH = (tex && tex.source && tex.source[0]) ? tex.source[0].height : 460;
        const scale = targetH / srcH;

        // Position: sprite bottom anchored slightly above the bottom of the block
        // so the name pill below has room.
        const pillSpace = 36;
        const spriteBottomY = bot - pillSpace;

        // Soft elliptical shadow under hero
        const shadowG = this.add.graphics().setDepth(150);
        shadowG.fillStyle(C.bgVoid, 0.55);
        // Width approximation — half sprite displayWidth
        const shadowW = (tex && tex.source && tex.source[0])
            ? tex.source[0].width * scale * 0.55
            : 120;
        shadowG.fillEllipse(cx, spriteBottomY + 4, shadowW, 18);

        const sprite = this.add.image(cx, spriteBottomY, previewKey)
            .setOrigin(0.5, 1)
            .setScale(scale)
            .setDepth(160);

        // Skin tint mood for shadow/angel/etc.
        if (skin?.id === 'shadow') sprite.setAlpha(0.85);
        if (skin?.id === 'angel') sprite.setAlpha(0.95);

        // NO idle tween — even one infinite tween can be a frame source on some Android WebViews.
        // Static hero is the safest baseline.

        // Skin name pill under sprite
        const skinName = skin?.name || 'Мышонок Пи';
        const labelText = this.add.text(cx, bot - 14, skinName, {
            fontFamily: FONT.body, fontSize: '13px',
            color: hex(C.textPrimary), fontStyle: '700',
        }).setOrigin(0.5).setDepth(161);
        const lpw = labelText.width + 22;
        const lph = 26;
        const labelG = this.add.graphics().setDepth(160);
        labelG.fillStyle(C.bgDeep, 0.88);
        labelG.fillRoundedRect(cx - lpw/2, bot - 14 - lph/2, lpw, lph, R.pill);
        labelG.lineStyle(STROKE.hairline, C.accent, 0.5);
        labelG.strokeRoundedRect(cx - lpw/2, bot - 14 - lph/2, lpw, lph, R.pill);
    }

    _buildModeCard(cx, cy, w, h, opts) {
        // Solid fill card (no gradient at runtime). Hover/press = alpha+scale tween only.
        const left = cx - w/2;

        const body = this.add.graphics().setDepth(499);
        // Drop shadow
        body.fillStyle(C.bgVoid, 0.55);
        body.fillRoundedRect(left + 2, cy - h/2 + 5, w, h, R.lg);
        // Body
        body.fillStyle(opts.bg, 1);
        body.fillRoundedRect(left, cy - h/2, w, h, R.lg);
        // Accent stripe (left edge)
        body.fillStyle(opts.accent, 1);
        body.fillRoundedRect(left, cy - h/2, 6, h, { tl: R.lg, bl: R.lg, tr: 0, br: 0 });
        // Border
        body.lineStyle(STROKE.thin, opts.accent, 0.85);
        body.strokeRoundedRect(left, cy - h/2, w, h, R.lg);

        // Icon (left) — a sprite when the card names one, otherwise a glyph
        const iconSize = h > 80 ? 32 : 28;
        // A sprite goes in a container so the card's scale tweens don't fight setDisplaySize
        const icon = opts.iconKey
            ? this.add.container(left + 38, cy,
                [this._menuIcon(0, 0, opts.iconKey, Math.round(iconSize * 1.3))]).setDepth(500)
            : this.add.text(left + 38, cy, opts.icon,
                { fontSize: iconSize + 'px' }).setOrigin(0.5).setDepth(500);

        // Title + hint stack
        const titleSize = h > 80 ? 18 : 16;
        const hintSize  = h > 80 ? 12 : 11;
        const title = this.add.text(left + 76, cy - 11, opts.title, {
            fontFamily: FONT.display, fontSize: titleSize + 'px',
            color: hex(opts.titleColor),
            fontStyle: '900',
            stroke: hex(C.bgVoid), strokeThickness: 3,
        }).setOrigin(0, 0.5).setDepth(500);
        const hint = this.add.text(left + 76, cy + 12, opts.hint, {
            fontFamily: FONT.body, fontSize: hintSize + 'px',
            color: hex(C.textSecond), fontStyle: '500',
        }).setOrigin(0, 0.5).setDepth(500);

        // Chevron (right) — affordance for "tap to enter"
        if (opts.chevron) {
            this.add.text(left + w - 22, cy, '›', {
                fontFamily: FONT.display, fontSize: '26px',
                color: hex(opts.accent), fontStyle: '900',
            }).setOrigin(0.5).setDepth(500);
        }

        // Hit zone + tactile feedback
        const group = [body, icon, title, hint];
        const hit = this.add.zone(cx, cy, w, h)
            .setInteractive({ useHandCursor: true }).setDepth(501);
        hit.on('pointerover', () => {
            this.tweens.add({ targets: group, alpha: 1, scale: 1.015, duration: 130, ease: 'Cubic.easeOut' });
        });
        hit.on('pointerout', () => {
            this.tweens.add({ targets: group, alpha: 0.94, scale: 1, duration: 130, ease: 'Cubic.easeOut' });
        });
        let isDown = false;
        hit.on('pointerdown', () => {
            isDown = true;
            this.tweens.add({ targets: group, scale: 0.97, duration: 70, ease: 'Cubic.easeOut' });
        });
        hit.on('pointerup', () => {
            if (!isDown) return; isDown = false;
            this.tweens.add({ targets: group, scale: 1.02, duration: 120, ease: 'Back.easeOut' });
            try { bus.emit(UI.BUTTON_CLICK); } catch (e) {}
            opts.onClick();
        });
        group.forEach(g => g.setAlpha(0.94));
    }

    _buildFooterRow(cx, cy, totalW) {
        const gap = 12;
        const btnW = (totalW - gap) / 2;
        const btnH = 50;

        makeButton(this, cx - btnW/2 - gap/2, cy, btnW, btnH, 'ЛАВКА', {
            variant: 'secondary', textSize: '15px',
            depth: 500, clickEvent: 'ui.menu.open',
            onClick: () => this.openShop(),
        });
        makeButton(this, cx + btnW/2 + gap/2, cy, btnW, btnH, 'КОДЕКС', {
            variant: 'secondary', textSize: '15px',
            depth: 500, clickEvent: 'ui.menu.open',
            onClick: () => this.openCodex(),
        });
    }

    // ---------- Background drawing ----------
    drawNightSky(W, H) {
        const gfx = this.add.graphics();
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
        const out = [];
        for (let r = 110; r > 60; r -= 10) {
            const alpha = (110 - r) / 200 + 0.05;
            out.push(this.add.circle(x, y, r, 0xffe8a0, alpha));
        }
        out.push(this.add.circle(x, y, 60, 0xfff4c8));
        out.push(this.add.circle(x - 18, y - 10, 8, 0xe8d8a0));
        out.push(this.add.circle(x + 12, y + 8, 6, 0xe8d8a0));
        out.push(this.add.circle(x + 22, y - 22, 4, 0xe8d8a0));
        return out;
    }

    drawCastleSilhouette(W, H) {
        const gfx = this.add.graphics();
        gfx.fillStyle(0x180828, 1);
        const baseY = H * 0.58;
        gfx.beginPath();
        gfx.moveTo(0, baseY + 40);
        gfx.lineTo(0, baseY);
        gfx.lineTo(W * 0.08, baseY);
        gfx.lineTo(W * 0.08, baseY - 90);
        gfx.lineTo(W * 0.11, baseY - 110);
        gfx.lineTo(W * 0.14, baseY - 90);
        gfx.lineTo(W * 0.14, baseY - 30);
        gfx.lineTo(W * 0.22, baseY - 30);
        gfx.lineTo(W * 0.22, baseY - 60);
        gfx.lineTo(W * 0.30, baseY - 60);
        gfx.lineTo(W * 0.30, baseY - 150);
        gfx.lineTo(W * 0.34, baseY - 180);
        gfx.lineTo(W * 0.38, baseY - 150);
        gfx.lineTo(W * 0.38, baseY - 60);
        gfx.lineTo(W * 0.50, baseY - 60);
        gfx.lineTo(W * 0.50, baseY - 110);
        gfx.lineTo(W * 0.58, baseY - 110);
        gfx.lineTo(W * 0.58, baseY - 40);
        gfx.lineTo(W * 0.72, baseY - 40);
        gfx.lineTo(W * 0.72, baseY - 140);
        gfx.lineTo(W * 0.76, baseY - 160);
        gfx.lineTo(W * 0.80, baseY - 140);
        gfx.lineTo(W * 0.80, baseY - 50);
        gfx.lineTo(W * 0.92, baseY - 50);
        gfx.lineTo(W * 0.92, baseY);
        gfx.lineTo(W, baseY);
        gfx.lineTo(W, baseY + 40);
        gfx.closePath();
        gfx.fillPath();
        const windows = [
            [W * 0.11, baseY - 70],
            [W * 0.34, baseY - 100],
            [W * 0.34, baseY - 70],
            [W * 0.54, baseY - 80],
            [W * 0.76, baseY - 100]
        ];
        windows.forEach(([wx, wy]) => this.add.rectangle(wx, wy, 7, 9, 0xffc060));
        for (let i = 0; i < 4; i++) {
            this.drawBat(Phaser.Math.Between(W * 0.2, W * 0.85), Phaser.Math.Between(180, 300));
        }
    }

    drawBat(x, y) {
        // Static bat silhouette — no tween (perf-conscious)
        const bat = this.add.graphics();
        bat.fillStyle(0x180828, 1);
        bat.fillCircle(0, 0, 3);
        bat.beginPath();
        bat.moveTo(-3, 0); bat.lineTo(-12, -5); bat.lineTo(-8, 2); bat.lineTo(-3, 0);
        bat.closePath(); bat.fillPath();
        bat.beginPath();
        bat.moveTo(3, 0); bat.lineTo(12, -5); bat.lineTo(8, 2); bat.lineTo(3, 0);
        bat.closePath(); bat.fillPath();
        bat.setPosition(x, y);
    }

    drawGround(W, H) {
        const gfx = this.add.graphics();
        const groundTop = H - 200;
        gfx.fillStyle(0x2a1240, 1);
        gfx.fillRect(0, groundTop, W, H - groundTop);
        gfx.fillStyle(0x4a2060, 1);
        gfx.fillRect(0, groundTop, W, 6);
        this.drawGravestone(W * 0.07, groundTop);
        this.drawGravestone(W * 0.95, groundTop);
        for (let i = 0; i < 8; i++) {
            const mx = Phaser.Math.Between(40, W - 40);
            const my = groundTop + Phaser.Math.Between(30, 100);
            this.drawMushroom(mx, my);
        }
    }

    drawGravestone(x, topY) {
        const gfx = this.add.graphics();
        gfx.fillStyle(0x4a3858, 1);
        gfx.lineStyle(3, 0x1a1024, 1);
        gfx.fillRoundedRect(x - 22, topY - 60, 44, 70, { tl: 22, tr: 22, bl: 0, br: 0 });
        gfx.strokeRoundedRect(x - 22, topY - 60, 44, 70, { tl: 22, tr: 22, bl: 0, br: 0 });
        this.add.text(x, topY - 35, 'RIP', {
            fontFamily: 'Arial Black, sans-serif', fontSize: '14px', color: '#1a1024'
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

    placeCharacter(key, label, x, y, scale, animMode) {
        const sprite = this.add.image(x, y, key).setOrigin(0.5, 1).setScale(scale);
        // Single soft elliptical shadow
        const shadow = this.add.ellipse(x, y + 4, sprite.displayWidth * 0.55, 12, 0x000000, 0.5);
        shadow.setDepth(sprite.depth - 1);

        // Compact pill label
        const labelText = this.add.text(x, y + 32, label, {
            fontFamily: FONT.body,
            fontSize: '12px',
            color: hex(C.textPrimary),
            fontStyle: '700',
        }).setOrigin(0.5);
        const pillW = labelText.width + 18;
        const pillG = this.add.graphics();
        pillG.fillStyle(C.bgDeep, 0.88);
        pillG.fillRoundedRect(x - pillW/2, y + 32 - 11, pillW, 22, R.pill);
        pillG.lineStyle(STROKE.hairline, C.accent, 0.45);
        pillG.strokeRoundedRect(x - pillW/2, y + 32 - 11, pillW, 22, R.pill);
        pillG.setDepth(labelText.depth - 1);

        // Single idle animation (one tween per character only)
        this.applyIdleAnim(sprite, shadow, animMode, scale);
    }

    applyIdleAnim(sprite, shadow, mode, baseScale) {
        const baseY = sprite.y;
        if (mode === 'idle') {
            this.tweens.add({
                targets: sprite, y: baseY - 6,
                scaleY: baseScale * 0.97, scaleX: baseScale * 1.03,
                duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
            });
        } else if (mode === 'sway') {
            sprite.setOrigin(0.5, 0.95);
            this.tweens.add({
                targets: sprite, angle: -4, duration: 1400,
                yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
            });
            this.tweens.add({
                targets: sprite, y: baseY - 2, duration: 700,
                yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
            });
        } else if (mode === 'breathe') {
            this.tweens.add({
                targets: sprite, scaleX: baseScale * 1.04, scaleY: baseScale * 0.96,
                duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
            });
        } else if (mode === 'wobble') {
            this.tweens.add({
                targets: sprite, scaleX: baseScale * 1.10, scaleY: baseScale * 0.86,
                duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
            });
        }
    }

    spawnStars(W, maxY) {
        // Static stars — no tweens. 24 small dots, looks like a sky.
        for (let i = 0; i < 24; i++) {
            const x = Phaser.Math.Between(0, W);
            const y = Phaser.Math.Between(0, maxY);
            const size = Phaser.Math.FloatBetween(0.8, 1.8);
            this.add.circle(x, y, size, 0xffffff, Phaser.Math.FloatBetween(0.5, 0.95));
        }
    }

    // ---------- SHOP ----------
    openCodex() {
        if (this.codexOpen) return;
        this.codexOpen = true;
        const W = this.viewW, H = this.viewH;
        const D = 2600;
        const els = [];
        const addEl = (el, dep) => { el.setDepth(dep || D); els.push(el); return el; };
        const close = () => {
            els.forEach(e => e.destroy());
            this.codexOpen = false;
        };
        // Backdrop — tap-outside dismisses, with soft blur shadow
        const backdrop = this.add.rectangle(0, 0, W, H, C.bgVoid, 0).setOrigin(0)
            .setInteractive().on('pointerdown', close);
        addEl(backdrop);
        this.tweens.add({ targets: backdrop, fillAlpha: 0.88, duration: DUR.base });
        // Panel — premium theme styling
        const panelW = Math.min(W * 0.94, 920);
        const panelH = Math.min(H * 0.94, 640);
        const panelEls = drawPanel(this, W/2, H/2, panelW, panelH, {
            bgTop: 0x1d2a22, bgBot: 0x0a1610,
            accent: C.success, depth: D, shadow: SHADOW.lg,
        });
        panelEls.forEach(e => { e.setDepth(D); els.push(e); });
        // Entrance — panel scales up
        panelEls.forEach(e => e.setScale(0.95).setAlpha(0));
        this.tweens.add({ targets: panelEls, scale: 1, alpha: 1, duration: DUR.slow, ease: EASE.back });
        // Title with green accent
        const title = addEl(this.add.text(W/2, H/2 - panelH/2 + 34, 'КОДЕКС', {
            fontFamily: FONT.display, fontSize: '34px',
            color: hex(C.success), stroke: hex(C.bgVoid), strokeThickness: 5,
            fontStyle: '900',
        }).setOrigin(0.5));
        addEl(this.add.text(W/2, H/2 - panelH/2 + 62, 'летопись подземелья', {
            fontFamily: FONT.body, fontSize: '12px',
            color: hex(C.textSecond), fontStyle: 'italic',
        }).setOrigin(0.5));
        // Close button — top-right, proper styled
        const closeBtn = makeButton(this, W/2 + panelW/2 - 32, H/2 - panelH/2 + 32, 40, 40, '×', {
            variant: 'ghost', textSize: '22px', depth: D + 5,
            clickEvent: 'ui.button.back', onClick: close,
        });
        els.push(closeBtn.container);

        // Two columns: Bestiary (kills) + Achievements
        const colGap = 24;
        const colW = (panelW - 60 - colGap) / 2;
        const leftX = W/2 - panelW/2 + 30;
        const rightX = leftX + colW + colGap;
        const topY = H/2 - panelH/2 + 78;

        // LEFT: Bestiary — section header
        addEl(this.add.text(leftX + colW/2, topY, 'БЕСТИАРИЙ', {
            fontFamily: FONT.display, fontSize: '20px',
            color: hex(C.textPrimary), stroke: hex(C.bgVoid), strokeThickness: 3,
            fontStyle: '700',
        }).setOrigin(0.5));
        // Subtle divider under header
        const bdivL = this.add.graphics(); bdivL.lineStyle(STROKE.hairline, C.success, 0.45);
        bdivL.lineBetween(leftX + 8, topY + 22, leftX + colW - 8, topY + 22);
        bdivL.setDepth(D); els.push(bdivL);
        const allKills = Progress.getAllKills();
        const enemyList = [
            { kind: 'zombie',    name: 'Зомби', },
            { kind: 'cat',       name: 'Демон-кот', },
            { kind: 'slime',     name: 'Слайм', },
            { kind: 'bat',       name: 'Летучая мышь', },
            { kind: 'skeleton',  name: 'Скелет', },
            { kind: 'ghost',     name: 'Призрак', },
            { kind: 'mimic',     name: 'Мимик', },
            { kind: 'guard',     name: 'Часовой', },
            { kind: 'librarian', name: 'Библиотекарь', },
            { kind: 'chef',      name: 'Шеф-кот', },
            { kind: 'snapdragon', name: 'Львиный зев', },
            { kind: 'boss',      name: 'Граф Ратула', }
        ];
        const rowH = 28;
        for (let i = 0; i < enemyList.length; i++) {
            const e = enemyList[i];
            const y = topY + 36 + i * rowH;
            if (y + rowH > H/2 + panelH/2 - 16) break;
            const kills = allKills[e.kind] || 0;
            const discovered = kills > 0;
            const txt = discovered
                ? `${e.name}  —  ×${kills}`
                : '???  —  не встречен';
            addEl(this.add.text(leftX + 12, y, txt, {
                fontFamily: FONT.body, fontSize: '14px',
                color: discovered ? hex(C.textPrimary) : hex(C.textMuted),
                fontStyle: discovered ? '500' : '400',
            }).setOrigin(0, 0));
        }

        // RIGHT: Stats + Achievements
        addEl(this.add.text(rightX + colW/2, topY, 'ЛЕТОПИСЬ', {
            fontFamily: FONT.display, fontSize: '20px',
            color: hex(C.textPrimary), stroke: hex(C.bgVoid), strokeThickness: 3,
            fontStyle: '700',
        }).setOrigin(0.5));
        const bdivR = this.add.graphics(); bdivR.lineStyle(STROKE.hairline, C.success, 0.45);
        bdivR.lineBetween(rightX + 8, topY + 22, rightX + colW - 8, topY + 22);
        bdivR.setDepth(D); els.push(bdivR);
        const sStat = Progress.getStoryStats();
        const eStat = Progress.getEndlessStats();
        const ghostRuns = Progress.getGhostRuns();
        const stats = [
            `Сюжетных побед: ${sStat.wins}`,
            `Глубочайший этаж: ${eStat.bestFloor}`,
            `Тихих забегов: ${ghostRuns}`,
            `Сыра всего: ${Progress.state.cheeseEarnedAllTime || 0}`
        ];
        for (let i = 0; i < stats.length; i++) {
            addEl(this.add.text(rightX + 12, topY + 36 + i * 26, stats[i], {
                fontFamily: FONT.body, fontSize: '14px',
                color: hex(C.textPrimary), fontStyle: '500',
            }).setOrigin(0, 0));
        }
        // Skin unlocks
        const skinsUnlocked = (Progress.state.skinsUnlocked || ['blue']).length;
        const skinsTotal = Progress.getAllSkins().length;
        addEl(this.add.text(rightX + 12, topY + 36 + stats.length * 26 + 12,
            `Скинов открыто: ${skinsUnlocked}/${skinsTotal}`, {
                fontFamily: FONT.display, fontSize: '15px',
                color: hex(C.accent), stroke: hex(C.bgVoid), strokeThickness: 3,
                fontStyle: '700',
            }).setOrigin(0, 0));

        // === ACHIEVEMENTS section (under right column) ===
        const achY = topY + 36 + stats.length * 26 + 50;
        if (achY + 100 < H/2 + panelH/2 - 16) {
            addEl(this.add.text(rightX + colW/2, achY, 'ДОСТИЖЕНИЯ', {
                fontFamily: FONT.display, fontSize: '15px',
                color: hex(C.textPrimary), stroke: hex(C.bgVoid), strokeThickness: 3,
                fontStyle: '700',
            }).setOrigin(0.5));
            const ACHIEVEMENTS = [
                { id: 'first_win',     name: 'Первое спасение бабушки', },
                { id: 'five_wins',     name: '5 спасений', },
                { id: 'speed_win',     name: 'Спасение < 10 мин', },
                { id: 'boss_defeated', name: 'Граф Ратула повержен', },
                { id: 'boss_no_hit',   name: 'Без единого удара', },
                { id: 'combo_25',      name: 'Комбо ×25', },
                { id: 'endless_10',    name: '∞ Этаж 10', },
                { id: 'endless_20',    name: '∞ Этаж 20', },
                { id: 'endless_30',    name: '∞ Этаж 30', }
            ];
            for (let i = 0; i < ACHIEVEMENTS.length; i++) {
                const a = ACHIEVEMENTS[i];
                const unlocked = Progress.hasAchievement && Progress.hasAchievement(a.id);
                const y = achY + 28 + i * 22;
                if (y + 22 > H/2 + panelH/2 - 12) break;
                addEl(this.add.text(rightX + 12, y,
                    unlocked ? a.name : '???', {
                        fontFamily: FONT.body, fontSize: '13px',
                        color: unlocked ? hex(C.success) : hex(C.textMuted),
                        fontStyle: unlocked ? '600' : '400',
                    }).setOrigin(0, 0));
            }
        }
    }

    openShop() {
        if (this.shopOpen) return;
        this.shopOpen = true;
        const W = this.viewW;
        const H = this.viewH;
        const D = 2500;
        const els = [];
        const addEl = (el, dep) => { el.setDepth(dep || D); els.push(el); return el; };

        // Backdrop — interactive so a tap outside dismisses, and blocks pass-through to menu buttons
        const closeModal = () => {
            els.forEach(e => e.destroy());
            this.shopOpen = false;
        };
        const backdrop = this.add.rectangle(0, 0, W, H, C.bgVoid, 0)
            .setOrigin(0)
            .setInteractive()
            .on('pointerdown', closeModal);
        addEl(backdrop);
        this.tweens.add({ targets: backdrop, fillAlpha: 0.88, duration: DUR.base });

        const panelW = Math.min(W * 0.94, 920);
        const panelH = Math.min(H * 0.94, 620);
        const panelEls = drawPanel(this, W/2, H/2, panelW, panelH, {
            bgTop: 0x3a1d10, bgBot: 0x1a0808,
            accent: C.accent, depth: D, shadow: SHADOW.lg,
        });
        panelEls.forEach(e => { e.setDepth(D); els.push(e); });
        panelEls.forEach(e => e.setScale(0.95).setAlpha(0));
        this.tweens.add({ targets: panelEls, scale: 1, alpha: 1, duration: DUR.slow, ease: EASE.back });

        addEl(this.add.text(W/2, H/2 - panelH/2 + 34, 'ЛАВКА ДЯДЮШКИ', {
            fontFamily: FONT.display, fontSize: '32px',
            color: hex(C.accent), stroke: hex(C.bgVoid), strokeThickness: 5,
            fontStyle: '900',
        }).setOrigin(0.5));
        addEl(this.add.text(W/2, H/2 - panelH/2 + 62, 'скины · апгрейды',  {
            fontFamily: FONT.body, fontSize: '12px',
            color: hex(C.textSecond), fontStyle: 'italic',
        }).setOrigin(0.5));

        // Balance — premium pill in top right of panel
        const bal = Progress.getCheese();
        const balPillW = Math.min(140, 70 + String(bal).length * 12);
        const balPillX = W/2 + panelW/2 - balPillW/2 - 16;
        const balPillY = H/2 - panelH/2 + 32;
        const balG = this.add.graphics().setDepth(D + 2);
        balG.fillStyle(C.bgDeep, 0.95);
        balG.fillRoundedRect(balPillX - balPillW/2, balPillY - 18, balPillW, 36, R.pill);
        balG.lineStyle(STROKE.thin, C.accent, 0.85);
        balG.strokeRoundedRect(balPillX - balPillW/2, balPillY - 18, balPillW, 36, R.pill);
        els.push(balG);
        addEl(this._menuIcon(balPillX - balPillW/2 + 20, balPillY, 'ui_cheese', 24), D + 3);
        addEl(this.add.text(balPillX + 12, balPillY, String(bal), {
            fontFamily: FONT.display, fontSize: '18px',
            color: hex(C.accentSoft), fontStyle: '700',
        }).setOrigin(0.5), D + 3);

        // Close — top-left ghost button
        const closeBtnObj = makeButton(this, W/2 - panelW/2 + 32, H/2 - panelH/2 + 32, 40, 40, '×', {
            variant: 'ghost', textSize: '22px', depth: D + 5,
            clickEvent: 'ui.button.back', onClick: closeModal,
        });
        els.push(closeBtnObj.container);

        // Two tabs: Hats and Upgrades. Show both stacked.
        const colGap = 20;
        const colW = (panelW - 60) / 2;
        const leftX = W/2 - panelW/2 + 30;
        const rightX = leftX + colW + colGap;
        const topY = H/2 - panelH/2 + 80;

        // === LEFT COLUMN: SKINS (responsive grid) ===
        addEl(this.add.text(leftX + colW/2, topY, 'СКИНЫ', {
            fontFamily: FONT.display, fontSize: '20px',
            color: hex(C.textPrimary), stroke: hex(C.bgVoid), strokeThickness: 3,
            fontStyle: '700',
        }).setOrigin(0.5));
        const skDivL = this.add.graphics(); skDivL.lineStyle(STROKE.hairline, C.accent, 0.45);
        skDivL.lineBetween(leftX + 8, topY + 22, leftX + colW - 8, topY + 22);
        skDivL.setDepth(D); els.push(skDivL);

        const isMobile = W < 700;
        const skinCols = isMobile ? 2 : 3;
        const skinGap = 10;
        const cardW = (colW - skinGap * (skinCols - 1)) / skinCols;
        const cardH = isMobile ? Math.max(120, cardW * 1.0) : Math.max(140, cardW * 1.1);
        const gridStartY = topY + 36;

        const skinList = Progress.getAllSkins();
        skinList.forEach((skin, i) => {
            const col = i % skinCols;
            const row = Math.floor(i / skinCols);
            const cx = leftX + col * (cardW + skinGap) + cardW / 2;
            const cy = gridStartY + row * (cardH + skinGap) + cardH / 2;
            if (cy + cardH / 2 > H/2 + panelH/2 - 16) return;

            const unlocked = Progress.isSkinUnlocked(skin.id);
            const current = Progress.getCurrentSkin();
            const equipped = current.id === skin.id;
            const bg = unlocked ? (equipped ? 0x1a4030 : C.bgPanelHi) : 0x2a1414;
            const accentColor = unlocked ? (equipped ? C.success : C.accent) : C.dangerDeep;

            // Card body — rounded with theme styling
            const cardG = this.add.graphics().setDepth(D + 1);
            const drawCardBg = (a) => {
                cardG.clear();
                cardG.fillStyle(bg, 0.95);
                cardG.fillRoundedRect(cx - cardW/2 + 1, cy - cardH/2 + 1, cardW - 2, cardH - 2, R.md);
                cardG.fillStyle(C.surfaceLightTint, 0.05);
                cardG.fillRoundedRect(cx - cardW/2 + 3, cy - cardH/2 + 3, cardW - 6, (cardH - 6) * 0.45, R.md - 2);
                cardG.lineStyle(STROKE.thin, accentColor, a);
                cardG.strokeRoundedRect(cx - cardW/2 + 1, cy - cardH/2 + 1, cardW - 2, cardH - 2, R.md);
            };
            drawCardBg(0.85);
            els.push(cardG);
            const cardHit = this.add.zone(cx, cy, cardW - 2, cardH - 2)
                .setInteractive({ useHandCursor: true }).setDepth(D + 4);
            els.push(cardHit);

            // Name top
            addEl(this.add.text(cx, cy - cardH/2 + 14, skin.name, {
                fontFamily: FONT.display, fontSize: '11px',
                color: hex(C.textPrimary), align: 'center', fontStyle: '700',
                wordWrap: { width: cardW - 8 }
            }).setOrigin(0.5, 0), D + 2);
            // Real skin sprite preview using actual SVG
            const previewY = cy - cardH * 0.05;
            const previewKey = (skin.menuKey && this.textures.exists(skin.menuKey)) ? skin.menuKey : 'm_pi';
            const piPreview = addEl(this.add.image(cx, previewY, previewKey)
                .setOrigin(0.5, 0.5).setScale(0.32), D + 2);
            if (skin.id === 'shadow') piPreview.setAlpha(0.85);
            if (skin.id === 'angel') piPreview.setAlpha(0.95);
            // Floor of card: pill price/state badge
            const subText = unlocked ? (equipped ? 'НАДЕТ' : 'НАДЕТЬ') : `${skin.price}`;
            const subColor = unlocked ? (equipped ? C.success : C.textPrimary) : C.accent;
            const subTxt = addEl(this.add.text(cx, cy + cardH/2 - 12, subText, {
                fontFamily: FONT.body, fontSize: '11px',
                color: hex(subColor), fontStyle: '700', letterSpacing: 0.5,
            }).setOrigin(0.5, 1), D + 3);
            if (!unlocked) {
                // Price reads «<cheese> N» — icon and number centred as one group
                const icoBox = 14, icoGap = 4;
                const half = (icoBox + icoGap + subTxt.width) / 2;
                subTxt.setX(cx + half - subTxt.width / 2);
                addEl(this._menuIcon(cx - half + icoBox / 2,
                    cy + cardH/2 - 12 - subTxt.height / 2, 'ui_cheese', icoBox), D + 3);
            }

            cardHit.on('pointerover', () => {
                drawCardBg(1);
                this.tweens.add({ targets: piPreview, scale: 0.36, duration: DUR.fast, ease: EASE.out });
            });
            cardHit.on('pointerout', () => {
                drawCardBg(0.85);
                this.tweens.add({ targets: piPreview, scale: 0.32, duration: DUR.fast, ease: EASE.out });
            });
            const card = cardHit;

            card.on('pointerdown', () => {
                if (!unlocked) {
                    if (!Progress.spendCheese(skin.price)) {
                        this.flashNoCheese(W/2, H/2);
                        return;
                    }
                    Progress.unlockSkin(skin.id);
                }
                Progress.setSkin(skin.id);
                els.forEach(e => e.destroy());
                this.shopOpen = false;
                this.openShop();
            });
        });

        // === RIGHT COLUMN: PERMANENT UPGRADES ===
        addEl(this.add.text(rightX + colW/2, topY, 'АПГРЕЙДЫ', {
            fontFamily: FONT.display, fontSize: '20px',
            color: hex(C.textPrimary), stroke: hex(C.bgVoid), strokeThickness: 3,
            fontStyle: '700',
        }).setOrigin(0.5));
        const upDivR = this.add.graphics(); upDivR.lineStyle(STROKE.hairline, C.accent, 0.45);
        upDivR.lineBetween(rightX + 8, topY + 22, rightX + colW - 8, topY + 22);
        upDivR.setDepth(D); els.push(upDivR);

        const upgItemH = 70;
        PERMANENT_UPGRADES.forEach((upg, i) => {
            const y = topY + 40 + i * (upgItemH + 8);
            if (y + upgItemH > H/2 + panelH/2 - 20) return;
            const lvl = Progress.getUpgradeLevel(upg.id);
            const maxed = lvl >= upg.maxLevel;
            const bg = maxed ? 0x1a4030 : C.bgPanelHi;
            const accent = maxed ? C.success : C.accent;
            // Card body
            const upCardG = this.add.graphics().setDepth(D + 1);
            const drawUp = (a) => {
                upCardG.clear();
                upCardG.fillStyle(bg, 0.94);
                upCardG.fillRoundedRect(rightX, y - upgItemH/2, colW, upgItemH, R.md);
                upCardG.fillStyle(C.surfaceLightTint, 0.05);
                upCardG.fillRoundedRect(rightX + 2, y - upgItemH/2 + 2, colW - 4, upgItemH * 0.45, R.md - 2);
                upCardG.lineStyle(STROKE.thin, accent, a);
                upCardG.strokeRoundedRect(rightX, y - upgItemH/2, colW, upgItemH, R.md);
            };
            drawUp(0.85); els.push(upCardG);
            const card = this.add.zone(rightX + colW/2, y, colW, upgItemH)
                .setInteractive({ useHandCursor: true }).setDepth(D + 5);
            els.push(card);
            card.on('pointerover', () => drawUp(1));
            card.on('pointerout', () => drawUp(0.85));

            addEl(this._menuIcon(rightX + 34, y, upg.icon, 34), D + 2);
            addEl(this.add.text(rightX + 60, y - 14, `${upg.name}  (${lvl}/${upg.maxLevel})`, {
                fontFamily: FONT.display, fontSize: '14px',
                color: hex(C.textPrimary), fontStyle: '700',
            }).setOrigin(0, 0.5), D + 2);
            addEl(this.add.text(rightX + 60, y + 4, upg.desc, {
                fontFamily: FONT.body, fontSize: '11.5px',
                color: hex(C.textSecond),
                wordWrap: { width: colW - 80 }
            }).setOrigin(0, 0.5), D + 2);
            const price = maxed ? 'МАКС' : `${upg.price}`;
            addEl(this.add.text(rightX + (maxed ? 60 : 76), y + 22, price, {
                fontFamily: FONT.body, fontSize: '12px',
                color: maxed ? hex(C.success) : hex(C.accent), fontStyle: '700',
            }).setOrigin(0, 0.5), D + 2);
            if (!maxed) addEl(this._menuIcon(rightX + 67, y + 22, 'ui_cheese', 14), D + 2);

            card.on('pointerdown', () => {
                if (maxed) return;
                if (Progress.buyUpgrade(upg.id)) {
                    els.forEach(e => e.destroy());
                    this.shopOpen = false;
                    this.openShop();
                } else {
                    this.flashNoCheese(W/2, H/2);
                }
            });
        });
    }

    flashNoCheese(x, y) {
        const t = this.add.text(x, y, 'Не хватает сыра!', {
            fontFamily: FONT.display, fontSize: '26px',
            color: hex(C.danger), stroke: hex(C.bgVoid), strokeThickness: 5,
            fontStyle: '700',
        }).setOrigin(0.5).setDepth(3000);
        try { bus.emit(UI.SHOP_DENY); } catch (e) {}
        this.tweens.add({
            targets: t, y: y - 60, alpha: 0, scale: 1.15,
            duration: 1100, ease: EASE.out, onComplete: () => t.destroy()
        });
    }

    spawnFireflies(W, H) {
        for (let i = 0; i < 10; i++) {
            const x = Phaser.Math.Between(100, W - 100);
            const y = Phaser.Math.Between(H * 0.55, H - 200);
            const fly = this.add.circle(x, y, 3, 0xb4ff70, 0.9);
            const glow = this.add.circle(x, y, 8, 0xb4ff70, 0.2);
            const move = () => {
                this.tweens.add({
                    targets: [fly, glow],
                    x: x + Phaser.Math.Between(-150, 150),
                    y: y + Phaser.Math.Between(-80, 80),
                    duration: Phaser.Math.Between(2500, 4500),
                    ease: 'Sine.easeInOut',
                    onComplete: move
                });
            };
            move();
            this.tweens.add({
                targets: [fly, glow], alpha: 0.2,
                duration: Phaser.Math.Between(800, 1400),
                yoyo: true, repeat: -1
            });
        }
    }
}
