// ============================================
// SoundMap — event → sample table.
// `vol` is measured per sample from BOTH channels: min(roleTarget / rms, 0.92 / peak), clamped [0.15, 6].
// Role targets keep footsteps (constant) well under combat and pickups (the reference level).
// `rate`/`jitter` give per-play pitch variation; `guard` is the minimum ms between
// two plays of the same event (anti machine-gun).
// ============================================
import { SFX, UI, BGM } from './SoundKeys.js';

export const SFX_FILES = {
    // key: [file, volume]
    ui_click: ['ui_click', 0.48],   ui_back: ['ui_back', 0.53],   ui_buy: ['ui_buy', 0.42],
    ui_deny: ['ui_deny', 0.49],    ui_open: ['ui_open', 0.51],   ui_close: ['ui_close', 0.52],
    ui_tick: ['ui_tick', 0.59],
    throw_a: ['throw_a', 2.29],     throw_b: ['throw_b', 2.94],   dash: ['dash', 1.37],
    hit_enemy_a: ['hit_enemy_a', 0.67],hit_enemy_b: ['hit_enemy_b', 0.63], hit_enemy_c: ['hit_enemy_c', 0.63],
    hit_wall_a: ['hit_wall_a', 0.85], hit_wall_b: ['hit_wall_b', 0.83],
    take_damage: ['take_damage', 0.87], enemy_death_a: ['enemy_death_a', 1.06], enemy_death_b: ['enemy_death_b', 1.03],
    boss_hit: ['boss_hit', 1.04],    squelch: ['squelch', 0.63],
    cheese: ['cheese', 0.91],      heart: ['heart', 0.67],    powerup: ['powerup', 0.6],
    key: ['key', 0.76],         chest: ['chest', 1.71],     coins: ['coins', 0.9],
    torch: ['torch', 4.57],       door: ['door', 0.86],
    alarm: ['alarm', 0.93],      book_thud: ['book_thud', 1.04],
    step_stone_1: ['step_stone_1', 0.4], step_stone_2: ['step_stone_2', 0.49], step_stone_3: ['step_stone_3', 0.52],
    step_wood_1: ['step_wood_1', 0.4],  step_wood_2: ['step_wood_2', 0.37],  step_wood_3: ['step_wood_3', 0.34],
    step_carpet_1: ['step_carpet_1', 0.53],step_carpet_2: ['step_carpet_2', 0.36],step_carpet_3: ['step_carpet_3', 0.36],
    step_grass_1: ['step_grass_1', 1.04], step_grass_2: ['step_grass_2', 0.98], step_grass_3: ['step_grass_3', 1.04],
    sting_win: ['sting_win', 0.54],   sting_lose: ['sting_lose', 0.65], sting_death: ['sting_death', 0.77],
    sting_floor: ['sting_floor', 0.6], sting_boss: ['sting_boss', 1.05], sting_boss_phase: ['sting_boss_phase', 0.77],
};

// key: [file, volume] — music streams from an HTMLAudioElement (AudioManager), never the
// Phaser loader: these loops are 55-137 s and would decode to ~166 MB of PCM in the cache.
export const BGM_FILES = {
    cavern: ['cavern', 0.34], hall: ['hall', 0.34], garden: ['garden', 0.38], throne: ['throne', 0.5],
};

// event → { keys, rate, jitter, guard, cat }
export const EVENT_MAP = {
    [UI.BUTTON_CLICK]:   { keys: ['ui_click'],  jitter: 0.06, guard: 40,  cat: 'ui' },
    [UI.BUTTON_BACK]:    { keys: ['ui_back'],   jitter: 0.04, guard: 60,  cat: 'ui' },
    [UI.SHOP_BUY]:       { keys: ['ui_buy'],    guard: 120, cat: 'ui' },
    [UI.SHOP_DENY]:      { keys: ['ui_deny'],   guard: 200, cat: 'ui' },
    [UI.MENU_OPEN]:      { keys: ['ui_open'],   guard: 120, cat: 'ui' },
    [UI.MENU_CLOSE]:     { keys: ['ui_close'],  guard: 120, cat: 'ui' },
    [UI.HEARTBEAT_TICK]: { keys: ['hit_wall_a'], rate: 0.55, jitter: 0.03, guard: 300, cat: 'ui' },

    [SFX.FIRE_PIE]:      { keys: ['throw_a', 'throw_b'], rate: 1.25, jitter: 0.12, guard: 45 },
    [SFX.HIT_ENEMY]:     { keys: ['hit_enemy_a', 'hit_enemy_b', 'hit_enemy_c'], jitter: 0.14, guard: 40 },
    [SFX.HIT_WALL]:      { keys: ['hit_wall_a', 'hit_wall_b'], rate: 1.1, jitter: 0.12, guard: 50 },
    [SFX.TAKE_DAMAGE]:   { keys: ['take_damage'], rate: 1.05, jitter: 0.06, guard: 250 },
    [SFX.PLAYER_DASH]:   { keys: ['dash'], rate: 1.35, jitter: 0.08, guard: 120 },
    [SFX.PLAYER_DEATH]:  { keys: ['sting_death'], guard: 800 },
    [SFX.ENEMY_DEATH]:   { keys: ['enemy_death_a', 'enemy_death_b'], rate: 0.95, jitter: 0.16, guard: 40 },
    [SFX.BOSS_HIT]:      { keys: ['boss_hit'], jitter: 0.1, guard: 80 },
    [SFX.SLIME_SQUELCH]: { keys: ['squelch'], rate: 0.8, jitter: 0.12, guard: 90 },

    [SFX.COLLECT_CHEESE]:  { keys: ['cheese'], rate: 1.0, jitter: 0.05, guard: 30 },   // AudioManager adds a combo pitch ladder
    [SFX.COLLECT_HEART]:   { keys: ['heart'], guard: 150 },
    [SFX.COLLECT_POWERUP]: { keys: ['powerup'], guard: 150 },
    [SFX.KEY_GRAB]:        { keys: ['key'], rate: 1.1, guard: 200 },
    [SFX.OPEN_CHEST]:      { keys: ['chest'], rate: 1.05, jitter: 0.05, guard: 200 },
    [SFX.CHEST_COINS]:     { keys: ['coins'], rate: 1.0, jitter: 0.04, guard: 250 },   // fired ~190 ms after the chest creak
    [SFX.LIGHT_TORCH]:     { keys: ['torch'], rate: 0.7, jitter: 0.1, guard: 120 },
    [SFX.DOOR_OPEN]:       { keys: ['door'], rate: 0.95, guard: 300 },

    [SFX.ALARM_TRIGGER]:    { keys: ['alarm'], guard: 700 },
    [SFX.SUSPICION_TICK]:   { keys: ['ui_tick'], rate: 0.9, jitter: 0.05, guard: 180 },
    [SFX.DISTRACTION_THUD]: { keys: ['book_thud'], rate: 0.95, jitter: 0.08, guard: 150 },
    [SFX.GHOST_RUN]:        { keys: ['throw_a'], rate: 0.6, jitter: 0.06, guard: 400 },

    [SFX.BOSS_INTRO]:  { keys: ['sting_boss'], guard: 1500 },
    [SFX.BOSS_PHASE]:  { keys: ['sting_boss_phase'], guard: 800 },
    [SFX.WIN_STORY]:   { keys: ['sting_win'], guard: 2000 },
    [SFX.LOSE_STORY]:  { keys: ['sting_lose'], guard: 2000 },
    [SFX.FLOOR_ENTER]: { keys: ['sting_floor'], guard: 1000 },
    [SFX.FOOTSTEP]:    { keys: [], jitter: 0.14, guard: 0 },   // keys chosen per biome by AudioManager
};

// biome id → footstep sample family
export const FOOTSTEPS = {
    dungeon: ['step_stone_1', 'step_stone_2', 'step_stone_3'],
    kitchen: ['step_wood_1', 'step_wood_2', 'step_wood_3'],
    library: ['step_carpet_1', 'step_carpet_2', 'step_carpet_3'],
    garden:  ['step_grass_1', 'step_grass_2', 'step_grass_3'],
    throne:  ['step_carpet_1', 'step_carpet_2', 'step_carpet_3'],
};

// biome id → music key
// Four track files for five biomes plus the menu, so the library takes its own
// procedural preset (ProceduralBgm 'library') rather than replaying the dungeon's.
export const BIOME_BGM = { dungeon: 'cavern', kitchen: 'hall', library: 'cavern', garden: 'garden', throne: 'throne' };
