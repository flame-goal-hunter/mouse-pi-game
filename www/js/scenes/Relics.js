// ============================================
// RELICS — behavior-changing modifiers that drop during a run
// Hades-style: each relic transforms how the game plays, not just +stats.
// Picked up via relic chests (1-2 per floor) or sub-boss drops.
// All hooks are optional; scene.relicHooks dispatches them at the right times.
// ============================================

export const RELICS = [
    // === COMMON ===
    {
        id: 'pierce',
        rarity: 'common',
        emoji: '🎯',
        icon: 'ui_target',
        name: 'Меткий пирог',
        desc: 'Пироги пробивают первого врага и летят дальше',
        apply: (s) => { s.relicPierce = (s.relicPierce || 0) + 1; }
    },
    {
        id: 'magnet',
        rarity: 'common',
        emoji: '🧲',
        icon: 'relic_magnet',
        name: 'Сырный магнит',
        desc: 'Сыр и сердца сами летят к тебе с расстояния',
        apply: (s) => { s.relicMagnetRange = (s.relicMagnetRange || 0) + 140; }
    },
    {
        id: 'spread',
        rarity: 'common',
        emoji: '🌟',
        icon: 'relic_star_spread',
        name: 'Разлёт',
        desc: 'Каждый 4-й пирог стреляет двумя дополнительными в стороны',
        apply: (s) => { s.relicSpreadEvery = (s.relicSpreadEvery || 5) - 1; }   // every Nth fire
    },
    {
        id: 'sturdy',
        rarity: 'common',
        emoji: '🛡',
        icon: 'ui_shield',
        name: 'Толстокожий',
        desc: '+0.5с неуязвимости после получения урона',
        apply: (s) => { s.relicInvulnBonusMs = (s.relicInvulnBonusMs || 0) + 500; }
    },
    {
        id: 'flame_trail',
        rarity: 'common',
        emoji: '🔥',
        icon: 'ui_flame',
        name: 'Огненный след',
        desc: 'Рывок оставляет горящий след — 1 урон по врагам',
        apply: (s) => { s.relicFlameTrail = true; }
    },

    // === RARE ===
    {
        id: 'bounce',
        rarity: 'rare',
        emoji: '🪀',
        icon: 'relic_bounce',
        name: 'Прыгучесть',
        desc: 'Пироги отскакивают от стен один раз',
        apply: (s) => { s.relicBounce = (s.relicBounce || 0) + 1; }
    },
    {
        id: 'crit',
        rarity: 'rare',
        emoji: '💥',
        icon: 'relic_crit',
        name: 'Критический сыр',
        desc: '20% шанс x3 урона',
        apply: (s) => { s.relicCritChance = (s.relicCritChance || 0) + 0.20; }
    },
    {
        id: 'thorns',
        rarity: 'rare',
        emoji: '🌵',
        icon: 'relic_thorns',
        name: 'Колючий мех',
        desc: 'Враг получает 2 урона за каждое касание',
        apply: (s) => { s.relicThornDmg = (s.relicThornDmg || 0) + 2; }
    },
    {
        id: 'combo_heart',
        rarity: 'rare',
        emoji: '💞',
        icon: 'ui_heart',
        name: 'Комбо-сердце',
        desc: 'Каждое 5-е комбо-убийство восстанавливает HP',
        apply: (s) => { s.relicComboHeart = true; }
    },
    {
        id: 'dash_burst',
        rarity: 'rare',
        emoji: '💨',
        icon: 'ui_dash',
        name: 'Взрывной рывок',
        desc: 'В конце рывка — мини-взрыв на 80px вокруг Пи',
        apply: (s) => { s.relicDashBurst = true; }
    },
    {
        id: 'ghost_walk',
        rarity: 'rare',
        emoji: '👻',
        icon: 'd_ghost',
        name: 'Шаг тени',
        desc: '−50% копится подозрительность врагов',
        apply: (s) => { s.relicGhostWalk = true; }
    },

    // === LEGENDARY ===
    {
        id: 'pie_storm',
        rarity: 'legendary',
        emoji: '🌪',
        icon: 'relic_tornado',
        name: 'Пироговый шторм',
        desc: 'Стреляешь сразу 5-ю пирогами веером',
        apply: (s) => { s.relicPieStorm = true; }
    },
    {
        id: 'undying',
        rarity: 'legendary',
        emoji: '💀',
        icon: 'prop_skull',
        name: 'Несгибаемый',
        desc: 'Раз за забег: при смерти выживаешь на 1 HP',
        apply: (s) => { s.relicUndying = (s.relicUndying || 0) + 1; }
    },
    {
        id: 'gold_pie',
        rarity: 'legendary',
        emoji: '👑',
        icon: 'relic_crown',
        name: 'Золотой пирог',
        desc: 'Каждый 10-й пирог огромен и взрывается',
        apply: (s) => { s.relicGoldPieEvery = 10; }
    },
    {
        id: 'time_warp',
        rarity: 'legendary',
        emoji: '⏳',
        icon: 'relic_hourglass',
        name: 'Замедление',
        desc: 'Когда HP < 30% — время вокруг тебя замедляется',
        apply: (s) => { s.relicTimeWarp = true; }
    },
    {
        id: 'cheese_explosion',
        rarity: 'legendary',
        emoji: '🧀',
        icon: 'd_cheese',
        name: 'Сырный взрыв',
        desc: 'Подбор сыра наносит 2 урона врагам в 100px',
        apply: (s) => { s.relicCheeseBoom = true; }
    }
];

// Rarity weights for random pick
const RARITY_WEIGHT = { common: 6, rare: 3, legendary: 1 };

export function pickRandomRelics(count, exclude = []) {
    const pool = RELICS.filter(r => !exclude.includes(r.id));
    if (pool.length === 0) return [];
    // Weighted pick by rarity
    const picked = [];
    const available = pool.slice();
    for (let i = 0; i < count && available.length > 0; i++) {
        let total = 0;
        for (const r of available) total += RARITY_WEIGHT[r.rarity] || 1;
        let roll = Math.random() * total;
        let chosen = available[0];
        for (const r of available) {
            roll -= RARITY_WEIGHT[r.rarity] || 1;
            if (roll <= 0) { chosen = r; break; }
        }
        picked.push(chosen);
        const idx = available.indexOf(chosen);
        if (idx >= 0) available.splice(idx, 1);
    }
    return picked;
}

export function relicById(id) { return RELICS.find(r => r.id === id); }

export const RARITY_COLORS = {
    common:    { fill: 0x2a3848, accent: 0x80a0c0 },
    rare:      { fill: 0x202058, accent: 0x80a0ff },
    legendary: { fill: 0x4a2058, accent: 0xffd040 }
};
