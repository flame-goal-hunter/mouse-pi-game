// ============================================================================
// ProceduralHeistGenerator.js — «Тихая Лапка: Том и Джерри в Замке Теней!»
//
// Two-Layer Cutaway («Двухуровневый мир в разрезе: Над полом + Подземная Норка»)
//
// Psychological Pillars for a 10-year-old:
// 1. Cozy Sanctuary vs. Giant Monster World («Домик под одеялом»):
//    - UPPER LAYER (Rows 2..12): The grand Castle Halls where the daughter's
//      hand-drawn monsters patrol, guarding Giant Cheeses, Golden Keys, and
//      Captive Pet Friends.
//    - CUTAWAY FLOOR SLAB (Rows 13..14): Cross-section floorboards, stone beams,
//      and vertical Burrow Chutes connecting the rooms above to the tunnels below.
//      Monsters walking above shake dust & footstep ripples through the ceiling!
//    - UNDERGROUND BURROW LAYER (Rows 15..20): Warm, root-lined subterranean
//      tunnels with Pi's Cozy Home Nest (sofa, fairy lights, growing treasure
//      pile), secret crystal pockets, and Underground Sabotage Levers that drop
//      chandelier cakes or disable laser gates in the room above!
// 2. The "Tom & Jerry" Grab-and-Dash Loop («Утащи добычу в свою норку!»):
//    - Pi grabs a Giant Prize (Royal Cheese Wheel, Crown, Captive Pet) in the
//      upper room and dashes for the nearest baseboard Mouse-Hole!
//    - Diving into the mouse-hole while a monster chases you makes the monster
//      CRASH into the wall above the hole («БАМ! 💫 НЕ ДОГНАЛ!») with spinning
//      stars!
// 3. 4 Distinct Mission Archetypes (No repetitive levels!):
//    - Mission A: «Охота за Королевским Сыром» (Grab & haul giant cheeses home)
//    - Mission B: «Секретный Ключ Стража» (Steal the key, unlock cages & vaults)
//    - Mission C: «Подземный Саботаж» (Pull underground levers to drop cakes & open laser gates)
//    - Mission D: «Большой Побег Друзей» (Rescue multiple captive pets across locked wings)
// ============================================================================

export const HEIST_THEMES = [
    {
        id: 'royal_kitchen',
        name: 'Сырная Кухня Графа',
        subtitle: 'Утащи гигантские сыры и друзей с хозяйского стола прямо в норку!',
        icon: '🧀',
        wallTop: 0x3b1d5e,
        wallBot: 0x24103d,
        floorMain: 0x4c2878,
        floorChecker: 0x5b328f,
        carpetColor: 0xbe185d,
        carpetTrim: 0xfbbf24,
        beamColor: 0x78350f,
        earthTop: 0x5c2d16,
        earthBot: 0x3b1a0b,
        tunnelFloor: 0x7c3f1d,
        tunnelGlow: 0xf59e0b,
        bgm: 'bgm_sneak'
    },
    {
        id: 'velvet_gallery',
        name: 'Бархатная Сокровищница',
        subtitle: 'Проберись под полом, отключи охранные лучи и утащи реликвии!',
        icon: '👑',
        wallTop: 0x1e295b,
        wallBot: 0x111936,
        floorMain: 0x1e3a6e,
        floorChecker: 0x254885,
        carpetColor: 0x9333ea,
        carpetTrim: 0x38bdf8,
        beamColor: 0x475569,
        earthTop: 0x4a2511,
        earthBot: 0x2d1508,
        tunnelFloor: 0x6b3619,
        tunnelGlow: 0x38bdf8,
        bgm: 'bgm_sneak_library'
    },
    {
        id: 'clockwork_nursery',
        name: 'Игрушечный Чердак',
        subtitle: 'Спаси пушистиков из клеток и обхитри стражей через подземные лазы!',
        icon: '🧸',
        wallTop: 0x4a1d46,
        wallBot: 0x2d0f2b,
        floorMain: 0x63265f,
        floorChecker: 0x783073,
        carpetColor: 0x0d9488,
        carpetTrim: 0xfde047,
        beamColor: 0x854d0e,
        earthTop: 0x572814,
        earthBot: 0x361709,
        tunnelFloor: 0x78391d,
        tunnelGlow: 0xf472b6,
        bgm: 'bgm_sneak'
    },
    {
        id: 'crystal_banquet',
        name: 'Хрустальный Банкетный Зал',
        subtitle: 'Дёргай подземные рычаги в норке, чтобы сбрасывать торты на монстров!',
        icon: '🎂',
        wallTop: 0x133840,
        wallBot: 0x0a2126,
        floorMain: 0x164e59,
        floorChecker: 0x1c6270,
        carpetColor: 0xe11d48,
        carpetTrim: 0xfef08a,
        beamColor: 0x64748b,
        earthTop: 0x4d2612,
        earthBot: 0x2b1408,
        tunnelFloor: 0x6e371b,
        tunnelGlow: 0x34d399,
        bgm: 'bgm_sneak_cellar'
    }
];

export const MISSION_TYPES = [
    {
        id: 'cheese_feast',
        badge: '🧀 ОПЕРАЦИЯ: СЫРНЫЙ ПИР',
        title: 'Утащи всю добычу в Уютную Норку!',
        hint: 'Хватай Большой Сыр и друзей наверху и ныряй с ними в ближайшую норку! Погоня врежется в стену — БАМ! 💫'
    },
    {
        id: 'key_rescue',
        badge: '🗝️ ОПЕРАЦИЯ: ЗОЛОТОЙ КЛЮЧ',
        title: 'Найди Ключ Стража и открой клетки!',
        hint: 'Некоторые клетки заперты на замок 🔒! Вынырни из норки возле Золотого Ключа 🗝️, открой клетку и беги в норку!'
    },
    {
        id: 'underground_sabotage',
        badge: '⚡ ОПЕРАЦИЯ: ПОДЗЕМНЫЙ САБОТАЖ',
        title: 'Дёргай рычаги в норке и сбрасывай торты!',
        hint: 'В подземной норке есть Рычаги ⚡ — они отключают лазеры наверху и роняют кремовые торты прямо на головы монстрам!'
    },
    {
        id: 'grand_rescue',
        badge: '🐾 ОПЕРАЦИЯ: БОЛЬШОЙ ПОБЕГ',
        title: 'Спаси всех пушистиков в свой подземный домик!',
        hint: 'Слушай шаги монстров над потолком норки (ТОП-ТОП), выскакивай из люков за их спиной и уводи друзей в норку!'
    }
];

export const CAPTIVE_PETS = [
    { id: 'mimi',   name: 'Мышка Мими',      badge: '🎀', color: 0xf472b6, spriteKey: 'skin_pink',        bonusText: '+10% к скорости' },
    { id: 'bublik', name: 'Хомячок Бублик',  badge: '🧁', color: 0xfbbf24, spriteKey: 'skin_bear',        bonusText: '+25% сыра за добычу' },
    { id: 'cloud',  name: 'Котёнок Облачко', badge: '☁️', color: 0x38bdf8, spriteKey: 'skin_kitty',       bonusText: 'Тихие лапки (-20% шума)' },
    { id: 'star',   name: 'Бобрик Боб',      badge: '🪵', color: 0xd97706, spriteKey: 'skin_beaver',      bonusText: 'Крепкая каска (+щит)' },
    { id: 'spark',  name: 'Лягушонок Прыг',  badge: '🐸', color: 0x4ade80, spriteKey: 'skin_frog',        bonusText: 'Быстрый кувырок' }
];

export const CARRY_TREASURES = [
    { id: 'giant_cheese', name: 'Королевский Сыр',  icon: '🧀', value: 25, weightMul: 0.88, tint: 0xfacc15 },
    { id: 'berry_cake',   name: 'Праздничный Торт', icon: '🎂', value: 30, weightMul: 0.86, tint: 0xf472b6 },
    { id: 'gold_crown',   name: 'Корона Графа',     icon: '👑', value: 35, weightMul: 0.90, tint: 0xfde047 },
    { id: 'honey_jar',    name: 'Горшочек Мёда',    icon: '🍯', value: 28, weightMul: 0.88, tint: 0xf59e0b }
];

const MONSTER_POOL = [
    {
        type: 'zombie',
        spriteKey: 'd_zombie',
        name: 'Сонный Зомби',
        minFloor: 1,
        speed: 50,
        chaseSpeed: 84,
        coneLen: 155,
        coneHalfRad: 0.44,
        hearRadius: 150,
        scale: 0.31,
        footstepWeight: 1.1
    },
    {
        type: 'slime',
        spriteKey: 'd_slime',
        name: 'Желейный Слайм',
        minFloor: 1,
        speed: 44,
        chaseSpeed: 76,
        coneLen: 135,
        coneHalfRad: 0.50,
        hearRadius: 135,
        scale: 0.32,
        footstepWeight: 0.9
    },
    {
        type: 'cat',
        spriteKey: 'd_cat',
        name: 'Кошка-Ищейка',
        minFloor: 1,
        speed: 66,
        chaseSpeed: 102,
        coneLen: 175,
        coneHalfRad: 0.40,
        hearRadius: 195,
        scale: 0.32,
        footstepWeight: 0.8
    },
    {
        type: 'skeleton',
        spriteKey: 'd_skeleton',
        name: 'Скелет-Часовой',
        minFloor: 2,
        speed: 60,
        chaseSpeed: 94,
        coneLen: 170,
        coneHalfRad: 0.42,
        hearRadius: 170,
        scale: 0.32,
        footstepWeight: 1.0
    },
    {
        type: 'count',
        spriteKey: 'd_count',
        name: 'Граф Теней',
        minFloor: 2,
        speed: 68,
        chaseSpeed: 106,
        coneLen: 190,
        coneHalfRad: 0.42,
        hearRadius: 190,
        scale: 0.30,
        footstepWeight: 1.25
    },
    {
        type: 'ghost',
        spriteKey: 'd_ghost',
        name: 'Призрак Замка',
        minFloor: 3,
        speed: 58,
        chaseSpeed: 90,
        coneLen: 165,
        coneHalfRad: 0.46,
        hearRadius: 165,
        scale: 0.31,
        footstepWeight: 0.6
    },
    {
        type: 'bat',
        spriteKey: 'd_bat',
        name: 'Ночной Нетопырь',
        minFloor: 3,
        speed: 74,
        chaseSpeed: 110,
        coneLen: 165,
        coneHalfRad: 0.42,
        hearRadius: 210,
        scale: 0.32,
        footstepWeight: 0.5
    }
];

function createRng(seed) {
    let s = (seed >>> 0) || 123456789;
    return function rng() {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Generates a Two-Layer Cutaway («Том и Джерри / Муравьиная ферма») level:
 * - Upper Layer (y: 2..11): 2 to 3 Castle Rooms separated by walls or laser gates,
 *   patrolled by the daughter's monsters, holding Carryable Prizes & Captive Pets.
 * - Cutaway Floor Slab (y: 12..13): Solid cross-section floor beam pierced by
 *   3 to 5 Vertical Burrow Chutes (`chutes`) with baseboard archways at the top
 *   and tunnel openings at the bottom.
 * - Underground Burrow Layer (y: 14..18): Continuous subterranean tunnel network
 *   with Pi's Cozy Home Sanctuary (`homeNest`) on the left, secret alcoves,
 *   spring mushrooms, and Underground Sabotage Levers (`sabotageLevers`).
 */
export function generateHeistFloor(floorNumber = 1, customSeed = null) {
    const floor = Math.max(1, floorNumber | 0);
    const seed = customSeed || Math.floor(Date.now() % 100000000) + floor * 9973;
    const rng = createRng(seed);

    const theme = HEIST_THEMES[(floor - 1) % HEIST_THEMES.length];

    // Pick mission type so consecutive floors always feel fresh
    const missionIndex = (floor - 1) % MISSION_TYPES.length;
    const mission = MISSION_TYPES[missionIndex];

    const cell = 48;
    const W = Math.min(34, 26 + Math.min(8, Math.floor((floor - 1) * 1.5)));
    const H = 20;

    // Grid legend:
    // '#' = solid wall / earth / floor slab
    // '.' = upper castle room walkable floor
    // 'U' = underground burrow walkable tunnel
    // 'C' = vertical burrow chute connecting upper room & underground tunnel
    const grid = Array.from({ length: H }, () => Array(W).fill('#'));

    const upperY1 = 2;
    const upperY2 = 11;
    const slabY1 = 12;
    const slabY2 = 13;
    const burrowY1 = 14;
    const burrowY2 = 17;

    // 1. Carve Upper Castle Rooms (2 or 3 distinct halls with doorways or laser gates)
    const numRooms = floor === 1 ? 2 : (floor <= 3 ? 3 : 3);
    const rooms = [];
    const totalInnerW = W - 4;
    const roomStep = Math.floor(totalInnerW / numRooms);

    for (let i = 0; i < numRooms; i++) {
        const rx1 = 2 + i * roomStep + (i > 0 ? 1 : 0);
        const rx2 = (i === numRooms - 1) ? (W - 3) : (2 + (i + 1) * roomStep - 1);
        const ry1 = upperY1 + (i % 2 === 1 && rng() > 0.5 ? 1 : 0);
        const ry2 = upperY2;
        rooms.push({ id: i, x1: rx1, y1: ry1, x2: rx2, y2: ry2 });

        for (let y = ry1; y <= ry2; y++) {
            for (let x = rx1; x <= rx2; x++) {
                grid[y][x] = '.';
            }
        }
    }

    // Connect adjacent upper rooms via a hallway door (some guarded by laser barriers!)
    const laserGates = [];
    for (let i = 0; i < rooms.length - 1; i++) {
        const leftR = rooms[i];
        const rightR = rooms[i + 1];
        const wallX = leftR.x2 + 1;
        const doorY = Math.floor((Math.max(leftR.y1, rightR.y1) + Math.min(leftR.y2, rightR.y2)) / 2);

        // Carve doorway between rooms
        for (let dy = -1; dy <= 1; dy++) {
            const y = Math.max(upperY1 + 1, Math.min(upperY2 - 1, doorY + dy));
            for (let x = leftR.x2; x <= rightR.x1; x++) {
                grid[y][x] = '.';
            }
        }

        // On floors with sabotage or later floors, put a toggleable laser gate on the doorway
        // so diving into the burrow below is the smartest way around (or you can flip the underground lever!)
        if (mission.id === 'underground_sabotage' || i === 1 || floor >= 2) {
            laserGates.push({
                id: `gate_${i}`,
                gx: wallX,
                gy1: doorY - 1,
                gy2: doorY + 1,
                x: (wallX + 0.5) * cell,
                y1: (doorY - 1) * cell,
                y2: (doorY + 2) * cell,
                active: true,
                color: i === 0 ? 0xf43f5e : 0x38bdf8
            });
        }
    }

    // Add a couple of decorative pillars / tables inside wide upper rooms (for line-of-sight stealth)
    const pillars = [];
    rooms.forEach((r, idx) => {
        const rw = r.x2 - r.x1 + 1;
        if (rw >= 7) {
            const px = Math.floor((r.x1 + r.x2) / 2);
            const py = Math.floor((r.y1 + r.y2) / 2) - 1;
            grid[py][px] = '#';
            pillars.push({ gx: px, gy: py, x: (px + 0.5) * cell, y: (py + 0.5) * cell, roomIdx: idx });
        }
    });

    // 2. Carve the Underground Burrow Network (Rows 14..17)
    // Main horizontal burrow highway + cozy alcoves
    for (let x = 2; x <= W - 3; x++) {
        // Gentle organic wave in the tunnel height
        const wave = (x % 7 >= 3 && x % 7 <= 5) ? 1 : 0;
        const ty1 = burrowY1 + wave;
        const ty2 = Math.min(burrowY2, ty1 + 2);
        for (let y = ty1; y <= ty2; y++) {
            grid[y][x] = 'U';
        }
    }
    // Ensure continuous horizontal connectivity across rows 15..16
    for (let x = 2; x <= W - 3; x++) {
        grid[15][x] = 'U';
        grid[16][x] = 'U';
    }
    // Cozy Home Sanctuary on the bottom-left (x: 2..6, y: 14..17)
    for (let y = 14; y <= 17; y++) {
        for (let x = 2; x <= 6; x++) {
            grid[y][x] = 'U';
        }
    }

    const homeNest = {
        gx: 4,
        gy: 16,
        x: 4.5 * cell,
        y: 16.0 * cell,
        radius: 78
    };

    // 3. Carve Vertical Burrow Chutes (`chutes`) connecting Upper Rooms <-> Underground Burrow
    // At least 1 or 2 chutes per room so Pi always has exciting mouse-holes to dive into & pop out of!
    const chutes = [];
    const burrowHoles = [];
    const CHUTE_COLORS = [
        { name: 'Янтарный лаз', hex: 0xf59e0b, css: '#f59e0b' },
        { name: 'Изумрудный лаз', hex: 0x10b981, css: '#10b981' },
        { name: 'Розовый лаз', hex: 0xf472b6, css: '#f472b6' },
        { name: 'Сапфировый лаз', hex: 0x38bdf8, css: '#38bdf8' },
        { name: 'Фиолетовый лаз', hex: 0xa855f7, css: '#a855f7' }
    ];

    const chuteXs = [];
    rooms.forEach((r, rIdx) => {
        const rw = r.x2 - r.x1 + 1;
        if (rIdx === 0) {
            // Chute 0 right above Home Nest
            chuteXs.push({ gx: Math.min(r.x2 - 1, r.x1 + 2), roomIdx: rIdx });
            if (rw >= 8) {
                chuteXs.push({ gx: r.x2 - 1, roomIdx: rIdx });
            }
        } else {
            const leftX = r.x1 + 1;
            const rightX = r.x2 - 1;
            chuteXs.push({ gx: leftX, roomIdx: rIdx });
            if (rightX - leftX >= 4) {
                chuteXs.push({ gx: rightX, roomIdx: rIdx });
            }
        }
    });

    chuteXs.forEach((info, idx) => {
        const gx = info.gx;
        const topGy = upperY2;      // Row 11 (bottom edge of upper room, right by the floor/baseboard)
        const botGy = 15;           // Row 15 (inside underground tunnel)
        const palette = CHUTE_COLORS[idx % CHUTE_COLORS.length];

        // Carve the vertical chute through the floor slab (rows 11..15)
        for (let y = topGy; y <= botGy + 1; y++) {
            if (y >= slabY1 && y <= slabY2) {
                grid[y][gx] = 'C';
            } else if (y > slabY2) {
                grid[y][gx] = 'U';
            } else {
                grid[y][gx] = '.';
            }
        }

        const chute = {
            id: `chute_${idx}`,
            index: idx,
            roomIdx: info.roomIdx,
            gx,
            topGy,
            botGy,
            topX: (gx + 0.5) * cell,
            topY: (topGy + 0.35) * cell,
            botX: (gx + 0.5) * cell,
            botY: (botGy + 0.5) * cell,
            colorHex: palette.hex,
            colorCss: palette.css,
            label: `${idx + 1}`
        };
        chutes.push(chute);

        burrowHoles.push({
            id: chute.id,
            pairId: idx,
            label: chute.label,
            colorName: palette.name,
            colorHex: palette.hex,
            colorCss: palette.css,
            gx: chute.gx,
            gy: chute.topGy,
            x: chute.topX,
            y: chute.topY,
            botX: chute.botX,
            botY: chute.botY,
            islandId: info.roomIdx
        });
    });

    // 4. Spawn Big Carryable Prizes & Captive Pets in the Upper Rooms
    // Everything collected in the upper room can be hauled back into ANY mouse-hole
    // (which sends it down the chute into Pi's Cozy Home Nest!).
    const carryables = [];
    const captivePets = [];
    let needKeyLock = (mission.id === 'key_rescue' || floor >= 2);
    let keySpawned = false;
    let goldenKey = null;

    // Place 1 Captive Pet + 1..2 Giant Carryable Treasures per room
    rooms.forEach((r, rIdx) => {
        const midX = Math.floor((r.x1 + r.x2) / 2);
        const topRowY = r.y1 + 1;
        const midRowY = Math.floor((r.y1 + r.y2) / 2);

        if (rIdx === 0) {
            // First room: 1 easy Giant Cheese right near the first chute so the player immediately experiences Grab -> Dive into Burrow!
            const tCfg = CARRY_TREASURES[(floor + rIdx) % CARRY_TREASURES.length];
            const tx = Math.min(r.x2 - 1, r.x1 + 4);
            const ty = topRowY + 1;
            grid[ty][tx] = '.';
            carryables.push({
                id: `prize_r0`,
                kind: 'treasure',
                ...tCfg,
                gx: tx,
                gy: ty,
                x: (tx + 0.5) * cell,
                y: (ty + 0.5) * cell,
                locked: false,
                delivered: false
            });
        } else {
            // Room 1..N: 1 Captive Pet Friend + 1 Giant Treasure
            const petCfg = CAPTIVE_PETS[(floor + rIdx - 1) % CAPTIVE_PETS.length];
            const px = Math.max(r.x1 + 1, Math.min(r.x2 - 1, midX + 1));
            const py = topRowY;
            grid[py][px] = '.';

            const isLocked = needKeyLock && (rIdx === rooms.length - 1);
            captivePets.push({
                id: `pet_${rIdx}`,
                ...petCfg,
                gx: px,
                gy: py,
                x: (px + 0.5) * cell,
                y: (py + 0.5) * cell,
                islandId: rIdx,
                locked: isLocked,
                rescued: false
            });

            // Also place a Giant Carryable Treasure in this room
            const tCfg = CARRY_TREASURES[(floor + rIdx) % CARRY_TREASURES.length];
            const tx = Math.max(r.x1 + 1, px - 2);
            const ty = Math.min(r.y2 - 2, midRowY);
            grid[ty][tx] = '.';
            carryables.push({
                id: `prize_${rIdx}`,
                kind: 'treasure',
                ...tCfg,
                gx: tx,
                gy: ty,
                x: (tx + 0.5) * cell,
                y: (ty + 0.5) * cell,
                locked: false,
                delivered: false
            });

            if (isLocked && !keySpawned) {
                keySpawned = true;
                // Spawn Golden Key in an earlier room (or opposite corner)
                const keyRoom = rooms[Math.max(0, rIdx - 1)];
                const kx = Math.floor((keyRoom.x1 + keyRoom.x2) / 2);
                const ky = keyRoom.y1 + 1;
                grid[ky][kx] = '.';
                goldenKey = {
                    id: 'golden_key',
                    gx: kx,
                    gy: ky,
                    x: (kx + 0.5) * cell,
                    y: (ky + 0.5) * cell,
                    collected: false
                };
            }
        }
    });

    // Ensure at least 1 captive pet on floor 1 too so rescuing friends is always part of the joy
    if (captivePets.length === 0) {
        const rLast = rooms[rooms.length - 1];
        const petCfg = CAPTIVE_PETS[(floor - 1) % CAPTIVE_PETS.length];
        const px = Math.floor((rLast.x1 + rLast.x2) / 2);
        const py = rLast.y1 + 1;
        grid[py][px] = '.';
        captivePets.push({
            id: 'pet_main',
            ...petCfg,
            gx: px,
            gy: py,
            x: (px + 0.5) * cell,
            y: (py + 0.5) * cell,
            islandId: rooms.length - 1,
            locked: false,
            rescued: false
        });
    }

    // 5. Spawn Underground Sabotage Levers & Ceiling Cake Traps!
    // Pulling a lever in the underground burrow disables laser gates AND drops a giant cream cake
    // from the ceiling in the room above, stunning any monster nearby!
    const sabotageLevers = [];
    rooms.forEach((r, rIdx) => {
        if (rIdx === 0 && rooms.length > 2) return;
        const lx = Math.floor((r.x1 + r.x2) / 2);
        const ly = 16;
        grid[ly][lx] = 'U';
        sabotageLevers.push({
            id: `lever_${rIdx}`,
            roomIdx: rIdx,
            gx: lx,
            gy: ly,
            x: (lx + 0.5) * cell,
            y: (ly + 0.5) * cell,
            trapTargetX: (lx + 0.5) * cell,
            trapTargetY: Math.floor((r.y1 + r.y2) / 2 + 0.5) * cell,
            used: false
        });
    });

    // 6. Spawn Small Cheese Crumbs (both in upper rooms AND in underground crystal pockets!)
    const cheeses = [];
    rooms.forEach((r) => {
        for (let i = 0; i < 4; i++) {
            const cx = r.x1 + 1 + Math.floor(rng() * Math.max(1, r.x2 - r.x1 - 1));
            const cy = r.y1 + 1 + Math.floor(rng() * Math.max(1, r.y2 - r.y1 - 1));
            if (grid[cy][cx] === '.') {
                cheeses.push({
                    x: (cx + 0.5) * cell,
                    y: (cy + 0.5) * cell,
                    layer: 'upper',
                    value: 3
                });
            }
        }
    });
    // Underground tunnel bonus cheeses
    for (let x = 7; x <= W - 4; x += 3) {
        cheeses.push({
            x: (x + 0.5) * cell,
            y: 15.5 * cell,
            layer: 'burrow',
            value: 4
        });
    }

    // 7. Spawn Velvet Shadow Cushions in Upper Rooms
    const shadowZones = [];
    rooms.forEach((r) => {
        const sx = r.x1 + 1;
        const sy = r.y1 + 2;
        if (grid[sy]?.[sx] === '.') {
            shadowZones.push({
                gx: sx,
                gy: sy,
                x: (sx + 0.5) * cell,
                y: (sy + 0.5) * cell,
                r: cell * 0.82
            });
        }
    });

    // 8. Spawn Boosters (1 in upper room, 1 in underground burrow alcove)
    const boosters = [
        {
            type: 'turbo',
            name: 'Реактивные Кеды',
            icon: '⚡',
            durationMs: 7000,
            color: 0xfacc15,
            x: ( Math.min(W - 4, 9) + 0.5 ) * cell,
            y: 16.2 * cell
        },
        {
            type: 'cloak',
            name: 'Звёздный Плащ-Невидимка',
            icon: '🌟',
            durationMs: 6500,
            color: 0xa855f7,
            x: (Math.floor((rooms[rooms.length - 1].x1 + rooms[rooms.length - 1].x2) / 2) + 0.5) * cell,
            y: (rooms[rooms.length - 1].y2 - 1.5) * cell
        }
    ];

    // 9. Spawn Daughter's Hand-Drawn Monsters in Upper Rooms
    // Monsters ONLY patrol the Upper Castle Rooms — they CANNOT fit inside the underground burrow!
    const eligiblePool = MONSTER_POOL.filter(m => m.minFloor <= floor);
    const speedScale = 1 + Math.min(0.32, (floor - 1) * 0.045);
    const monsters = [];

    rooms.forEach((r, rIdx) => {
        // Room 0 has 1 gentle monster on patrol away from the home chute; later rooms have 1..2 monsters
        const countInRoom = (rIdx === 0) ? 1 : (floor >= 3 && rIdx === rooms.length - 1 ? 2 : 1);
        for (let m = 0; m < countInRoom; m++) {
            const template = eligiblePool[Math.floor(rng() * eligiblePool.length)];
            const wy = Math.min(r.y2 - 1, r.y1 + 2 + m * 3);
            const wx1 = Math.max(r.x1 + 1, rIdx === 0 ? r.x1 + 3 : r.x1 + 1);
            const wx2 = Math.max(wx1 + 2, r.x2 - 1);

            // Clear patrol line of pillars
            for (let x = wx1; x <= wx2; x++) {
                if (grid[wy][x] === '#') grid[wy][x] = '.';
            }

            const waypoints = [
                { x: (wx1 + 0.5) * cell, y: (wy + 0.5) * cell },
                { x: (wx2 + 0.5) * cell, y: (wy + 0.5) * cell },
                { x: (wx2 + 0.5) * cell, y: (Math.min(r.y2 - 0.8, wy + 2.2)) * cell },
                { x: (wx1 + 0.5) * cell, y: (Math.min(r.y2 - 0.8, wy + 2.2)) * cell }
            ];

            monsters.push({
                ...template,
                id: `monster_${rIdx}_${m}`,
                islandId: rIdx,
                roomIdx: rIdx,
                speed: Math.round(template.speed * speedScale),
                chaseSpeed: Math.round(template.chaseSpeed * speedScale),
                x: waypoints[0].x,
                y: waypoints[0].y,
                waypoints
            });
        }
    });

    // Player starts safely inside her Cozy Underground Home Burrow!
    const spawn = {
        gx: homeNest.gx,
        gy: homeNest.gy,
        x: homeNest.x,
        y: homeNest.y,
        layer: 'burrow'
    };

    // Required quota of Big Hauls (Captive Pets + Giant Treasures) to complete the floor
    const totalHaulables = captivePets.length + carryables.length;

    return {
        floor,
        seed,
        theme,
        mission,
        cell,
        W,
        H,
        upperY1,
        upperY2,
        slabY1,
        slabY2,
        burrowY1,
        burrowY2,
        grid,
        rooms,
        islands: rooms,
        pillars,
        laserGates,
        chutes,
        burrowPairs: [],
        burrowHoles,
        homeNest,
        spawn,
        exit: {
            gx: homeNest.gx,
            gy: homeNest.gy,
            x: homeNest.x,
            y: homeNest.y
        },
        carryables,
        captivePets,
        goldenKey,
        sabotageLevers,
        cheeses,
        chests: [],
        shadowZones,
        boosters,
        monsters,
        totalHaulables
    };
}
