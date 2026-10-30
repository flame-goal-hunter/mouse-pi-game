// ============================================================================
// PROCEDURAL ISLAND BURROW GENERATOR — «Тихая лапка: Операция Нора»
// ============================================================================
// Psychological & Game-Design Pillars (Designed for a 10-year-old player):
//   1. BURROWS ARE 100% ESSENTIAL:
//      Each floor is a cluster of 3 to 6 physically separated Floating Islands
//      over a magical starry sky/lagoon. There are NO walking bridges between
//      islands — the ONLY way to reach the Captive Pets, Star Cheeses, and the
//      Rainbow Escape Portal is by diving into Color-Coded Burrows connected
//      by glowing subterranean energy tubes!
//   2. EMOTIONAL GOAL — RESCUE CUTE PET FRIENDS ("Паровозик Друзей"):
//      Monsters guard 1–3 cute captive pets (Мышка Мими 🎀, Хомячок Бублик 🧁,
//      Котёнок Облачко ☁️, Зайка Звёздочка ⭐, Лисичка Лучик ✨) in crystal
//      bubbles. Rescued pets follow Pi in a bouncy chain through burrows!
//   3. SAFE ADRENALINE ("Я в домике!"):
//      Every guarded island has 2+ burrow mouths so Pi can dive underground at
//      any moment, peek safely out of the hole, whistle (`📣 СВИСТ!`) to lure
//      the monster away, and pop out behind its back!
//   4. DAUGHTER'S HAND-DRAWN MONSTERS:
//      All Castle of Shadows monsters (cat, zombie, skeleton, ghost, bat,
//      slime, count) patrol the islands with distinct personalities.
// ============================================================================

export const BURROW_PALETTE = [
    {
        id: 'gold',
        name: 'Золотой туннель',
        ringColor: 0xfacc15,
        glowColor: 0xfef08a,
        coreColor: 0x422006,
        hex: '#facc15',
        badge: '🟡'
    },
    {
        id: 'magenta',
        name: 'Неоновый туннель',
        ringColor: 0xf472b6,
        glowColor: 0xfbcfe8,
        coreColor: 0x500724,
        hex: '#f472b6',
        badge: '🩷'
    },
    {
        id: 'cyan',
        name: 'Кристальный туннель',
        ringColor: 0x38bdf8,
        glowColor: 0xbae6fd,
        coreColor: 0x082f49,
        hex: '#38bdf8',
        badge: '🔵'
    },
    {
        id: 'emerald',
        name: 'Изумрудный туннель',
        ringColor: 0x34d399,
        glowColor: 0xa7f3d0,
        coreColor: 0x064e3b,
        hex: '#34d399',
        badge: '🟢'
    },
    {
        id: 'violet',
        name: 'Звёздный туннель',
        ringColor: 0xc084fc,
        glowColor: 0xe9d5ff,
        coreColor: 0x3b0764,
        hex: '#c084fc',
        badge: '🟣'
    }
];

export const MAGICAL_THEMES = [
    {
        id: 'candy_sky',
        title: '🧁 Облачная Кондитерская',
        subtitle: 'Сладкие острова над звёздным небом',
        bgm: 'bgm_kitchen',
        skyTop: '#1b1038',
        skyBot: '#351b63',
        nebulaColor: 'rgba(244, 114, 182, 0.22)',
        islandTopA: '#fff1f5',
        islandTopB: '#ffe4e6',
        islandChecker: 'rgba(244, 114, 182, 0.13)',
        islandRim: '#f472b6',
        islandRimGlow: 'rgba(244, 114, 182, 0.45)',
        islandCliffTop: '#be185d',
        islandCliffBot: '#500724',
        accentHex: '#f472b6',
        accentInt: 0xf472b6
    },
    {
        id: 'neon_arcade',
        title: '🕹️ Неоновый Кибер-Парк',
        subtitle: 'Светящиеся платформы и плазменные норы',
        bgm: 'bgm_library',
        skyTop: '#070b1e',
        skyBot: '#15224d',
        nebulaColor: 'rgba(56, 189, 248, 0.20)',
        islandTopA: '#1e2b58',
        islandTopB: '#25356b',
        islandChecker: 'rgba(56, 189, 248, 0.12)',
        islandRim: '#38bdf8',
        islandRimGlow: 'rgba(56, 189, 248, 0.50)',
        islandCliffTop: '#0284c7',
        islandCliffBot: '#082f49',
        accentHex: '#38bdf8',
        accentInt: 0x38bdf8
    },
    {
        id: 'sakura_lagoon',
        title: '🌸 Лунная Лагуна Сакуры',
        subtitle: 'Парящие сады со светлячками',
        bgm: 'bgm_garden',
        skyTop: '#061a23',
        skyBot: '#0f3847',
        nebulaColor: 'rgba(52, 211, 153, 0.20)',
        islandTopA: '#ecfdf5',
        islandTopB: '#d1fae5',
        islandChecker: 'rgba(16, 185, 129, 0.13)',
        islandRim: '#34d399',
        islandRimGlow: 'rgba(52, 211, 153, 0.45)',
        islandCliffTop: '#059669',
        islandCliffBot: '#064e3b',
        accentHex: '#34d399',
        accentInt: 0x34d399
    },
    {
        id: 'starlight_circus',
        title: '🎪 Звёздный Парк Чудес',
        subtitle: 'Золотые арены и весёлые аттракционы',
        bgm: 'bgm_dungeon',
        skyTop: '#1c0b36',
        skyBot: '#3b156b',
        nebulaColor: 'rgba(250, 204, 21, 0.20)',
        islandTopA: '#fef9c3',
        islandTopB: '#fef08a',
        islandChecker: 'rgba(245, 158, 11, 0.14)',
        islandRim: '#facc15',
        islandRimGlow: 'rgba(250, 204, 21, 0.48)',
        islandCliffTop: '#d97706',
        islandCliffBot: '#451a03',
        accentHex: '#facc15',
        accentInt: 0xfacc15
    },
    {
        id: 'crystal_palace',
        title: '💎 Хрустальный Дворец Ратулы',
        subtitle: 'Королевский остров Главного Хранителя!',
        bgm: 'bgm_throne',
        skyTop: '#16072b',
        skyBot: '#34105e',
        nebulaColor: 'rgba(192, 132, 252, 0.25)',
        islandTopA: '#f5f3ff',
        islandTopB: '#ede9fe',
        islandChecker: 'rgba(168, 85, 247, 0.14)',
        islandRim: '#c084fc',
        islandRimGlow: 'rgba(192, 132, 252, 0.52)',
        islandCliffTop: '#7e22ce',
        islandCliffBot: '#2e1065',
        accentHex: '#c084fc',
        accentInt: 0xc084fc
    }
];

export const CAPTIVE_PETS = [
    {
        id: 'mimi',
        name: 'Мышка Мими',
        badge: '🎀',
        bodyColor: '#ffffff',
        earColor: '#fbcfe8',
        accColor: '#f43f5e',
        cryText: 'Пи-пи! Спаси меня!',
        thanksText: 'Ура! Я с тобой! 💖'
    },
    {
        id: 'bublik',
        name: 'Хомячок Бублик',
        badge: '🧁',
        bodyColor: '#fed7aa',
        earColor: '#fdba74',
        accColor: '#f97316',
        cryText: 'Хочу домой! 🧁',
        thanksText: 'Побежали в нору! ⭐'
    },
    {
        id: 'cloud',
        name: 'Котёнок Облачко',
        badge: '☁️',
        bodyColor: '#e0f2fe',
        earColor: '#7dd3fc',
        accColor: '#0ea5e9',
        cryText: 'Мяу! Открой клетку!',
        thanksText: 'Ты лучшая! ✨'
    },
    {
        id: 'star',
        name: 'Зайка Звёздочка',
        badge: '⭐',
        bodyColor: '#f3e8ff',
        earColor: '#d8b4fe',
        accColor: '#eab308',
        cryText: 'Ой, стражник рядом!',
        thanksText: 'Прыг-скок за тобой! 🌟'
    },
    {
        id: 'luchik',
        name: 'Лисичка Лучик',
        badge: '✨',
        bodyColor: '#ffedd5',
        earColor: '#fb923c',
        accColor: '#ec4899',
        cryText: 'Выпусти меня скорее!',
        thanksText: 'Вперёд к порталу! 🌈'
    }
];

export const HEIST_MONSTERS = {
    cat: {
        id: 'cat',
        name: 'Кот-страж',
        texFront: 'd_cat',
        texSide: 'd_cat_side',
        texBack: 'd_cat_back',
        speedMul: 1.0,
        coneRange: 205,
        coneAngle: 64,
        coneColor: 0xfbbf24,
        alertColor: 0xef4444,
        scale: 0.92,
        idleLines: ['Мяу? Сыр пахнет!', 'Хм, кто шуршит в норе?', 'Ни одна мышь не пройдёт!']
    },
    zombie: {
        id: 'zombie',
        name: 'Зомби-повар',
        texFront: 'd_zombie',
        texSide: 'd_zombie_side',
        texBack: 'd_zombie_back',
        speedMul: 0.78,
        coneRange: 175,
        coneAngle: 58,
        coneColor: 0x4ade80,
        alertColor: 0xef4444,
        scale: 0.92,
        idleLines: ['У-у-у... где мой торт?', 'Кто свистел из норки?', 'Топ-топ-топ...']
    },
    skeleton: {
        id: 'skeleton',
        name: 'Скелет-дозорный',
        texFront: 'd_skeleton',
        texSide: 'd_skeleton_side',
        texBack: 'd_skeleton_back',
        speedMul: 1.12,
        coneRange: 215,
        coneAngle: 56,
        coneColor: 0x38bdf8,
        alertColor: 0xf97316,
        scale: 0.92,
        idleLines: ['Клац-клац! Вижу нору!', 'Проверю-ка этот угол!', 'Кто тут бегает?!']
    },
    ghost: {
        id: 'ghost',
        name: 'Призрак замка',
        texFront: 'd_ghost',
        texSide: 'd_ghost_side',
        texBack: 'd_ghost_back',
        speedMul: 0.95,
        coneRange: 195,
        coneAngle: 68,
        coneColor: 0xc084fc,
        alertColor: 0xf43f5e,
        scale: 0.92,
        floats: true,
        idleLines: ['У-у-у! Я всё вижу~', 'Сквозь туман лечу!', 'Кто прячется в норке?']
    },
    bat: {
        id: 'bat',
        name: 'Летучая мышь',
        texFront: 'd_bat',
        texSide: 'd_bat_side',
        texBack: 'd_bat_back',
        speedMul: 1.22,
        coneRange: 180,
        coneAngle: 72,
        coneColor: 0xf472b6,
        alertColor: 0xef4444,
        scale: 0.88,
        floats: true,
        idleLines: ['Пи-пи! Слышу шорох!', 'Крылья ночи на страже!', 'Вжух-вжух!']
    },
    slime: {
        id: 'slime',
        name: 'Желейный слайм',
        texFront: 'd_slime',
        texSide: 'd_slime_side',
        texBack: 'd_slime_back',
        speedMul: 0.72,
        coneRange: 160,
        coneAngle: 76,
        coneColor: 0x34d399,
        alertColor: 0xeab308,
        scale: 0.90,
        idleLines: ['Бульк-бульк! Вкусно пахнет!', 'Прыг-плюх!', 'Ой, кто там в норе?']
    },
    count: {
        id: 'count',
        name: 'Граф Ратула',
        texFront: 'd_count',
        texSide: 'd_count_side',
        texBack: 'd_count_back',
        speedMul: 1.14,
        coneRange: 230,
        coneAngle: 66,
        coneColor: 0xf43f5e,
        alertColor: 0xdc2626,
        scale: 1.05,
        isBoss: true,
        idleLines: ['Муа-ха-ха! Это мои пушистики!', 'Даже норы тебя не спасут!', 'Стража, держи мышку!']
    }
};

export const RUN_PERKS = [
    {
        id: 'speed_skates',
        title: 'Неоновые Ролики',
        icon: '🛼',
        desc: '+25% к скорости бега Пи и пушистиков!',
        color: '#38bdf8'
    },
    {
        id: 'ghost_cloak',
        title: 'Прыжок-Невидимка',
        icon: '🧥',
        desc: 'Выпрыгивание из норы даёт 2.5 сек полной невидимости!',
        color: '#c084fc'
    },
    {
        id: 'cake_factory',
        title: 'Сладкий Арсенал',
        icon: '🎂',
        desc: '+2 кремовых торта сразу и +1 торт на каждом этаже!',
        color: '#f472b6'
    },
    {
        id: 'cheese_magnet',
        title: 'Сырный Пылесос',
        icon: '🧲',
        desc: 'Притягивает все сырки, кристаллы и бонусы издалека!',
        color: '#facc15'
    },
    {
        id: 'hypno_whistle',
        title: 'Гипно-Свисток',
        icon: '📣',
        desc: 'Свист из норы приманивает монстров и усыпляет их на 3 сек!',
        color: '#34d399'
    },
    {
        id: 'extra_heart',
        title: 'Золотое Сердечко',
        icon: '💖',
        desc: 'Восстанавливает все сердечки + 15 бонусных сырков!',
        color: '#fb7185'
    }
];

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function pickMonsterPool(floorNum) {
    if (floorNum === 1) return ['cat', 'slime'];
    if (floorNum === 2) return ['cat', 'zombie', 'slime'];
    if (floorNum === 3) return ['cat', 'skeleton', 'ghost'];
    if (floorNum === 4) return ['skeleton', 'ghost', 'bat', 'cat'];
    if (floorNum % 5 === 0) return ['count', 'ghost', 'skeleton', 'bat'];
    return ['cat', 'zombie', 'skeleton', 'ghost', 'bat', 'slime'];
}

export function themeForFloor(floorNum) {
    if (floorNum % 5 === 0) return MAGICAL_THEMES[4]; // Crystal Palace for Boss floors
    return MAGICAL_THEMES[(floorNum - 1) % 4];
}

/**
 * Generates an Island-Burrow Heist Floor.
 *
 * Every floor consists of separated rectangular/rounded Walkable Islands on a
 * grid of W x H cells (`cell = 80px`). Cells outside islands are `#` (VOID chasm).
 * Because islands do NOT touch each other, the player MUST use the color-coded
 * burrows (`holes`) to teleport across the chasm from the Start Island to the
 * Guarded Pet Islands and finally to the Escape Portal Island!
 */
export function generateHeistFloor(floorNum = 1, customSeed = null) {
    const seed = customSeed !== null
        ? customSeed
        : ((floorNum * 2654435761) ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    const rng = mulberry32(seed);

    const isBossFloor = floorNum % 5 === 0;
    const theme = themeForFloor(floorNum);

    const W = 23;
    const H = 15;
    const cell = 80;

    // Choose island topology based on floor progression:
    // Floor 1: 3 Islands (Start Island -> Guarded Pet Island -> Portal Island)
    // Floor 2-3: 4 Islands (Start Island -> 2 Guarded Pet Islands -> Portal Island)
    // Floor 4+: 5 Islands (Start Island -> 3 Guarded Pet Islands -> Portal Island)
    let islands = [];
    if (floorNum === 1) {
        islands = [
            { id: 0, role: 'start', name: 'Остров Старта', x1: 1, y1: 3, x2: 5, y2: 11 },
            { id: 1, role: 'vault', name: 'Остров Пушистика', x1: 8, y1: 2, x2: 15, y2: 12, hasPillar: true },
            { id: 2, role: 'portal', name: 'Остров Портала', x1: 18, y1: 3, x2: 21, y2: 11 }
        ];
    } else if (floorNum <= 3) {
        islands = [
            { id: 0, role: 'start', name: 'Остров Старта', x1: 1, y1: 4, x2: 5, y2: 10 },
            { id: 1, role: 'vault', name: 'Верхний Остров', x1: 7, y1: 1, x2: 15, y2: 6, hasPillar: true },
            { id: 2, role: 'vault', name: 'Нижний Остров', x1: 7, y1: 8, x2: 15, y2: 13, hasPillar: true },
            { id: 3, role: 'portal', name: 'Остров Портала', x1: 17, y1: 4, x2: 21, y2: 10 }
        ];
    } else {
        islands = [
            { id: 0, role: 'start', name: 'Остров Старта', x1: 1, y1: 1, x2: 5, y2: 6 },
            { id: 1, role: 'vault', name: 'Северный Зал', x1: 7, y1: 1, x2: 15, y2: 6, hasPillar: true },
            { id: 2, role: 'vault', name: 'Южный Зал', x1: 1, y1: 8, x2: 9, y2: 13, hasPillar: true },
            { id: 3, role: 'vault', name: 'Центральный Свод', x1: 11, y1: 8, x2: 17, y2: 13, hasPillar: true },
            { id: 4, role: 'portal', name: 'Остров Портала', x1: 18, y1: 1, x2: 21, y2: 6 }
        ];
    }

    // Build grid: '#' = void chasm / obstacle pillar, '.' = walkable island floor
    const grid = Array.from({ length: H }, () => Array(W).fill('#'));

    for (const isl of islands) {
        for (let y = isl.y1; y <= isl.y2; y++) {
            for (let x = isl.x1; x <= isl.x2; x++) {
                grid[y][x] = '.';
            }
        }
        // Optional central decorative pillar inside larger vault islands so Pi can
        // loop around it AND monsters patrol around a clear visual landmark
        if (isl.hasPillar) {
            const cx = Math.floor((isl.x1 + isl.x2) / 2);
            const cy = Math.floor((isl.y1 + isl.y2) / 2);
            const w = isl.x2 - isl.x1;
            const h = isl.y2 - isl.y1;
            if (w >= 6 && h >= 5) {
                grid[cy][cx] = '#';
                isl.pillarCell = { x: cx, y: cy };
            }
        }
    }

    const used = new Set();
    const keyOf = (x, y) => `${x},${y}`;
    const markUsed = (pt, pad = 0) => {
        if (!pt) return;
        for (let dy = -pad; dy <= pad; dy++) {
            for (let dx = -pad; dx <= pad; dx++) {
                used.add(keyOf(pt.x + dx, pt.y + dy));
            }
        }
    };

    const pickCellInIsland = (isl, preferCorner = null) => {
        const candidates = [];
        for (let y = isl.y1; y <= isl.y2; y++) {
            for (let x = isl.x1; x <= isl.x2; x++) {
                if (grid[y][x] !== '.') continue;
                if (used.has(keyOf(x, y))) continue;
                candidates.push({ x, y });
            }
        }
        if (candidates.length === 0) {
            // Fallback without `used` filter
            for (let y = isl.y1; y <= isl.y2; y++) {
                for (let x = isl.x1; x <= isl.x2; x++) {
                    if (grid[y][x] === '.') return { x, y };
                }
            }
        }
        if (preferCorner === 'left') {
            candidates.sort((a, b) => a.x - b.x || a.y - b.y);
            return candidates[0];
        }
        if (preferCorner === 'right') {
            candidates.sort((a, b) => b.x - a.x || b.y - a.y);
            return candidates[0];
        }
        if (preferCorner === 'top-left') {
            candidates.sort((a, b) => (a.x + a.y) - (b.x + b.y));
            return candidates[0];
        }
        if (preferCorner === 'bottom-right') {
            candidates.sort((a, b) => (b.x + b.y) - (a.x + a.y));
            return candidates[0];
        }
        if (preferCorner === 'center') {
            const cx = (isl.x1 + isl.x2) / 2;
            const cy = (isl.y1 + isl.y2) / 2;
            candidates.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
            return candidates[0];
        }
        return candidates[Math.floor(rng() * candidates.length)];
    };

    // 1. Entry on Start Island (Island 0) & Rainbow Escape Portal on Portal Island (last island)
    const startIsland = islands[0];
    const portalIsland = islands[islands.length - 1];
    const vaultIslands = islands.slice(1, islands.length - 1);

    const entry = pickCellInIsland(startIsland, 'left');
    markUsed(entry, 1);

    const exitPortal = pickCellInIsland(portalIsland, 'right');
    markUsed(exitPortal, 1);

    // 2. Connect ALL islands via Color-Coded Burrow Pairs!
    //    Chain: Island 0 -> Island 1 -> Island 2 -> ... -> Portal Island
    //    Plus an extra shortcut/escape burrow on multi-island floors!
    const holes = [];
    for (let i = 0; i < islands.length - 1; i++) {
        const islA = islands[i];
        const islB = islands[i + 1];
        const pal = BURROW_PALETTE[i % BURROW_PALETTE.length];

        const mouthA = pickCellInIsland(islA, 'bottom-right');
        markUsed(mouthA, 1);
        const mouthB = pickCellInIsland(islB, 'top-left');
        markUsed(mouthB, 1);

        holes.push({
            id: `hole_${i + 1}`,
            pairIndex: i,
            color: pal,
            islandA: islA.id,
            islandB: islB.id,
            a: mouthA,
            b: mouthB
        });
    }

    // Add a bonus Tactical Escape / Loop Burrow inside the biggest Vault Island (or linking Portal Island back to Start/Vault)
    if (vaultIslands.length >= 1) {
        const targetVault = vaultIslands[vaultIslands.length - 1];
        const pal = BURROW_PALETTE[holes.length % BURROW_PALETTE.length];
        const mA = pickCellInIsland(targetVault, 'left');
        markUsed(mA, 1);
        const mB = pickCellInIsland(targetVault, 'right');
        markUsed(mB, 1);
        if (mA && mB && (mA.x !== mB.x || mA.y !== mB.y)) {
            holes.push({
                id: `hole_${holes.length + 1}`,
                pairIndex: holes.length,
                color: pal,
                islandA: targetVault.id,
                islandB: targetVault.id,
                a: mA,
                b: mB
            });
        }
    }

    // 3. Place Cute Captive Pets (1 on every Vault Island!)
    //    Rescuing all captive pets unlocks the Rainbow Escape Portal!
    const captivePets = [];
    const goldenCheeses = [];
    vaultIslands.forEach((isl, idx) => {
        const petPos = pickCellInIsland(isl, 'center');
        markUsed(petPos, 1);
        const petDef = CAPTIVE_PETS[(floorNum + idx - 1) % CAPTIVE_PETS.length];
        const petObj = {
            id: `pet_${idx + 1}`,
            x: petPos.x,
            y: petPos.y,
            islandId: isl.id,
            value: 20 + Math.min(25, floorNum * 3),
            petDef
        };
        captivePets.push(petObj);
        // Keep `goldenCheeses` alias pointing to same coordinates for backwards compatibility
        goldenCheeses.push(petObj);
    });

    // 4. Secret Surprise Chest (`🎁 Сундук-Сюрприз`) on one of the islands
    const chestIsland = vaultIslands[vaultIslands.length - 1] || portalIsland;
    const chestCell = pickCellInIsland(chestIsland);
    markUsed(chestCell, 1);
    const secretChest = {
        x: chestCell.x,
        y: chestCell.y,
        islandId: chestIsland.id,
        value: 25 + floorNum * 5,
        kind: 'chest'
    };

    // 5. Shadow Hiding Cushions (`🐾 Неоновый коврик-невидимка`) — 1 per vault island
    const shadowZones = [];
    for (const isl of vaultIslands) {
        const sz = pickCellInIsland(isl);
        if (sz) {
            markUsed(sz, 0);
            shadowZones.push({ x: sz.x, y: sz.y, islandId: isl.id });
        }
    }

    // 6. Power-up Boosters (`🧥 Плащ`, `🧲 Магнит`, `⚡ Турбо`)
    const boosterTypes = [
        { type: 'cloak', label: '🧥 Плащ-невидимка', durationMs: 6500, color: 0xc084fc },
        { type: 'magnet', label: '🧲 Сырный магнит', durationMs: 8000, color: 0x38bdf8 },
        { type: 'turbo', label: '⚡ Турбо-лапки', durationMs: 6500, color: 0xfacc15 }
    ];
    const boosters = [];
    const b1Cell = pickCellInIsland(startIsland);
    if (b1Cell) {
        markUsed(b1Cell, 0);
        const bDef = boosterTypes[(floorNum - 1) % boosterTypes.length];
        boosters.push({ x: b1Cell.x, y: b1Cell.y, ...bDef });
    }
    if (vaultIslands.length >= 2) {
        const b2Cell = pickCellInIsland(vaultIslands[0]);
        if (b2Cell) {
            markUsed(b2Cell, 0);
            const bDef = boosterTypes[floorNum % boosterTypes.length];
            boosters.push({ x: b2Cell.x, y: b2Cell.y, ...bDef });
        }
    }

    // 7. Cream Cakes (`🎂 Торт`) for throwing at monsters
    const pies = [];
    const startCake = pickCellInIsland(startIsland);
    if (startCake) {
        markUsed(startCake, 0);
        pies.push(startCake);
    }
    const vaultCake = pickCellInIsland(vaultIslands[0]);
    if (vaultCake) {
        markUsed(vaultCake, 0);
        pies.push(vaultCake);
    }

    // 8. Breadcrumb Star-Cheeses (`🧀`) scattered across all islands
    const crumbs = [];
    for (const isl of islands) {
        const count = isl.role === 'vault' ? 4 : 2;
        for (let c = 0; c < count; c++) {
            const pt = pickCellInIsland(isl);
            if (pt) {
                markUsed(pt, 0);
                crumbs.push({ x: pt.x, y: pt.y, value: 3, islandId: isl.id });
            }
        }
    }

    // 9. Daughter's Hand-Drawn Monsters — 1 monster per Vault Island (plus extra on higher floors / Boss)
    const monsterPool = pickMonsterPool(floorNum);
    const baseSpeed = Math.min(205, 118 + floorNum * 7);
    const monsters = [];

    vaultIslands.forEach((isl, idx) => {
        const mKey = (isBossFloor && idx === vaultIslands.length - 1)
            ? 'count'
            : monsterPool[(idx + floorNum) % monsterPool.length];
        const mDef = HEIST_MONSTERS[mKey] || HEIST_MONSTERS.cat;

        // Build a smooth rectangular perimeter patrol loop around the vault island
        const padX1 = isl.x1 + 1 <= isl.x2 - 1 ? isl.x1 + 1 : isl.x1;
        const padX2 = isl.x2 - 1 >= isl.x1 + 1 ? isl.x2 - 1 : isl.x2;
        const padY1 = isl.y1 + 1 <= isl.y2 - 1 ? isl.y1 + 1 : isl.y1;
        const padY2 = isl.y2 - 1 >= isl.y1 + 1 ? isl.y2 - 1 : isl.y2;

        const corners = [
            { x: padX1, y: padY1, waitMs: 420 },
            { x: padX2, y: padY1, waitMs: 360 },
            { x: padX2, y: padY2, waitMs: 420 },
            { x: padX1, y: padY2, waitMs: 360 }
        ].filter(pt => grid[pt.y]?.[pt.x] === '.');

        if (corners.length >= 2) {
            monsters.push({
                id: `guard_${idx + 1}`,
                type: mDef.id,
                name: mDef.name,
                def: mDef,
                islandId: isl.id,
                speed: Math.round(baseSpeed * mDef.speedMul),
                coneRange: mDef.coneRange + Math.min(35, floorNum * 3),
                coneAngle: mDef.coneAngle,
                patrol: corners
            });
        }
    });

    // On Floor 6+, add a second patrolling guard on the largest vault island
    if (floorNum >= 6 && vaultIslands.length >= 2) {
        const bigIsl = vaultIslands[vaultIslands.length - 1];
        const mKey = monsterPool[(floorNum + 2) % monsterPool.length];
        const mDef = HEIST_MONSTERS[mKey] || HEIST_MONSTERS.ghost;
        const waypoints = [
            { x: bigIsl.x2, y: bigIsl.y1, waitMs: 450 },
            { x: bigIsl.x1, y: bigIsl.y2, waitMs: 450 }
        ].filter(pt => grid[pt.y]?.[pt.x] === '.');
        if (waypoints.length >= 2) {
            monsters.push({
                id: `guard_extra`,
                type: mDef.id,
                name: mDef.name,
                def: mDef,
                islandId: bigIsl.id,
                speed: Math.round(baseSpeed * mDef.speedMul * 0.92),
                coneRange: mDef.coneRange,
                coneAngle: mDef.coneAngle,
                patrol: waypoints
            });
        }
    }

    return {
        id: `floor_${floorNum}`,
        floor: floorNum,
        seed,
        isBossFloor,
        biome: theme,
        theme,
        title: isBossFloor
            ? `ЭТАЖ ${floorNum} • 👑 ${theme.title}`
            : `ЭТАЖ ${floorNum} • ${theme.title}`,
        subtitle: isBossFloor
            ? 'Граф Ратула охраняет пушистиков! Ныряй в норы между островами!'
            : 'Прыгай в цветные норы, чтобы перелетать с острова на остров и спасать друзей!',
        cell,
        W,
        H,
        grid: grid.map(r => r.join('')),
        islands,
        entry,
        exits: [exitPortal, { x: entry.x, y: entry.y }],
        primaryExit: exitPortal,
        holes,
        captivePets,
        goldenCheeses,
        secretChest,
        shadowZones,
        boosters,
        pies,
        crumbs,
        props: [],
        monsters
    };
}
