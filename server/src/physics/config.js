// Server-side physics config (mirror of www/js/config.js)
export const PHYS = {
    GRAVITY: 1200,
    GROUND_ACCEL: 0.42,
    AIR_ACCEL: 0.14,
    GROUND_FRICTION: 0.82,
    JUMP_FORCE: -780,
    MAX_SPEED_X: 480,
    MAX_SPEED_Y: 920,
    HOOK_SPEED: 32,
    HOOK_RANGE: 660,
    HOOK_DRAG_ACCEL: 7600,
    HOOK_DRAG_SPEED: 680,
    HOOK_DRAG_MIN_DIST: 46,
    HOOK_COOLDOWN: 240,
    SNOWBALL_SPEED: 720,
    SNOWBALL_DAMAGE: 10,
    KNOCKBACK_FORCE: 220,
    SNOWBALL_GRAVITY_SCALE: 0.5,
    SNOWBALL_BOUNCE: 0.3,
    SNOWBALL_LIFETIME: 3000,
    SNOWBALL_FIRE_RATE: 350,
    COYOTE_TIME: 100,
    JUMP_BUFFER: 120
};

export const TILE_SIZE = 70;

export const GAME = {
    WIDTH: 1400,
    HEIGHT: 1050,
    MAX_HEALTH: 100,
    RESPAWN_TIME: 2000,
    WIN_SCORE: 5,
    BOT_COUNT: 2,
    MAX_HEARTS: 5,
    HEALTH_PER_HEART: 20,
    WINS_TO_WIN: 3
};

export const PICKUPS = {
    health:     { type: 'health', heal: 25, duration: 0 },
    fire:       { type: 'fire', damageMultiplier: 2, duration: 10000 },
    speed:      { type: 'speed', speedMultiplier: 1.5, duration: 8000 },
    shield:     { type: 'shield', damageReduction: 0.5, duration: 8000 },
    doublejump: { type: 'doublejump', duration: 12000 },
    RESPAWN_TIME: 15000
};

export const BOT_NAMES = [
    'Сырный Барон', 'Пушистик', 'Снежок', 'Хвостик', 'Усатый Нинзя',
    'Пискун', 'Шустрик', 'Зубастик', 'Малыш Чиз', 'Серый Шкет',
    'Бублик', 'Крошка', 'Топотун', 'Ушастый', 'Норушка'
];
