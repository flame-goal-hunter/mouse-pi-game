// ============================================
// BIOMES — visuals, mechanics, decorations, particles per floor
// Each biome should *feel* different — colors, atmosphere, enemy types,
// what hurts you, what you can interact with.
// ============================================

export const BIOMES = [
    // Floor 1 — Подземелье (baseline)
    {
        id: 'dungeon',
        name: 'Подземелье',
        icon: '🏰',
        ambient: 'Тёмное каменное подземелье графа',
        ambience: { baseFreq: 48, padFreq: 144, vol: 0.10 },
        floorColorA: 0x221333, floorColorB: 0x281838,
        gridColor:   0x120820,
        wallFill:    0x2a1a3e, wallShadow: 0x120818, wallHighlight: 0x3e2a56,
        // Warm gothic: violet stone, amber torch pools; darkest of the "normal" floors
        darknessColor: 0x171033, darknessAlpha: 0.30,
        decorWeights: [
            { type: 'mushroom', w: 3 },
            { type: 'bone',     w: 3 },
            { type: 'cobweb',   w: 1 },
            { type: 'skull',    w: 2 },
            { type: 'chain',    w: 1 }
        ],
        enemyWeights: { zombie: 2, cat: 1, slime: 1, bat: 0 },
        mechanic: null,
        hazardTile: null,
        particles: { type: 'drip', color: 0x80a0c0, count: 6, riseSpeed: -50 },
        roomConfig: { targetCount: 10, minSize: 280, maxSize: 480, pad: 90 },
        // Stealth: gentle intro on floor 1+. Only sleeping zombies have cones.
        coneEnemyKinds: ['zombie'],
        stealthRoomsPerFloor: 1,
        stealthFlavor: 'sleeper',
        enemyDensityMul: 1.0,
        ambientCloud: null,
        bgm: 'bgm:dungeon'
    },
    // Floor 2 — Кухня графа (cherry warm tile + chef shenanigans)
    {
        id: 'kitchen',
        name: 'Кухня графа',
        icon: '🍳',
        ambient: 'Жаркая кухня — пар, плиты, разбитая посуда',
        ambience: { baseFreq: 62, padFreq: 186, vol: 0.085 },
        floorColorA: 0x2c1a12, floorColorB: 0x321e14,
        gridColor:   0x1a0c06,
        wallFill:    0x4a3020, wallShadow: 0x1a0c04, wallHighlight: 0x6a4828,
        // Warm orange tinted darkness — kitchen feel
        darknessColor: 0x35200f, darknessAlpha: 0.30,
        decorWeights: [
            { type: 'pot',     w: 3 },
            { type: 'plate',   w: 3 },
            { type: 'knife',   w: 1 },
            { type: 'sack',    w: 3 },   // shootable flour sack — kitchen rebuild
            { type: 'flourCloud', w: 0 } // dynamic spawn from sack hit, not random decor
        ],
        enemyWeights: { zombie: 0, cat: 1, chef: 3, slime: 0, bat: 1 },  // signature Chef-cat
        mechanic: 'butter',
        hazardTile: 'hotpan',
        particles: { type: 'steam', color: 0xe8d8c0, count: 14, riseSpeed: 32 },
        roomConfig: { targetCount: 10, minSize: 320, maxSize: 540, pad: 110 },
        // Stealth: chef turns periodically — timed window
        coneEnemyKinds: ['chef'],
        stealthRoomsPerFloor: 1,
        stealthFlavor: 'chef-timed',
        enemyDensityMul: 0.95,
        ambientCloud: { type: 'steam', color: 0xe0e0e0, slowFactor: 0.85, intervalMs: [3500, 5500] },
        bgm: 'bgm:kitchen'
    },
    // Floor 3 — Библиотека (dedicated stealth floor, but BALANCED)
    {
        id: 'library',
        name: 'Библиотека',
        icon: '📚',
        ambient: 'Полки до потолка, шёпот призраков, парящие свитки',
        ambience: { baseFreq: 55, padFreq: 220, vol: 0.075 },
        floorColorA: 0x14122a, floorColorB: 0x181632,
        gridColor:   0x0a0818,
        wallFill:    0x4a2a14, wallShadow: 0x1a0a02, wallHighlight: 0x6a3a1c,
        // Cool blue-black tinted darkness — library feel
        darknessColor: 0x1b1b3a, darknessAlpha: 0.34,
        decorWeights: [
            { type: 'book',      w: 5 },
            { type: 'scroll',    w: 3 },
            { type: 'inkwell',   w: 2 },
            { type: 'bookshelf', w: 4 },
            { type: 'candle',    w: 2 },
            { type: 'forbiddenBook', w: 0 } // dynamic spawn — 3 per floor in stealth rooms
        ],
        enemyWeights: { librarian: 3, bat: 1 },  // Librarian has cone, bat does NOT
        mechanic: null,
        hazardTile: null,
        particles: { type: 'dust', color: 0xc0c0e0, count: 18, riseSpeed: 12 },
        // Smaller library: 1 wide nave + 4-6 alcoves
        roomConfig: { targetCount: 11, minSize: 260, maxSize: 420, pad: 80 },
        // Library = dedicated stealth biome — multiple rooms, librarian gets cones
        coneEnemyKinds: ['librarian'],
        stealthRoomsPerFloor: 3,
        stealthFlavor: 'reader-patrol',
        enemyDensityMul: 0.55,
        ambientCloud: null,
        bgm: 'bgm:library'
    },
    // Floor 4 — Зимний сад
    {
        id: 'garden',
        name: 'Зимний сад',
        icon: '🌿',
        ambient: 'Лунный сад с лозами и хищными цветами',
        ambience: { baseFreq: 58, padFreq: 196, vol: 0.07 },
        floorColorA: 0x10222e, floorColorB: 0x142836,
        gridColor:   0x081418,
        wallFill:    0x1a4438, wallShadow: 0x0a1c14, wallHighlight: 0x305840,
        // Moonlit blue darkness — the one cool floor (accent from the "Лунная ночь" mockup)
        darknessColor: 0x1a2744, darknessAlpha: 0.35,
        decorWeights: [
            { type: 'moonflower', w: 3 },
            { type: 'glowpod',    w: 2 },
            { type: 'hedge_tuft', w: 3 },
            { type: 'lilypad',    w: 1 },
            { type: 'flower',     w: 2 },
            { type: 'vine',       w: 1 }
        ],
        enemyWeights: { cat: 1, slime: 1, bat: 1, snapdragon: 3 },  // signature snapdragon
        mechanic: 'vines',
        hazardTile: 'thorn',
        particles: { type: 'pollen', color: 0xffb0e0, count: 14, riseSpeed: 6 },
        roomConfig: { targetCount: 12, minSize: 320, maxSize: 500, pad: 100 },
        // Garden stealth: snapdragons have arc-sweep cone
        coneEnemyKinds: ['snapdragon'],
        stealthRoomsPerFloor: 2,
        stealthFlavor: 'flower-arc',
        enemyDensityMul: 0.7,
        ambientCloud: { type: 'pollen', color: 0xd0ff80, slowFactor: 0.85, intervalMs: [4000, 7000] },
        bgm: 'bgm:garden'
    },
    // Floor 5 — Тронный зал
    {
        id: 'throne',
        name: 'Тронный зал',
        icon: '👑',
        ambient: 'Тронный зал графа Ратулы. Бабушка здесь!',
        ambience: { baseFreq: 41, padFreq: 123, vol: 0.12 },
        floorColorA: 0x1c0a16, floorColorB: 0x261020,
        gridColor:   0x0a0208,
        wallFill:    0x4a0a18, wallShadow: 0x180408, wallHighlight: 0x7a1830,
        // Crimson-tinted darkness — throne feel
        darknessColor: 0x2e1420, darknessAlpha: 0.46,
        decorWeights: [
            { type: 'goblet',     w: 3 },
            { type: 'bone',       w: 2 },
            { type: 'redCarpet',  w: 2 },
            { type: 'chain',      w: 1 },
            { type: 'candelabra', w: 0 }  // 4 placed explicitly in arena
        ],
        enemyWeights: { bat: 3, skeleton: 2 },  // boss arena: bats + skeletons
        mechanic: null,
        hazardTile: null,
        particles: { type: 'embers', color: 0xff6020, count: 12, riseSpeed: 25 },
        roomConfig: { targetCount: 7, minSize: 340, maxSize: 600, pad: 120 },   // unused: generateThrone builds its own spine
        // Throne is boss focus, optional one stealth room
        coneEnemyKinds: ['skeleton'],
        stealthRoomsPerFloor: 1,
        stealthFlavor: 'bat-patrol',
        enemyDensityMul: 0.6,
        ambientCloud: null,
        bgm: 'bgm:throne'
    }
];

// Floors 1-5 are the story's fixed tour of the castle. Past that the descent picks
// its own order — a strict modulo meant floor 26 was floor 1 exactly, and an endless
// run was five maps on a loop forever. Deterministic per floor so every call inside
// one floor agrees.
export function biomeForFloor(floor) {
    if (floor <= BIOMES.length) return BIOMES[(floor - 1) % BIOMES.length] || BIOMES[0];
    let h = Math.imul(floor ^ 0x9e3779b9, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    const prev = (floor - 2) % BIOMES.length;          // what the previous floor showed
    let idx = Math.abs(h) % BIOMES.length;
    if (idx === prev) idx = (idx + 1) % BIOMES.length;  // never the same place twice running
    return BIOMES[idx] || BIOMES[0];
}

// Endless-only run modifiers. From floor 6 every other floor carries one, so the
// descent has texture instead of only bigger numbers.
export const FLOOR_MODIFIERS = [
    { id: 'feast',   name: 'ПИР',          desc: 'Всюду больше сыра' },
    { id: 'crowd',   name: 'ТОЛПА',        desc: 'Врагов больше, но они слабее' },
    { id: 'dark',    name: 'ГЛУХАЯ НОЧЬ',  desc: 'Темнее обычного' },
    { id: 'swift',   name: 'СКОЛЬЗКИЙ ПОЛ', desc: 'Все двигаются быстрее' },
    { id: 'quiet',   name: 'ТИШИНА',       desc: 'Враги слышат лучше, сундуки богаче' }
];

export function modifierForFloor(floor, mode) {
    if (mode !== 'endless' || floor < 6 || floor % 2 !== 0) return null;
    let h = floor * 0x9e3779b1;
    h ^= h >>> 16; h = Math.imul(h, 0x21f0aaad);
    h ^= h >>> 15; h = Math.imul(h, 0x735a2d97);
    h ^= h >>> 15;
    return FLOOR_MODIFIERS[Math.abs(h) % FLOOR_MODIFIERS.length];
}

// Pick weighted random key from {key: weight} map
export function weightedPick(weights) {
    const entries = Object.entries(weights).filter(([_, w]) => w > 0);
    if (entries.length === 0) return null;
    let total = 0;
    for (const [, w] of entries) total += w;
    let roll = Math.random() * total;
    for (const [key, w] of entries) {
        roll -= w;
        if (roll <= 0) return key;
    }
    return entries[entries.length - 1][0];
}

// Pick a weighted decoration type from list of {type, w}
export function pickDecor(list) {
    if (!list || list.length === 0) return null;
    const filtered = list.filter(d => d.w > 0);
    if (filtered.length === 0) return null;
    let total = 0;
    for (const d of filtered) total += d.w;
    let roll = Math.random() * total;
    for (const d of filtered) {
        roll -= d.w;
        if (roll <= 0) return d.type;
    }
    return filtered[filtered.length - 1].type;
}
