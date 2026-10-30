// ============================================================================
// SpaceConfig.js — Единый конфиг Интерактивного Космоса Мышонка Пи
// ============================================================================

export const SPACE_CONFIG = {
    world: {
        width: 2800,
        height: 2200
    },
    rocket: {
        startX: 0,
        startY: 135,
        radius: 26,
        turnSpeed: 5.4,
        thrust: 460,
        turboMultiplier: 1.85,
        drag: 0.968,
        maxSpeed: 380,
        maxTurboSpeed: 640,
        trailIntervalMs: 18,
        trailLifeMs: 560,
        trailColors: ['#fde047', '#fb923c', '#2dd4bf', '#38bdf8'],
        pilotImg: 'assets/characters/transylvania/pi.svg'
    },
    camera: {
        lerp: 0.085,
        dockZoomTarget: 3.1,
        dockZoomDurationMs: 520
    },
    starLayers: [
        { count: 110, parallax: 0.1, minR: 1.0, maxR: 2.0, alpha: 0.55 },
        { count: 75,  parallax: 0.3, minR: 1.4, maxR: 2.8, alpha: 0.78 },
        { count: 42,  parallax: 0.6, minR: 2.0, maxR: 3.6, alpha: 0.95 }
    ],
    nebulas: [
        { x: -420, y: -260, r: 520, inner: 'rgba(168, 85, 247, 0.24)', outer: 'rgba(168, 85, 247, 0)' },
        { x:  480, y: -240, r: 490, inner: 'rgba(56, 189, 248, 0.22)', outer: 'rgba(56, 189, 248, 0)' },
        { x:    0, y:  120, r: 580, inner: 'rgba(250, 204, 21, 0.16)', outer: 'rgba(250, 204, 21, 0)' },
        { x: -450, y:  380, r: 460, inner: 'rgba(236, 72, 153, 0.20)', outer: 'rgba(236, 72, 153, 0)' },
        { x:  460, y:  360, r: 460, inner: 'rgba(16, 185, 129, 0.20)', outer: 'rgba(16, 185, 129, 0)' }
    ],
    planets: [
        {
            id: 'home_base',
            name: 'Сырная База Пи',
            subtitle: 'Домашняя станция · Отсюда начинаются все полёты!',
            badge: '🏠 БАЗА',
            x: 0,
            y: 0,
            radius: 72,
            dockRadius: 155,
            baseColor: '#f59e0b',
            hiColor: '#fef08a',
            glowColor: '#fbbf24',
            ringColor: 'rgba(254, 240, 138, 0.55)',
            hasRing: true,
            moonColor: '#fde047',
            monsterImg: 'assets/characters/transylvania/pi.svg',
            locked: false
        },
        {
            id: 'transylvania',
            name: 'Замок Теней',
            subtitle: 'Спасти Бабушку · Тихая лапка (Норки) · Бесконечный спуск',
            badge: '🦇 ЗАМОК ТЕНЕЙ',
            x: -520,
            y: -260,
            radius: 78,
            dockRadius: 165,
            baseColor: '#7e22ce',
            hiColor: '#d8b4fe',
            glowColor: '#a855f7',
            ringColor: 'rgba(216, 180, 254, 0.5)',
            hasRing: true,
            moonColor: '#f472b6',
            monsterImg: 'assets/characters/transylvania/count.svg',
            locked: false
        },
        {
            id: 'snowball',
            name: 'Планета Снежков',
            subtitle: 'Ледяная 3D-Арена · Супер-верёвка · Огненные снежки',
            badge: '❄️ ХИТ! АРЕНА',
            x: 520,
            y: -260,
            radius: 76,
            dockRadius: 165,
            baseColor: '#0284c7',
            hiColor: '#bae6fd',
            glowColor: '#38bdf8',
            ringColor: 'rgba(186, 230, 253, 0.6)',
            hasRing: true,
            moonColor: '#e0f2fe',
            monsterImg: 'assets/characters/transylvania/cat.svg',
            locked: false
        },
        {
            id: 'adventure',
            name: 'Вулкан Приключений',
            subtitle: '3 Мира: Огненная долина ➔ Открытый космос ➔ Сырная Луна',
            badge: '🌋 3 МИРА',
            x: -480,
            y: 340,
            radius: 70,
            dockRadius: 155,
            baseColor: '#ea580c',
            hiColor: '#fed7aa',
            glowColor: '#fb923c',
            ringColor: 'rgba(251, 146, 60, 0.5)',
            hasRing: false,
            moonColor: '#fdba74',
            monsterImg: 'assets/characters/transylvania/slime.svg',
            locked: false
        },
        {
            id: 'newyear',
            name: 'Новогодняя Звезда',
            subtitle: 'Лабиринт подарков · Снеговики · Пингвины · Снежный Йети',
            badge: '🎄 ЛАБИРИНТ',
            x: 480,
            y: 340,
            radius: 70,
            dockRadius: 155,
            baseColor: '#059669',
            hiColor: '#a7f3d0',
            glowColor: '#34d399',
            ringColor: 'rgba(110, 231, 183, 0.5)',
            hasRing: false,
            moonColor: '#fde047',
            monsterImg: 'assets/characters/transylvania/zombie.svg',
            locked: false
        },
        {
            id: 'secret',
            name: 'Тайная Планета Х',
            subtitle: 'Секретный мир в разработке · Скоро откроется!',
            badge: '🔒 СЕКРЕТ',
            x: 0,
            y: -560,
            radius: 62,
            dockRadius: 145,
            baseColor: '#334155',
            hiColor: '#94a3b8',
            glowColor: '#f43f5e',
            ringColor: 'rgba(244, 63, 94, 0.45)',
            hasRing: true,
            moonColor: '#fb7185',
            monsterImg: 'assets/characters/transylvania/mimic.svg',
            locked: true
        }
    ],
    links: [
        ['home_base', 'transylvania'],
        ['home_base', 'snowball'],
        ['home_base', 'adventure'],
        ['home_base', 'newyear'],
        ['transylvania', 'secret'],
        ['snowball', 'secret'],
        ['transylvania', 'adventure'],
        ['snowball', 'newyear']
    ]
};
