// ============================================================================
// SpaceConfig.js — Единый конфиг Интерактивного Космоса Мышонка Пи
// Внутреннее Центральное Кольцо (общие планеты с мини-играми) + параметры мира
// ============================================================================

export const SPACE_CONFIG = {
    world: {
        halfWidth: 2150,
        halfHeight: 2050
    },
    rocket: {
        startX: 0,
        startY: 165,
        startAngle: -Math.PI / 2,
        accel: 680,
        turboAccel: 1220,
        maxSpeed: 390,
        turboMaxSpeed: 680,
        friction: 0.968,
        turnLerp: 10.5,
        size: 30,
        cameraLerp: 6.2,
        zoomDurationMs: 520,
        zoomTargetScale: 3.4,
        exhaustRateMs: 22,
        exhaustColors: ['#fde047', '#fb923c', '#2dd4bf', '#38bdf8']
    },
    controls: {
        joyBaseRadius: 62,
        joyKnobRadius: 27,
        actionBtnRadius: 52,
        deadzone: 0.08
    },
    background: {
        baseColorTop: '#040613',
        baseColorBottom: '#0c1130',
        nebulas: [
            { x: -750, y: -480, r: 620, color: 'rgba(139, 92, 246, 0.22)' },
            { x: 780,  y: -440, r: 580, color: 'rgba(14, 165, 233, 0.20)' },
            { x: -820, y: 580,  r: 610, color: 'rgba(244, 63, 94, 0.17)' },
            { x: 840,  y: 620,  r: 640, color: 'rgba(16, 185, 129, 0.18)' },
            { x: 0,    y: 0,    r: 520, color: 'rgba(250, 204, 21, 0.16)' },
            { x: 180,  y: -1180,r: 540, color: 'rgba(217, 70, 239, 0.18)' }
        ],
        parallaxLayers: [
            { factor: 0.1, count: 110, minSize: 1.0, maxSize: 2.0, alpha: 0.55 },
            { factor: 0.3, count: 75,  minSize: 1.5, maxSize: 2.8, alpha: 0.80 },
            { factor: 0.6, count: 45,  minSize: 2.2, maxSize: 3.8, alpha: 0.95 }
        ]
    },
    environment: {
        asteroidCount: 34,
        cometCount: 5,
        cheeseMagnetRadius: 155,
        cheeseCollectRadius: 36,
        cheeseMagnetPull: 520,
        cheeseClusters: [
            { x: 0,    y: 0,    count: 6, spread: 80 },
            { x: -340, y: -170, count: 5, spread: 75 },
            { x: 370,  y: -210, count: 5, spread: 75 },
            { x: -520, y: 260,  count: 6, spread: 85 },
            { x: 510,  y: 310,  count: 6, spread: 85 },
            { x: -860, y: -40,  count: 5, spread: 80 },
            { x: 880,  y: 110,  count: 5, spread: 80 },
            { x: 40,   y: 540,  count: 5, spread: 75 }
        ]
    },
    planets: [
        {
            id: 'transylvania',
            name: 'Замок Теней',
            subtitle: 'Тихая лапка, норы-телепорты и призраки',
            badge: '🏰 СТЕЛС И ЭКШЕН',
            actionLabel: 'СЕСТЬ!',
            x: -520,
            y: -240,
            radius: 86,
            dockRadius: 185,
            coreColor: '#c084fc',
            midColor: '#7e22ce',
            rimColor: '#3b0764',
            atmoColor: 'rgba(192, 132, 252, 0.48)',
            ringColor: 'rgba(216, 180, 254, 0.6)',
            moonColor: '#e9d5ff',
            monsterImg: 'assets/characters/transylvania/ghost.svg',
            locked: false
        },
        {
            id: 'snowball',
            name: 'Ледяная Арена',
            subtitle: 'Битва снежками в пещерах и онлайн с друзьями',
            badge: '❄️ СНЕЖКИ',
            actionLabel: 'СЕСТЬ!',
            x: 540,
            y: -240,
            radius: 84,
            dockRadius: 185,
            coreColor: '#7dd3fc',
            midColor: '#0284c7',
            rimColor: '#0c4a6e',
            atmoColor: 'rgba(56, 189, 248, 0.48)',
            ringColor: 'rgba(186, 230, 253, 0.68)',
            moonColor: '#e0f2fe',
            monsterImg: 'assets/characters/transylvania/bat.svg',
            locked: false
        },
        {
            id: 'adventure',
            name: 'Огненная Долина',
            subtitle: 'Платформер: 3 ярких мира и сырные трофеи',
            badge: '🌋 3 МИРА',
            actionLabel: 'СЕСТЬ!',
            x: -440,
            y: 440,
            radius: 82,
            dockRadius: 180,
            coreColor: '#fb923c',
            midColor: '#ea580c',
            rimColor: '#7c2d12',
            atmoColor: 'rgba(251, 146, 60, 0.46)',
            ringColor: 'rgba(254, 215, 170, 0.6)',
            moonColor: '#ffedd5',
            monsterImg: 'assets/characters/transylvania/skeleton.svg',
            locked: false
        },
        {
            id: 'newyear',
            name: 'Ёлочный Лабиринт',
            subtitle: 'Новогодний поиск подарков среди гирлянд',
            badge: '🎄 ЛАБИРИНТ',
            actionLabel: 'СЕСТЬ!',
            x: 460,
            y: 440,
            radius: 82,
            dockRadius: 180,
            coreColor: '#4ade80',
            midColor: '#16a34a',
            rimColor: '#14532d',
            atmoColor: 'rgba(74, 222, 128, 0.46)',
            ringColor: 'rgba(187, 247, 208, 0.6)',
            moonColor: '#dcfce7',
            monsterImg: 'assets/characters/transylvania/zombie.svg',
            locked: false
        },
        {
            id: 'secret',
            name: 'Тайная Туманность X',
            subtitle: 'Секретная планета откроется в новых обновлениях!',
            badge: '🔒 СЕКРЕТ',
            actionLabel: 'ЗАКРЫТО',
            x: 0,
            y: -590,
            radius: 74,
            dockRadius: 170,
            coreColor: '#94a3b8',
            midColor: '#475569',
            rimColor: '#0f172a',
            atmoColor: 'rgba(148, 163, 184, 0.34)',
            ringColor: 'rgba(203, 213, 225, 0.42)',
            moonColor: '#cbd5e1',
            monsterImg: 'assets/characters/transylvania/vampire.svg',
            locked: true
        }
    ]
};
