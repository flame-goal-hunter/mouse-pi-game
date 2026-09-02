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
        icon: 'ui_target',
        name: 'Меткий пирог',
        desc: 'Пироги пробивают первого врага и летят дальше',
        apply: (s) => { s.relicPierce = (s.relicPierce || 0) + 1; }
    },
    {
        id: 'magnet',
        rarity: 'common',
        icon: 'relic_magnet',
        name: 'Сырный магнит',
        desc: 'Сыр и сердца сами летят к тебе с расстояния',
        apply: (s) => { s.relicMagnetRange = (s.relicMagnetRange || 0) + 140; }
    },
    {
        id: 'spread',
        rarity: 'common',
        icon: 'relic_star_spread',
        name: 'Разлёт',
        desc: 'Иногда летят сразу три пирога',
        apply: (s) => { s.relicSpreadEvery = (s.relicSpreadEvery || 5) - 1; }   // every Nth fire
    },
    {
        id: 'sturdy',
        rarity: 'common',
        icon: 'ui_shield',
        name: 'Толстокожий',
        desc: 'Дольше не бьют после удара',
        apply: (s) => { s.relicInvulnBonusMs = (s.relicInvulnBonusMs || 0) + 500; }
    },
    {
        id: 'flame_trail',
        rarity: 'common',
        icon: 'ui_flame',
        name: 'Огненный след',
        desc: 'Рывок оставляет огненный след',
        apply: (s) => { s.relicFlameTrail = true; }
    },

    // === RARE ===
    {
        id: 'bounce',
        rarity: 'rare',
        icon: 'relic_bounce',
        name: 'Прыгучесть',
        desc: 'Пироги отскакивают от стен один раз',
        apply: (s) => { s.relicBounce = (s.relicBounce || 0) + 1; }
    },
    {
        id: 'crit',
        rarity: 'rare',
        icon: 'relic_crit',
        name: 'Критический сыр',
        desc: 'Иногда пирог бьёт втрое сильнее',
        apply: (s) => { s.relicCritChance = (s.relicCritChance || 0) + 0.20; }
    },
    {
        id: 'thorns',
        rarity: 'rare',
        icon: 'relic_thorns',
        name: 'Колючий мех',
        desc: 'Кто тронет Пи — получит сдачи',
        apply: (s) => { s.relicThornDmg = (s.relicThornDmg || 0) + 2; }
    },
    {
        id: 'combo_heart',
        rarity: 'rare',
        icon: 'ui_heart',
        name: 'Комбо-сердце',
        desc: 'За серию побед — сердечко',
        apply: (s) => { s.relicComboHeart = true; }
    },
    {
        id: 'dash_burst',
        rarity: 'rare',
        icon: 'ui_dash',
        name: 'Взрывной рывок',
        desc: 'Рывок заканчивается взрывом',
        apply: (s) => { s.relicDashBurst = true; }
    },
    {
        id: 'ghost_walk',
        rarity: 'rare',
        icon: 'd_ghost',
        name: 'Шаг тени',
        desc: 'Враги замечают Пи вдвое медленнее',
        apply: (s) => { s.relicGhostWalk = true; }
    },

    // === LEGENDARY ===
    {
        id: 'pie_storm',
        rarity: 'legendary',
        icon: 'relic_tornado',
        name: 'Пироговый шторм',
        desc: 'Стреляешь веером из пяти пирогов',
        apply: (s) => { s.relicPieStorm = true; }
    },
    {
        id: 'undying',
        rarity: 'legendary',
        icon: 'prop_skull',
        name: 'Несгибаемый',
        desc: 'Один раз спасёт от гибели',
        apply: (s) => { s.relicUndying = (s.relicUndying || 0) + 1; }
    },
    {
        id: 'gold_pie',
        rarity: 'legendary',
        icon: 'relic_crown',
        name: 'Золотой пирог',
        desc: 'Иногда пирог огромный и взрывается',
        apply: (s) => { s.relicGoldPieEvery = 10; }
    },
    {
        id: 'time_warp',
        rarity: 'legendary',
        icon: 'relic_hourglass',
        name: 'Замедление',
        desc: 'Мало сердечек — время замедляется',
        apply: (s) => { s.relicTimeWarp = true; }
    },
    {
        id: 'cheese_explosion',
        rarity: 'legendary',
        icon: 'd_cheese',
        name: 'Сырный взрыв',
        desc: 'Сыр взрывается и задевает врагов',
        apply: (s) => { s.relicCheeseBoom = true; }
    },

    // --- Finding 08: the pool was 16, and now that a relic is the guaranteed reward
    // after every floor a run saw most of it. These fourteen use levers the scene
    // already has, so none of them needs new machinery.
    {
        id: 'quick_paws', rarity: 'common', icon: 'ui_bolt', name: 'Быстрые лапы',
        desc: 'Пи бегает заметно быстрее',
        apply: (s) => { s.speedMul = (s.speedMul || 1) * 1.12; }
    },
    {
        id: 'deep_pockets', rarity: 'common', icon: 'd_pie', name: 'Глубокие карманы',
        desc: 'На три пирога больше в лапах',
        apply: (s) => { s.clipBonus = (s.clipBonus || 0) + 3; }
    },
    {
        id: 'quick_hands', rarity: 'common', icon: 'ui_target', name: 'Ловкие лапы',
        desc: 'Быстрее набирает пироги',
        apply: (s) => { s.reloadMul = (s.reloadMul || 1) * 0.72; }
    },
    {
        id: 'bright_lamp', rarity: 'common', icon: 'ui_flame', name: 'Яркий фонарь',
        desc: 'Видно гораздо дальше',
        apply: (s) => { s.lightMul = (s.lightMul || 1) * 1.35; }
    },
    {
        id: 'cat_step', rarity: 'common', icon: 'ui_paw', name: 'Кошачий шаг',
        desc: 'Враги замечают Пи медленнее',
        apply: (s) => { s.stealthMul = (s.stealthMul || 1) * 0.7; }
    },
    {
        id: 'heavy_pie', rarity: 'rare', icon: 'ui_flame', name: 'Тяжёлый пирог',
        desc: 'Пирог бьёт сильнее',
        apply: (s) => { s.pieDmgBonus = (s.pieDmgBonus || 0) + 1; }
    },
    {
        id: 'thick_crust', rarity: 'rare', icon: 'ui_heart', name: 'Толстая корка',
        desc: 'Два лишних сердца',
        apply: (s) => { s.maxHp += 2; if (s.player) s.player.hp = s.maxHp; }
    },
    {
        id: 'cheese_nose', rarity: 'rare', icon: 'd_cheese', name: 'Сырный нюх',
        desc: 'Заметно больше сыра за кусочек',
        apply: (s) => { s.cheeseMul = (s.cheeseMul || 1) * 1.5; }
    },
    {
        id: 'second_wind', rarity: 'rare', icon: 'relic_blood_drop', name: 'Второе дыхание',
        desc: 'Часто возвращает сердечко за врага',
        apply: (s) => { s.lifestealChance = (s.lifestealChance || 0) + 0.25; }
    },
    {
        id: 'spring_paws', rarity: 'rare', icon: 'ui_dash', name: 'Пружинки в лапах',
        desc: 'Рывок готов почти сразу',
        apply: (s) => { s.dashCdMul = (s.dashCdMul || 1) * 0.6; }
    },
    {
        id: 'double_pierce', rarity: 'rare', icon: 'ui_target', name: 'Двойной прокол',
        desc: 'Пирог пробивает ещё двоих',
        apply: (s) => { s.relicPierce = (s.relicPierce || 0) + 2; }
    },
    {
        id: 'sticky_pie', rarity: 'rare', icon: 'relic_bounce', name: 'Липкий пирог',
        desc: 'Пироги отскакивают ещё дважды',
        apply: (s) => { s.relicBounce = (s.relicBounce || 0) + 2; }
    },
    {
        id: 'sharp_eye', rarity: 'legendary', icon: 'relic_crit', name: 'Острый глаз',
        desc: 'Часто бьёт втрое сильнее',
        apply: (s) => { s.relicCritChance = (s.relicCritChance || 0) + 0.3; }
    },
    {
        id: 'roly_poly', rarity: 'legendary', icon: 'relic_crown', name: 'Неваляшка',
        desc: 'Ещё раз спасёт от гибели и дольше не бьют',
        apply: (s) => { s.relicUndying = (s.relicUndying || 0) + 1;
                        s.relicInvulnBonusMs = (s.relicInvulnBonusMs || 0) + 400; }
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
