// ============================================================================
// DifficultyConfig.js — Единый конфиг сложности и баланса всех мини-игр планет
// 3 уровня: easy (🟢 x1.0), normal (🟡 x1.5), hard (🔴 x2.0)
// ============================================================================

export const DIFFICULTY_LEVELS = {
    easy: {
        id: 'easy',
        label: '🟢 ЛЁГКИЙ',
        shortLabel: '🟢 Лёгкий',
        icon: '🟢',
        color: '#4ade80',
        border: '#22c55e',
        bg: 'rgba(34, 197, 94, 0.16)',
        cheeseMultiplier: 1.0
    },
    normal: {
        id: 'normal',
        label: '🟡 СРЕДНИЙ',
        shortLabel: '🟡 Средний',
        icon: '🟡',
        color: '#facc15',
        border: '#eab308',
        bg: 'rgba(250, 204, 21, 0.16)',
        cheeseMultiplier: 1.5
    },
    hard: {
        id: 'hard',
        label: '🔴 СЛОЖНЫЙ',
        shortLabel: '🔴 Сложный',
        icon: '🔴',
        color: '#f87171',
        border: '#ef4444',
        bg: 'rgba(239, 68, 68, 0.18)',
        cheeseMultiplier: 2.0
    }
};

export const PLANET_META = {
    snowball:     { id: 'snowball',     name: 'Ледяная Арена',    icon: '❄️' },
    transylvania: { id: 'transylvania', name: 'Замок Теней',      icon: '🏰' },
    adventure:    { id: 'adventure',    name: 'Огненная Долина',  icon: '🌋' },
    newyear:      { id: 'newyear',      name: 'Ёлочный Лабиринт', icon: '🎄' },
    math:         { id: 'math',         name: 'Планета Логики',   icon: '🔢' }
};

export const GAME_DIFFICULTY_PROFILES = {
    snowball: {
        easy: {
            playerLives: 7, maxHealth: 140, botCount: 1, speed: 0.78,
            spawnRate: 1.45, aiAccuracy: 0.45, scatter: 0.085, leadAim: false,
            timeLimit: 120, obstacleDensity: 0.8, cheeseMultiplier: 1.0,
            description: '7 ❤️ жизней • 1 медленный бот • Сыр x1 🧀'
        },
        normal: {
            playerLives: 5, maxHealth: 100, botCount: 2, speed: 1.0,
            spawnRate: 1.0, aiAccuracy: 0.75, scatter: 0.038, leadAim: true,
            timeLimit: 90, obstacleDensity: 1.0, cheeseMultiplier: 1.5,
            description: '5 ❤️ жизней • 2 метких бота • Сыр x1.5 🧀'
        },
        hard: {
            playerLives: 3, maxHealth: 60, botCount: 3, speed: 1.22,
            spawnRate: 0.68, aiAccuracy: 0.96, scatter: 0.014, leadAim: true,
            timeLimit: 75, obstacleDensity: 1.25, cheeseMultiplier: 2.0,
            description: '3 ❤️ жизни • 3 быстрых снайпера • Сыр x2 🧀🔥'
        }
    },
    transylvania: {
        easy: {
            playerLives: 6, sneakHearts: 4, speed: 0.80,
            spawnRate: 0.75, aiAccuracy: 0.65, suspicionFillMs: 750,
            timeLimit: 0, obstacleDensity: 0.75, bonusPies: 1, cheeseMultiplier: 1.0,
            description: '6 ❤️ жизней • Сонные призраки • Сыр x1 🧀'
        },
        normal: {
            playerLives: 5, sneakHearts: 3, speed: 1.0,
            spawnRate: 1.0, aiAccuracy: 1.0, suspicionFillMs: 520,
            timeLimit: 0, obstacleDensity: 1.0, bonusPies: 0, cheeseMultiplier: 1.5,
            description: '5 ❤️ жизней • Обычная охрана • Сыр x1.5 🧀'
        },
        hard: {
            playerLives: 3, sneakHearts: 2, speed: 1.25,
            spawnRate: 1.35, aiAccuracy: 1.3, suspicionFillMs: 340,
            timeLimit: 0, obstacleDensity: 1.35, bonusPies: 0, cheeseMultiplier: 2.0,
            description: '3 ❤️ жизни • Быстрые монстры • Сыр x2 🧀🔥'
        }
    },
    adventure: {
        easy: {
            playerLives: 6, speed: 0.85, spawnRate: 0.75, aiAccuracy: 0.7,
            owlShootInterval: 170, owlBulletSpeed: 4.2, lavaBalls: false, lavaInterval: 140,
            asteroidSpawnMin: 38, asteroidSpawnBase: 75, asteroidSpeedBase: 1.8, asteroidSpeedRandom: 1.3,
            timeLimit: 0, obstacleDensity: 0.75, cheeseMultiplier: 1.0,
            description: '6 ❤️ жизней • Без лавовых шаров • Сыр x1 🧀'
        },
        normal: {
            playerLives: 4, speed: 1.0, spawnRate: 1.0, aiAccuracy: 1.0,
            owlShootInterval: 135, owlBulletSpeed: 5.2, lavaBalls: true, lavaInterval: 90,
            asteroidSpawnMin: 24, asteroidSpawnBase: 52, asteroidSpeedBase: 2.6, asteroidSpeedRandom: 2.0,
            timeLimit: 0, obstacleDensity: 1.0, cheeseMultiplier: 1.5,
            description: '4 ❤️ жизни • Всплески лавы • Сыр x1.5 🧀'
        },
        hard: {
            playerLives: 3, speed: 1.25, spawnRate: 1.35, aiAccuracy: 1.3,
            owlShootInterval: 95, owlBulletSpeed: 6.5, lavaBalls: true, lavaInterval: 50,
            asteroidSpawnMin: 14, asteroidSpawnBase: 34, asteroidSpeedBase: 3.8, asteroidSpeedRandom: 3.0,
            timeLimit: 0, obstacleDensity: 1.35, cheeseMultiplier: 2.0,
            description: '3 ❤️ жизни • Шторм лавы и комет • Сыр x2 🧀🔥'
        }
    },
    newyear: {
        easy: {
            playerLives: 6, speed: 0.80, spawnRate: 0.75, aiAccuracy: 0.7,
            floorCount: 8, sectionCount: 16, giftCount: 12,
            snowmanCount: 4, penguinCount: 2, yetiCount: 1, groundEnemyCount: 2,
            timeLimit: 180, obstacleDensity: 0.7, cheeseMultiplier: 1.0,
            description: '6 ❤️ жизней • 12 подарков • Сыр x1 🧀'
        },
        normal: {
            playerLives: 4, speed: 1.0, spawnRate: 1.0, aiAccuracy: 1.0,
            floorCount: 10, sectionCount: 20, giftCount: 18,
            snowmanCount: 8, penguinCount: 5, yetiCount: 3, groundEnemyCount: 4,
            timeLimit: 140, obstacleDensity: 1.0, cheeseMultiplier: 1.5,
            description: '4 ❤️ жизни • 18 подарков • Сыр x1.5 🧀'
        },
        hard: {
            playerLives: 3, speed: 1.30, spawnRate: 1.35, aiAccuracy: 1.3,
            floorCount: 14, sectionCount: 26, giftCount: 26,
            snowmanCount: 14, penguinCount: 9, yetiCount: 6, groundEnemyCount: 6,
            timeLimit: 110, obstacleDensity: 1.4, cheeseMultiplier: 2.0,
            description: '3 ❤️ жизни • 26 подарков и много йети • Сыр x2 🧀🔥'
        }
    },
    math: {
        easy: { playerLives: 5, speed: 0.8, spawnRate: 0.8, aiAccuracy: 0.7, timeLimit: 25, mathRange: [1, 15], obstacleDensity: 0.7, cheeseMultiplier: 1.0, description: 'Счёт до 15 • Долгий таймер • Сыр x1 🧀' },
        normal: { playerLives: 3, speed: 1.0, spawnRate: 1.0, aiAccuracy: 1.0, timeLimit: 16, mathRange: [1, 45], obstacleDensity: 1.0, cheeseMultiplier: 1.5, description: 'Счёт до 45 • Средний темп • Сыр x1.5 🧀' },
        hard: { playerLives: 2, speed: 1.3, spawnRate: 1.3, aiAccuracy: 1.2, timeLimit: 10, mathRange: [10, 99], obstacleDensity: 1.3, cheeseMultiplier: 2.0, description: 'Умножение и скобки • Быстрый таймер • Сыр x2 🧀🔥' }
    }
};

export const DifficultyConfig = {
    normalizeLevel(level) {
        if (level === 'medium') return 'normal';
        return DIFFICULTY_LEVELS[level] ? level : 'normal';
    },
    getLevelMeta(level) {
        return DIFFICULTY_LEVELS[this.normalizeLevel(level)];
    },
    getPlanetMeta(gameId) {
        return PLANET_META[gameId] || { id: gameId, name: 'Планета Игр', icon: '🪐' };
    },
    get(gameId, level = 'normal') {
        const lvl = this.normalizeLevel(level);
        const meta = DIFFICULTY_LEVELS[lvl];
        const gameProf = GAME_DIFFICULTY_PROFILES[gameId] || GAME_DIFFICULTY_PROFILES.adventure;
        return { ...meta, ...(gameProf[lvl] || gameProf.normal), level: lvl, gameId };
    }
};

if (typeof window !== 'undefined') window.DifficultyConfig = DifficultyConfig;
