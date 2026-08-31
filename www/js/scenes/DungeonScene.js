// ============================================
// DUNGEON SCENE - Procedural castle dungeon with A* pathfinding
// Mousie Pi vs Count Ratula's dungeon: find key, fight monsters, escape
// ============================================

import { Progress, SKINS, PERMANENT_UPGRADES } from '../storage/ProgressStore.js';
import { biomeForFloor, weightedPick, pickDecor } from './Biomes.js';
import { bus } from '../audio/EventBus.js';
import { SFX, UI, BGM } from '../audio/SoundKeys.js';
import { preloadAudio } from '../audio/AudioManager.js';
import { RELICS, pickRandomRelics, relicById, RARITY_COLORS } from './Relics.js';
import { computeHudLayout } from '../ui/hudLayout.js';
import { readSafeArea } from '../ui/safeArea.js';

const WORLD_W = 2600;
const WORLD_H = 1900;
const NAV_CELL = 40;
const COR_W_NORMAL = 3;                           // 120px corridors (3 cells)
const COR_W_BOSS   = 4;                           // 160px corridor to boss room
const NAV_W = Math.ceil(WORLD_W / NAV_CELL);
const NAV_H = Math.ceil(WORLD_H / NAV_CELL);

const SHAKE_CFG = {
    sm:  { dur: 80,  amt: 0.004 },
    med: { dur: 140, amt: 0.010 },
    big: { dur: 220, amt: 0.018 },
    huge:{ dur: 380, amt: 0.026 },
};
const POWERUP_ICON = { triple: 'ui_target', speed: 'ui_bolt', shield: 'ui_shield', fire: 'ui_flame' };
const COMPASS_ICON = { key: ['d_key', 1.5, 0.8], grandma: ['d_grandma', 0.9, 1.0], exit: ['ui_stairs', 1, 1] };   // texture, w/h factors of labelSize
const UI_ICON_NAMES = ['heart', 'heart_empty', 'eye', 'book', 'paw', 'stairs', 'target', 'bolt', 'shield', 'flame', 'move', 'dash', 'close'];

// Depth bands. World/level visuals below, UI band (989+) at the end.
const LAYER = {
    WORLD:  -100,   // tilemap floor layer (detail overlay at WORLD + 5)
    TILE:    -45,   // live biome tiles (butter / vines / thorn / hotpan) — above decor, so props don't hide hazards
    DECOR:   -50,   // decor prop sprites (under the wall tile layer)
    WALL_TILES: -40,   // tilemap wall layer (above decor sprites); cracks at WALL_TILES + 1
    SCONCE:   70,   // torch sconce sprites
    FLAME:    81,
    EYES:     82,   // also used numerically by torch smoke/spark FX

    // ---- UI band (scrollFactor 0). Values are the historical magic numbers.
    UI_TOUCH: 989,        // stick / dash outer halos
    UI_TOUCH_BASE: 990,   // stick bases, dash base, touch labels
    UI_TOUCH_HINT: 990.5, // stick hints, dash cooldown arc
    UI_TOUCH_KNOB: 991,
    UI_TOUCH_LABEL: 992,  // dash icon
    UI_HUD_BG: 999,       // exit button disc
    UI_HUD: 1000,         // hearts, counters, icons
    UI_HUD_2: 1001,       // suspicion meter ring
    UI_HUD_3: 1002,       // suspicion eye
    UI_COMPASS: 1100,
    UI_COMPASS_LABEL: 1101,
    UI_OVERLAY: 2000,     // win/lose overlay, upgrade picker
    UI_SHOP: 2200,
    UI_PICKER: 2300,      // relic picker
    UI_INTRO: 2500,       // story / floor intro
    UI_FLASH: 3000,       // flashNoCheese
    UI_DEBUG: 5000,       // fps overlay
};
// Tile indices in www/assets/tiles/<biome>.svg (see tools/gen_tiles.py)
const TILE = { PLATE_A: 0, PLATE_B: 4, CRACK: 8, PEBBLES: 9, WALL: 10, WALL_CAP: 11, WALL_SKIRT: 12, WALL_CAP_SKIRT: 13, EMPTY: 14, WEAK_CRACK: 15 };
const TILES_PER_SHEET = 16;
// World sprites: key → [file, cssW, cssH] (loaded at cssSize × dpr, displayed at 1/dpr)
const WORLD_SVGS = {
    prop_skull: ['skull', 24, 24], prop_bone: ['bone', 24, 16], prop_mushroom: ['mushroom', 24, 24], prop_cobweb: ['cobweb', 32, 32],
    prop_pot: ['pot', 28, 24], prop_sack: ['sack', 26, 26], prop_book: ['book', 24, 16], prop_candle: ['candle', 20, 32],
    prop_scroll: ['scroll', 24, 16], prop_goblet: ['goblet', 22, 28], prop_bookshelf: ['bookshelf', 34, 42], prop_redCarpet: ['redCarpet', 56, 28],
    prop_moonflower: ['moonflower', 28, 34], prop_glowpod: ['glowpod', 24, 34], prop_hedge_tuft: ['hedge_tuft', 34, 22], prop_lilypad: ['lilypad', 26, 18],
    torch_sconce: ['torch_sconce', 20, 26], flame_sheet: ['flame', 48, 28],
    door_closed: ['door_closed', 80, 110], door_open: ['door_open', 80, 110], chest_closed: ['chest_closed', 48, 44], chest_open: ['chest_open', 48, 44],
    relic_urn: ['relic_urn', 40, 48], book_forbidden: ['book_forbidden', 36, 40], candelabra_unlit: ['candelabra_unlit', 44, 60], candelabra_lit: ['candelabra_lit', 44, 60],
    sack_flour: ['sack_flour', 40, 40], pot_hanging: ['pot_hanging', 40, 40], chain: ['chain', 8, 56], cage: ['cage', 128, 160], lock: ['lock', 24, 24], unlock: ['unlock', 24, 24],
    tile_butter: ['tile_butter', 96, 56], tile_vine: ['tile_vine', 56, 56], tile_thorn: ['tile_thorn', 48, 48],
    tile_hotpan_cold: ['tile_hotpan_cold', 56, 36], tile_hotpan_warn: ['tile_hotpan_warn', 56, 36], tile_hotpan_flame: ['tile_hotpan_flame', 56, 36],
    badge_alert: ['badge_alert', 16, 24], badge_sleep: ['badge_sleep', 24, 24], badge_anger: ['badge_anger', 20, 20], badge_ear: ['badge_ear', 20, 20], badge_sparkle: ['badge_sparkle', 20, 20],
    stairs: ['stairs', 72, 80],
};
// Relic/upgrade icons: texture key → www/assets/relics/<file>.svg (UI scale, loaded at 64 × dpr like the ui_* kit)
const RELIC_SVGS = {
    relic_magnet: 'magnet', relic_star_spread: 'star_spread', relic_bounce: 'bounce', relic_crit: 'crit',
    relic_thorns: 'thorns', relic_tornado: 'tornado', relic_crown: 'crown', relic_hourglass: 'hourglass',
    relic_blood_drop: 'blood_drop', relic_gift: 'gift'
};
// Weighted decor types with no matching prop_* asset — reuse the closest existing sprite
const DECOR_ALIAS = { flower: 'moonflower', vine: 'hedge_tuft', plate: 'pot', knife: 'pot', inkwell: 'scroll', chain: 'bone' };

const PLAYER = {
    speed: 240,
    accel: 2200,
    friction: 1700,
    radius: 22,
    maxHp: 5,
    invulnMs: 900,
    fireCooldownMs: 260,
    // Dash — fast directional rush with brief invulnerability
    dashSpeed: 780,
    dashDurationMs: 200,
    dashCooldownMs: 700,
    dashInvulnMs: 260
};

const PIE = { speed: 580, life: 1400, radius: 10, damage: 1 };

const ENEMY_DEFS = {
    zombie: { speed: 78,  hp: 4, damage: 1, radius: 30, detectRange: 700, knockback: 220, scale: 0.30, alertMs: 4000 },
    cat:    { speed: 130, hp: 2, damage: 1, radius: 26, detectRange: 600, knockback: 280, scale: 0.30,
              pounceSpeed: 420, pounceCooldownMs: 1600, alertMs: 3000 },
    slime:  { speed: 110, hp: 3, damage: 1, radius: 28, detectRange: 700, knockback: 200, scale: 0.30, alertMs: 5000 },
    bat:    { speed: 120, hp: 2, damage: 1, radius: 22, detectRange: 650, knockback: 180, scale: 0.28,
              alertMs: 4000, shootCooldownMs: 1900, boltSpeed: 230 },
    guard:  { speed: 55,  hp: 6, damage: 2, radius: 32, detectRange: 0, knockback: 200, scale: 0.34,
              alertMs: 99999, coneAngle: Math.PI / 3, coneRange: 380, alarmedSpeedMul: 2.2 },
    // Skeleton — throws bones at range, slow but tough
    skeleton: { speed: 85,  hp: 5, damage: 1, radius: 30, detectRange: 700, knockback: 220, scale: 0.32,
                alertMs: 5000, boneCooldownMs: 2000, boneSpeed: 320 },
    // Ghost — phases through walls, semi-transparent, only takes damage when "solid" (every ~3s)
    ghost:  { speed: 90,  hp: 3, damage: 1, radius: 26, detectRange: 700, knockback: 150, scale: 0.32,
              alertMs: 6000, solidIntervalMs: 3000, solidDurationMs: 1200 },
    // Mimic — looks like a chest, instant attack when player gets close
    mimic:  { speed: 0,   hp: 4, damage: 2, radius: 30, detectRange: 90, knockback: 280, scale: 0.30,
              alertMs: 9999, lungeSpeed: 380, lungeCooldownMs: 1500 },
    // === Phase 4 biome-specific enemies ===
    // Chef-cat (kitchen) — signature enemy. Throws plates, has cone in stealth rooms.
    chef:   { speed: 95,  hp: 3, damage: 1, radius: 28, detectRange: 680, knockback: 230, scale: 0.30,
              alertMs: 4000, plateCooldownMs: 1800, plateSpeed: 240,
              coneAngle: Math.PI / 3, coneRange: 220, alarmedSpeedMul: 1.8 },
    // Librarian (library) — patrols aisles with tight cone. Soft otherwise.
    librarian:{ speed: 60, hp: 3, damage: 1, radius: 30, detectRange: 0, knockback: 200, scale: 0.32,
                alertMs: 9999, coneAngle: Math.PI / 3.6, coneRange: 220, alarmedSpeedMul: 2.0 },
    // Snapdragon (garden) — stationary, telegraphs then bites in arc. Has narrow rotating cone.
    snapdragon:{ speed: 0, hp: 3, damage: 2, radius: 30, detectRange: 0, knockback: 280, scale: 0.32,
                 alertMs: 9999, coneAngle: Math.PI / 3, coneRange: 180, alarmedSpeedMul: 1.0,
                 biteWindupMs: 700, biteArc: Math.PI / 2, biteRange: 80 },
    boss:   { speed: 60,  hp: 9, damage: 2, radius: 50, detectRange: 800, knockback: 260, scale: 0.55, alertMs: 9999 }
};

const IS_TOUCH = (typeof window !== 'undefined') &&
                 (('ontouchstart' in window) || (navigator.maxTouchPoints > 0));

// Final floor where grandma is held (story mode)
const TOTAL_FLOORS = 5;

// Mode-aware scaling. Story: linear gentle. Endless past floor 5: log curve.
function scaleForFloor(chapter, mode) {
    if (mode === 'story' || chapter <= 5) {
        return {
            hpMul:    1 + 0.25 * (chapter - 1),
            dmgMul:   1 + 0.15 * (chapter - 1),
            countMul: 1 + 0.15 * (chapter - 1)
        };
    }
    // Endless past floor 5 — soft log curve so floor 30 ≠ 12x HP
    const past = chapter - 5;
    return {
        hpMul:    Math.min(4.5, 2.0 + 0.55 * Math.log2(past + 1)),
        dmgMul:   Math.min(2.2, 1.6 + 0.10 * Math.log2(past + 1)),
        countMul: Math.min(2.4, 1.6 + 0.18 * Math.log2(past + 1))
    };
}

// Upgrade roster — player picks one after every floor. cap = max stacks per run.
const UPGRADES = [
    { id: 'hp',        cap: 4, icon: 'ui_heart', emoji: '❤️', name: 'Крепкое сердце', desc: '+1 максимум HP',
      apply: (s) => { s.maxHp += 1; if (s.player) s.player.hp = s.maxHp; } },
    { id: 'dash',      cap: 2, icon: 'ui_dash', emoji: '💨', name: 'Быстрый рывок',  desc: '−28% кулдаун рывка',
      apply: (s) => { s.dashCdMul = (s.dashCdMul || 1) * 0.72; } },
    { id: 'speed',     cap: 3, icon: 'ui_bolt', emoji: '⚡', name: 'Лёгкие ноги',     desc: '+15% скорость ходьбы',
      apply: (s) => { s.speedMul = (s.speedMul || 1) * 1.15; } },
    { id: 'damage',    cap: 2, icon: 'ui_flame', emoji: '🔥', name: 'Острый пирог',    desc: '+1 урон пирогом',
      apply: (s) => { s.pieDmgBonus = (s.pieDmgBonus || 0) + 1; } },
    { id: 'firerate',  cap: 2, icon: 'ui_target', emoji: '🎯', name: 'Скорострел',      desc: '−25% перезарядка',
      apply: (s) => { s.fireCdMul = (s.fireCdMul || 1) * 0.75; } },
    { id: 'piesize',   cap: 1, icon: 'd_pie', emoji: '🥧', name: 'Большие пироги',  desc: '+50% размер снаряда',
      apply: (s) => { s.pieSizeMul = (s.pieSizeMul || 1) * 1.5; } },
    { id: 'lifesteal', cap: 3, icon: 'relic_blood_drop', emoji: '🩸', name: 'Вампиризм',       desc: 'Шанс +❤️ с убитого',
      apply: (s) => { s.lifestealChance = (s.lifestealChance || 0) + 0.20; } },
    { id: 'cheese',    cap: 2, icon: 'd_cheese', emoji: '🧀', name: 'Сырный нос',      desc: '+50% сыра за подбор',
      apply: (s) => { s.cheeseMul = (s.cheeseMul || 1) * 1.5; } }
];

export class DungeonScene extends Phaser.Scene {
    constructor() { super({ key: 'DungeonScene' }); }

    init(data) {
        this.runMode = data?.runMode || Progress.getLastRunMode() || 'story';
        this.chapter = data?.chapter || 1;
        this.runScore = data?.runScore || 0;
        this.runCheeseTotal = data?.runCheeseTotal || 0;
        this.runStartTime = data?.runStartTime || (typeof performance !== 'undefined' ? performance.now() : 0);
        this.upgradeIds = data?.upgradeIds || [];
        this.runAlarmCount = data?.runAlarmCount || 0;     // for ghost-run achievement
        this.collectedRelics = data?.collectedRelics || [];
        this.maxHp = PLAYER.maxHp;
        this.speedMul = 1;
        this.dashCdMul = 1;
        this.fireCdMul = 1;
        this.pieDmgBonus = 0;
        this.pieSizeMul = 1;
        this.cheeseMul = 1;
        this.lifestealChance = 0;
        // Apply permanent upgrades from progress store FIRST (they stack each run)
        Progress.applyTo(this);
        // Then in-run upgrades collected this run
        for (const id of this.upgradeIds) {
            const upg = UPGRADES.find(u => u.id === id);
            if (upg) upg.apply(this);
        }
        // Apply collected relics for this run
        for (const rid of (this.collectedRelics || [])) {
            const r = relicById(rid);
            if (r) r.apply(this);
        }
        // Story: final floor at TOTAL_FLOORS. Endless: never final, boss never spawns
        this.isFinalFloor = (this.runMode === 'story') && (this.chapter >= TOTAL_FLOORS);
        this.isSubBossFloor = (this.runMode === 'endless') && (this.chapter > 0) && (this.chapter % 5 === 0);
        // Pick the biome for this floor
        this.biome = biomeForFloor(this.chapter);
        // Debug: ?biome=kitchen|library|garden|throne|dungeon renders that biome's art on any floor (screenshots)
        const dbgBiome = new URLSearchParams(window.location.search).get('biome');
        const dbgChapter = { dungeon: 1, kitchen: 2, library: 3, garden: 4, throne: 5 }[dbgBiome];
        if (dbgChapter) this.biome = biomeForFloor(dbgChapter);
    }

    preload() {
        // Sound set (samples + music loops) — Phaser skips keys already in the cache
        preloadAudio(this);
        // SVGs sized for on-screen scale 0.28-0.34 + ~2x DPR — bigger wastes texture memory on Android
        const base = 'assets/characters/transylvania/';
        this.load.svg('d_pi',       base + 'pi.svg',       { width: 150, height: 172 });
        this.load.svg('d_pi_walk1', base + 'pi-walk1.svg', { width: 150, height: 172 });
        this.load.svg('d_pi_walk2', base + 'pi-walk2.svg', { width: 150, height: 172 });
        // === Pi SKINS — nested under transylvania/skins (stand + walk1 + walk2 per skin) ===
        const skinBase = 'assets/characters/transylvania/skins/';
        const skinKeys = ['brown', 'pink', 'yellow-antler', 'robot', 'green-monster', 'shadow', 'devil', 'angel', 'yellow-lion'];
        for (const k of skinKeys) {
            const safeId = k.replace(/-/g, '_');
            this.load.svg('skin_' + safeId,          skinBase + k + '.svg',         { width: 150, height: 172 });
            this.load.svg('skin_' + safeId + '_w1',  skinBase + k + '-walk1.svg',   { width: 150, height: 172 });
            this.load.svg('skin_' + safeId + '_w2',  skinBase + k + '-walk2.svg',   { width: 150, height: 172 });
        }
        this.load.svg('d_zombie',   base + 'zombie.svg',   { width: 180, height: 210 });
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
        // Level art kit — everything at css × dpr so it is crisp under the camera zoom
        const dpr = window.__GAME_DPR || 1;
        for (const n of UI_ICON_NAMES) this.load.svg('ui_' + n, `assets/ui/${n}.svg`, { width: Math.round(64 * dpr), height: Math.round(64 * dpr) });
        for (const [key, file] of Object.entries(RELIC_SVGS)) this.load.svg(key, `assets/relics/${file}.svg`, { width: Math.round(64 * dpr), height: Math.round(64 * dpr) });
        this.tilePx = Math.round(NAV_CELL * dpr);
        this.load.svg('tiles_' + this.biome.id, `assets/tiles/${this.biome.id}.svg`, { width: TILES_PER_SHEET * this.tilePx, height: this.tilePx });
        for (const [key, [file, w, h]] of Object.entries(WORLD_SVGS)) {
            this.load.svg(key, `assets/world/${file}.svg`, { width: Math.round(w * dpr), height: Math.round(h * dpr) });
        }
    }

    create() {
        // A hit-stop setTimeout from the previous floor may have died with the
        // scene — never inherit a scaled clock (the Scene instance is reused).
        this.time.timeScale = 1;
        this.tweens.timeScale = 1;
        this._hitStopUntil = 0;
        this._hudLayout = null;
        this.dpr = window.__GAME_DPR || 1;
        this.tilePx = Math.round(NAV_CELL * this.dpr);
        // 3-frame flame sheet (loaded as one SVG) → frames f0..f2; global anim created once
        const fs = this.textures.get('flame_sheet');
        const fw = Math.floor(fs.source[0].width / 3), fh = fs.source[0].height;   // from the real raster size (exact for any dpr)
        for (let i = 0; i < 3; i++) if (!fs.has('f' + i)) fs.add('f' + i, 0, i * fw, 0, fw, fh);
        if (!this.anims.exists('torch_flame')) {
            this.anims.create({ key: 'torch_flame', frames: [0, 1, 2, 1].map((i) => ({ key: 'flame_sheet', frame: 'f' + i })), frameRate: 9, repeat: -1 });
        }
        // Phaser 3.70 ignores a config-level `resolution`; inject it per Text so HUD/overlay text rasterises at device px.
        // The factory persists across restarts (Scene instance reuse) — stash the original once.
        if (!this.add._origText) this.add._origText = this.add.text;
        const scene = this;
        this.add.text = function (x, y, text, style) {
            return scene.add._origText.call(this, x, y, text, Object.assign({}, style || {}, { resolution: scene.dpr }));
        };
        this.fxLayer = null;
        this.uiLayer = null;
        // Pools must not survive scene restart — the Scene instance is reused
        // and shutdown destroys all pooled display objects.
        this._circlePool = [];
        this._textPool = [];
        this.state = 'intro';
        this._bossIntroDone = false;
        this._shopReopen = false;
        this._hudHidden = false;
        this._touchWanted = false;
        this.score = 0;
        this.hasKey = false;
        this.walls = [];
        this.map = this.floorLayer = this.detailLayer = this.wallLayer = this.crackLayer = null;
        this.decorSprites = [];
        this.enemies = [];
        this.pickups = [];
        this.projectiles = [];
        this.powerups = [];
        this.chests = [];
        this.relicChests = [];
        this.forbiddenBooks = [];
        this.enemyBolts = [];
        this.ambientClouds = [];
        this.flourClouds = [];
        this.activePowerup = null;
        this.cheeseTotal = 0;
        this.cheeseGot = 0;
        // Combo state
        this._combo = 0;
        this._comboExpire = 0;
        this._stepDist = 0;

        this.dungeon = this.generateDungeon();
        this.computeRoomGoals();    // pick key/exit rooms BEFORE walls so pillars skip them
        this.buildWorld();
        this.spawnPlayer();
        this.spawnExitDoor();
        this.spawnKey();
        this.spawnEnemies();
        this.spawnCheese();
        this.spawnPowerups();
        // Per-floor stealth tooling
        this.distractionBooks = 3;
        this.runAlarmCount = this.runAlarmCount || 0;

        // === BIOME BGM — looping OGG (the procedural synth tanked fps to ~2 on Pixel 9a).
        // The same track across floors of one biome keeps playing: playBgm no-ops on the same key.
        try { window.audio?.setBiome?.(this.biome?.id || 'dungeon'); } catch (e) {}
        const bgmByBiome = { dungeon: BGM.DUNGEON, kitchen: BGM.KITCHEN, library: BGM.LIBRARY, garden: BGM.GARDEN, throne: BGM.THRONE };
        bus.emit(bgmByBiome[this.biome?.id] || BGM.DUNGEON);

        // KEYBOARD
        this.cursors = this.input.keyboard.createCursorKeys();
        this.keys = this.input.keyboard.addKeys('W,A,S,D,SPACE,R,ESC,Q,E,SHIFT,C,B');
        this.input.keyboard.on('keydown-R', () => {
            if ((this.state === 'won' || this.state === 'lost')
                && !this._pickerElements && !this._shopElements) this.scene.restart();
        });
        this.input.keyboard.on('keydown-ESC', () => {
            // Close modals first; only exit the run when nothing is open
            if (this._shopElements) { this.closeInRunShop?.(); return; }
            if (this._pickerElements) return;  // don't quit while picker is open
            this.exitToMenu();
        });
        this.input.keyboard.on('keydown-SHIFT', () => this.tryDash());
        this.input.keyboard.on('keydown-C', () => this.toggleCrouch());
        this.input.keyboard.on('keydown-B', () => this.throwDistractionBook());
        this.input.keyboard.on('keydown-Q', () => this.throwDistractionBook());

        // No click-to-shoot handler — shooting is hold-based, handled in updatePlayer

        // TOUCH CONTROLS — always set up when device supports touch.
        // Show by default only on real mobile devices; hide on laptops with trackpads.
        this._touchUsed = false;
        if (IS_TOUCH) {
            this.setupTouchControls();
            const isMobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
            this.setTouchUIVisible(false);
            this._touchWanted = isMobileUA;
            if (isMobileUA) this._touchUsed = true;
        }

        // Track whether user is currently using mouse vs touch + last mouse-move timestamp
        this._mouseMovedAt = 0;
        this.input.on('pointermove', (p) => {
            if (p.pointerType === 'touch' || p.event?.type === 'touchmove' || p.event?.type === 'touchstart') {
                this._touchUsed = true;
                if (this.state === 'play') {
                    if (this.joy) this.setTouchUIVisible(true);
                } else {
                    this._touchWanted = true;
                }
            } else {
                this._mouseMovedAt = this.time.now;
            }
        });
        this.input.on('pointerdown', (p) => {
            if (p.pointerType === 'touch' || p.event?.type === 'touchstart') {
                this._touchUsed = true;
                if (this.state === 'play') {
                    if (this.joy) this.setTouchUIVisible(true);
                } else {
                    this._touchWanted = true;
                }
            } else {
                this._mouseMovedAt = this.time.now;
            }
        });

        // CAMERA - pure black background (only carved dungeon visible)
        this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
        this._createFixedLayers();
        this.cameras.main.setZoom(this.dpr);
        // Phaser 3.70 Shake scales its offset by camera.width·zoom and the matrix scales it by zoom again → dpr² too strong.
        {
            const cam = this.cameras.main, k = 1 / (this.dpr * this.dpr), origShake = cam.shake;
            cam.shake = (duration, intensity, ...rest) => origShake.call(cam, duration, (intensity == null ? 0.05 : intensity) * k, ...rest);
        }
        this.cameras.main.setBackgroundColor(0x000000);
        this.cameras.main.startFollow(this.player.sprite, true, 0.10, 0.10);
        this.cameras.main.fadeIn(400, 0, 0, 0);

        // LIGHTING - dark overlay with light mask
        this.setupLighting();

        // CROSSHAIR — always set up; only updates when mouse is the active input
        this.setupCrosshair();

        // HUD
        this.buildHUD();
        this._setHudVisible(false);

        // TEMP perf overlay — enabled with ?fps=1 (Phase 1 measurement)
        this._fpsDebug = new URLSearchParams(window.location.search).get('fps') === '1';
        if (this._fpsDebug) {
            this._fpsText = this.add.text(8, 8, '', {
                fontFamily: 'monospace', fontSize: '16px', color: '#00ff80',
                backgroundColor: '#000000aa', padding: { x: 6, y: 3 }
            }).setScrollFactor(0).setDepth(LAYER.UI_DEBUG);
            this._fpsAccum = 0;
        }
        const onResize = () => this.repositionHUD();
        this.scale.on('resize', onResize);
        this.events.once('shutdown', () => this.scale.off('resize', onResize));
        this.events.once('shutdown', () => {
            if (this._hitStopTimeout) { clearTimeout(this._hitStopTimeout); this._hitStopTimeout = null; }
            if (this.map) { this.map.destroy(); this.map = null; }
        });

        // STORY INTRO
        this.showStoryIntro();
        this._pinFixed();
    }

    update(_time, dtMs) {
        if (this._fpsDebug) {
            this._fpsAccum = (this._fpsAccum || 0) + dtMs;
            if (this._fpsAccum > 500) {
                this._fpsAccum = 0;
                this._fpsText.setText(
                    'fps ' + this.game.loop.actualFps.toFixed(1) +
                    ' | enemies ' + (this.enemies ? this.enemies.length : 0) +
                    ' | tweens ' + this.tweens.getTweens().length
                );
            }
        }
        // Crosshair tracks mouse only when mouse was actually used (not on pure-touch sessions)
        this.updateCrosshair();
        this.updateLighting();
        if (this.state !== 'play') return;
        // Substep physics so low FPS doesn't make Pi crawl
        const totalDt = Math.min(dtMs, 200) / 1000;
        const MAX_STEP = 1 / 30;  // 33ms — physics runs at least 30fps internally
        let remaining = totalDt;
        while (remaining > 0) {
            const step = Math.min(remaining, MAX_STEP);
            this.updatePlayer(step);
            this.updateProjectiles(step);
            this.updateEnemies(step);
            this.handleCollisions(step);
            remaining -= step;
        }
        this.updateTorches(totalDt);
        this.updatePickupBob();
        this.updateBiomeParticles(totalDt);
        this.updateAmbientClouds(totalDt);
        this.updateKitchenHotpans(totalDt);
        this.updateGardenVines(totalDt);
        this.updateSnapdragons(totalDt);
        this.updateCandelabras(totalDt);
        this.updateSpookyEyes();
        if (this.dashBtnBase && this.dashBtnBase.visible) this.updateDashButton();
        this.updateHUD();
        if (this.player.hp <= 0) this.lose();
    }

    // =================================================================
    // LIGHTING — directional flashlight cone + soft ambient + torches
    // =================================================================
    setupLighting() {
        this.createLightTextures();

        // Reusable sprites for stamping lights into the RT
        this._radialLight = this.add.image(-9999, -9999, 'lightRadial')
            .setOrigin(0.5).setVisible(false);
        this._coneLight = this.add.image(-9999, -9999, 'lightCone')
            .setOrigin(0, 0.5).setVisible(false);

        // Camera-sized darkness RT (screen space). We fill it with the biome
        // darkness color and ERASE light shapes out of it each frame.
        // Replaces: world-sized 2600×1900 RT (~20 MB) + inverted BitmapMask
        // (2 extra full-screen passes per frame).
        const b = this.biome || { darknessColor: 0x080418, darknessAlpha: 0.78 };
        const cam = this.cameras.main;
        this._darknessColor = b.darknessColor;
        this.lightRT = this.add.renderTexture(0, 0, this.viewW, this.viewH)
            .setOrigin(0).setScrollFactor(0).setDepth(700);
        this.lightRT.setAlpha(b.darknessAlpha != null ? b.darknessAlpha : 0.78);

        // Player's aim angle (for cone direction) - initialized to right
        this.player.aimAngle = 0;
    }

    createLightTextures() {
        // RADIAL gradient — for torches and Pi's ambient halo (256x256 for perf)
        if (!this.textures.exists('lightRadial')) {
            const size = 256;
            const canvas = this.textures.createCanvas('lightRadial', size, size);
            const ctx = canvas.context;
            const cx = size / 2, cy = size / 2;
            const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx);
            grad.addColorStop(0,    'rgba(255, 255, 255, 1.0)');
            grad.addColorStop(0.35, 'rgba(255, 255, 255, 0.6)');
            grad.addColorStop(0.7,  'rgba(255, 255, 255, 0.2)');
            grad.addColorStop(1.0,  'rgba(255, 255, 255, 0.0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, size, size);
            canvas.refresh();
        }
        // CONE — wider flashlight beam (more spread), narrow at left, expanding right
        if (!this.textures.exists('lightCone')) {
            const w = 512, h = 480;  // h was 320 — much wider angle now
            const canvas = this.textures.createCanvas('lightCone', w, h);
            const ctx = canvas.context;
            const tipX = 24, tipY = h / 2;
            const grad = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, w - tipX);
            grad.addColorStop(0,    'rgba(255, 255, 255, 1.0)');
            grad.addColorStop(0.30, 'rgba(255, 255, 255, 0.85)');
            grad.addColorStop(0.60, 'rgba(255, 255, 255, 0.45)');
            grad.addColorStop(0.90, 'rgba(255, 255, 255, 0.10)');
            grad.addColorStop(1.0,  'rgba(255, 255, 255, 0.0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.moveTo(tipX, tipY);
            ctx.lineTo(w, 0);
            ctx.lineTo(w, h);
            ctx.closePath();
            ctx.fill();
            canvas.refresh();
        }
    }

    updateLighting() {
        if (!this.lightRT) return;
        const cam = this.cameras.main;
        const rt = this.lightRT;
        // Scale.RESIZE can change the canvas at any time (Android URL bar)
        if (rt.width !== this.viewW || rt.height !== this.viewH) {
            rt.resize(this.viewW, this.viewH);
        }
        rt.fill(this._darknessColor, 1);
        // Light positions are world − worldView = CSS px; the camera zoom (dpr) maps them to device px via fxLayer
        const ox = cam.midPoint.x - this.viewW / 2, oy = cam.midPoint.y - this.viewH / 2;
        const margin = 130;
        const inView = (x, y, r) =>
            x + r + margin >= ox && x - r - margin <= ox + this.viewW &&
            y + r + margin >= oy && y - r - margin <= oy + this.viewH;

        rt.beginDraw();

        // 1. Pi's directional flashlight cone
        const flicker = 1 + Math.sin(this.time.now * 0.012) * 0.04 + (Math.random() - 0.5) * 0.03;
        const coneLen = 620 * flicker;
        const coneH = 480 * (coneLen / 512);
        this._coneLight.setPosition(this.player.x - ox, this.player.y - oy);
        this._coneLight.setRotation(this.player.aimAngle || 0);
        this._coneLight.setScale(coneLen / 512, coneH / 480);
        rt.batchDraw(this._coneLight);

        // 2. Ambient halo around Pi
        const haloFlicker = 1 + Math.sin(this.time.now * 0.015 + 1.3) * 0.06;
        this._radialLight.setPosition(this.player.x - ox, this.player.y - oy);
        this._radialLight.setScale((220 * haloFlicker) / 256);
        rt.batchDraw(this._radialLight);

        // 3. Torches in view
        for (const t of this.torches) {
            if (!t.lit) continue;
            if (!inView(t.x, t.y, t.baseRadius)) continue;
            const tf = 1 + Math.sin(this.time.now * 0.014 + t.flickerPhase) * 0.10
                         + Math.cos(this.time.now * 0.022 + t.flickerPhase) * 0.05;
            const r = t.baseRadius * tf;
            this._radialLight.setPosition(t.x - ox, t.y - oy);
            this._radialLight.setScale((r * 2) / 256);
            rt.batchDraw(this._radialLight);
        }

        // 4. Exit door + key quest markers
        if (this.exit && inView(this.exit.x, this.exit.y, 90)) {
            this._radialLight.setPosition(this.exit.x - ox, this.exit.y - oy).setScale(180 / 256);
            rt.batchDraw(this._radialLight);
        }
        if (this.keyPickup && !this.keyPickup.taken &&
            inView(this.keyPickup.x, this.keyPickup.y, 85)) {
            this._radialLight.setPosition(this.keyPickup.x - ox, this.keyPickup.y - oy).setScale(170 / 256);
            rt.batchDraw(this._radialLight);
        }

        rt.endDraw(true);
    }

    updateTorches(dt) {
        for (const t of this.torches) {
            if (!t.lit) continue;
            if (Math.random() < 0.0008 / Math.max(1, this.torches.length)) this.extinguishTorch(t);
        }
    }

    updatePickupBob() {
        // Replaces per-pickup infinite tweens: one pass, view-culled, sin-driven
        const cam = this.cameras.main;
        const L = cam.worldView.x - 60, R = cam.worldView.x + this.viewW + 60;
        const T = cam.worldView.y - 60, B = cam.worldView.y + this.viewH + 60;
        const t = this.time.now;
        for (const pk of this.pickups) {
            if (pk.taken) continue;
            if (pk.x < L || pk.x > R || pk.y < T || pk.y > B) continue;
            const s = Math.sin(t * (pk.heart ? 0.0045 : 0.0035) + (pk.bobPhase || 0));
            pk.sprite.y = pk.y - (pk.heart ? 4 + s * 4 : 3 + s * 3);
            if (pk.glow) {
                pk.glow.setAlpha(pk.heart ? 0.165 + 0.085 * s : 0.095 + 0.055 * s);
                if (pk.heart) pk.glow.setScale(1.15 + 0.15 * s);
            }
        }
        const k = this.keyPickup;
        if (k && !k.taken && k.x >= L && k.x <= R && k.y >= T && k.y <= B) {
            const s = Math.sin(t * 0.0031 + (k.bobPhase || 0));
            k.sprite.y = k.y - 3 - s * 3;
            k.sprite.setAngle(4 + s * 4);
            k.glow.setScale(1.1 + 0.1 * s);
            k.glow.setAlpha(0.14 + 0.08 * s);
        }
        const ex = this.exit;
        if (ex && ex.glow && !(ex.glowHoldUntil > t) && ex.x >= L && ex.x <= R && ex.y >= T && ex.y <= B) {
            const s = Math.sin(t * 0.0022);
            ex.glow.setScale(1.15 + 0.15 * s);
            ex.glow.setAlpha(0.125 + 0.055 * s);
        }
    }

    extinguishTorch(torch) {
        torch.lit = false;
        if (torch.flame) torch.flame.setVisible(false);
        // Smoke puff — skip when off-screen
        const cam = this.cameras.main;
        const margin = 100;
        if (torch.x < cam.worldView.x - margin || torch.x > cam.worldView.x + this.viewW + margin ||
            torch.y < cam.worldView.y - margin || torch.y > cam.worldView.y + this.viewH + margin) return;
        for (let i = 0; i < 8; i++) {
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI;
            const sp = Phaser.Math.Between(20, 50);
            const p = this.add.circle(torch.x, torch.y - 10, Phaser.Math.Between(2, 5), 0x808090, 0.6).setDepth(82);
            this.tweens.add({
                targets: p,
                x: torch.x + Math.cos(angle) * sp,
                y: torch.y - 10 + Math.sin(angle) * sp - 30,
                alpha: 0, scale: 1.5,
                duration: 700, ease: 'Quad.easeOut',
                onComplete: () => p.destroy()
            });
        }
    }

    // =================================================================
    // DUNGEON GENERATION — different algorithm per biome
    // =================================================================
    generateDungeon() {
        const id = this.biome?.id || 'dungeon';
        // Each biome has its own architectural personality
        if (id === 'library') return this.generateLibrary();
        if (id === 'kitchen') return this.generateKitchen();
        if (id === 'garden')  return this.generateGarden();
        if (id === 'throne')  return this.generateThrone();
        return this.generateDefaultDungeon();   // floor 1 — random rooms
    }

    // === DEFAULT (Подземелье): random rooms + MST corridors ===
    generateDefaultDungeon() {
        const cfg = (this.biome && this.biome.roomConfig) || { targetCount: 12, minSize: 200, maxSize: 400, pad: 80 };
        const rooms = [];
        const MIN_S = cfg.minSize;
        const MAX_S = cfg.maxSize;
        const PAD = cfg.pad;
        const TARGET = cfg.targetCount;
        const MAX_ATTEMPTS = 500;
        const MARGIN = 80;

        for (let attempt = 0; attempt < MAX_ATTEMPTS && rooms.length < TARGET; attempt++) {
            const w = Phaser.Math.Between(MIN_S, MAX_S);
            const h = Phaser.Math.Between(MIN_S, MAX_S);
            const x = Phaser.Math.Between(MARGIN, WORLD_W - MARGIN - w);
            const y = Phaser.Math.Between(MARGIN, WORLD_H - MARGIN - h);
            const collides = rooms.some(r =>
                x < r.x + r.w + PAD && x + w + PAD > r.x &&
                y < r.y + r.h + PAD && y + h + PAD > r.y
            );
            if (!collides) rooms.push({ x, y, w, h, id: rooms.length });
        }

        // MST connecting all rooms (Prim's)
        const corridors = [];
        const connected = new Set([0]);
        while (connected.size < rooms.length) {
            let best = null;
            for (const i of connected) {
                for (let j = 0; j < rooms.length; j++) {
                    if (connected.has(j)) continue;
                    const ax = rooms[i].x + rooms[i].w/2;
                    const ay = rooms[i].y + rooms[i].h/2;
                    const bx = rooms[j].x + rooms[j].w/2;
                    const by = rooms[j].y + rooms[j].h/2;
                    const d = Math.abs(ax - bx) + Math.abs(ay - by); // Manhattan
                    if (!best || d < best.d) best = { from: i, to: j, d };
                }
            }
            if (!best) break;
            corridors.push({ from: best.from, to: best.to });
            connected.add(best.to);
        }
        // Extra connections for loops (avoid dead-end gameplay)
        const extras = Math.min(3, Math.floor(rooms.length * 0.25));
        for (let i = 0; i < extras; i++) {
            const a = Phaser.Math.Between(0, rooms.length - 1);
            let b = Phaser.Math.Between(0, rooms.length - 1);
            if (a !== b && !corridors.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a))) {
                corridors.push({ from: a, to: b });
            }
        }

        return { rooms, corridors };
    }

    // === LIBRARY — parallel bookshelf aisles (long thin rooms in rows) ===
    generateLibrary() {
        const rooms = [];
        const corridors = [];
        // 3 rows × 4 columns of long thin rooms
        const ROWS = 3, COLS = 4;
        const ROOM_W = Math.floor((WORLD_W - 200) / COLS) - 20;
        const ROOM_H = 220;
        const VGAP = 180;   // tall vertical gap between rows
        const HGAP = 30;    // small horizontal gap = thin bookshelves
        const startX = 100;
        const startY = (WORLD_H - (ROWS * ROOM_H + (ROWS - 1) * VGAP)) / 2;
        // Build the grid of long-shape rooms
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                rooms.push({
                    x: startX + c * (ROOM_W + HGAP),
                    y: startY + r * (ROOM_H + VGAP),
                    w: ROOM_W, h: ROOM_H, id: rooms.length
                });
            }
        }
        // Connect: horizontal neighbours (within row) + vertical connectors at ends
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS - 1; c++) {
                corridors.push({ from: r * COLS + c, to: r * COLS + c + 1 });
            }
        }
        for (let r = 0; r < ROWS - 1; r++) {
            // Connect rows at left and right ends to form 'aisles'
            corridors.push({ from: r * COLS,             to: (r + 1) * COLS });
            corridors.push({ from: r * COLS + COLS - 1,  to: (r + 1) * COLS + COLS - 1 });
        }
        return { rooms, corridors };
    }

    // === KITCHEN — long horizontal cooking halls ===
    generateKitchen() {
        // HUB-AND-SPOKE: cooking-hub center + 4 themed alcoves (Pantry/Stove/Wash/Cellar)
        // + perimeter servant corridor connecting alcoves. ~10 rooms total.
        const rooms = [];
        const corridors = [];

        // Central cooking hub
        const hubW = 560, hubH = 440;
        const hubX = (WORLD_W - hubW) / 2;
        const hubY = (WORLD_H - hubH) / 2;
        rooms.push({ x: hubX, y: hubY, w: hubW, h: hubH, id: 0, kind: 'hub' });

        // 4 alcoves (N/S/E/W of hub)
        const alcoveW = 380, alcoveH = 320;
        // Pantry — north of hub (top), shifted slightly left
        rooms.push({
            x: hubX + hubW * 0.10, y: hubY - alcoveH - 130,
            w: alcoveW, h: alcoveH, id: 1, kind: 'pantry'
        });
        // Stove Row — east of hub (right)
        rooms.push({
            x: hubX + hubW + 130, y: hubY + hubH * 0.10,
            w: alcoveW, h: alcoveH, id: 2, kind: 'stove'
        });
        // Pot Wash — south of hub (bottom)
        rooms.push({
            x: hubX + hubW * 0.45 - alcoveW / 2 + alcoveW * 0.50,
            y: hubY + hubH + 130,
            w: alcoveW, h: alcoveH, id: 3, kind: 'wash'
        });
        // Cold Cellar — west of hub (left)
        rooms.push({
            x: hubX - alcoveW - 130, y: hubY + hubH * 0.30,
            w: alcoveW, h: alcoveH, id: 4, kind: 'cellar'
        });

        // 4 perimeter servant corridors — small rooms between alcoves for loop
        const sW = 240, sH = 200;
        rooms.push({ x: hubX + hubW + 70, y: hubY - sH - 60, w: sW, h: sH, id: 5, kind: 'corridor' });  // NE
        rooms.push({ x: hubX + hubW + 70, y: hubY + hubH + 60, w: sW, h: sH, id: 6, kind: 'corridor' }); // SE
        rooms.push({ x: hubX - sW - 70, y: hubY + hubH + 60, w: sW, h: sH, id: 7, kind: 'corridor' });   // SW
        rooms.push({ x: hubX - sW - 70, y: hubY - sH - 60, w: sW, h: sH, id: 8, kind: 'corridor' });     // NW

        // Spokes: hub connects to all 4 alcoves
        corridors.push({ from: 0, to: 1 });
        corridors.push({ from: 0, to: 2 });
        corridors.push({ from: 0, to: 3 });
        corridors.push({ from: 0, to: 4 });
        // Perimeter loop: NE corridor links pantry+stove, SE links stove+wash, etc.
        corridors.push({ from: 1, to: 5 });
        corridors.push({ from: 5, to: 2 });
        corridors.push({ from: 2, to: 6 });
        corridors.push({ from: 6, to: 3 });
        corridors.push({ from: 3, to: 7 });
        corridors.push({ from: 7, to: 4 });
        corridors.push({ from: 4, to: 8 });
        corridors.push({ from: 8, to: 1 });

        return { rooms, corridors };
    }

    // === GARDEN — few huge open rooms ===
    generateGarden() {
        const rooms = [];
        const corridors = [];
        const positions = [
            // Center-cross layout
            { x: WORLD_W * 0.5,  y: WORLD_H * 0.5,  w: 520, h: 520 },     // central plaza
            { x: WORLD_W * 0.18, y: WORLD_H * 0.5,  w: 380, h: 380 },     // left garden
            { x: WORLD_W * 0.82, y: WORLD_H * 0.5,  w: 380, h: 380 },     // right garden
            { x: WORLD_W * 0.5,  y: WORLD_H * 0.18, w: 380, h: 380 },     // top garden
            { x: WORLD_W * 0.5,  y: WORLD_H * 0.82, w: 380, h: 380 }      // bottom garden
        ];
        for (const p of positions) {
            rooms.push({ x: p.x - p.w/2, y: p.y - p.h/2, w: p.w, h: p.h, id: rooms.length });
        }
        // Spoke layout: center (0) connects to all
        for (let i = 1; i < rooms.length; i++) corridors.push({ from: 0, to: i });
        // Add 1-2 outer connections for loops
        corridors.push({ from: 1, to: 3 });
        corridors.push({ from: 2, to: 4 });
        return { rooms, corridors };
    }

    // === THRONE — entrance + corridor + huge boss arena ===
    generateThrone() {
        const rooms = [];
        const corridors = [];
        // Entrance (small)
        rooms.push({ x: 200, y: WORLD_H / 2 - 180, w: 320, h: 360, id: 0 });
        // Antechamber (medium)
        rooms.push({ x: 700, y: WORLD_H / 2 - 220, w: 380, h: 440, id: 1 });
        // Throne arena (HUGE — for boss + grandma)
        rooms.push({ x: WORLD_W - 1100, y: WORLD_H / 2 - 380, w: 900, h: 760, id: 2 });
        // Side alcoves for stealth/key
        rooms.push({ x: 700, y: 200, w: 300, h: 280, id: 3 });
        rooms.push({ x: 700, y: WORLD_H - 480, w: 300, h: 280, id: 4 });
        // Connections: entrance → antechamber → arena, alcoves off the antechamber
        corridors.push({ from: 0, to: 1 });
        corridors.push({ from: 1, to: 2 });
        corridors.push({ from: 1, to: 3 });
        corridors.push({ from: 1, to: 4 });
        return { rooms, corridors };
    }

    // =================================================================
    // BUILD WORLD — carve grid, build wall rects, draw decorations
    // =================================================================
    buildWorld() {
        // Build nav grid FIRST: 'wall' everywhere, then carve floor for rooms + corridors
        const grid = Array.from({ length: NAV_H }, () => Array(NAV_W).fill('wall'));

        // Carve rooms (inset by 1 cell to keep wall border)
        for (const room of this.dungeon.rooms) {
            const sC = Math.floor(room.x / NAV_CELL);
            const sR = Math.floor(room.y / NAV_CELL);
            const eC = Math.min(NAV_W, Math.ceil((room.x + room.w) / NAV_CELL));
            const eR = Math.min(NAV_H, Math.ceil((room.y + room.h) / NAV_CELL));
            for (let r = sR; r < eR; r++) {
                for (let c = sC; c < eC; c++) {
                    if (r >= 0 && r < NAV_H && c >= 0 && c < NAV_W) grid[r][c] = 'floor';
                }
            }
        }

        // Determine exit room (farthest from start by graph distance) so its corridors can be wider
        const rdists = this.roomDistancesEarly();
        let exitRoomIdx = 0, maxD = -1;
        for (let i = 1; i < this.dungeon.rooms.length; i++) {
            if ((rdists[i] ?? -1) > maxD) { maxD = rdists[i]; exitRoomIdx = i; }
        }

        // Carve corridors (L-shaped path between room centers)
        for (const cor of this.dungeon.corridors) {
            const a = this.dungeon.rooms[cor.from];
            const b = this.dungeon.rooms[cor.to];
            const ax = Math.floor((a.x + a.w/2) / NAV_CELL);
            const ay = Math.floor((a.y + a.h/2) / NAV_CELL);
            const bx = Math.floor((b.x + b.w/2) / NAV_CELL);
            const by = Math.floor((b.y + b.h/2) / NAV_CELL);
            // Wider corridor if this leads to/from the boss room
            const isBossCorridor = (cor.from === exitRoomIdx || cor.to === exitRoomIdx);
            const corW = isBossCorridor ? COR_W_BOSS : COR_W_NORMAL;
            const bendFirstHorizontal = Math.random() < 0.5;
            if (bendFirstHorizontal) {
                this.carveStrip(grid, Math.min(ax, bx), Math.max(ax, bx), ay, 'h', corW);
                this.carveStrip(grid, Math.min(ay, by), Math.max(ay, by), bx, 'v', corW);
            } else {
                this.carveStrip(grid, Math.min(ay, by), Math.max(ay, by), ax, 'v', corW);
                this.carveStrip(grid, Math.min(ax, bx), Math.max(ax, bx), by, 'h', corW);
            }
        }

        // Add interior obstacles in large rooms (pillars) — skip critical rooms.
        for (let roomIdx = 0; roomIdx < this.dungeon.rooms.length; roomIdx++) {
            if (roomIdx === 0) continue;
            if (roomIdx === this.keyRoomIdx) continue;
            if (roomIdx === this.exitRoomIdx) continue;
            if (this.stealthRoomIdxs?.includes(roomIdx)) continue;   // need open floor for patrol
            const room = this.dungeon.rooms[roomIdx];
            if (room.w >= 300 && room.h >= 300) {
                const obstacleCount = Phaser.Math.Between(1, 3);
                for (let i = 0; i < obstacleCount; i++) {
                    const ow = Phaser.Math.Between(2, 3);
                    const oh = Phaser.Math.Between(2, 3);
                    const ox = Math.floor((room.x + Phaser.Math.Between(60, room.w - 60 - ow * NAV_CELL)) / NAV_CELL);
                    const oy = Math.floor((room.y + Phaser.Math.Between(60, room.h - 60 - oh * NAV_CELL)) / NAV_CELL);
                    for (let r = oy; r < oy + oh; r++) {
                        for (let c = ox; c < ox + ow; c++) {
                            if (r < NAV_H && c < NAV_W) grid[r][c] = 'wall';
                        }
                    }
                }
            }
        }

        this.navGrid = grid;
        // Build clearance map AFTER all walls (including pillars) are in place
        this.buildClearanceMap();

        // Spatial hash bucket size for fast wall queries
        this._hashCell = 120;
        this.spatialHash = new Map();

        // Floor + walls tilemap ONLY where carved (rest stays black void)
        this.buildTilemap();

        // Add wall rectangles ONLY for border walls (touching at least one floor cell)
        for (let r = 0; r < NAV_H; r++) {
            let c = 0;
            while (c < NAV_W) {
                if (grid[r][c] === 'wall' && this.isBorderWall(r, c)) {
                    const startC = c;
                    while (c < NAV_W && grid[r][c] === 'wall' && this.isBorderWall(r, c)) c++;
                    const x = startC * NAV_CELL;
                    const y = r * NAV_CELL;
                    const w = (c - startC) * NAV_CELL;
                    this.addWall(x, y, w, NAV_CELL);
                } else c++;
            }
        }

        // Biome mechanic tiles (butter / vines / …) — after walls so their pointInWalls checks are real
        this.spawnBiomeTiles();

        // Random torches per room (some lit, some unlit)
        this.placeRandomTorches();
        // SPOOKY eyes in dark corners — they fade when Pi approaches
        this.placeSpookyEyes();
    }

    placeSpookyEyes() {
        this.spookyEyes = [];
        const count = Phaser.Math.Between(6, 10);
        let attempts = 0;
        while (this.spookyEyes.length < count && attempts < 60) {
            attempts++;
            const roomIdx = Phaser.Math.Between(1, this.dungeon.rooms.length - 1);
            if (roomIdx === this.exitRoomIdx) continue;
            const room = this.dungeon.rooms[roomIdx];
            // Stick close to walls in dark corners
            const side = Phaser.Math.Between(0, 3);
            let x, y;
            if (side === 0) { x = room.x + Phaser.Math.Between(40, room.w - 40); y = room.y + 30; }
            else if (side === 1) { x = room.x + Phaser.Math.Between(40, room.w - 40); y = room.y + room.h - 30; }
            else if (side === 2) { x = room.x + 30; y = room.y + Phaser.Math.Between(40, room.h - 40); }
            else { x = room.x + room.w - 30; y = room.y + Phaser.Math.Between(40, room.h - 40); }
            if (this.pointInWalls(x, y, 18)) continue;
            // Two glowing yellow eyes
            const c1 = this.add.circle(x - 5, y, 2.5, 0xffd040, 0.9).setDepth(LAYER.EYES);
            const c2 = this.add.circle(x + 5, y, 2.5, 0xffd040, 0.9).setDepth(LAYER.EYES);
            // Blink animation
            this.tweens.add({
                targets: [c1, c2], alpha: 0.2,
                duration: Phaser.Math.Between(2000, 4000),
                yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
                delay: Math.random() * 2000
            });
            this.spookyEyes.push({ c1, c2, x, y, hidden: false });
        }
    }

    updateSpookyEyes() {
        if (!this.spookyEyes) return;
        const HIDE_DIST = 150;
        for (const e of this.spookyEyes) {
            const d = Math.hypot(e.x - this.player.x, e.y - this.player.y);
            const shouldHide = d < HIDE_DIST;
            if (shouldHide && !e.hidden) {
                e.hidden = true;
                this.tweens.add({ targets: [e.c1, e.c2], alpha: 0, duration: 250 });
            } else if (!shouldHide && e.hidden) {
                e.hidden = false;
                this.tweens.add({ targets: [e.c1, e.c2], alpha: 0.7, duration: 600 });
            }
        }
    }

    isBorderWall(r, c) {
        if (this.navGrid[r][c] !== 'wall') return false;
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < NAV_H && nc >= 0 && nc < NAV_W && this.navGrid[nr][nc] === 'floor') return true;
        }
        return false;
    }

    carveStrip(grid, start, end, fixed, dir, width) {
        const w = width || COR_W_NORMAL;
        const halfBack = Math.floor(w / 2);
        for (let i = start; i <= end; i++) {
            for (let off = -halfBack; off < w - halfBack; off++) {
                let r, c;
                if (dir === 'h') { r = fixed + off; c = i; }
                else { r = i; c = fixed + off; }
                if (r >= 0 && r < NAV_H && c >= 0 && c < NAV_W) grid[r][c] = 'floor';
            }
        }
    }

    // Early BFS-like distance estimate before exit door is computed
    roomDistancesEarly() {
        const graph = {};
        for (const c of this.dungeon.corridors) {
            (graph[c.from] = graph[c.from] || []).push(c.to);
            (graph[c.to] = graph[c.to] || []).push(c.from);
        }
        const d = { 0: 0 };
        const q = [0];
        while (q.length) {
            const r = q.shift();
            for (const n of (graph[r] || [])) {
                if (d[n] === undefined) { d[n] = d[r] + 1; q.push(n); }
            }
        }
        return d;
    }

    // Floor + walls as a Tilemap built from the biome tileset (see tools/gen_tiles.py for indices)
    buildTilemap() {
        const grid = this.navGrid, tp = this.tilePx;
        const map = this.make.tilemap({ tileWidth: tp, tileHeight: tp, width: NAV_W, height: NAV_H });
        const tileset = map.addTilesetImage('tiles', 'tiles_' + this.biome.id, tp, tp, 0, 0);
        const sc = NAV_CELL / tp;
        const mk = (name, depth) => map.createBlankLayer(name, tileset, 0, 0).setDepth(depth).setScale(sc);
        this.map = map;
        this.floorLayer = mk('floor', LAYER.WORLD);
        this.detailLayer = mk('detail', LAYER.WORLD + 5);
        this.wallLayer = mk('walls', LAYER.WALL_TILES);
        this.crackLayer = mk('cracks', LAYER.WALL_TILES + 1);
        const floor = [], detail = [], walls = [];
        for (let r = 0; r < NAV_H; r++) {
            const fr = [], dr = [], wr = [];
            for (let c = 0; c < NAV_W; c++) {
                if (grid[r][c] === 'floor') {
                    fr.push(this.plateTile(r, c));
                    const roll = Math.random();
                    dr.push(roll < 0.04 ? TILE.CRACK : roll < 0.06 ? TILE.PEBBLES : -1);
                    wr.push(-1);
                } else if (grid[r][c] === 'wall' && this.isBorderWall(r, c)) {
                    fr.push(-1); dr.push(-1);
                    wr.push(this.wallTile(r, c));
                } else if (grid[r][c] === 'wall' && this._isInsideRoom(r, c)) {
                    fr.push(-1); dr.push(-1);
                    wr.push(TILE.WALL);      // pillar interior — plain brick, never a black hole
                } else { fr.push(-1); dr.push(-1); wr.push(-1); }
            }
            floor.push(fr); detail.push(dr); walls.push(wr);
        }
        this.floorLayer.putTilesAt(floor, 0, 0, false);
        this.detailLayer.putTilesAt(detail, 0, 0, false);
        this.wallLayer.putTilesAt(walls, 0, 0, false);
    }
    plateTile(r, c) {
        return (((r >> 1) + (c >> 1)) & 1 ? TILE.PLATE_B : TILE.PLATE_A) + (r & 1) * 2 + (c & 1);
    }
    wallTile(r, c) {
        const grid = this.navGrid;
        const wallAbove = grid[r - 1]?.[c] === 'wall' && this.isBorderWall(r - 1, c);
        const floorBelow = grid[r + 1]?.[c] === 'floor';
        return TILE.WALL + (wallAbove ? 0 : 1) + (floorBelow ? 2 : 0);
    }
    // True for a wall cell whose centre lies inside a room rect (pillar interiors)
    _isInsideRoom(r, c) {
        const x = c * NAV_CELL + NAV_CELL / 2, y = r * NAV_CELL + NAV_CELL / 2;
        return this.dungeon.rooms.some((rm) => x > rm.x && x < rm.x + rm.w && y > rm.y && y < rm.y + rm.h);
    }

    spawnBiomeTiles() {
        this.biomeTiles = [];
        const m = this.biome.mechanic;
        const h = this.biome.hazardTile;
        if (m && m !== 'dark') {
            this.placeBiomeTilesOfType(m, Phaser.Math.Between(4, 8), 36, 56);
        }
        if (h) {
            this.placeBiomeTilesOfType(h, Phaser.Math.Between(3, 5), 28, 40);
        }
        // KITCHEN biome props — flour sacks (shootable) + hanging pots
        if (this.biome?.id === 'kitchen') {
            this.spawnKitchenProps();
        }
        // GARDEN — initialize vines for growth
        if (this.biome?.id === 'garden') {
            this.spawnGardenVines();
        }
        // THRONE — place 4 candelabras in boss room
        if (this.biome?.id === 'throne') {
            this.spawnCandelabras();
        }
        this.spawnBiomeParticles();
    }

    spawnKitchenProps() {
        this.flourSacks = [];
        this.hangingPots = [];
        const rooms = this.dungeon.rooms;
        // 4-6 flour sacks across alcove/corridor rooms (skip exit)
        for (let i = 1; i < rooms.length; i++) {
            if (i === this.exitRoomIdx) continue;
            const room = rooms[i];
            const sacks = (room.kind === 'pantry') ? 3 : (Math.random() < 0.5 ? 1 : 0);
            for (let j = 0; j < sacks; j++) {
                let tries = 12;
                while (tries-- > 0) {
                    const x = room.x + Phaser.Math.Between(60, room.w - 60);
                    const y = room.y + Phaser.Math.Between(60, room.h - 60);
                    if (this.pointInWalls(x, y, 26)) continue;
                    this.spawnFlourSack(x, y);
                    break;
                }
            }
            // Hanging pots — only in hub/stove rooms
            if (room.kind === 'hub' || room.kind === 'stove') {
                const pots = (room.kind === 'stove') ? 3 : 2;
                for (let j = 0; j < pots; j++) {
                    let tries = 12;
                    while (tries-- > 0) {
                        const x = room.x + Phaser.Math.Between(80, room.w - 80);
                        const y = room.y + Phaser.Math.Between(80, room.h - 80);
                        if (this.pointInWalls(x, y, 22)) continue;
                        this.spawnHangingPot(x, y);
                        break;
                    }
                }
            }
        }
    }

    spawnFlourSack(x, y) {
        const sprite = this._worldImage(x, y, 'sack_flour', 145, 0.5, 0.85);
        // small idle shake
        this.tweens.add({ targets: sprite, angle: 4, duration: 1400,
            yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.flourSacks.push({ sprite, x, y, broken: false, hp: 1 });
    }

    spawnHangingPot(x, y) {
        const chain = this._worldImage(x, y - 54, 'chain', 75, 0.5, 0);
        const sprite = this._worldImage(x, y, 'pot_hanging', 75, 0.5, 0.2);
        this.tweens.add({ targets: sprite, x: x + 1, duration: 1800,
            yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.hangingPots.push({ sprite, chain, x, y, dropped: false });
    }

    breakFlourSack(sack) {
        sack.broken = true;
        // Visual cloud
        const cloudGfx = this.add.graphics().setDepth(85);
        const drawCloud = (alpha) => {
            cloudGfx.clear();
            cloudGfx.fillStyle(0xfff0e0, alpha);
            cloudGfx.fillCircle(sack.x, sack.y, 110);
            cloudGfx.fillStyle(0xffffff, alpha * 0.6);
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * Math.PI * 2;
                cloudGfx.fillCircle(sack.x + Math.cos(a) * 50, sack.y + Math.sin(a) * 50, 36);
            }
        };
        drawCloud(0.7);
        this.tweens.add({
            targets: { v: 0.7 }, v: 0, duration: 3500,
            onUpdate: (tw, tgt) => drawCloud(tgt.v),
            onComplete: () => cloudGfx.destroy()
        });
        this.tweens.add({
            targets: sack.sprite, scale: 1.4 / this.dpr, alpha: 0,
            duration: 300, onComplete: () => sack.sprite.destroy()
        });
        // Track cloud — blind cone enemies inside (no detection during cloud)
        this.flourClouds = this.flourClouds || [];
        const cloud = { x: sack.x, y: sack.y, radius: 110, endTime: this.time.now + 3500 };
        this.flourClouds.push(cloud);
        this.showFloatingText(sack.x, sack.y - 30, '💨 Облако муки!', '#fff0e0', 18);
        bus.emit(SFX.HIT_ENEMY);
    }

    dropHangingPot(pot) {
        pot.dropped = true;
        pot.chain.destroy();
        const startY = pot.y;
        const groundY = pot.y + 12;
        this.tweens.add({
            targets: pot.sprite, y: groundY, duration: 350, ease: 'Quad.easeIn',
            onComplete: () => {
                // AoE damage 50px
                this.poofAt(pot.sprite.x, pot.sprite.y, 0xc08040);
                this.cameras.main.shake(140, 0.008);
                for (const e of this.enemies) {
                    if (e.dead) continue;
                    if (Math.hypot(e.x - pot.sprite.x, e.y - pot.sprite.y) < 50) {
                        this.damageEnemy(e, 2, e.x - pot.sprite.x, e.y - pot.sprite.y);
                    }
                }
                this.tweens.add({
                    targets: pot.sprite, alpha: 0, duration: 500,
                    onComplete: () => pot.sprite.destroy()
                });
            }
        });
        bus.emit(SFX.HIT_ENEMY);
    }

    placeBiomeTilesOfType(type, count, minR, maxR) {
        let attempts = 0;
        let placed = 0;
        while (placed < count && attempts < 100) {
            attempts++;
            const roomIdx = Phaser.Math.Between(1, this.dungeon.rooms.length - 1);
            if (roomIdx === this.exitRoomIdx) continue;
            if (roomIdx === this.keyRoomIdx && type !== 'butter' && type !== 'vines') continue;
            const room = this.dungeon.rooms[roomIdx];
            const x = room.x + Phaser.Math.Between(80, room.w - 80);
            const y = room.y + Phaser.Math.Between(80, room.h - 80);
            if (this.pointInWalls(x, y, 45)) continue;
            const radius = Phaser.Math.Between(minR, maxR);
            const tile = { x, y, radius, type };
            // KITCHEN hotpan — start in cold phase with staggered timer
            if (type === 'hotpan') {
                tile.phase = 'cold';
                tile.phaseTimer = Math.random() * 2000;   // stagger so they don't all flame at once
            }
            this.biomeTiles.push(tile);
            this.drawBiomeTile(x, y, radius, type, tile);
            placed++;
        }
    }

    // ==== GARDEN: growing vines + snapdragon bite-telegraph ====
    spawnGardenVines() {
        if (this.biome?.id !== 'garden') return;
        this.growingVines = (this.biomeTiles || []).filter(t => t.type === 'vines');
        this._vineGrowthTimer = 5500;
        this._vineCap = 18;
    }

    updateGardenVines(dt) {
        if (this.biome?.id !== 'garden' || !this.growingVines) return;
        this._vineGrowthTimer -= dt * 1000;
        if (this._vineGrowthTimer > 0) return;
        this._vineGrowthTimer = 5500;
        // Each existing vine has 35% chance to spawn an adjacent vine, cap 18 total
        if (this.growingVines.length >= this._vineCap) return;
        const newVines = [];
        for (const v of this.growingVines) {
            if (this.growingVines.length + newVines.length >= this._vineCap) break;
            if (Math.random() > 0.35) continue;
            const angle = Math.random() * Math.PI * 2;
            const dist = 60 + Math.random() * 30;
            const nx = v.x + Math.cos(angle) * dist;
            const ny = v.y + Math.sin(angle) * dist;
            if (this.pointInWalls(nx, ny, 30)) continue;
            const tile = { x: nx, y: ny, radius: 40, type: 'vines' };
            this.biomeTiles.push(tile);
            this.drawBiomeTile(nx, ny, 40, 'vines', tile);
            newVines.push(tile);
        }
        this.growingVines.push(...newVines);
    }

    updateSnapdragons(dt) {
        if (this.biome?.id !== 'garden' || !this.enemies) return;
        const dtMs = dt * 1000;
        for (const e of this.enemies) {
            if (e.dead || e.kind !== 'snapdragon') continue;
            const dx = this.player.x - e.x;
            const dy = this.player.y - e.y;
            const dist = Math.hypot(dx, dy);
            const biteRange = e.def.biteRange || 80;
            const inRange = dist < biteRange;
            // Cool down between bites
            e._biteCdTimer = (e._biteCdTimer || 0) - dtMs;
            if (e._biteState === 'wind') {
                e._biteTimer -= dtMs;
                if (e._biteTimer <= 0) {
                    // Execute bite — damage in arc
                    e._biteState = 'idle';
                    e._biteCdTimer = 1500;
                    if (inRange) {
                        const ang = Math.atan2(dy, dx);
                        let delta = ang - e.facingAngle;
                        while (delta > Math.PI) delta -= Math.PI * 2;
                        while (delta < -Math.PI) delta += Math.PI * 2;
                        const arc = e.def.biteArc || Math.PI / 2;
                        if (Math.abs(delta) < arc / 2 && this.player.invulnTimer <= 0) {
                            const dmg = this.isPowerupActive('shield') ? 1 : (e.def.damage || 2);
                            this.player.hp -= dmg;
                            bus.emit(SFX.TAKE_DAMAGE);
                            this.player.invulnTimer = PLAYER.invulnMs + (this.relicInvulnBonusMs || 0);
                            this.cameras.main.shake(200, 0.014);
                        }
                    }
                    this.poofAt(e.x + Math.cos(e.facingAngle) * 40, e.y + Math.sin(e.facingAngle) * 40, 0xff60c0);
                }
                continue;
            }
            // Idle — start telegraph if player in range and cd ready
            if (inRange && e._biteCdTimer <= 0 && e.alarmed) {
                e._biteState = 'wind';
                e._biteTimer = e.def.biteWindupMs || 700;
                // visual telegraph — sprite pulses red
                if (e.sprite) {
                    this.tweens.add({ targets: e.sprite, scale: e.def.scale * 1.25,
                        duration: 350, yoyo: true });
                }
                this.showFloatingText(e.x, e.y - 30, '✦', '#ff60c0', 20);
            }
        }
    }

    // ==== THRONE: candelabras + boss telegraphed attacks ====
    spawnCandelabras() {
        if (this.biome?.id !== 'throne') return;
        this.candelabras = [];
        const bossRoom = this.dungeon.rooms[this.exitRoomIdx];
        if (!bossRoom) return;
        const inset = 80;
        const positions = [
            { x: bossRoom.x + inset, y: bossRoom.y + inset },
            { x: bossRoom.x + bossRoom.w - inset, y: bossRoom.y + inset },
            { x: bossRoom.x + inset, y: bossRoom.y + bossRoom.h - inset },
            { x: bossRoom.x + bossRoom.w - inset, y: bossRoom.y + bossRoom.h - inset }
        ];
        for (const p of positions) {
            if (this.pointInWalls(p.x, p.y, 26)) continue;
            const sprite = this._worldImage(p.x, p.y, 'candelabra_unlit', 155, 0.5, 0.9);
            const glow = this.add.circle(p.x, p.y - 34, 30, 0xa080ff, 0.25).setDepth(154);
            this.tweens.add({ targets: glow, alpha: 0.10, scale: 1.4,
                duration: 1100, yoyo: true, repeat: -1 });
            this.candelabras.push({ x: p.x, y: p.y, sprite, glow, lit: false });
        }
    }

    updateCandelabras(dt) {
        if (this.biome?.id !== 'throne' || !this.candelabras) return;
        // Boss telegraphed attacks (only if boss is alive)
        const boss = this.enemies && this.enemies.find(e => e.kind === 'boss' && !e.dead);
        if (!boss) return;
        // Lights-out by phase
        const litCount = this.candelabras.filter(c => c.lit).length;
        if (boss.phase2 && !boss._lightsOut2) {
            boss._lightsOut2 = true;
            // Extinguish 2 candelabras
            const toKill = this.candelabras.filter(c => c.lit).slice(0, 2);
            for (const c of toKill) { c.lit = false; c.sprite.setTexture('candelabra_unlit'); c.sprite.setAlpha(0.4); }
        }
        if (boss.phase3 && !boss._lightsOut3) {
            boss._lightsOut3 = true;
            for (const c of this.candelabras) { c.lit = false; c.sprite.setTexture('candelabra_unlit'); c.sprite.setAlpha(0.3); }
        }
        // Telegraphed boss attacks
        boss._attackCd = (boss._attackCd || 0) - dt * 1000;
        if (boss._attackState === 'wind') {
            boss._attackTimer -= dt * 1000;
            if (boss._attackTimer <= 0) {
                this._executeBossAttack(boss);
                boss._attackState = 'idle';
                boss._attackCd = 4000;
            }
        } else if (boss._attackCd <= 0 && !boss.invulnUntil || this.time.now > (boss.invulnUntil || 0)) {
            // Pick attack
            const dx = this.player.x - boss.x, dy = this.player.y - boss.y;
            const dist = Math.hypot(dx, dy);
            const attacks = ['BAT_SWARM', 'CAPE_DASH', 'BLOOD_DROP'];
            // If close, prefer dash; if far, swarm
            const choice = dist < 200 ? 'CAPE_DASH'
                         : dist > 400 ? 'BAT_SWARM'
                         : attacks[Math.floor(Math.random() * 3)];
            boss._nextAttack = choice;
            boss._attackState = 'wind';
            boss._attackTimer = choice === 'CAPE_DASH' ? 500 : (choice === 'BAT_SWARM' ? 600 : 800);
            // Visual telegraph
            this.showFloatingText(boss.x, boss.y - 60,
                choice === 'BAT_SWARM' ? '🦇 СТАЯ' :
                choice === 'CAPE_DASH' ? '💨 РЫВОК' : '🩸 КРОВЬ',
                '#ff8080', 20);
            boss.sprite.setTint(0xff6060);
            this.time.delayedCall(boss._attackTimer, () => {
                if (boss.sprite && !boss.dead) boss.sprite.clearTint();
            });
        }
    }

    _lightCandelabra(c) {
        c.lit = true;
        c.sprite.setTexture('candelabra_lit');
        c.sprite.setAlpha(1);
        c.glow.fillColor = 0xffd040;
        bus.emit(SFX.LIGHT_TORCH);
        this.poofAt(c.x, c.y, 0xffd040);
        // Find boss, damage + slow
        const boss = this.enemies && this.enemies.find(e => e.kind === 'boss' && !e.dead);
        if (boss) {
            this.damageEnemy(boss, 3, 0, 0);
            if (!boss._origSpeed) boss._origSpeed = boss.def.speed;
            boss._candelabraSlow = Math.min(0.32, (boss._candelabraSlow || 0) + 0.08);
            boss.def = { ...boss.def, speed: boss._origSpeed * (1 - boss._candelabraSlow) };
            const litCount = this.candelabras.filter(x => x.lit).length;
            this.showFloatingText(c.x, c.y - 30,
                litCount === 4 ? '4/4 НА КОЛЕНИ!' : `${litCount}/4 канделябр`,
                '#ffd040', 20);
            // All 4 lit → boss kneels for 1.5s, no invuln, takes extra damage
            if (litCount === 4) {
                boss.invulnUntil = 0;
                boss._kneeling = this.time.now + 1500;
                this.cameras.main.flash(280, 255, 220, 100);
                if (boss.sprite) {
                    this.tweens.add({ targets: boss.sprite, scaleY: boss.def.scale * 0.6,
                        duration: 200, yoyo: true, repeat: 3 });
                }
            }
        }
    }

    _executeBossAttack(boss) {
        const choice = boss._nextAttack;
        const dx = this.player.x - boss.x, dy = this.player.y - boss.y;
        const ang = Math.atan2(dy, dx);
        if (choice === 'BAT_SWARM') {
            // 3 fast projectiles in cone
            for (let i = -1; i <= 1; i++) {
                const a = ang + i * 0.2;
                this.spawnEnemyBolt(boss.x, boss.y, boss.x + Math.cos(a) * 500, boss.y + Math.sin(a) * 500, 320, 0xc080ff, true);
            }
            bus.emit(SFX.BOSS_HIT);
        } else if (choice === 'CAPE_DASH') {
            // Dash forward — visible streak + 60px shockwave at end
            const targetX = boss.x + Math.cos(ang) * 240;
            const targetY = boss.y + Math.sin(ang) * 240;
            this.tweens.add({
                targets: boss.sprite, x: targetX, y: targetY, duration: 280, ease: 'Quad.easeOut',
                onUpdate: () => { boss.x = boss.sprite.x; boss.y = boss.sprite.y; },
                onComplete: () => {
                    this.poofAt(targetX, targetY, 0xff4060);
                    this.cameras.main.shake(160, 0.018);
                    if (Math.hypot(targetX - this.player.x, targetY - this.player.y) < 60
                        && this.player.invulnTimer <= 0) {
                        this.player.hp -= 2;
                        bus.emit(SFX.TAKE_DAMAGE);
                        this.player.invulnTimer = PLAYER.invulnMs + (this.relicInvulnBonusMs || 0);
                    }
                }
            });
        } else if (choice === 'BLOOD_DROP') {
            // 3 lingering puddles around player
            for (let i = 0; i < 3; i++) {
                const a = Math.random() * Math.PI * 2;
                const d = 40 + Math.random() * 50;
                const px = this.player.x + Math.cos(a) * d;
                const py = this.player.y + Math.sin(a) * d;
                if (this.pointInWalls(px, py, 28)) continue;
                const tile = { x: px, y: py, radius: 36, type: 'thorn' };
                this.biomeTiles.push(tile);
                this.drawBiomeTile(px, py, 36, 'thorn', tile);
                // Despawn after 4s
                this.time.delayedCall(4000, () => {
                    const idx = this.biomeTiles.indexOf(tile);
                    if (idx >= 0) {
                        tile.sprite?.destroy();
                        this.biomeTiles.splice(idx, 1);
                    }
                });
            }
        }
    }

    updateKitchenHotpans(dt) {
        if (!this.biomeTiles || this.biome?.id !== 'kitchen') return;
        const dtMs = dt * 1000;
        for (const t of this.biomeTiles) {
            if (t.type !== 'hotpan') continue;
            t.phaseTimer -= dtMs;
            if (t.phaseTimer > 0) continue;
            // Advance phase: cold (2.0s) → warn (0.9s) → flame (1.5s) → cold
            if (t.phase === 'cold') { t.phase = 'warn'; t.phaseTimer = 900; }
            else if (t.phase === 'warn') { t.phase = 'flame'; t.phaseTimer = 1500; }
            else if (t.phase === 'flame') { t.phase = 'cold'; t.phaseTimer = 2000; }
            this._redrawHotpan(t);
        }
    }

    _redrawHotpan(t) {
        if (!t.sprite) return;
        t.sprite.setTexture('tile_hotpan_' + t.phase);
    }

    spawnBiomeParticles() {
        const cfg = this.biome.particles;
        if (!cfg) return;
        this.biomeParticles = [];
        const cam = this.cameras.main;
        for (let i = 0; i < cfg.count; i++) {
            const x = Phaser.Math.Between(0, WORLD_W);
            const y = Phaser.Math.Between(0, WORLD_H);
            const r = cfg.type === 'embers' ? 2 : 1.5;
            const sprite = this.add.circle(x, y, r, cfg.color, 0.55).setDepth(85);
            this.biomeParticles.push({
                sprite, x, y,
                vx: (Math.random() - 0.5) * 12,
                vy: -cfg.riseSpeed * (0.6 + Math.random() * 0.6),
                phase: Math.random() * Math.PI * 2,
                type: cfg.type
            });
        }
    }

    // === Ambient clouds (kitchen steam / garden pollen) — spawned periodically ===
    updateAmbientClouds(dt) {
        const cfg = this.biome?.ambientCloud;
        if (!cfg) return;
        // Cap active clouds (perf)
        const MAX_CLOUDS = 4;
        this._cloudTimer = (this._cloudTimer || 1500) - dt * 1000;
        if (this._cloudTimer <= 0) {
            const [a, b] = cfg.intervalMs;
            this._cloudTimer = Phaser.Math.Between(a, b);
            if (!this.ambientClouds || this.ambientClouds.length < MAX_CLOUDS) {
                this.spawnAmbientCloud(cfg);
            }
        }
        if (!this.ambientClouds) return;
        for (const c of this.ambientClouds) {
            c.life -= dt * 1000;
            if (c.life <= 0) c.dead = true;
        }
        this.ambientClouds = this.ambientClouds.filter(c => !c.dead);
    }

    spawnAmbientCloud(cfg) {
        if (!this.player) return;
        // Spawn near (but not on) player so they encounter it
        const ang = Math.random() * Math.PI * 2;
        const dist = Phaser.Math.Between(160, 360);
        const px = this.player.x + Math.cos(ang) * dist;
        const py = this.player.y + Math.sin(ang) * dist;
        if (this.pointInWalls(px, py, 50)) return;
        const radius = Phaser.Math.Between(75, 110);
        const sprite = this.add.circle(px, py, radius * 0.4, cfg.color, 0.55).setDepth(86);
        sprite.setStrokeStyle(2, cfg.color, 0.75);
        // Grow
        this.tweens.add({
            targets: sprite, scale: 1, duration: 800, ease: 'Sine.easeOut'
        });
        // Fade after life
        this.tweens.add({
            targets: sprite, alpha: 0, duration: 1500, delay: 1800,
            onComplete: () => sprite.destroy()
        });
        // Drift sideways gently
        this.tweens.add({
            targets: sprite,
            x: px + (Math.random() - 0.5) * 50,
            y: py - 20,
            duration: 3300, ease: 'Sine.easeInOut'
        });
        // Burst poof
        const burst = this.add.circle(px, py, radius * 0.2, cfg.color, 0.9).setDepth(87);
        this.tweens.add({
            targets: burst, scale: 2.5, alpha: 0,
            duration: 600, onComplete: () => burst.destroy()
        });
        this.ambientClouds = this.ambientClouds || [];
        this.ambientClouds.push({
            sprite, x: px, y: py, radius, type: cfg.type,
            slowFactor: cfg.slowFactor, life: 3300, dead: false
        });
    }

    updateBiomeParticles(dt) {
        if (!this.biomeParticles) return;
        const cam = this.cameras.main;
        const margin = 100;
        for (const p of this.biomeParticles) {
            p.phase += dt * 2;
            p.x += p.vx * dt + Math.cos(p.phase) * 0.3;
            p.y += p.vy * dt;
            if (p.y < -50) { p.y = WORLD_H + 50; p.x = Phaser.Math.Between(0, WORLD_W); }
            if (p.x < -50) p.x = WORLD_W + 50;
            if (p.x > WORLD_W + 50) p.x = -50;
            // Only update sprite if in camera view (perf)
            if (p.x > cam.worldView.x - margin && p.x < cam.worldView.x + this.viewW + margin &&
                p.y > cam.worldView.y - margin && p.y < cam.worldView.y + this.viewH + margin) {
                p.sprite.setPosition(p.x, p.y);
                p.sprite.setVisible(true);
            } else {
                p.sprite.setVisible(false);
            }
        }
    }

    drawBiomeTile(x, y, radius, type, tile) {
        const key = type === 'hotpan' ? 'tile_hotpan_cold' : (type === 'vines' ? 'tile_vine' : 'tile_' + type);
        if (!this.textures.exists(key)) { console.warn('[DungeonScene] unknown biome tile', type); return; }
        const spr = this._worldImage(x, y, key, LAYER.TILE);
        this._sizeBiomeTile(spr, radius);
        if (tile) tile.sprite = spr;
        return spr;
    }
    // Tile art is sized to the mechanic's hit radius, keeping each SVG's aspect ratio.
    _sizeBiomeTile(spr, radius) {
        const w = radius * 2.2;
        spr.setDisplaySize(w, w * (spr.height / spr.width));
    }

    addWall(x, y, w, h) {
        const wall = { x, y, w, h };
        this.walls.push(wall);
        // Spatial hash for fast wall queries
        if (this.spatialHash) {
            const C = this._hashCell;
            const sC = Math.floor(x / C), sR = Math.floor(y / C);
            const eC = Math.floor((x + w) / C), eR = Math.floor((y + h) / C);
            for (let r = sR; r <= eR; r++) {
                for (let c = sC; c <= eC; c++) {
                    const key = r * 100000 + c;
                    let bucket = this.spatialHash.get(key);
                    if (!bucket) { bucket = []; this.spatialHash.set(key, bucket); }
                    bucket.push(wall);
                }
            }
        }
    }

    // === BIOME DECORATIONS — sprite from the art kit ===
    drawDecor(x, y, type) {
        const t = DECOR_ALIAS[type] || type;
        const key = 'prop_' + t;
        if (!this.textures.exists(key)) { console.warn('[DungeonScene] unknown decor type', type); return; }
        // Anchor near the base so props read as standing on the floor; carpets/cobwebs/lilypads are flat
        const flat = (t === 'redCarpet' || t === 'cobweb' || t === 'lilypad');
        this.decorSprites.push(this._worldImage(x, y, key, LAYER.DECOR, 0.5, flat ? 0.5 : 0.8));
    }

    placeRandomTorches() {
        this.torches = [];
        // Place torches ONLY on cells adjacent to a wall — visually attached, never floating in corridors
        for (const room of this.dungeon.rooms) {
            const count = Phaser.Math.Between(3, 6);
            const placedKeys = new Set();
            let placed = 0;
            const candidates = this._collectWallAdjacentCells(room);
            // Shuffle for randomness
            Phaser.Utils.Array.Shuffle(candidates);
            for (const cand of candidates) {
                if (placed >= count) break;
                const key = cand.gr * NAV_W + cand.gc;
                if (placedKeys.has(key)) continue;
                placedKeys.add(key);
                const lit = Math.random() < 0.78;
                this.placeTorch(cand.x, cand.y, lit);
                placed++;
            }
            // Biome-themed props
            const propCount = (this.biome.id === 'library') ? 6 : 5;
            for (let i = 0; i < propCount; i++) {
                const x = Phaser.Math.Between(room.x + 60, room.x + room.w - 60);
                const y = Phaser.Math.Between(room.y + 60, room.y + room.h - 60);
                const gc = Math.floor(x / NAV_CELL);
                const gr = Math.floor(y / NAV_CELL);
                if (this.navGrid[gr]?.[gc] !== 'floor') continue;
                if (this.pointInWalls(x, y, 18)) continue;   // keep prop bodies off the brick edge
                if (this.biomeTiles.some(t => Math.hypot(t.x - x, t.y - y) < t.radius + 18)) continue;   // not under a puddle/patch
                const type = pickDecor(this.biome.decorWeights);
                if (type) this.drawDecor(x, y, type);
            }
        }
        // NO corridor torches — only wall-attached ones in rooms (per user request)
    }

    // Returns cells inside the room that are adjacent to a wall — torches attach visually here
    _collectWallAdjacentCells(room) {
        const cells = [];
        // Full room rect (no inset): the outermost floor cells are the ones that touch the wall.
        const c0 = Math.max(0, Math.floor(room.x / NAV_CELL));
        const r0 = Math.max(0, Math.floor(room.y / NAV_CELL));
        const c1 = Math.min(NAV_W - 1, Math.ceil((room.x + room.w) / NAV_CELL));
        const r1 = Math.min(NAV_H - 1, Math.ceil((room.y + room.h) / NAV_CELL));
        for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) {
                if (this.navGrid[r]?.[c] !== 'floor') continue;
                // Check if any 4-direction neighbour is a wall
                const isWallAdj =
                    (this.navGrid[r-1]?.[c] === 'wall') ||
                    (this.navGrid[r+1]?.[c] === 'wall') ||
                    (this.navGrid[r]?.[c-1] === 'wall') ||
                    (this.navGrid[r]?.[c+1] === 'wall');
                if (!isWallAdj) continue;
                // Anchor torch visually toward the wall it's adjacent to (offset 6px from wall)
                let ox = 0, oy = 0;
                if (this.navGrid[r-1]?.[c] === 'wall') oy = -(NAV_CELL/2 - 6);
                else if (this.navGrid[r+1]?.[c] === 'wall') oy = (NAV_CELL/2 - 6);
                else if (this.navGrid[r]?.[c-1] === 'wall') ox = -(NAV_CELL/2 - 6);
                else if (this.navGrid[r]?.[c+1] === 'wall') ox = (NAV_CELL/2 - 6);
                cells.push({
                    gr: r, gc: c,
                    x: c * NAV_CELL + NAV_CELL/2 + ox,
                    y: r * NAV_CELL + NAV_CELL/2 + oy
                });
            }
        }
        return cells;
    }

    placeTorch(x, y, lit) {
        const torch = {
            x, y, lit,
            flickerPhase: Math.random() * Math.PI * 2,
            baseRadius: 110 + Phaser.Math.Between(-15, 15),
            sconce: this._worldImage(x, y + 12, 'torch_sconce', LAYER.SCONCE, 0.5, 1),
            flame: this.add.sprite(x, y - 6, 'flame_sheet', 'f0').setOrigin(0.5, 0.93).setScale(1 / this.dpr).setDepth(LAYER.FLAME),
        };
        torch.flame.play({ key: 'torch_flame', startFrame: Phaser.Math.Between(0, 2) });
        torch.flame.anims.timeScale = 0.85 + Math.random() * 0.3;   // desync torches
        if (!lit) torch.flame.setVisible(false);
        this.torches.push(torch);
    }

    // Player can light unlit torches by hitting them with a pie (gives score)
    lightTorch(torch) {
        if (torch.lit) return;
        torch.lit = true;
        if (torch.flame) torch.flame.setVisible(true);
        bus.emit(SFX.LIGHT_TORCH);
        this.score += 5;
        this.showFloatingText(torch.x, torch.y - 20, '+5 свет!', '#ffd060', 18);
        // DUNGEON BIOME: lit torch reveals hidden cheese cache in 80px radius (exploration loop)
        if (this.biome?.id === 'dungeon' && !torch._cacheRevealed) {
            torch._cacheRevealed = true;
            // 60% chance there's a cache
            if (Math.random() < 0.6) {
                const angle = Math.random() * Math.PI * 2;
                const dist = 30 + Math.random() * 50;
                const cx = torch.x + Math.cos(angle) * dist;
                const cy = torch.y + Math.sin(angle) * dist;
                if (!this.pointInWalls(cx, cy, 16)) {
                    // Spawn 2-3 cheese in tight cluster
                    const count = Phaser.Math.Between(2, 3);
                    for (let i = 0; i < count; i++) {
                        const oa = Math.random() * Math.PI * 2;
                        const od = Math.random() * 18;
                        const ex = cx + Math.cos(oa) * od;
                        const ey = cy + Math.sin(oa) * od;
                        if (this.pointInWalls(ex, ey, 12)) continue;
                        this.spawnSingleCheese(ex, ey);
                    }
                    this.showFloatingText(cx, cy - 20, '🧀 Тайник!', '#ffe080', 18);
                }
            }
        }
        // Spark particles
        for (let i = 0; i < 10; i++) {
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.6;
            const sp = Phaser.Math.Between(50, 110);
            const p = this.add.circle(torch.x, torch.y - 10, Phaser.Math.Between(2, 4), 0xffd040, 1).setDepth(82);
            this.tweens.add({
                targets: p,
                x: torch.x + Math.cos(angle) * sp,
                y: torch.y - 10 + Math.sin(angle) * sp,
                alpha: 0, scale: 0.2,
                duration: 500, ease: 'Quad.easeOut',
                onComplete: () => p.destroy()
            });
        }
    }

    // =================================================================
    // A* PATHFINDING
    // =================================================================
    findPath(fromX, fromY, toX, toY, radius) {
        // Configuration-space A*: reject any cell whose clearance (px-to-nearest-wall)
        // is too small for the agent's body. Default radius 22 preserves old behavior.
        const r = radius || 22;
        const minClearCells = Math.max(1, Math.ceil((r + 2) / NAV_CELL));
        const cl = this.navClearance;
        let sR = Math.floor(fromY / NAV_CELL);
        let sC = Math.floor(fromX / NAV_CELL);
        let eR = Math.floor(toY / NAV_CELL);
        let eC = Math.floor(toX / NAV_CELL);
        if (sR < 0 || sR >= NAV_H || sC < 0 || sC >= NAV_W) return null;
        if (eR < 0 || eR >= NAV_H || eC < 0 || eC >= NAV_W) return null;
        // If start/end cell doesn't satisfy clearance — find nearest cell that does
        if (this.navGrid[sR][sC] === 'wall' || (cl && cl[sR * NAV_W + sC] < minClearCells)) {
            const fbS = this.nearestFreeCell(sR, sC, minClearCells);
            if (!fbS) return null;
            sR = fbS.r; sC = fbS.c;
        }
        if (this.navGrid[eR][eC] === 'wall' || (cl && cl[eR * NAV_W + eC] < minClearCells)) {
            const fbE = this.nearestFreeCell(eR, eC, minClearCells);
            if (!fbE) return null;
            eR = fbE.r; eC = fbE.c;
        }

        const key = (r, c) => r * NAV_W + c;
        const h = (r, c) => Math.abs(r - eR) + Math.abs(c - eC);
        const open = [[h(sR, sC), sR, sC]];
        const came = new Map();
        const g = new Map();
        g.set(key(sR, sC), 0);

        let iters = 0;
        const MAX_ITERS = 1500;

        while (open.length > 0 && iters++ < MAX_ITERS) {
            let minIdx = 0;
            for (let i = 1; i < open.length; i++) if (open[i][0] < open[minIdx][0]) minIdx = i;
            const [, r, c] = open.splice(minIdx, 1)[0];

            if (r === eR && c === eC) {
                const path = [];
                let k = key(r, c);
                while (came.has(k)) {
                    const [pr, pc] = came.get(k);
                    path.unshift({ r: Math.floor(k / NAV_W), c: k % NAV_W });
                    k = key(pr, pc);
                }
                return path;
            }

            for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
                const nr = r + dr, nc = c + dc;
                if (nr < 0 || nr >= NAV_H || nc < 0 || nc >= NAV_W) continue;
                if (this.navGrid[nr][nc] === 'wall') continue;
                // CLEARANCE GATE — cell must geometrically fit the agent
                if (cl && cl[nr * NAV_W + nc] < minClearCells) continue;
                const gn = g.get(key(r, c)) + 1;
                if (gn < (g.get(key(nr, nc)) ?? Infinity)) {
                    came.set(key(nr, nc), [r, c]);
                    g.set(key(nr, nc), gn);
                    open.push([gn + h(nr, nc), nr, nc]);
                }
            }
        }
        return null;
    }

    nearestFloor(r, c) {
        return this.nearestFreeCell(r, c, 0);
    }

    // Returns nearest cell that is floor AND has clearance >= minClearCells
    nearestFreeCell(r, c, minClearCells) {
        const cl = this.navClearance;
        for (let radius = 0; radius < 8; radius++) {
            for (let dr = -radius; dr <= radius; dr++) {
                for (let dc = -radius; dc <= radius; dc++) {
                    // Only outer ring for radius > 0 (skip already-checked inner cells)
                    if (radius > 0 && Math.abs(dr) < radius && Math.abs(dc) < radius) continue;
                    const nr = r + dr, nc = c + dc;
                    if (nr < 0 || nr >= NAV_H || nc < 0 || nc >= NAV_W) continue;
                    if (this.navGrid[nr][nc] !== 'floor') continue;
                    const clearance = cl ? cl[nr * NAV_W + nc] : 99;
                    if (clearance >= minClearCells) return { r: nr, c: nc };
                }
            }
        }
        return null;
    }

    // === CLEARANCE MAP — Brushfire BFS storing distance-to-nearest-wall (in cells, Chebyshev metric) ===
    // Used by A* so paths fit the agent's body radius. Result: enemies never plan paths through gaps too narrow for them.
    buildClearanceMap() {
        const W = NAV_W, H = NAV_H;
        const cl = new Uint8Array(W * H);
        // Seed BFS: every wall cell gets distance 0, every floor cell gets distance "infinity" (255)
        const queue = [];
        for (let r = 0; r < H; r++) {
            for (let c = 0; c < W; c++) {
                if (this.navGrid[r][c] === 'wall') {
                    cl[r * W + c] = 0;
                    queue.push(r * W + c);
                } else {
                    cl[r * W + c] = 255;
                }
            }
        }
        // BFS — 8-neighbor (Chebyshev) so diagonal squeezes are also rejected
        let head = 0;
        const neighbors = [
            [-1,-1],[-1,0],[-1,1],
            [ 0,-1],       [ 0,1],
            [ 1,-1],[ 1,0],[ 1,1]
        ];
        while (head < queue.length) {
            const idx = queue[head++];
            const r = (idx / W) | 0;
            const c = idx - r * W;
            const d = cl[idx];
            if (d >= 254) continue;
            const nd = d + 1;
            for (const [dr, dc] of neighbors) {
                const nr = r + dr, nc = c + dc;
                if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue;
                const nidx = nr * W + nc;
                if (cl[nidx] > nd) {
                    cl[nidx] = nd;
                    queue.push(nidx);
                }
            }
        }
        this.navClearance = cl;
    }

    // =================================================================
    // ANIMATION (walk cycle by code)
    // =================================================================
    animateSprite(entity, baseScale, isMoving, walkSpeed) {
        const sprite = entity.sprite;
        const facing = entity.facing || 1;
        sprite.x = entity.x;
        if (isMoving) {
            entity.walkPhase = (entity.walkPhase || 0) + (walkSpeed || 0.20);
            // Lively walk: bigger bounce + waddle + squash
            const bob = Math.sin(entity.walkPhase * 2) * 9;
            const tilt = Math.sin(entity.walkPhase) * 11;
            const stretch = Math.abs(Math.sin(entity.walkPhase * 2)) * 0.13;
            const waddle = Math.sin(entity.walkPhase) * 2.4 * facing;
            // === DIRECTIONAL CUES — pronounced lean + squash so direction reads at a glance ===
            const vx = entity.vx || 0, vy = entity.vy || 0;
            const sp = Math.hypot(vx, vy);
            // Y-squash: UP = much shorter (away), DOWN = much taller (toward camera) — ±12%
            const ySquash = sp > 5 ? Math.max(-0.12, Math.min(0.12, vy / 400)) : 0;
            // Strong lean: backward when going up, forward when going down — ±15°
            const dirLean = sp > 5 ? Math.max(-15, Math.min(15, vy / 14)) : 0;
            // Horizontal lean: leans into walking direction — ±8°
            const xLean = sp > 5 ? Math.max(-8, Math.min(8, vx / 20)) : 0;
            // X-squash removed — combined with walk-stretch it made sprites look pinched
            sprite.y = entity.y + bob;
            sprite.x = entity.x + waddle;
            // tilt (walk cycle) * facing + lean (directional)
            sprite.angle = (tilt * facing) + dirLean + xLean;
            sprite.scaleX = baseScale * facing * (1 - stretch * 0.5);  // gentler horizontal squash
            sprite.scaleY = baseScale * (1 + stretch + ySquash);
            // Swap walk-cycle frames if entity has them (legs visibly move)
            if (entity.walkFrames) {
                const idx = Math.floor(entity.walkPhase / Math.PI) % entity.walkFrames.length;
                const key = entity.walkFrames[idx];
                if (sprite.texture.key !== key) sprite.setTexture(key);
            }
        } else {
            // Idle — gentle breathing + sway
            const t = this.time.now * 0.003;
            const breath = Math.sin(t * 1.5) * 0.025;                  // subtle breathing
            sprite.angle = Math.sin(t) * 1.5 * facing;
            sprite.x = entity.x;
            sprite.y = entity.y + Math.sin(t * 1.2) * 1.8;
            sprite.scaleX = baseScale * facing * (1 + breath);
            sprite.scaleY = baseScale * (1 - breath);
            // Reset to standing frame
            if (entity.standFrame && sprite.texture.key !== entity.standFrame) {
                sprite.setTexture(entity.standFrame);
            }
        }
    }

    // Special slime animation: full hop cycle (crouch → air → land → wobble → idle)
    animateSlime(e, baseScale) {
        const sprite = e.sprite;
        sprite.x = e.x;
        sprite.angle = 0;
        const t = e.slimeDuration > 0 ? Math.min(1, e.slimeT / e.slimeDuration) : 0;

        if (e.slimePhase === 'crouch') {
            sprite.scaleY = baseScale * (1 - 0.32 * t);
            sprite.scaleX = baseScale * (1 + 0.28 * t);
            sprite.y = e.y + 6 * t;
        } else if (e.slimePhase === 'air') {
            const arc = Math.sin(Math.PI * t);
            sprite.scaleY = baseScale * (1.05 + 0.40 * arc);
            sprite.scaleX = baseScale * (0.95 - 0.22 * arc);
            sprite.y = e.y - 30 * arc;
        } else if (e.slimePhase === 'land') {
            sprite.scaleY = baseScale * (0.55 + 0.45 * t);
            sprite.scaleX = baseScale * (1.45 - 0.45 * t);
            sprite.y = e.y + 6 * (1 - t);
        } else if (e.slimePhase === 'wobble') {
            const w = Math.sin(Math.PI * 3 * t) * (1 - t);
            sprite.scaleY = baseScale * (1 + 0.12 * w);
            sprite.scaleX = baseScale * (1 - 0.12 * w);
            sprite.y = e.y + 3 * w;
        } else {
            // idle quiver — gentle breathing
            const tm = this.time.now * 0.004;
            sprite.scaleY = baseScale * (1 + 0.04 * Math.sin(tm));
            sprite.scaleX = baseScale * (1 - 0.04 * Math.sin(tm));
            sprite.y = e.y;
        }
    }

    // =================================================================
    // PLAYER
    // =================================================================
    spawnPlayer() {
        // Spawn at center of first room
        const room = this.dungeon.rooms[0];
        const start = { x: room.x + room.w / 2, y: room.y + room.h / 2 };
        const sprite = this.add.image(start.x, start.y, 'd_pi')
            .setOrigin(0.5, 0.5).setScale(0.34).setDepth(200);
        const shadow = this.add.ellipse(start.x, start.y + 32, 60, 14, 0x000000, 0.5).setDepth(199);
        this.player = {
            sprite, shadow,
            x: start.x, y: start.y,
            vx: 0, vy: 0,
            hp: this.maxHp,
            facing: 1,
            invulnTimer: 0,
            fireTimer: 0,
            walkPhase: 0,
            aimAngle: 0,
            standFrame: 'd_pi',
            walkFrames: ['d_pi_walk1', 'd_pi_walk2'],
            crouch: false,       // stealth verb (C key / mobile button) — slower, harder to detect
            dashTimer: 0,
            dashCooldown: 0,
            dashing: false,
            dashAngle: 0,
            _trailTimer: 0
        };
        // SKIN — each skin is its own SVG texture, no overlay needed
        this.applySkinToPlayer(Progress.getCurrentSkin());
    }

    applySkinToPlayer(skin) {
        if (!skin || !this.player || !this.player.sprite) return;
        this.player.skin = skin;
        // SWAP TEXTURE — each skin is its own SVG art (not just tint)
        const spriteKey = skin.spriteKey || 'd_pi';
        if (this.textures.exists(spriteKey)) {
            this.player.sprite.setTexture(spriteKey);
            this.player.standFrame = spriteKey;
        }
        // Set walk-cycle frames — each skin has its own walk1/walk2 (real leg movement per skin)
        if (skin.id === 'blue' || !skin.spriteKey || skin.spriteKey === 'd_pi') {
            this.player.walkFrames = ['d_pi_walk1', 'd_pi_walk2'];
        } else {
            const w1 = skin.spriteKey + '_w1';
            const w2 = skin.spriteKey + '_w2';
            if (this.textures.exists(w1) && this.textures.exists(w2)) {
                this.player.walkFrames = [w1, w2];
            } else {
                this.player.walkFrames = null;  // fallback — no swap, rely on bounce animation
            }
        }
        // Tint is no longer needed — each skin SVG has its own colors. Clear any old tint.
        this.player.sprite.clearTint();
        // Special alpha for ethereal skins
        if (skin.id === 'shadow') this.player.sprite.setAlpha(0.85);
        else if (skin.id === 'angel') this.player.sprite.setAlpha(0.95);
        else this.player.sprite.setAlpha(1);
    }

    toggleCrouch() {
        if (this.state !== 'play') return;
        this.player.crouch = !this.player.crouch;
        bus.emit(UI.BUTTON_CLICK);
        this.player.sprite.setScale(0.34 * (this.player.crouch ? 0.85 : 1));
        // Visual indicator
        const txt = this.player.crouch ? '🦶 крадусь' : '↑ стоя';
        this.showFloatingText(this.player.x, this.player.y - 50, txt, this.player.crouch ? '#80c0ff' : '#c0c0c0', 16);
    }

    throwDistractionBook() {
        if (this.state !== 'play') return;
        if ((this.distractionBooks || 0) <= 0) {
            this.showFloatingText(this.player.x, this.player.y - 50, 'Нет книг', '#a0a0a0', 16);
            return;
        }
        this.distractionBooks--;
        bus.emit(SFX.DISTRACTION_THUD);
        // Throw 220px in aim direction
        const angle = this.player.aimAngle || 0;
        const range = 260;
        const tx = this.player.x + Math.cos(angle) * range;
        const ty = this.player.y + Math.sin(angle) * range;
        const book = this._worldImage(this.player.x, this.player.y, 'prop_book', 180);
        this.tweens.add({
            targets: book, x: tx, y: ty, angle: 360, duration: 420, ease: 'Quad.easeOut',
            onComplete: () => {
                // Thud — affects all cone enemies in 350px
                bus.emit(SFX.DISTRACTION_THUD);
                this.poofAt(tx, ty, 0xa080c0);
                if (this.enemies) {
                    for (const e of this.enemies) {
                        if (e.dead || !e.stealthPatrol) continue;
                        const d = Math.hypot(e.x - tx, e.y - ty);
                        if (d > 350) continue;
                        if (!e.lastSeen) e.lastSeen = { x: 0, y: 0 };
                        e.lastSeen.x = tx; e.lastSeen.y = ty;
                        e.alertTimer = 4000;
                        e.suspicion = Math.max(e.suspicion || 0, 0.55);
                        // Rotate facing target toward thud
                        e._facingTarget = Math.atan2(ty - e.y, tx - e.x);
                    }
                }
                this.tweens.add({ targets: book, alpha: 0, duration: 600,
                    onComplete: () => book.destroy() });
            }
        });
        this.showFloatingText(this.player.x, this.player.y - 50, `📕 ${this.distractionBooks}`, '#a0a0c0', 16);
    }

    _isPlayerOnButter() {
        if (!this.biomeTiles) return false;
        for (const t of this.biomeTiles) {
            if (t.type !== 'butter') continue;
            const dsq = (this.player.x - t.x) ** 2 + (this.player.y - t.y) ** 2;
            if (dsq < t.radius * t.radius) return true;
        }
        return false;
    }

    tryDash() {
        if (this.state !== 'play') return;
        if (this.player.dashCooldown > 0 || this.player.dashing) return;
        bus.emit(SFX.PLAYER_DASH);
        // Dash cooldown also benefits from "Быстрый рывок" upgrade
        const dashCdMs = PLAYER.dashCooldownMs * (this.dashCdMul || 1);
        // Direction: movement input if any, else aim direction
        let angle = this.player.aimAngle || 0;
        const movingByInput = (this.keys.A.isDown || this.keys.D.isDown || this.keys.W.isDown || this.keys.S.isDown) ||
                              (this.joy && this.joy.active && Math.hypot(this.joy.dx, this.joy.dy) > 0.1);
        if (movingByInput) {
            let ix = 0, iy = 0;
            if (this.keys.A.isDown) ix -= 1;
            if (this.keys.D.isDown) ix += 1;
            if (this.keys.W.isDown) iy -= 1;
            if (this.keys.S.isDown) iy += 1;
            if (this.joy && this.joy.active && (ix === 0 && iy === 0)) {
                ix = this.joy.dx; iy = this.joy.dy;
            }
            const len = Math.hypot(ix, iy);
            if (len > 0) angle = Math.atan2(iy / len, ix / len);
        }
        // KITCHEN slide-butter: standing on butter when dashing = longer dash + damaging trail
        const onButterAtStart = this._isPlayerOnButter();
        this.player.dashing = true;
        this.player.dashAngle = angle;
        // Slide-butter: 60% longer + faster
        this.player.dashTimer = PLAYER.dashDurationMs * (onButterAtStart ? 1.6 : 1);
        this.player.dashCooldown = dashCdMs;
        this.player.invulnTimer = Math.max(this.player.invulnTimer, PLAYER.dashInvulnMs);
        this.player.vx = Math.cos(angle) * PLAYER.dashSpeed * (onButterAtStart ? 1.3 : 1);
        this.player.vy = Math.sin(angle) * PLAYER.dashSpeed * (onButterAtStart ? 1.3 : 1);
        this.player._dashTrailHot = onButterAtStart;   // mark trail as damaging
        if (onButterAtStart) {
            this.showFloatingText(this.player.x, this.player.y - 30, '🧈 SLIDE!', '#ffd040', 22);
        }
        // Sound-like puff at start
        for (let i = 0; i < 8; i++) {
            const a = angle + Math.PI + (Math.random() - 0.5) * 1.2;
            const sp = Phaser.Math.Between(40, 110);
            const p = this.add.circle(this.player.x, this.player.y, Phaser.Math.Between(2, 4), 0xa0c0ff, 0.8).setDepth(195);
            this.tweens.add({
                targets: p,
                x: this.player.x + Math.cos(a) * sp,
                y: this.player.y + Math.sin(a) * sp,
                alpha: 0, scale: 0.3, duration: 380, ease: 'Quad.easeOut',
                onComplete: () => p.destroy()
            });
        }
    }

    updatePlayer(dt) {
        // MOVEMENT — WASD only (arrows reserved for aim)
        let ix = 0, iy = 0;
        if (this.keys.A.isDown) ix -= 1;
        if (this.keys.D.isDown) ix += 1;
        if (this.keys.W.isDown) iy -= 1;
        if (this.keys.S.isDown) iy += 1;
        if (this.joy && this.joy.active && (ix === 0 && iy === 0)) {
            ix = this.joy.dx;
            iy = this.joy.dy;
        }
        const len = Math.hypot(ix, iy);
        if (len > 1) { ix /= len; iy /= len; }

        // Update enemy bolts (ranged attacks against player)
        this.updateEnemyBolts(dt);

        if (this.player.dashing) {
            this.player.dashTimer -= dt * 1000;
            const sMul = this.player._dashTrailHot ? 1.3 : 1;
            this.player.vx = Math.cos(this.player.dashAngle) * PLAYER.dashSpeed * sMul;
            this.player.vy = Math.sin(this.player.dashAngle) * PLAYER.dashSpeed * sMul;
            // Slide-butter or flameTrail relic: damage enemies the trail passes through
            if (this.player._dashTrailHot || this.relicFlameTrail) {
                for (const e of this.enemies) {
                    if (e.dead) continue;
                    if (e._hitByDashTrail) continue;
                    if (Math.hypot(e.x - this.player.x, e.y - this.player.y) < e.def.radius + 22) {
                        e._hitByDashTrail = true;
                        this.damageEnemy(e, 1, this.player.vx * 0.5, this.player.vy * 0.5);
                    }
                }
            }
            if (this.player.dashTimer <= 0) {
                this.player.dashing = false;
                this.player.vx *= 0.4;
                this.player.vy *= 0.4;
                this.player._dashTrailHot = false;
                // Clear hit-trail flag from all enemies
                for (const e of this.enemies) e._hitByDashTrail = false;
                // DASH BURST relic — explode at end of dash, 80px AoE
                if (this.relicDashBurst) {
                    const bx = this.player.x, by = this.player.y;
                    this.poofAt(bx, by, 0x80c0ff);
                    this.cameras.main.shake(140, 0.010);
                    for (const e of this.enemies) {
                        if (e.dead) continue;
                        if (Math.hypot(e.x - bx, e.y - by) < 80) {
                            this.damageEnemy(e, 1, e.x - bx, e.y - by);
                        }
                    }
                }
            }
            this.player._trailTimer -= dt * 1000;
            if (this.player._trailTimer <= 0) {
                this.player._trailTimer = 30;
                this.spawnDashTrail();
            }
        } else {
            // Biome tile effect under player
            let speedMul = this.speedMul;
            let onButter = false, onVines = false;
            let onHotPan = false, onThorn = false;
            if (this.biomeTiles) {
                for (const t of this.biomeTiles) {
                    const dsq = (this.player.x - t.x) ** 2 + (this.player.y - t.y) ** 2;
                    if (dsq < t.radius * t.radius) {
                        if (t.type === 'butter')  onButter = true;
                        if (t.type === 'vines')   onVines = true;
                        // KITCHEN hotpan: only damages during flame phase
                        if (t.type === 'hotpan' && (!t.phase || t.phase === 'flame')) onHotPan = true;
                        if (t.type === 'thorn')   onThorn = true;
                    }
                }
            }
            // Ambient clouds (steam / pollen)
            if (this.ambientClouds) {
                for (const c of this.ambientClouds) {
                    const dsq = (this.player.x - c.x) ** 2 + (this.player.y - c.y) ** 2;
                    if (dsq < c.radius * c.radius) {
                        speedMul *= c.slowFactor;
                    }
                }
            }
            // Hazard damage (with own short cooldown to avoid melting on one step)
            this.player._hazardCd = (this.player._hazardCd || 0) - dt * 1000;
            if ((onHotPan || onThorn) && this.player._hazardCd <= 0 && this.player.invulnTimer <= 0) {
                let dmg = 1;
                if (this.isPowerupActive('shield')) dmg = Math.max(1, Math.floor(dmg / 2));
                this.player.hp -= dmg;
                bus.emit(SFX.TAKE_DAMAGE);
                this.player._hazardCd = 800;
                this.player.invulnTimer = 400;
                this.cameras.main.shake(120, 0.006);
                this.showFloatingText(this.player.x, this.player.y - 30,
                    onHotPan ? '🔥' : '🌵', '#ff6060', 24);
                this._combo = 0;
            }
            if (onVines) speedMul *= 0.45;
            if (this.isPowerupActive('speed')) speedMul *= 1.4;
            // Crouch verb — slower but harder to detect (stealth suspicion ramp halved in aiStealthPatrol)
            if (this.player.crouch) speedMul *= 0.6;
            const tx = ix * PLAYER.speed * speedMul;
            const ty = iy * PLAYER.speed * speedMul;
            // Butter = no friction, low control (slip)
            const accel = onButter ? PLAYER.accel * 0.25 : PLAYER.accel;
            const friction = onButter ? PLAYER.friction * 0.15 : PLAYER.friction;
            this.player.vx = approach(this.player.vx, tx, (ix !== 0 ? accel : friction) * dt);
            this.player.vy = approach(this.player.vy, ty, (iy !== 0 ? accel : friction) * dt);
        }
        if (this.player.dashCooldown > 0) this.player.dashCooldown -= dt * 1000;

        if (ix > 0.1) this.player.facing = 1;
        else if (ix < -0.1) this.player.facing = -1;

        // Aim priority: 1) touch aim stick, 2) ARROW KEYS, 3) mouse, 4) movement direction
        let aimed = false;
        if (this.aimStick && this.aimStick.active) {
            const al = Math.hypot(this.aimStick.dx, this.aimStick.dy);
            if (al > 0.15) {
                this.player.aimAngle = Math.atan2(this.aimStick.dy, this.aimStick.dx);
                aimed = true;
            }
        }
        // Q/E — smooth 360° rotation of aim direction (trackpad/no-mouse comfort)
        const rotSpeed = 4.2 * dt;   // ~240°/sec
        if (this.keys.Q.isDown) { this.player.aimAngle = (this.player.aimAngle || 0) - rotSpeed; aimed = true; }
        if (this.keys.E.isDown) { this.player.aimAngle = (this.player.aimAngle || 0) + rotSpeed; aimed = true; }
        // Arrow keys = 8-directional snap aim
        if (!aimed) {
            let ax = 0, ay = 0;
            if (this.cursors.left.isDown)  ax -= 1;
            if (this.cursors.right.isDown) ax += 1;
            if (this.cursors.up.isDown)    ay -= 1;
            if (this.cursors.down.isDown)  ay += 1;
            if (ax !== 0 || ay !== 0) {
                this.player.aimAngle = Math.atan2(ay, ax);
                aimed = true;
            }
        }
        // Mouse pointer — ONLY if user actually moved the mouse recently (within last 800ms),
        // so Q/E and arrow-key aim aren't overridden by a stationary cursor
        if (!aimed) {
            const mouse = this.input.mousePointer;
            const recentlyMoved = (this.time.now - this._mouseMovedAt) < 800;
            if (recentlyMoved && mouse && mouse.x !== undefined && (mouse.x !== 0 || mouse.y !== 0)) {
                const cam = this.cameras.main;
                const cdx = mouse.x / this.dpr - this.viewW / 2;
                const cdy = mouse.y / this.dpr - this.viewH / 2;
                if (Math.hypot(cdx, cdy) > 2) {
                    this.player.aimAngle = Math.atan2(cdy, cdx);
                    aimed = true;
                }
            }
        }
        if (!aimed && (Math.abs(this.player.vx) > 30 || Math.abs(this.player.vy) > 30)) {
            this.player.aimAngle = Math.atan2(this.player.vy, this.player.vx);
        }

        this.moveWithWalls(this.player, PLAYER.radius, dt);

        const speed = Math.hypot(this.player.vx, this.player.vy);
        // Footsteps on a distance cadence: 240 px/s ÷ 92 px ≈ 2.6 steps/s at full speed.
        // Crouching = half the rate and quieter.
        if (!this.player.dashing && speed > 25) {
            this._stepDist = (this._stepDist || 0) + speed * dt;
            const stride = this.player.crouch ? 184 : 92;
            if (this._stepDist >= stride) {
                this._stepDist = 0;
                bus.emit(SFX.FOOTSTEP, this.player.crouch ? { vol: 0.45 } : undefined);
            }
        }
        this.animateSprite(this.player, 0.34, speed > 25, 0.22);
        this.player.shadow.setPosition(this.player.x, this.player.y + 32);
        this.player.shadow.setScale(speed > 25 ? 0.95 + Math.abs(Math.sin(this.player.walkPhase * 2)) * 0.08 : 1, 1);

        if (this.player.invulnTimer > 0) {
            this.player.invulnTimer -= dt * 1000;
            this.player.sprite.alpha = (Math.floor(this.time.now / 80) % 2) ? 0.4 : 1.0;
        } else {
            this.player.sprite.alpha = 1;
        }

        if (this.player.fireTimer > 0) this.player.fireTimer -= dt * 1000;

        // Continuous fire while button held — works for mouse, space, and touch aim stick simultaneously
        if (this.keys.SPACE.isDown) this.tryShoot();
        const mouse = this.input.mousePointer;
        if (mouse && mouse.isDown && !this._inExitBtnArea(mouse)) this.tryShoot();
        // Fire only when stick is actually pushed past the dead-zone (matches aim threshold at 1734)
        if (this.aimStick && this.aimStick.active &&
            Math.hypot(this.aimStick.dx, this.aimStick.dy) > 0.15) this.tryShoot();
    }

    _inExitBtnArea(p) {
        const e = this._hudLayout && this._hudLayout.exit;
        return !!(p && e && Math.hypot(p.x / this.dpr - e.cx, p.y / this.dpr - e.cy) < e.r + 10);
    }

    updateEnemyBolts(dt) {
        if (!this.enemyBolts) return;
        for (const b of this.enemyBolts) {
            if (b.dead) continue;
            b.life -= dt * 1000;
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            b.sprite.setPosition(b.x, b.y);
            b.glow.setPosition(b.x, b.y);
            // Pulse glow alpha
            b.glow.setAlpha(0.2 + 0.15 * Math.sin(this.time.now * 0.02));
            if (b.life <= 0 || this.pointInWalls(b.x, b.y, 6)) {
                b.dead = true;
                this.poofAt(b.x, b.y, 0xff4060);
            }
            // Hit player
            if (this.player.invulnTimer <= 0 &&
                Math.hypot(b.x - this.player.x, b.y - this.player.y) < PLAYER.radius + 6) {
                let dmg = 1;
                if (this.isPowerupActive('shield')) dmg = Math.max(1, Math.floor(dmg / 2));
                this.player.hp -= dmg;
                bus.emit(SFX.TAKE_DAMAGE);
                this.player.invulnTimer = PLAYER.invulnMs;
                this.cameras.main.shake(180, 0.010);
                this._combo = 0;
                b.dead = true;
                this.poofAt(b.x, b.y, 0xff4060);
            }
        }
        this.enemyBolts = this.enemyBolts.filter(b => {
            if (b.dead) { b.sprite.destroy(); b.glow.destroy(); return false; }
            return true;
        });
    }

    spawnDashTrail() {
        const ghost = this.add.image(this.player.x, this.player.y, this.player.sprite.texture.key)
            .setOrigin(0.5, 0.5)
            .setScale(this.player.sprite.scaleX, this.player.sprite.scaleY)
            .setAlpha(0.45)
            .setTint(0x80c0ff)
            .setDepth(199);
        this.tweens.add({
            targets: ghost, alpha: 0, scaleX: ghost.scaleX * 0.7, scaleY: ghost.scaleY * 0.7,
            duration: 280, onComplete: () => ghost.destroy()
        });
    }

    tryShoot() {
        if (this.player.fireTimer > 0) return;
        this.player.fireTimer = PLAYER.fireCooldownMs * (this.fireCdMul || 1);
        bus.emit(SFX.FIRE_PIE);
        // Pie Storm relic — 5-way fan instead of triple-shot
        this._pieStormBurst = this.relicPieStorm === true;
        let angle = this.player.aimAngle || 0;
        // Soft aim assist
        const SNAP_CONE = Math.PI / 12;
        const SNAP_RANGE = 500;
        let bestEnemy = null, bestDelta = SNAP_CONE;
        for (const e of this.enemies) {
            if (e.dead) continue;
            const ex = e.x - this.player.x;
            const ey = e.y - this.player.y;
            const d = Math.hypot(ex, ey);
            if (d > SNAP_RANGE || d < 10) continue;
            const enemyAngle = Math.atan2(ey, ex);
            let delta = Math.abs(angle - enemyAngle);
            if (delta > Math.PI) delta = Math.PI * 2 - delta;
            if (delta < bestDelta) {
                bestDelta = delta;
                bestEnemy = e;
            }
        }
        if (bestEnemy) {
            angle = Math.atan2(bestEnemy.y - this.player.y, bestEnemy.x - this.player.x);
        }
        // Power-up: triple shot — three pies in a 30° spread
        const isTriple = this.isPowerupActive('triple');
        let angles = isTriple ? [angle - 0.26, angle, angle + 0.26] : [angle];
        // Pie Storm relic — 5-way fan (overrides triple)
        if (this._pieStormBurst) {
            angles = [angle - 0.5, angle - 0.25, angle, angle + 0.25, angle + 0.5];
        }
        // Spread relic — every Nth fire adds 2 side pies
        if (this.relicSpreadEvery) {
            this._spreadCounter = (this._spreadCounter || 0) + 1;
            if (this._spreadCounter >= this.relicSpreadEvery) {
                this._spreadCounter = 0;
                angles = [...angles, angle - 0.35, angle + 0.35];
            }
        }
        const isFire = this.isPowerupActive('fire');
        const pieScale = 0.7 * (this.pieSizeMul || 1);
        // GOLD PIE relic — every 10th shot is huge and explodes
        let isGoldPie = false;
        if (this.relicGoldPieEvery) {
            this._goldPieCounter = (this._goldPieCounter || 0) + 1;
            if (this._goldPieCounter >= this.relicGoldPieEvery) {
                this._goldPieCounter = 0;
                isGoldPie = true;
            }
        }
        for (const a of angles) {
            const vx = Math.cos(a) * PIE.speed;
            const vy = Math.sin(a) * PIE.speed;
            const off = PLAYER.radius + 4;
            const sx = this.player.x + Math.cos(a) * off;
            const sy = this.player.y + Math.sin(a) * off;
            const sprite = this.add.image(sx, sy, 'd_pie')
                .setScale(pieScale * (isGoldPie ? 2.2 : 1))
                .setDepth(180);
            if (isFire) sprite.setTint(0xff5020);
            if (isGoldPie) sprite.setTint(0xffd040);
            this.tweens.add({ targets: sprite, angle: 360, duration: 600, repeat: -1 });
            this.projectiles.push({ sprite, x: sx, y: sy, vx, vy, life: PIE.life, fire: isFire,
                                    radius: PIE.radius * (this.pieSizeMul || 1) * (isGoldPie ? 2 : 1),
                                    _goldPie: isGoldPie });
        }
    }

    updateProjectiles(dt) {
        for (const p of this.projectiles) {
            if (p.dead) continue;
            p.life -= dt * 1000;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.sprite.setPosition(p.x, p.y);
            if (p.life <= 0) p.dead = true;
            // Check wall collisions — bounce, break weak walls, or die
            const walls = this.queryWallsAround(p.x, p.y, PIE.radius + 4);
            for (const w of walls) {
                if (w.broken) continue;
                if (this.circleVsRect(p.x, p.y, PIE.radius, w)) {
                    if (w.weak) {
                        this.breakWeakWall(w);
                        p.dead = true;
                        this.poofAt(p.x, p.y, 0xf5b048);
                        break;
                    }
                    // BOUNCE relic — pies bounce off walls N times
                    const bouncesLeft = (p._bouncesLeft === undefined)
                        ? (this.relicBounce || 0)
                        : p._bouncesLeft;
                    if (bouncesLeft > 0) {
                        p._bouncesLeft = bouncesLeft - 1;
                        // Determine which axis to reflect on by overlap depth
                        const overlapX = Math.min(Math.abs(p.x - w.x), Math.abs(p.x - (w.x + w.w)));
                        const overlapY = Math.min(Math.abs(p.y - w.y), Math.abs(p.y - (w.y + w.h)));
                        if (overlapX < overlapY) p.vx = -p.vx;
                        else p.vy = -p.vy;
                        // Push pie out of wall slightly so it doesn't re-collide same frame
                        p.x += p.vx * dt * 0.3;
                        p.y += p.vy * dt * 0.3;
                        p.sprite.setPosition(p.x, p.y);
                        this.poofAt(p.x, p.y, 0xffa040);
                        bus.emit(SFX.HIT_WALL);
                        break;
                    }
                    p.dead = true;
                    this.poofAt(p.x, p.y, 0xf5b048);
                    bus.emit(SFX.HIT_WALL);
                    // GOLD PIE relic — every 10th pie explodes on impact (AoE)
                    if (p._goldPie) this._goldPieExplosion(p.x, p.y);
                    break;
                }
            }
        }
        this.projectiles = this.projectiles.filter(p => {
            if (p.dead) { p.sprite.destroy(); return false; }
            return true;
        });
    }

    _goldPieExplosion(x, y) {
        this.cameras.main.shake(180, 0.012);
        for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2;
            const sp = Phaser.Math.Between(120, 200);
            const p = this.add.circle(x, y, Phaser.Math.Between(3, 6), 0xffd040, 0.95).setDepth(610);
            this.tweens.add({
                targets: p, x: x + Math.cos(a) * sp, y: y + Math.sin(a) * sp,
                alpha: 0, scale: 0.2, duration: 420, ease: 'Quad.easeOut',
                onComplete: () => p.destroy()
            });
        }
        for (const e of this.enemies) {
            if (e.dead) continue;
            if (Math.hypot(e.x - x, e.y - y) < 100) {
                this.damageEnemy(e, 2, e.x - x, e.y - y);
            }
        }
    }

    // =================================================================
    // ENEMIES
    // =================================================================
    spawnEnemies() {
        const rooms = this.dungeon.rooms;
        const exitRoomIdx = this.exitRoomIdx;
        const keyRoomIdx = this.keyRoomIdx;
        // Reset per-floor stealth state
        this._alarmedRooms = new Set();
        this._roomAlarmCooldowns = {};

        // Mode-aware scaling (Story linear, Endless log past ch5)
        const scale = scaleForFloor(this.chapter, this.runMode);
        const chapterMul = scale.hpMul;
        // Per-biome density multiplier (library = stealth-light, throne = boss focus)
        const biomeDensity = this.biome.enemyDensityMul || 1.0;
        const baseCount = Math.max(1, Math.round((2 + Math.floor((this.chapter - 1) * 0.7)) * biomeDensity * scale.countMul));
        const keyRoomEnemies = Math.min(7, Math.round((3 + Math.floor((this.chapter - 1) * 1)) * biomeDensity));
        // Add new biome-specific enemies into the mix (skeleton gated to ch>=2 on dungeon)
        const weights = { ...(this.biome.enemyWeights || { zombie: 1, cat: 1, slime: 1, bat: 0 }) };
        if (this.biome.id === 'library' && this.chapter >= 2) weights.ghost = 2;
        if (this.biome.id === 'dungeon' && this.chapter >= 2) weights.skeleton = 1;
        if (this.biome.id === 'throne')  { weights.skeleton = 2; weights.ghost = 1; }

        for (let i = 1; i < rooms.length; i++) {
            // Stealth rooms get a guard instead — handled separately below
            if (this.stealthRoomIdxs?.includes(i)) continue;
            const room = rooms[i];
            const isExit = (i === exitRoomIdx);
            const isKey = (i === keyRoomIdx);
            let enemyCount;
            if (isExit) enemyCount = this.isFinalFloor ? 0 : 1;
            else if (isKey) enemyCount = keyRoomEnemies;
            else enemyCount = baseCount + (Math.random() < 0.4 ? 1 : 0);

            for (let j = 0; j < enemyCount; j++) {
                const kind = weightedPick(weights) || 'zombie';
                let x = 0, y = 0, tries = 0;
                do {
                    x = room.x + Phaser.Math.Between(60, Math.max(61, room.w - 60));
                    y = room.y + Phaser.Math.Between(60, Math.max(61, room.h - 60));
                    tries++;
                } while (this.pointInWalls(x, y, 35) && tries < 30);
                if (this.pointInWalls(x, y, 35)) continue;
                const enemy = this.spawnEnemy(kind, x, y);
                if (enemy) {
                    enemy.roomId = i;       // tag with originating room for per-room alarm scope
                    if (this.chapter > 1) {
                        enemy.hp = Math.ceil(enemy.def.hp * chapterMul);
                        enemy.maxHp = enemy.hp;
                    }
                }
            }
        }

        // Stealth rooms — guard + chest
        this.spawnStealthRooms();
        // 1-2 mimic enemies disguised as chests in random rooms (floor 2+)
        if (this.chapter >= 2) this.spawnMimics();
        // 1-2 hidden chambers behind cracked walls (shoot to break)
        this.spawnWeakWalls();

        // BOSS only on final story floor — endless never spawns the boss
        if (this.isFinalFloor && this.runMode === 'story') {
            const bossRoom = rooms[exitRoomIdx];
            const boss = this.spawnEnemy('boss', bossRoom.x + bossRoom.w / 2, bossRoom.y + bossRoom.h / 2 - 60);
            // Boss scaling — softer than enemies so it stays beatable on first try
            if (boss && this.chapter > 1) {
                boss.hp = Math.ceil(boss.def.hp * (1 + (this.chapter - 1) * 0.30));
                boss.maxHp = boss.hp;
            }
        }
    }

    // =================================================================
    // POWER-UPS — temporary buffs scattered in 2-3 random rooms
    // =================================================================
    spawnPowerups() {
        const types = ['triple', 'speed', 'shield', 'fire'];
        const eligible = [];
        for (let i = 1; i < this.dungeon.rooms.length; i++) {
            if (i === this.exitRoomIdx) continue;
            if (i === this.keyRoomIdx) continue;
            eligible.push(i);
        }
        Phaser.Utils.Array.Shuffle(eligible);
        const count = Math.min(eligible.length, 2 + Math.floor(this.chapter / 2));
        for (let i = 0; i < count; i++) {
            const room = this.dungeon.rooms[eligible[i]];
            const type = types[Math.floor(Math.random() * types.length)];
            const x = room.x + room.w / 2 + Phaser.Math.Between(-50, 50);
            const y = room.y + room.h / 2 + Phaser.Math.Between(-50, 50);
            if (this.pointInWalls(x, y, 25)) continue;
            this.placePowerup(x, y, type);
        }
        // RELIC CHEST — 1 per floor in a random non-goal room (gated to floor 2+)
        if (this.chapter >= 2 && eligible.length > count) {
            const relicRoomIdx = eligible[count];
            const room = this.dungeon.rooms[relicRoomIdx];
            const rx = room.x + room.w / 2 + Phaser.Math.Between(-40, 40);
            const ry = room.y + room.h / 2 + Phaser.Math.Between(-40, 40);
            if (!this.pointInWalls(rx, ry, 28)) this.placeRelicChest(rx, ry);
        }
    }

    placeRelicChest(x, y) {
        const sprite = this._worldImage(x, y, 'relic_urn', 160, 0.5, 0.85);
        const glow = this.add.circle(x, y - 17, 32, 0xa080ff, 0.40).setDepth(159);
        this.tweens.add({ targets: glow, scale: 1.5, alpha: 0.15,
            duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.tweens.add({ targets: sprite, y: y - 6,
            duration: 1000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.relicChests = this.relicChests || [];
        this.relicChests.push({ sprite, glow, x, y, taken: false });
    }

    openRelicChest(rc) {
        if (rc.taken) return;
        rc.taken = true;
        bus.emit(SFX.OPEN_CHEST);
        this.tweens.add({ targets: rc.sprite, scale: 2 / this.dpr, alpha: 0, duration: 400,
            onComplete: () => rc.sprite.destroy() });
        this.tweens.add({ targets: rc.glow, scale: 2, alpha: 0, duration: 400,
            onComplete: () => rc.glow.destroy() });
        this.showRelicPicker();
    }

    placePowerup(x, y, type) {
        const tint  = { triple: 0xff70a0, speed: 0xfff060, shield: 0x60a0ff, fire: 0xff8030 }[type];
        const sprite = this.add.image(x, y, POWERUP_ICON[type] || 'ui_bolt')
            .setDisplaySize(34, 34).setDepth(160);
        const glow = this.add.circle(x, y, 28, tint, 0.30).setDepth(159);
        this.tweens.add({
            targets: sprite, y: y - 8, duration: 800,
            yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
        });
        this.tweens.add({
            targets: glow, scale: 1.4, alpha: 0.08,
            duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
        });
        this.powerups.push({ sprite, glow, x, y, type, tint, taken: false });
    }

    collectPowerup(p) {
        if (p.taken) return;
        p.taken = true;
        bus.emit(SFX.COLLECT_POWERUP);
        const DURATION = 12000;
        this.activePowerup = { type: p.type, tint: p.tint, endTime: this.time.now + DURATION };
        this.poofAt(p.x, p.y, p.tint);
        this.tweens.add({
            targets: p.sprite, scale: p.sprite.scaleX * 1.8, alpha: 0, y: p.y - 30,
            duration: 350, onComplete: () => p.sprite.destroy()
        });
        this.tweens.add({
            targets: p.glow, scale: 1.8, alpha: 0, y: p.y - 30,
            duration: 350, onComplete: () => p.glow.destroy()
        });
        const name = { triple: 'ТРИ ПИРОГА', speed: 'СКОРОСТЬ', shield: 'ЩИТ', fire: 'ОГНЕННЫЕ ПИРОГИ' }[p.type];
        this.showFloatingText(p.x, p.y - 30, name + '!', '#' + p.tint.toString(16).padStart(6, '0'), 26);
    }

    isPowerupActive(type) {
        return this.activePowerup &&
               this.activePowerup.type === type &&
               this.time.now < this.activePowerup.endTime;
    }

    // === BOSS PHASES ===
    bossPhase2(e) {
        e.phase2 = true;
        bus.emit(SFX.BOSS_PHASE);
        // Brief invulnerability + spawn helpers
        e.invulnUntil = this.time.now + 2200;
        e.sprite.setTint(0xc080ff);
        // Pulse aura
        const aura = this.add.circle(e.x, e.y, 80, 0xa080ff, 0.45).setDepth(189);
        this.tweens.add({ targets: aura, scale: 2.5, alpha: 0,
            duration: 800, onComplete: () => aura.destroy() });
        // Summon 2 skeletons
        for (let i = 0; i < 2; i++) {
            const angle = (i / 2) * Math.PI * 2 + Math.PI / 4;
            const sx = e.x + Math.cos(angle) * 90;
            const sy = e.y + Math.sin(angle) * 90;
            if (!this.pointInWalls(sx, sy, 30)) {
                const minion = this.spawnEnemy('skeleton', sx, sy);
                if (minion) {
                    // Spawn-in effect
                    minion.sprite.setAlpha(0);
                    this.tweens.add({ targets: minion.sprite, alpha: 1, duration: 500 });
                }
            }
        }
        this.cameras.main.shake(500, 0.018);
        this.showFloatingText(e.x, e.y - 50, 'ВОССТАНИТЕ, СЛУГИ!', '#ff80ff', 30);
    }

    bossPhase3(e) {
        e.phase3 = true;
        bus.emit(SFX.BOSS_PHASE);
        // Rage — faster + damage boost (mutate def)
        e.def = { ...e.def, speed: e.def.speed * 1.7, damage: e.def.damage + 1 };
        e.invulnUntil = this.time.now + 1500;
        e.sprite.setTint(0xff4040);
        // Big red shockwave
        const shock = this.add.circle(e.x, e.y, 50, 0xff2020, 0.7).setDepth(189);
        this.tweens.add({ targets: shock, scale: 5, alpha: 0,
            duration: 900, onComplete: () => shock.destroy() });
        this.cameras.main.shake(900, 0.028);
        this.showFloatingText(e.x, e.y - 50, '⚡ ЯРОСТЬ! ⚡', '#ff0000', 38);
    }

    // === HIDDEN CHAMBERS — cracked walls you can break with a pie ===
    spawnWeakWalls() {
        const count = Phaser.Math.Between(1, 2);
        let placed = 0, attempts = 0;
        const used = new Set();
        while (placed < count && attempts < 80) {
            attempts++;
            const idx = Phaser.Math.Between(0, this.walls.length - 1);
            if (used.has(idx)) continue;
            const w = this.walls[idx];
            // Want medium-sized wall blocks (not corner pieces, not borders)
            const area = w.w * w.h;
            if (area < 1200 || area > 3500) continue;
            if (w.x < 80 || w.y < 80 || w.x + w.w > WORLD_W - 80 || w.y + w.h > WORLD_H - 80) continue;
            used.add(idx);
            w.weak = true;
            w.crackHp = 1;   // one pie hit
            // Crack overlay tiles on the wall's cells, pulsing via per-tile alpha
            const r = w.y / NAV_CELL, c0 = w.x / NAV_CELL, cells = w.w / NAV_CELL;
            const tiles = [];
            for (let c = c0; c < c0 + cells; c++) tiles.push(this.crackLayer.putTileAt(TILE.WEAK_CRACK, c, r));
            this.tweens.add({
                targets: tiles, alpha: 0.4,
                duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
            });
            w.crackTiles = tiles;
            placed++;
        }
    }

    breakWeakWall(wall) {
        if (wall.broken) return;
        wall.broken = true;
        bus.emit(SFX.HIT_WALL);
        if (wall.crackTiles) { this.tweens.killTweensOf(wall.crackTiles); wall.crackTiles = null; }
        // Swap the wall's cells for floor plates; neighbours get the skirting/cant they now border
        const b = this.biome;
        const r = Math.floor(wall.y / NAV_CELL), c0 = Math.floor(wall.x / NAV_CELL);
        for (let c = c0; c < c0 + Math.round(wall.w / NAV_CELL); c++) {
            this.wallLayer.removeTileAt(c, r);
            this.crackLayer.removeTileAt(c, r);
            this.floorLayer.putTileAt(this.plateTile(r, c), c, r);
            const above = this.wallLayer.getTileAt(c, r - 1), below = this.wallLayer.getTileAt(c, r + 1);
            if (above && above.index >= TILE.WALL) above.index = TILE.WALL + ((above.index - TILE.WALL) | 2);
            if (below && below.index >= TILE.WALL) below.index = TILE.WALL + ((below.index - TILE.WALL) | 1);
        }
        // Burst of debris
        const cx = wall.x + wall.w / 2;
        const cy = wall.y + wall.h / 2;
        for (let i = 0; i < 16; i++) {
            const ang = Math.random() * Math.PI * 2;
            const d = Phaser.Math.Between(30, 90);
            const p = this.add.rectangle(cx, cy, Phaser.Math.Between(4, 8), Phaser.Math.Between(4, 8),
                b.wallFill, 1).setDepth(600);
            p.setStrokeStyle(1, b.wallShadow, 1);
            this.tweens.add({
                targets: p,
                x: cx + Math.cos(ang) * d,
                y: cy + Math.sin(ang) * d,
                alpha: 0, angle: Phaser.Math.Between(-180, 180),
                duration: 700, ease: 'Quad.easeOut',
                onComplete: () => p.destroy()
            });
        }
        // Camera kick
        this.cameras.main.shake(160, 0.008);
        // Drop a chest where the wall was
        this.spawnChest(cx, cy);
        this.showFloatingText(cx, cy - 30, '🎁 СЕКРЕТ!', '#80c0ff', 26);
    }

    // Place 1-2 mimic enemies (disguised as chests)
    spawnMimics() {
        const count = (this.chapter >= 4) ? 2 : 1;
        let placed = 0, attempts = 0;
        while (placed < count && attempts < 30) {
            attempts++;
            const idx = Phaser.Math.Between(1, this.dungeon.rooms.length - 1);
            if (idx === this.exitRoomIdx || idx === this.keyRoomIdx) continue;
            if (this.stealthRoomIdxs?.includes(idx)) continue;
            const room = this.dungeon.rooms[idx];
            const x = room.x + Phaser.Math.Between(80, room.w - 80);
            const y = room.y + Phaser.Math.Between(80, room.h - 80);
            if (this.pointInWalls(x, y, 30)) continue;
            this.spawnEnemy('mimic', x, y);
            placed++;
        }
    }

    // === STEALTH ROOMS ===
    spawnStealthRooms() {
        this.chests = this.chests || [];
        this.forbiddenBooks = this.forbiddenBooks || [];
        if (!this.stealthRoomIdxs || this.stealthRoomIdxs.length === 0) return;
        for (const idx of this.stealthRoomIdxs) {
            const room = this.dungeon.rooms[idx];
            // Guard in the center of the room
            const gx = room.x + room.w / 2;
            const gy = room.y + room.h / 2;
            if (!this.pointInWalls(gx, gy, 40)) {
                const guard = this.spawnEnemy('guard', gx, gy);
                guard.roomId = idx;
                // Patrol line along the longer axis (horizontal for wider rooms, vertical otherwise)
                const horizontal = room.w >= room.h;
                const margin = 90;
                if (horizontal) {
                    guard.patrolA = { x: room.x + margin, y: gy };
                    guard.patrolB = { x: room.x + room.w - margin, y: gy };
                } else {
                    guard.patrolA = { x: gx, y: room.y + margin };
                    guard.patrolB = { x: gx, y: room.y + room.h - margin };
                }
                guard.patrolToB = true;
                guard.facingAngle = horizontal ? 0 : Math.PI / 2;
                guard.alarmed = false;
                guard.suspicion = 0;
                guard.coneGfx = this.add.graphics().setDepth(83);
                guard.sprite.setTint(0x6080a0);
                guard.zzz = this._worldImage(gx, gy - 60, 'badge_sleep', 190).setAlpha(0.85);
            }
            // Chest in opposite corner
            const chestX = room.x + room.w - 70;
            const chestY = room.y + room.h - 70;
            if (!this.pointInWalls(chestX, chestY, 30)) {
                this.spawnChest(chestX, chestY);
            } else {
                const alt = this.findFloorInRoom(room, 30);
                if (alt) this.spawnChest(alt.x, alt.y);
            }
            // === FORBIDDEN BOOK: only in library biome — pulses, touch unalarmed = +1 dmg perm + score ===
            if (this.biome?.id === 'library') {
                const candidates = [
                    { x: room.x + 70, y: room.y + 70 },
                    { x: room.x + room.w - 70, y: room.y + 70 },
                    { x: room.x + 70, y: room.y + room.h - 70 }
                ];
                for (const c of candidates) {
                    if (this.pointInWalls(c.x, c.y, 24)) continue;
                    const sprite = this._worldImage(c.x, c.y, 'book_forbidden', 155, 0.5, 0.8);
                    const glow = this.add.circle(c.x, c.y - 12, 24, 0xff60ff, 0.30).setDepth(154);
                    this.tweens.add({ targets: glow, alpha: 0.10, scale: 1.6,
                        duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
                    this.tweens.add({ targets: sprite, y: c.y - 6,
                        duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
                    this.forbiddenBooks.push({ sprite, glow, x: c.x, y: c.y, roomId: idx, taken: false });
                    break;  // one book per stealth room
                }
            }
        }
    }

    // Touch handling for forbidden books — called from update() collision loop
    checkForbiddenBookPickup() {
        if (!this.forbiddenBooks || this.forbiddenBooks.length === 0) return;
        for (const b of this.forbiddenBooks) {
            if (b.taken) continue;
            const d = Math.hypot(b.x - this.player.x, b.y - this.player.y);
            if (d > 36) continue;
            const alarmed = this._alarmedRooms?.has(b.roomId);
            if (alarmed) {
                this.showFloatingText(b.x, b.y - 30, 'Слишком шумно...', '#ff8080', 18);
                continue;
            }
            b.taken = true;
            this.pieDmgBonus = (this.pieDmgBonus || 0) + 1;   // permanent for this run
            this.score += 100;
            this.runCheeseTotal = (this.runCheeseTotal || 0) + 20;
            this.showFloatingText(b.x, b.y - 30, '📕 +1 урон навсегда!', '#ff60ff', 22);
            bus.emit(SFX.OPEN_CHEST);
            this.tweens.add({
                targets: b.sprite, scale: 2 / this.dpr, alpha: 0, y: b.y - 50, duration: 500,
                onComplete: () => b.sprite.destroy()
            });
            this.tweens.add({
                targets: b.glow, scale: 2, alpha: 0, y: b.y - 50, duration: 500,
                onComplete: () => b.glow.destroy()
            });
        }
    }

    // Library stealth patrol — wander slowly, change facing every few seconds, raise alarm if Pi enters cone
    aiStealthPatrol(e, dt) {
        // ALARMED: switch to chase + cone tracks player even when stationary
        if (e.alarmed) {
            const dx = this.player.x - e.x;
            const dy = this.player.y - e.y;
            const dist = Math.hypot(dx, dy);
            // FACE THE PLAYER — bearing-based smoothing (works even if enemy is stationary/wedged)
            const targetAng = Math.atan2(dy, dx);
            const maxRot = 6.0 * dt;   // ~6 rad/s = ~344°/s — snappy but not instant
            let delta = targetAng - (e.facingAngle || 0);
            while (delta > Math.PI) delta -= Math.PI * 2;
            while (delta < -Math.PI) delta += Math.PI * 2;
            const turn = Math.max(-maxRot, Math.min(maxRot, delta));
            e.facingAngle = (e.facingAngle || 0) + turn;
            // Movement: chase if speed > 0. Pass actual LOS state — if wall blocks,
            // aiPathChase will use A* pathfinding to lastSeen instead of running into wall.
            if (e.def.speed > 0) {
                if (!e.lastSeen) e.lastSeen = { x: 0, y: 0 };
                e.lastSeen.x = this.player.x; e.lastSeen.y = this.player.y;
                e.alertTimer = e.def.alertMs || 4000;
                const seesNow = this._cachedSeesPlayer(e);
                this.aiPathChase(e, dt, dx, dy, dist, seesNow);
            }
            // Chef throws plates while chasing
            if (e.kind === 'chef') {
                e.shootCd = (e.shootCd || 0) - dt * 1000;
                if (e.shootCd <= 0 && dist < 480) {
                    e.shootCd = e.def.plateCooldownMs || 1800;
                    this.spawnEnemyBolt(e.x, e.y, this.player.x, this.player.y, e.def.plateSpeed || 240, 0xf0e0c0, true);
                }
            }
            // Render the angry red cone — always redraw when alarmed (no dirty-flag skip)
            const origDef = e.def;
            e.def = { ...origDef, coneAngle: e.coneAngle, coneRange: e.coneRange };
            e._forceConeRedraw = true;
            this.renderVisionCone(e);
            e.def = origDef;
            return;
        }
        // Patrol behavior — slow facing rotation (max 1.5 rad/s so cone never snaps to player)
        e.facingChangeTimer -= dt * 1000;
        if (e.facingChangeTimer <= 0) {
            e.facingChangeTimer = Phaser.Math.Between(2500, 5000);
            // Set TARGET facing — rotate toward it slowly per frame instead of tweening
            e._facingTarget = e.facingAngle + (Math.random() - 0.5) * Math.PI * 1.0;
        }
        if (e._facingTarget !== undefined) {
            const maxStep = 1.5 * dt;
            let delta = e._facingTarget - e.facingAngle;
            while (delta > Math.PI) delta -= Math.PI * 2;
            while (delta < -Math.PI) delta += Math.PI * 2;
            if (Math.abs(delta) <= maxStep) e.facingAngle = e._facingTarget;
            else e.facingAngle += Math.sign(delta) * maxStep;
        }
        // Slow wander forward (skip if def.speed is 0 — stationary types like snapdragon)
        const baseSp = e.def.speed === 0 ? 0 : 28;
        e.vx = approach(e.vx, Math.cos(e.facingAngle) * baseSp, 250 * dt);
        e.vy = approach(e.vy, Math.sin(e.facingAngle) * baseSp, 250 * dt);

        // Cone color from suspicion: yellow → orange → red
        const sus = e.suspicion || 0;
        e._coneTintFactor = sus;
        const origDef = e.def;
        e.def = { ...origDef, coneAngle: e.coneAngle, coneRange: e.coneRange };
        this.renderVisionCone(e);
        e.def = origDef;

        // Two-stage suspicion: in-cone accumulates, out-of-cone drains
        let inCone = this.playerInConeCustom(e, e.coneAngle, e.coneRange);
        // KITCHEN: flour cloud over enemy → blinds them, no detection
        if (inCone && this.flourClouds) {
            for (const cl of this.flourClouds) {
                if (cl.endTime < this.time.now) continue;
                if (Math.hypot(e.x - cl.x, e.y - cl.y) < cl.radius) {
                    inCone = false;
                    break;
                }
            }
        }
        // Crouch + ghost-walk relic: slower suspicion ramp
        let ramp = this.player?.crouch ? 0.5 : 1.0;
        if (this.relicGhostWalk) ramp *= 0.5;
        const detectSecs = 0.8;  // full alarm in 0.8s of solid stare
        if (inCone) {
            e.suspicion = Math.min(1.0, sus + ramp * dt / detectSecs);
            // Brief sus-tick chirp
            if (sus < 0.3 && e.suspicion >= 0.3) {
                bus.emit(SFX.SUSPICION_TICK);
                const t = this.add.text(e.x, e.y - 50, '?', { fontSize: '28px', color: '#ffd040' })
                    .setOrigin(0.5).setDepth(800);
                this.tweens.add({ targets: t, y: e.y - 80, alpha: 0, duration: 700,
                    onComplete: () => t.destroy() });
            }
            if (e.suspicion >= 1.0 && !e.alarmed) {
                this._raiseAlarm(e);
            }
        } else {
            e.suspicion = Math.max(0, sus - 0.5 * dt);
        }
    }

    _raiseAlarm(e) {
        e.alarmed = true;
        e.suspicion = 1.0;
        if (!this._alarmedRooms) this._alarmedRooms = new Set();
        if (e.roomId !== undefined) this._alarmedRooms.add(e.roomId);
        this.runAlarmCount = (this.runAlarmCount || 0) + 1;
        bus.emit(SFX.ALARM_TRIGGER);
        // Red camera flash — player feels "I'm caught"
        this.cameras.main.flash(280, 200, 30, 30);
        this.cameras.main.shake(180, 0.012);
        const t = this._worldImage(e.x, e.y - 50, 'badge_alert', 800);
        this.tweens.add({ targets: t, y: e.y - 90, alpha: 0, duration: 900,
            onComplete: () => t.destroy() });
        if (e.zzz) { e.zzz.destroy(); e.zzz = null; }
        if (!e.lastSeen) e.lastSeen = { x: 0, y: 0 };
        e.lastSeen.x = this.player.x; e.lastSeen.y = this.player.y;
        e.alertTimer = e.def.alertMs;
        // Alert same-room cone enemies — soft propagation
        if (e.roomId !== undefined && this.enemies) {
            for (const other of this.enemies) {
                if (other === e || other.dead) continue;
                if (other.roomId !== e.roomId) continue;
                if (!other.stealthPatrol) continue;
                other.suspicion = Math.max(other.suspicion || 0, 0.6);
                if (!other.lastSeen) other.lastSeen = { x: 0, y: 0 };
                other.lastSeen.x = this.player.x; other.lastSeen.y = this.player.y;
            }
            // ALARM CONSEQUENCE: 1-2 enemies from neighbouring rooms come to investigate
            if (this.dungeon && this.dungeon.rooms && e.roomId !== undefined) {
                const myRoom = this.dungeon.rooms[e.roomId];
                if (myRoom) {
                    let called = 0;
                    for (const other of this.enemies) {
                        if (called >= 2) break;
                        if (other === e || other.dead) continue;
                        if (other.roomId === e.roomId) continue;
                        if (other.stealthPatrol) continue;   // cone enemies stay in their rooms
                        const dToCaller = Math.hypot(other.x - myRoom.x - myRoom.w/2, other.y - myRoom.y - myRoom.h/2);
                        if (dToCaller > 700) continue;       // only nearby neighbours
                        if (!other.lastSeen) other.lastSeen = { x: 0, y: 0 };
                        other.lastSeen.x = this.player.x; other.lastSeen.y = this.player.y;
                        other.alertTimer = other.def.alertMs || 4000;
                        called++;
                    }
                    if (called > 0) {
                        this.showFloatingText(this.player.x, this.player.y - 80,
                            `⚠️ +${called} врагов идут на шум!`, '#ff6060', 18);
                    }
                }
            }
            // ALARM CONSEQUENCE: cheese-in-room gets penalty flag (read in collectCheese)
            this._cheesePenaltyRooms = this._cheesePenaltyRooms || new Set();
            this._cheesePenaltyRooms.add(e.roomId);
        }
        // Per-room cooldown — alarm naturally clears after 12s of no re-detection
        if (this._roomAlarmCooldowns === undefined) this._roomAlarmCooldowns = {};
        const rid = e.roomId;
        if (rid !== undefined) {
            // Cancel any previous pending cooldown for this room
            const prev = this._roomAlarmCooldowns[rid];
            if (prev && typeof prev.remove === 'function') prev.remove();
            else if (prev && typeof prev.destroy === 'function') prev.destroy();
            const timer = this.time.delayedCall(12000, () => {
                if (this._alarmedRooms) this._alarmedRooms.delete(rid);
                // Reset enemies in that room to non-alarmed if still alive
                if (this.enemies) {
                    for (const en of this.enemies) {
                        if (en.dead) continue;
                        if (en.roomId === rid && en.stealthPatrol) {
                            en.alarmed = false;
                            en.suspicion = 0;
                        }
                    }
                }
                this.showFloatingText(this.player.x, this.player.y - 40, 'тишина...', '#80c0ff', 16);
            });
            this._roomAlarmCooldowns[rid] = timer;
        }
    }

    // Variant of playerInCone that takes explicit cone angle/range (since stealthPatrol enemies override e.def)
    playerInConeCustom(e, coneAngle, coneRange) {
        const dx = this.player.x - e.x;
        const dy = this.player.y - e.y;
        const dist = Math.hypot(dx, dy);
        if (dist > coneRange) return false;
        if (dist < 20) return true;
        const ang = Math.atan2(dy, dx);
        let delta = ang - e.facingAngle;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        if (Math.abs(delta) > coneAngle / 2) return false;
        return this.hasLineOfSight(e.x, e.y, this.player.x, this.player.y);
    }

    spawnChest(x, y) {
        const sprite = this._worldImage(x, y, 'chest_closed', 150, 0.5, 0.85);
        const glow = this.add.circle(x, y - 15, 28, 0xffd040, 0.25).setDepth(149);
        this.tweens.add({ targets: glow, alpha: 0.08, scale: 1.4,
            duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.tweens.add({ targets: sprite, y: y - 4,
            duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.chests = this.chests || [];
        this.chests.push({ sprite, glow, x, y, opened: false });
    }

    openChest(c) {
        if (c.opened) return;
        c.opened = true;
        bus.emit(SFX.OPEN_CHEST);
        c.sprite.setTexture('chest_open');
        // Chest reward depends on per-room alarm scope: if THIS room is unalarmed, big bonus
        const chestRoomId = this._findRoomIdForPoint(c.x, c.y);
        const stealthSuccess = !this._alarmedRooms || !this._alarmedRooms.has(chestRoomId);
        // Big bonus if you sneaked past unalarmed, small bonus otherwise
        let cheeseGain, scoreGain, msg, msgColor;
        if (stealthSuccess) {
            cheeseGain = 40 + Math.floor(Math.random() * 30);
            scoreGain = 150;
            msg = `🥷 +${cheeseGain} 🧀 +${scoreGain}!`;
            msgColor = '#80ff80';
            // Try to unlock a random locked skin as bonus
            const lockedSkins = SKINS.filter(sk => !Progress.isSkinUnlocked(sk.id) && sk.id !== 'blue');
            if (lockedSkins.length > 0 && Math.random() < 0.4) {
                const skin = lockedSkins[Math.floor(Math.random() * lockedSkins.length)];
                Progress.unlockSkin(skin.id);
                this.showFloatingText(c.x, c.y - 90, `Открыт скин: ${skin.name}`, '#80c0ff', 22);
            }
        } else {
            cheeseGain = 15 + Math.floor(Math.random() * 10);
            scoreGain = 50;
            msg = `+${cheeseGain} 🧀 +${scoreGain}`;
            msgColor = '#ffe080';
        }
        this.runCheeseTotal = (this.runCheeseTotal || 0) + cheeseGain;
        this.score += scoreGain;
        this.time.delayedCall(190, () => bus.emit(SFX.CHEST_COINS));
        this.showFloatingText(c.x, c.y - 40, msg, msgColor, 26);
        this.poofAt(c.x, c.y, 0xffd040);
        this.tweens.add({ targets: c.sprite,
            scale: 1.6 / this.dpr, alpha: 0, duration: 500,
            onComplete: () => c.sprite.destroy()
        });
        this.tweens.add({ targets: c.glow,
            scale: 1.6, alpha: 0, duration: 500,
            onComplete: () => c.glow.destroy()
        });
    }

    // === GUARD AI — patrol back and forth between A and B with visible vision cone ===
    aiGuard(e, dt) {
        if (e.alarmed) {
            // Once alarmed, behaves like a fast zombie with full chase
            const dx = this.player.x - e.x;
            const dy = this.player.y - e.y;
            const dist = Math.hypot(dx, dy);
            if (!e.lastSeen) e.lastSeen = { x: 0, y: 0 };
            e.lastSeen.x = this.player.x; e.lastSeen.y = this.player.y;
            e.alertTimer = 5000;
            // Boost speed
            const tmpDef = { ...e.def, speed: e.def.speed * e.def.alarmedSpeedMul };
            const orig = e.def; e.def = tmpDef;
            this.aiPathChase(e, dt, dx, dy, dist, this._cachedSeesPlayer(e));
            e.def = orig;
            // FACE THE PLAYER — bearing-based (works even when wedged in corner)
            const targetAng = Math.atan2(dy, dx);
            const maxRot = 6.0 * dt;
            let delta = targetAng - (e.facingAngle || 0);
            while (delta > Math.PI) delta -= Math.PI * 2;
            while (delta < -Math.PI) delta += Math.PI * 2;
            const turn = Math.max(-maxRot, Math.min(maxRot, delta));
            e.facingAngle = (e.facingAngle || 0) + turn;
            e._forceConeRedraw = true;
        } else {
            // Patrol between A and B
            const target = e.patrolToB ? e.patrolB : e.patrolA;
            const dx = target.x - e.x;
            const dy = target.y - e.y;
            const dist = Math.hypot(dx, dy);
            if (dist < 28) {
                e.patrolToB = !e.patrolToB;
                e.patrolPause = 1200;
                // Make guard look around — sweep facing
                this._addGuardLookAround(e);
            }
            e.patrolPause = (e.patrolPause || 0) - dt * 1000;
            if (e.patrolPause > 0) {
                e.vx *= 0.85; e.vy *= 0.85;
            } else if (dist > 0) {
                const sp = e.def.speed;
                e.vx = approach(e.vx, (dx / dist) * sp, 300 * dt);
                e.vy = approach(e.vy, (dy / dist) * sp, 300 * dt);
                e.facingAngle = Math.atan2(dy, dx);
            }
        }
        // Render vision cone every frame
        this.renderVisionCone(e);
        // Z Z Z text follows guard when patrolling
        if (e.zzz) {
            e.zzz.setPosition(e.x, e.y - 60);
            e.zzz.setVisible(!e.alarmed);
        }
        // Player in cone? → alarmed
        if (!e.alarmed && this.playerInCone(e)) {
            this.alarmGuard(e);
        }
    }

    _cachedSeesPlayer(e) {
        return e._cachedSees ?? true;
    }

    _addGuardLookAround(e) {
        // Quick rotate of facing by ±25° to feel alive
        const sweep = (Math.random() * 0.8 - 0.4);
        this.tweens.add({
            targets: e, facingAngle: e.facingAngle + sweep,
            duration: 600, yoyo: true, ease: 'Sine.easeInOut'
        });
    }

    alarmGuard(e) {
        // Delegate to unified _raiseAlarm (per-room scope + propagation)
        this._raiseAlarm(e);
        this.cameras.main.shake(200, 0.012);
    }

    _findRoomIdForPoint(x, y) {
        const rooms = this.dungeon?.rooms;
        if (!rooms) return -1;
        for (let i = 0; i < rooms.length; i++) {
            const r = rooms[i];
            if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
        }
        return -1;
    }

    renderVisionCone(e) {
        const g = e.coneGfx;
        if (!g) return;
        // CULL: skip cone render if enemy is off-screen — biggest perf win for library
        const cam = this.cameras.main;
        const margin = 50;
        if (e.x < cam.worldView.x - margin || e.x > cam.worldView.x + this.viewW + margin ||
            e.y < cam.worldView.y - margin || e.y > cam.worldView.y + this.viewH + margin) {
            if (g.visible) { g.clear(); g.setVisible(false); }
            return;
        }
        if (!g.visible) g.setVisible(true);
        // DIRTY-FLAG: skip redraw when cone hasn't changed (skip-check disabled if _forceConeRedraw set)
        if (!e._forceConeRedraw && e._coneLastAngle !== undefined &&
            Math.abs(e.facingAngle - e._coneLastAngle) < 0.02 &&
            Math.abs(e.x - e._coneLastX) < 4 &&
            Math.abs(e.y - e._coneLastY) < 4 &&
            e.alarmed === e._coneLastAlarmed) {
            return;
        }
        e._forceConeRedraw = false;
        e._coneLastAngle = e.facingAngle;
        e._coneLastX = e.x;
        e._coneLastY = e.y;
        e._coneLastAlarmed = e.alarmed;
        g.clear();
        const half = e.def.coneAngle / 2;
        const range = e.def.coneRange;
        const a = e.facingAngle;
        const x = e.x, y = e.y;
        // Cone color interpolates yellow→orange→red by suspicion (or fully red if alarmed)
        const sus = e.alarmed ? 1.0 : Math.min(1, e.suspicion || 0);
        // Lerp 0xffd040 (yellow) → 0xff8040 (orange) → 0xff2020 (red)
        let color;
        if (sus < 0.5) {
            // yellow → orange
            const t = sus / 0.5;
            const r = 0xff, gC = Math.round(0xd0 + (0x80 - 0xd0) * t), b = Math.round(0x40 + (0x40 - 0x40) * t);
            color = (r << 16) | (gC << 8) | b;
        } else {
            // orange → red
            const t = (sus - 0.5) / 0.5;
            const r = 0xff, gC = Math.round(0x80 + (0x20 - 0x80) * t), b = Math.round(0x40 + (0x20 - 0x40) * t);
            color = (r << 16) | (gC << 8) | b;
        }
        const alpha = 0.18 + 0.18 * sus;
        // Sprite tint matches suspicion — enemy visibly "noticing"
        if (e.sprite) {
            if (sus > 0.5) {
                const tintR = 0xff;
                const tintG = Math.round(0xff - (0xff - 0x80) * (sus - 0.5) * 2);
                const tintB = Math.round(0xff - (0xff - 0x80) * (sus - 0.5) * 2);
                e.sprite.setTint((tintR << 16) | (tintG << 8) | tintB);
            } else if (e._wasAlarmedSprite) {
                e.sprite.clearTint();
                e._wasAlarmedSprite = false;
            }
            if (sus > 0.5) e._wasAlarmedSprite = true;
        }
        const steps = 10;
        g.fillStyle(color, alpha);
        g.lineStyle(2, color, 0.50);
        g.beginPath();
        g.moveTo(x, y);
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const ang = a - half + half * 2 * t;
            const len = this.castRay(x, y, ang, range);
            g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
        }
        g.closePath();
        g.fillPath();
        g.strokePath();
    }

    castRay(x, y, angle, maxLen) {
        const cx = Math.cos(angle), sy = Math.sin(angle);
        // Larger step (24 → 40) — minor visual loss, ~40% fewer wall queries
        const step = 40;
        for (let d = step; d <= maxLen; d += step) {
            if (this.pointInWalls(x + cx * d, y + sy * d, 0)) return d - step;
        }
        return maxLen;
    }

    playerInCone(e) {
        const dx = this.player.x - e.x;
        const dy = this.player.y - e.y;
        const dist = Math.hypot(dx, dy);
        if (dist > e.def.coneRange) return false;
        if (dist < 20) return true;   // touching = alarmed
        const ang = Math.atan2(dy, dx);
        let delta = ang - e.facingAngle;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        if (Math.abs(delta) > e.def.coneAngle / 2) return false;
        return this.hasLineOfSight(e.x, e.y, this.player.x, this.player.y);
    }

    spawnEnemy(kind, x, y) {
        const def = ENEMY_DEFS[kind];
        // New biome enemies reuse existing sprites with tints
        let spriteKey;
        if (kind === 'boss' || kind === 'guard') spriteKey = 'd_zombie';
        else if (kind === 'chef') spriteKey = 'd_cat';            // chef-cat — tinted white
        else if (kind === 'librarian') spriteKey = 'd_zombie';    // tinted bronze
        else if (kind === 'snapdragon') spriteKey = 'd_slime';    // tinted magenta
        else spriteKey = 'd_' + kind;
        const sprite = this.add.image(x, y, spriteKey)
            .setOrigin(0.5, 0.5).setScale(def.scale).setDepth(190);
        if (kind === 'boss') sprite.setTint(0xc080ff);
        if (kind === 'ghost') sprite.setAlpha(0.4);
        if (kind === 'chef') sprite.setTint(0xffe0c0);
        if (kind === 'librarian') sprite.setTint(0xc88060);
        if (kind === 'snapdragon') sprite.setTint(0xff60c0);
        // Mimic starts disguised as a chest (kept below)
        // Mimic disguise — show a chest decoy over the sprite, hide real sprite until revealed
        let mimicDecoy = null;
        if (kind === 'mimic') {
            sprite.setVisible(false);
            mimicDecoy = this._worldImage(x, y, 'chest_closed', 189);
            this.tweens.add({ targets: mimicDecoy, y: y - 4,
                duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        }
        // NEW: only enemies in biome.coneEnemyKinds get cones (bats etc. never have cones)
        const coneKinds = this.biome?.coneEnemyKinds || [];
        const stealthMode = coneKinds.includes(kind) && kind !== 'boss';
        const shadow = this.add.ellipse(x, y + (kind === 'boss' ? 46 : (kind === 'bat' ? 18 : 26)),
            (kind === 'boss' ? 130 : 70) * def.scale * 1.6,
            kind === 'boss' ? 22 : 14, 0x000000, 0.5).setDepth(189);
        const enemy = {
            kind, def, sprite, shadow,
            x, y, vx: 0, vy: 0,
            hp: def.hp, maxHp: def.hp,
            facing: 1,
            hurtTimer: 0,
            stateTimer: Phaser.Math.Between(500, 1500),
            alertTimer: 0,
            lastSeen: null,
            pounceCooldown: 0,
            walkPhase: 0,
            repathTimer: Math.random() * 900,
            path: null,
            pathIdx: 0,
            slimePhase: 'idle',
            slimeT: 0,
            slimeDuration: 0,
            // Bat / Skeleton — projectile shooter cooldown
            shootCd: Phaser.Math.Between(800, 1600),
            hoverPhase: Math.random() * Math.PI * 2,
            // Ghost — solid/phase state
            solid: false, solidTimer: -Phaser.Math.Between(500, 2000),
            // Mimic — disguise state
            revealed: false, mimicDecoy: mimicDecoy, lungeCd: 0,
            dead: false
        };
        // Vision cone setup — only for whitelisted enemy kinds, with two-stage suspicion
        if (stealthMode) {
            enemy.stealthPatrol = true;
            enemy.alarmed = false;
            enemy.suspicion = 0;              // 0..1 — accumulates while in cone
            enemy.facingAngle = Math.random() * Math.PI * 2;
            enemy.facingChangeTimer = Phaser.Math.Between(2500, 5000);
            enemy.coneGfx = this.add.graphics().setDepth(83);
            enemy.coneAngle = def.coneAngle || Math.PI / 3.6;
            enemy.coneRange = def.coneRange || 220;
            // Small badge icon above stealth enemies so player can tell them apart from aggressive ones
            enemy.behaviorIcon = this.add.image(enemy.x, enemy.y - 56, 'ui_eye')
                .setDisplaySize(16, 16).setDepth(202).setAlpha(0.6);
        } else if (kind !== 'boss' && kind !== 'mimic') {
            // Aggressive enemies (always chase) — small red icon
            enemy.behaviorIcon = this._worldImage(enemy.x, enemy.y - 56, 'badge_anger', 202).setAlpha(0.45);
        }
        this.enemies.push(enemy);
        return enemy;
    }

    updateEnemies(dt) {
        // Refresh Dijkstra map ONCE per frame — all enemies share the same field
        this._updateDijkstraMaps();
        const cam = this.cameras.main;
        const margin = 600;            // distance from camera viewport beyond which we freeze enemies
        const viewLeft   = cam.worldView.x - margin;
        const viewTop    = cam.worldView.y - margin;
        const viewRight  = cam.worldView.x + this.viewW  + margin;
        const viewBottom = cam.worldView.y + this.viewH + margin;
        for (const e of this.enemies) {
            if (e.dead) continue;
            // Freeze far-away enemies (no AI, no path, no animation) — huge CPU saving
            if (e.x < viewLeft || e.x > viewRight || e.y < viewTop || e.y > viewBottom) {
                continue;
            }
            if (e.kind === 'boss' && !this._bossIntroDone
                && Math.hypot(e.x - this.player.x, e.y - this.player.y) < 520) {
                this._bossIntroDone = true;
                bus.emit(SFX.BOSS_INTRO);
            }
            this.updateEnemy(e, dt);
            const tx = e.lastSeen ? e.lastSeen.x : this.player.x;
            const dx = tx - e.x;
            if (dx > 4) e.facing = 1;
            else if (dx < -4) e.facing = -1;

            if (e.kind === 'slime') {
                this.animateSlime(e, e.def.scale);
            } else {
                const speed = Math.hypot(e.vx, e.vy);
                const wsm = e.kind === 'cat' ? 0.30 : (e.kind === 'boss' ? 0.13 : 0.16);
                this.animateSprite(e, e.def.scale, speed > 20, wsm);
            }
            e.shadow.setPosition(e.x, e.y + (e.kind === 'boss' ? 46 : 26));

            if (e.hurtTimer > 0) {
                e.hurtTimer -= dt * 1000;
                e.sprite.setTint(0xff8080);
            } else {
                if (e.kind === 'boss') e.sprite.setTint(0xc080ff);
                else e.sprite.clearTint();
            }
        }
        // In-place compaction — no new array/closure per substep
        let w = 0;
        for (let i = 0; i < this.enemies.length; i++) {
            const e = this.enemies[i];
            if (!(e.dead && e.cleanedUp)) this.enemies[w++] = e;
        }
        this.enemies.length = w;
    }

    _timeWarpFactor() {
        // TIMEWARP relic — when HP/maxHp < 30%, enemies near player slow down
        if (!this.relicTimeWarp || !this.player) return 1;
        if (this.player.hp / this.maxHp >= 0.30) return 1;
        return 0.55;
    }

    updateEnemy(e, dt) {
        // Update behaviour-type icon position + auto-fade once alarmed
        if (e.behaviorIcon) {
            e.behaviorIcon.setPosition(e.x, e.y - 56);
            if (e.alarmed && e.behaviorIcon.alpha > 0) {
                e.behaviorIcon.setAlpha(0);
            }
        }
        // Apply time-warp slow if relic active and enemy near player
        if (this.relicTimeWarp && this.player && this.player.hp / this.maxHp < 0.30) {
            const d = Math.hypot(e.x - this.player.x, e.y - this.player.y);
            if (d < 220) dt *= this._timeWarpFactor();
        }
        // CLEARANCE-MAP RESCUE: if enemy somehow ended up overlapping a wall (knockback/physics glitch),
        // teleport to nearest cell that geometrically fits its body. Single-frame, no timer.
        const r = e.def.radius || 22;
        if (this.pointInWalls(e.x, e.y, r)) {
            const cellR = Math.floor(e.y / NAV_CELL);
            const cellC = Math.floor(e.x / NAV_CELL);
            const minClear = Math.max(1, Math.ceil((r + 2) / NAV_CELL));
            const fb = this.nearestFreeCell(cellR, cellC, minClear);
            if (fb) {
                e.x = (fb.c + 0.5) * NAV_CELL;
                e.y = (fb.r + 0.5) * NAV_CELL;
                e.vx = 0; e.vy = 0;
                e.path = null;
            } else {
                e.dead = true; return;
            }
        }
        const dx = this.player.x - e.x;
        const dy = this.player.y - e.y;
        const dist = Math.hypot(dx, dy);
        const inRange = dist < e.def.detectRange;

        // Throttle LOS check to once every ~150ms per enemy (huge perf win)
        e.losTimer = (e.losTimer || 0) - dt * 1000;
        if (e.losTimer <= 0) {
            e.losTimer = 150;
            e._cachedSees = inRange && this.hasLineOfSight(e.x, e.y, this.player.x, this.player.y);
        }
        const sees = inRange && e._cachedSees;

        if (sees) {
            if (!e.lastSeen) e.lastSeen = { x: 0, y: 0 };
            e.lastSeen.x = this.player.x; e.lastSeen.y = this.player.y;
            e.alertTimer = e.def.alertMs;
        } else if (e.alertTimer > 0) {
            e.alertTimer -= dt * 1000;
        }

        if (e.stealthPatrol) {
            // aiStealthPatrol handles both patrol AND alarmed-chase + cone rendering
            this.aiStealthPatrol(e, dt);
        } else if (e.kind === 'cat') {
            this.aiCat(e, dt, dx, dy, dist, sees);
        } else if (e.kind === 'slime') {
            this.aiSlime(e, dt, dx, dy, dist, sees);
        } else if (e.kind === 'bat') {
            this.aiBat(e, dt, dx, dy, dist, sees);
        } else if (e.kind === 'guard') {
            this.aiGuard(e, dt);
        } else if (e.kind === 'skeleton') {
            this.aiSkeleton(e, dt, dx, dy, dist, sees);
        } else if (e.kind === 'ghost') {
            this.aiGhost(e, dt, dx, dy, dist, sees);
        } else if (e.kind === 'mimic') {
            this.aiMimic(e, dt, dx, dy, dist, sees);
        } else {
            this.aiPathChase(e, dt, dx, dy, dist, sees);
        }

        // Ghost when NOT solid passes through walls — direct position update.
        // Bats also fly over walls (no longer bash low-corridor walls).
        if ((e.kind === 'ghost' && !e.solid) || e.kind === 'bat') {
            e.x += e.vx * dt;
            e.y += e.vy * dt;
            e._actualMoveSq = (e.vx * dt) ** 2 + (e.vy * dt) ** 2;
        } else {
            this.moveWithWalls(e, e.def.radius, dt);
        }
        // Mimic decoy follows mimic's position while disguised
        if (e.kind === 'mimic' && e.mimicDecoy) {
            e.mimicDecoy.setPosition(e.x, e.y);
            if (e.revealed) { e.mimicDecoy.destroy(); e.mimicDecoy = null; e.sprite.setVisible(true); }
        }
    }

    // Bat: gently hovers around player, kites at distance, fires slow bolts
    aiBat(e, dt, dx, dy, dist, sees) {
        const target = sees ? this.player : e.lastSeen;
        const KEEP_DIST = 260;     // wider buffer — less aggressive
        if (target) {
            const tx = target.x - e.x;
            const ty = target.y - e.y;
            const td = Math.hypot(tx, ty) || 1;
            let want;
            if (td < KEEP_DIST - 50) want = -1;
            else if (td > KEEP_DIST + 50) want = 1;
            else want = 0;
            const sp = e.def.speed;
            const moveX = (tx / td) * sp * want;
            const moveY = (ty / td) * sp * want;
            // Slower acceleration for calmer motion
            e.vx = approach(e.vx, moveX, 400 * dt);
            e.vy = approach(e.vy, moveY, 400 * dt);
            // Very gentle hover bobbing (was 40/30, now 14/10 and slower phase)
            e.hoverPhase += dt * 2.4;
            e.vx += Math.cos(e.hoverPhase * 0.6) * 14;
            e.vy += Math.sin(e.hoverPhase) * 10;
        } else {
            e.vx *= 0.92; e.vy *= 0.92;
        }
        // Shoot bolts at player if has LOS
        e.shootCd -= dt * 1000;
        if (sees && dist < 550 && e.shootCd <= 0) {
            e.shootCd = e.def.shootCooldownMs;
            this.spawnEnemyBolt(e.x, e.y, this.player.x, this.player.y, e.def.boltSpeed);
        }
    }

    // === SKELETON — slow chase, throws bones at range ===
    aiSkeleton(e, dt, dx, dy, dist, sees) {
        // Throw bone at range
        e.shootCd = (e.shootCd || 0) - dt * 1000;
        if (sees && dist > 100 && dist < 500 && e.shootCd <= 0) {
            e.shootCd = e.def.boneCooldownMs;
            this.spawnEnemyBolt(e.x, e.y, this.player.x, this.player.y, e.def.boneSpeed, 0xe8d4a0, true);
        }
        // Otherwise — chase via aiPathChase (handles wall-avoidance + pathfinding correctly)
        if (sees || e.lastSeen) {
            this.aiPathChase(e, dt, dx, dy, dist, sees);
        } else {
            e.vx *= 0.9; e.vy *= 0.9;
        }
    }

    // === GHOST — phases through walls, only solid (vulnerable) periodically ===
    aiGhost(e, dt, dx, dy, dist, sees) {
        // Solid/phase cycle
        e.solidTimer = (e.solidTimer ?? -1000) - dt * 1000;
        if (e.solidTimer <= 0) {
            e.solid = !e.solid;
            e.solidTimer = e.solid ? e.def.solidDurationMs : e.def.solidIntervalMs;
            // Visual: opaque when solid, very transparent when phasing
            e.sprite.setAlpha(e.solid ? 0.95 : 0.40);
            // Add a slight tint shift
            if (!e.solid) e.sprite.setTint(0xa0c0ff);
            else e.sprite.clearTint();
        }
        // Direct float toward player (no wall collision when phasing)
        if (sees || e.lastSeen) {
            const tx = sees ? this.player.x : e.lastSeen.x;
            const ty = sees ? this.player.y : e.lastSeen.y;
            const tdx = tx - e.x, tdy = ty - e.y;
            const td = Math.hypot(tdx, tdy) || 1;
            const sp = e.def.speed;
            e.vx = approach(e.vx, (tdx / td) * sp, 400 * dt);
            e.vy = approach(e.vy, (tdy / td) * sp, 400 * dt);
        } else {
            // Drift slowly
            e.vx *= 0.95; e.vy *= 0.95;
        }
        // Wave float
        e.hoverPhase = (e.hoverPhase || 0) + dt * 3;
        e.vy += Math.sin(e.hoverPhase) * 8;
    }

    // === MIMIC — disguised as chest, sits still until player gets close, then lunges ===
    aiMimic(e, dt, dx, dy, dist, sees) {
        if (!e.revealed) {
            // Wait for player to get close
            if (dist < e.def.detectRange) {
                e.revealed = true;
                e.sprite.setTexture('d_mimic');
                e.sprite.setScale(e.def.scale);
                // Surprise jump
                this.tweens.add({
                    targets: e.sprite,
                    scaleX: e.def.scale * 1.3, scaleY: e.def.scale * 1.3,
                    duration: 150, yoyo: true, ease: 'Quad.easeOut'
                });
                // Exclamation
                const t = this._worldImage(e.x, e.y - 40, 'badge_alert', 800);
                this.tweens.add({ targets: t, y: e.y - 80, alpha: 0, duration: 800,
                    onComplete: () => t.destroy() });
                this.cameras.main.shake(150, 0.008);
            } else {
                e.vx = 0; e.vy = 0;
                return;
            }
        }
        // Revealed — lunges at player periodically (only if path is clear of walls)
        e.lungeCd = (e.lungeCd || 0) - dt * 1000;
        if (e.lungeCd <= 0 && dist < 300) {
            // Probe lunge path — abort if walls in the way (prevents bashing)
            const reach = Math.min(dist, 220);
            const tx = e.x + (dx / dist) * reach;
            const ty = e.y + (dy / dist) * reach;
            if (this._isRayClear(e.x, e.y, tx, ty, 1)) {
                e.lungeCd = e.def.lungeCooldownMs;
                const sp = e.def.lungeSpeed;
                e.vx = (dx / dist) * sp;
                e.vy = (dy / dist) * sp;
                this.tweens.add({
                    targets: e.sprite, scaleY: e.def.scale * 0.7, duration: 100,
                    yoyo: true, ease: 'Quad.easeIn'
                });
            } else {
                // Wall in the way — wait, decelerate, retry next frame
                e.lungeCd = 200;
                e.vx *= 0.85; e.vy *= 0.85;
            }
        } else {
            e.vx *= 0.85; e.vy *= 0.85;
        }
    }

    spawnEnemyBolt(x, y, tx, ty, speed, color, spin) {
        const dx = tx - x, dy = ty - y;
        const len = Math.hypot(dx, dy) || 1;
        const vx = (dx / len) * speed;
        const vy = (dy / len) * speed;
        const c = color || 0xff4060;
        let sprite;
        if (spin) {
            // Bone — small white rounded rect that spins
            sprite = this.add.rectangle(x, y, 14, 5, c, 1).setDepth(180);
            sprite.setStrokeStyle(1.5, 0x1a1a1a, 0.8);
            this.tweens.add({ targets: sprite, angle: 360, duration: 500, repeat: -1 });
        } else {
            sprite = this.add.circle(x, y, 6, c, 1).setDepth(180);
            sprite.setStrokeStyle(2, 0xffffff, 0.8);
        }
        const glow = this.add.circle(x, y, 12, c, 0.3).setDepth(179);
        this.enemyBolts = this.enemyBolts || [];
        this.enemyBolts.push({ sprite, glow, x, y, vx, vy, life: 2000, dead: false });
    }

    // Smart chase: direct when LOS, A* path when memory of player
    aiPathChase(e, dt, dx, dy, dist, sees) {
        if (sees && dist > 8) {
            // Use clearance map to check the WHOLE chase line, not just thin LOS ray.
            // LOS uses a thin ray with 24px steps that can miss wall corners — clearance check is geometric.
            const r = e.def.radius || 22;
            const minClear = Math.max(1, Math.ceil((r + 2) / NAV_CELL));
            const steps = Math.min(10, Math.ceil(dist / NAV_CELL));
            let lineClear = true;
            const cl = this.navClearance;
            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                const px = e.x + dx * t;
                const py = e.y + dy * t;
                const cellR = Math.floor(py / NAV_CELL);
                const cellC = Math.floor(px / NAV_CELL);
                if (cellR < 0 || cellR >= NAV_H || cellC < 0 || cellC >= NAV_W) { lineClear = false; break; }
                if (this.navGrid[cellR][cellC] === 'wall') { lineClear = false; break; }
                if (cl && cl[cellR * NAV_W + cellC] < minClear) { lineClear = false; break; }
            }
            if (lineClear) {
                // Direct chase — line geometrically fits the body
                const sp = e.def.speed;
                e.vx = approach(e.vx, (dx / dist) * sp, 700 * dt);
                e.vy = approach(e.vy, (dy / dist) * sp, 700 * dt);
                e.path = null;
                return;
            }
            // Obstacle on the line → use A* even though LOS-ray says we see player
            if (!e.lastSeen) e.lastSeen = { x: 0, y: 0 };
            e.lastSeen.x = this.player.x; e.lastSeen.y = this.player.y;
            e.alertTimer = e.def.alertMs || 4000;
            this.followPath(e, dt, this.player.x, this.player.y);
            return;
        }
        if (e.alertTimer > 0 && e.lastSeen) {
            this.followPath(e, dt, e.lastSeen.x, e.lastSeen.y);
            return;
        }
        // Wander
        e.path = null;
        e.stateTimer -= dt * 1000;
        if (e.stateTimer <= 0 || (Math.abs(e.vx) < 4 && Math.abs(e.vy) < 4)) {
            const ang = Math.random() * Math.PI * 2;
            const sp = e.def.speed * 0.35;
            e.vx = approach(e.vx, Math.cos(ang) * sp, 400 * dt);
            e.vy = approach(e.vy, Math.sin(ang) * sp, 400 * dt);
            e.stateTimer = Phaser.Math.Between(1200, 2400);
        }
    }

    // === DIJKSTRA MAP (Brogue-style distance field) ===
    // BFS from player to every reachable cell respecting clearance. ONE map serves all
    // enemies of the radius class. Update throttled (player crosses cell OR 250ms elapsed).
    // Replaces per-enemy A* entirely — no enemy can get stuck because the wave already
    // flowed around every obstacle before any enemy reads the field.
    buildDijkstraMap(minClearCells) {
        const W = NAV_W, H = NAV_H;
        const size = W * H;
        if (!this._dijScratch) this._dijScratch = {};
        let scratch = this._dijScratch[minClearCells];
        if (!scratch) {
            scratch = { map: new Int32Array(size), queue: new Int32Array(size) };
            this._dijScratch[minClearCells] = scratch;
        }
        const map = scratch.map;
        const INFTY = 0x3fffffff;
        map.fill(INFTY);
        if (!this.player) return map;

        let pR = Math.floor(this.player.y / NAV_CELL);
        let pC = Math.floor(this.player.x / NAV_CELL);
        if (pR < 0 || pR >= H || pC < 0 || pC >= W) return map;
        const cl = this.navClearance;
        if (this.navGrid[pR][pC] === 'wall' || (cl && cl[pR * W + pC] < minClearCells)) {
            const fb = this.nearestFreeCell(pR, pC, minClearCells);
            if (!fb) return map;
            pR = fb.r; pC = fb.c;
        }

        // Ring-buffer FIFO queue. With uniform cost=1, each reachable cell enqueued exactly once.
        const queue = scratch.queue;
        let qH = 0, qT = 0;
        const startIdx = pR * W + pC;
        map[startIdx] = 0;
        queue[qT++] = startIdx;

        while (qH < qT) {
            const idx = queue[qH++];
            const r = (idx / W) | 0;
            const c = idx - r * W;
            const nd = map[idx] + 1;
            // 8-connected expansion
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (dr === 0 && dc === 0) continue;
                    const nr = r + dr, nc = c + dc;
                    if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue;
                    if (this.navGrid[nr][nc] === 'wall') continue;
                    if (cl && cl[nr * W + nc] < minClearCells) continue;
                    const nidx = nr * W + nc;
                    if (map[nidx] > nd) {
                        map[nidx] = nd;
                        queue[qT++] = nidx;
                    }
                }
            }
        }
        return map;
    }

    // Rebuild the Dijkstra map only when player crossed cell boundary OR 250ms elapsed
    _updateDijkstraMaps() {
        if (!this.player) return;
        const pR = Math.floor(this.player.y / NAV_CELL);
        const pC = Math.floor(this.player.x / NAV_CELL);
        const last = this._dijkstraLastPlayerCell;
        const lastTime = this._dijkstraLastBuildTime || 0;
        const now = this.time.now;
        const moved = !last || last.r !== pR || last.c !== pC;
        const stale = (now - lastTime) > 250;
        if (!moved && !stale) return;
        // Two maps:
        //  - small (clearance ≥ 1) — fits enemies with radius ≤ 38px
        //  - large (clearance ≥ 2) — fits boss (r=50)
        this.dijkstraMapSmall = this.buildDijkstraMap(1);
        // Only build boss map if we have a boss alive — saves ~0.5ms per update
        if (this._needsBossMap || (this.enemies && this.enemies.some(e => !e.dead && e.kind === 'boss'))) {
            this.dijkstraMapBoss = this.buildDijkstraMap(2);
            this._needsBossMap = true;
        }
        this._dijkstraLastPlayerCell = { r: pR, c: pC };
        this._dijkstraLastBuildTime = now;
    }

    // Return the next step direction for this enemy — read 8 neighbors of the field
    dijkstraStepFrom(e) {
        const W = NAV_W, H = NAV_H;
        // Pick clearance-appropriate map by enemy radius
        const useBossMap = (e.def?.radius || 30) >= 45 && this.dijkstraMapBoss;
        const map = useBossMap ? this.dijkstraMapBoss : this.dijkstraMapSmall;
        if (!map) return null;
        const cR = Math.floor(e.y / NAV_CELL);
        const cC = Math.floor(e.x / NAV_CELL);
        if (cR < 0 || cR >= H || cC < 0 || cC >= W) return null;
        const cV = map[cR * W + cC];
        if (cV >= 0x3fffffff) return null;   // enemy on unreachable cell
        // Find neighbor with strictly lowest value
        let bestR = cR, bestC = cC;
        let bestVal = cV;
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue;
                const nr = cR + dr, nc = cC + dc;
                if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue;
                const nv = map[nr * W + nc];
                if (nv < bestVal) {
                    bestVal = nv;
                    bestR = nr;
                    bestC = nc;
                }
            }
        }
        if (!this._dijStep) this._dijStep = { tx: 0, ty: 0 };
        this._dijStep.tx = (bestC + 0.5) * NAV_CELL;
        this._dijStep.ty = (bestR + 0.5) * NAV_CELL;
        return this._dijStep;
    }

    // followPath now delegates to Dijkstra Map — wave already routed around all obstacles
    followPath(e, dt, tx, ty) {
        const step = this.dijkstraStepFrom(e);
        if (step) {
            const dx = step.tx - e.x;
            const dy = step.ty - e.y;
            const d = Math.hypot(dx, dy);
            if (d > 1) {
                const sp = e.def.speed;
                e.vx = approach(e.vx, (dx / d) * sp, 700 * dt);
                e.vy = approach(e.vy, (dy / d) * sp, 700 * dt);
            }
            return;
        }
        // Unreachable (rare — knockback into pit, or boss with r=50 in tight corridor)
        e.vx *= 0.85; e.vy *= 0.85;
        if (e.alertTimer <= 0) e.lastSeen = null;
    }

    aiCat(e, dt, dx, dy, dist, sees) {
        e.pounceCooldown -= dt * 1000;
        if (sees && dist < 360 && e.pounceCooldown <= 0) {
            // Probe pounce path — abort if walls block (no more wall-bashing)
            const reach = Math.min(dist, 260);
            const tx = e.x + (dx / dist) * reach;
            const ty = e.y + (dy / dist) * reach;
            if (this._isRayClear(e.x, e.y, tx, ty, 1)) {
                const sp = e.def.pounceSpeed;
                e.vx = (dx / dist) * sp;
                e.vy = (dy / dist) * sp;
                e.pounceCooldown = e.def.pounceCooldownMs;
                this.tweens.add({
                    targets: e.sprite,
                    scaleY: { from: e.def.scale * 1.3, to: e.def.scale },
                    scaleX: { from: e.def.scale * 0.8, to: e.def.scale },
                    duration: 200, ease: 'Sine.easeOut'
                });
                e.stateTimer = 300;
                return;
            }
            // Wall in pounce path → walk via Dijkstra this frame instead
        }
        if (e.stateTimer > 0) {
            e.stateTimer -= dt * 1000;
            e.vx *= 0.92; e.vy *= 0.92;
            return;
        }
        // Otherwise standard path/chase behavior
        this.aiPathChase(e, dt, dx, dy, dist, sees);
    }

    aiSlime(e, dt, dx, dy, dist, sees) {
        // Phases: idle → crouch → air → land → wobble → idle
        const PHASE_NEXT = { idle: 'crouch', crouch: 'air', air: 'land', land: 'wobble', wobble: 'idle' };
        const phaseDuration = (phase) => {
            switch (phase) {
                case 'idle':   return Phaser.Math.Between(600, 1100);
                case 'crouch': return 160;
                case 'air':    return 340;
                case 'land':   return 110;
                case 'wobble': return 260;
            }
        };
        if (!e.slimePhase) {
            e.slimePhase = 'idle';
            e.slimeT = 0;
            e.slimeDuration = phaseDuration('idle');
        }
        e.slimeT += dt * 1000;

        // Velocity behavior per phase
        if (e.slimePhase === 'idle' || e.slimePhase === 'crouch') {
            e.vx *= 0.88; e.vy *= 0.88;
        } else if (e.slimePhase === 'land' || e.slimePhase === 'wobble') {
            e.vx *= 0.55; e.vy *= 0.55;
        }
        // 'air' phase keeps velocity from when hop started

        // Phase transition
        if (e.slimeT >= e.slimeDuration) {
            const next = PHASE_NEXT[e.slimePhase];
            e.slimePhase = next;
            e.slimeT = 0;
            e.slimeDuration = phaseDuration(next);

            if (next === 'air') {
                // Launch the hop — pick direction, probe 40px ahead to avoid wall-stuck launches
                let hx, hy;
                if (sees) { hx = dx; hy = dy; }
                else if (e.lastSeen) { hx = e.lastSeen.x - e.x; hy = e.lastSeen.y - e.y; }
                else { hx = Math.random() * 2 - 1; hy = Math.random() * 2 - 1; }
                let len = Math.hypot(hx, hy) || 1;
                // Probe ahead: if blocked, rotate random angle a few times
                for (let tries = 0; tries < 4; tries++) {
                    const px = e.x + (hx / len) * 40;
                    const py = e.y + (hy / len) * 40;
                    if (!this.pointInWalls(px, py, e.def.radius || 22)) break;
                    const a = Math.random() * Math.PI * 2;
                    hx = Math.cos(a); hy = Math.sin(a);
                    len = 1;
                }
                const sp = e.def.speed;
                e.vx = (hx / len) * sp;
                e.vy = (hy / len) * sp;
            }
            if (next === 'idle' && !sees && e.lastSeen) {
                const d = Math.hypot(e.lastSeen.x - e.x, e.lastSeen.y - e.y);
                if (d < 30) e.lastSeen = null;
            }
        }
    }

    hasLineOfSight(x1, y1, x2, y2) {
        const dx = x2 - x1, dy = y2 - y1;
        const dist = Math.hypot(dx, dy);
        // Larger steps (24px) + spatial-hash pointInWalls = much faster
        const steps = Math.ceil(dist / 24);
        for (let i = 1; i < steps; i++) {
            const t = i / steps;
            if (this.pointInWalls(x1 + dx * t, y1 + dy * t, 0)) return false;
        }
        return true;
    }

    // === Nav-aware ray clearance check ===
    // Returns true if a straight line from (x0,y0) to (x1,y1) stays clear of walls
    // (and clearance ≥ minClearCells if provided). Steps every cell-width along ray.
    _isRayClear(x0, y0, x1, y1, minClearCells) {
        if (!this.navGrid) return true;
        const W = NAV_W, H = NAV_H;
        const cl = this.navClearance;
        const dx = x1 - x0, dy = y1 - y0;
        const dist = Math.hypot(dx, dy);
        if (dist < 1) return true;
        const steps = Math.max(2, Math.ceil(dist / (NAV_CELL * 0.5)));
        for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            const px = x0 + dx * t;
            const py = y0 + dy * t;
            const r = Math.floor(py / NAV_CELL);
            const c = Math.floor(px / NAV_CELL);
            if (r < 0 || r >= H || c < 0 || c >= W) return false;
            if (this.navGrid[r][c] === 'wall') return false;
            if (minClearCells && cl && cl[r * W + c] < minClearCells) return false;
        }
        return true;
    }

    // === HIT JUICE HELPERS ===
    // Tiered camera shake — consistent feel per impact size.
    _shake(tier) {
        const cam = this.cameras?.main;
        if (!cam) return;
        const cfg = SHAKE_CFG[tier] || SHAKE_CFG.sm;
        cam.shake(cfg.dur, cfg.amt);
    }

    // Brief slow-motion freeze for impact emphasis.
    _hitStop(ms) {
        if (!ms || ms <= 0) return;
        // Avoid stacking hit-stops within a window.
        if (this._hitStopUntil && this.time.now < this._hitStopUntil) return;
        this._hitStopUntil = this.time.now + ms;
        this.time.timeScale = 0.05;
        this.tweens.timeScale = 0.05;
        // Restore on REAL time (scene clock is scaled to 0.05 right now).
        // Tracked so shutdown can cancel it — otherwise a floor transition
        // during the freeze leaves the next scene stuck at 5% speed.
        if (this._hitStopTimeout) clearTimeout(this._hitStopTimeout);
        this._hitStopTimeout = setTimeout(() => {
            this._hitStopTimeout = null;
            if (!this.sys || !this.scene || !this.sys.isActive()) return;
            this.time.timeScale = 1;
            this.tweens.timeScale = 1;
        }, ms);
    }

    // White flash overlay on enemy sprite — replaces simple tint feel.
    _hitFlash(e) {
        const target = e.sprite || e.gfx;
        if (!target) return;
        // Use Phaser tint as quick proxy; sprite text uses setTint via text shadow.
        if (target.setTintFill) {
            target.setTintFill(0xffffff);
            this.time.delayedCall(70, () => { try { target.clearTint(); } catch (err) {} });
        } else if (target.setTint) {
            target.setTint(0xffffff);
            this.time.delayedCall(70, () => { try { target.clearTint(); } catch (err) {} });
        }
    }

    // Squash bounce on hit — quick scale pulse.
    _hitSquash(e, tier) {
        const target = e.sprite || e.gfx;
        if (!target) return;
        const baseSX = target._baseScaleX || target.scaleX || 1;
        const baseSY = target._baseScaleY || target.scaleY || 1;
        target._baseScaleX = baseSX;
        target._baseScaleY = baseSY;
        const factor = { sm: 0.06, med: 0.12, big: 0.20, huge: 0.30 }[tier] || 0.08;
        // Squash: stretch X, squish Y, then return
        try {
            this.tweens.killTweensOf(target);
            target.scaleX = baseSX * (1 + factor);
            target.scaleY = baseSY * (1 - factor * 0.7);
            this.tweens.add({
                targets: target,
                scaleX: baseSX, scaleY: baseSY,
                duration: 160, ease: 'Back.easeOut',
            });
        } catch (err) {}
    }

    damageEnemy(e, dmg, kx, ky) {
        if (e.invulnUntil && this.time.now < e.invulnUntil) {
            // Sparks of "absorbed damage"
            this.poofAt(e.x, e.y, 0x80c0ff);
            return;
        }
        if (this.isPowerupActive('fire')) dmg *= 2;
        dmg += this.pieDmgBonus || 0;
        // Crit relic — chance of x3 damage
        let isCrit = false;
        if (this.relicCritChance && Math.random() < this.relicCritChance) {
            dmg *= 3; isCrit = true;
            this.showFloatingText(e.x, e.y - 30, 'КРИТ!', '#ffd040', 22);
        }
        e.hp -= dmg;
        // Audio feedback — boss gets a heavier hit
        if (e.kind === 'boss') bus.emit(SFX.BOSS_HIT);
        else if (e.kind === 'slime') bus.emit(SFX.SLIME_SQUELCH);
        else bus.emit(SFX.HIT_ENEMY);

        // === HIT JUICE — flash, squash, shake, hit-stop based on impact tier ===
        const isLethal = e.hp <= 0;
        const isBoss = e.kind === 'boss';
        const tier = isBoss ? 'big' : (isCrit ? 'med' : (isLethal ? 'med' : 'sm'));
        this._hitFlash(e);
        this._hitSquash(e, tier);
        this._shake(tier);
        if (isBoss || isCrit || isLethal) {
            this._hitStop(isBoss ? 70 : (isCrit ? 50 : 35));
        }
        // === ALARM ON HIT — shooting is noisy, cone-enemies in the room hear it ===
        // If the hit enemy itself is a cone-stealth patroller, alarm it directly.
        // Also propagate to ALL stealth-patrol enemies in the same room (and nearby rooms)
        if (e.kind !== 'boss') {
            // Direct alarm on the hit enemy if it's a stealth-cone enemy
            if (e.stealthPatrol && !e.alarmed) this._raiseAlarm(e);
            // Propagate to other stealth enemies — they hear the shot
            if (this.enemies && e.roomId !== undefined) {
                for (const other of this.enemies) {
                    if (other === e || other.dead || !other.stealthPatrol || other.alarmed) continue;
                    const d2 = (other.x - e.x) ** 2 + (other.y - e.y) ** 2;
                    // Same-room enemies always hear; out-of-room within 400px hear too
                    const sameRoom = other.roomId === e.roomId;
                    if (sameRoom || d2 < 400 * 400) {
                        if (sameRoom) {
                            // Loud — immediate alarm
                            this._raiseAlarm(other);
                        } else {
                            // Distant shot — investigate
                            if (!other.lastSeen) other.lastSeen = { x: 0, y: 0 };
                            other.lastSeen.x = e.x; other.lastSeen.y = e.y;
                            other.suspicion = Math.max(other.suspicion || 0, 0.7);
                            other.alertTimer = (other.def.alertMs || 4000);
                            // Visual cue: enemy heard the shot
                            const ear = this._worldImage(other.x, other.y - 50, 'badge_ear', 800);
                            this.tweens.add({
                                targets: ear, y: other.y - 84, alpha: 0,
                                duration: 1000, ease: 'Quad.easeOut',
                                onComplete: () => ear.destroy()
                            });
                        }
                    }
                }
            }
        }
        // === BOSS phase transitions ===
        if (e.kind === 'boss') {
            const pct = e.hp / e.maxHp;
            if (!e.phase2 && pct <= 0.66 && pct > 0.33) {
                this.bossPhase2(e);
            } else if (!e.phase3 && pct <= 0.33) {
                this.bossPhase3(e);
            }
        }
        e.hurtTimer = 200;
        const k = e.def.knockback || 200;
        const len = Math.hypot(kx, ky) || 1;
        e.vx += (kx / len) * k;
        e.vy += (ky / len) * k;
        if (!e.lastSeen) e.lastSeen = { x: 0, y: 0 };
        e.lastSeen.x = this.player.x; e.lastSeen.y = this.player.y;
        e.alertTimer = e.def.alertMs;
        if (e.hp <= 0) {
            e.dead = true;
            if (e.kind !== 'boss') bus.emit(SFX.ENEMY_DEATH);
            try { Progress.recordKill(e.kind); } catch (err) {}
            this.poofAt(e.x, e.y, e.kind === 'boss' ? 0xc080ff : 0xb080d0);
            // Subtle camera kick on kills, bigger for boss
            this.cameras.main.shake(e.kind === 'boss' ? 360 : 80, e.kind === 'boss' ? 0.02 : 0.004);
            // Combo system — kills within 3.5s of each other compound
            const now = this.time.now;
            if (now < this._comboExpire) this._combo++;
            else this._combo = 1;
            this._comboExpire = now + 3500;
            // COMBO HEART relic — every 5th combo kill heals 1 HP
            if (this.relicComboHeart && this._combo > 0 && this._combo % 5 === 0
                && this.player.hp < this.maxHp) {
                this.player.hp = Math.min(this.maxHp, this.player.hp + 1);
                this.showFloatingText(this.player.x, this.player.y - 50, '💞 +1', '#ff80a0', 22);
            }
            // ACHIEVEMENT: combo 25
            if (this._combo >= 25) {
                try {
                    if (Progress.unlockAchievement && Progress.unlockAchievement('combo_25')) {
                        this.showFloatingText(this.player.x, this.player.y - 80, '🏆 КОМБО 25!', '#ffd040', 22);
                    }
                } catch (err) {}
            }
            const comboBonus = Math.min(this._combo, 12);
            const baseScore = (e.kind === 'boss') ? 300 : 50;
            const earnedScore = baseScore * comboBonus;
            this.score += earnedScore;
            // Combo visual feedback only when high — no score number, just the streak
            if (this._combo >= 3) {
                this.showFloatingText(e.x, e.y - 20, `x${this._combo}`, '#ffd040', 24);
            }
            // Lifesteal upgrade — chance to heal on kill
            if (this.lifestealChance > 0 && this.player.hp < this.maxHp && Math.random() < this.lifestealChance) {
                this.player.hp = Math.min(this.maxHp, this.player.hp + 1);
                this.showFloatingText(this.player.x, this.player.y - 30, '+❤️', '#ff80a0', 18);
            }
            // Drop a heart sometimes
            const dropChance = (e.kind === 'boss') ? 1.0 : (e.kind === 'zombie' ? 0.35 : 0.22);
            if (this.player.hp < PLAYER.maxHp && Math.random() < dropChance) {
                this.spawnHeart(e.x, e.y);
            }
            if (e.kind === 'slime' && !e.wasSplit && this.biome?.id !== 'kitchen') {
                // Validated split: probe 8 candidate positions, only spawn babies in floor cells
                const radius = 18;
                const candidates = [
                    [-34, 0], [34, 0],          // primary L/R
                    [0, -34], [0, 34],          // up/down
                    [-26, -26], [26, -26],
                    [-26, 26], [26, 26]
                ];
                let placed = 0;
                for (const [ox, oy] of candidates) {
                    if (placed >= 2) break;
                    const bx = e.x + ox, by = e.y + oy;
                    if (this.pointInWalls(bx, by, radius)) continue;
                    const baby = this.spawnEnemy('slime', bx, by);
                    if (!baby) continue;
                    baby.wasSplit = true;
                    baby.def = { ...ENEMY_DEFS.slime, hp: 1, scale: 0.18, radius: 16, speed: 130 };
                    baby.hp = 1;
                    placed++;
                }
                // If 0 valid spots — slime just dies (no stuck-in-wall babies)
            }
            this.tweens.add({
                targets: [e.sprite, e.shadow],
                alpha: 0, scaleX: e.def.scale * 1.5, scaleY: e.def.scale * 1.5,
                duration: 320,
                onComplete: () => {
                    e.sprite.destroy(); e.shadow.destroy();
                    if (e.coneGfx) { e.coneGfx.destroy(); e.coneGfx = null; }
                    if (e.zzz) { e.zzz.destroy(); e.zzz = null; }
                    if (e.behaviorIcon) { e.behaviorIcon.destroy(); e.behaviorIcon = null; }
                    e.cleanedUp = true;
                }
            });
            // Boss death = unlock exit early bonus message
            if (e.kind === 'boss') {
                this.showFloatingText(e.x, e.y - 30, 'БОСС ПОВЕРЖЕН!', '#ff80ff', 32);
                this.score += 200;
                try {
                    if (Progress.unlockAchievement && Progress.unlockAchievement('boss_defeated')) {
                        this.showFloatingText(e.x, e.y - 70, '🏆 Граф повержен', '#ffd040', 24);
                    }
                    // No-hit achievement: track if player has taken damage this floor
                    if (Progress.unlockAchievement && !this._floorDamageTaken
                        && Progress.unlockAchievement('boss_no_hit')) {
                        this.showFloatingText(e.x, e.y - 100, '🏆 Без единого удара!', '#ffd040', 22);
                    }
                } catch (err) {}
            }
        }
    }

    // =================================================================
    // CHEESE / KEY / EXIT
    // =================================================================
    spawnCheese() {
        const rooms = this.dungeon.rooms;
        for (let i = 0; i < rooms.length; i++) {
            if (i === 0) continue; // skip start room
            const room = rooms[i];
            const isExit = (i === this.exitRoomIdx);
            const count = isExit ? 1 : Phaser.Math.Between(1, 3);
            for (let j = 0; j < count; j++) {
                let tries = 12;
                while (tries-- > 0) {
                    const x = room.x + Phaser.Math.Between(60, room.w - 60);
                    const y = room.y + Phaser.Math.Between(60, room.h - 60);
                    if (this.pointInWalls(x, y, 25)) continue;
                    this.placeCheese(x, y);
                    break;
                }
            }
        }
        this.cheeseTotal = this.pickups.length;
    }

    placeCheese(x, y) {
        const sprite = this.add.image(x, y, 'd_cheese').setScale(0.8).setDepth(150);
        const glow = this.add.circle(x, y, 18, 0xffd040, 0.15).setDepth(149);
        this.pickups.push({ sprite, glow, x, y, taken: false, bobPhase: Math.random() * Math.PI * 2 });
    }

    // Public helper — called from lit-torch cache reveal (dungeon biome)
    spawnSingleCheese(x, y) {
        this.placeCheese(x, y);
        this.cheeseTotal = (this.cheeseTotal || 0) + 1;
    }

    collectCheese(pk) {
        pk.taken = true;
        if (pk.heart) {
            this.player.hp = Math.min(this.maxHp, this.player.hp + 1);
            this.poofAt(pk.x, pk.y, 0xff4070);
            this.showFloatingText(pk.x, pk.y - 20, '+❤️', '#ff80a0', 24);
            bus.emit(SFX.COLLECT_HEART);
        } else {
            // Alarm penalty: cheese in alarmed rooms gives half value
            const roomId = this._findRoomIdForPoint(pk.x, pk.y);
            const penalized = this._cheesePenaltyRooms && this._cheesePenaltyRooms.has(roomId);
            const cheeseValue = penalized ? 0.5 : 1;
            this.cheeseGot++;
            this.runCheeseTotal = (this.runCheeseTotal || 0) + cheeseValue;
            const cheeseScore = Math.round(10 * (this.cheeseMul || 1) * cheeseValue);
            this.score += cheeseScore;
            this.poofAt(pk.x, pk.y, penalized ? 0x808080 : 0xf5c945);
            // Show what was COLLECTED (cheese piece), not the score bonus — was confusing
            this.showFloatingText(pk.x, pk.y - 20,
                penalized ? '+🧀 ½' : '+🧀',
                penalized ? '#a0a0a0' : '#ffe080', 22);
            bus.emit(SFX.COLLECT_CHEESE);
            // Cheese Explosion relic — 2 dmg to enemies in 100px
            if (this.relicCheeseBoom) {
                for (const e of this.enemies) {
                    if (e.dead) continue;
                    if (Math.hypot(e.x - pk.x, e.y - pk.y) < 100) {
                        this.damageEnemy(e, 2, e.x - pk.x, e.y - pk.y);
                    }
                }
                this.poofAt(pk.x, pk.y, 0xffd040);
            }
        }
        this.tweens.add({
            targets: pk.sprite,
            scale: pk.sprite.scaleX * 1.6, alpha: 0, y: pk.y - 20, duration: 260,
            onComplete: () => pk.sprite.destroy()
        });
        this.tweens.add({
            targets: pk.glow,
            scale: 1.6, alpha: 0, y: pk.y - 20, duration: 260,
            onComplete: () => pk.glow.destroy()
        });
    }

    spawnHeart(x, y) {
        const sprite = this.add.image(x, y, 'ui_heart').setDisplaySize(28, 28).setDepth(155);
        const glow = this.add.circle(x, y, 22, 0xff3060, 0.25).setDepth(154);
        // Auto-despawn after 12 seconds
        this.time.delayedCall(12000, () => {
            const pk = this.pickups.find(p => p.sprite === sprite);
            if (pk && !pk.taken) {
                pk.taken = true;
                this.tweens.add({
                    targets: [sprite, glow], alpha: 0, duration: 500,
                    onComplete: () => { sprite.destroy(); glow.destroy(); }
                });
            }
        });
        this.pickups.push({ sprite, glow, x, y, taken: false, heart: true, bobPhase: Math.random() * Math.PI * 2 });
    }

    spawnKey() {
        // exitRoomIdx and keyRoomIdx are pre-computed in computeRoomGoals()
        const room = this.dungeon.rooms[this.keyRoomIdx];
        let x = room.x + room.w / 2;
        let y = room.y + room.h / 2 + 30;
        // Safety net — if center is somehow blocked, scan room cells for floor
        if (this.pointInWalls(x, y, 30)) {
            const safe = this.findFloorInRoom(room, 30);
            if (safe) { x = safe.x; y = safe.y; }
        }
        const sprite = this.add.image(x, y, 'd_key').setScale(1.3).setDepth(155);
        const glow = this.add.circle(x, y, 40, 0xffd040, 0.22).setDepth(154);
        this.keyPickup = { sprite, glow, x, y, taken: false, bobPhase: Math.random() * Math.PI * 2 };
    }

    spawnExitDoor() {
        const room = this.dungeon.rooms[this.exitRoomIdx];
        let x = room.x + room.w / 2;
        let y = room.y + room.h - 80;
        if (this.pointInWalls(x, y, 35)) {
            const safe = this.findFloorInRoom(room, 35);
            if (safe) { x = safe.x; y = safe.y; }
        }
        const ringGlow = this.add.circle(x, y, 60, 0xa060ff, 0.18).setDepth(120);
        const g = this._worldImage(x, y, 'door_closed', 122, 0.5, 0.9);
        const lock = this._worldImage(x, y - 30, 'lock', 123);
        this.exit = { x, y, radius: 42, graphics: g, glow: ringGlow, lockIcon: lock, unlocked: false };

        // Grandma in cage ONLY on the final floor; intermediate floors show a "down stairs" portal
        if (this.isFinalFloor) {
            this.spawnCaptive(room.x + room.w / 2, room.y + 120);
        } else {
            this.spawnStairsLabel(room.x + room.w / 2, room.y + 120);
        }
    }

    // Scan a room and return a clear point (away from walls), or null if everything is blocked
    findFloorInRoom(room, radius) {
        const sR = Math.floor(room.y / NAV_CELL);
        const sC = Math.floor(room.x / NAV_CELL);
        const eR = Math.floor((room.y + room.h) / NAV_CELL);
        const eC = Math.floor((room.x + room.w) / NAV_CELL);
        // Try cells closest to room center first
        const cr = Math.floor(sR + (eR - sR) / 2);
        const cc = Math.floor(sC + (eC - sC) / 2);
        const candidates = [];
        for (let r = sR; r <= eR; r++) {
            for (let c = sC; c <= eC; c++) {
                if (this.navGrid[r]?.[c] !== 'floor') continue;
                const x = c * NAV_CELL + NAV_CELL / 2;
                const y = r * NAV_CELL + NAV_CELL / 2;
                if (this.pointInWalls(x, y, radius)) continue;
                const distSq = (r - cr) * (r - cr) + (c - cc) * (c - cc);
                candidates.push({ x, y, distSq });
            }
        }
        if (candidates.length === 0) return null;
        candidates.sort((a, b) => a.distSq - b.distSq);
        return candidates[0];
    }

    spawnStairsLabel(x, y) {
        // Small visual ladder/stairs going down beside the exit door, plus floating arrow
        const g = this._worldImage(x, y, 'stairs', 124, 0.5, 0.9);
        // Floating "↓" arrow above
        const arrow = this.add.image(x, y - 70, 'ui_stairs').setDisplaySize(36, 36).setDepth(125);
        this.tweens.add({
            targets: arrow, y: y - 78, alpha: 0.5,
            duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
        });
        const label = this.add.text(x, y + 56, 'СПУСК ВНИЗ', {
            fontFamily: 'Arial Black', fontSize: '14px',
            color: '#d0a0ff', stroke: '#1a0a3a', strokeThickness: 3
        }).setOrigin(0.5).setDepth(125);
        // captive reference is null on non-final floors; compass will fall back to exit
    }

    spawnCaptive(x, y) {
        const fam = { name: 'Бабушка', nameLow: 'бабушку',
                      plea: 'Помоги, внучок!', tint: 0xffffff, freed: 'Внучок!' };
        const cage = this._worldImage(x, y + 54, 'cage', 124, 0.5, 0.9);

        const sprite = this.add.image(x, y + 14, 'd_grandma')
            .setOrigin(0.5, 1).setScale(0.32).setDepth(123);
        if (fam.tint !== 0xffffff) sprite.setTint(fam.tint);

        this.tweens.add({
            targets: sprite, y: y + 12,
            duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
        });

        const bubble = this.add.text(x, y - 110, fam.plea, {
            fontFamily: 'Arial Black', fontSize: '16px',
            color: '#1a1a1a', backgroundColor: '#fff8e0',
            padding: { x: 10, y: 6 }, stroke: '#5a3010', strokeThickness: 1
        }).setOrigin(0.5).setDepth(125);
        this.tweens.add({
            targets: bubble,
            y: y - 116, alpha: { from: 0, to: 1 },
            duration: 600, yoyo: true, hold: 2400, repeatDelay: 3000, repeat: -1
        });

        this.captive = { x, y, sprite, cage, bubble, freed: false, savedAt: 0, family: fam };
        // Compass alias for HUD code
        this.grandma = this.captive;
    }

    freeCaptive() {
        const c = this.captive;
        if (!c || c.freed) return;
        c.freed = true;
        c.savedAt = this.time.now;
        this.tweens.add({
            targets: c.cage, alpha: 0,
            duration: 600, onComplete: () => c.cage.destroy()
        });
        this.tweens.add({
            targets: c.sprite,
            y: c.y - 10, scaleX: 0.35, scaleY: 0.35,
            duration: 220, yoyo: true, repeat: 2, ease: 'Sine.easeOut'
        });
        if (c.bubble) {
            c.bubble.setText(c.family.freed);
            c.bubble.setBackgroundColor('#80ff80');
        }
        for (let i = 0; i < 12; i++) {
            const angle = Math.random() * Math.PI * 2;
            const r = Phaser.Math.Between(40, 80);
            const p = this._worldImage(c.x, c.y - 30, 'badge_sparkle', 800);
            this.tweens.add({
                targets: p,
                x: c.x + Math.cos(angle) * r,
                y: c.y - 30 + Math.sin(angle) * r,
                alpha: 0, scale: 0.4 / this.dpr,
                duration: 1200, ease: 'Quad.easeOut',
                onComplete: () => p.destroy()
            });
        }
    }

    // Pre-compute which rooms hold the key, exit, and stealth zones so buildWorld can avoid them
    computeRoomGoals() {
        // Throne floor — exit is ALWAYS the huge arena (room 2)
        if (this.biome?.id === 'throne') {
            this.exitRoomIdx = 2;
            this.keyRoomIdx = (Math.random() < 0.5) ? 3 : 4;
            this.stealthRoomIdxs = [];
            return;
        }
        const distances = this.roomDistances(0);
        let exitIdx = 0, maxDist = -1;
        for (let i = 1; i < this.dungeon.rooms.length; i++) {
            if ((distances[i] ?? -1) > maxDist) { maxDist = distances[i]; exitIdx = i; }
        }
        this.exitRoomIdx = exitIdx;
        let keyIdx = 1, secMax = -1;
        for (let i = 1; i < this.dungeon.rooms.length; i++) {
            if (i === exitIdx) continue;
            if ((distances[i] ?? -1) > secMax) { secMax = distances[i]; keyIdx = i; }
        }
        this.keyRoomIdx = keyIdx;

        // Pick 1-2 stealth rooms (skip start/key/exit). Larger rooms preferred — more space for patrol.
        const candidates = [];
        for (let i = 1; i < this.dungeon.rooms.length; i++) {
            if (i === exitIdx || i === keyIdx) continue;
            const r = this.dungeon.rooms[i];
            if (r.w < 260 || r.h < 220) continue;       // need decent room for patrolling
            candidates.push(i);
        }
        Phaser.Utils.Array.Shuffle(candidates);
        // Biome-aware stealth room count
        const biomeStealth = (this.biome?.stealthRoomsPerFloor !== undefined)
            ? this.biome.stealthRoomsPerFloor
            : (this.chapter >= 3 ? 2 : 1);
        // Don't gate floor 1 with stealth rooms (tutorial)
        const effectiveCount = (this.runMode === 'story' && this.chapter === 1)
            ? Math.min(1, biomeStealth)
            : biomeStealth;
        const stealthCount = Math.min(candidates.length, effectiveCount);
        this.stealthRoomIdxs = candidates.slice(0, stealthCount);
        // LIBRARY: relocate key into one of the stealth rooms so player MUST engage stealth
        if (this.biome?.id === 'library' && this.stealthRoomIdxs.length > 0) {
            const stealthKeyIdx = this.stealthRoomIdxs[0];
            // Free up the old key room (becomes regular) and put key inside stealth room
            this.keyRoomIdx = stealthKeyIdx;
            // Remove this room from stealth list since it's now the key room (still gets guard via key-room density)
            this.stealthRoomIdxs = this.stealthRoomIdxs.slice(1);
        }
    }

    // BFS-style: distance through corridor graph (room-to-room)
    roomDistances(startIdx) {
        const graph = {};
        for (const c of this.dungeon.corridors) {
            (graph[c.from] = graph[c.from] || []).push(c.to);
            (graph[c.to] = graph[c.to] || []).push(c.from);
        }
        const d = { [startIdx]: 0 };
        const q = [startIdx];
        while (q.length) {
            const r = q.shift();
            for (const n of (graph[r] || [])) {
                if (d[n] === undefined) { d[n] = d[r] + 1; q.push(n); }
            }
        }
        return d;
    }

    pickupKey() {
        const k = this.keyPickup;
        if (!k || k.taken) return;
        k.taken = true;
        this.hasKey = true;
        bus.emit(SFX.KEY_GRAB);
        this.poofAt(k.x, k.y, 0xffd040);
        this.tweens.add({
            targets: [k.sprite, k.glow],
            scale: 1.8, alpha: 0, y: k.y - 30, duration: 350,
            onComplete: () => { k.sprite.destroy(); k.glow.destroy(); }
        });
        this.showFloatingText(k.x, k.y - 30, 'Ключ найден!', '#ffd040', 24);
        this.unlockExit();
    }

    unlockExit() {
        if (!this.exit || this.exit.unlocked) return;
        this.exit.unlocked = true;
        bus.emit(SFX.DOOR_OPEN);
        this.exit.graphics.setTexture('door_open');
        this.exit.lockIcon.setTexture('unlock');
        this.tweens.add({
            targets: this.exit.lockIcon, alpha: 0, scale: 1.6 / this.dpr,
            duration: 600, onComplete: () => this.exit.lockIcon.destroy()
        });
        this.exit.glowHoldUntil = this.time.now + 600;  // let the unlock flash win over the bob for its duration
        this.tweens.add({ targets: this.exit.glow, alpha: 0.30, duration: 600 });
        // Free grandma — only exists on the final floor
        if (this.captive) this.freeCaptive();
    }

    showFloatingText(x, y, text, color, size) {
        const t = this._getPooledText(x, y, text, {
            fontFamily: '"Nunito", "Roboto", system-ui, sans-serif',
            fontSize: size + 'px', color,
            fontStyle: '900',
            stroke: '#0a0410', strokeThickness: 4,
        });
        t.setOrigin(0.5).setDepth(800).setScale(0.7);
        this.tweens.add({
            targets: t, scale: 1.05, duration: 140, ease: 'Back.easeOut',
        });
        this.tweens.add({ targets: t, y: y - 56, alpha: 0, duration: 1100, ease: 'Cubic.easeOut',
            onComplete: () => this._releaseText(t) });
    }

    // =================================================================
    // COLLISIONS
    // =================================================================
    handleCollisions(dt) {
        // Forbidden book pickup check
        if (this.forbiddenBooks && this.forbiddenBooks.length) this.checkForbiddenBookPickup();
        // Relic chest pickup check
        if (this.relicChests && this.relicChests.length) {
            for (const rc of this.relicChests) {
                if (rc.taken) continue;
                if (Math.hypot(rc.x - this.player.x, rc.y - this.player.y) < 40) {
                    this.openRelicChest(rc);
                }
            }
        }
        for (const p of this.projectiles) {
            if (p.dead) continue;
            // Projectile vs enemies — pierce relic: pies pass through N enemies
            for (const e of this.enemies) {
                if (e.dead) continue;
                if (p._hitSet && p._hitSet.has(e)) continue;   // don't re-hit same enemy after pierce
                if (Math.hypot(p.x - e.x, p.y - e.y) < e.def.radius + PIE.radius) {
                    this.poofAt(p.x, p.y, 0xf5b048);
                    this.damageEnemy(e, PIE.damage, p.vx, p.vy);
                    const pierces = (this.relicPierce || 0);
                    if (pierces > 0) {
                        p._pierceLeft = (p._pierceLeft === undefined) ? pierces : p._pierceLeft - 1;
                        if (!p._hitSet) p._hitSet = new Set();
                        p._hitSet.add(e);
                        if (p._pierceLeft < 0) { p.dead = true; }
                    } else {
                        p.dead = true;
                    }
                    break;
                }
            }
            // Projectile vs unlit torches (light them up — hot pie!)
            if (!p.dead) {
                for (const t of this.torches) {
                    if (t.lit) continue;
                    if (Math.hypot(p.x - t.x, p.y - t.y) < 28) {
                        this.lightTorch(t);
                        p.dead = true;
                        break;
                    }
                }
            }
            // KITCHEN: projectile vs flour sack — blinding cloud
            if (!p.dead && this.flourSacks) {
                for (const sack of this.flourSacks) {
                    if (sack.broken) continue;
                    if (Math.hypot(p.x - sack.x, p.y - sack.y) < 26) {
                        this.breakFlourSack(sack);
                        p.dead = true;
                        break;
                    }
                }
            }
            // KITCHEN: projectile vs hanging pot — drop
            if (!p.dead && this.hangingPots) {
                for (const pot of this.hangingPots) {
                    if (pot.dropped) continue;
                    if (Math.hypot(p.x - pot.x, p.y - pot.y) < 24) {
                        this.dropHangingPot(pot);
                        p.dead = true;
                        break;
                    }
                }
            }
            // GARDEN: projectile vs vine — destroy vine cell (clears path)
            if (!p.dead && this.biome?.id === 'garden' && this.biomeTiles) {
                for (let i = this.biomeTiles.length - 1; i >= 0; i--) {
                    const v = this.biomeTiles[i];
                    if (v.type !== 'vines') continue;
                    if (Math.hypot(p.x - v.x, p.y - v.y) < v.radius * 0.7) {
                        this.poofAt(v.x, v.y, 0x408060);
                        v.sprite?.destroy();
                        this.biomeTiles.splice(i, 1);
                        if (this.growingVines) {
                            const gi = this.growingVines.indexOf(v);
                            if (gi >= 0) this.growingVines.splice(gi, 1);
                        }
                        p.dead = true;
                        break;
                    }
                }
            }
            // THRONE: projectile vs candelabra — light it up
            if (!p.dead && this.biome?.id === 'throne' && this.candelabras) {
                for (const c of this.candelabras) {
                    if (c.lit) continue;
                    if (Math.hypot(p.x - c.x, p.y - (c.y - 30)) < 34) {
                        this._lightCandelabra(c);
                        p.dead = true;
                        break;
                    }
                }
            }
        }
        if (this.player.invulnTimer <= 0) {
            for (const e of this.enemies) {
                if (e.dead) continue;
                const dx = this.player.x - e.x;
                const dy = this.player.y - e.y;
                const d = Math.hypot(dx, dy);
                if (d < e.def.radius + PLAYER.radius) {
                    // Thorn relic — return damage to attacker
                    if (this.relicThornDmg) {
                        this.damageEnemy(e, this.relicThornDmg, e.x - this.player.x, e.y - this.player.y);
                    }
                    // Power-up: shield halves damage (min 1)
                    let dmg = e.def.damage;
                    if (this.isPowerupActive('shield')) dmg = Math.max(1, Math.floor(dmg / 2));
                    this.player.hp -= dmg;
                    this._floorDamageTaken = true;   // for boss_no_hit achievement
                    bus.emit(SFX.TAKE_DAMAGE);
                    // Sturdy relic — extra invuln window
                    this.player.invulnTimer = PLAYER.invulnMs + (this.relicInvulnBonusMs || 0);
                    const k = 360, l = d || 1;
                    this.player.vx = (dx / l) * k;
                    this.player.vy = (dy / l) * k;
                    this.cameras.main.shake(180, 0.008);
                    // Combo breaks on damage
                    this._combo = 0;
                    break;
                }
            }
        }
        for (const pk of this.pickups) {
            if (pk.taken) continue;
            const dpk = Math.hypot(pk.x - this.player.x, pk.y - this.player.y);
            // Magnet relic — gravitate cheese/heart pickups toward player
            const magnet = this.relicMagnetRange || 0;
            if (magnet > 0 && dpk > 30 + PLAYER.radius && dpk < magnet) {
                const pullSpeed = 320 * dt;
                const ang = Math.atan2(this.player.y - pk.y, this.player.x - pk.x);
                pk.x += Math.cos(ang) * pullSpeed;
                pk.y += Math.sin(ang) * pullSpeed;
                if (pk.sprite) pk.sprite.setPosition(pk.x, pk.y);
                if (pk.glow) pk.glow.setPosition(pk.x, pk.y);
            }
            if (dpk < 30 + PLAYER.radius) {
                this.collectCheese(pk);
            }
        }
        // Power-up pickups
        for (const p of this.powerups) {
            if (p.taken) continue;
            if (Math.hypot(p.x - this.player.x, p.y - this.player.y) < 36 + PLAYER.radius) {
                this.collectPowerup(p);
            }
        }
        // Chest pickups (stealth rooms)
        if (this.chests) {
            for (const c of this.chests) {
                if (c.opened) continue;
                if (Math.hypot(c.x - this.player.x, c.y - this.player.y) < 36 + PLAYER.radius) {
                    this.openChest(c);
                }
            }
        }
        if (this.keyPickup && !this.keyPickup.taken) {
            if (Math.hypot(this.keyPickup.x - this.player.x, this.keyPickup.y - this.player.y) < 36 + PLAYER.radius) {
                this.pickupKey();
            }
        }
        if (this.exit && this.hasKey) {
            if (Math.hypot(this.exit.x - this.player.x, this.exit.y - this.player.y) < this.exit.radius + PLAYER.radius) {
                this.win();
            }
        }
    }

    moveWithWalls(ent, radius, dt) {
        // Track collisions + actual displacement so AI can detect being stuck
        const prevX = ent.x, prevY = ent.y;
        ent._collidedX = false;
        ent._collidedY = false;
        ent.x += ent.vx * dt;
        const wallsX = this.queryWallsAround(ent.x, ent.y, radius);
        for (const w of wallsX) {
            if (this.circleVsRect(ent.x, ent.y, radius, w)) {
                if (ent.vx > 0) ent.x = w.x - radius;
                else if (ent.vx < 0) ent.x = w.x + w.w + radius;
                ent.vx = 0;
                ent._collidedX = true;
            }
        }
        ent.y += ent.vy * dt;
        const wallsY = this.queryWallsAround(ent.x, ent.y, radius);
        for (const w of wallsY) {
            if (this.circleVsRect(ent.x, ent.y, radius, w)) {
                if (ent.vy > 0) ent.y = w.y - radius;
                else if (ent.vy < 0) ent.y = w.y + w.h + radius;
                ent.vy = 0;
                ent._collidedY = true;
            }
        }
        // Cache actual movement this frame for stuck-detection
        ent._actualMoveSq = (ent.x - prevX) ** 2 + (ent.y - prevY) ** 2;
    }

    circleVsRect(cx, cy, r, rect) {
        if (rect.broken) return false;   // Broken weak walls don't block anything
        const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
        const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
        return (cx - nx) * (cx - nx) + (cy - ny) * (cy - ny) < r * r;
    }

    // Spatial-hash lookup: walls touching a circle/area around (x,y) with given radius
    queryWallsAround(x, y, radius) {
        if (!this.spatialHash) return this.walls;
        const C = this._hashCell;
        const sC = Math.floor((x - radius) / C);
        const sR = Math.floor((y - radius) / C);
        const eC = Math.floor((x + radius) / C);
        const eR = Math.floor((y + radius) / C);
        // Fast path: only one cell
        if (sC === eC && sR === eR) {
            return this.spatialHash.get(sR * 100000 + sC) || [];
        }
        if (!this._wallSeen) { this._wallSeen = new Set(); this._wallScratch = []; }
        const seen = this._wallSeen;
        const result = this._wallScratch;
        seen.clear();
        result.length = 0;
        for (let r = sR; r <= eR; r++) {
            for (let c = sC; c <= eC; c++) {
                const bucket = this.spatialHash.get(r * 100000 + c);
                if (!bucket) continue;
                for (const w of bucket) {
                    if (!seen.has(w)) { seen.add(w); result.push(w); }
                }
            }
        }
        return result;
    }

    pointInWalls(x, y, r) {
        const walls = this.queryWallsAround(x, y, Math.max(r, 1));
        for (const w of walls) if (this.circleVsRect(x, y, r, w)) return true;
        return false;
    }

    // === Object pools — combat spawns these every hit; create/destroy churn
    // causes GC stalls and (for Text) GPU texture uploads on Android ===
    _getPooledCircle(x, y, r, color, alpha) {
        if (!this._circlePool) this._circlePool = [];
        let c = this._circlePool.pop();
        if (!c) {
            c = this.add.circle(x, y, r, color, alpha);
        } else {
            c.setPosition(x, y).setRadius(r).setFillStyle(color, alpha)
             .setScale(1).setAlpha(1).setActive(true).setVisible(true);
        }
        return c;
    }

    _releaseCircle(c) {
        this.tweens.killTweensOf(c);
        c.setActive(false).setVisible(false);
        if (this._circlePool.length < 64) this._circlePool.push(c);
        else c.destroy();
    }

    _getPooledText(x, y, text, style) {
        if (!this._textPool) this._textPool = [];
        let t = this._textPool.pop();
        const styleKey = style.fontSize + '|' + style.color;
        if (!t) {
            t = this.add.text(x, y, text, style);
            t._styleKey = styleKey;
        } else {
            // Only re-apply style when it actually changed — setStyle forces a
            // full canvas re-render + GPU upload even for identical styles.
            if (t._styleKey !== styleKey) {
                t.setStyle(style);
                t._styleKey = styleKey;
            }
            t.setText(text);
            t.setPosition(x, y).setAlpha(1).setActive(true).setVisible(true);
        }
        return t;
    }

    _releaseText(t) {
        this.tweens.killTweensOf(t);
        t.setActive(false).setVisible(false);
        if (this._textPool.length < 24) this._textPool.push(t);
        else t.destroy();
    }

    poofAt(x, y, color) {
        // Bigger, juicier explosion: 12 particles in larger range (pooled)
        for (let i = 0; i < 12; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Phaser.Math.Between(20, 50);
            const p = this._getPooledCircle(x, y, Phaser.Math.Between(4, 8), color, 0.95).setDepth(600);
            this.tweens.add({
                targets: p, x: x + Math.cos(angle) * dist, y: y + Math.sin(angle) * dist,
                alpha: 0, scale: 0.2, duration: 450, ease: 'Quad.easeOut',
                onComplete: () => this._releaseCircle(p)
            });
        }
        // Flash ring
        const ring = this._getPooledCircle(x, y, 20, color, 0.6).setDepth(601);
        this.tweens.add({
            targets: ring, scale: 2.2, alpha: 0,
            duration: 300, ease: 'Quad.easeOut',
            onComplete: () => this._releaseCircle(ring)
        });
    }

    // =================================================================
    // STORY INTRO
    // =================================================================
    showStoryIntro() {
        const cam = this.cameras.main;
        const W = this.viewW, H = this.viewH;
        const D = LAYER.UI_INTRO;

        const elements = [];
        const addEl = (el) => { el.setScrollFactor(0).setDepth(D); elements.push(el); return el; };

        // Responsive sizing — scale based on screen height
        const s = Math.min(1, H / 720);
        const titleSize = Math.max(20, Math.round(Math.min(48, W * 0.05) * 1));
        const subTitleSize = Math.max(14, Math.round(titleSize * 0.55));
        const bodySize = Math.max(12, Math.round(17 * s));
        const hintSize = Math.max(11, Math.round(14 * s));
        const btnSize = Math.max(16, Math.round(28 * s));
        const btnPadX = Math.max(20, Math.round(30 * s));
        const btnPadY = Math.max(10, Math.round(12 * s));

        addEl(this.add.rectangle(0, 0, W, H, 0x000000, 0.92).setOrigin(0));

        // Title banner panel
        const bannerW = Math.min(W * 0.88, 720);
        const bannerH = Math.round(titleSize * 2.6);
        const bannerY = Math.round(50 * s) + bannerH / 2;
        const titleBanner = this.drawGothicPanel(W/2, bannerY, bannerW, bannerH, {
            accent: 0xffd040, bgTop: 0x3a0a3a, bgBot: 0x18041a,
            depth: D, themed: false
        });
        titleBanner.forEach(e => elements.push(e));

        // Stack from top: title block — body text — hints — button (pinned to bottom area)
        const padTop = Math.round(24 * s);
        let y = padTop;

        addEl(this.add.text(W/2, y + titleSize/2, 'МЫШОНОК ПИ', {
            fontFamily: 'Arial Black', fontSize: titleSize + 'px',
            color: '#f0d8ff', stroke: '#5a2080', strokeThickness: Math.max(4, Math.round(8 * s))
        }).setOrigin(0.5));
        y += titleSize + Math.round(2 * s);
        addEl(this.add.text(W/2, y + subTitleSize/2, 'и Замок Теней', {
            fontFamily: 'Arial Black', fontSize: subTitleSize + 'px',
            color: '#d0b0f0', stroke: '#3a0050', strokeThickness: Math.max(3, Math.round(4 * s))
        }).setOrigin(0.5));
        y += subTitleSize + Math.round(6 * s);
        const chapterLabelSize = Math.max(11, Math.round(15 * s));
        addEl(this.add.text(W/2, y + chapterLabelSize/2,
            this.isFinalFloor ? `🏰 Этаж ${this.chapter}/${TOTAL_FLOORS} — ДНО ЗАМКА`
                              : `Этаж ${this.chapter}/${TOTAL_FLOORS}`,
            { fontFamily: 'Arial', fontSize: chapterLabelSize + 'px', color: '#9a70b8', fontStyle: 'italic' }
        ).setOrigin(0.5));
        y += chapterLabelSize + Math.round(12 * s);

        // Body text — make Ch1 shorter for small screens
        const isSmall = H < 500;
        const introText = this.chapter === 1
            ? (isSmall
                ? 'Граф Ратула забрал бабушку в Замок Теней!\n\n' +
                  'Пи надел шлем, взял пироги-снаряды\n' +
                  'и спустился спасать бабушку.'
                : 'Каждое воскресенье Мышонок Пи бежал к бабушке\n' +
                  'за сырным пирогом.\n\n' +
                  'Сегодня он нашёл записку:\n' +
                  '«Внучок, помоги! Меня забрал граф Ратула...»\n\n' +
                  'Пи надел шлем и спустился спасать бабушку.')
            : this.isFinalFloor
            ? `Пи дошёл до самого низа замка!\n` +
              `Где-то здесь граф Ратула держит бабушку.\n` +
              `Найди ключ и спаси её!`
            : `Пи спускается всё глубже.\n` +
              `Подземелье темнее и опаснее.\n` +
              `Найди ключ и иди по лестнице вниз ⬇`;

        addEl(this.add.text(W/2, y, introText, {
            fontFamily: 'Arial', fontSize: bodySize + 'px', color: '#f0d8ff',
            align: 'center', lineSpacing: Math.round(3 * s),
            wordWrap: { width: W * 0.85 }
        }).setOrigin(0.5, 0));

        // Hints just above the button
        const btnH = btnSize + btnPadY * 2;
        const btnY = H - Math.round(40 * s) - btnH / 2;
        const hintY = btnY - btnH / 2 - hintSize - Math.round(6 * s);
        const hintLabel = IS_TOUCH
            ? 'Левый стик — ходьба   ·   Правый — прицел и огонь   ·   Кнопка — рывок'
            : 'WASD — ходьба   ·   Мышь — прицел   ·   ЛКМ / Space — огонь   ·   SHIFT — рывок   ·   C — красться';
        addEl(this.add.text(W/2, hintY, hintLabel, {
            fontFamily: 'Arial', fontSize: hintSize + 'px', color: '#9070b0',
            align: 'center', wordWrap: { width: W * 0.9 }
        }).setOrigin(0.5));

        const startGame = () => {
            bus.emit(UI.BUTTON_CLICK);
            this.tweens.add({
                targets: elements, alpha: 0, duration: 300,
                onComplete: () => {
                    elements.forEach(e => e.destroy());
                    this.state = 'play';
                    bus.emit(SFX.FLOOR_ENTER);
                    this._setHudVisible(true);
                    if (this.joy) this.setTouchUIVisible(!!(this._touchWanted || this._touchUsed));
                    this._pinFixed();
                }
            });
        };
        // Gothic Start button
        const btnW = Math.min(W * 0.5, 320);
        const gBtnH = btnH + 14;
        const startBtnEls = this.drawGothicButton(W/2, btnY, btnW, gBtnH, 'НАЧАТЬ', {
            color: 0x7a30a0, colorTop: 0xb060e0, hover: 0x9a40c0, hoverTop: 0xd080f0,
            accent: 0xffd040, fontSize: btnSize, depth: D + 5,
            onClick: startGame
        });
        startBtnEls.forEach(e => elements.push(e));
        this.input.keyboard.once('keydown-ENTER', startGame);
        this._pinFixed();
    }

    // =================================================================
    // DEVICE-PIXEL RENDERING — camera zoom = dpr; screen-space objects live in fixed layers in CSS px
    // =================================================================
    get viewW() { return this.cameras.main.width / this.dpr; }
    get viewH() { return this.cameras.main.height / this.dpr; }
    _layerOffset() { return { x: this.viewW * (this.dpr - 1) / 2, y: this.viewH * (this.dpr - 1) / 2 }; }
    _createFixedLayers() {
        const o = this._layerOffset();
        this.fxLayer = this.add.container(o.x, o.y).setScrollFactor(0).setDepth(700);
        this.uiLayer = this.add.container(o.x, o.y).setScrollFactor(0).setDepth(LAYER.UI_TOUCH);
    }
    // Move every top-level screen-space object into its fixed layer (call after creating HUD/overlays).
    // Display-list order is kept so equal-depth objects (backdrop → text) stack as before.
    _pinFixed() {
        if (!this.uiLayer) return;
        const list = this.sys.displayList.list;
        const fixed = [];
        for (let i = 0; i < list.length; i++) {
            const o = list[i];
            if (o === this.uiLayer || o === this.fxLayer || o.scrollFactorX !== 0 || o.parentContainer) continue;
            fixed.push(o);
        }
        if (fixed.length === 0) return;
        for (const o of fixed) (o.depth <= 800 ? this.fxLayer : this.uiLayer).add(o);
        this.uiLayer.sort('depth');
    }
    _cssPointer(p) {
        const d = this.dpr;
        return {
            x: p.x / d, y: p.y / d, worldX: p.worldX, worldY: p.worldY,
            id: p.id, isDown: p.isDown, pointerType: p.pointerType, event: p.event,
            button: p.button, wasTouch: p.wasTouch, pointer: p
        };
    }

    // World sprite from the art kit: textures are loaded at css×dpr, so display at 1/dpr.
    _worldImage(x, y, key, depth, originX = 0.5, originY = 0.5) {
        return this.add.image(x, y, key).setOrigin(originX, originY).setScale(1 / this.dpr).setDepth(depth);
    }

    // =================================================================
    // HUD
    // =================================================================
    buildHUD() {
        const FONT = '"Nunito", "Roboto", system-ui, sans-serif';
        const D = LAYER.UI_HUD;
        this.heartIcons = [];
        for (let i = 0; i < this.maxHp; i++) {
            this.heartIcons.push(this.add.image(0, 0, 'ui_heart').setOrigin(0, 0).setScrollFactor(0).setDepth(D));
        }
        this.cheeseIcon = this.add.image(0, 0, 'd_cheese').setOrigin(0, 0).setScrollFactor(0).setDepth(D);
        this.cheeseText = this.add.text(0, 0, '0/0', {
            fontFamily: FONT, fontSize: '24px',
            color: '#fff0a0', stroke: '#0a0410', strokeThickness: 5, fontStyle: '900',
        }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(D);
        this.keyIcon = this.add.image(0, 0, 'd_key').setOrigin(0, 0).setScrollFactor(0).setDepth(D).setAlpha(0.25);
        this.objectiveText = this.add.text(0, 0, 'Найди ключ', {
            fontFamily: FONT, fontSize: '17px', fontStyle: '500',
            color: '#f0d8ff', stroke: '#0a0410', strokeThickness: 3
        }).setScrollFactor(0).setDepth(D);
        this.scoreText = this.add.text(0, 0, '0', {
            fontFamily: FONT, fontSize: '22px',
            color: '#ffffff', stroke: '#0a0410', strokeThickness: 4, fontStyle: '700',
        }).setScrollFactor(0).setDepth(D);
        // Floor badge (hidden — shown by the floor intro)
        const floorLabel = this.isFinalFloor
            ? this.biome.name
            : `${this.biome.name} (${this.chapter}/${TOTAL_FLOORS})`;
        this.chapterText = this.add.text(0, 0, floorLabel, {
            fontFamily: FONT, fontSize: '13px',
            color: this.isFinalFloor ? '#ff8060' : '#d0b0f0',
            stroke: '#0a0410', strokeThickness: 2, fontStyle: '700', letterSpacing: 1,
        }).setScrollFactor(0).setDepth(D);
        this.upgradeIconsText = this.add.text(0, 0, '', { fontSize: '18px', color: '#ffffff' }).setScrollFactor(0).setDepth(D);
        // Combo display — centred under the cheese counter
        this.comboText = this.add.text(0, 0, '', {
            fontFamily: FONT, fontSize: '30px',
            color: '#e8b54a', stroke: '#3a1248', strokeThickness: 5, fontStyle: '900',
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(D).setVisible(false);
        // COMPASS arrow toward current objective (key → grandma / stairs)
        this.compass = this.add.graphics().setScrollFactor(0).setDepth(LAYER.UI_COMPASS);
        this.compassLabel = this.add.image(0, 0, 'd_key').setOrigin(0.5).setScrollFactor(0).setDepth(LAYER.UI_COMPASS_LABEL).setVisible(false);
        this._compassKey = null; this._compassAngle = undefined;  // fresh Graphics — force first redraw
        // Active power-up: icon + remaining seconds
        this.powerupIcon = this.add.image(0, 0, 'ui_bolt').setOrigin(0.5).setScrollFactor(0).setDepth(D).setVisible(false);
        this.powerupText = this.add.text(0, 0, '', {
            fontFamily: FONT, fontSize: '20px',
            color: '#ffffff', stroke: '#0a0410', strokeThickness: 4, fontStyle: '700',
        }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(D).setVisible(false);
        // === Suspicion meter — small circular gauge in the status row ===
        this.suspicionMeter = this.add.graphics().setScrollFactor(0).setDepth(LAYER.UI_HUD_2).setVisible(false);
        this.suspicionLabel = this.add.image(0, 0, 'ui_eye').setOrigin(0.5).setScrollFactor(0).setDepth(LAYER.UI_HUD_3).setVisible(false);
        // === Distraction book counter ===
        this.bookCounterIcon = this.add.image(0, 0, 'ui_book').setOrigin(0.5).setScrollFactor(0).setDepth(D);
        this.bookCounterText = this.add.text(0, 0, '×3', {
            fontFamily: FONT, fontSize: '17px',
            color: '#ffffff', stroke: '#0a0410', strokeThickness: 3, fontStyle: '700',
        }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(D);
        // === Crouch indicator ===
        this.crouchIcon = this.add.image(0, 0, 'ui_paw').setOrigin(0.5).setScrollFactor(0).setDepth(D).setAlpha(0.35);
        // Exit button — disc drawn in repositionHUD (radius scales), icon doubles as the hit area
        this.exitBtnBg = this.add.graphics().setScrollFactor(0).setDepth(LAYER.UI_HUD_BG);
        this.exitBtn = this.add.image(0, 0, 'ui_close').setOrigin(0.5).setScrollFactor(0).setDepth(D)
            .setInteractive(new Phaser.Geom.Circle(32, 32, 44), Phaser.Geom.Circle.Contains)
            .on('pointerdown', () => { bus.emit(UI.BUTTON_CLICK); this.exitToMenu(); });
        this.repositionHUD();
    }

    repositionHUD() {
        if (this.uiLayer) {
            const o = this._layerOffset();
            this.fxLayer.setPosition(o.x, o.y);
            this.uiLayer.setPosition(o.x, o.y);
        }
        if (!this.heartIcons) return;
        const cam = this.cameras.main;
        const L = computeHudLayout({ W: this.viewW, H: this.viewH, safe: readSafeArea(), maxHp: this.maxHp });
        this._hudLayout = L;
        for (let i = 0; i < this.heartIcons.length; i++) {
            const h = L.hearts[i];
            this.heartIcons[i].setPosition(h.x, h.y).setDisplaySize(h.size, h.size);
        }
        this.keyIcon.setPosition(L.key.x, L.key.y).setDisplaySize(L.key.w, L.key.h);
        this.cheeseIcon.setPosition(L.cheese.iconX, L.cheese.iconY).setDisplaySize(L.cheese.iconW, L.cheese.iconH);
        this.cheeseText.setPosition(L.cheese.textX, L.cheese.textY).setFontSize(L.cheese.fontSize);
        this.comboText.setPosition(L.combo.x, L.combo.y).setFontSize(L.combo.fontSize);
        // === MINIMAL HUD — stat counters hidden; floor/score shown by intro and win/lose screens ===
        this.objectiveText.setVisible(false);
        this.scoreText.setVisible(false);
        this.chapterText.setVisible(false);
        this.upgradeIconsText.setVisible(false);
        this.comboText.setVisible(false);
        // Status row
        this.suspicionMeter.setPosition(L.meter.cx, L.meter.cy);
        this.suspicionLabel.setPosition(L.eye.cx, L.eye.cy).setDisplaySize(L.eye.size, L.eye.size);
        this.bookCounterIcon.setPosition(L.book.cx, L.book.cy).setDisplaySize(L.book.size, L.book.size);
        this.bookCounterText.setPosition(L.bookText.x, L.bookText.y).setFontSize(L.bookText.fontSize);
        this.crouchIcon.setPosition(L.paw.cx, L.paw.cy).setDisplaySize(L.paw.size, L.paw.size);
        // Power-up row
        this.powerupIcon.setPosition(L.powerup.iconCx, L.powerup.iconCy).setDisplaySize(L.powerup.size, L.powerup.size);
        this.powerupText.setPosition(L.powerup.textX, L.powerup.textY).setFontSize(L.powerup.fontSize);
        // Exit button
        this.exitBtnBg.clear();
        this.exitBtnBg.fillStyle(0x140820, 0.92);
        this.exitBtnBg.fillCircle(0, 0, L.exit.r);
        this.exitBtnBg.lineStyle(2, 0xe8b54a, 0.75);
        this.exitBtnBg.strokeCircle(0, 0, L.exit.r);
        this.exitBtnBg.setPosition(L.exit.cx, L.exit.cy);
        this.exitBtn.setPosition(L.exit.cx, L.exit.cy).setDisplaySize(L.exit.iconSize, L.exit.iconSize);
        // Compass: label size / ring radius depend on the screen — force a redraw
        this._compassKey = null;
        if (this.joy) this.positionJoystick();
    }

    updateHUD() {
        if (this.maxHp > this.heartIcons.length) {
            while (this.heartIcons.length < this.maxHp) {
                this.heartIcons.push(this.add.image(0, 0, 'ui_heart').setOrigin(0, 0).setScrollFactor(0).setDepth(LAYER.UI_HUD));
            }
            this.repositionHUD();
            this._pinFixed();
        }
        for (let i = 0; i < this.heartIcons.length; i++) {
            const key = i < this.player.hp ? 'ui_heart' : 'ui_heart_empty';
            if (this.heartIcons[i].texture.key !== key) this.heartIcons[i].setTexture(key);
        }
        this.cheeseText.setText(`${this.cheeseGot}/${this.cheeseTotal}`);
        this.scoreText.setText(String(this.score));
        this.keyIcon.setAlpha(this.hasKey ? 1 : 0.25);
        // Objective text hidden permanently — compass arrow conveys "where to go"
        // COMPASS — points to current objective from screen center
        this.updateCompass();

        // Combo expires
        if (this.time.now > this._comboExpire) this._combo = 0;
        // Combo hidden — kill-streak doesn't need a counter on screen

        // Suspicion meter — show max suspicion across on-screen cone enemies in same screen rect
        let maxSus = 0;
        if (this.enemies) {
            const cam = this.cameras.main;
            for (const e of this.enemies) {
                if (e.dead || !e.stealthPatrol) continue;
                if (e.x < cam.worldView.x - 50 || e.x > cam.worldView.x + this.viewW + 50) continue;
                if (e.y < cam.worldView.y - 50 || e.y > cam.worldView.y + this.viewH + 50) continue;
                maxSus = Math.max(maxSus, e.suspicion || 0);
            }
        }
        if (maxSus > 0.05) {
            if (!this._hudHidden) {
                this.suspicionMeter.setVisible(true);
                this.suspicionLabel.setVisible(true);
            }
            this.suspicionMeter.clear();
            const color = maxSus < 0.5 ? 0xffd040 : (maxSus < 0.85 ? 0xff8040 : 0xff3030);
            const r = this._hudLayout.meter.r;
            // Background ring
            this.suspicionMeter.lineStyle(Math.max(2, Math.round(3 * this._hudLayout.s)), 0x000000, 0.6);
            this.suspicionMeter.strokeCircle(0, 0, r);
            // Filled arc
            this.suspicionMeter.lineStyle(Math.max(3, Math.round(4 * this._hudLayout.s)), color, 0.95);
            this.suspicionMeter.beginPath();
            this.suspicionMeter.arc(0, 0, r, -Math.PI/2, -Math.PI/2 + Math.PI*2 * maxSus, false);
            this.suspicionMeter.strokePath();
        } else {
            this.suspicionMeter.setVisible(false);
            this.suspicionLabel.setVisible(false);
        }
        // Book counter
        this.bookCounterText.setText(`×${this.distractionBooks || 0}`);
        // Crouch
        if (this.crouchIcon) this.crouchIcon.setAlpha(this.player?.crouch ? 1 : 0.35);

        // Active power-up timer — cache color + only setText when string actually changed
        if (this.activePowerup && this.time.now < this.activePowerup.endTime) {
            const remaining = ((this.activePowerup.endTime - this.time.now) / 1000).toFixed(1);
            const txt = `${remaining}с`;
            const iconKey = POWERUP_ICON[this.activePowerup.type] || 'ui_bolt';
            if (this.powerupIcon.texture.key !== iconKey) this.powerupIcon.setTexture(iconKey);
            if (this.powerupText.text !== txt) this.powerupText.setText(txt);
            if (!this.activePowerup.colorStr) {
                this.activePowerup.colorStr = '#' + this.activePowerup.tint.toString(16).padStart(6, '0');
            }
            if (this._powerupColorApplied !== this.activePowerup.colorStr) {
                this.powerupText.setColor(this.activePowerup.colorStr);
                this._powerupColorApplied = this.activePowerup.colorStr;
            }
            if (!this._hudHidden) {
                this.powerupText.setVisible(true);
                this.powerupIcon.setVisible(true);
            }
        } else {
            if (this.activePowerup) this.activePowerup = null;
            this._powerupColorApplied = null;
            this.powerupText.setVisible(false);
            this.powerupIcon.setVisible(false);
        }
    }

    // =================================================================
    // TOUCH
    // =================================================================
    setupTouchControls() {
        // Sizes from the shared HUD layout (uiScale + safe-area); radii are fixed for the run, offsets follow resize
        const cam = this.cameras.main;
        const L = computeHudLayout({ W: this.viewW, H: this.viewH, safe: readSafeArea(), maxHp: this.maxHp });
        const JOY_R = L.touch.joyR;
        const DASH_R = L.touch.dashR;
        const LABEL_FONT = `${L.touch.labelFont}px`;

        // === LEFT MOVEMENT JOYSTICK ===
        this.joy = { active: false, dx: 0, dy: 0, baseX: 0, baseY: 0, pointerId: null, R: JOY_R };
        // Outer dark backdrop
        this.joyOuter = this.add.circle(0, 0, JOY_R + 10, 0x000000, 0.35).setScrollFactor(0).setDepth(LAYER.UI_TOUCH);
        // Main base ring
        this.joyBase = this.add.circle(0, 0, JOY_R, 0xffffff, 0.10).setScrollFactor(0).setDepth(LAYER.UI_TOUCH_BASE);
        this.joyBase.setStrokeStyle(4, 0xffffff, 0.55);
        // 4 direction hints (subtle arrows around the rim)
        this.joyHints = this.add.image(0, 0, 'ui_move').setOrigin(0.5).setScrollFactor(0)
            .setDepth(LAYER.UI_TOUCH_HINT).setAlpha(0.15).setDisplaySize(JOY_R * 1.2, JOY_R * 1.2);
        // Knob — gradient-feel via solid fill + bright stroke
        this.joyKnob = this.add.circle(0, 0, JOY_R * 0.45, 0xffffff, 0.85).setScrollFactor(0).setDepth(LAYER.UI_TOUCH_KNOB);
        this.joyKnob.setStrokeStyle(3, 0xa0a0a0, 0.8);

        // === RIGHT AIM JOYSTICK ===
        this.aimStick = { active: false, dx: 0, dy: 0, baseX: 0, baseY: 0, pointerId: null, R: JOY_R };
        this.aimStickOuter = this.add.circle(0, 0, JOY_R + 10, 0x4a1c08, 0.40).setScrollFactor(0).setDepth(LAYER.UI_TOUCH);
        this.aimStickBase = this.add.circle(0, 0, JOY_R, 0xff8050, 0.18).setScrollFactor(0).setDepth(LAYER.UI_TOUCH_BASE);
        this.aimStickBase.setStrokeStyle(4, 0xff9a60, 0.65);
        this.aimStickHint = this.add.image(0, 0, 'd_pie').setOrigin(0.5).setScrollFactor(0)
            .setDepth(LAYER.UI_TOUCH_HINT).setAlpha(0.45).setDisplaySize(JOY_R * 0.7, JOY_R * 0.7);
        this.aimStickKnob = this.add.circle(0, 0, JOY_R * 0.45, 0xff7040, 0.95).setScrollFactor(0).setDepth(LAYER.UI_TOUCH_KNOB);
        this.aimStickKnob.setStrokeStyle(3, 0xffd0a0, 0.9);

        // === DASH BUTTON (separate, clearly above aim stick) ===
        this.dashBtn = { R: DASH_R, ready: true };
        this.dashBtnOuter = this.add.circle(0, 0, DASH_R + 8, 0x081c4a, 0.45).setScrollFactor(0).setDepth(LAYER.UI_TOUCH);
        this.dashBtnBase = this.add.circle(0, 0, DASH_R, 0x4080ff, 0.60).setScrollFactor(0).setDepth(LAYER.UI_TOUCH_BASE);
        this.dashBtnBase.setStrokeStyle(4, 0x80c0ff, 0.85);
        // Cooldown arc (filled wedge when on cooldown)
        this.dashBtnCdArc = this.add.graphics().setScrollFactor(0).setDepth(LAYER.UI_TOUCH_HINT);
        this._dashArcP = undefined;  // fresh GameObjects — force first redraw (Scene instance is reused)
        this.dashBtnLabel = this.add.image(0, 0, 'ui_dash').setOrigin(0.5).setScrollFactor(0)
            .setDepth(LAYER.UI_TOUCH_LABEL).setDisplaySize(DASH_R * 0.8, DASH_R * 0.8);

        // Labels under the joysticks
        this.joyLabel = this.add.text(0, 0, 'ХОДЬБА', {
            fontFamily: 'Arial Black', fontSize: LABEL_FONT,
            color: '#ffffff', alpha: 0.6
        }).setOrigin(0.5).setScrollFactor(0).setDepth(LAYER.UI_TOUCH_BASE).setAlpha(0.55);
        this.aimLabel = this.add.text(0, 0, 'ПРИЦЕЛ + ОГОНЬ', {
            fontFamily: 'Arial Black', fontSize: LABEL_FONT,
            color: '#ffd0a0'
        }).setOrigin(0.5).setScrollFactor(0).setDepth(LAYER.UI_TOUCH_BASE).setAlpha(0.65);
        this.dashLabel = this.add.text(0, 0, 'РЫВОК', {
            fontFamily: 'Arial Black', fontSize: LABEL_FONT,
            color: '#a0d0ff'
        }).setOrigin(0.5).setScrollFactor(0).setDepth(LAYER.UI_TOUCH_BASE).setAlpha(0.75);

        this.input.on('pointerdown', (p) => this.touchDown(this._cssPointer(p)));
        this.input.on('pointermove', (p) => this.touchMove(this._cssPointer(p)));
        this.input.on('pointerup', (p) => this.touchUp(this._cssPointer(p)));
        this.input.on('pointerupoutside', (p) => this.touchUp(this._cssPointer(p)));
        // Recover stuck stick state when the app is backgrounded / focus lost (Android home, notif shade, etc.)
        const releaseSticks = () => {
            if (this.joy && this.joy.active) this.touchUp({ id: this.joy.pointerId });
            if (this.aimStick && this.aimStick.active) this.touchUp({ id: this.aimStick.pointerId });
        };
        this._onVisibilityReset = () => { if (document.hidden) releaseSticks(); };
        this._onBlurReset = releaseSticks;
        document.addEventListener('visibilitychange', this._onVisibilityReset);
        window.addEventListener('blur', this._onBlurReset);
        this.events.once('shutdown', () => {
            document.removeEventListener('visibilitychange', this._onVisibilityReset);
            window.removeEventListener('blur', this._onBlurReset);
        });
        this.positionJoystick();
    }

    positionJoystick() {
        const cam = this.cameras.main;
        const W = this.viewW, H = this.viewH;

        const L = this._hudLayout || computeHudLayout({ W, H, safe: readSafeArea(), maxHp: this.maxHp });
        const bottomOff = L.touch.bottomOff;
        const sideOffL = L.touch.sideOffLeft, sideOffR = L.touch.sideOffRight;

        // Idle ALPHAs — sticks are faded hints until you touch them
        if (!this.joy.active)      this.setJoyAlpha(0);
        if (this.aimStick && !this.aimStick.active) this.setAimStickAlpha(0);

        // Reposition idle sticks to their rest corners (only when not held)
        if (!this.joy.active) {
            this.joy.baseX = sideOffL;
            this.joy.baseY = H - bottomOff;
            this.moveJoyTo(this.joy.baseX, this.joy.baseY);
        }
        if (this.aimStick && !this.aimStick.active) {
            this.aimStick.baseX = W - sideOffR;
            this.aimStick.baseY = H - bottomOff;
            this.moveAimStickTo(this.aimStick.baseX, this.aimStick.baseY);
        }

        // DASH — above aim stick with clear vertical gap (no overlap)
        if (this.dashBtn) {
            const gap = L.touch.dashGap;
            this.dashBtn.x = W - sideOffR;
            this.dashBtn.y = H - bottomOff - this.aimStick.R - this.dashBtn.R - gap;
            this.dashBtnOuter.setPosition(this.dashBtn.x, this.dashBtn.y);
            this.dashBtnBase.setPosition(this.dashBtn.x, this.dashBtn.y);
            this.dashBtnLabel.setPosition(this.dashBtn.x, this.dashBtn.y);
            this.dashLabel.setPosition(this.dashBtn.x, this.dashBtn.y + this.dashBtn.R + 10);
        }
    }

    // Redraw dash cooldown indicator (called from update)
    updateDashButton() {
        if (!this.dashBtnCdArc || !this.dashBtn) return;
        const cdMs = this.player.dashCooldown;
        const maxCd = PLAYER.dashCooldownMs * (this.dashCdMul || 1);
        const arcP = cdMs <= 0 ? -1 : Math.round((1 - Math.min(1, cdMs / maxCd)) * 50); // 2% buckets
        if (this._dashArcP === arcP) return;
        this._dashArcP = arcP;
        this.dashBtnCdArc.clear();
        if (cdMs <= 0) {
            // Ready — bright glow ring
            this.dashBtnBase.setFillStyle(0x4080ff, 0.70);
            this.dashBtnBase.setStrokeStyle(4, 0x80d0ff, 1.0);
            this.dashBtnLabel.setAlpha(1.0);
        } else {
            // On cooldown — dimmer + arc shrinking
            this.dashBtnBase.setFillStyle(0x203060, 0.65);
            this.dashBtnBase.setStrokeStyle(3, 0x4080a0, 0.7);
            this.dashBtnLabel.setAlpha(0.45);
            const p = 1 - Math.min(1, cdMs / maxCd);   // 0 → 1 as cooldown ends
            const start = -Math.PI / 2;
            const end = start + Math.PI * 2 * p;
            this.dashBtnCdArc.lineStyle(5, 0x80c0ff, 0.85);
            this.dashBtnCdArc.beginPath();
            this.dashBtnCdArc.arc(this.dashBtn.x, this.dashBtn.y, this.dashBtn.R + 4, start, end, false);
            this.dashBtnCdArc.strokePath();
        }
    }


    touchDown(p) {
        // Hybrid touch laptops: ignore mouse pointer so a left-click doesn't spawn a joystick
        if (p.pointerType === 'mouse') return;
        // Dash button — highest priority, fixed position
        if (this.dashBtn && Math.hypot(p.x - this.dashBtn.x, p.y - this.dashBtn.y) < this.dashBtn.R + 14) {
            this.tryDash();
            this.tweens.add({
                targets: this.dashBtnBase, scale: 0.85,
                duration: 80, yoyo: true, ease: 'Quad.easeOut'
            });
            this.tweens.add({
                targets: this.dashBtnLabel,
                scaleX: this.dashBtnLabel.scaleX * 0.85, scaleY: this.dashBtnLabel.scaleY * 0.85,
                duration: 80, yoyo: true, ease: 'Quad.easeOut'
            });
            return;
        }
        // Avoid the exit-X button area top-right
        const eB = this._hudLayout && this._hudLayout.exit;
        if (eB && Math.hypot(p.x - eB.cx, p.y - eB.cy) < eB.r + 10) return;

        const W = this.viewW;
        const half = W / 2;

        // === FLOATING JOYSTICKS — stick spawns where finger lands ===
        // Right half → aim stick (no need to find a base, finger position IS the base)
        if (p.x >= half && this.aimStick && !this.aimStick.active) {
            this.aimStick.active = true;
            this.aimStick.pointerId = p.id;
            this.aimStick.baseX = p.x;
            this.aimStick.baseY = p.y;
            this.moveAimStickTo(p.x, p.y);
            this.setAimStickAlpha(1.0);
            return;
        }
        // Left half → movement stick
        if (p.x < half && !this.joy.active) {
            this.joy.active = true;
            this.joy.pointerId = p.id;
            this.joy.baseX = p.x;
            this.joy.baseY = p.y;
            this.moveJoyTo(p.x, p.y);
            this.setJoyAlpha(1.0);
        }
    }

    moveJoyTo(x, y) {
        if (!this.joyBase) return;
        this.joyBase.setPosition(x, y);
        this.joyOuter.setPosition(x, y);
        this.joyHints.setPosition(x, y);
        this.joyKnob.setPosition(x, y);
        if (this.joyLabel) this.joyLabel.setPosition(x, y + this.joy.R + (this._hudLayout ? this._hudLayout.touch.labelOff : 18));
    }

    moveAimStickTo(x, y) {
        if (!this.aimStickBase) return;
        this.aimStickBase.setPosition(x, y);
        this.aimStickOuter.setPosition(x, y);
        this.aimStickHint.setPosition(x, y);
        this.aimStickKnob.setPosition(x, y);
        if (this.aimLabel) this.aimLabel.setPosition(x, y + this.aimStick.R + (this._hudLayout ? this._hudLayout.touch.labelOff : 18));
    }

    setJoyAlpha(a) {
        if (!this.joyBase) return;
        // Solid when held, very faded when idle (just a hint)
        const idle = a < 1;
        this.joyOuter.setAlpha(idle ? 0.35 : 1);
        this.joyBase.setAlpha(idle ? 0.45 : 1);
        this.joyHints.setAlpha(idle ? 0.10 : 0.25);
        this.joyKnob.setAlpha(idle ? 0.45 : 1);
        if (this.joyLabel) this.joyLabel.setAlpha(idle ? 0.40 : 0.7);
    }

    setAimStickAlpha(a) {
        if (!this.aimStickBase) return;
        const idle = a < 1;
        this.aimStickOuter.setAlpha(idle ? 0.35 : 1);
        this.aimStickBase.setAlpha(idle ? 0.45 : 1);
        this.aimStickHint.setAlpha(idle ? 0.20 : 0.55);
        this.aimStickKnob.setAlpha(idle ? 0.45 : 1);
        if (this.aimLabel) this.aimLabel.setAlpha(idle ? 0.40 : 0.7);
    }
    touchMove(p) {
        if (this.joy.active && this.joy.pointerId === p.id) this.updateJoyKnob(p);
        if (this.aimStick && this.aimStick.active && this.aimStick.pointerId === p.id) this.updateAimKnob(p);
    }
    touchUp(p) {
        if (this.joy && this.joy.active && this.joy.pointerId === p.id) {
            this.joy.active = false;
            this.joy.pointerId = null;
            this.joy.dx = 0; this.joy.dy = 0;
            // Snap back to idle resting position in the bottom-left corner
            const cam = this.cameras.main;
            const L = this._hudLayout || computeHudLayout({ W: this.viewW, H: this.viewH, safe: readSafeArea(), maxHp: this.maxHp });
            this.joy.baseX = L.touch.sideOffLeft; this.joy.baseY = this.viewH - L.touch.bottomOff;
            this.moveJoyTo(this.joy.baseX, this.joy.baseY);
            this.setJoyAlpha(0);
        }
        if (this.aimStick && this.aimStick.active && this.aimStick.pointerId === p.id) {
            this.aimStick.active = false;
            this.aimStick.pointerId = null;
            this.aimStick.dx = 0; this.aimStick.dy = 0;
            const cam = this.cameras.main;
            const L = this._hudLayout || computeHudLayout({ W: this.viewW, H: this.viewH, safe: readSafeArea(), maxHp: this.maxHp });
            this.aimStick.baseX = this.viewW - L.touch.sideOffRight; this.aimStick.baseY = this.viewH - L.touch.bottomOff;
            this.moveAimStickTo(this.aimStick.baseX, this.aimStick.baseY);
            this.setAimStickAlpha(0);
        }
    }
    updateJoyKnob(p) {
        const dx = p.x - this.joy.baseX;
        const dy = p.y - this.joy.baseY;
        const len = Math.hypot(dx, dy);
        const maxR = this.joy.R;
        // Tiny dead zone (~4%) — prevents jitter on rest
        const DEAD = maxR * 0.04;
        if (len < DEAD) {
            this.joy.dx = 0; this.joy.dy = 0;
            this.joyKnob.setPosition(this.joy.baseX, this.joy.baseY);
            return;
        }
        if (len > maxR) {
            // Pinned to edge — full velocity
            this.joy.dx = dx / len;
            this.joy.dy = dy / len;
            this.joyKnob.setPosition(this.joy.baseX + this.joy.dx * maxR, this.joy.baseY + this.joy.dy * maxR);
        } else {
            // Within stick — sensitivity curve. Power 0.7 means tiny movements
            // map to ~22% input instead of ~10%, much more responsive feel.
            const t = (len - DEAD) / (maxR - DEAD);
            const curved = Math.pow(Math.min(1, t), 0.7);
            this.joy.dx = (dx / len) * curved;
            this.joy.dy = (dy / len) * curved;
            this.joyKnob.setPosition(p.x, p.y);
        }
    }
    updateAimKnob(p) {
        const dx = p.x - this.aimStick.baseX;
        const dy = p.y - this.aimStick.baseY;
        const len = Math.hypot(dx, dy);
        const maxR = this.aimStick.R;
        // Tinier dead zone for aim (~3%) — precision matters
        const DEAD = maxR * 0.03;
        if (len < DEAD) {
            this.aimStick.dx = 0; this.aimStick.dy = 0;
            this.aimStickKnob.setPosition(this.aimStick.baseX, this.aimStick.baseY);
            return;
        }
        if (len > maxR) {
            this.aimStick.dx = dx / len;
            this.aimStick.dy = dy / len;
            this.aimStickKnob.setPosition(this.aimStick.baseX + this.aimStick.dx * maxR, this.aimStick.baseY + this.aimStick.dy * maxR);
        } else {
            // Aim uses direction primarily, but apply a mild curve so small flicks are responsive
            const t = (len - DEAD) / (maxR - DEAD);
            const curved = Math.pow(Math.min(1, t), 0.85);
            this.aimStick.dx = (dx / len) * curved;
            this.aimStick.dy = (dy / len) * curved;
            this.aimStickKnob.setPosition(p.x, p.y);
        }
    }

    // =================================================================
    // CROSSHAIR (desktop)
    // =================================================================
    setupCrosshair() {
        // Aim indicator that orbits Pi at a fixed world-space radius — shows direction
        const aimDot = this.add.graphics().setDepth(2000);  // world space (scrollFactor 1 default)
        aimDot.lineStyle(2, 0xffd040, 0.95);
        aimDot.strokeCircle(0, 0, 9);
        aimDot.lineStyle(2, 0xffd040, 0.6);
        aimDot.lineBetween(-14, 0, -6, 0);
        aimDot.lineBetween(6, 0, 14, 0);
        aimDot.lineBetween(0, -14, 0, -6);
        aimDot.lineBetween(0, 6, 0, 14);
        aimDot.setVisible(false);
        this.aimIndicator = aimDot;

        // Faint line from Pi to aim indicator for extra clarity
        this.aimLine = this.add.graphics().setDepth(1999);
        this.aimLine.setVisible(false);
    }

    updateCrosshair() {
        if (!this.aimIndicator) return;
        // When NOT actively playing — restore native cursor and hide aim UI
        if (this.state !== 'play') {
            this.aimIndicator.setVisible(false);
            this.aimLine.setVisible(false);
            if (this.game.canvas && this.game.canvas.style && this.game.canvas.style.cursor === 'none') {
                this.game.canvas.style.cursor = '';
            }
            return;
        }
        const mouse = this.input.mousePointer;
        // recently-moved (within 800ms) — same window used at line 1759 for aim picking
        const mouseRecentlyUsed = mouse && (this.time.now - this._mouseMovedAt) < 800;
        const anyAimInput = mouseRecentlyUsed || this.keys?.Q?.isDown || this.keys?.E?.isDown ||
                            this.cursors?.left?.isDown || this.cursors?.right?.isDown ||
                            this.cursors?.up?.isDown || this.cursors?.down?.isDown ||
                            (this.aimStick && this.aimStick.active);
        if (!anyAimInput) {
            this.aimIndicator.setVisible(false);
            this.aimLine.setVisible(false);
            // Restore native cursor when mouse stops being used
            if (this.game.canvas && this.game.canvas.style && this.game.canvas.style.cursor === 'none') {
                this.game.canvas.style.cursor = '';
            }
            return;
        }

        // Place aim indicator at fixed world-space distance from Pi in aim direction
        const RADIUS = 240;
        const angle = this.player?.aimAngle || 0;
        const ax = (this.player?.x || 0) + Math.cos(angle) * RADIUS;
        const ay = (this.player?.y || 0) + Math.sin(angle) * RADIUS;
        this.aimIndicator.setPosition(ax, ay).setVisible(true);

        // Dotted-ish line from Pi to indicator (3 short segments)
        this.aimLine.clear();
        this.aimLine.lineStyle(2, 0xffd040, 0.25);
        const px = this.player.x, py = this.player.y;
        const segments = 6;
        for (let i = 0; i < segments; i++) {
            if (i % 2 === 0) {
                const t1 = (i + 0.2) / segments;
                const t2 = (i + 0.8) / segments;
                this.aimLine.lineBetween(
                    px + (ax - px) * t1, py + (ay - py) * t1,
                    px + (ax - px) * t2, py + (ay - py) * t2
                );
            }
        }
        this.aimLine.setVisible(true);

        // Hide native cursor while playing with mouse
        if (mouseRecentlyUsed && this.game.canvas && this.game.canvas.style && this.game.canvas.style.cursor !== 'none') {
            this.game.canvas.style.cursor = 'none';
        }
    }

    updateCompass() {
        if (!this.compass) return;
        // Target: key first → captive (final floor) or exit door (intermediate floor)
        let target, icon;
        if (!this.hasKey && this.keyPickup && !this.keyPickup.taken) {
            target = this.keyPickup; icon = 'key';
        } else if (this.captive) {
            target = this.captive; icon = 'grandma';
        } else if (this.exit) {
            target = this.exit; icon = 'exit';
        }
        if (!target) {
            this.compass.clear();
            this.compassLabel.setVisible(false);
            this._compassKey = null;
            return;
        }
        const cam = this.cameras.main;
        const cx = this.viewW / 2, cy = this.viewH / 2;
        const dx = target.x - this.player.x;
        const dy = target.y - this.player.y;
        const dist = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx);
        // Skip the clear+retessellate when nothing moved meaningfully
        const key = icon + '|' + this.viewW + '|' + this.viewH;
        if (this._compassKey === key && Math.abs((this._compassAngle ?? 99) - angle) < 0.02) return;
        this._compassKey = key;
        this._compassAngle = angle;
        // Position arrow on a ring near screen edge
        const ringR = this._hudLayout.compass.ringR;
        const ax = cx + Math.cos(angle) * ringR;
        const ay = cy + Math.sin(angle) * ringR;
        this.compass.clear();
        // Arrow triangle pointing in `angle` direction
        const size = this._hudLayout.compass.arrowSize;
        const tipX = ax + Math.cos(angle) * size;
        const tipY = ay + Math.sin(angle) * size;
        const leftX  = ax + Math.cos(angle + 2.5) * size;
        const leftY  = ay + Math.sin(angle + 2.5) * size;
        const rightX = ax + Math.cos(angle - 2.5) * size;
        const rightY = ay + Math.sin(angle - 2.5) * size;
        // Outline
        this.compass.fillStyle(0xffd040, 0.95);
        this.compass.lineStyle(3, 0x1a1a1a, 1);
        this.compass.beginPath();
        this.compass.moveTo(tipX, tipY);
        this.compass.lineTo(leftX, leftY);
        this.compass.lineTo(rightX, rightY);
        this.compass.closePath();
        this.compass.fillPath();
        this.compass.strokePath();
        // Icon slightly back from the arrow
        const [tex, wf, hf] = COMPASS_ICON[icon];
        const ls = this._hudLayout.compass.labelSize;
        if (this.compassLabel.texture.key !== tex) this.compassLabel.setTexture(tex);
        this.compassLabel.setDisplaySize(ls * wf, ls * hf);
        this.compassLabel.setPosition(ax - Math.cos(angle) * ls, ay - Math.sin(angle) * ls);
        if (!this._hudHidden) this.compassLabel.setVisible(true);
        // Show distance below
        // (skip for clutter)
    }

    _setHudVisible(v) {
        const objs = [
            ...(this.heartIcons || []), this.cheeseIcon, this.cheeseText, this.keyIcon, this.compass, this.compassLabel,
            this.powerupIcon, this.powerupText, this.suspicionMeter, this.suspicionLabel,
            this.bookCounterIcon, this.bookCounterText, this.crouchIcon, this.exitBtnBg, this.exitBtn,
        ];
        for (const o of objs) if (o) o.setVisible(v);
        this._hudHidden = !v;
    }

    setTouchUIVisible(visible) {
        const items = [
            this.joyOuter, this.joyBase, this.joyHints, this.joyKnob, this.joyLabel,
            this.aimStickOuter, this.aimStickBase, this.aimStickHint, this.aimStickKnob, this.aimLabel,
            this.dashBtnOuter, this.dashBtnBase, this.dashBtnCdArc, this.dashBtnLabel, this.dashLabel
        ];
        for (const it of items) if (it) it.setVisible(visible);
        // Force-clear stick state when hiding so a stale touch can't drive Pi after we transition away
        if (!visible) {
            if (this.joy) { this.joy.active = false; this.joy.dx = 0; this.joy.dy = 0; this.joy.pointerId = null; }
            if (this.aimStick) { this.aimStick.active = false; this.aimStick.dx = 0; this.aimStick.dy = 0; this.aimStick.pointerId = null; }
        }
    }

    // =================================================================
    // STATE
    // =================================================================
    win() {
        if (this.state !== 'play') return;
        this.state = 'won';
        const bonus = this.player.hp * 25;
        this.score += bonus;
        // Per-floor completion bonus + cheese
        const floorBonus = 20 + this.chapter * 10;
        this.score += floorBonus;
        // Ghost-run bonus: 0 alarms AND biome had stealth rooms → +cheese + score + log progress
        const hadStealth = (this.biome?.stealthRoomsPerFloor || 0) > 0;
        if (hadStealth && (this.runAlarmCount || 0) === 0) {
            const ghostCheese = 50 * this.chapter;
            this.runCheeseTotal = (this.runCheeseTotal || 0) + ghostCheese;
            this.score += 200;
            this.showFloatingText(this.player.x, this.player.y - 60, `🥷 Тихая лапка! +${ghostCheese}🧀`, '#80ff80', 26);
            try { Progress.incrementGhostRuns(); } catch (e) {}
            bus.emit(SFX.GHOST_RUN);
        }
        const totalScore = this.runScore + this.score;

        if (this.isFinalFloor) {
            const earned = this.runCheeseTotal || 0;
            Progress.addCheese(earned);
            const durationMs = (typeof performance !== 'undefined' ? performance.now() : 0) - this.runStartTime;
            Progress.recordStoryWin(totalScore, durationMs);
            bus.emit(SFX.WIN_STORY);
            this.showOverlay(
                '🎉 БАБУШКА СПАСЕНА! 🎉',
                `Пи дошёл до дна и освободил бабушку!\n\n` +
                `🧀 Получено сыра: +${earned}\n` +
                `🧀 Всего сыра: ${Progress.getCheese()}`,
                0xffd040, '👵🐭',
                '▶ ИГРАТЬ ЗАНОВО',
                () => this.scene.start('DungeonScene', { runMode: 'story', chapter: 1 }),
                '🏪 В ЛАВКУ',
                () => { bus.emit(BGM.MENU); this.scene.start('TransylvaniaScene', { openShop: true }); }
            );
        } else {
            // INTERMEDIATE FLOOR — show upgrade picker, then descend
            this.showUpgradePicker();
        }
    }

    showRelicPicker() {
        // Pause input briefly
        const cam = this.cameras.main;
        const W = this.viewW, H = this.viewH;
        const D = LAYER.UI_PICKER;
        const choices = pickRandomRelics(3, this.collectedRelics || []);
        if (choices.length === 0) return;
        bus.emit(UI.MENU_OPEN);
        const els = [];
        const addEl = (e, dep) => { e.setScrollFactor(0).setDepth(dep || D); els.push(e); return e; };
        addEl(this.add.rectangle(0, 0, W, H, 0x000000, 0.86).setOrigin(0).setInteractive());
        if (this.aimIndicator) this.aimIndicator.setVisible(false);
        if (this.aimLine) this.aimLine.setVisible(false);
        // Panel
        const panelW = Math.min(W * 0.92, 760);
        const panelH = Math.min(H * 0.88, 460);
        const panelEls = this.drawGothicPanel(W/2, H/2, panelW, panelH, {
            accent: 0xa080ff, bgTop: 0x2a1840, bgBot: 0x10081e,
            depth: D, theme: ['⚱', '✨', '🦇', '📿']
        });
        panelEls.forEach(e => { e.setScrollFactor(0); els.push(e); });
        addEl(this.add.text(W/2, H/2 - panelH/2 + 30, '⚱ ДРЕВНЯЯ РЕЛИКВИЯ', {
            fontFamily: 'Arial Black', fontSize: '26px',
            color: '#ffd040', stroke: '#3a1858', strokeThickness: 6
        }).setOrigin(0.5));
        addEl(this.add.text(W/2, H/2 - panelH/2 + 62, 'Выбери одну на весь забег:', {
            fontFamily: 'Arial', fontSize: '14px', color: '#c0a0e0'
        }).setOrigin(0.5));

        const cardGap = 20;
        const cardW = (panelW - 50 - cardGap * 2) / 3;
        const cardH = panelH - 140;
        const cardCy = H/2 + 18;
        const startX = W/2 - (cardW * 3 + cardGap * 2)/2;

        choices.forEach((relic, i) => {
            const cx = startX + i * (cardW + cardGap) + cardW/2;
            const colors = RARITY_COLORS[relic.rarity] || RARITY_COLORS.common;
            const onPick = () => {
                this.collectedRelics = [...(this.collectedRelics || []), relic.id];
                relic.apply(this);
                bus.emit(SFX.COLLECT_POWERUP);
                this.showFloatingText(this.player.x, this.player.y - 60, `${relic.emoji} ${relic.name}!`, '#ffd040', 22);
                if (this.aimIndicator) this.aimIndicator.setVisible(true);
                if (this.aimLine) this.aimLine.setVisible(true);
                els.forEach(e => e.destroy());
            };
            const cardObj = this.drawGothicCard(cx, cardCy, cardW, cardH, {
                bgTop: colors.fill, bgBot: 0x100818,
                accent: colors.accent, hoverAccent: 0xffd040,
                depth: D + 5, onClick: onPick
            });
            cardObj.els.forEach(e => els.push(e));
            // Rarity tag
            const rarityTxt = relic.rarity === 'legendary' ? 'ЛЕГЕНДАРНАЯ'
                            : relic.rarity === 'rare' ? 'РЕДКАЯ' : 'ОБЫЧНАЯ';
            els.push(this.add.text(cx, cardCy - cardH * 0.36, rarityTxt, {
                fontFamily: 'Arial Black', fontSize: '11px',
                color: '#' + colors.accent.toString(16).padStart(6, '0'),
                stroke: '#000', strokeThickness: 2
            }).setOrigin(0.5).setScrollFactor(0).setDepth(D + 8));
            els.push(this.add.text(cx, cardCy - cardH * 0.20, relic.emoji, {
                fontSize: '48px'
            }).setOrigin(0.5).setScrollFactor(0).setDepth(D + 8));
            els.push(this.add.text(cx, cardCy + cardH * 0.04, relic.name, {
                fontFamily: 'Arial Black', fontSize: '16px',
                color: '#ffffff', stroke: '#1a0a3a', strokeThickness: 3, align: 'center',
                wordWrap: { width: cardW - 14 }
            }).setOrigin(0.5).setScrollFactor(0).setDepth(D + 8));
            els.push(this.add.text(cx, cardCy + cardH * 0.26, relic.desc, {
                fontFamily: 'Arial', fontSize: '12px', color: '#e0c0ff',
                align: 'center', wordWrap: { width: cardW - 14 }
            }).setOrigin(0.5).setScrollFactor(0).setDepth(D + 8));
        });
        this._pinFixed();
    }

    showUpgradePicker() {
        // Cache the choices so they survive a shop side-trip
        if (!this._cachedUpgradeChoices) {
            // Count current stacks per upgrade id; filter out capped ones
            const stacks = {};
            for (const id of this.upgradeIds) stacks[id] = (stacks[id] || 0) + 1;
            const available = UPGRADES.filter(u => (stacks[u.id] || 0) < (u.cap || 1));
            const pool = available.length >= 3 ? available.slice() : UPGRADES.slice();
            Phaser.Utils.Array.Shuffle(pool);
            this._cachedUpgradeChoices = pool.slice(0, 3);
        }
        const choices = this._cachedUpgradeChoices;
        bus.emit(UI.MENU_OPEN);

        if (this.game.canvas && this.game.canvas.style) this.game.canvas.style.cursor = '';
        if (this.aimIndicator) this.aimIndicator.setVisible(false);
        if (this.aimLine) this.aimLine.setVisible(false);
        if (this.compass) this.compass.clear();
        if (this.compassLabel) this.compassLabel.setVisible(false);

        const cam = this.cameras.main;
        const W = this.viewW, H = this.viewH;
        const D = LAYER.UI_OVERLAY;
        // Track every overlay element so we can hide them when shop opens
        this._pickerElements = [];
        const addEl = (el, dep) => {
            el.setScrollFactor(0).setDepth(dep || D);
            this._pickerElements.push(el);
            return el;
        };

        // Responsive sizes
        const panelW = Math.min(W * 0.95, 800);
        const panelH = Math.min(H * 0.95, 520);
        const s = Math.min(1, Math.min(panelW / 800, panelH / 520));
        const titleSize = Math.max(18, Math.round(32 * s));
        const subSize = Math.max(12, Math.round(16 * s));
        const cardGap = Math.max(10, Math.round(26 * s));
        const cardW = Math.min(220 * s, (panelW - 50 - cardGap * 2) / 3);
        const cardH = panelH - Math.round(200 * s);
        const cardIcoSize = Math.max(32, Math.round(58 * s));
        const cardNameSize = Math.max(13, Math.round(18 * s));
        const cardDescSize = Math.max(10, Math.round(13 * s));

        addEl(this.add.rectangle(0, 0, W, H, 0x000000, 0.85).setOrigin(0));
        // Gothic panel
        const panelEls = this.drawGothicPanel(W/2, H/2, panelW, panelH, {
            accent: 0xa060ff, bgTop: 0x3a1858, bgBot: 0x1a0830,
            depth: D, theme: ['📜', '🦇', '🕯️', '✨']
        });
        panelEls.forEach(e => { e.setScrollFactor(0); this._pickerElements.push(e); });

        const top = H/2 - panelH/2;
        let cy = top + Math.round(18 * s);
        addEl(this.add.text(W/2, cy + titleSize/2, `✨ Этаж ${this.chapter} пройден!`, {
            fontFamily: 'Arial Black', fontSize: titleSize + 'px', color: '#ffffff',
            stroke: '#5a2080', strokeThickness: Math.max(3, Math.round(5 * s))
        }).setOrigin(0.5));
        cy += titleSize + Math.round(6 * s);
        addEl(this.add.text(W/2, cy + subSize/2, 'Выбери улучшение перед спуском глубже:', {
            fontFamily: 'Arial', fontSize: subSize + 'px', color: '#d0b0f0'
        }).setOrigin(0.5));
        cy += subSize + Math.round(4 * s);
        addEl(this.add.text(W/2, cy + (subSize - 2)/2,
            `❤️ ${this.player.hp}/${this.maxHp}   🧀 ${Progress.getCheese()} в банке`,
            { fontFamily: 'Arial', fontSize: (subSize - 2) + 'px', color: '#9070b0' }
        ).setOrigin(0.5));
        cy += subSize + Math.round(14 * s);

        // SHOP BUTTON — top-right of panel
        const shopBtnSize = Math.max(14, Math.round(16 * s));
        const shopBtn = this.add.text(W/2 + panelW/2 - Math.round(14 * s), top + Math.round(14 * s),
            '🏪 ЛАВКА', {
                fontFamily: 'Arial Black', fontSize: shopBtnSize + 'px',
                color: '#ffffff', backgroundColor: '#c89530',
                padding: { x: Math.round(12 * s), y: Math.round(6 * s) },
                stroke: '#5a3010', strokeThickness: 2
            })
            .setOrigin(1, 0)
            .setScrollFactor(0).setDepth(D + 12)
            .setInteractive({ useHandCursor: true })
            .on('pointerover', () => shopBtn.setBackgroundColor('#f5b048'))
            .on('pointerout',  () => shopBtn.setBackgroundColor('#c89530'))
            .on('pointerdown', () => this.openInRunShop());
        this._pickerElements.push(shopBtn);

        const cardCy = cy + cardH / 2;
        const totalW = cardW * 3 + cardGap * 2;
        const startX = W/2 - totalW/2;
        choices.forEach((upg, i) => {
            const cx = startX + i * (cardW + cardGap) + cardW/2;
            const onPick = () => {
                bus.emit(UI.BUTTON_CLICK);
                const nextUpgrades = [...this.upgradeIds, upg.id];
                this._cachedUpgradeChoices = null;
                this.scene.start('DungeonScene', {
                    runMode: this.runMode,
                    chapter: this.chapter + 1,
                    upgradeIds: nextUpgrades,
                    runScore: this.runScore + this.score,
                    runCheeseTotal: this.runCheeseTotal,
                    runStartTime: this.runStartTime,
                    runAlarmCount: this.runAlarmCount,
                    collectedRelics: this.collectedRelics
                });
            };
            // Gothic card with gradient + drop shadow + gold inner trim
            const cardObj = this.drawGothicCard(cx, cardCy, cardW, cardH, {
                accent: 0xa060ff, bgTop: 0x3a1858, bgBot: 0x1a0830,
                hoverAccent: 0xffd040, hoverBgTop: 0x4a2870, hoverBgBot: 0x2a1858,
                depth: D + 5, onClick: onPick
            });
            cardObj.els.forEach(e => this._pickerElements.push(e));
            const ico = this.add.text(cx, cardCy - cardH * 0.28, upg.emoji,
                { fontSize: cardIcoSize + 'px' })
                .setOrigin(0.5).setScrollFactor(0).setDepth(D + 8);
            const nm = this.add.text(cx, cardCy + cardH * 0.04, upg.name, {
                fontFamily: 'Arial Black', fontSize: cardNameSize + 'px',
                color: '#ffffff', stroke: '#1a0a3a',
                strokeThickness: Math.max(3, Math.round(4 * s)), align: 'center',
                wordWrap: { width: cardW - 14 }
            }).setOrigin(0.5).setScrollFactor(0).setDepth(D + 8);
            const ds = this.add.text(cx, cardCy + cardH * 0.30, upg.desc, {
                fontFamily: 'Arial', fontSize: cardDescSize + 'px', color: '#e0c0ff',
                align: 'center', wordWrap: { width: cardW - 14 }
            }).setOrigin(0.5).setScrollFactor(0).setDepth(D + 8);
            this._pickerElements.push(ico, nm, ds);
        });
        this._pinFixed();
    }

    // === IN-RUN SHOP — opens over the upgrade picker between floors ===
    openInRunShop() {
        const reopen = this._shopReopen;   // a purchase refreshes the panel — no second ui_open
        this._shopReopen = false;
        if (!reopen) bus.emit(UI.MENU_OPEN);
        if (this._pickerElements) this._pickerElements.forEach(e => e.setVisible(false));
        const cam = this.cameras.main;
        const W = this.viewW, H = this.viewH;
        const D = LAYER.UI_SHOP;

        this._shopElements = [];
        const addEl = (el, dep) => {
            el.setScrollFactor(0).setDepth(dep || D);
            this._shopElements.push(el);
            return el;
        };

        const panelW = Math.min(W * 0.95, 780);
        const panelH = Math.min(H * 0.95, 520);
        const s = Math.min(1, Math.min(panelW / 780, panelH / 520));

        // Interactive backdrop — tap outside the panel to close, also blocks pass-through to picker cards
        addEl(this.add.rectangle(0, 0, W, H, 0x000000, 0.86).setOrigin(0)
            .setInteractive()
            .on('pointerdown', () => this.closeInRunShop()));
        // Gothic shop panel
        const shopPanelEls = this.drawGothicPanel(W/2, H/2, panelW, panelH, {
            accent: 0xd49920, bgTop: 0x4a2010, bgBot: 0x1a0808,
            depth: D, theme: ['🪙', '🐭', '🛍️', '🍯']
        });
        shopPanelEls.forEach(e => { e.setScrollFactor(0); this._shopElements.push(e); });

        // Title — stroke only (no setShadow, see DungeonScene perf notes)
        addEl(this.add.text(W/2, H/2 - panelH/2 + Math.round(28 * s),
            '🏪 ЛАВКА ДЯДЮШКИ', {
                fontFamily: 'Arial Black', fontSize: Math.max(20, Math.round(30 * s)) + 'px',
                color: '#ffd060', stroke: '#5a3010', strokeThickness: 6
            }).setOrigin(0.5));

        // Balance top-right
        const balanceText = addEl(this.add.text(W/2 + panelW/2 - 20, H/2 - panelH/2 + 24,
            `🧀 ${Progress.getCheese()}`, {
                fontFamily: 'Arial Black', fontSize: Math.max(16, Math.round(22 * s)) + 'px',
                color: '#ffe080', stroke: '#1a0a3a', strokeThickness: 4
            }).setOrigin(1, 0.5));

        // Close X — top-left, sized for thumb tap (48dp Material minimum)
        const closeBtn = addEl(this.add.text(W/2 - panelW/2 + 18, H/2 - panelH/2 + 22, '✕', {
            fontFamily: 'Arial Black', fontSize: '28px',
            color: '#ffffff', backgroundColor: '#7a3a3a', padding: { x: 14, y: 10 }
        }).setOrigin(0, 0)
            .setInteractive({ useHandCursor: true })
            .on('pointerdown', () => this.closeInRunShop()), D + 5);

        // Hint below title
        addEl(this.add.text(W/2, H/2 - panelH/2 + Math.round(60 * s),
            'Покупки применятся со следующего этажа', {
                fontFamily: 'Arial', fontSize: Math.max(11, Math.round(13 * s)) + 'px',
                color: '#a070c0'
            }).setOrigin(0.5));

        // Two columns: hats left, upgrades right
        const colGap = Math.max(10, Math.round(20 * s));
        const colW = (panelW - 60) / 2;
        const leftX = W/2 - panelW/2 + 30;
        const rightX = leftX + colW + colGap;
        const topY = H/2 - panelH/2 + Math.round(95 * s);

        addEl(this.add.text(leftX + colW/2, topY, '🐭 СКИНЫ', {
            fontFamily: 'Arial Black', fontSize: Math.max(14, Math.round(18 * s)) + 'px',
            color: '#ffffff', stroke: '#d49920', strokeThickness: 3
        }).setOrigin(0.5));

        const refreshShop = () => {
            balanceText.setText(`🧀 ${Progress.getCheese()}`);
        };

        // === RESPONSIVE SKIN GRID ===
        const isMobile = W < 700;
        const skinCols = isMobile ? 2 : 3;
        const skinGap = 8;
        const cardW = (colW - skinGap * (skinCols - 1)) / skinCols;
        const cardH = isMobile ? Math.max(100, cardW * 0.95) : Math.max(120, cardW * 1.0);
        const gridStartY = topY + Math.round(26 * s);

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
            const bg = unlocked ? (equipped ? 0x3a5028 : 0x2a1248) : 0x301818;
            const accentColor = unlocked ? (equipped ? 0x80ff60 : 0xa060ff) : 0x804040;

            const card = addEl(this.add.rectangle(cx, cy, cardW - 2, cardH - 2, bg, 0.95)
                .setStrokeStyle(2, accentColor)
                .setInteractive({ useHandCursor: true }), D + 1);

            // Skin name — top
            addEl(this.add.text(cx, cy - cardH/2 + 14, skin.name, {
                fontFamily: 'Arial Black', fontSize: '11px',
                color: '#ffffff', align: 'center',
                wordWrap: { width: cardW - 8 }
            }).setOrigin(0.5, 0), D + 2);

            // Real skin sprite preview — uses each skin's own SVG
            const previewY = cy - cardH * 0.06;
            const previewKey = (skin.spriteKey && this.textures.exists(skin.spriteKey)) ? skin.spriteKey : 'd_pi';
            const piPreview = addEl(this.add.image(cx, previewY, previewKey)
                .setOrigin(0.5, 0.5).setScale(0.32), D + 2);
            if (skin.id === 'shadow') piPreview.setAlpha(0.85);
            if (skin.id === 'angel') piPreview.setAlpha(0.95);

            // Price / state — bottom
            const subText = unlocked ? (equipped ? '✓ НАДЕТ' : 'Надеть') : `🧀 ${skin.price}`;
            const subColor = unlocked ? (equipped ? '#80ff80' : '#a0a0c0') : '#ffd060';
            addEl(this.add.text(cx, cy + cardH/2 - 12, subText, {
                fontFamily: 'Arial Black', fontSize: '11px', color: subColor
            }).setOrigin(0.5, 1), D + 3);

            card.on('pointerdown', () => {
                if (!unlocked) {
                    if (!Progress.spendCheese(skin.price)) {
                        this.flashNoCheese(W/2, H/2);
                        return;
                    }
                    Progress.unlockSkin(skin.id);
                    bus.emit(UI.SHOP_BUY);
                } else {
                    bus.emit(UI.BUTTON_CLICK);
                }
                Progress.setSkin(skin.id);
                this.applySkinToPlayer(Progress.getCurrentSkin());
                this._shopReopen = true;
                this.closeInRunShop();
                this.openInRunShop();
            });
        });

        addEl(this.add.text(rightX + colW/2, topY, '💪 АПГРЕЙДЫ', {
            fontFamily: 'Arial Black', fontSize: Math.max(14, Math.round(18 * s)) + 'px',
            color: '#ffffff', stroke: '#d49920', strokeThickness: 3
        }).setOrigin(0.5));

        const upgItemH = Math.max(50, Math.round(64 * s));
        PERMANENT_UPGRADES.forEach((upg, i) => {
            const y = topY + Math.round(28 * s) + i * (upgItemH + 6);
            if (y + upgItemH > H/2 + panelH/2 - 16) return;
            const lvl = Progress.getUpgradeLevel(upg.id);
            const maxed = lvl >= upg.maxLevel;
            const bg = maxed ? 0x3a5028 : 0x2a1248;
            const accent = maxed ? 0x80ff60 : 0xa060ff;
            const card = addEl(this.add.rectangle(rightX + colW/2, y, colW, upgItemH, bg, 0.92)
                .setStrokeStyle(2, accent)
                .setInteractive({ useHandCursor: true }), D + 1);
            addEl(this.add.text(rightX + 16, y, upg.emoji,
                { fontSize: Math.max(20, Math.round(26 * s)) + 'px' }).setOrigin(0, 0.5), D + 2);
            addEl(this.add.text(rightX + 50, y - 14, `${upg.name}  (${lvl}/${upg.maxLevel})`, {
                fontFamily: 'Arial Black', fontSize: Math.max(11, Math.round(13 * s)) + 'px',
                color: '#ffffff'
            }).setOrigin(0, 0.5), D + 2);
            addEl(this.add.text(rightX + 50, y + 2, upg.desc, {
                fontFamily: 'Arial', fontSize: Math.max(9, Math.round(11 * s)) + 'px',
                color: '#d0b0f0', wordWrap: { width: colW - 70 }
            }).setOrigin(0, 0.5), D + 2);
            const price = maxed ? 'МАКС' : `🧀 ${upg.price}`;
            addEl(this.add.text(rightX + 50, y + 18, price, {
                fontFamily: 'Arial Black', fontSize: Math.max(10, Math.round(11 * s)) + 'px',
                color: maxed ? '#80ff80' : '#ffd060'
            }).setOrigin(0, 0.5), D + 2);

            card.on('pointerdown', () => {
                if (maxed) return;
                if (Progress.buyUpgrade(upg.id)) {
                    bus.emit(UI.SHOP_BUY);
                    this._shopReopen = true;
                    this.closeInRunShop();
                    this.openInRunShop();
                } else {
                    this.flashNoCheese(W/2, H/2);
                }
            });
        });
        this._pinFixed();
    }

    closeInRunShop() {
        if (this._shopElements && !this._shopReopen) bus.emit(UI.MENU_CLOSE);
        if (this._shopElements) {
            this._shopElements.forEach(e => e.destroy());
            this._shopElements = null;
        }
        if (this._pickerElements) this._pickerElements.forEach(e => e.setVisible(true));
    }

    flashNoCheese(x, y) {
        bus.emit(UI.SHOP_DENY);
        const t = this.add.text(x, y, 'Не хватает сыра!', {
            fontFamily: 'Arial Black', fontSize: '24px',
            color: '#ff4040', stroke: '#1a0a0a', strokeThickness: 4
        }).setOrigin(0.5).setScrollFactor(0).setDepth(LAYER.UI_FLASH);
        this.tweens.add({
            targets: t, y: y - 60, alpha: 0,
            duration: 1100, onComplete: () => t.destroy()
        });
        this._pinFixed();
    }
    lose() {
        if (this.state !== 'play') return;
        // UNDYING relic — survive on 1 HP, consume charge
        if ((this.relicUndying || 0) > 0) {
            this.relicUndying -= 1;
            this.player.hp = 1;
            this.player.invulnTimer = 2400;
            this.cameras.main.flash(380, 255, 220, 100);
            this.showFloatingText(this.player.x, this.player.y - 60, '💀 НЕ В ЭТОТ РАЗ!', '#ffd040', 28);
            bus.emit(SFX.COLLECT_POWERUP);
            return;
        }
        this.state = 'lost';
        bus.emit(SFX.PLAYER_DEATH);
        // Endless: full bank of run cheese (it's a separate "deposit on death" model since no boss caps the run)
        // Story: half-cheese rescue
        const banked = (this.runMode === 'endless')
            ? (this.runCheeseTotal || 0)
            : Math.floor((this.runCheeseTotal || 0) / 2);
        if (banked > 0) Progress.addCheese(banked);
        const totalScore = this.runScore + this.score;
        if (this.runMode === 'endless') {
            Progress.recordEndlessRun(this.chapter, totalScore);
        } else {
            Progress.recordStoryLoss(totalScore);
        }
        // Spaced 800 ms after PLAYER_DEATH so the death hit and the overlay sting never stack
        this.time.delayedCall(800, () => bus.emit(SFX.LOSE_STORY));
        const subtitle = (this.runMode === 'endless')
            ? `Пи дошёл до этажа ${this.chapter} и упал!\n\n` +
              `🧀 Получено сыра: +${banked}\n` +
              `🧀 Всего сыра: ${Progress.getCheese()}\n` +
              (Progress.getEndlessStats().bestFloor === this.chapter ? `🏆 НОВЫЙ РЕКОРД!` : `🏆 Рекорд: этаж ${Progress.getEndlessStats().bestFloor}`)
            : `Граф Ратула запер Пи в темнице.\n` +
              `Но половина сыра уцелела!\n\n` +
              `🧀 Получено сыра: +${banked}\n` +
              `🧀 Всего сыра: ${Progress.getCheese()}`;
        this.showOverlay(
            (this.runMode === 'endless') ? '∞ Глубже не пошёл...' : 'Пи попался...',
            subtitle,
            0xc04040, (this.runMode === 'endless') ? '💀∞' : '💀',
            '🔄 ЗАНОВО',
            () => this.scene.start('DungeonScene', { runMode: this.runMode, chapter: 1 }),
            '🏪 В ЛАВКУ',
            () => { bus.emit(BGM.MENU); this.scene.start('TransylvaniaScene', { openShop: true }); }
        );
    }

    // === GOTHIC UI HELPERS — cartoony but professional Transylvania frames/buttons ===
    drawGothicPanel(cx, cy, w, h, opts = {}) {
        const accent = opts.accent || 0xd49920;        // gold
        const bgTop = opts.bgTop || 0x3a1248;
        const bgBot = opts.bgBot || 0x18062a;
        const radius = opts.radius != null ? opts.radius : 18;
        const D = opts.depth || LAYER.UI_OVERLAY;
        const out = [];
        // DROP SHADOW
        const shadow = this.add.graphics().setScrollFactor(0).setDepth(D - 2);
        shadow.fillStyle(0x000000, 0.55);
        shadow.fillRoundedRect(cx - w/2 + 8, cy - h/2 + 10, w, h, radius);
        out.push(shadow);
        // MAIN PANEL with vertical gradient
        const panel = this.add.graphics().setScrollFactor(0).setDepth(D - 1);
        panel.fillGradientStyle(bgTop, bgTop, bgBot, bgBot, 1);
        panel.fillRoundedRect(cx - w/2, cy - h/2, w, h, radius);
        // Inner soft highlight at top
        panel.fillStyle(0xffffff, 0.06);
        panel.fillRoundedRect(cx - w/2 + 4, cy - h/2 + 4, w - 8, h * 0.45, radius - 4);
        // OUTER GOLD FRAME
        panel.lineStyle(4, accent, 1);
        panel.strokeRoundedRect(cx - w/2, cy - h/2, w, h, radius);
        // INNER thin trim
        panel.lineStyle(1.5, 0xfff0a0, 0.55);
        panel.strokeRoundedRect(cx - w/2 + 5, cy - h/2 + 5, w - 10, h - 10, radius - 5);
        out.push(panel);
        // CORNER ORNAMENTS — gothic fleurons (gold dots with dark center)
        const cornerCurl = (x, y, side) => {
            const c = this.add.graphics().setScrollFactor(0).setDepth(D);
            c.fillStyle(accent, 1);
            c.fillCircle(x, y, 6);
            c.fillStyle(0x1a0820, 1);
            c.fillCircle(x, y, 2.5);
            // tiny ornament arc
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
        // SPOOKY decorations in corners (small emoji)
        if (opts.themed !== false) {
            const themes = opts.theme || ['🕸️', '🦇', '💀', '🕯️'];
            const corners = [
                { x: cx - w/2 + 30, y: cy - h/2 + 30, ox: 0.5, oy: 0.5 },
                { x: cx + w/2 - 30, y: cy - h/2 + 30, ox: 0.5, oy: 0.5 },
                { x: cx - w/2 + 30, y: cy + h/2 - 30, ox: 0.5, oy: 0.5 },
                { x: cx + w/2 - 30, y: cy + h/2 - 30, ox: 0.5, oy: 0.5 }
            ];
            for (let i = 0; i < 4; i++) {
                const t = this.add.text(corners[i].x, corners[i].y, themes[i % themes.length],
                    { fontSize: '24px' })
                    .setOrigin(0.5)
                    .setScrollFactor(0).setDepth(D + 1)
                    .setAlpha(0.55);
                out.push(t);
            }
        }
        return out;
    }

    drawGothicCard(cx, cy, w, h, opts = {}) {
        const accent = opts.accent || 0xa060ff;
        const bgTop = opts.bgTop || 0x3a1858;
        const bgBot = opts.bgBot || 0x1a0830;
        const hoverAccent = opts.hoverAccent || 0xffd040;
        const hoverBgTop = opts.hoverBgTop || 0x4a2870;
        const hoverBgBot = opts.hoverBgBot || 0x2a1850;
        const radius = opts.radius != null ? opts.radius : 14;
        const D = opts.depth || LAYER.UI_OVERLAY;
        const els = [];
        // Drop shadow
        const shadow = this.add.graphics().setScrollFactor(0).setDepth(D - 1);
        shadow.fillStyle(0x000000, 0.55);
        shadow.fillRoundedRect(cx - w/2 + 4, cy - h/2 + 6, w, h, radius);
        els.push(shadow);
        // Body
        const body = this.add.graphics().setScrollFactor(0).setDepth(D);
        const drawBody = (top, bot, rim) => {
            body.clear();
            body.fillGradientStyle(top, top, bot, bot, 1);
            body.fillRoundedRect(cx - w/2, cy - h/2, w, h, radius);
            body.fillStyle(0xffffff, 0.10);
            body.fillRoundedRect(cx - w/2 + 4, cy - h/2 + 4, w - 8, h * 0.42, radius - 3);
            body.lineStyle(3, rim, 0.95);
            body.strokeRoundedRect(cx - w/2, cy - h/2, w, h, radius);
            body.lineStyle(1, 0xfff0a0, 0.4);
            body.strokeRoundedRect(cx - w/2 + 4, cy - h/2 + 4, w - 8, h - 8, radius - 4);
        };
        drawBody(bgTop, bgBot, accent);
        els.push(body);
        // Interactive hit (transparent rectangle on top)
        const hit = this.add.rectangle(cx, cy, w, h, 0xffffff, 0.001)
            .setScrollFactor(0).setDepth(D + 10)
            .setInteractive({ useHandCursor: true })
            .on('pointerover', () => drawBody(hoverBgTop, hoverBgBot, hoverAccent))
            .on('pointerout',  () => drawBody(bgTop, bgBot, accent));
        if (opts.onClick) {
            hit.on('pointerdown', () => {
                this.tweens.add({
                    targets: [body, shadow], scaleX: 0.97, scaleY: 0.97,
                    duration: 80, yoyo: true, ease: 'Quad.easeOut',
                    onComplete: opts.onClick
                });
            });
        }
        els.push(hit);
        return { els, hit, body, redraw: drawBody };
    }

    drawGothicButton(cx, cy, w, h, label, opts = {}) {
        const colorBase = opts.color || 0x7a30a0;        // body color
        const colorTop  = opts.colorTop || 0xa050d0;
        const accent = opts.accent || 0xffd040;
        const hoverTop = opts.hoverTop || 0xc070e0;
        const hoverBase = opts.hover || 0x9a50c0;
        const radius = opts.radius != null ? opts.radius : 14;
        const D = opts.depth || (LAYER.UI_OVERLAY + 10);
        const out = [];
        // Draw in LOCAL coords so setScale pivots around button center (no drift on pulse tweens)
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
        // LABEL
        const fontSize = opts.fontSize || Math.max(16, Math.round(h * 0.4));
        const text = this.add.text(cx, cy, label, {
            fontFamily: 'Arial Black', fontSize: fontSize + 'px',
            color: '#ffffff', stroke: '#1a0a3a', strokeThickness: 3, align: 'center'
        }).setOrigin(0.5).setScrollFactor(0).setDepth(D + 1);
        // INTERACTIVE: use the text rect as hit area (covers the button)
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

    showOverlay(title, sub, accent, emoji, btnText, btnAction, btnText2, btnAction2) {
        if (this.game.canvas && this.game.canvas.style) this.game.canvas.style.cursor = '';
        if (this.aimIndicator) this.aimIndicator.setVisible(false);
        if (this.aimLine) this.aimLine.setVisible(false);
        if (this.compass) this.compass.clear();
        if (this.compassLabel) this.compassLabel.setVisible(false);

        const cam = this.cameras.main;
        const W = this.viewW, H = this.viewH;
        const D = LAYER.UI_OVERLAY;
        const addEl = (el, dep) => el.setScrollFactor(0).setDepth(dep || D);

        const hasSecond = !!(btnText2 && btnAction2);
        const panelW = Math.min(W * 0.92, 580);
        const baseH = hasSecond ? 490 : 440;
        const panelH = Math.min(H * 0.92, baseH);
        const s = Math.min(1, panelH / baseH);
        const emojiSize = Math.max(36, Math.round(64 * s));
        const titleSize = Math.max(18, Math.round(28 * s));
        const subSize   = Math.max(12, Math.round(16 * s));
        const btnSize   = Math.max(15, Math.round(20 * s));

        // Dim backdrop
        addEl(this.add.rectangle(0, 0, W, H, 0x000000, 0.80).setOrigin(0));

        // Gothic panel (replaces plain rectangle)
        const theme = (accent === 0xffd040) ? ['🎉', '👵', '✨', '🐭']
                    : (accent === 0xc04040) ? ['💀', '⚰️', '🦇', '🕯️']
                    : (accent === 0x40c060) ? ['✨', '👵', '🎉', '🐭']
                    : ['🕸️', '🦇', '💀', '🕯️'];
        const panelEls = this.drawGothicPanel(W/2, H/2, panelW, panelH, {
            accent, depth: D, theme
        });
        panelEls.forEach(e => e.setScrollFactor(0));

        const top = H/2 - panelH/2;
        let cy = top + Math.round(24 * s);
        // Emoji - centered, large and dramatic
        addEl(this.add.text(W/2, cy + emojiSize/2, emoji, { fontSize: emojiSize + 'px' }).setOrigin(0.5));
        cy += emojiSize + Math.round(4 * s);

        // Title — stroke only
        const titleObj = this.add.text(W/2, cy + titleSize/2, title, {
            fontFamily: 'Arial Black', fontSize: titleSize + 'px', color: '#ffffff',
            stroke: '#1a0a3a', strokeThickness: Math.max(4, Math.round(6 * s)), align: 'center',
            wordWrap: { width: panelW - 60 }
        }).setOrigin(0.5);
        addEl(titleObj);
        cy += titleSize * 1.4 + Math.round(8 * s);

        // Subtitle text
        addEl(this.add.text(W/2, cy, sub, {
            fontFamily: 'Arial', fontSize: subSize + 'px', color: '#f0d8ff',
            align: 'center', lineSpacing: Math.round(4 * s),
            wordWrap: { width: panelW - 60 }
        }).setOrigin(0.5, 0));

        const btnLabel = btnText || '🔄 Заново';
        const rawAction = btnAction || (() => this.scene.restart());
        const action = () => { bus.emit(UI.BUTTON_CLICK); rawAction(); };
        const btnH = Math.max(42, Math.round(56 * s));
        const btnW = panelW * 0.65;
        const btnGap = Math.round(14 * s);
        const bottomPad = Math.round(28 * s);

        if (hasSecond) {
            const secondBtnY = H/2 + panelH/2 - bottomPad - btnH / 2;
            const firstBtnY  = secondBtnY - btnH - btnGap;
            const els1 = this.drawGothicButton(W/2, firstBtnY, btnW, btnH, btnLabel, {
                onClick: action, depth: D + 10
            });
            els1.forEach(e => e.setScrollFactor(0));
            const els2 = this.drawGothicButton(W/2, secondBtnY, btnW, btnH, btnText2, {
                color: 0xc89530, colorTop: 0xf5b048, hover: 0xf5b048, hoverTop: 0xffd070,
                onClick: () => { bus.emit(UI.BUTTON_CLICK); btnAction2(); }, depth: D + 10
            });
            els2.forEach(e => e.setScrollFactor(0));
        } else {
            const btnY = H/2 + panelH/2 - bottomPad - btnH / 2;
            const els = this.drawGothicButton(W/2, btnY, btnW, btnH, btnLabel, {
                onClick: action, depth: D + 10
            });
            els.forEach(e => e.setScrollFactor(0));
        }

        // Both ENTER and SPACE confirm the primary action — SPACE is the universal "continue" key
        const onPrimary = () => action();
        this.input.keyboard.once('keydown-ENTER', onPrimary);
        this.input.keyboard.once('keydown-SPACE', onPrimary);
        this._pinFixed();
    }

    exitToMenu() {
        // NOTE: renamed from exit() — spawnExitDoor() assigns this.exit = {door object},
        // which previously shadowed this method and caused TypeError on click.
        try { window.audio?.stopBgm?.(); } catch (e) {}
        if (this.game.canvas && this.game.canvas.style) this.game.canvas.style.cursor = '';
        if (window.parent && window.parent !== window) {
            window.parent.postMessage('closePhaserSnowball', '*');
        } else if (this.scene.manager.keys && this.scene.manager.keys['TransylvaniaScene']) {
            this.scene.start('TransylvaniaScene');
        } else if (this.scene.manager.keys && this.scene.manager.keys['MenuScene']) {
            this.scene.start('MenuScene');
        }
    }
}

function approach(curr, target, maxDelta) {
    const d = target - curr;
    if (Math.abs(d) <= maxDelta) return target;
    return curr + Math.sign(d) * maxDelta;
}
