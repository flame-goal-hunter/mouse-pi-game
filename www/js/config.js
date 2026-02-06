// ============================================
// GAME CONFIGURATION
// ============================================

// Physics constants for Rapier2D (px/s units)
export const PHYS = {
    // World
    GRAVITY: 1200,          // px/s² (Rapier gravity)

    // Movement (velocity-based, lerp rates per frame)
    GROUND_ACCEL: 0.25,     // Lerp rate toward target speed (grounded)
    AIR_ACCEL: 0.12,        // Lerp rate toward target speed (air)
    GROUND_FRICTION: 0.96,  // Velocity multiplier when no input (grounded, <1 = decelerate)
    JUMP_FORCE: -710,       // px/s (negative = up, h = 710²/2400 ≈ 210 px ≈ 3 тайла)
    MAX_SPEED_X: 480,       // px/s (max horizontal velocity)
    MAX_SPEED_Y: 900,       // px/s (max fall velocity)

    // Hook / Grapple - Teeworlds style
    HOOK_SPEED: 25,         // Hook projectile speed (px/frame at 60fps)
    HOOK_RANGE: 500,        // Max hook distance in pixels
    HOOK_STIFFNESS: 0.9,    // Rope stiffness (0-1, higher = more rigid)
    HOOK_DAMPING: 0.1,      // Rope damping (oscillation reduction)
    HOOK_REEL_SPEED: 3,     // How fast rope shortens (px/frame)
    HOOK_MIN_LENGTH: 50,    // Minimum rope length
    HOOK_COOLDOWN: 300,     // Cooldown between hooks (ms)

    // Combat
    SNOWBALL_SPEED: 720,    // px/s (Rapier linvel)
    SNOWBALL_DAMAGE: 10,    // Damage per hit (half heart = 10 HP)
    KNOCKBACK_FORCE: 1.2,   // Rapier impulse strength
    SNOWBALL_GRAVITY_SCALE: 0.5,  // Gravity multiplier for snowballs (lighter than characters)
    SNOWBALL_BOUNCE: 0.3,         // Bounce off walls/platforms
    SNOWBALL_LIFETIME: 3000,      // ms before auto-destroy
    SNOWBALL_FIRE_RATE: 250,      // ms between shots
    SNOWBALL_MAGAZINE: 15,         // snowballs per magazine
    SNOWBALL_RELOAD_TIME: 2000,    // ms to reload when magazine empty
    SNOWBALL_REGEN_DELAY: 1000,    // ms after last shot before passive regen starts
    SNOWBALL_REGEN_RATE: 100,      // ms per ammo regen (1 snowball every 100ms)

    // Coyote time & jump buffer
    COYOTE_TIME: 100,       // ms to jump after leaving ground
    JUMP_BUFFER: 120        // ms to buffer jump input
};

// Tile size (Kenney Ice expansion uses 70x70)
export const TILE_SIZE = 70;

// Game settings
export const GAME = {
    WIDTH: 1400,
    HEIGHT: 1050,
    MAX_HEALTH: 100,
    RESPAWN_TIME: 2000,
    WIN_SCORE: 5,
    BOT_COUNT: 2,
    // Hearts system (like Zelda)
    MAX_HEARTS: 5,          // 5 hearts total
    HEALTH_PER_HEART: 20,   // 20 HP per heart (100 HP / 5 hearts)
    WINS_TO_WIN: 3,         // Wins needed to win the match
    PLAYER_NAME: 'Мышонок Пи'  // Player's default name
};

// Funny names for bots
export const BOT_NAMES = [
    'Сырный Барон', 'Пушистик', 'Снежок', 'Хвостик', 'Усатый Нинзя',
    'Пискун', 'Шустрик', 'Зубастик', 'Малыш Чиз', 'Серый Шкет',
    'Бублик', 'Крошка', 'Топотун', 'Ушастый', 'Норушка'
];

// Get random bot name (avoiding duplicates)
export function getRandomBotName(usedNames = []) {
    const available = BOT_NAMES.filter(n => !usedNames.includes(n));
    if (available.length === 0) return 'Бот' + Math.floor(Math.random() * 100);
    return available[Math.floor(Math.random() * available.length)];
}

// Player colors for multiplayer
export const PLAYER_COLORS = [
    { name: 'blue',   primary: 0x3498db, secondary: 0x2980b9 },
    { name: 'red',    primary: 0xe74c3c, secondary: 0xc0392b },
    { name: 'green',  primary: 0x2ecc71, secondary: 0x27ae60 },
    { name: 'yellow', primary: 0xf1c40f, secondary: 0xf39c12 }
];

// Bunny sprite data (Kenney Jumper Pack - individual images)
// Uses individual images loaded as separate textures
export const PLAYER_SPRITE = {
    // Approximate average size for physics body
    bodyWidth: 50,
    bodyHeight: 70,
    // Scale to match game (original ~120x200, scale down)
    scale: 0.45,
    // Animation keys (per player: p1, p2, p3)
    anims: {
        idle: 'idle',
        walk: 'walk',
        jump: 'jump',
        hurt: 'hurt'
    }
};

// Pickup/Power-up configuration
export const PICKUPS = {
    HEALTH: { type: 'health', heal: 25, duration: 0, tint: 0xff6666, emoji: '❤️' },
    FIRE: { type: 'fire', damageMultiplier: 2, duration: 10000, tint: 0xff8800, emoji: '🔥' },
    SPEED: { type: 'speed', speedMultiplier: 1.5, duration: 8000, tint: 0xffff00, emoji: '⚡' },
    SHIELD: { type: 'shield', damageReduction: 0.5, duration: 8000, tint: 0x6666ff, emoji: '🛡️' },
    DOUBLE_JUMP: { type: 'doublejump', duration: 12000, tint: 0x66ff66, emoji: '🦘' },
    // Respawn settings
    RESPAWN_TIME: 15000  // ms until pickup respawns after collection
};

// Ragdoll settings (death animation)
export const RAGDOLL = {
    DURATION: 2200,         // ms before fade out
    FADE_TIME: 400,         // ms for fade out animation
    TUMBLE_SPEED: 0.15,     // angular velocity on death
    KNOCKBACK_BOOST: 1.5,   // multiply knockback on death
    BOUNCE: 0.3             // bounce off platforms during ragdoll
};
