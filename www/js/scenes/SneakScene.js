import { generateHeistFloor } from '../sneak/ProceduralHeistGenerator.js';
import { Progress } from '../storage/ProgressStore.js';
import { bus } from '../audio/EventBus.js';
import { SFX } from '../audio/SoundKeys.js';
import { preloadAudio } from '../audio/AudioAssetLoader.js';

// ============================================================================
// SneakScene.js — «Тихая Лапка: Том и Джерри в Замке Теней!»
//
// Two-Layer Cutaway («Двухуровневый мир в разрезе: Над полом + Подземная Норка»)
//
// Core Loop for a 10-year-old:
// 1. Cutaway Dollhouse / Ant-Farm View:
//    - TOP LAYER: Castle Rooms where the daughter's hand-drawn monsters patrol
//      around Giant Treasures, Locked Cages, Golden Keys, and Laser Gates.
//    - MIDDLE SLAB: Cross-section floor beam with floorboards, stone bricks,
//      and numbered Vertical Burrow Chutes (#1, #2, #3...). Monsters walking
//      above shake dust & footstep rings ("ТОП-ТОП!") down through the ceiling!
//    - BOTTOM LAYER: Cozy Underground Burrow Network where Pi is 100% safe!
//      Features Pi's Cozy Home Sanctuary (sofa, lamp, growing treasure hoard,
//      rescued pet friends cheering) + Underground Sabotage Levers that disable
//      lasers & drop ceiling cream-cakes on monsters above!
// 2. "Tom & Jerry" Haul-to-Burrow Mechanic:
//    - Grab a Giant Cheese / Crown / Pet Friend in the upper room and carry it
//      to ANY baseboard Mouse-Hole!
//    - Diving into a Mouse-Hole delivers the haul straight to your Cozy Home
//      Nest AND makes any chasing monster SLAM into the wall above the hole
//      ("💥 БАМ! НЕ ДОГНАЛ! 💫") with spinning stars and bonus cheese!
// ============================================================================

const PLAYER_BASE_SPEED = 178;
const PLAYER_BURROW_SPEED = 205;
const PLAYER_DASH_SPEED = 350;
const PLAYER_DASH_MS = 250;
const PLAYER_DASH_CD_MS = 1600;

const CAKE_SPEED = 420;
const CAKE_HEAR_RADIUS = 380;
const CAKE_BLIND_RADIUS = 100;
const CAKE_DISTRACT_MS = 3600;
const CAKE_BLIND_MS = 4200;

const WHISTLE_DISTRACT_MS = 4500;
const CATCH_DIST = 34;
const SUSPICION_FILL_MS = 520;
const SUSPICION_DECAY_MS = 900;

const SKIN_KEYS = [
    'brown', 'pink', 'yellow-antler', 'robot', 'green-monster', 'shadow',
    'devil', 'angel', 'yellow-lion', 'bear', 'frog', 'professor',
    'pirate', 'astronaut', 'kitty', 'beaver', 'cockroach'
];

const RUN_PERKS = [
    {
        id: 'ninja_paws',
        icon: '🐾',
        title: 'Бархатные Лапки',
        desc: '+18% к скорости бега в зале и под землёй',
        color: '#38bdf8'
    },
    {
        id: 'cake_factory',
        icon: '🎂',
        title: 'Сладкий Кондитер',
        desc: '+2 кремовых тортика на каждом этаже',
        color: '#f472b6'
    },
    {
        id: 'burrow_turbo',
        icon: '🚀',
        title: 'Пружинный Лаз',
        desc: 'Выпрыгивание из норки даёт 3 сек. супер-ускорения и невидимости!',
        color: '#a855f7'
    },
    {
        id: 'cheese_magnet',
        icon: '🧲',
        title: 'Сырный Магнит',
        desc: 'Сыр сам летит в лапки издалека (+30% бонусного сыра)',
        color: '#facc15'
    },
    {
        id: 'extra_heart',
        icon: '💖',
        title: 'Уютный Плед в Норке',
        desc: 'Полное лечение сердечек + 20 бонусного сыра в копилку',
        color: '#fb7185'
    }
];

export class SneakScene extends Phaser.Scene {
    constructor() {
        super({ key: 'SneakScene' });
    }

    init(data) {
        this.floor = Math.max(
            1,
            data?.floor || (typeof data?.roomIndex === 'number' ? data.roomIndex + 1 : 1)
        );
        this.carriedCheese = data?.carriedCheese ?? 0;
        this.bankedInRun = data?.bankedInRun ?? 0;
        this.totalRescuedInRun = data?.totalRescuedInRun ?? 0;
        this.streak = data?.streak ?? 1.0;
        this.hearts = data?.hearts ?? 3;
        this.maxHearts = data?.maxHearts ?? 3;
        this.piesLeft = data?.piesLeft ?? 2;
        this.runPerks = data?.runPerks ? { ...data.runPerks } : {};
        this.everSeenInRun = data?.everSeenInRun ?? false;
    }

    preload() {
        preloadAudio(this);

        const base = 'assets/characters/transylvania/';
        this.load.svg('d_pi',       base + 'pi.svg',       { width: 150, height: 172 });
        this.load.svg('d_pi_walk1', base + 'pi-walk1.svg', { width: 150, height: 172 });
        this.load.svg('d_pi_walk2', base + 'pi-walk2.svg', { width: 150, height: 172 });

        const backBase = base + 'back/';
        this.load.svg('d_pi_b',       backBase + 'pi.svg',       { width: 150, height: 172 });
        this.load.svg('d_pi_walk1_b', backBase + 'pi-walk1.svg', { width: 150, height: 172 });
        this.load.svg('d_pi_walk2_b', backBase + 'pi-walk2.svg', { width: 150, height: 172 });

        const skinBase = base + 'skins/';
        for (const k of SKIN_KEYS) {
            const safeId = k.replace(/-/g, '_');
            this.load.svg('skin_' + safeId,         skinBase + k + '.svg',       { width: 150, height: 172 });
            this.load.svg('skin_' + safeId + '_w1', skinBase + k + '-walk1.svg', { width: 150, height: 172 });
            this.load.svg('skin_' + safeId + '_w2', skinBase + k + '-walk2.svg', { width: 150, height: 172 });
            this.load.svg('skin_' + safeId + '_b',  backBase + k + '.svg',       { width: 150, height: 172 });
        }

        this.load.svg('d_zombie',   base + 'zombie.svg',   { width: 180, height: 210 });
        this.load.svg('d_count',    base + 'count.svg',    { width: 200, height: 234 });
        this.load.svg('d_cat',      base + 'cat.svg',      { width: 165, height: 150 });
        this.load.svg('d_slime',    base + 'slime.svg',    { width: 180, height: 135 });
        this.load.svg('d_cheese',   base + 'cheese.svg',   { width: 48,  height: 40 });
        this.load.svg('d_pie',      base + 'pie.svg',      { width: 40,  height: 40 });
        this.load.svg('d_key',      base + 'key.svg',      { width: 60,  height: 32 });
        this.load.svg('d_grandma',  base + 'grandma.svg',  { width: 135, height: 150 });
        this.load.svg('d_bat',      base + 'bat.svg',      { width: 150, height: 120 });
        this.load.svg('d_skeleton', base + 'skeleton.svg', { width: 150, height: 180 });
        this.load.svg('d_ghost',    base + 'ghost.svg',    { width: 150, height: 180 });
        this.load.svg('d_mimic',    base + 'mimic.svg',    { width: 150, height: 150 });

        const dpr = window.__GAME_DPR || 1;
        this.load.svg('stairs',       'assets/world/stairs.svg',       { width: Math.round(72 * dpr), height: Math.round(80 * dpr) });
        this.load.svg('chest_closed', 'assets/world/chest_closed.svg', { width: Math.round(48 * dpr), height: Math.round(44 * dpr) });
        this.load.svg('chest_open',   'assets/world/chest_open.svg',   { width: Math.round(48 * dpr), height: Math.round(44 * dpr) });
    }

    create() {
        this.dpr = window.__GAME_DPR || 1;

        this.skinSpeedMul = 1;
        this.skinDashCdMul = 1;
        this.skinStealthMul = 1;
        try {
            const sk = Progress.getCurrentSkin?.();
            if (sk?.perk?.apply) {
                const dummy = { maxHp: this.maxHearts, speedMul: 1, dashCdMul: 1, stealthMul: 1 };
                sk.perk.apply(dummy);
                this.skinSpeedMul = dummy.speedMul || 1;
                this.skinDashCdMul = dummy.dashCdMul || 1;
                this.skinStealthMul = dummy.stealthMul || 1;
            }
        } catch (_) {}

        if (this.runPerks.cake_factory) {
            this.piesLeft = Math.min(9, this.piesLeft + 2);
        }

        // 1. Generate Two-Layer Cutaway Level («Над полом + Подземная Норка в разрезе»)
        this.room = generateHeistFloor(this.floor);
        this.theme = this.room.theme;
        this.mission = this.room.mission;

        const mapPxW = this.room.W * this.room.cell;
        const mapPxH = this.room.H * this.room.cell;

        this.cameras.main.setBackgroundColor('#0c0717');

        // 2. Render Two-Layer Cutaway Dollhouse / Ant-Farm World
        this._ensureCustomTextures();
        this._renderCutawayWorld(mapPxW, mapPxH);
        this._buildCozyHomeSanctuary();
        this._buildBurrowChutes();
        this._buildLaserGatesAndSabotageLevers();
        this._buildShadowCushions();
        this._buildLootAndHaulables();

        // 3. Player (Pi) + Overhead Carried Loot + Home Nest Stash
        this._buildPlayer();

        // 4. Daughter's Hand-Drawn Monsters + Vision Cones + Ceiling Footstep Ripples
        this._buildMonsters();

        // 5. Camera setup — framed so you see both the Castle Room above AND the Underground Burrow below!
        const cssW = this.scale.width / this.dpr;
        const cssH = this.scale.height / this.dpr;
        const fitCssZoom = Math.min(cssW / (mapPxW + 60), cssH / (mapPxH + 100));
        const worldCssZoom = Math.max(0.60, Math.min(0.92, fitCssZoom * 1.16));
        this.cameras.main.setZoom(worldCssZoom * this.dpr);
        this.cameras.main.setBounds(-90, -80, mapPxW + 180, mapPxH + 180);
        this.cameras.main.startFollow(this.player, false, 0.14, 0.14);

        // 6. State flags
        this.floorStartedAt = this.time.now;
        this.seenOnThisFloor = false;
        this.ended = false;
        this.isPaused = false;
        this.isChuteSliding = false;
        this.hasGoldenKey = false;
        this.carriedItem = null; // Currently carried Giant Cheese / Crown / Pet Friend
        this.deliveredCount = 0;
        this.totalQuota = this.room.totalHaulables;
        this.whistleCooldownUntil = 0;

        this.invulnerableUntil = this.time.now + 1200;
        this.dashUntil = 0;
        this.dashCooldownUntil = 0;
        this.activeBoosters = { cloak: 0, magnet: 0, turbo: 0 };

        // 7. Mount Crisp HTML/CSS HUD + Glossy 3D Controls
        this._mountDomControlsAndHud();
        this._setupKeyboardAndMapTap();
        this._showFloorIntroBanner();

        // 8. Audio
        if (this.theme?.bgm) {
            bus.emit(this.theme.bgm);
        }
        this._playMusicalChime([523.25, 659.25, 783.99, 1046.5], 0.08, 'triangle');

        this.events.on('shutdown', () => this._unmountDomControls());
        this.events.on('destroy', () => this._unmountDomControls());
    }

    // =========================================================================
    // 1. TWO-LAYER CUTAWAY WORLD («ЗАЛ СВЕРХУ + РАЗРЕЗ ПОЛА + НОРКА ВНИЗУ»)
    // =========================================================================

    _ensureCustomTextures() {
        if (!this.textures.exists('sneak_spark')) {
            const g = this.make.graphics({ x: 0, y: 0, add: false });
            g.fillStyle(0xffffff, 1);
            g.fillCircle(8, 8, 7);
            g.generateTexture('sneak_spark', 16, 16);
            g.destroy();
        }
    }

    _renderCutawayWorld(mapPxW, mapPxH) {
        const { W, H, cell, grid, rooms, theme, slabY1, slabY2, burrowY1 } = this.room;

        const bg = this.add.graphics().setDepth(-30);
        // Deep night backdrop above, warm subterranean earth below
        const slabMidY = (slabY1 + 0.5) * cell;
        bg.fillGradientStyle(0x120924, 0x120924, 0x261242, 0x261242, 1);
        bg.fillRect(-200, -160, mapPxW + 400, slabMidY + 160);

        bg.fillGradientStyle(theme.earthTop, theme.earthTop, theme.earthBot, theme.earthBot, 1);
        bg.fillRect(-200, slabMidY, mapPxW + 400, mapPxH - slabMidY + 220);

        const worldGfx = this.add.graphics().setDepth(-15);

        // --- A. RENDER UPPER CASTLE ROOMS (Cutaway Dollhouse Rooms) ---
        rooms.forEach((r, idx) => {
            const rx = r.x1 * cell;
            const ry = r.y1 * cell;
            const rw = (r.x2 - r.x1 + 1) * cell;
            const rh = (r.y2 - r.y1 + 1) * cell;

            // Back Wall Band at the top of each room (Gothic windows + wainscoting)
            const wallH = cell * 1.45;
            worldGfx.fillGradientStyle(theme.wallTop, theme.wallTop, theme.wallBot, theme.wallBot, 1);
            worldGfx.fillRoundedRect(rx, ry - wallH * 0.65, rw, wallH, { tl: 14, tr: 14, bl: 0, br: 0 });
            worldGfx.lineStyle(3, 0xfef08a, 0.35);
            worldGfx.strokeRoundedRect(rx, ry - wallH * 0.65, rw, wallH, { tl: 14, tr: 14, bl: 0, br: 0 });

            // Arched Moonlit Windows along the back wall
            const winCount = Math.max(1, Math.floor(rw / (cell * 3.5)));
            for (let w = 0; w < winCount; w++) {
                const wx = rx + (w + 0.5) * (rw / winCount);
                const wy = ry - wallH * 0.18;
                worldGfx.fillStyle(0x38bdf8, 0.22);
                worldGfx.fillRoundedRect(wx - 22, wy - 20, 44, 34, { tl: 20, tr: 20, bl: 4, br: 4 });
                worldGfx.lineStyle(2, 0xbae6fd, 0.5);
                worldGfx.strokeRoundedRect(wx - 22, wy - 20, 44, 34, { tl: 20, tr: 20, bl: 4, br: 4 });
            }

            // Room Floor Tiles
            worldGfx.fillStyle(theme.floorMain, 1);
            worldGfx.fillRect(rx, ry + cell * 0.5, rw, rh - cell * 0.5);

            for (let gy = r.y1 + 1; gy <= r.y2; gy++) {
                for (let gx = r.x1; gx <= r.x2; gx++) {
                    if ((gx + gy) % 2 === 0) {
                        worldGfx.fillStyle(theme.floorChecker, 0.55);
                        worldGfx.fillRect(gx * cell + 2, gy * cell + 2, cell - 4, cell - 4);
                    }
                }
            }

            // Royal Plush Carpet Runner inside each room
            if (rw >= cell * 4) {
                const padX = cell * 0.9;
                const padY = cell * 1.4;
                worldGfx.fillStyle(theme.carpetColor, 0.72);
                worldGfx.fillRoundedRect(rx + padX, ry + padY, rw - padX * 2, rh - padY * 1.6, 10);
                worldGfx.lineStyle(2, theme.carpetTrim, 0.75);
                worldGfx.strokeRoundedRect(rx + padX + 4, ry + padY + 4, rw - padX * 2 - 8, rh - padY * 1.6 - 8, 8);
            }

            // Room Title Tag on the back wall
            const roomLabels = ['🍽️ ЗАЛ №1', '👑 ЗАЛ №2', '🗝️ ЗАЛ №3'];
            this.add.text(rx + rw / 2, ry - 14, roomLabels[idx % roomLabels.length], {
                fontFamily: 'Nunito, sans-serif',
                fontSize: '12px',
                fontStyle: '900',
                color: '#fef08a',
                stroke: '#0f172a',
                strokeThickness: 3
            }).setOrigin(0.5).setDepth(-10).setResolution(this.dpr);
        });

        // Render Doorways between adjacent rooms
        for (let gy = this.room.upperY1; gy <= this.room.upperY2; gy++) {
            for (let gx = 1; gx < W - 1; gx++) {
                if (grid[gy][gx] === '.') {
                    worldGfx.fillStyle(theme.floorMain, 1);
                    worldGfx.fillRect(gx * cell, gy * cell, cell, cell);
                }
            }
        }

        // Render Decorative Pillars / Tables inside rooms
        this.room.pillars.forEach((p) => {
            const px = p.gx * cell;
            const py = p.gy * cell;
            worldGfx.fillStyle(0x1e1b4b, 1);
            worldGfx.fillRoundedRect(px + 4, py + 4, cell - 8, cell - 8, 8);
            worldGfx.lineStyle(3, 0xfbbf24, 0.8);
            worldGfx.strokeRoundedRect(px + 4, py + 4, cell - 8, cell - 8, 8);
        });

        // --- B. RENDER THE CROSS-SECTION FLOOR SLAB («ТОЛЩА ПОЛА В РАЗРЕЗЕ») ---
        const slabTopPx = slabY1 * cell;
        const slabH = (slabY2 - slabY1 + 1) * cell;

        // Wooden baseboard & floorboards at the top of the slab
        worldGfx.fillStyle(theme.beamColor, 1);
        worldGfx.fillRect(cell, slabTopPx, (W - 2) * cell, 18);
        worldGfx.lineStyle(2.5, 0xfde68a, 0.55);
        worldGfx.strokeRect(cell, slabTopPx, (W - 2) * cell, 18);

        // Cross-section masonry bricks & earth layers between floor and underground burrow
        worldGfx.fillStyle(0x3b1f0e, 1);
        worldGfx.fillRect(cell, slabTopPx + 18, (W - 2) * cell, slabH - 18);

        for (let bx = cell + 12; bx < (W - 2) * cell; bx += 48) {
            worldGfx.fillStyle(0x572f18, 0.85);
            worldGfx.fillRoundedRect(bx, slabTopPx + 24, 40, 18, 4);
            worldGfx.fillRoundedRect(bx + 18, slabTopPx + 48, 40, 18, 4);
        }

        // --- C. RENDER THE UNDERGROUND BURROW NETWORK («ПОДЗЕМНАЯ НОРКА В РАЗРЕЗЕ») ---
        for (let gy = burrowY1; gy < H; gy++) {
            for (let gx = 1; gx < W - 1; gx++) {
                if (grid[gy][gx] === 'U') {
                    const tx = gx * cell;
                    const ty = gy * cell;
                    worldGfx.fillStyle(theme.tunnelFloor, 1);
                    worldGfx.fillRoundedRect(tx - 2, ty - 2, cell + 4, cell + 4, 8);

                    if ((gx + gy) % 2 === 0) {
                        worldGfx.fillStyle(0x9a4e1c, 0.28);
                        worldGfx.fillCircle(tx + cell * 0.5, ty + cell * 0.5, cell * 0.28);
                    }
                }
            }
        }

        // Warm subterranean root archways & fairy lights along the burrow ceiling
        const burrowCeilingY = burrowY1 * cell;
        worldGfx.lineStyle(4, 0x451a03, 0.95);
        worldGfx.beginPath();
        worldGfx.moveTo(2 * cell, burrowCeilingY);
        worldGfx.lineTo((W - 2) * cell, burrowCeilingY);
        worldGfx.strokePath();

        for (let gx = 3; gx <= W - 4; gx += 3) {
            const lx = (gx + 0.5) * cell;
            const ly = burrowCeilingY + 8;
            // Glowing subterranean lantern bulb
            worldGfx.fillStyle(0xfef08a, 0.22);
            worldGfx.fillCircle(lx, ly + 8, 22);
            worldGfx.fillStyle(0xfacc15, 0.95);
            worldGfx.fillCircle(lx, ly + 4, 5);
        }

        // Layer Indicator Banner along the Floor Slab
        this.add.text(mapPxW / 2, slabTopPx + slabH / 2, '⬇️ ПОДЗЕМНАЯ СЕТЬ НОРОК (МОНСТРЫ СЮДА НЕ ПРОЛЕЗУТ!) ⬇️', {
            fontFamily: 'Nunito, sans-serif',
            fontSize: '12px',
            fontStyle: '900',
            color: '#fde68a',
            backgroundColor: 'rgba(30, 15, 6, 0.85)',
            padding: { x: 10, y: 3 }
        }).setOrigin(0.5).setDepth(-5).setResolution(this.dpr);
    }

    // =========================================================================
    // 2. COZY HOME SANCTUARY («УЮТНЫЙ ДОМИК-НОРКА ПИ ВНИЗУ СЛЕВА»)
    // =========================================================================

    _buildCozyHomeSanctuary() {
        const nest = this.room.homeNest;
        this.homeNestVisual = this.add.container(nest.x, nest.y).setDepth(12);

        const bg = this.add.graphics();
        // Warm arched subterranean living room
        bg.fillStyle(0x9a3412, 0.45);
        bg.fillRoundedRect(-96, -54, 192, 104, 22);
        bg.lineStyle(3.5, 0xfbbf24, 0.9);
        bg.strokeRoundedRect(-96, -54, 192, 104, 22);

        // Cozy braided rug on the burrow floor
        bg.fillStyle(0xe11d48, 0.75);
        bg.fillEllipse(0, 22, 145, 36);
        bg.lineStyle(2, 0xfde047, 0.85);
        bg.strokeEllipse(0, 22, 130, 28);

        // Cute mini-sofa & warm floor lamp inside Pi's home burrow
        bg.fillStyle(0x10b981, 1);
        bg.fillRoundedRect(-76, -12, 48, 26, 8);
        bg.fillStyle(0x34d399, 1);
        bg.fillRoundedRect(-72, -22, 40, 14, 6);

        const title = this.add.text(0, -40, '🏠 УЮТНАЯ НОРКА ПИ (СКЛАД ДОБЫЧИ)', {
            fontFamily: 'Nunito, sans-serif',
            fontSize: '11px',
            fontStyle: '900',
            color: '#fef08a',
            stroke: '#451a03',
            strokeThickness: 3.5
        }).setOrigin(0.5).setResolution(this.dpr);

        this.homeQuotaLabel = this.add.text(0, 34, '', {
            fontFamily: 'Nunito, sans-serif',
            fontSize: '12px',
            fontStyle: '900',
            color: '#86efac',
            stroke: '#052e16',
            strokeThickness: 3.5
        }).setOrigin(0.5).setResolution(this.dpr);

        // Container where delivered Giant Cheeses, Crowns, and Rescued Friends visibly pile up!
        this.homeStashContainer = this.add.container(28, 4);

        this.homeNestVisual.add([bg, title, this.homeStashContainer, this.homeQuotaLabel]);
        this._refreshHomeQuotaLabel();
    }

    _refreshHomeQuotaLabel() {
        if (!this.homeQuotaLabel) return;
        const left = Math.max(0, (this.room.totalHaulables || 1) - (this.deliveredCount || 0));
        if (left > 0) {
            this.homeQuotaLabel.setText(`Утащи в норку ещё: ${left} шт.`);
            this.homeQuotaLabel.setColor('#fde047');
        } else {
            this.homeQuotaLabel.setText('🎉 ВСЁ В НОРКЕ! ЗАБЕГАЙ СЮДА НА СЛЕД. ЭТАЖ!');
            this.homeQuotaLabel.setColor('#4ade80');
        }
    }

    // =========================================================================
    // 3. VERTICAL BURROW CHUTES («АРОЧНЫЕ НОРКИ В ПЛИНТУСЕ И ЛАЗЫ ВНИЗ»)
    // =========================================================================

    _buildBurrowChutes() {
        this.chuteSprites = [];

        this.room.chutes.forEach((ch) => {
            const g = this.add.graphics().setDepth(-4);

            // Vertical tunnel pipe cutting through the floor slab
            const pipeW = 38;
            const pipeH = ch.botY - ch.topY;
            g.fillStyle(0x1c0d06, 0.92);
            g.fillRoundedRect(ch.topX - pipeW / 2, ch.topY, pipeW, pipeH, 12);
            g.lineStyle(3, ch.colorHex, 0.85);
            g.strokeRoundedRect(ch.topX - pipeW / 2, ch.topY, pipeW, pipeH, 12);

            // Cute wooden ladder rungs inside the vertical burrow chute
            g.lineStyle(2.5, 0xd97706, 0.75);
            for (let ry = ch.topY + 18; ry < ch.botY - 12; ry += 18) {
                g.beginPath();
                g.moveTo(ch.topX - 12, ry);
                g.lineTo(ch.topX + 12, ry);
                g.strokePath();
            }

            // UPPER ENTRANCE: Classic "Tom & Jerry" Arched Baseboard Mouse-Hole!
            const topArch = this.add.container(ch.topX, ch.topY).setDepth(9);
            const archGfx = this.add.graphics();
            archGfx.fillStyle(ch.colorHex, 0.22);
            archGfx.fillCircle(0, 0, 28);
            archGfx.fillStyle(0x140904, 1);
            archGfx.fillRoundedRect(-18, -22, 36, 34, { tl: 18, tr: 18, bl: 4, br: 4 });
            archGfx.lineStyle(3.5, ch.colorHex, 1);
            archGfx.strokeRoundedRect(-18, -22, 36, 34, { tl: 18, tr: 18, bl: 4, br: 4 });

            const topBadge = this.add.text(0, -28, `🕳️ НОРКА #${ch.label}`, {
                fontFamily: 'Nunito, sans-serif',
                fontSize: '10.5px',
                fontStyle: '900',
                color: '#ffffff',
                backgroundColor: ch.colorCss,
                padding: { x: 5, y: 1 }
            }).setOrigin(0.5).setResolution(this.dpr);
            topArch.add([archGfx, topBadge]);

            // LOWER EXIT: Subterranean Chute Landing inside the burrow
            const botLanding = this.add.container(ch.botX, ch.botY).setDepth(9);
            const botGfx = this.add.graphics();
            botGfx.fillStyle(ch.colorHex, 0.25);
            botGfx.fillEllipse(0, 6, 44, 22);
            botGfx.lineStyle(2.5, ch.colorHex, 0.9);
            botGfx.strokeEllipse(0, 6, 44, 22);

            const botBadge = this.add.text(0, 18, `🔼 ЛАЗ #${ch.label}`, {
                fontFamily: 'Nunito, sans-serif',
                fontSize: '10px',
                fontStyle: '900',
                color: '#fef08a',
                stroke: '#1e1b4b',
                strokeThickness: 3
            }).setOrigin(0.5).setResolution(this.dpr);
            botLanding.add([botGfx, botBadge]);

            this.chuteSprites.push({ chute: ch, topArch, botLanding });
        });
    }

    // =========================================================================
    // 4. LASER GATES & UNDERGROUND SABOTAGE LEVERS («ПОДЗЕМНЫЙ САБОТАЖ ⚡»)
    // =========================================================================

    _buildLaserGatesAndSabotageLevers() {
        this.laserGateObjs = [];
        (this.room.laserGates || []).forEach((lg) => {
            const g = this.add.graphics().setDepth(14);
            const label = this.add.text(lg.x, lg.y1 - 10, '⚡ ЛУЧ', {
                fontFamily: 'Nunito, sans-serif',
                fontSize: '10px',
                fontStyle: '900',
                color: '#fda4af',
                stroke: '#0f172a',
                strokeThickness: 3
            }).setOrigin(0.5).setDepth(15).setResolution(this.dpr);

            const obj = { data: lg, gfx: g, label };
            this._redrawLaserGate(obj);
            this.laserGateObjs.push(obj);
        });

        this.leverObjs = [];
        (this.room.sabotageLevers || []).forEach((lv) => {
            const c = this.add.container(lv.x, lv.y).setDepth(14);
            const base = this.add.graphics();
            base.fillStyle(0x334155, 1);
            base.fillRoundedRect(-18, 2, 36, 12, 5);
            base.lineStyle(2.5, 0x38bdf8, 1);
            base.strokeRoundedRect(-18, 2, 36, 12, 5);

            const handle = this.add.text(0, -10, '🕹️', {
                fontSize: '24px'
            }).setOrigin(0.5).setResolution(this.dpr);

            const tag = this.add.text(0, -28, '⚡ РЫЧАГ ТОРТА!', {
                fontFamily: 'Nunito, sans-serif',
                fontSize: '10px',
                fontStyle: '900',
                color: '#38bdf8',
                stroke: '#0f172a',
                strokeThickness: 3
            }).setOrigin(0.5).setResolution(this.dpr);

            c.add([base, handle, tag]);

            // Also draw the hanging Ceiling Cake Trap in the upper room above this lever!
            const trapIcon = this.add.text(lv.trapTargetX, this.room.upperY1 * this.room.cell + 6, '🎂⛓️', {
                fontSize: '22px'
            }).setOrigin(0.5).setDepth(18).setResolution(this.dpr);

            this.leverObjs.push({ data: lv, container: c, handle, tag, trapIcon });
        });
    }

    _redrawLaserGate(obj) {
        const { data, gfx, label } = obj;
        gfx.clear();
        if (!data.active) {
            label.setText('🔓 ОТКРЫТО');
            label.setColor('#86efac');
            return;
        }
        gfx.lineStyle(6, data.color, 0.35);
        gfx.lineBetween(data.x, data.y1, data.x, data.y2);
        gfx.lineStyle(2.5, 0xffffff, 0.95);
        gfx.lineBetween(data.x, data.y1, data.x, data.y2);
    }

    _triggerSabotageLever(leverObj) {
        if (leverObj.data.used) return;
        leverObj.data.used = true;
        leverObj.tag.setText('✅ СРАБОТАЛО!');
        leverObj.tag.setColor('#4ade80');
        leverObj.handle.setAngle(35);

        bus.emit(SFX.CHEST_OPEN);
        this._playMusicalChime([440, 554.37, 659.25, 880], 0.06, 'square');

        // 1. Disable all laser gates!
        this.laserGateObjs.forEach((lg) => {
            lg.data.active = false;
            this._redrawLaserGate(lg);
        });

        // 2. Drop the giant Ceiling Cream Cake in the upper room!
        const tx = leverObj.data.trapTargetX;
        const ty = leverObj.data.trapTargetY;
        if (leverObj.trapIcon) {
            this.tweens.add({
                targets: leverObj.trapIcon,
                y: ty,
                scale: 1.5,
                duration: 340,
                ease: 'Cubic.easeIn',
                onComplete: () => {
                    leverObj.trapIcon.setText('💥🎂');
                    this._splatCakeAt(tx, ty, true);
                    this.time.delayedCall(900, () => leverObj.trapIcon?.destroy());
                }
            });
        }
        this._showToast('⚡ Подземный рычаг отключил лучи и уронил торт сверху!', '#38bdf8');
    }

    // =========================================================================
    // 5. SHADOW CUSHIONS, CARRYABLE PRIZES, GOLDEN KEY & CAPTIVE PETS
    // =========================================================================

    _buildShadowCushions() {
        this.shadowRects = [];
        (this.room.shadowZones || []).forEach((sz) => {
            const g = this.add.graphics().setDepth(2);
            g.fillStyle(0x311042, 0.72);
            g.fillCircle(sz.x, sz.y, sz.r);
            g.lineStyle(2.5, 0xc084fc, 0.7);
            g.strokeCircle(sz.x, sz.y, sz.r);

            this.add.text(sz.x, sz.y, '🌙 ТЕНЬ', {
                fontFamily: 'Nunito, sans-serif',
                fontSize: '10px',
                fontStyle: '900',
                color: '#e9d5ff'
            }).setOrigin(0.5).setDepth(3).setResolution(this.dpr);

            this.shadowRects.push(sz);
        });
    }

    _buildLootAndHaulables() {
        // Small instant cheese crumbs
        this.cheeseSprites = this.room.cheeses.map((ch) => {
            const img = this.add.image(ch.x, ch.y, 'd_cheese')
                .setDisplaySize(26, 22)
                .setDepth(10);
            this.tweens.add({
                targets: img,
                y: ch.y - 4,
                duration: 850 + Math.random() * 250,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });
            return { ...ch, sprite: img, collected: false };
        });

        // Golden Key (if present on this floor)
        this.goldenKeyObj = null;
        if (this.room.goldenKey) {
            const gk = this.room.goldenKey;
            const c = this.add.container(gk.x, gk.y).setDepth(16);
            const glow = this.add.graphics();
            glow.fillStyle(0xfacc15, 0.32);
            glow.fillCircle(0, 0, 24);
            const img = this.add.image(0, 0, 'd_key').setDisplaySize(44, 24);
            const lbl = this.add.text(0, -24, '🗝️ КЛЮЧ СТРАЖА', {
                fontFamily: 'Nunito, sans-serif',
                fontSize: '10.5px',
                fontStyle: '900',
                color: '#fef08a',
                stroke: '#0f172a',
                strokeThickness: 3.5
            }).setOrigin(0.5).setResolution(this.dpr);
            c.add([glow, img, lbl]);
            this.tweens.add({
                targets: c,
                y: gk.y - 6,
                duration: 750,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });
            this.goldenKeyObj = { ...gk, container: c };
        }

        // Giant Carryable Prizes («Утащи в норку!»)
        this.carryableObjs = (this.room.carryables || []).map((pr) => {
            const c = this.add.container(pr.x, pr.y).setDepth(15);
            const pedestal = this.add.graphics();
            pedestal.fillStyle(0xfacc15, 0.22);
            pedestal.fillCircle(0, 4, 26);
            pedestal.lineStyle(2.5, 0xfde047, 0.85);
            pedestal.strokeCircle(0, 4, 26);

            const icon = this.add.text(0, -2, pr.icon, {
                fontSize: '30px'
            }).setOrigin(0.5).setResolution(this.dpr);

            const tag = this.add.text(0, -28, `${pr.name} (+${pr.value}🧀)`, {
                fontFamily: 'Nunito, sans-serif',
                fontSize: '10.5px',
                fontStyle: '900',
                color: '#fef08a',
                stroke: '#0f172a',
                strokeThickness: 3.5
            }).setOrigin(0.5).setResolution(this.dpr);

            const sub = this.add.text(0, 24, '🏃‍♀️ УТАЩИ В НОРКУ!', {
                fontFamily: 'Nunito, sans-serif',
                fontSize: '9.5px',
                fontStyle: '900',
                color: '#fde68a',
                backgroundColor: 'rgba(15, 23, 42, 0.82)',
                padding: { x: 4, y: 1 }
            }).setOrigin(0.5).setResolution(this.dpr);

            c.add([pedestal, icon, tag, sub]);
            this.tweens.add({
                targets: icon,
                y: -7,
                duration: 850,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });

            return { ...pr, container: c, pickedUp: false };
        });

        // Captive Pet Friends («Спаси и уведи в норку!»)
        this.petNodes = (this.room.captivePets || []).map((pet) => {
            const c = this.add.container(pet.x, pet.y).setDepth(16);
            const bubble = this.add.graphics();
            bubble.fillStyle(pet.color, 0.24);
            bubble.fillCircle(0, 0, 27);
            bubble.lineStyle(3, pet.locked ? 0xfacc15 : 0xffffff, 0.9);
            bubble.strokeCircle(0, 0, 27);

            const texKey = this.textures.exists(pet.spriteKey) ? pet.spriteKey : 'd_pi';
            const spr = this.add.image(0, 2, texKey).setScale(0.24);

            const tag = this.add.text(0, -33, `${pet.badge} ${pet.name}`, {
                fontFamily: 'Nunito, sans-serif',
                fontSize: '11px',
                fontStyle: '900',
                color: '#ffffff',
                stroke: '#0f172a',
                strokeThickness: 3.5
            }).setOrigin(0.5).setResolution(this.dpr);

            const lockBadge = this.add.text(0, 25, pet.locked ? '🔒 НУЖЕН КЛЮЧ 🗝️' : '🆘 СПАСИ В НОРКУ!', {
                fontFamily: 'Nunito, sans-serif',
                fontSize: '9.5px',
                fontStyle: '900',
                color: pet.locked ? '#fde047' : '#a7f3d0',
                backgroundColor: 'rgba(15,23,42,0.85)',
                padding: { x: 4, y: 1 }
            }).setOrigin(0.5).setResolution(this.dpr);

            c.add([bubble, spr, tag, lockBadge]);
            this.tweens.add({
                targets: spr,
                y: -3,
                duration: 680,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });

            return { ...pet, container: c, bubble, lockBadge, pickedUp: false };
        });

        // Boosters
        this.boosterSprites = (this.room.boosters || []).map((b) => {
            const c = this.add.container(b.x, b.y).setDepth(14);
            const g = this.add.graphics();
            g.fillStyle(b.color, 0.28);
            g.fillCircle(0, 0, 18);
            g.lineStyle(2, 0xffffff, 0.85);
            g.strokeCircle(0, 0, 18);
            const t = this.add.text(0, 0, b.icon, { fontSize: '19px' }).setOrigin(0.5).setResolution(this.dpr);
            c.add([g, t]);
            return { ...b, container: c, collected: false };
        });

        this.thrownCakes = [];
    }

    // =========================================================================
    // 6. PLAYER (PI) + OVERHEAD CARRIED ITEM + NEAREST BURROW GUIDE ARROW
    // =========================================================================

    _buildPlayer() {
        const skinObj = Progress.getCurrentSkin?.() || { id: 'blue', spriteKey: 'd_pi' };
        let baseKey = skinObj.spriteKey || 'd_pi';
        if (!this.textures.exists(baseKey)) baseKey = 'd_pi';

        this.playerSkinBase = baseKey;
        this.playerWalk1 = this.textures.exists(baseKey + '_w1') ? baseKey + '_w1' : 'd_pi_walk1';
        this.playerWalk2 = this.textures.exists(baseKey + '_w2') ? baseKey + '_w2' : 'd_pi_walk2';

        const sx = this.room.spawn.x;
        const sy = this.room.spawn.y;

        this.playerHalo = this.add.graphics().setDepth(21);
        this._redrawPlayerHalo(0x38bdf8);

        this.player = this.add.image(sx, sy, this.playerSkinBase)
            .setScale(0.29)
            .setDepth(22);

        // Visual indicator for the Giant Treasure or Pet Friend currently being hauled to the burrow!
        this.carriedVisual = this.add.container(sx, sy - 34).setDepth(25).setVisible(false);
        this.carriedIconText = this.add.text(0, 0, '🧀', { fontSize: '26px' }).setOrigin(0.5).setResolution(this.dpr);
        this.carriedLabelText = this.add.text(0, -20, 'БЕГИ В НОРКУ! 🕳️', {
            fontFamily: 'Nunito, sans-serif',
            fontSize: '10.5px',
            fontStyle: '900',
            color: '#fef08a',
            backgroundColor: '#be185d',
            padding: { x: 6, y: 2 }
        }).setOrigin(0.5).setResolution(this.dpr);
        this.carriedVisual.add([this.carriedIconText, this.carriedLabelText]);

        // Dynamic guide arrow pointing to the nearest Mouse-Hole when Pi is carrying loot!
        this.burrowGuideArrow = this.add.graphics().setDepth(24).setVisible(false);

        this.playerFacing = { x: 1, y: 0 };
        this.walkAnimTimer = 0;
    }

    _redrawPlayerHalo(colorHex) {
        this.playerHalo.clear();
        this.playerHalo.fillStyle(colorHex, 0.25);
        this.playerHalo.fillEllipse(0, 0, 44, 22);
        this.playerHalo.lineStyle(2, colorHex, 0.8);
        this.playerHalo.strokeEllipse(0, 0, 44, 22);
    }

    // =========================================================================
    // 7. DAUGHTER'S HAND-DRAWN MONSTERS + CEILING FOOTSTEP RIPPLES («ТОП-ТОП»)
    // =========================================================================

    _buildMonsters() {
        this.monsters = this.room.monsters.map((m) => {
            const coneGfx = this.add.graphics().setDepth(13);
            const sprKey = this.textures.exists(m.spriteKey) ? m.spriteKey : 'd_zombie';
            const sprite = this.add.image(m.x, m.y, sprKey)
                .setScale(m.scale || 0.31)
                .setDepth(19);

            const statusBadge = this.add.text(m.x, m.y - 44, '', {
                fontFamily: 'Nunito, sans-serif',
                fontSize: '15px',
                fontStyle: '900',
                color: '#fef08a',
                stroke: '#000000',
                strokeThickness: 4
            }).setOrigin(0.5).setDepth(26).setResolution(this.dpr);

            return {
                cfg: m,
                x: m.x,
                y: m.y,
                vx: 0,
                vy: 0,
                facingRad: 0,
                wpIndex: 1 % m.waypoints.length,
                state: 'patrol', // 'patrol' | 'alert' | 'chase' | 'cake_blind' | 'wall_bonk'
                suspicion: 0,
                investigateTarget: null,
                investigateUntil: 0,
                blindUntil: 0,
                bonkUntil: 0,
                stepTimer: 0,
                sprite,
                coneGfx,
                statusBadge
            };
        });
    }

    // =========================================================================
    // 8. GLOSSY 3D TOUCH CONTROLS & HUD
    // =========================================================================

    _mountDomControlsAndHud() {
        this._unmountDomControls();

        const isHidden = () => {
            if (this._isPlayerInBurrow()) return true;
            if (this.time.now < this.activeBoosters.cloak) return true;
            return this._isInsideShadowCushion(this.player.x, this.player.y);
        };

        const ui = document.createElement('div');
        ui.id = 'sneak-touch-ui';
        ui.innerHTML = `
            <style>
                #sneak-touch-ui {
                    position: fixed;
                    inset: 0;
                    pointer-events: none;
                    z-index: 9999;
                    font-family: 'Nunito', sans-serif;
                    user-select: none;
                    -webkit-user-select: none;
                }
                .sneak-top-bar {
                    position: absolute;
                    top: max(8px, env(safe-area-inset-top, 8px));
                    left: max(12px, env(safe-area-inset-left, 12px));
                    right: max(12px, env(safe-area-inset-right, 12px));
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 8px;
                    pointer-events: none;
                }
                .sneak-pill {
                    pointer-events: auto;
                    background: rgba(15, 10, 32, 0.86);
                    border: 2px solid rgba(250, 204, 21, 0.55);
                    border-radius: 999px;
                    padding: 5px 13px;
                    color: #fff;
                    font-weight: 900;
                    font-size: clamp(12px, 2.7vw, 15px);
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    box-shadow: 0 5px 14px rgba(0,0,0,0.45);
                }
                .sneak-icon-btn {
                    pointer-events: auto;
                    width: 42px;
                    height: 42px;
                    border-radius: 50%;
                    border: 2px solid rgba(255,255,255,0.45);
                    background: linear-gradient(180deg, #475569, #1e293b);
                    color: #fff;
                    font-size: 18px;
                    font-weight: 900;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 4px 10px rgba(0,0,0,0.45);
                    cursor: pointer;
                }
                #sneak-joy-zone {
                    position: absolute;
                    left: max(18px, env(safe-area-inset-left, 18px));
                    bottom: max(16px, env(safe-area-inset-bottom, 16px));
                    width: 132px;
                    height: 132px;
                    border-radius: 50%;
                    background: radial-gradient(circle, rgba(168,85,247,0.24) 0%, rgba(15,23,42,0.72) 78%);
                    border: 2.5px solid rgba(216,180,254,0.55);
                    box-shadow: 0 6px 20px rgba(0,0,0,0.5);
                    pointer-events: auto;
                    touch-action: none;
                }
                #sneak-joy-knob {
                    position: absolute;
                    left: 50%;
                    top: 50%;
                    width: 54px;
                    height: 54px;
                    margin-left: -27px;
                    margin-top: -27px;
                    border-radius: 50%;
                    background: radial-gradient(circle at 32% 30%, #f5d0fe, #a855f7 62%, #6b21a8 100%);
                    border: 2.5px solid #fff;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                    pointer-events: none;
                }
                .sneak-right-cluster {
                    position: absolute;
                    right: max(16px, env(safe-area-inset-right, 16px));
                    bottom: max(14px, env(safe-area-inset-bottom, 14px));
                    display: flex;
                    align-items: flex-end;
                    gap: 10px;
                    pointer-events: none;
                }
                .sneak-gloss-btn {
                    pointer-events: auto;
                    touch-action: none;
                    position: relative;
                    border-radius: 50%;
                    border: 3px solid rgba(255,255,255,0.88);
                    color: #fff;
                    font-family: 'Nunito', sans-serif;
                    font-weight: 900;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 7px 18px rgba(0,0,0,0.55), inset 0 3px 6px rgba(255,255,255,0.45);
                    cursor: pointer;
                    transition: transform 0.08s ease;
                }
                .sneak-gloss-btn:active {
                    transform: scale(0.92);
                }
                #sneak-btn-whistle {
                    width: 66px;
                    height: 66px;
                    background: radial-gradient(circle at 30% 25%, #fde047, #eab308 65%, #a16207 100%);
                }
                #sneak-btn-cake {
                    width: 72px;
                    height: 72px;
                    background: radial-gradient(circle at 30% 25%, #f9a8d4, #ec4899 65%, #9d174d 100%);
                }
                #sneak-btn-dash {
                    width: 78px;
                    height: 78px;
                    background: radial-gradient(circle at 30% 25%, #7dd3fc, #0284c7 65%, #075985 100%);
                }
                #sneak-btn-burrow {
                    width: 90px;
                    height: 90px;
                    background: radial-gradient(circle at 30% 25%, #6ee7b7, #10b981 60%, #047857 100%);
                    border-color: #fef08a;
                    box-shadow: 0 0 22px rgba(16,185,129,0.75), inset 0 3px 6px rgba(255,255,255,0.5);
                }
                .sneak-badge-count {
                    position: absolute;
                    top: -4px;
                    right: -4px;
                    width: 24px;
                    height: 24px;
                    border-radius: 50%;
                    background: #0f172a;
                    border: 2px solid #facc15;
                    color: #fef08a;
                    font-size: 12px;
                    font-weight: 900;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                #sneak-toast-banner {
                    position: absolute;
                    top: 58px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: rgba(15, 23, 42, 0.92);
                    border: 2px solid #facc15;
                    border-radius: 999px;
                    padding: 6px 16px;
                    color: #fef08a;
                    font-weight: 900;
                    font-size: clamp(12px, 2.8vw, 15px);
                    box-shadow: 0 6px 18px rgba(0,0,0,0.5);
                    opacity: 0;
                    transition: opacity 0.22s ease;
                    pointer-events: none;
                    white-space: nowrap;
                }
                #sneak-modal-root {
                    position: fixed;
                    inset: 0;
                    background: rgba(8, 5, 20, 0.82);
                    backdrop-filter: blur(6px);
                    display: none;
                    align-items: center;
                    justify-content: center;
                    padding: 16px;
                    pointer-events: auto;
                    z-index: 10001;
                }
                #sneak-modal-root.visible {
                    display: flex;
                }
                .sneak-modal-card {
                    background: linear-gradient(180deg, #1e1b4b, #0f172a);
                    border: 3px solid #facc15;
                    border-radius: 24px;
                    padding: 18px 20px;
                    width: 100%;
                    max-width: 520px;
                    text-align: center;
                    color: #fff;
                    box-shadow: 0 16px 40px rgba(0,0,0,0.65);
                }
                .sneak-perk-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 10px;
                    margin: 14px 0;
                }
                .sneak-perk-card {
                    background: rgba(30, 41, 59, 0.92);
                    border: 2.5px solid #38bdf8;
                    border-radius: 16px;
                    padding: 10px 8px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 5px;
                    cursor: pointer;
                }
                .sneak-perk-card:active {
                    transform: scale(0.95);
                }
                .sneak-action-btn {
                    width: 100%;
                    padding: 11px 16px;
                    border-radius: 14px;
                    border: none;
                    color: #fff;
                    font-family: 'Nunito', sans-serif;
                    font-weight: 900;
                    font-size: 15px;
                    cursor: pointer;
                }
            </style>

            <div class="sneak-top-bar">
                <div style="display:flex;align-items:center;gap:6px;">
                    <button class="sneak-icon-btn" id="sneak-pause-btn" title="Пауза">⏸</button>
                    <div class="sneak-pill">
                        <span id="sneak-hud-floor">${this.theme.icon} Этаж ${this.floor}</span>
                        <span id="sneak-hud-hearts">❤️❤️❤️</span>
                    </div>
                </div>

                <div class="sneak-pill" id="sneak-hud-layer-badge" style="border-color:#34d399;color:#a7f3d0;">
                    🏠 В НОРКЕ (БЕЗОПАСНО)
                </div>

                <div class="sneak-pill">
                    <span id="sneak-hud-quota">🏠 Добыча: 0/${this.totalQuota}</span>
                    <span id="sneak-hud-cheese" style="color:#facc15;">🧀 ${this.carriedCheese}</span>
                </div>
            </div>

            <div id="sneak-toast-banner"></div>

            <div id="sneak-joy-zone">
                <div id="sneak-joy-knob"></div>
            </div>

            <div class="sneak-right-cluster">
                <button class="sneak-gloss-btn" id="sneak-btn-whistle" title="Свистнуть и приманить монстра">
                    <span style="font-size:22px;line-height:1;">📣</span>
                    <span style="font-size:10px;">СВИСТ!</span>
                </button>
                <button class="sneak-gloss-btn" id="sneak-btn-cake" title="Бросить кремовый тортик">
                    <span style="font-size:24px;line-height:1;">🎂</span>
                    <span style="font-size:10px;">ТОРТИК</span>
                    <div class="sneak-badge-count" id="sneak-cake-count">${this.piesLeft}</div>
                </button>
                <button class="sneak-gloss-btn" id="sneak-btn-dash" title="Тихий кувырок">
                    <span style="font-size:24px;line-height:1;">💨</span>
                    <span style="font-size:10px;">КУВЫРОК</span>
                </button>
                <button class="sneak-gloss-btn" id="sneak-btn-burrow" style="display:none;">
                    <span style="font-size:28px;line-height:1;" id="sneak-burrow-icon">🕳️</span>
                    <span style="font-size:11px;" id="sneak-burrow-label">В НОРКУ!</span>
                </button>
            </div>

            <div id="sneak-modal-root"></div>
        `;

        document.body.appendChild(ui);
        this.touchUiEl = ui;
        this.joyVec = { x: 0, y: 0 };

        // Bind Virtual Joystick
        const joyZone = document.getElementById('sneak-joy-zone');
        const joyKnob = document.getElementById('sneak-joy-knob');
        let joyPointerId = null;
        const maxR = 42;

        const updateJoy = (clientX, clientY) => {
            const rect = joyZone.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            let dx = clientX - cx;
            let dy = clientY - cy;
            const dist = Math.hypot(dx, dy);
            if (dist > maxR) {
                dx = (dx / dist) * maxR;
                dy = (dy / dist) * maxR;
            }
            joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
            this.joyVec.x = dx / maxR;
            this.joyVec.y = dy / maxR;
        };

        const resetJoy = () => {
            joyPointerId = null;
            joyKnob.style.transform = 'translate(0px, 0px)';
            this.joyVec.x = 0;
            this.joyVec.y = 0;
        };

        joyZone.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            joyPointerId = e.pointerId;
            joyZone.setPointerCapture?.(e.pointerId);
            updateJoy(e.clientX, e.clientY);
        });
        joyZone.addEventListener('pointermove', (e) => {
            if (e.pointerId !== joyPointerId) return;
            updateJoy(e.clientX, e.clientY);
        });
        joyZone.addEventListener('pointerup', (e) => {
            if (e.pointerId === joyPointerId) resetJoy();
        });
        joyZone.addEventListener('pointercancel', resetJoy);

        // Bind Action Buttons
        document.getElementById('sneak-pause-btn')?.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            this.togglePauseModal();
        });
        document.getElementById('sneak-btn-whistle')?.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            this._triggerWhistleDecoy();
        });
        document.getElementById('sneak-btn-cake')?.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            this._throwCreamCake();
        });
        document.getElementById('sneak-btn-dash')?.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            this._triggerSilentRoll();
        });
        document.getElementById('sneak-btn-burrow')?.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            this._useNearestBurrowChute();
        });

        this._refreshHud();
    }

    _unmountDomControls() {
        const existing = document.getElementById('sneak-touch-ui');
        if (existing) existing.remove();
        this.touchUiEl = null;
    }

    _refreshHud() {
        const heartsEl = document.getElementById('sneak-hud-hearts');
        if (heartsEl) {
            heartsEl.textContent = '❤️'.repeat(Math.max(0, this.hearts)) + '🖤'.repeat(Math.max(0, this.maxHearts - this.hearts));
        }
        const quotaEl = document.getElementById('sneak-hud-quota');
        if (quotaEl) {
            const keyStr = this.hasGoldenKey ? ' 🗝️' : '';
            quotaEl.textContent = `🏠 В норке: ${this.deliveredCount}/${this.totalQuota}${keyStr}`;
        }
        const cheeseEl = document.getElementById('sneak-hud-cheese');
        if (cheeseEl) {
            cheeseEl.textContent = `🧀 ${this.carriedCheese}`;
        }
        const cakeCountEl = document.getElementById('sneak-cake-count');
        if (cakeCountEl) {
            cakeCountEl.textContent = `${this.piesLeft}`;
        }
        const layerBadge = document.getElementById('sneak-hud-layer-badge');
        if (layerBadge && this.player) {
            if (this._isPlayerInBurrow()) {
                layerBadge.textContent = '🏠 ПОД ЗЕМЛЁЙ В НОРКЕ (НЕВИДИМА!)';
                layerBadge.style.borderColor = '#34d399';
                layerBadge.style.color = '#a7f3d0';
            } else if (this.carriedItem) {
                layerBadge.textContent = `🏃‍♀️ НЕСЁТ: ${this.carriedItem.icon} — НЫРЯЙ В НОРКУ!`;
                layerBadge.style.borderColor = '#facc15';
                layerBadge.style.color = '#fef08a';
            } else if (this._isInsideShadowCushion(this.player.x, this.player.y)) {
                layerBadge.textContent = '🌙 В ТЕНИ (НЕВИДИМА)';
                layerBadge.style.borderColor = '#c084fc';
                layerBadge.style.color = '#e9d5ff';
            } else {
                layerBadge.textContent = '👀 НАВЕРХУ В ЗАЛЕ (ОСТОРОЖНО!)';
                layerBadge.style.borderColor = '#fb7185';
                layerBadge.style.color = '#fecdd3';
            }
        }
    }

    _showToast(msg, borderColor = '#facc15') {
        const el = document.getElementById('sneak-toast-banner');
        if (!el) return;
        el.textContent = msg;
        el.style.borderColor = borderColor;
        el.style.opacity = '1';
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            if (el) el.style.opacity = '0';
        }, 2900);
    }

    _showFloorIntroBanner() {
        this._showToast(`${this.mission.badge}: ${this.mission.title}`, '#38bdf8');
    }

    _setupKeyboardAndMapTap() {
        this.keys = this.input.keyboard?.addKeys({
            up: Phaser.Input.Keyboard.KeyCodes.W,
            down: Phaser.Input.Keyboard.KeyCodes.S,
            left: Phaser.Input.Keyboard.KeyCodes.A,
            right: Phaser.Input.Keyboard.KeyCodes.D,
            upArr: Phaser.Input.Keyboard.KeyCodes.UP,
            downArr: Phaser.Input.Keyboard.KeyCodes.DOWN,
            leftArr: Phaser.Input.Keyboard.KeyCodes.LEFT,
            rightArr: Phaser.Input.Keyboard.KeyCodes.RIGHT,
            space: Phaser.Input.Keyboard.KeyCodes.SPACE,
            e: Phaser.Input.Keyboard.KeyCodes.E,
            q: Phaser.Input.Keyboard.KeyCodes.Q
        });

        this.input.keyboard?.on('keydown-SPACE', () => this._useNearestBurrowChute());
        this.input.keyboard?.on('keydown-E', () => this._throwCreamCake());
        this.input.keyboard?.on('keydown-Q', () => this._triggerWhistleDecoy());
    }

    // =========================================================================
    // 9. BURROW CHUTE DIVE & "TOM AND JERRY" MONSTER WALL-BONK («БАМ! 💫»)
    // =========================================================================

    _isPlayerInBurrow() {
        if (!this.player) return true;
        return this.player.y >= (this.room.slabY1 + 0.5) * this.room.cell;
    }

    _findNearestChuteInteraction() {
        if (!this.player) return null;
        const px = this.player.x;
        const py = this.player.y;
        const inBurrow = this._isPlayerInBurrow();

        let best = null;
        let bestDist = 72;

        for (const ch of this.room.chutes) {
            if (inBurrow) {
                const d = Math.hypot(px - ch.botX, py - ch.botY);
                if (d < bestDist) {
                    bestDist = d;
                    best = { chute: ch, dir: 'up', targetX: ch.topX, targetY: ch.topY - 8 };
                }
            } else {
                const d = Math.hypot(px - ch.topX, py - ch.topY);
                if (d < bestDist) {
                    bestDist = d;
                    best = { chute: ch, dir: 'down', targetX: ch.botX, targetY: ch.botY + 8 };
                }
            }
        }
        return best;
    }

    _useNearestBurrowChute(forcedInfo = null) {
        if (this.ended || this.isPaused || this.isChuteSliding) return;
        const info = forcedInfo || this._findNearestChuteInteraction();
        if (!info) return;

        this.isChuteSliding = true;
        const { chute, dir, targetX, targetY } = info;

        bus.emit(SFX.DASH);
        this._playMusicalChime(
            dir === 'down' ? [783.99, 659.25, 523.25, 392.0] : [392.0, 523.25, 659.25, 783.99],
            0.045,
            'sine'
        );

        // If Pi dives DOWN into a mouse-hole from the upper room:
        // 1. Trigger the "Tom & Jerry" Monster Wall-Bonk on any monster chasing or close to Pi!
        if (dir === 'down') {
            this._checkTomAndJerryMonsterBonk(chute);
        }

        // Smooth animated zip through the vertical cutaway chute!
        this.tweens.add({
            targets: this.player,
            x: targetX,
            y: targetY,
            scaleX: 0.22,
            scaleY: 0.36,
            duration: 240,
            ease: 'Cubic.easeInOut',
            onUpdate: () => {
                this.playerHalo.setPosition(this.player.x, this.player.y + 10);
                this.carriedVisual.setPosition(this.player.x, this.player.y - 34);
            },
            onComplete: () => {
                this.player.setScale(0.29);
                this.isChuteSliding = false;
                this.invulnerableUntil = Math.max(this.invulnerableUntil, this.time.now + 700);

                // If Pi has the Burrow Turbo perk and popped UP into the hall, grant brief turbo & cloak!
                if (dir === 'up' && this.runPerks.burrow_turbo) {
                    this.activeBoosters.turbo = Math.max(this.activeBoosters.turbo, this.time.now + 3000);
                    this.activeBoosters.cloak = Math.max(this.activeBoosters.cloak, this.time.now + 2500);
                    this._showToast('🚀 Пружинный вылет из норки! Ускорение + Невидимость!', '#a855f7');
                }

                // If Pi dove DOWN into the burrow while carrying a Giant Prize or Pet Friend,
                // deliver it straight along the burrow into her Cozy Home Sanctuary!
                if (dir === 'down' && this.carriedItem) {
                    this._deliverCarriedItemToHomeNest();
                }

                this._refreshHud();
            }
        });
    }

    /**
     * Classic "Tom & Jerry" comedic payoff:
     * When Pi dives into a baseboard Mouse-Hole while a monster is chasing or nearby,
     * the monster lunges at the mouse-hole and SLAMS its forehead into the wall above ("БАМ! 💫")!
     */
    _checkTomAndJerryMonsterBonk(chute) {
        this.monsters.forEach((m) => {
            if (m.state === 'wall_bonk') return;
            const dist = Math.hypot(m.x - chute.topX, m.y - chute.topY);
            const isChasingInRoom = (m.state === 'chase' || m.state === 'alert') && dist < 260;
            if (dist < 165 || isChasingInRoom) {
                m.state = 'wall_bonk';
                m.bonkUntil = this.time.now + 3800;

                // Monster lunges at the mouse-hole and bounces off with stars!
                this.tweens.add({
                    targets: m.sprite,
                    x: chute.topX,
                    y: chute.topY - 14,
                    duration: 160,
                    ease: 'Quad.easeIn',
                    onComplete: () => {
                        this.cameras.main.shake(180, 0.008);
                        bus.emit(SFX. ENEMY_HIT || SFX.PIE_HIT);
                        this._playMusicalChime([220, 196, 146.83], 0.08, 'sawtooth');

                        // Bonus cheese for outsmarting the monster!
                        this.carriedCheese += 10;
                        this._refreshHud();

                        const bonkTxt = this.add.text(chute.topX, chute.topY - 46, '💥 БАМ! НЕ ДОГНАЛ! 💫 (+10🧀)', {
                            fontFamily: 'Nunito, sans-serif',
                            fontSize: '14px',
                            fontStyle: '900',
                            color: '#fef08a',
                            stroke: '#be185d',
                            strokeThickness: 4
                        }).setOrigin(0.5).setDepth(35).setResolution(this.dpr);

                        this.tweens.add({
                            targets: bonkTxt,
                            y: chute.topY - 78,
                            alpha: 0,
                            duration: 1500,
                            onComplete: () => bonkTxt.destroy()
                        });

                        // Bounce monster slightly back
                        m.x = chute.topX;
                        m.y = Math.max((this.room.upperY1 + 1.5) * this.room.cell, chute.topY - 38);
                        m.sprite.setPosition(m.x, m.y);
                        m.statusBadge.setText('💫 БАМ! ⭐');
                    }
                });
            }
        });
    }

    /**
     * Delivers the currently carried Giant Treasure or Captive Pet Friend
     * into Pi's Cozy Home Sanctuary in the underground burrow!
     */
    _deliverCarriedItemToHomeNest() {
        if (!this.carriedItem) return;
        const item = this.carriedItem;
        this.carriedItem = null;
        this.carriedVisual.setVisible(false);
        this.burrowGuideArrow.setVisible(false);

        this.deliveredCount++;
        const bonusCheese = item.value || 25;
        this.carriedCheese += bonusCheese;
        if (item.kind === 'pet') {
            this.totalRescuedInRun++;
        }

        bus.emit(SFX.KEY_PICKUP);
        this._playMusicalChime([523.25, 659.25, 783.99, 1046.5], 0.07, 'triangle');

        // Animate the prize flying along the burrow tunnel into Pi's Cozy Home Stash!
        const flyIcon = this.add.text(this.player.x, this.player.y, item.icon, {
            fontSize: '30px'
        }).setOrigin(0.5).setDepth(32).setResolution(this.dpr);

        const targetX = this.room.homeNest.x + 15 + ((this.deliveredCount - 1) % 4) * 24;
        const targetY = this.room.homeNest.y + 4 - Math.floor((this.deliveredCount - 1) / 4) * 20;

        this.tweens.add({
            targets: flyIcon,
            x: targetX,
            y: targetY,
            scale: 0.88,
            duration: 460,
            ease: 'Back.easeOut'
        });

        this._refreshHomeQuotaLabel();
        this._refreshHud();

        const left = Math.max(0, this.totalQuota - this.deliveredCount);
        if (left > 0) {
            this._showToast(`🏠 ${item.name} в норке! (+${bonusCheese}🧀) Осталось утащить: ${left}`, '#4ade80');
        } else {
            this._showToast('🎉 ВСЯ ДОБЫЧА В УЮТНОЙ НОРКЕ! Победа!', '#facc15');
            this.time.delayedCall(650, () => this.onFloorCleared());
        }
    }

    // =========================================================================
    // 10. WHISTLE DECOY, CREAM CAKE THROW & SILENT ROLL
    // =========================================================================

    _triggerWhistleDecoy() {
        if (this.ended || this.isPaused) return;
        const now = this.time.now;
        if (now < this.whistleCooldownUntil) return;
        this.whistleCooldownUntil = now + 2600;

        // If Pi is underground in the burrow, the whistle echoes out of the nearest upper mouse-hole!
        let soundX = this.player.x;
        let soundY = this.player.y;
        if (this._isPlayerInBurrow()) {
            let bestChute = this.room.chutes[0];
            let bestD = Infinity;
            for (const ch of this.room.chutes) {
                const d = Math.abs(this.player.x - ch.botX);
                if (d < bestD) {
                    bestD = d;
                    bestChute = ch;
                }
            }
            if (bestChute) {
                soundX = bestChute.topX;
                soundY = bestChute.topY;
            }
        }

        this._playMusicalChime([987.77, 1318.5, 1174.66], 0.06, 'sine');

        const ring = this.add.circle(soundX, soundY, 14, 0xfacc15, 0.25)
            .setStrokeStyle(3, 0xfef08a, 0.95)
            .setDepth(28);
        this.tweens.add({
            targets: ring,
            radius: 170,
            alpha: 0,
            duration: 620,
            onComplete: () => ring.destroy()
        });

        const txt = this.add.text(soundX, soundY - 26, '🎵 ФЬЮТЬ-ФЬЮТЬ!', {
            fontFamily: 'Nunito, sans-serif',
            fontSize: '13px',
            fontStyle: '900',
            color: '#fef08a',
            stroke: '#0f172a',
            strokeThickness: 3.5
        }).setOrigin(0.5).setDepth(29).setResolution(this.dpr);
        this.tweens.add({
            targets: txt,
            y: soundY - 52,
            alpha: 0,
            duration: 900,
            onComplete: () => txt.destroy()
        });

        // Attract nearest monster in the upper rooms to investigate the whistle!
        let lured = 0;
        this.monsters.forEach((m) => {
            if (m.state === 'cake_blind' || m.state === 'wall_bonk') return;
            if (Math.hypot(m.x - soundX, m.y - soundY) <= 320) {
                m.state = 'alert';
                m.investigateTarget = { x: soundX, y: soundY };
                m.investigateUntil = now + WHISTLE_DISTRACT_MS;
                m.statusBadge.setText('❓ Кто свистел?');
                lured++;
            }
        });

        if (lured > 0) {
            this._showToast('📣 Свист из норки приманил стража к плинтусу!', '#facc15');
        }
    }

    _throwCreamCake() {
        if (this.ended || this.isPaused) return;
        if (this.piesLeft <= 0) {
            this._showToast('🎂 Тортики закончились!', '#fda4af');
            return;
        }
        this.piesLeft--;
        this._refreshHud();
        bus.emit(SFX.PIE_THROW);

        const dirLen = Math.hypot(this.playerFacing.x, this.playerFacing.y) || 1;
        const dx = this.playerFacing.x / dirLen;
        const dy = this.playerFacing.y / dirLen;

        const cake = this.add.image(this.player.x, this.player.y, 'd_pie')
            .setDisplaySize(30, 30)
            .setDepth(25);

        this.thrownCakes.push({
            sprite: cake,
            x: this.player.x,
            y: this.player.y,
            vx: dx * CAKE_SPEED,
            vy: dy * CAKE_SPEED,
            bornAt: this.time.now
        });
    }

    _splatCakeAt(wx, wy, fromCeiling = false) {
        bus.emit(SFX.PIE_HIT);

        const splat = this.add.circle(wx, wy, 12, 0xf472b6, 0.55)
            .setStrokeStyle(3, 0xffffff, 0.95)
            .setDepth(17);
        this.tweens.add({
            targets: splat,
            radius: CAKE_BLIND_RADIUS,
            alpha: 0,
            duration: 600,
            onComplete: () => splat.destroy()
        });

        const now = this.time.now;
        this.monsters.forEach((m) => {
            const d = Math.hypot(m.x - wx, m.y - wy);
            if (d <= CAKE_BLIND_RADIUS + (fromCeiling ? 45 : 0)) {
                m.state = 'cake_blind';
                m.blindUntil = now + CAKE_BLIND_MS;
                m.statusBadge.setText('🎂 В КРЕМЕ! 😋');
            } else if (d <= CAKE_HEAR_RADIUS && m.state !== 'cake_blind' && m.state !== 'wall_bonk') {
                m.state = 'alert';
                m.investigateTarget = { x: wx, y: wy };
                m.investigateUntil = now + CAKE_DISTRACT_MS;
                m.statusBadge.setText('🍰 Тортик?!');
            }
        });
    }

    _triggerSilentRoll() {
        if (this.ended || this.isPaused || this.isChuteSliding) return;
        const now = this.time.now;
        if (now < this.dashCooldownUntil) return;

        this.dashUntil = now + PLAYER_DASH_MS;
        this.dashCooldownUntil = now + PLAYER_DASH_CD_MS * this.skinDashCdMul;
        bus.emit(SFX.DASH);

        this.tweens.add({
            targets: this.player,
            angle: 360,
            duration: PLAYER_DASH_MS,
            onComplete: () => this.player.setAngle(0)
        });
    }

    // =========================================================================
    // 11. MAIN UPDATE LOOP
    // =========================================================================

    update(time, delta) {
        if (this.ended || this.isPaused) return;
        const dt = Math.min(0.05, delta / 1000);

        this._updatePlayerMovement(time, dt);
        this._updateBurrowActionButton();
        this._updateCollectiblesAndHaulables(time, dt);
        this._updateThrownCakes(time, dt);
        this._updateMonstersAndCeilingSteps(time, dt);
        this._refreshHud();
    }

    _updatePlayerMovement(time, dt) {
        if (this.isChuteSliding) return;

        let ix = this.joyVec?.x || 0;
        let iy = this.joyVec?.y || 0;

        if (this.keys) {
            if (this.keys.left.isDown || this.keys.leftArr.isDown) ix -= 1;
            if (this.keys.right.isDown || this.keys.rightArr.isDown) ix += 1;
            if (this.keys.up.isDown || this.keys.upArr.isDown) iy -= 1;
            if (this.keys.down.isDown || this.keys.downArr.isDown) iy += 1;
        }

        const mag = Math.hypot(ix, iy);
        if (mag > 0.06) {
            const nx = ix / Math.max(1, mag);
            const ny = iy / Math.max(1, mag);
            this.playerFacing.x = nx;
            this.playerFacing.y = ny;

            const inBurrow = this._isPlayerInBurrow();
            let spd = inBurrow ? PLAYER_BURROW_SPEED : PLAYER_BASE_SPEED;
            if (time < this.dashUntil) spd = PLAYER_DASH_SPEED;
            if (time < this.activeBoosters.turbo) spd *= 1.32;
            if (this.runPerks.ninja_paws) spd *= 1.18;
            if (!inBurrow && this.carriedItem) spd *= (this.carriedItem.weightMul || 0.88);
            spd *= this.skinSpeedMul;

            const nextX = this.player.x + nx * spd * dt;
            const nextY = this.player.y + ny * spd * dt;
            const r = 13;

            if (this._canWalkAt(nextX, this.player.y, r)) {
                this.player.x = nextX;
            }
            if (this._canWalkAt(this.player.x, nextY, r)) {
                this.player.y = nextY;
            }

            if (Math.abs(nx) > 0.08) {
                this.player.setFlipX(nx < 0);
            }

            this.walkAnimTimer += dt * 11;
            const frame = Math.floor(this.walkAnimTimer) % 2;
            this.player.setTexture(frame === 0 ? this.playerWalk1 : this.playerWalk2);

            // Seamless Auto-Dive into a baseboard Mouse-Hole when Pi runs into it while carrying loot or pushing down!
            if (!inBurrow) {
                const nearChute = this._findNearestChuteInteraction();
                if (nearChute && nearChute.dir === 'down') {
                    const distToHole = Math.hypot(this.player.x - nearChute.chute.topX, this.player.y - nearChute.chute.topY);
                    if (distToHole < 26 && (this.carriedItem || ny > 0.35)) {
                        this._useNearestBurrowChute(nearChute);
                        return;
                    }
                }
            } else {
                // In the burrow: if Pi pushes UP right at a chute landing, pop up to the room above!
                const nearChute = this._findNearestChuteInteraction();
                if (nearChute && nearChute.dir === 'up') {
                    const distToLanding = Math.hypot(this.player.x - nearChute.chute.botX, this.player.y - nearChute.chute.botY);
                    if (distToLanding < 24 && ny < -0.55) {
                        this._useNearestBurrowChute(nearChute);
                        return;
                    }
                }
            }
        } else {
            this.player.setTexture(this.playerSkinBase);
        }

        this.playerHalo.setPosition(this.player.x, this.player.y + 10);
        this.carriedVisual.setPosition(this.player.x, this.player.y - 36);

        // Update Guide Arrow pointing to the nearest Mouse-Hole when carrying a prize in the upper hall
        if (this.carriedItem && !this._isPlayerInBurrow()) {
            this.burrowGuideArrow.setVisible(true);
            this.burrowGuideArrow.clear();
            let nearestChute = this.room.chutes[0];
            let bestD = Infinity;
            for (const ch of this.room.chutes) {
                const d = Math.hypot(this.player.x - ch.topX, this.player.y - ch.topY);
                if (d < bestD) {
                    bestD = d;
                    nearestChute = ch;
                }
            }
            if (nearestChute) {
                this.burrowGuideArrow.lineStyle(3.5, 0xfacc15, 0.85);
                this.burrowGuideArrow.lineBetween(this.player.x, this.player.y, nearestChute.topX, nearestChute.topY);
                this.burrowGuideArrow.fillStyle(0xfef08a, 0.9);
                this.burrowGuideArrow.fillCircle(nearestChute.topX, nearestChute.topY, 8);
            }
        } else {
            this.burrowGuideArrow.setVisible(false);
        }

        // Check if all quota is delivered and Pi is inside her Cozy Home Nest
        if (this.deliveredCount >= this.totalQuota && this._isPlayerInBurrow()) {
            const distHome = Math.hypot(this.player.x - this.room.homeNest.x, this.player.y - this.room.homeNest.y);
            if (distHome < 85) {
                this.onFloorCleared();
            }
        }
    }

    _updateBurrowActionButton() {
        const btn = document.getElementById('sneak-btn-burrow');
        const iconEl = document.getElementById('sneak-burrow-icon');
        const labelEl = document.getElementById('sneak-burrow-label');
        if (!btn || !iconEl || !labelEl) return;

        const near = this._findNearestChuteInteraction();
        if (!near) {
            btn.style.display = 'none';
            return;
        }
        btn.style.display = 'flex';
        if (near.dir === 'down') {
            iconEl.textContent = '🕳️';
            labelEl.textContent = `В НОРКУ #${near.chute.label}`;
        } else {
            iconEl.textContent = '🔼';
            labelEl.textContent = `НАВЕРХ #${near.chute.label}`;
        }
    }

    _updateCollectiblesAndHaulables(time, dt) {
        const px = this.player.x;
        const py = this.player.y;
        const magnetR = (time < this.activeBoosters.magnet || this.runPerks.cheese_magnet) ? 125 : 30;

        // 1. Small Cheese Crumbs
        this.cheeseSprites.forEach((ch) => {
            if (ch.collected) return;
            const d = Math.hypot(px - ch.x, py - ch.y);
            if (d < magnetR && d > 22) {
                ch.x += ((px - ch.x) / d) * 260 * dt;
                ch.y += ((py - ch.y) / d) * 260 * dt;
                ch.sprite.setPosition(ch.x, ch.y);
            }
            if (d <= 26) {
                ch.collected = true;
                ch.sprite.destroy();
                const gain = Math.round(ch.value * (this.runPerks.cheese_magnet ? 1.3 : 1));
                this.carriedCheese += gain;
                bus.emit(SFX.CHEESE);
            }
        });

        // 2. Golden Key Pickup
        if (this.goldenKeyObj && !this.goldenKeyObj.collected) {
            if (Math.hypot(px - this.goldenKeyObj.x, py - this.goldenKeyObj.y) <= 32) {
                this.goldenKeyObj.collected = true;
                this.goldenKeyObj.container.destroy();
                this.hasGoldenKey = true;
                bus.emit(SFX.KEY_PICKUP);
                this._playMusicalChime([659.25, 783.99, 1046.5], 0.07, 'triangle');
                this._showToast('🗝️ Золотой Ключ Стража найден! Теперь можно открыть любую клетку!', '#facc15');

                // Update locked pet badges
                this.petNodes.forEach((pt) => {
                    if (pt.locked && !pt.pickedUp) {
                        pt.locked = false;
                        pt.lockBadge.setText('🔓 ОТКРЫТО! СПАСИ В НОРКУ!');
                        pt.lockBadge.setColor('#4ade80');
                    }
                });
            }
        }

        // 3. Underground Sabotage Levers
        this.leverObjs.forEach((lv) => {
            if (!lv.data.used && Math.hypot(px - lv.data.x, py - lv.data.y) <= 34) {
                this._triggerSabotageLever(lv);
            }
        });

        // 4. Boosters
        this.boosterSprites.forEach((b) => {
            if (b.collected) return;
            if (Math.hypot(px - b.x, py - b.y) <= 30) {
                b.collected = true;
                b.container.destroy();
                this.activeBoosters[b.type] = time + b.durationMs;
                bus.emit(SFX.RELIC_PICKUP);
                this._showToast(`${b.icon} ${b.name} активирован!`, '#a855f7');
            }
        });

        // 5. Picking up a Giant Carryable Treasure or Captive Pet Friend (if hands are free!)
        if (!this.carriedItem && !this._isPlayerInBurrow()) {
            for (const pr of this.carryableObjs) {
                if (pr.pickedUp) continue;
                if (Math.hypot(px - pr.x, py - pr.y) <= 34) {
                    pr.pickedUp = true;
                    pr.container.destroy();
                    this._equipCarriedItem({
                        kind: 'treasure',
                        name: pr.name,
                        icon: pr.icon,
                        value: pr.value,
                        weightMul: pr.weightMul
                    });
                    break;
                }
            }
        }

        if (!this.carriedItem && !this._isPlayerInBurrow()) {
            for (const pt of this.petNodes) {
                if (pt.pickedUp) continue;
                if (Math.hypot(px - pt.x, py - pt.y) <= 36) {
                    if (pt.locked && !this.hasGoldenKey) {
                        this._showToast('🔒 Клетка заперта! Сначала найди Золотой Ключ 🗝️!', '#facc15');
                        continue;
                    }
                    pt.pickedUp = true;
                    pt.container.destroy();
                    this._equipCarriedItem({
                        kind: 'pet',
                        name: pt.name,
                        icon: pt.badge,
                        value: 35,
                        weightMul: 0.92
                    });
                    break;
                }
            }
        }
    }

    _equipCarriedItem(item) {
        this.carriedItem = item;
        this.carriedIconText.setText(item.icon);
        this.carriedLabelText.setText(`БЕГИ В НОРКУ! 🕳️`);
        this.carriedVisual.setVisible(true);

        bus.emit(SFX.CHEST_OPEN);
        this._playMusicalChime([523.25, 659.25, 783.99], 0.06, 'triangle');
        this._showToast(`🙌 Схватила: ${item.icon} ${item.name}! Ныряй с ней в ближайшую НОРКУ 🕳️!`, '#facc15');
    }

    _updateThrownCakes(time, dt) {
        for (let i = this.thrownCakes.length - 1; i >= 0; i--) {
            const c = this.thrownCakes[i];
            c.x += c.vx * dt;
            c.y += c.vy * dt;
            c.sprite.setPosition(c.x, c.y);
            c.sprite.rotation += 10 * dt;

            let hitMonster = false;
            for (const m of this.monsters) {
                if (Math.hypot(m.x - c.x, m.y - c.y) <= 28) {
                    hitMonster = true;
                    break;
                }
            }

            if (hitMonster || !this._isWalkableCellAtWorld(c.x, c.y) || time - c.bornAt > 1100) {
                c.sprite.destroy();
                this.thrownCakes.splice(i, 1);
                this._splatCakeAt(c.x, c.y, false);
            }
        }
    }

    // =========================================================================
    // 12. MONSTER AI, VISION CONES & CEILING FOOTSTEP DUST («ШАГИ НАД ГОЛОВОЙ»)
    // =========================================================================

    _updateMonstersAndCeilingSteps(time, dt) {
        const playerInBurrow = this._isPlayerInBurrow();
        const playerCloaked = (time < this.activeBoosters.cloak) || this._isInsideShadowCushion(this.player.x, this.player.y);
        const playerInvisible = playerInBurrow || playerCloaked || this.isChuteSliding;

        const floorSlabCeilingY = this.room.burrowY1 * this.room.cell;

        this.monsters.forEach((m) => {
            // 1. Handle Stunned / Blinded states
            if (m.state === 'wall_bonk') {
                if (time >= m.bonkUntil) {
                    m.state = 'patrol';
                    m.statusBadge.setText('');
                } else {
                    m.coneGfx.clear();
                    m.statusBadge.setPosition(m.x, m.y - 44);
                    return;
                }
            }

            if (m.state === 'cake_blind') {
                if (time >= m.blindUntil) {
                    m.state = 'patrol';
                    m.statusBadge.setText('');
                } else {
                    m.coneGfx.clear();
                    m.statusBadge.setPosition(m.x, m.y - 44);
                    return;
                }
            }

            // 2. Check Vision Cone against Pi (ONLY if Pi is in the Upper Castle Rooms!)
            const dx = this.player.x - m.x;
            const dy = this.player.y - m.y;
            const dist = Math.hypot(dx, dy);
            let seesPlayer = false;

            if (!playerInvisible && dist <= m.cfg.coneLen) {
                const angleToPlayer = Math.atan2(dy, dx);
                const diff = Math.abs(Phaser.Math.Angle.Wrap(angleToPlayer - m.facingRad));
                if (diff <= m.cfg.coneHalfRad && this._hasLineOfSight(m.x, m.y, this.player.x, this.player.y)) {
                    seesPlayer = true;
                }
            }

            if (seesPlayer) {
                m.suspicion = Math.min(1, m.suspicion + (dt * 1000) / SUSPICION_FILL_MS);
                if (m.suspicion >= 1 || this.carriedItem) {
                    if (m.state !== 'chase') {
                        m.state = 'chase';
                        this.seenOnThisFloor = true;
                        this.everSeenInRun = true;
                        m.statusBadge.setText('❗ ДЕРЖИ ЕЁ!');
                        this._showToast(`🐾 ${m.cfg.name} заметил Пи! Ныряй в норку, чтобы он врезался в стену!`, '#fda4af');
                    }
                    m.investigateTarget = { x: this.player.x, y: this.player.y };
                    m.investigateUntil = time + 2600;
                } else {
                    m.statusBadge.setText('👀 Кто там?');
                }
            } else {
                m.suspicion = Math.max(0, m.suspicion - (dt * 1000) / SUSPICION_DECAY_MS);
                if (m.state === 'chase' && (playerInBurrow || time > m.investigateUntil)) {
                    m.state = 'patrol';
                    m.statusBadge.setText('');
                } else if (m.state === 'alert' && time > m.investigateUntil) {
                    m.state = 'patrol';
                    m.statusBadge.setText('');
                }
            }

            // 3. Move Monster toward current waypoint or chase target
            let targetX = m.x;
            let targetY = m.y;
            let moveSpd = m.cfg.speed;

            if (m.state === 'chase' && !playerInvisible) {
                targetX = this.player.x;
                targetY = this.player.y;
                moveSpd = m.cfg.chaseSpeed;
            } else if ((m.state === 'alert' || m.state === 'chase') && m.investigateTarget) {
                targetX = m.investigateTarget.x;
                targetY = m.investigateTarget.y;
                moveSpd = m.cfg.speed * 1.15;
            } else {
                const wp = m.cfg.waypoints[m.wpIndex] || m.cfg.waypoints[0];
                targetX = wp.x;
                targetY = wp.y;
                if (Math.hypot(targetX - m.x, targetY - m.y) < 12) {
                    m.wpIndex = (m.wpIndex + 1) % m.cfg.waypoints.length;
                }
            }

            const tdx = targetX - m.x;
            const tdy = targetY - m.y;
            const tDist = Math.hypot(tdx, tdy);
            if (tDist > 2) {
                const ux = tdx / tDist;
                const uy = tdy / tDist;
                m.facingRad = Phaser.Math.Angle.RotateTo(m.facingRad, Math.atan2(uy, ux), 4.5 * dt);

                const nx = m.x + ux * moveSpd * dt;
                const ny = m.y + uy * moveSpd * dt;
                // Monsters stay inside upper castle rooms
                if (this._isUpperRoomWalkable(nx, m.y)) m.x = nx;
                if (this._isUpperRoomWalkable(m.x, ny)) m.y = ny;

                if (Math.abs(ux) > 0.08) {
                    m.sprite.setFlipX(ux < 0);
                }

                // 4. CEILING FOOTSTEP RIPPLES («ТОП-ТОП НАД ГОЛОВОЙ В НОРКЕ!»)
                m.stepTimer += dt;
                if (m.stepTimer >= 0.68) {
                    m.stepTimer = 0;
                    this._spawnCeilingFootstepDust(m.x, floorSlabCeilingY, m.cfg.name);
                }
            }

            m.sprite.setPosition(m.x, m.y);
            m.statusBadge.setPosition(m.x, m.y - 44);
            this._drawMonsterCone(m);

            // 5. Check Catch Collision (only in Upper Room!)
            if (!playerInBurrow && !this.isChuteSliding && time >= this.invulnerableUntil) {
                if (Math.hypot(this.player.x - m.x, this.player.y - m.y) <= CATCH_DIST) {
                    this._onPlayerCaught(m);
                }
            }
        });
    }

    /**
     * Spawns visible dust motes & "ТОП!" vibration ripples on the ceiling of the
     * underground burrow directly beneath a walking monster's feet!
     */
    _spawnCeilingFootstepDust(mx, ceilingY) {
        const dust = this.add.circle(mx, ceilingY + 2, 6, 0xfde68a, 0.45).setDepth(15);
        this.tweens.add({
            targets: dust,
            y: ceilingY + 26,
            scale: 2.1,
            alpha: 0,
            duration: 520,
            onComplete: () => dust.destroy()
        });

        if (this._isPlayerInBurrow() && Math.abs(this.player.x - mx) < 220) {
            const thudTxt = this.add.text(mx, ceilingY + 8, 'ТОП!', {
                fontFamily: 'Nunito, sans-serif',
                fontSize: '9.5px',
                fontStyle: '900',
                color: '#fde68a',
                stroke: '#451a03',
                strokeThickness: 2.5
            }).setOrigin(0.5).setDepth(16).setResolution(this.dpr);

            this.tweens.add({
                targets: thudTxt,
                y: ceilingY + 24,
                alpha: 0,
                duration: 480,
                onComplete: () => thudTxt.destroy()
            });
        }
    }

    _drawMonsterCone(m) {
        const g = m.coneGfx;
        g.clear();
        const color = m.state === 'chase' ? 0xf43f5e : (m.suspicion > 0.15 ? 0xfacc15 : 0x38bdf8);
        const alpha = m.state === 'chase' ? 0.30 : 0.17;

        g.fillStyle(color, alpha);
        g.beginPath();
        g.moveTo(m.x, m.y);
        const steps = 10;
        const startA = m.facingRad - m.cfg.coneHalfRad;
        const endA = m.facingRad + m.cfg.coneHalfRad;
        for (let i = 0; i <= steps; i++) {
            const a = startA + (endA - startA) * (i / steps);
            g.lineTo(m.x + Math.cos(a) * m.cfg.coneLen, m.y + Math.sin(a) * m.cfg.coneLen);
        }
        g.closePath();
        g.fillPath();
    }

    _hasLineOfSight(x1, y1, x2, y2) {
        const steps = 10;
        for (let i = 1; i < steps; i++) {
            const t = i / steps;
            const sx = x1 + (x2 - x1) * t;
            const sy = y1 + (y2 - y1) * t;
            if (!this._isUpperRoomWalkable(sx, sy)) return false;
        }
        return true;
    }

    _onPlayerCaught(monster) {
        if (this.ended) return;
        bus.emit(SFX.CAUGHT);
        this.cameras.main.shake(220, 0.012);

        this.hearts = Math.max(0, this.hearts - 1);
        this._refreshHud();

        if (this.hearts > 0) {
            // Smoke-bomb escape straight down into Pi's Cozy Underground Home Nest!
            this.invulnerableUntil = this.time.now + 2400;
            const sx = this.room.homeNest.x;
            const sy = this.room.homeNest.y;
            this.player.setPosition(sx, sy);
            this.playerHalo.setPosition(sx, sy + 10);
            this.carriedVisual.setPosition(sx, sy - 36);
            this._showToast(`💨 Успела юркнуть в свою норку! Осталось сердечек: ${this.hearts}`, '#fca5a5');
            return;
        }

        this.ended = true;
        const unbankedOnFloor = Math.max(0, this.carriedCheese - (this.bankedInRun || 0));
        const keptOnFloor = Math.floor(unbankedOnFloor * 0.8);
        const totalKeptInRun = (this.bankedInRun || 0) + keptOnFloor;
        this.bankedInRun = totalKeptInRun;
        Progress.recordSneakRun({
            cleared: false,
            neverSeen: false,
            cheese: keptOnFloor,
            floor: this.floor
        });
        this._showGameOverModal(monster, totalKeptInRun);
    }

    // =========================================================================
    // 13. MODALS: FLOOR CLEARED PERK PICKER, PAUSE & GAME OVER
    // =========================================================================

    onFloorCleared() {
        if (this.ended) return;
        this.ended = true;

        const floorBonus = 18 + this.floor * 6;
        const stealthBonus = this.seenOnThisFloor ? 0 : 15;
        const earned = floorBonus + stealthBonus;
        this.carriedCheese += earned;
        this._refreshHud();

        const unbankedFloorCheese = Math.max(0, this.carriedCheese - (this.bankedInRun || 0));
        this.bankedInRun = this.carriedCheese;
        Progress.recordSneakRun({
            cleared: true,
            neverSeen: !this.seenOnThisFloor,
            cheese: unbankedFloorCheese,
            floor: this.floor
        });

        bus.emit(SFX.VICTORY);
        this._playMusicalChime([523.25, 659.25, 783.99, 1046.5, 1318.5], 0.09, 'triangle');

        const modalRoot = document.getElementById('sneak-modal-root');
        if (!modalRoot) return;

        const shuffled = [...RUN_PERKS].sort(() => Math.random() - 0.5).slice(0, 3);
        modalRoot.innerHTML = `
            <div class="sneak-modal-card">
                <div style="font-weight:900;font-size:min(5vw, 22px);color:#fef08a;">
                    🏠 ВСЯ ДОБЫЧА В НОРКЕ! ЭТАЖ ${this.floor} ПРОЙДЕН! +${earned} 🧀
                </div>
                <div style="font-weight:800;font-size:min(3.4vw, 14px);color:#e2e8f0;margin-top:4px;">
                    🎁 Выбери 1 Супер-Способность для Норки на Этаж ${this.floor + 1}:
                </div>
                <div class="sneak-perk-grid">
                    ${shuffled.map((p, idx) => `
                        <div class="sneak-perk-card" data-perk-idx="${idx}" style="border-color:${p.color}">
                            <div style="font-size:32px;line-height:1;">${p.icon}</div>
                            <div style="font-weight:900;font-size:13px;color:${p.color};">${p.title}</div>
                            <div style="font-weight:700;font-size:11px;color:#cbd5e1;line-height:1.25;">${p.desc}</div>
                            <div style="font-weight:900;font-size:11px;color:#fef08a;margin-top:auto;">✨ ВЫБРАТЬ</div>
                        </div>
                    `).join('')}
                </div>
                <button class="sneak-action-btn" id="sneak-bank-exit-btn" style="background:#334155;border:2px solid #94a3b8;">
                    🏰 Забрать ${this.carriedCheese} 🧀 и выйти в меню
                </button>
            </div>
        `;
        modalRoot.classList.add('visible');

        modalRoot.querySelectorAll('.sneak-perk-card').forEach((el) => {
            el.addEventListener('click', () => {
                const idx = parseInt(el.getAttribute('data-perk-idx'), 10);
                bus.emit(SFX.CLICK);
                this._applyChosenPerkAndAdvance(shuffled[idx]);
            });
        });

        document.getElementById('sneak-bank-exit-btn')?.addEventListener('click', () => {
            bus.emit(SFX.CLICK);
            this._exitToCastleMenu();
        });
    }

    _applyChosenPerkAndAdvance(perk) {
        const nextPerks = { ...this.runPerks, [perk.id]: (this.runPerks[perk.id] || 0) + 1 };
        let nextHearts = this.hearts;
        let nextCheese = this.carriedCheese;
        let nextBanked = this.bankedInRun || 0;
        let nextPies = this.piesLeft;

        if (perk.id === 'extra_heart') {
            nextHearts = this.maxHearts;
            nextCheese += 20;
            nextBanked += 20;
            Progress.addCheese?.(20);
        } else if (perk.id === 'cake_factory') {
            nextPies = Math.min(9, nextPies + 2);
        }

        this.scene.restart({
            floor: this.floor + 1,
            carriedCheese: nextCheese,
            bankedInRun: nextBanked,
            totalRescuedInRun: this.totalRescuedInRun,
            streak: Math.min(3.0, +(this.streak + 0.2).toFixed(2)),
            hearts: nextHearts,
            maxHearts: this.maxHearts,
            piesLeft: nextPies,
            runPerks: nextPerks,
            everSeenInRun: this.everSeenInRun
        });
    }

    _showGameOverModal(monster, keptCheese) {
        const modalRoot = document.getElementById('sneak-modal-root');
        if (!modalRoot) return;

        modalRoot.innerHTML = `
            <div class="sneak-modal-card" style="border-color:#f43f5e;max-width:440px;">
                <div style="font-weight:900;font-size:min(5vw, 21px);color:#fda4af;">
                    🐾 ${monster.cfg.name} поймал Пи наверху!
                </div>
                <div style="font-weight:800;font-size:14.5px;color:#f8fafc;margin:14px 0;line-height:1.5;">
                    Достигнут этаж: <b>${this.floor}</b><br>
                    Спасено друзей в норку: <b>${this.totalRescuedInRun} 🐾</b><br>
                    Сохранено в норке: <b style="color:#facc15;">+${keptCheese} 🧀</b>
                </div>
                <div style="display:flex;flex-direction:column;gap:8px;">
                    <button class="sneak-action-btn" id="sneak-retry-btn" style="background:linear-gradient(180deg,#10b981,#059669);">
                        🔄 НОВАЯ ОПЕРАЦИЯ (ЭТАЖ 1)
                    </button>
                    <button class="sneak-action-btn" id="sneak-gameover-menu-btn" style="background:#334155;">
                        🏰 В МЕНЮ ЗАМКА ТЕНЕЙ
                    </button>
                </div>
            </div>
        `;
        modalRoot.classList.add('visible');

        document.getElementById('sneak-retry-btn')?.addEventListener('click', () => {
            bus.emit(SFX.CLICK);
            this.scene.restart({ floor: 1 });
        });
        document.getElementById('sneak-gameover-menu-btn')?.addEventListener('click', () => {
            bus.emit(SFX.CLICK);
            this._exitToCastleMenu();
        });
    }

    togglePauseModal() {
        if (this.ended) return;
        const modalRoot = document.getElementById('sneak-modal-root');
        if (!modalRoot) return;

        if (this.isPaused) {
            this.isPaused = false;
            modalRoot.classList.remove('visible');
            modalRoot.innerHTML = '';
            return;
        }

        this.isPaused = true;
        modalRoot.innerHTML = `
            <div class="sneak-modal-card" style="border-color:#38bdf8;max-width:360px;">
                <div style="font-weight:900;font-size:22px;color:#fef08a;margin-bottom:14px;">⏸ ПАУЗА</div>
                <div style="display:flex;flex-direction:column;gap:10px;">
                    <button class="sneak-action-btn" id="sneak-resume-btn" style="background:linear-gradient(180deg,#10b981,#059669);">
                        ▶ ПРОДОЛЖИТЬ
                    </button>
                    <button class="sneak-action-btn" id="sneak-pause-menu-btn" style="background:#475569;">
                        🏰 ВЫЙТИ В МЕНЮ
                    </button>
                </div>
            </div>
        `;
        modalRoot.classList.add('visible');

        document.getElementById('sneak-resume-btn')?.addEventListener('click', () => this.togglePauseModal());
        document.getElementById('sneak-pause-menu-btn')?.addEventListener('click', () => this._exitToCastleMenu());
    }

    _exitToCastleMenu() {
        const unbanked = Math.max(0, (this.carriedCheese || 0) - (this.bankedInRun || 0));
        if (unbanked > 0) {
            this.bankedInRun = this.carriedCheese;
            Progress.addCheese?.(unbanked);
        }
        this._unmountDomControls();
        bus.emit('bgm_stop');
        window.location.replace('transylvania-menu.html');
    }

    // =========================================================================
    // 14. WALKABILITY & AUDIO HELPERS
    // =========================================================================

    _isUpperRoomWalkable(wx, wy) {
        const gx = Math.floor(wx / this.room.cell);
        const gy = Math.floor(wy / this.room.cell);
        if (gy < 0 || gy >= this.room.H || gx < 0 || gx >= this.room.W) return false;
        return this.room.grid[gy][gx] === '.';
    }

    _isWalkableCellAtWorld(wx, wy) {
        const gx = Math.floor(wx / this.room.cell);
        const gy = Math.floor(wy / this.room.cell);
        if (gy < 0 || gy >= this.room.H || gx < 0 || gx >= this.room.W) return false;
        const tile = this.room.grid[gy][gx];
        if (tile === '#') return false;

        // Check active laser gates in the upper room
        if (tile === '.' && this.laserGateObjs) {
            for (const lg of this.laserGateObjs) {
                if (lg.data.active && Math.abs(wx - lg.data.x) < 16 && wy >= lg.data.y1 && wy <= lg.data.y2) {
                    return false;
                }
            }
        }
        return tile === '.' || tile === 'U';
    }

    _canWalkAt(wx, wy, r) {
        return (
            this._isWalkableCellAtWorld(wx - r, wy - r) &&
            this._isWalkableCellAtWorld(wx + r, wy - r) &&
            this._isWalkableCellAtWorld(wx - r, wy + r) &&
            this._isWalkableCellAtWorld(wx + r, wy + r)
        );
    }

    _isInsideShadowCushion(wx, wy) {
        for (const sr of this.shadowRects) {
            if (Math.hypot(wx - sr.x, wy - sr.y) <= sr.r) return true;
        }
        return false;
    }

    _playMusicalChime(freqs, noteDur = 0.07, wave = 'triangle') {
        if (localStorage.getItem('mousie_muted') === '1' || document.hidden) return;
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            if (!SneakScene._audioCtx) SneakScene._audioCtx = new Ctx();
            const ctx = SneakScene._audioCtx;
            if (ctx.state === 'suspended') return;

            const now = ctx.currentTime;
            freqs.forEach((f, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = wave;
                osc.frequency.setValueAtTime(f, now + i * noteDur);
                gain.gain.setValueAtTime(0.001, now + i * noteDur);
                gain.gain.linearRampToValueAtTime(0.11, now + i * noteDur + 0.012);
                gain.gain.exponentialRampToValueAtTime(0.0008, now + (i + 1) * noteDur + 0.06);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + i * noteDur);
                osc.stop(now + (i + 1) * noteDur + 0.07);
            });
        } catch (_) {}
    }
}
