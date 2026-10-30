// ============================================
// SNEAK SCENE — режим «Тихая лапка» (Замок Теней)
// Бесконечное стелс-приключение с цветными норами-телепортами,
// монстрами Замка Теней, Золотыми Сырами, Секретным Тайником,
// гаджетами и стильным аркадным управлением.
// ============================================

import { Progress } from '../storage/ProgressStore.js';
import { bus } from '../audio/EventBus.js';
import { SFX, UI, BGM } from '../audio/SoundKeys.js';
import { preloadAudio } from '../audio/AudioManager.js';
import { SNEAK } from '../sneak/SneakMetrics.js';
import { isFloor, inCone } from '../sneak/RoomTemplate.js';
import { positionAt } from '../sneak/PatrolCycle.js';
import { generateHeistFloor } from '../sneak/ProceduralHeistGenerator.js';
import { readSafeArea } from '../ui/safeArea.js';

const CELL = 48; // Просторная клетка для чёткой графики и удобного управления
const DEPTH = {
    VOID: 2,
    FLOOR: 10,
    SHADOW_RUG: 13,
    PATROL_LINE: 15,
    BURROW_LINK: 16,
    DECOR: 24,
    WALL: 32,
    WALL_TOP: 35,
    HOLE_GLOW: 40,
    HOLE: 44,
    PROP: 50,
    CONE: 56,
    PLAYER: 65,
    MONSTER: 68,
    FX: 80,
    WORLD_UI: 120,
    HUD: 900,
    MODAL: 1500,
};

export class SneakScene extends Phaser.Scene {
    constructor() {
        super({ key: 'SneakScene' });
    }

    init(data) {
        this.floor = Math.max(1, data?.floor || (typeof data?.roomIndex === 'number' ? data.roomIndex + 1 : 1));
        this.cheeseThisRun = data?.cheeseThisRun ?? data?.cheeseThisNight ?? 0;
        this.pies = data?.pies ?? 3;
        this.hearts = data?.hearts ?? 3;
        this.maxHearts = 3;
        this.streak = data?.streak ?? 0;          // Серия этажей/действий без тревоги
        this.everSeenOnFloor = false;
        this.invulnUntil = 0;
        this.dashCooldownUntil = 0;
        this.burrowCooldownUntil = 0;

        // Активные бонусы-усилители
        this.cloakUntil = 0;
        this.magnetUntil = 0;
        this.turboUntil = 0;

        // Генерируем новый процедурный этаж
        this.level = generateHeistFloor(this.floor);
        this.biome = this.level.biome;
        this.tpl = { grid: this.level.grid };

        this.state = 'play';
        this.monsters = [];
        this.holes = [];
        this.goldenCheeses = [];
        this.pickups = [];
        this.boosters = [];
        this.shadowZones = [];
        this.secretChest = null;
        this.player = null;
        this.inShadow = false;
        this._walkTimer = 0;
        this._walkFrame = 0;
        this._facingBack = false;
        this._lastStepSoundAt = 0;
        this._pauseModalObjs = null;
    }

    preload() {
        preloadAudio(this);
        const base = 'assets/characters/transylvania/';
        this.load.svg('d_pi',       base + 'pi.svg',       { width: 150, height: 172 });
        this.load.svg('d_pi_walk1', base + 'pi-walk1.svg', { width: 150, height: 172 });
        this.load.svg('d_pi_walk2', base + 'pi-walk2.svg', { width: 150, height: 172 });
        this.load.svg('d_pi_b',       base + 'back/pi.svg',       { width: 150, height: 172 });
        this.load.svg('d_pi_walk1_b', base + 'back/pi-walk1.svg', { width: 150, height: 172 });
        this.load.svg('d_pi_walk2_b', base + 'back/pi-walk2.svg', { width: 150, height: 172 });

        // Загружаем текущий выбранный скин Пи из магазина Замка Теней
        try {
            const sk = Progress.getCurrentSkin && Progress.getCurrentSkin();
            if (sk && sk.id && sk.id !== 'blue') {
                const safeId = sk.id.replace(/-/g, '_');
                const skinBase = 'assets/characters/transylvania/skins/';
                const backBase = 'assets/characters/transylvania/back/';
                this.load.svg('skin_' + safeId,          skinBase + sk.id + '.svg',       { width: 150, height: 172 });
                this.load.svg('skin_' + safeId + '_w1',  skinBase + sk.id + '-walk1.svg', { width: 150, height: 172 });
                this.load.svg('skin_' + safeId + '_w2',  skinBase + sk.id + '-walk2.svg', { width: 150, height: 172 });
                this.load.svg('skin_' + safeId + '_b',    backBase + sk.id + '.svg',       { width: 150, height: 172 });
                this.load.svg('skin_' + safeId + '_w1_b', backBase + sk.id + '-walk1.svg', { width: 150, height: 172 });
                this.load.svg('skin_' + safeId + '_w2_b', backBase + sk.id + '-walk2.svg', { width: 150, height: 172 });
            }
        } catch (_) {}

        // Все монстры Замка Теней
        this.load.svg('d_cat',      base + 'cat.svg',      { width: 165, height: 150 });
        this.load.svg('d_zombie',   base + 'zombie.svg',   { width: 180, height: 210 });
        this.load.svg('d_skeleton', base + 'skeleton.svg', { width: 150, height: 180 });
        this.load.svg('d_ghost',    base + 'ghost.svg',    { width: 150, height: 180 });
        this.load.svg('d_bat',      base + 'bat.svg',      { width: 150, height: 120 });
        this.load.svg('d_slime',    base + 'slime.svg',    { width: 180, height: 135 });
        this.load.svg('d_count',    base + 'count.svg',    { width: 200, height: 234 });
        this.load.svg('d_grandma',  base + 'grandma.svg',  { width: 135, height: 150 });

        // Предметы и окружение Замка
        this.load.svg('d_cheese', base + 'cheese.svg', { width: 64, height: 54 });
        this.load.svg('d_pie',    base + 'pie.svg',    { width: 52, height: 52 });
        this.load.svg('chest_closed', 'assets/world/chest_closed.svg', { width: 64, height: 58 });
        this.load.svg('chest_open',   'assets/world/chest_open.svg',   { width: 64, height: 58 });
        this.load.svg('stairs',       'assets/world/stairs.svg',       { width: 84, height: 92 });
        this.load.svg('torch_sconce', 'assets/world/torch_sconce.svg', { width: 28, height: 36 });
        this.load.svg('candelabra_lit', 'assets/world/candelabra_lit.svg', { width: 52, height: 72 });
        this.load.svg('badge_alert',   'assets/world/badge_alert.svg',   { width: 24, height: 34 });
        this.load.svg('badge_sleep',   'assets/world/badge_sleep.svg',   { width: 32, height: 32 });
        this.load.svg('badge_anger',   'assets/world/badge_anger.svg',   { width: 28, height: 28 });
        this.load.svg('badge_ear',     'assets/world/badge_ear.svg',     { width: 28, height: 28 });
        this.load.svg('badge_sparkle', 'assets/world/badge_sparkle.svg', { width: 28, height: 28 });

        // Декорации биомов
        const props = ['mushroom', 'bone', 'cobweb', 'skull', 'pot', 'sack', 'book', 'scroll', 'candle', 'bookshelf', 'moonflower', 'glowpod', 'hedge_tuft', 'lilypad', 'goblet', 'redCarpet'];
        for (const p of props) {
            this.load.svg('prop_' + p, `assets/world/${p}.svg`, { width: 42, height: 42 });
        }

        // Аркадные стики
        const dpr = window.__GAME_DPR || 1;
        this.load.svg('ctl_base_move', 'assets/controls/stick_base_move.svg', { width: Math.round(128 * dpr), height: Math.round(128 * dpr) });
        this.load.svg('ctl_knob_move', 'assets/controls/knob_move.svg',       { width: Math.round(64 * dpr),  height: Math.round(64 * dpr) });
    }

    create() {
        this.viewW = this.scale.width;
        this.viewH = this.scale.height;
        this.dpr = window.__GAME_DPR || 1;
        this.cssW = this.viewW / this.dpr;
        this.cssH = this.viewH / this.dpr;
        this.ui = (v) => Math.round(v * this.dpr);
        this.safe = readSafeArea();

        this.cameras.main.setBackgroundColor('#090514');

        // Запускаем музыку текущего биома Замка
        if (this.biome && this.biome.bgm) {
            bus.emit(this.biome.bgm);
        }
        bus.emit(SFX.FLOOR_ENTER);

        this.drawBiomeWorld();
        this.setupCamera();
        this.drawPatrolRoutes();
        this.spawnPlayer();
        this.spawnMonsters();

        // Отдельная UI-камера без зума для чёткого HUD и стильных кнопок управления
        const worldObjects = this.children.list.slice();
        this.uiCam = this.cameras.add(0, 0, this.viewW, this.viewH);
        this.uiCam.ignore(worldObjects);

        this.setupArcadeControls();
        this.buildHud();
        this.showFloorIntroToast();

        this.cursors = this.input.keyboard.createCursorKeys();
        this.keysWASD = this.input.keyboard.addKeys('W,A,S,D,E,Q');
        this.input.keyboard.on('keydown-SPACE', () => {
            if (this.state === 'play') this.triggerBurrowOrDash();
        });
        this.input.keyboard.on('keydown-E', () => {
            if (this.state === 'play') this.triggerBurrowOrDash();
        });
        this.input.keyboard.on('keydown-Q', () => {
            if (this.state === 'play') this.triggerSmartPieThrow();
        });
        this.input.keyboard.on('keydown-ESC', () => {
            if (this.state === 'play') this.togglePauseModal();
            else if (this.state === 'paused') this.togglePauseModal();
        });
    }

    _registerWorldObj(obj) {
        if (obj && this.uiCam) this.uiCam.ignore(obj);
        return obj;
    }

    _registerUiObj(obj) {
        if (obj && this.cameras?.main) this.cameras.main.ignore(obj);
        return obj;
    }

    // =========================================================================
    // ОТРИСОВКА МИРА БИОМА, ЦВЕТНЫХ НОР, СОКРОВИЩ И ДЕКОРА
    // =========================================================================
    drawBiomeWorld() {
        const b = this.biome;
        const rows = this.level.rows;
        const cols = this.level.cols;
        const gFloor = this.add.graphics().setDepth(DEPTH.FLOOR);
        const gWall  = this.add.graphics().setDepth(DEPTH.WALL);

        // Внешний каменный бордюр вокруг карты, чтобы ни при каком соотношении экрана не было пустоты
        const PAD = 10;
        for (let y = -PAD; y < rows + PAD; y++) {
            for (let x = -PAD; x < cols + PAD; x++) {
                if (y >= 0 && y < rows && x >= 0 && x < cols) continue;
                const px = x * CELL, py = y * CELL;
                gWall.fillStyle(b.wallShadow || 0x120818, 1);
                gWall.fillRect(px, py, CELL, CELL);
                gWall.fillStyle(b.wallFill || 0x2a1a3e, 0.72);
                gWall.fillRect(px + 2, py + 2, CELL - 4, CELL - 4);
            }
        }

        // Отрисовка плитки пола и объёмных 3D-стен биома
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const px = x * CELL;
                const py = y * CELL;
                if (isFloor(this.tpl, x, y)) {
                    const isEven = (x + y) % 2 === 0;
                    const baseCol = isEven ? (b.floorColorA || 0x221333) : (b.floorColorB || 0x281838);
                    gFloor.fillStyle(baseCol, 1);
                    gFloor.fillRect(px, py, CELL, CELL);

                    // Изящная фаска плитки
                    gFloor.lineStyle(1, b.gridColor || 0x120820, 0.45);
                    gFloor.strokeRect(px + 0.5, py + 0.5, CELL - 1, CELL - 1);

                    // Тень от верхней стены на пол для объёма
                    if (y > 0 && !isFloor(this.tpl, x, y - 1)) {
                        gFloor.fillStyle(0x000000, 0.34);
                        gFloor.fillRect(px, py, CELL, 9);
                    }
                } else {
                    // Объёмный блок стены
                    const hasFloorBelow = (y + 1 < rows) && isFloor(this.tpl, x, y + 1);
                    gWall.fillStyle(b.wallShadow || 0x120818, 1);
                    gWall.fillRect(px, py, CELL, CELL);

                    gWall.fillStyle(b.wallFill || 0x2a1a3e, 1);
                    gWall.fillRect(px + 1, py + 1, CELL - 2, CELL - (hasFloorBelow ? 8 : 2));

                    // Верхний блик кладки
                    gWall.fillStyle(b.wallHighlight || 0x3e2a56, 1);
                    gWall.fillRect(px + 2, py + 2, CELL - 4, 5);

                    // Декоративный кирпичный шов
                    gWall.fillStyle(b.wallShadow || 0x120818, 0.45);
                    gWall.fillRect(px + 6, py + Math.floor(CELL * 0.48), CELL - 12, 2);
                }
            }
        }

        // Факелы и канделябры на стенах для уютного свечения Замка
        for (let y = 1; y < rows - 1; y++) {
            for (let x = 2; x < cols - 2; x += 4) {
                if (!isFloor(this.tpl, x, y) && isFloor(this.tpl, x, y + 1)) {
                    const tx = (x + 0.5) * CELL;
                    const ty = (y + 0.72) * CELL;
                    const glow = this.add.circle(tx, ty + 12, CELL * 1.15, 0xffaa33, 0.11).setDepth(DEPTH.FLOOR + 1);
                    this.tweens.add({
                        targets: glow, alpha: 0.19, scale: 1.08,
                        duration: 700 + (x * 90) % 400, yoyo: true, repeat: -1,
                    });
                    if (this.textures.exists('torch_sconce')) {
                        this.add.image(tx, ty, 'torch_sconce').setDisplaySize(18, 24).setDepth(DEPTH.WALL_TOP);
                    }
                }
            }
        }

        // Декоративные предметы биома
        const alias = { flower: 'moonflower', vine: 'hedge_tuft', plate: 'pot', knife: 'pot', inkwell: 'scroll', chain: 'bone' };
        for (const d of (this.level.decors || [])) {
            const key = 'prop_' + (alias[d.type] || d.type);
            if (!this.textures.exists(key)) continue;
            const dx = (d.x + 0.5) * CELL + ((d.x * 7) % 9 - 4);
            const dy = (d.y + 0.5) * CELL + ((d.y * 5) % 9 - 4);
            this.add.image(dx, dy, key)
                .setDisplaySize(24, 24)
                .setAlpha(0.72)
                .setDepth(DEPTH.DECOR);
        }

        // Тёмные островки-коврики «Спрячься в тени»
        this.shadowZones = [];
        for (const sz of (this.level.shadowZones || [])) {
            const cx = (sz.x + 0.5) * CELL;
            const cy = (sz.y + 0.5) * CELL;
            const rug = this.add.circle(cx, cy, CELL * 0.44, 0x090414, 0.68)
                .setStrokeStyle(2, 0x818cf8, 0.45)
                .setDepth(DEPTH.SHADOW_RUG);
            const icon = this.add.text(cx, cy, '🐾', { fontSize: '15px' })
                .setOrigin(0.5).setAlpha(0.55).setDepth(DEPTH.SHADOW_RUG + 1);
            this.shadowZones.push({ x: cx, y: cy, r: CELL * 0.48, rug, icon });
        }

        // === ЦВЕТНЫЕ ПАРЫ НОР-ТЕЛЕПОРТОВ ===
        this.holes = [];
        const gLinks = this.add.graphics().setDepth(DEPTH.BURROW_LINK);
        for (const pair of this.level.holes) {
            const pal = pair.palette;
            const ax = (pair.a.x + 0.5) * CELL, ay = (pair.a.y + 0.5) * CELL;
            const bx = (pair.b.x + 0.5) * CELL, by = (pair.b.y + 0.5) * CELL;

            // Пунктирная волшебная нить на полу между парой нор одного цвета
            const dist = Math.hypot(bx - ax, by - ay) || 1;
            const steps = Math.max(4, Math.floor(dist / 22));
            for (let i = 1; i < steps; i += 2) {
                const t = i / steps;
                gLinks.fillStyle(pal.color, 0.22);
                gLinks.fillCircle(ax + (bx - ax) * t, ay + (by - ay) * t, 2.5);
            }

            for (const [idx, mouth] of [[0, pair.a], [1, pair.b]]) {
                const cx = (mouth.x + 0.5) * CELL;
                const cy = (mouth.y + 0.5) * CELL;
                const glow = this.add.circle(cx, cy, CELL * 0.48, pal.color, 0.24).setDepth(DEPTH.HOLE_GLOW);
                const outerRing = this.add.circle(cx, cy, CELL * 0.37, 0x120924, 1)
                    .setStrokeStyle(3.5, pal.color, 0.95)
                    .setDepth(DEPTH.HOLE);
                const innerHole = this.add.circle(cx, cy + 2, CELL * 0.24, 0x04020a, 1)
                    .setDepth(DEPTH.HOLE + 1);
                const badge = this.add.text(cx, cy - CELL * 0.42, `${pair.pairIndex + 1}`, {
                    fontFamily: 'Nunito, sans-serif',
                    fontSize: '12px',
                    fontStyle: '900',
                    color: '#0b0616',
                    backgroundColor: pal.hex,
                    padding: { x: 4, y: 1 },
                }).setOrigin(0.5).setDepth(DEPTH.HOLE + 2);

                this.tweens.add({
                    targets: glow,
                    scale: 1.24,
                    alpha: 0.42,
                    duration: 850 + idx * 150,
                    yoyo: true,
                    repeat: -1,
                    ease: 'Sine.easeInOut',
                });

                this.holes.push({
                    x: cx,
                    y: cy,
                    pair,
                    mouth,
                    palette: pal,
                    glow,
                    outerRing,
                    innerHole,
                    badge,
                });
            }
        }

        // === ВЫХОД (ЛЮК НА СЛЕДУЮЩИЙ ЭТАЖ) ===
        const ex = this.level.exit;
        this.exitPoint = { x: (ex.x + 0.5) * CELL, y: (ex.y + 0.5) * CELL };
        this.exitGlow = this.add.circle(this.exitPoint.x, this.exitPoint.y, CELL * 0.56, 0xff5566, 0.26)
            .setStrokeStyle(2.5, 0xff6b81, 0.7)
            .setDepth(DEPTH.PROP - 1);
        if (this.textures.exists('stairs')) {
            this.exitSprite = this.add.image(this.exitPoint.x, this.exitPoint.y, 'stairs')
                .setDisplaySize(CELL * 0.92, CELL * 0.96)
                .setAlpha(0.65)
                .setDepth(DEPTH.PROP);
        } else {
            this.exitSprite = this.add.circle(this.exitPoint.x, this.exitPoint.y, CELL * 0.36, 0x4ade80, 0.8)
                .setDepth(DEPTH.PROP);
        }
        this.exitLabel = this.add.text(this.exitPoint.x, this.exitPoint.y - CELL * 0.62, '🔒 СОБЕРИ ЗОЛОТОЙ СЫР', {
            fontFamily: 'Nunito, sans-serif',
            fontSize: '11px',
            fontStyle: '900',
            color: '#ffffff',
            backgroundColor: '#991b1bcc',
            padding: { x: 6, y: 2 },
        }).setOrigin(0.5, 1).setDepth(DEPTH.WORLD_UI);

        // === ГЛАВНАЯ ЦЕЛЬ: ЗОЛОТЫЕ КОРОЛЕВСКИЕ СЫРЫ (1..3 шт.) ===
        this.goldenCheeses = [];
        for (const gc of this.level.goldenCheeses) {
            const cx = (gc.x + 0.5) * CELL;
            const cy = (gc.y + 0.5) * CELL;
            const aura = this.add.circle(cx, cy, CELL * 0.46, 0xffd700, 0.28)
                .setStrokeStyle(2, 0xfef08a, 0.85)
                .setDepth(DEPTH.PROP - 1);
            const spr = this.add.image(cx, cy, 'd_cheese')
                .setDisplaySize(36, 30)
                .setTint(0xfffbeb)
                .setDepth(DEPTH.PROP + 1);
            const crownTag = this.add.text(cx, cy - 22, '👑', { fontSize: '14px' })
                .setOrigin(0.5).setDepth(DEPTH.PROP + 2);

            this.tweens.add({
                targets: [spr, crownTag],
                y: '-=6',
                duration: 780,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut',
            });
            this.tweens.add({
                targets: aura,
                scale: 1.32,
                alpha: 0.12,
                duration: 900,
                yoyo: true,
                repeat: -1,
            });
            this.goldenCheeses.push({
                x: cx,
                y: cy,
                value: gc.value,
                aura,
                spr,
                crownTag,
                taken: false,
            });
        }

        // === БОНУС-ТАЙНИК (СУНДУК С СОКРОВИЩЕМ ИЛИ ПЛЕННАЯ МЫШКА) ===
        if (this.level.secretChest) {
            const sc = this.level.secretChest;
            const cx = (sc.x + 0.5) * CELL;
            const cy = (sc.y + 0.5) * CELL;
            const aura = this.add.circle(cx, cy, CELL * 0.48, 0xf472b6, 0.25)
                .setStrokeStyle(2, 0xf9a8d4, 0.8)
                .setDepth(DEPTH.PROP - 1);
            const tex = (sc.isGrandmaFriend && this.textures.exists('d_grandma')) ? 'd_grandma' : 'chest_closed';
            const spr = this.add.image(cx, cy, tex)
                .setDisplaySize(sc.isGrandmaFriend ? 38 : 36, sc.isGrandmaFriend ? 42 : 34)
                .setDepth(DEPTH.PROP + 1);
            const label = this.add.text(cx, cy - 26, sc.isGrandmaFriend ? '🐭 СПАСИ!' : '🎁 ТАЙНИК x2', {
                fontFamily: 'Nunito, sans-serif',
                fontSize: '11px',
                fontStyle: '900',
                color: '#1a0c2e',
                backgroundColor: '#f9a8d4',
                padding: { x: 5, y: 2 },
            }).setOrigin(0.5).setDepth(DEPTH.WORLD_UI);

            this.tweens.add({
                targets: aura,
                scale: 1.28,
                alpha: 0.4,
                duration: 820,
                yoyo: true,
                repeat: -1,
            });

            this.secretChest = {
                x: cx,
                y: cy,
                cheeseBonus: sc.cheeseBonus,
                isGrandmaFriend: sc.isGrandmaFriend,
                aura,
                spr,
                label,
                opened: false,
            };
        }

        // === БОНУСЫ-УСИЛИТЕЛИ (Плащ-Невидимка, Сырный Магнит, Турбо-Лапки) ===
        this.boosters = [];
        const boosterMeta = {
            cloak:  { emoji: '🧥', color: 0x818cf8, title: 'НЕВИДИМКА!' },
            magnet: { emoji: '🧲', color: 0xf43f5e, title: 'СЫРНЫЙ МАГНИТ!' },
            turbo:  { emoji: '⚡', color: 0x38bdf8, title: 'ТУРБО-ЛАПКИ!' },
        };
        for (const b of (this.level.boosters || [])) {
            const meta = boosterMeta[b.type] || boosterMeta.turbo;
            const cx = (b.x + 0.5) * CELL;
            const cy = (b.y + 0.5) * CELL;
            const ring = this.add.circle(cx, cy, 17, meta.color, 0.28)
                .setStrokeStyle(2, meta.color, 0.9)
                .setDepth(DEPTH.PROP);
            const txt = this.add.text(cx, cy, meta.emoji, { fontSize: '19px' })
                .setOrigin(0.5).setDepth(DEPTH.PROP + 1);
            this.tweens.add({ targets: [ring, txt], y: '-=4', duration: 680, yoyo: true, repeat: -1 });
            this.boosters.push({ x: cx, y: cy, type: b.type, meta, ring, txt, taken: false });
        }

        // === ОБЫЧНЫЙ СЫР И ДОПОЛНИТЕЛЬНЫЕ ПИРОГИ ===
        this.pickups = [];
        for (const p of (this.level.pickups || [])) {
            const cx = (p.x + 0.5) * CELL;
            const cy = (p.y + 0.5) * CELL;
            const tex = p.type === 'cheese' ? 'd_cheese' : 'd_pie';
            const spr = this.textures.exists(tex)
                ? this.add.image(cx, cy, tex).setDisplaySize(p.type === 'cheese' ? 24 : 24, p.type === 'cheese' ? 20 : 24).setDepth(DEPTH.PROP)
                : this.add.circle(cx, cy, 9, p.type === 'cheese' ? 0xffd040 : 0xf0c060, 1).setDepth(DEPTH.PROP);
            this.pickups.push({ type: p.type, x: cx, y: cy, value: p.value || 3, spr, taken: false });
        }
    }

    setupCamera() {
        const w = this.level.cols * CELL;
        const h = this.level.rows * CELL;
        const padX = 16;
        const padY = 54;
        const fit = Math.min((this.cssW - padX * 2) / w, (this.cssH - padY * 2) / h);
        const k = Math.max(0.95, Math.min(2.2, fit));
        const cam = this.cameras.main;
        cam.setZoom(this.dpr * k);
        this.roomW = w;
        this.roomH = h;
        this.roomFits = (w * k <= this.cssW + 12) && (h * k <= this.cssH + 24);
        if (!this.roomFits) {
            cam.setBounds(-CELL, -CELL, w + CELL * 2, h + CELL * 2);
        }
        cam.centerOn(w / 2, h / 2);
        this._camReady = true;
    }

    drawPatrolRoutes() {
        const g = this.add.graphics().setDepth(DEPTH.PATROL_LINE);
        g.setAlpha(0.32);
        for (const mCfg of this.level.monsters) {
            if (!mCfg.patrol || mCfg.patrol.length < 2) continue;
            const pts = mCfg.patrol.map(p => ({ x: (p.x + 0.5) * CELL, y: (p.y + 0.5) * CELL }));
            for (let i = 0; i < pts.length; i++) {
                const a = pts[i], b = pts[(i + 1) % pts.length];
                const dx = b.x - a.x, dy = b.y - a.y;
                const len = Math.hypot(dx, dy) || 1;
                const dots = Math.max(1, Math.round(len / 24));
                for (let k = 0; k < dots; k++) {
                    const t = k / dots;
                    g.fillStyle(mCfg.coneColor || 0xe8b54a, 0.55);
                    g.fillCircle(a.x + dx * t, a.y + dy * t, 2.2);
                }
            }
        }
        this.patrolRouteGfx = g;
    }

    // =========================================================================
    // СПАВН МЫШОНКА ПИ (С ПОДДЕРЖКОЙ СКИНОВ И АНИМАЦИИ) И МОНСТРОВ ЗАМКА
    // =========================================================================
    _resolvePlayerKeys() {
        try {
            const sk = Progress.getCurrentSkin && Progress.getCurrentSkin();
            if (sk && sk.id && sk.id !== 'blue') {
                const safeId = sk.id.replace(/-/g, '_');
                const stand = 'skin_' + safeId;
                if (this.textures.exists(stand)) {
                    return {
                        stand,
                        w1: this.textures.exists(stand + '_w1') ? stand + '_w1' : stand,
                        w2: this.textures.exists(stand + '_w2') ? stand + '_w2' : stand,
                        standB: this.textures.exists(stand + '_b') ? stand + '_b' : stand,
                        w1B: this.textures.exists(stand + '_w1_b') ? stand + '_w1_b' : stand,
                        w2B: this.textures.exists(stand + '_w2_b') ? stand + '_w2_b' : stand,
                    };
                }
            }
        } catch (_) {}
        return {
            stand: 'd_pi',
            w1: this.textures.exists('d_pi_walk1') ? 'd_pi_walk1' : 'd_pi',
            w2: this.textures.exists('d_pi_walk2') ? 'd_pi_walk2' : 'd_pi',
            standB: this.textures.exists('d_pi_b') ? 'd_pi_b' : 'd_pi',
            w1B: this.textures.exists('d_pi_walk1_b') ? 'd_pi_walk1_b' : 'd_pi',
            w2B: this.textures.exists('d_pi_walk2_b') ? 'd_pi_walk2_b' : 'd_pi',
        };
    }

    spawnPlayer() {
        const px = (this.level.entry.x + 0.5) * CELL;
        const py = (this.level.entry.y + 0.5) * CELL;
        this.skinKeys = this._resolvePlayerKeys();
        this.player = {
            x: px,
            y: py,
            vx: 0,
            vy: 0,
            facingX: 1,
            facingY: 0,
            hidden: false,
        };
        this._playerW = CELL * 0.80;
        this._playerH = CELL * 0.92;
        this.player.shadow = this.add.ellipse(px, py + this._playerH * 0.42, this._playerW * 0.72, 10, 0x000000, 0.42)
            .setDepth(DEPTH.PLAYER - 1);
        this.player.aura = this.add.circle(px, py, CELL * 0.48, 0x818cf8, 0)
            .setDepth(DEPTH.PLAYER - 1);
        this.player.sprite = this.add.image(px, py, this.skinKeys.stand)
            .setDepth(DEPTH.PLAYER)
            .setDisplaySize(this._playerW, this._playerH);

        if (this._camReady && !this.roomFits) {
            this.cameras.main.startFollow(this.player.sprite, true, 0.14, 0.14);
        }
    }

    spawnMonsters() {
        this.coneGfx = this.add.graphics().setDepth(DEPTH.CONE);
        this.susGfx  = this.add.graphics().setDepth(DEPTH.WORLD_UI);
        this.monsters = [];

        for (const cfg of this.level.monsters) {
            if (!cfg.patrol || cfg.patrol.length < 2) continue;
            const start = positionAt(cfg.patrol, cfg.speed, CELL, cfg.startOffsetMs || 0);
            const tex = this.textures.exists(cfg.texture) ? cfg.texture : 'd_cat';
            const mw = CELL * (cfg.scaleW || 0.95);
            const mh = CELL * (cfg.scaleH || 0.90);

            const shadow = this.add.ellipse(start.x, start.y + mh * 0.42, mw * 0.74, 10, 0x000000, 0.42)
                .setDepth(DEPTH.MONSTER - 1);
            const sprite = this.add.image(start.x, start.y, tex)
                .setDepth(DEPTH.MONSTER)
                .setDisplaySize(mw, mh);
            const badge = this.add.text(start.x, start.y - mh * 0.65, '', {
                fontFamily: 'Nunito, sans-serif',
                fontSize: '16px',
                fontStyle: '900',
                color: '#ffd040',
            }).setOrigin(0.5).setDepth(DEPTH.WORLD_UI);

            this.monsters.push({
                cfg,
                t: cfg.startOffsetMs || 0,
                x: start.x,
                y: start.y,
                angle: start.angle,
                suspicion: 0,
                state: 'patrol',
                confusedUntil: 0,
                noiseUntil: 0,
                noiseX: 0,
                noiseY: 0,
                bobPhase: Math.random() * Math.PI * 2,
                baseW: mw,
                baseH: mh,
                sprite,
                shadow,
                badge,
            });
        }
    }

    // =========================================================================
    // СТИЛЬНОЕ МОБИЛЬНОЕ АРКАДНОЕ УПРАВЛЕНИЕ (КАК В «СНЕЖКАХ»)
    // =========================================================================
    setupArcadeControls() {
        const s = this.safe || { left: 0, right: 0, top: 0, bottom: 0 };
        const padLeft = Math.max(this.ui(24), Math.round((s.left || 0) * this.dpr) + this.ui(18));
        const padRight = Math.max(this.ui(24), Math.round((s.right || 0) * this.dpr) + this.ui(18));
        const padBottom = Math.max(this.ui(22), Math.round((s.bottom || 0) * this.dpr) + this.ui(14));

        // 1. Левый виртуальный аркадный стик (всегда виден полупрозрачно, оживает под пальцем)
        const R = this.ui(58);
        const homeX = padLeft + R;
        const homeY = this.viewH - padBottom - R;
        this.joy = { active: false, id: null, homeX, homeY, baseX: homeX, baseY: homeY, dx: 0, dy: 0 };
        this.joyR = R;

        this.joyGlow = this._registerUiObj(
            this.add.circle(homeX, homeY, R * 1.12, 0x38bdf8, 0.10)
                .setStrokeStyle(this.ui(2), 0x7dd3fc, 0.35)
                .setScrollFactor(0).setDepth(DEPTH.HUD)
        );
        if (this.textures.exists('ctl_base_move')) {
            this.joyBase = this._registerUiObj(
                this.add.image(homeX, homeY, 'ctl_base_move')
                    .setDisplaySize(R * 2.1, R * 2.1)
                    .setAlpha(0.75)
                    .setScrollFactor(0).setDepth(DEPTH.HUD + 1)
            );
            this.joyKnob = this._registerUiObj(
                this.add.image(homeX, homeY, 'ctl_knob_move')
                    .setDisplaySize(R * 0.98, R * 0.98)
                    .setAlpha(0.92)
                    .setScrollFactor(0).setDepth(DEPTH.HUD + 2)
            );
        } else {
            this.joyBase = this._registerUiObj(
                this.add.circle(homeX, homeY, R, 0x1e293b, 0.65)
                    .setStrokeStyle(this.ui(3), 0x38bdf8, 0.7)
                    .setScrollFactor(0).setDepth(DEPTH.HUD + 1)
            );
            this.joyKnob = this._registerUiObj(
                this.add.circle(homeX, homeY, R * 0.44, 0x38bdf8, 0.9)
                    .setScrollFactor(0).setDepth(DEPTH.HUD + 2)
            );
        }

        // 2. Правая главная кнопка: «🕳️ В НОРУ / РЫВОК»
        const burrowR = this.ui(44);
        const burrowCx = this.viewW - padRight - burrowR;
        const burrowCy = this.viewH - padBottom - burrowR;
        const burrowShadow = this._registerUiObj(
            this.add.circle(burrowCx, burrowCy + this.ui(5), burrowR, 0x090414, 0.65)
                .setScrollFactor(0).setDepth(DEPTH.HUD)
        );
        const burrowRing = this._registerUiObj(
            this.add.circle(burrowCx, burrowCy, burrowR, 0x3b1d6e, 0.94)
                .setStrokeStyle(this.ui(3.5), 0xe8b54a, 1)
                .setScrollFactor(0).setDepth(DEPTH.HUD + 1)
        );
        const burrowIcon = this._registerUiObj(
            this.add.text(burrowCx, burrowCy - this.ui(8), '🕳️', {
                fontSize: this.ui(24) + 'px',
            }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.HUD + 2)
        );
        const burrowLabel = this._registerUiObj(
            this.add.text(burrowCx, burrowCy + this.ui(16), 'РЫВОК', {
                fontFamily: 'Nunito, sans-serif',
                fontSize: this.ui(11) + 'px',
                fontStyle: '900',
                color: '#fde047',
            }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.HUD + 2)
        );
        this.burrowBtn = { cx: burrowCx, cy: burrowCy, r: burrowR, shadow: burrowShadow, ring: burrowRing, icon: burrowIcon, label: burrowLabel };

        // 3. Вторая кнопка справа: «🥧 ПИРОГ» (отвлечь шумом / ослепить кремом)
        const pieR = this.ui(36);
        const pieCx = burrowCx - burrowR - pieR - this.ui(16);
        const pieCy = burrowCy + this.ui(4);
        const pieShadow = this._registerUiObj(
            this.add.circle(pieCx, pieCy + this.ui(4), pieR, 0x090414, 0.65)
                .setScrollFactor(0).setDepth(DEPTH.HUD)
        );
        const pieRing = this._registerUiObj(
            this.add.circle(pieCx, pieCy, pieR, 0x7c2d12, 0.94)
                .setStrokeStyle(this.ui(3), 0xfbbf24, 1)
                .setScrollFactor(0).setDepth(DEPTH.HUD + 1)
        );
        const pieIcon = this._registerUiObj(
            this.add.text(pieCx, pieCy - this.ui(6), '🥧', {
                fontSize: this.ui(21) + 'px',
            }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.HUD + 2)
        );
        const pieCountBadge = this._registerUiObj(
            this.add.text(pieCx, pieCy + this.ui(14), `x${this.pies}`, {
                fontFamily: 'Nunito, sans-serif',
                fontSize: this.ui(12) + 'px',
                fontStyle: '900',
                color: '#fef08a',
            }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.HUD + 2)
        );
        this.pieBtn = { cx: pieCx, cy: pieCy, r: pieR, shadow: pieShadow, ring: pieRing, icon: pieIcon, badge: pieCountBadge };

        this.input.addPointer(3);

        this.input.on('pointerdown', (p) => {
            if (this.state !== 'play') return;
            // Проверяем верхние кнопки HUD (Пауза, Звук, Выход)
            if (p.y < this.ui(64)) return;

            // 1. Нажатие на кнопку «НОРА / РЫВОК»
            if (Math.hypot(p.x - this.burrowBtn.cx, p.y - this.burrowBtn.cy) <= this.burrowBtn.r * 1.28) {
                this.burrowBtn.ring.setScale(0.92);
                this.triggerBurrowOrDash();
                return;
            }

            // 2. Нажатие на кнопку «ПИРОГ»
            if (Math.hypot(p.x - this.pieBtn.cx, p.y - this.pieBtn.cy) <= this.pieBtn.r * 1.28) {
                this.pieBtn.ring.setScale(0.92);
                this.triggerSmartPieThrow();
                return;
            }

            // 3. Левая половина экрана — виртуальный аркадный джойстик
            if (p.x <= this.viewW * 0.52 && !this.joy.active) {
                this.joy.active = true;
                this.joy.id = p.id;
                this.joy.baseX = p.x;
                this.joy.baseY = p.y;
                this.joyGlow.setPosition(p.x, p.y).setAlpha(0.24);
                this.joyBase.setPosition(p.x, p.y).setAlpha(0.95);
                this.joyKnob.setPosition(p.x, p.y).setAlpha(1);
                return;
            }

            // 4. Тап по правой части карты — прицельный бросок пирога в точку на карте (или нырок, если тапнули прямо по норе рядом с Пи!)
            const wp = this.cameras.main.getWorldPoint(p.x, p.y);
            const nearHole = this.nearestHole();
            if (nearHole && Math.hypot(wp.x - nearHole.x, wp.y - nearHole.y) <= CELL * 0.95) {
                this.enterHole(nearHole);
                return;
            }
            this.throwPie(wp.x, wp.y);
        });

        this.input.on('pointermove', (p) => {
            if (!this.joy.active || p.id !== this.joy.id) return;
            const dx = p.x - this.joy.baseX;
            const dy = p.y - this.joy.baseY;
            const d = Math.hypot(dx, dy);
            const DEAD = this.ui(6);
            if (d < DEAD) {
                this.joy.dx = 0;
                this.joy.dy = 0;
            } else {
                const clamped = Math.min(d, R);
                this.joy.dx = (dx / d) * (clamped / R);
                this.joy.dy = (dy / d) * (clamped / R);
            }
            this.joyKnob.setPosition(
                this.joy.baseX + this.joy.dx * R,
                this.joy.baseY + this.joy.dy * R,
            );
        });

        const releasePointer = (p) => {
            this.burrowBtn.ring.setScale(1);
            this.pieBtn.ring.setScale(1);
            if (this.joy.active && p.id === this.joy.id) {
                this.joy.active = false;
                this.joy.id = null;
                this.joy.dx = 0;
                this.joy.dy = 0;
                this.joyGlow.setPosition(this.joy.homeX, this.joy.homeY).setAlpha(0.10);
                this.joyBase.setPosition(this.joy.homeX, this.joy.homeY).setAlpha(0.75);
                this.joyKnob.setPosition(this.joy.homeX, this.joy.homeY).setAlpha(0.92);
            }
        };
        this.input.on('pointerup', releasePointer);
        this.input.on('pointerupoutside', releasePointer);
    }

    // =========================================================================
    // ВЕРХНИЙ HUD-БАР (СЕРДЕЧКИ, СЫР, СЕРИЯ НЕВИДИМКИ, ЦЕЛЬ ЭТАЖА, КНОПКИ)
    // =========================================================================
    buildHud() {
        const s = this.safe || { left: 0, right: 0, top: 0 };
        const topY = Math.max(this.ui(10), Math.round((s.top || 0) * this.dpr) + this.ui(8));
        const leftX = Math.max(this.ui(16), Math.round((s.left || 0) * this.dpr) + this.ui(14));
        const rightX = this.viewW - Math.max(this.ui(16), Math.round((s.right || 0) * this.dpr) + this.ui(14));

        // Левая плашка: Сердечки + Сыр + Комбо
        this.hudStatsText = this._registerUiObj(
            this.add.text(leftX, topY, '', {
                fontFamily: 'Nunito, sans-serif',
                fontSize: this.ui(16) + 'px',
                fontStyle: '900',
                color: '#fef08a',
                backgroundColor: '#1a0c2ecc',
                padding: { x: this.ui(10), y: this.ui(6) },
            }).setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH.HUD + 5)
        );

        // Плашка активного супер-бонуса под статами
        this.hudBoosterText = this._registerUiObj(
            this.add.text(leftX, topY + this.ui(36), '', {
                fontFamily: 'Nunito, sans-serif',
                fontSize: this.ui(13) + 'px',
                fontStyle: '900',
                color: '#ffffff',
                backgroundColor: '#4f46e5dd',
                padding: { x: this.ui(9), y: this.ui(4) },
            }).setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH.HUD + 5).setVisible(false)
        );

        // Центральный баннер этажа и главной задачи
        this.goalBanner = this._registerUiObj(
            this.add.text(this.viewW / 2, topY, '', {
                fontFamily: 'Nunito, sans-serif',
                fontSize: this.ui(15) + 'px',
                fontStyle: '900',
                color: '#1a0c2e',
                backgroundColor: '#fbbf24',
                padding: { x: this.ui(14), y: this.ui(6) },
            }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(DEPTH.HUD + 5)
        );

        // Правые кнопки: Звук, Пауза, В меню
        const btnSize = this.ui(36);
        const makeTopBtn = (x, label, onClick) => {
            const bg = this._registerUiObj(
                this.add.circle(x, topY + btnSize / 2, btnSize / 2, 0x241338, 0.92)
                    .setStrokeStyle(this.ui(2), 0x8a68c8, 0.85)
                    .setScrollFactor(0).setDepth(DEPTH.HUD + 5)
                    .setInteractive({ useHandCursor: true })
            );
            const txt = this._registerUiObj(
                this.add.text(x, topY + btnSize / 2, label, {
                    fontFamily: 'Nunito, sans-serif',
                    fontSize: this.ui(16) + 'px',
                    fontStyle: '900',
                    color: '#f4ecff',
                }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.HUD + 6)
            );
            bg.on('pointerdown', (p, lx, ly, ev) => {
                if (ev && ev.stopPropagation) ev.stopPropagation();
                bus.emit(UI.BUTTON_CLICK);
                onClick(txt);
            });
            return { bg, txt };
        };

        this.exitTopBtn = makeTopBtn(rightX - btnSize * 0.5, '✕', () => {
            this.exitToCastleMenu();
        });
        this.pauseTopBtn = makeTopBtn(rightX - btnSize * 1.75, '⏸', () => {
            this.togglePauseModal();
        });
        const isMuted = localStorage.getItem('mousie_muted') === '1';
        this.muteTopBtn = makeTopBtn(rightX - btnSize * 3.0, isMuted ? '🔇' : '🔊', (txtObj) => {
            const nowMuted = window.audio ? window.audio.toggleMute() : !(localStorage.getItem('mousie_muted') === '1');
            localStorage.setItem('mousie_muted', nowMuted ? '1' : '0');
            txtObj.setText(nowMuted ? '🔇' : '🔊');
        });

        this.updateHud();
    }

    updateHud() {
        const heartsStr = '❤️'.repeat(Math.max(0, this.hearts)) + '🖤'.repeat(Math.max(0, this.maxHearts - this.hearts));
        const streakStr = this.streak >= 1 ? ` · 🔥x${1 + Math.min(4, Math.floor(this.streak / 2)) * 0.5}` : '';
        if (this.hudStatsText) {
            this.hudStatsText.setText(`${heartsStr}   🧀 ${this.cheeseThisRun}${streakStr}`);
        }
        if (this.pieBtn && this.pieBtn.badge) {
            this.pieBtn.badge.setText(`x${this.pies}`);
        }

        const totalGold = this.goldenCheeses.length;
        const takenGold = this.goldenCheeses.filter(g => g.taken).length;
        if (this.goalBanner) {
            if (takenGold < totalGold) {
                this.goalBanner.setText(`${this.biome.icon} Этаж ${this.floor} · 👑 Золотой сыр: ${takenGold}/${totalGold}`);
                this.goalBanner.setStyle({ backgroundColor: '#fbbf24', color: '#1a0c2e' });
            } else {
                this.goalBanner.setText(`${this.biome.icon} Этаж ${this.floor} · 🚪 ЛЮК ОТКРЫТ! Беги к выходу!`);
                this.goalBanner.setStyle({ backgroundColor: '#4ade80', color: '#052e16' });
            }
        }
    }

    showFloorIntroToast() {
        const title = this.level.isBossFloor
            ? `👑 ЭТАЖ ${this.floor}: СОКРОВИЩНИЦА ГРАФА РАТУЛЫ!`
            : `${this.biome.icon} ЭТАЖ ${this.floor} · ${this.biome.name.toUpperCase()}`;
        const sub = this.floor === 1
            ? 'Прячься в цветные норы 🕳️ · собери Золотой Сыр 👑 · открой Тайник 🎁'
            : (this.level.isBossFloor ? 'Сам Граф Ратула стережёт Королевский Сыр! Используй норы!' : this.biome.ambient);

        const banner = this._registerUiObj(
            this.add.text(this.viewW / 2, this.viewH * 0.20, `${title}\n${sub}`, {
                fontFamily: 'Nunito, sans-serif',
                fontSize: this.ui(15) + 'px',
                fontStyle: '900',
                align: 'center',
                color: '#fef08a',
                backgroundColor: '#1a0c2eee',
                padding: { x: this.ui(18), y: this.ui(10) },
            }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.HUD + 8)
        );
        this.tweens.add({
            targets: banner,
            alpha: 0,
            y: this.viewH * 0.16,
            delay: 2800,
            duration: 600,
            onComplete: () => banner.destroy(),
        });
    }

    // =========================================================================
    // ПРОЦЕДУРНЫЕ ДОФАМИНОВЫЕ АУДИО-АККОРДЫ (В ДОПОЛНЕНИЕ К AUDIO MANAGER)
    // =========================================================================
    _playHeistChime(type = 'burrow') {
        try {
            if (localStorage.getItem('mousie_muted') === '1' || document.hidden) return;
            const ac = this.sound?.context;
            if (!ac || ac.state !== 'running') return;
            const now = ac.currentTime;
            const notes = {
                burrow:  [392.0, 523.25, 659.25, 783.99],
                gold:    [523.25, 659.25, 783.99, 1046.5],
                chest:   [440.0, 554.37, 659.25, 880.0, 1108.73],
                unlock:  [587.33, 740.0, 880.0, 1174.66],
                smoke:   [320.0, 240.0, 180.0],
            }[type] || [523.25, 659.25];

            notes.forEach((freq, i) => {
                const osc = ac.createOscillator();
                const g = ac.createGain();
                osc.type = type === 'smoke' ? 'sawtooth' : 'triangle';
                osc.frequency.setValueAtTime(freq, now + i * 0.045);
                g.gain.setValueAtTime(0.11, now + i * 0.045);
                g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.045 + 0.13);
                osc.connect(g);
                g.connect(ac.destination);
                osc.start(now + i * 0.045);
                osc.stop(now + i * 0.045 + 0.14);
            });
        } catch (_) {}
    }

    // =========================================================================
    // ИГРОВОЙ ЦИКЛ (UPDATE)
    // =========================================================================
    update(_time, dtMs) {
        const dt = Math.min(dtMs, 50) / 1000;
        if (this.state !== 'play') return;

        this.updateBurrowButtonState();
        this.updateActiveBoosters();
        this.updatePlayer(dt);
        this.updateMonsters(dt);
        this.checkPickupsAndGoals(dt);
    }

    nearestHole(maxDist = CELL * 1.18) {
        if (!this.player) return null;
        let best = null;
        let bestD = Infinity;
        for (const h of this.holes) {
            const d = Math.hypot(h.x - this.player.x, h.y - this.player.y);
            if (d < bestD) { bestD = d; best = h; }
        }
        return bestD <= maxDist ? best : null;
    }

    updateBurrowButtonState() {
        const near = this.nearestHole();
        if (!this.burrowBtn) return;
        if (near && !this.player.hidden) {
            this.burrowBtn.ring.setFillStyle(near.palette.color, 0.95);
            this.burrowBtn.icon.setText('🕳️');
            this.burrowBtn.label.setText('В НОРУ!');
            this.burrowBtn.label.setColor('#090414');
            this._showHoleHint(near);
        } else {
            const cd = this.time.now < this.dashCooldownUntil;
            this.burrowBtn.ring.setFillStyle(cd ? 0x1e1b2e : 0x3b1d6e, 0.94);
            this.burrowBtn.icon.setText('💨');
            this.burrowBtn.label.setText(cd ? 'ЖДИ...' : 'РЫВОК');
            this.burrowBtn.label.setColor('#fde047');
            this._showHoleHint(null);
        }
    }

    _showHoleHint(near) {
        if (!near || this.player.hidden) {
            if (this.holeHint) { this.holeHint.destroy(); this.holeHint = null; this._hintFor = null; }
            return;
        }
        if (this.holeHint && this._hintFor === near) return;
        if (this.holeHint) this.holeHint.destroy();
        this._hintFor = near;
        this.holeHint = this._registerWorldObj(
            this.add.text(near.x, near.y - CELL * 0.72, `🕳️ НЫРНУТЬ (${near.palette.name})`, {
                fontFamily: 'Nunito, sans-serif',
                fontStyle: '900',
                fontSize: '11px',
                color: '#0b0616',
                backgroundColor: near.palette.hex,
                padding: { x: 6, y: 2 },
            }).setOrigin(0.5, 1).setDepth(DEPTH.WORLD_UI)
        );
    }

    // Мгновенный нырок в нору ИЛИ тихий кувырок-рывок!
    triggerBurrowOrDash() {
        if (this.state !== 'play' || this.player.hidden) return;
        const near = this.nearestHole();
        if (near && this.time.now >= this.burrowCooldownUntil) {
            this.enterHole(near);
            return;
        }
        // Если рядом нет норы — делаем быстрый тихий кувырок!
        if (this.time.now < this.dashCooldownUntil) return;
        this.dashCooldownUntil = this.time.now + 1800;
        bus.emit(SFX.PLAYER_DASH);

        const dashDist = CELL * 1.65;
        const steps = 8;
        const stepX = (this.player.facingX * dashDist) / steps;
        const stepY = (this.player.facingY * dashDist) / steps;

        // Облачко пыли на месте старта рывка
        const puff = this._registerWorldObj(
            this.add.circle(this.player.x, this.player.y, 14, 0xe9d5ff, 0.55).setDepth(DEPTH.FX)
        );
        this.tweens.add({ targets: puff, scale: 2.1, alpha: 0, duration: 260, onComplete: () => puff.destroy() });

        for (let i = 0; i < steps; i++) {
            this.moveTo(this.player.x + stepX, this.player.y + stepY);
        }
        this.showFloatingText(this.player.x, this.player.y - 28, '💨 Вжух!', '#bae6fd');
    }

    // Мгновенный телепорт через цветную нору!
    enterHole(hole) {
        if (this.state !== 'play') return;
        this.burrowCooldownUntil = this.time.now + 450;
        if (this.holeHint) { this.holeHint.destroy(); this.holeHint = null; this._hintFor = null; }

        this.player.hidden = true;
        this.state = 'squeeze';
        bus.emit(SFX.PLAYER_DASH);
        this._playHeistChime('burrow');

        const other = (hole.mouth === hole.pair.a) ? hole.pair.b : hole.pair.a;
        const tx = (other.x + 0.5) * CELL;
        const ty = (other.y + 0.5) * CELL;

        // Вспышка на входе в нору
        const flashIn = this._registerWorldObj(
            this.add.circle(hole.x, hole.y, CELL * 0.5, hole.palette.color, 0.75).setDepth(DEPTH.FX)
        );
        this.tweens.add({ targets: flashIn, scale: 1.8, alpha: 0, duration: 300, onComplete: () => flashIn.destroy() });

        this.tweens.add({
            targets: [this.player.sprite, this.player.shadow, this.player.aura],
            x: tx,
            y: ty,
            scaleX: 0.25,
            scaleY: 0.25,
            duration: 280,
            ease: 'Cubic.easeInOut',
            onComplete: () => {
                this.player.x = tx;
                this.player.y = ty;
                this.player.sprite.setDisplaySize(this._playerW, this._playerH);
                this.player.shadow.setPosition(tx, ty + this._playerH * 0.42).setScale(1);
                this.player.aura.setPosition(tx, ty).setScale(1);
                this.player.hidden = false;
                this.invulnUntil = Math.max(this.invulnUntil, this.time.now + 900);
                this.state = 'play';

                // Вспышка на выходе из парной норы
                const flashOut = this._registerWorldObj(
                    this.add.circle(tx, ty, CELL * 0.52, hole.palette.color, 0.75).setDepth(DEPTH.FX)
                );
                this.tweens.add({ targets: flashOut, scale: 1.9, alpha: 0, duration: 320, onComplete: () => flashOut.destroy() });

                // Если за Пи гнались монстры — все теряют след и дают бонус «Ловкий нырок!»
                let escapedChase = false;
                for (const m of this.monsters) {
                    if (m.state === 'chase' || m.suspicion > 0.35) {
                        if (m.state === 'chase') escapedChase = true;
                        m.state = 'confused';
                        m.confusedUntil = this.time.now + 2400;
                        m.suspicion = 0;
                        this.showFloatingText(m.x, m.y - 38, '❓ Куда он делся?!', '#ffd040');
                    }
                }
                if (escapedChase) {
                    this.cheeseThisRun += 5;
                    this.streak++;
                    this.updateHud();
                    this.showFloatingText(tx, ty - 34, '🕳️ ЛОВКИЙ ПОБЕГ! +5 🧀', '#4ade80');
                }
            },
        });
    }

    // Умный бросок пирога по кнопке «🥧 ПИРОГ» (автонаведение на ближайшего монстра или вперёд по взгляду)
    triggerSmartPieThrow() {
        if (this.pies <= 0 || this.state !== 'play') {
            this.showFloatingText(this.player.x, this.player.y - 28, 'Нет пирогов! 🥧', '#f87171');
            return;
        }
        let bestM = null;
        let bestD = CELL * 5.5;
        for (const m of this.monsters) {
            const d = Math.hypot(m.x - this.player.x, m.y - this.player.y);
            if (d < bestD) { bestD = d; bestM = m; }
        }
        if (bestM) {
            this.throwPie(bestM.x, bestM.y);
        } else {
            this.throwPie(
                this.player.x + this.player.facingX * CELL * 3.2,
                this.player.y + this.player.facingY * CELL * 3.2
            );
        }
    }

    throwPie(targetX, targetY) {
        if (this.pies <= 0 || this.state !== 'play') return;
        this.pies--;
        this.updateHud();
        bus.emit(SFX.FIRE_PIE);

        const startX = this.player.x;
        const startY = this.player.y;
        const pie = this._registerWorldObj(
            this.textures.exists('d_pie')
                ? this.add.image(startX, startY, 'd_pie').setDisplaySize(24, 24).setDepth(DEPTH.FX)
                : this.add.circle(startX, startY, 8, 0xf0c060, 1).setDepth(DEPTH.FX)
        );
        const dist = Math.hypot(targetX - startX, targetY - startY);

        this.tweens.add({
            targets: pie,
            x: targetX,
            y: targetY,
            angle: 360,
            duration: Math.max(120, Math.min(480, (dist / 580) * 1000)),
            ease: 'Quad.easeOut',
            onComplete: () => {
                pie.destroy();
                this.pieLanded(targetX, targetY);
            },
        });
    }

    pieLanded(x, y) {
        // 1. Проверяем прямое попадание кремовым пирогом в любого монстра рядом
        for (const m of this.monsters) {
            if (Math.hypot(m.x - x, m.y - y) < CELL * 1.15) {
                m.state = 'confused';
                m.confusedUntil = this.time.now + SNEAK.PIE_BLIND_MS;
                m.suspicion = 0;
                bus.emit(SFX.HIT_ENEMY);
                this.showFloatingText(m.x, m.y - 42, '🥧 В КРЕМЕ! Ничего не вижу!', '#ffd040');
                return;
            }
        }
        // 2. Иначе пирог создаёт громкий аппетитный БУХ — ближайший монстр бежит проверять звук!
        bus.emit(SFX.DISTRACTION_THUD);
        this._markNoise(x, y);
        let closestM = null;
        let closestD = CELL * 8;
        for (const m of this.monsters) {
            if (m.state === 'chase') continue;
            const d = Math.hypot(m.x - x, m.y - y);
            if (d < closestD) { closestD = d; closestM = m; }
        }
        if (closestM) {
            closestM.state = 'noise';
            closestM.noiseX = x;
            closestM.noiseY = y;
            closestM.noiseUntil = this.time.now + SNEAK.PIE_NOISE_MS;
            this.showFloatingText(x, y - 20, '🔔 ШУМ! Страж идёт сюда', '#ffffff');
        }
    }

    _markNoise(x, y) {
        const g = this._registerWorldObj(this.add.graphics().setDepth(DEPTH.PATROL_LINE + 1));
        this.tweens.add({
            targets: { r: 0 },
            r: 1,
            duration: 620,
            repeat: 1,
            onUpdate: (_tw, t) => {
                g.clear();
                g.lineStyle(3, 0xfef08a, 0.85 * (1 - t.r));
                g.strokeCircle(x, y, CELL * (0.25 + t.r * 0.85));
            },
            onComplete: () => g.destroy(),
        });
    }

    // =========================================================================
    // АКТИВНЫЕ БОНУСЫ (ПЛАЩ-НЕВИДИМКА, МАГНИТ, ТУРБО-ЛАПКИ)
    // =========================================================================
    updateActiveBoosters() {
        const now = this.time.now;
        const cloakRem  = Math.max(0, this.cloakUntil - now);
        const magnetRem = Math.max(0, this.magnetUntil - now);
        const turboRem  = Math.max(0, this.turboUntil - now);

        const activeParts = [];
        if (cloakRem > 0)  activeParts.push(`🧥 Невидимка ${(cloakRem / 1000).toFixed(0)}с`);
        if (magnetRem > 0) activeParts.push(`🧲 Магнит ${(magnetRem / 1000).toFixed(0)}с`);
        if (turboRem > 0)  activeParts.push(`⚡ Турбо ${(turboRem / 1000).toFixed(0)}с`);

        if (this.hudBoosterText) {
            if (activeParts.length > 0) {
                this.hudBoosterText.setText(activeParts.join('  ·  ')).setVisible(true);
            } else {
                this.hudBoosterText.setVisible(false);
            }
        }

        // Проверяем, стоит ли Пи на коврике тени
        this.inShadow = false;
        if (this.player) {
            for (const sz of this.shadowZones) {
                if (Math.hypot(this.player.x - sz.x, this.player.y - sz.y) <= sz.r) {
                    this.inShadow = true;
                    break;
                }
            }
            const isStealthed = this.inShadow || cloakRem > 0 || now < this.invulnUntil;
            this.player.sprite.setAlpha(isStealthed ? 0.52 : 1.0);
            if (cloakRem > 0) {
                this.player.aura.setFillStyle(0x818cf8, 0.25);
            } else if (turboRem > 0) {
                this.player.aura.setFillStyle(0x38bdf8, 0.22);
            } else if (magnetRem > 0) {
                this.player.aura.setFillStyle(0xf43f5e, 0.20);
            } else {
                this.player.aura.setFillStyle(0x818cf8, 0);
            }
        }
    }

    // =========================================================================
    // ИИ МОНСТРОВ ЗАМКА, КОНУСЫ ЗРЕНИЯ И ДЫМОВАЯ БОМБОЧКА ПРИ ПОИМКЕ
    // =========================================================================
    updateMonsters(dt) {
        if (!this.coneGfx || !this.susGfx) return;
        this.coneGfx.clear();
        this.susGfx.clear();

        const now = this.time.now;
        const playerInvisible = this.player.hidden || this.inShadow || (now < this.cloakUntil) || (now < this.invulnUntil);

        for (const m of this.monsters) {
            if (m.state === 'confused' && now > m.confusedUntil) {
                m.state = 'patrol';
            }

            const prevX = m.x;
            if (m.state === 'patrol' || m.state === 'confused') {
                if (m.state === 'patrol') m.t += dt * 1000;
                const p = positionAt(m.cfg.patrol, m.cfg.speed, CELL, m.t);
                m.x = p.x;
                m.y = p.y;
                m.angle = p.angle;
            } else if (m.state === 'noise') {
                const overdue = now > m.noiseUntil;
                const target = overdue
                    ? positionAt(m.cfg.patrol, m.cfg.speed, CELL, m.t)
                    : { x: m.noiseX, y: m.noiseY };
                const dx = target.x - m.x;
                const dy = target.y - m.y;
                const d = Math.hypot(dx, dy);
                if (overdue && d < CELL * 0.35) {
                    m.state = 'patrol';
                } else if (d > 2) {
                    m.angle = Math.atan2(dy, dx);
                    const step = m.cfg.speed * 1.1 * dt;
                    this.moveMonsterBy(m, (dx / d) * Math.min(d, step), (dy / d) * Math.min(d, step));
                }
            } else if (m.state === 'chase') {
                if (playerInvisible) {
                    // Игрок надел Плащ-невидимку или спрятался в тень!
                    m.state = 'confused';
                    m.confusedUntil = now + 1800;
                    m.suspicion = 0;
                } else {
                    this.chaseStep(m, dt);
                }
            }

            // Плавное покачивание при ходьбе и разворот спрайта
            m.bobPhase += dt * (m.state === 'chase' ? 14 : 8);
            const bobY = Math.sin(m.bobPhase) * 2.5;
            if (Math.abs(m.x - prevX) > 0.2) {
                m.sprite.setFlipX(m.x < prevX);
            }
            m.sprite.setPosition(m.x, m.y + bobY);
            m.shadow.setPosition(m.x, m.y + m.baseH * 0.42);

            // Призрак в Замке слегка мерцает
            if (m.cfg.phases) {
                m.sprite.setAlpha(0.68 + 0.28 * Math.sin(m.bobPhase * 0.5));
            }

            // Проверка попадания Пи в конус взгляда
            const range = m.cfg.coneRange || SNEAK.CONE_RANGE;
            const coneAngle = m.cfg.coneAngle || SNEAK.CONE_ANGLE;
            const sees = !playerInvisible
                && m.state !== 'confused'
                && inCone(this.player.x, this.player.y, m.x, m.y, m.angle, range, coneAngle)
                && this._lineOfSight(m.x, m.y, this.player.x, this.player.y);

            if (sees) {
                const prevSus = m.suspicion;
                m.suspicion = Math.min(1, m.suspicion + SNEAK.SUSPICION_RISE * dt);
                if (prevSus < 0.25 && m.suspicion >= 0.25) {
                    bus.emit(SFX.SUSPICION_TICK);
                }
                if (m.suspicion >= 1 && m.state !== 'chase') {
                    m.state = 'chase';
                    this.everSeenOnFloor = true;
                    this.streak = 0;
                    bus.emit(SFX.ALARM_TRIGGER);
                    this.showFloatingText(m.x, m.y - 44, `❗ ${m.cfg.name}: СТОЙ!`, '#ff6060');
                }
            } else if (m.state !== 'chase') {
                m.suspicion = Math.max(0, m.suspicion - SNEAK.SUSPICION_FALL * dt);
            }

            // Отрисовка значка состояния над головой монстра
            if (m.state === 'confused') {
                m.badge.setText('💫').setPosition(m.x, m.y - m.baseH * 0.68);
            } else if (m.state === 'chase') {
                m.badge.setText('❗').setPosition(m.x, m.y - m.baseH * 0.68);
            } else if (m.state === 'noise') {
                m.badge.setText('👂').setPosition(m.x, m.y - m.baseH * 0.68);
            } else if (m.suspicion > 0.15) {
                m.badge.setText('❓').setPosition(m.x, m.y - m.baseH * 0.68);
            } else {
                m.badge.setText('');
            }

            // Отрисовка веера зрения с отсечением по стенам
            this.drawMonsterCone(m, range, coneAngle);
            this.drawMonsterSuspicion(m);

            // Проверка поимки Пи
            if (!playerInvisible && m.state !== 'confused'
                && Math.hypot(m.x - this.player.x, m.y - this.player.y) < CELL * 0.62) {
                this.onPlayerCaughtBy(m);
                break;
            }
        }
    }

    chaseStep(m, dt) {
        const dx = this.player.x - m.x;
        const dy = this.player.y - m.y;
        const want = Math.atan2(dy, dx);
        let delta = want - m.angle;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;

        const turning = Math.abs(delta) > 0.35;
        const speed = turning ? m.cfg.chaseSpeed * 0.62 : m.cfg.chaseSpeed;
        const maxTurn = (Math.PI / (SNEAK.TURN_BRAKE_MS / 1000)) * dt;
        m.angle += Math.max(-maxTurn, Math.min(maxTurn, delta));

        this.moveMonsterBy(m, Math.cos(m.angle) * speed * dt, Math.sin(m.angle) * speed * dt);
    }

    moveMonsterBy(m, dx, dy) {
        const r = CELL * 0.30;
        if (this._free(m.x + dx, m.y, r)) m.x += dx;
        if (this._free(m.x, m.y + dy, r)) m.y += dy;
    }

    _lineOfSight(x0, y0, x1, y1) {
        const dx = x1 - x0, dy = y1 - y0;
        const dist = Math.hypot(dx, dy);
        const steps = Math.ceil(dist / (CELL * 0.2));
        for (let i = 1; i < steps; i++) {
            const t = i / steps;
            const x = x0 + dx * t, y = y0 + dy * t;
            if (!isFloor(this.tpl, Math.floor(x / CELL), Math.floor(y / CELL))) return false;
        }
        return true;
    }

    _rayHit(x0, y0, angle, maxDist) {
        const step = CELL * 0.24;
        const cx = Math.cos(angle), cy = Math.sin(angle);
        for (let d = step; d <= maxDist; d += step) {
            const x = x0 + cx * d, y = y0 + cy * d;
            if (!isFloor(this.tpl, Math.floor(x / CELL), Math.floor(y / CELL))) return d - step;
        }
        return maxDist;
    }

    drawMonsterCone(m, range, coneAngle) {
        if (m.state === 'confused') return;
        const half = coneAngle / 2;
        const isChase = m.state === 'chase';
        const isSus = m.suspicion > 0.2;
        const col = isChase ? 0xff4757 : (isSus ? 0xffa502 : (m.cfg.coneColor || 0xd8a850));
        const alpha = isChase ? 0.30 : (isSus ? 0.24 : 0.15);

        this.coneGfx.fillStyle(col, alpha);
        const RAYS = 24;
        this.coneGfx.beginPath();
        this.coneGfx.moveTo(m.x, m.y);
        for (let i = 0; i <= RAYS; i++) {
            const a = m.angle - half + (coneAngle * i) / RAYS;
            const d = this._rayHit(m.x, m.y, a, range);
            this.coneGfx.lineTo(m.x + Math.cos(a) * d, m.y + Math.sin(a) * d);
        }
        this.coneGfx.closePath();
        this.coneGfx.fillPath();
    }

    drawMonsterSuspicion(m) {
        if (m.suspicion <= 0.03) return;
        const w = 38;
        const bx = m.x - w / 2;
        const by = m.y - m.baseH * 0.56;
        this.susGfx.fillStyle(0x000000, 0.65);
        this.susGfx.fillRect(bx - 1, by - 1, w + 2, 7);
        this.susGfx.fillStyle(m.suspicion >= 1 ? 0xff4757 : 0xfbbf24, 1);
        this.susGfx.fillRect(bx, by, w * m.suspicion, 5);
    }

    // Прощающая система 3 сердечек с Дымовой Бомбочкой!
    onPlayerCaughtBy(monster) {
        if (this.state !== 'play') return;
        this.hearts--;
        this.streak = 0;
        bus.emit(SFX.TAKE_DAMAGE);
        this._playHeistChime('smoke');
        this.cameras.main.shake(220, 0.012);

        if (this.hearts > 0) {
            // Дымовая бомбочка спасает Пи и телепортирует ко входу этажа!
            for (let i = 0; i < 6; i++) {
                const angle = (Math.PI * 2 * i) / 6;
                const smoke = this._registerWorldObj(
                    this.add.circle(
                        this.player.x + Math.cos(angle) * 14,
                        this.player.y + Math.sin(angle) * 14,
                        18, 0xcbd5e1, 0.75
                    ).setDepth(DEPTH.FX)
                );
                this.tweens.add({
                    targets: smoke,
                    x: smoke.x + Math.cos(angle) * 28,
                    y: smoke.y + Math.sin(angle) * 28,
                    scale: 1.9,
                    alpha: 0,
                    duration: 480,
                    onComplete: () => smoke.destroy(),
                });
            }

            // Все монстры теряют след на 2.5 секунды
            for (const m of this.monsters) {
                m.state = 'confused';
                m.confusedUntil = this.time.now + 2500;
                m.suspicion = 0;
            }

            // Возвращаем Пи в безопасную точку старта этажа с неуязвимостью
            const safeX = (this.level.entry.x + 0.5) * CELL;
            const safeY = (this.level.entry.y + 0.5) * CELL;
            this.player.x = safeX;
            this.player.y = safeY;
            this.player.sprite.setPosition(safeX, safeY);
            this.player.shadow.setPosition(safeX, safeY + this._playerH * 0.42);
            this.player.aura.setPosition(safeX, safeY);
            this.invulnUntil = this.time.now + 2400;
            this.updateHud();
            this.showFloatingText(safeX, safeY - 32, `💨 ДЫМОВАЯ БОМБОЧКА! Осталось ${this.hearts} ❤️`, '#fde047');
            return;
        }

        // Все 3 сердечка потрачены — сохраняем 80% собранного сыра в копилку!
        this.state = 'caught';
        const keptCheese = Math.max(5, Math.round(this.cheeseThisRun * 0.8));
        Progress.recordSneakRun({
            cleared: false,
            neverSeen: false,
            cheese: keptCheese,
            floor: this.floor,
        });
        this.updateHud();
        this.showOutcomeModal({
            win: false,
            title: '💨 ПОЙМАЛИ НА ЭТАЖЕ ' + this.floor,
            subtitle: `Страж ${monster?.cfg?.name || 'Замка'} заметил Пи, но Пи унёс почти всю добычу в лавку!`,
            cheeseEarned: keptCheese,
        });
    }

    // =========================================================================
    // СБОР ЗОЛОТОГО СЫРА, ТАЙНИКА, УСИЛИТЕЛЕЙ И ПЕРЕХОД НА СЛЕДУЮЩИЙ ЭТАЖ
    // =========================================================================
    checkPickupsAndGoals(dt) {
        const magnetActive = this.time.now < this.magnetUntil;
        const magnetRadius = CELL * 3.8;

        // 1. Обычный сыр и пироги
        for (const p of this.pickups) {
            if (p.taken) continue;
            const d = Math.hypot(p.x - this.player.x, p.y - this.player.y);
            if (magnetActive && p.type === 'cheese' && d < magnetRadius && d > CELL * 0.5) {
                p.x += ((this.player.x - p.x) / d) * 320 * dt;
                p.y += ((this.player.y - p.y) / d) * 320 * dt;
                p.spr.setPosition(p.x, p.y);
            }
            if (d > CELL * 0.68) continue;
            p.taken = true;
            p.spr.destroy();
            if (p.type === 'cheese') {
                const mul = 1 + Math.min(4, Math.floor(this.streak / 2)) * 0.5;
                const gain = Math.round(p.value * mul);
                this.cheeseThisRun += gain;
                bus.emit(SFX.COLLECT_CHEESE);
                this.showFloatingText(p.x, p.y - 16, `+${gain} 🧀`, '#ffd040');
            } else {
                this.pies = Math.min(9, this.pies + 1);
                bus.emit(SFX.COLLECT_POWERUP);
                this.showFloatingText(p.x, p.y - 16, '+1 🥧 Пирог!', '#fbbf24');
            }
            this.updateHud();
        }

        // 2. Бонусы-усилители (Невидимка, Магнит, Турбо)
        for (const b of this.boosters) {
            if (b.taken) continue;
            if (Math.hypot(b.x - this.player.x, b.y - this.player.y) > CELL * 0.72) continue;
            b.taken = true;
            b.ring.destroy();
            b.txt.destroy();
            bus.emit(SFX.COLLECT_POWERUP);
            if (b.type === 'cloak') {
                this.cloakUntil = Math.max(this.cloakUntil, this.time.now) + 6500;
            } else if (b.type === 'magnet') {
                this.magnetUntil = Math.max(this.magnetUntil, this.time.now) + 8500;
            } else {
                this.turboUntil = Math.max(this.turboUntil, this.time.now) + 6500;
            }
            this.showFloatingText(b.x, b.y - 24, `${b.meta.emoji} ${b.meta.title}`, '#a5f3fc');
        }

        // 3. Секретный Бонус-Тайник (Сундук или Пленная Мышка)
        if (this.secretChest && !this.secretChest.opened) {
            const sc = this.secretChest;
            if (Math.hypot(sc.x - this.player.x, sc.y - this.player.y) < CELL * 0.78) {
                sc.opened = true;
                if (this.textures.exists('chest_open') && !sc.isGrandmaFriend) {
                    sc.spr.setTexture('chest_open');
                } else {
                    this.tweens.add({ targets: sc.spr, y: sc.y - 18, alpha: 0, duration: 500 });
                }
                sc.aura.setFillStyle(0x4ade80, 0.35);
                sc.label.setText('✨ ОТКРЫТО!').setStyle({ backgroundColor: '#4ade80', color: '#052e16' });
                bus.emit(SFX.OPEN_CHEST);
                this._playHeistChime('chest');

                this.cheeseThisRun += sc.cheeseBonus;
                this.pies = Math.min(9, this.pies + 1);
                this.streak++;
                this.updateHud();
                this.showFloatingText(
                    sc.x,
                    sc.y - 38,
                    sc.isGrandmaFriend ? `🐭 СПАСЕНА! +${sc.cheeseBonus} 🧀 +1 🥧` : `🎁 СУПЕР-ТАЙНИК! +${sc.cheeseBonus} 🧀 +1 🥧`,
                    '#f472b6'
                );
            }
        }

        // 4. Главная цель: Золотые Королевские Сыры
        for (const gc of this.goldenCheeses) {
            if (gc.taken) continue;
            if (Math.hypot(gc.x - this.player.x, gc.y - this.player.y) > CELL * 0.72) continue;
            gc.taken = true;
            gc.spr.destroy();
            gc.aura.destroy();
            gc.crownTag.destroy();
            bus.emit(SFX.KEY_GRAB);
            this._playHeistChime('gold');

            const mul = 1 + Math.min(4, Math.floor(this.streak / 2)) * 0.5;
            const gain = Math.round(gc.value * mul);
            this.cheeseThisRun += gain;

            const remaining = this.goldenCheeses.filter(g => !g.taken).length;
            if (remaining === 0) {
                // Все Золотые Сыры собраны — открываем люк на следующий этаж!
                bus.emit(SFX.DOOR_OPEN);
                this._playHeistChime('unlock');
                this.exitGlow.setFillStyle(0x4ade80, 0.42).setStrokeStyle(3.5, 0x86efac, 1);
                this.exitSprite.setAlpha(1);
                this.exitLabel.setText('🚪 ВЫХОД ОТКРЫТ!').setStyle({
                    backgroundColor: '#16a34a',
                    color: '#ffffff',
                });
                this.tweens.add({
                    targets: this.exitGlow,
                    scale: 1.35,
                    duration: 580,
                    yoyo: true,
                    repeat: -1,
                });
                this.showFloatingText(gc.x, gc.y - 32, `👑 +${gain} 🧀 · ЛЮК ОТКРЫТ!`, '#4ade80');
            } else {
                this.showFloatingText(gc.x, gc.y - 32, `👑 ЗОЛОТОЙ СЫР! +${gain} 🧀 (осталось ${remaining})`, '#fde047');
            }
            this.updateHud();
        }

        // 5. Проверка входа в открытый люк на следующий этаж
        const allGoldTaken = this.goldenCheeses.every(g => g.taken);
        if (allGoldTaken && Math.hypot(this.exitPoint.x - this.player.x, this.exitPoint.y - this.player.y) < CELL * 0.68) {
            this.advanceToNextFloor();
        }
    }

    advanceToNextFloor() {
        if (this.state !== 'play') return;
        this.state = 'cleared';
        bus.emit(SFX.GHOST_RUN);
        this._playHeistChime('chest');

        // Награда за чистый проход этажа без тревоги
        const ghostBonus = !this.everSeenOnFloor ? (10 + this.floor * 3) : 0;
        if (!this.everSeenOnFloor) {
            this.streak += 2;
        }
        const floorEarned = ghostBonus;
        this.cheeseThisRun += floorEarned;

        // Сразу сохраняем прогресс рекорда этажа и сыр в банк, чтобы ничего не пропало!
        Progress.recordSneakRun({
            cleared: true,
            neverSeen: !this.everSeenOnFloor,
            cheese: 12 + ghostBonus,
            floor: this.floor,
        });

        // Короткая праздничная вспышка и автоматический переход на следующий этаж (или выбор забрать куш)
        this.showFloorClearModal(ghostBonus);
    }

    // =========================================================================
    // ДВИЖЕНИЕ И АНИМАЦИЯ МЫШОНКА ПИ
    // =========================================================================
    updatePlayer(dt) {
        let dx = (this.joy && this.joy.active) ? this.joy.dx : 0;
        let dy = (this.joy && this.joy.active) ? this.joy.dy : 0;

        if (this.cursors.left.isDown  || this.keysWASD.A.isDown) dx -= 1;
        if (this.cursors.right.isDown || this.keysWASD.D.isDown) dx += 1;
        if (this.cursors.up.isDown    || this.keysWASD.W.isDown) dy -= 1;
        if (this.cursors.down.isDown  || this.keysWASD.S.isDown) dy += 1;

        const len = Math.hypot(dx, dy);
        if (!len) {
            // Спокойная стойка
            const idleTex = this._facingBack ? this.skinKeys.standB : this.skinKeys.stand;
            if (this.player.sprite.texture.key !== idleTex) {
                this.player.sprite.setTexture(idleTex).setDisplaySize(this._playerW, this._playerH);
            }
            return;
        }

        const nxDir = dx / len;
        const nyDir = dy / len;
        this.player.facingX = nxDir;
        this.player.facingY = nyDir;
        this._facingBack = nyDir < -0.35;

        if (Math.abs(nxDir) > 0.15) {
            this.player.sprite.setFlipX(nxDir < 0);
        }

        const magnitude = Math.min(1, len);
        const turboMul = (this.time.now < this.turboUntil) ? 1.45 : 1.0;
        const speed = SNEAK.WALK_SPEED * 1.12 * turboMul;
        const nx = this.player.x + nxDir * magnitude * speed * dt;
        const ny = this.player.y + nyDir * magnitude * speed * dt;
        this.moveTo(nx, ny);

        // Анимация перебирания лапками и тихие шаги
        this._walkTimer += dt * 1000 * turboMul;
        if (this._walkTimer >= 120) {
            this._walkTimer = 0;
            this._walkFrame = (this._walkFrame + 1) % 2;
            const walkTex = this._facingBack
                ? (this._walkFrame === 0 ? this.skinKeys.w1B : this.skinKeys.w2B)
                : (this._walkFrame === 0 ? this.skinKeys.w1  : this.skinKeys.w2);
            if (this.player.sprite.texture.key !== walkTex) {
                this.player.sprite.setTexture(walkTex).setDisplaySize(this._playerW, this._playerH);
            }
        }
        if (this.time.now - this._lastStepSoundAt > 290) {
            this._lastStepSoundAt = this.time.now;
            bus.emit(SFX.FOOTSTEP, { biome: this.biome.id });
        }
    }

    _free(x, y, r) {
        const l = x - r, rt = x + r, t = y - r, b = y + r;
        return isFloor(this.tpl, Math.floor(l / CELL), Math.floor(t / CELL))
            && isFloor(this.tpl, Math.floor(rt / CELL), Math.floor(t / CELL))
            && isFloor(this.tpl, Math.floor(l / CELL), Math.floor(b / CELL))
            && isFloor(this.tpl, Math.floor(rt / CELL), Math.floor(b / CELL));
    }

    moveTo(nx, ny) {
        const r = CELL * 0.28;
        if (this._free(nx, this.player.y, r)) this.player.x = nx;
        if (this._free(this.player.x, ny, r)) this.player.y = ny;
        this.player.sprite.setPosition(this.player.x, this.player.y);
        this.player.shadow.setPosition(this.player.x, this.player.y + this._playerH * 0.42);
        this.player.aura.setPosition(this.player.x, this.player.y);
    }

    showFloatingText(x, y, text, color = '#ffd040') {
        const t = this._registerWorldObj(
            this.add.text(x, y, text, {
                fontFamily: 'Nunito, sans-serif',
                fontSize: '15px',
                fontStyle: '900',
                color,
                stroke: '#090414',
                strokeThickness: 4,
            }).setOrigin(0.5).setDepth(DEPTH.WORLD_UI + 2)
        );
        this.tweens.add({
            targets: t,
            y: y - 34,
            alpha: 0,
            duration: 950,
            onComplete: () => t.destroy(),
        });
    }

    // =========================================================================
    // МОДАЛЬНЫЕ ОКНА: ПЕРЕХОД НА СЛЕДУЮЩИЙ ЭТАЖ, ПАУЗА И ИТОГ ЗАБЕГА
    // =========================================================================
    showFloorClearModal(ghostBonus) {
        const w = this.viewW, h = this.viewH;
        const px = (v) => this.ui(v);
        const objs = [];
        const addUi = (o) => { this._registerUiObj(o); objs.push(o); return o; };

        addUi(this.add.rectangle(w / 2, h / 2, w, h, 0x090414, 0.86).setScrollFactor(0).setDepth(DEPTH.MODAL));

        const panelW = Math.min(px(390), w - px(32));
        const panelH = px(255);
        addUi(
            this.add.rectangle(w / 2, h / 2, panelW, panelH, 0x241338, 1)
                .setStrokeStyle(px(3), 0x4ade80, 1)
                .setScrollFactor(0).setDepth(DEPTH.MODAL + 1)
        );

        const top = h / 2 - panelH / 2;
        addUi(
            this.add.text(w / 2, top + px(28), `🎉 ЭТАЖ ${this.floor} ПРОЙДЕН!`, {
                fontFamily: 'Nunito, sans-serif',
                fontSize: px(23) + 'px',
                fontStyle: '900',
                color: '#4ade80',
            }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.MODAL + 2)
        );

        const subText = ghostBonus > 0
            ? `🐾 ТИХАЯ ЛАПКА! Ни разу не заметили (+${ghostBonus} 🧀 бонус!)`
            : `Отличный побег! Впереди этаж ${this.floor + 1}!`;
        addUi(
            this.add.text(w / 2, top + px(62), subText, {
                fontFamily: 'Nunito, sans-serif',
                fontSize: px(14) + 'px',
                fontStyle: 'bold',
                color: '#f4ecff',
                align: 'center',
                wordWrap: { width: panelW - px(28) },
            }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.MODAL + 2)
        );

        addUi(
            this.add.text(w / 2, top + px(98), `Добыча забега: 🧀 ${this.cheeseThisRun}   ·   Жизни: ${'❤️'.repeat(this.hearts)}`, {
                fontFamily: 'Nunito, sans-serif',
                fontSize: px(16) + 'px',
                fontStyle: '900',
                color: '#fde047',
            }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.MODAL + 2)
        );

        const makeBtn = (y, label, primary, onClick) => {
            const bw = panelW - px(44);
            const bh = px(46);
            const rect = addUi(
                this.add.rectangle(w / 2, y, bw, bh, primary ? 0x22c55e : 0x4c1d95, 1)
                    .setStrokeStyle(px(2.5), primary ? 0xbbf7d0 : 0xc084fc)
                    .setScrollFactor(0).setDepth(DEPTH.MODAL + 2)
                    .setInteractive({ useHandCursor: true })
            );
            addUi(
                this.add.text(w / 2, y, label, {
                    fontFamily: 'Nunito, sans-serif',
                    fontSize: px(16) + 'px',
                    fontStyle: '900',
                    color: primary ? '#052e16' : '#ffffff',
                }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.MODAL + 3)
            );
            let clicked = false;
            rect.on('pointerdown', () => {
                if (clicked) return;
                clicked = true;
                bus.emit(UI.BUTTON_CLICK);
                onClick();
            });
        };

        makeBtn(top + px(152), `🚀 ДАЛЬШЕ: ЭТАЖ ${this.floor + 1} →`, true, () => {
            this.scene.restart({
                floor: this.floor + 1,
                cheeseThisRun: this.cheeseThisRun,
                pies: Math.min(9, this.pies + 1), // +1 пирог в подарок на новый этаж
                hearts: this.hearts,
                streak: this.streak,
            });
        });

        makeBtn(top + px(210), '🏰 ЗАБРАТЬ СЫР В ЛАВКУ ЗАМКА', false, () => {
            this.exitToCastleMenu();
        });
    }

    togglePauseModal() {
        if (this.state === 'paused' && this._pauseModalObjs) {
            for (const o of this._pauseModalObjs) o.destroy();
            this._pauseModalObjs = null;
            this.state = 'play';
            return;
        }
        if (this.state !== 'play') return;
        this.state = 'paused';

        const w = this.viewW, h = this.viewH;
        const px = (v) => this.ui(v);
        const objs = [];
        const addUi = (o) => { this._registerUiObj(o); objs.push(o); return o; };

        addUi(this.add.rectangle(w / 2, h / 2, w, h, 0x090414, 0.82).setScrollFactor(0).setDepth(DEPTH.MODAL));
        const panelW = Math.min(px(340), w - px(32));
        const panelH = px(230);
        addUi(
            this.add.rectangle(w / 2, h / 2, panelW, panelH, 0x241338, 1)
                .setStrokeStyle(px(3), 0xe8b54a)
                .setScrollFactor(0).setDepth(DEPTH.MODAL + 1)
        );
        const top = h / 2 - panelH / 2;
        addUi(
            this.add.text(w / 2, top + px(28), `⏸ ПАУЗА · ЭТАЖ ${this.floor}`, {
                fontFamily: 'Nunito, sans-serif',
                fontSize: px(22) + 'px',
                fontStyle: '900',
                color: '#fde047',
            }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.MODAL + 2)
        );

        const makeBtn = (y, label, primary, onClick) => {
            const bw = panelW - px(44), bh = px(44);
            const rect = addUi(
                this.add.rectangle(w / 2, y, bw, bh, primary ? 0xe8b54a : 0x4c1d95, 1)
                    .setStrokeStyle(px(2), primary ? 0xfef08a : 0xc084fc)
                    .setScrollFactor(0).setDepth(DEPTH.MODAL + 2)
                    .setInteractive({ useHandCursor: true })
            );
            addUi(
                this.add.text(w / 2, y, label, {
                    fontFamily: 'Nunito, sans-serif',
                    fontSize: px(16) + 'px',
                    fontStyle: '900',
                    color: primary ? '#1a0c2e' : '#ffffff',
                }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.MODAL + 3)
            );
            rect.on('pointerdown', () => {
                bus.emit(UI.BUTTON_CLICK);
                onClick();
            });
        };

        makeBtn(top + px(88), '▶ ПРОДОЛЖИТЬ', true, () => this.togglePauseModal());
        makeBtn(top + px(142), '🔄 ЗАНОВО С 1 ЭТАЖА', false, () => {
            this.scene.restart({ floor: 1, cheeseThisRun: 0, pies: 3, hearts: 3, streak: 0 });
        });
        makeBtn(top + px(196), '🏰 В МЕНЮ ЗАМКА', false, () => this.exitToCastleMenu());

        this._pauseModalObjs = objs;
    }

    showOutcomeModal({ title, subtitle, cheeseEarned }) {
        const w = this.viewW, h = this.viewH;
        const px = (v) => this.ui(v);
        const objs = [];
        const addUi = (o) => { this._registerUiObj(o); objs.push(o); return o; };

        addUi(this.add.rectangle(w / 2, h / 2, w, h, 0x090414, 0.90).setScrollFactor(0).setDepth(DEPTH.MODAL));

        const panelW = Math.min(px(380), w - px(32));
        const panelH = px(260);
        addUi(
            this.add.rectangle(w / 2, h / 2, panelW, panelH, 0x2a1c44, 1)
                .setStrokeStyle(px(3), 0xe8b54a)
                .setScrollFactor(0).setDepth(DEPTH.MODAL + 1)
        );

        const top = h / 2 - panelH / 2;
        addUi(
            this.add.text(w / 2, top + px(28), title, {
                fontFamily: 'Nunito, sans-serif',
                fontSize: px(22) + 'px',
                fontStyle: '900',
                color: '#fde047',
            }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.MODAL + 2)
        );
        addUi(
            this.add.text(w / 2, top + px(64), subtitle, {
                fontFamily: 'Nunito, sans-serif',
                fontSize: px(13) + 'px',
                color: '#e8dcff',
                align: 'center',
                wordWrap: { width: panelW - px(28) },
            }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.MODAL + 2)
        );
        addUi(
            this.add.text(w / 2, top + px(102), `Сохранено в копилку: +${cheeseEarned} 🧀`, {
                fontFamily: 'Nunito, sans-serif',
                fontSize: px(18) + 'px',
                fontStyle: '900',
                color: '#4ade80',
            }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.MODAL + 2)
        );

        const rows = [
            { label: '🔄 ЕЩЁ РАЗ (С 1 ЭТАЖА)', main: true, act: () => this.scene.restart({ floor: 1, cheeseThisRun: 0, pies: 3, hearts: 3, streak: 0 }) },
            { label: '🛍️ В ЛАВКУ ШЛЯП', main: false, act: () => { bus.emit(BGM.MENU); this.scene.start('TransylvaniaScene', { openShop: true }); } },
            { label: '🏰 В МЕНЮ ЗАМКА', main: false, act: () => this.exitToCastleMenu() },
        ];

        let y = top + px(146);
        for (const r of rows) {
            const bw = panelW - px(44), bh = px(38);
            const b = addUi(
                this.add.rectangle(w / 2, y, bw, bh, r.main ? 0xe8b54a : 0x581c87, 1)
                    .setStrokeStyle(px(2), r.main ? 0xfef08a : 0xc084fc)
                    .setScrollFactor(0).setDepth(DEPTH.MODAL + 2)
                    .setInteractive({ useHandCursor: true })
            );
            addUi(
                this.add.text(w / 2, y, r.label, {
                    fontFamily: 'Nunito, sans-serif',
                    fontSize: px(14) + 'px',
                    fontStyle: '900',
                    color: r.main ? '#1a0c2e' : '#ffffff',
                }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.MODAL + 3)
            );
            let fired = false;
            b.on('pointerdown', () => {
                if (fired) return;
                fired = true;
                bus.emit(UI.BUTTON_CLICK);
                r.act();
            });
            y += bh + px(8);
        }
    }

    exitToCastleMenu() {
        bus.emit(BGM.MENU);
        window.location.href = 'transylvania-menu.html';
    }
}
