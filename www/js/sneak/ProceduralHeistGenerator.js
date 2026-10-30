// ============================================================================
// ProceduralHeistGenerator.js — Infinite Procedural 3/4 Castle Generator
// for «Тихая лапка» (Silent Paw)
//
// Why Burrows Matter on Every Single Floor:
// Every generated floor contains special high-value zones that CANNOT be
// entered on foot from the normal floor:
//   1. ELEVATED 3D BALCONIES ('B') — raised stone/wood balconies overlooking
//      the hall with 3D cliff faces & balustrades. Only reachable by holding
//      «НОРА» at a burrow entrance to tunnel up inside the wall!
//   2. IRON-BARRED TREASURY VAULTS ('V') — rooms fenced off by iron grates
//      where you can see the chest/captive friend inside, and must hold «НОРА»
//      to squeeze under the floor beneath the bars!
//   3. SECRET WALL CHAMBERS ('S') — hidden treasure rooms carved into the
//      castle walls, reachable by holding «НОРА» and aiming at the secret branch!
// ============================================================================

export const CASTLE_BIOMES = [
    {
        id: 'grand_library',
        name: 'Королевская Библиотека',
        subtitle: 'Ныряй в норки, чтобы забраться на высокие балконы и за решётки!',
        wallTop: '#35224c',
        wallTopHi: '#523673',
        wallFace: '#231534',
        wallFaceDark: '#160c22',
        floorA: '#2a1b3d',
        floorB: '#231634',
        floorGrouts: '#140b20',
        balconyTop: '#4c3266',
        balconyFace: '#2e1c42',
        vaultFloor: '#36234d',
        carpetColor: '#9f1239',
        carpetGold: '#fbbf24',
        torchColor: '#f59e0b',
        bgm: 'bgm_sneak_library'
    },
    {
        id: 'emerald_cellar',
        name: 'Изумрудный Погреб Сыров',
        subtitle: 'Зажми «НОРА» у лаза, чтобы проскочить под решётками сокровищницы!',
        wallTop: '#1e3a3a',
        wallTopHi: '#2d5757',
        wallFace: '#132626',
        wallFaceDark: '#0b1717',
        floorA: '#1a2e30',
        floorB: '#152527',
        floorGrouts: '#0c1618',
        balconyTop: '#294d4d',
        balconyFace: '#172e2e',
        vaultFloor: '#213b3d',
        carpetColor: '#0f766e',
        carpetGold: '#fde047',
        torchColor: '#34d399',
        bgm: 'bgm_sneak_cellar'
    },
    {
        id: 'crimson_throne',
        name: 'Багровый Зал Графа',
        subtitle: 'Прячься в норках от стражей и пробирайся в тайные комнаты!',
        wallTop: '#471d32',
        wallTopHi: '#692b49',
        wallFace: '#2e1120',
        wallFaceDark: '#1c0913',
        floorA: '#331626',
        floorB: '#2a111f',
        floorGrouts: '#170811',
        balconyTop: '#5c2641',
        balconyFace: '#381527',
        vaultFloor: '#421c30',
        carpetColor: '#be123c',
        carpetGold: '#facc15',
        torchColor: '#fb7185',
        bgm: 'bgm_sneak'
    },
    {
        id: 'moonlit_observatory',
        name: 'Лунная Обсерватория',
        subtitle: 'Перемещайся по сети норок между высокими ярусами и балконами!',
        wallTop: '#1e2952',
        wallTopHi: '#31427d',
        wallFace: '#131b38',
        wallFaceDark: '#0b1024',
        floorA: '#192342',
        floorB: '#141c36',
        floorGrouts: '#0a0f20',
        balconyTop: '#2b3b70',
        balconyFace: '#182245',
        vaultFloor: '#223059',
        carpetColor: '#6d28d9',
        carpetGold: '#38bdf8',
        torchColor: '#60a5fa',
        bgm: 'bgm_sneak_library'
    }
];

export const CAPTIVE_FRIENDS = [
    { id: 'mimi',   name: 'Мышка Мими',      spriteKey: 'skin_pink',    bonusDesc: '+10% к скорости' },
    { id: 'bublik', name: 'Хомячок Бублик',  spriteKey: 'skin_bear',    bonusDesc: '+25% сыра' },
    { id: 'cloud',  name: 'Котёнок Облачко', spriteKey: 'skin_kitty',   bonusDesc: 'Быстрый вход в норку' },
    { id: 'bob',    name: 'Бобрик Боб',      spriteKey: 'skin_beaver',  bonusDesc: '+1 щит-сердечко' },
    { id: 'pryg',   name: 'Лягушонок Прыг',  spriteKey: 'skin_frog',    bonusDesc: 'Дальний кувырок' }
];

const MONSTER_POOL = [
    { type: 'cat',      spriteKey: 'd_cat',      name: 'Кошка-Ищейка',   minFloor: 1, speed: 68, chaseSpeed: 108, coneLen: 185, coneHalfRad: 0.42, scale: 0.34 },
    { type: 'zombie',   spriteKey: 'd_zombie',   name: 'Сонный Зомби',   minFloor: 1, speed: 52, chaseSpeed: 88,  coneLen: 160, coneHalfRad: 0.45, scale: 0.33 },
    { type: 'slime',    spriteKey: 'd_slime',    name: 'Желейный Слайм', minFloor: 1, speed: 46, chaseSpeed: 80,  coneLen: 145, coneHalfRad: 0.48, scale: 0.34 },
    { type: 'skeleton', spriteKey: 'd_skeleton', name: 'Скелет-Часовой', minFloor: 2, speed: 64, chaseSpeed: 98,  coneLen: 175, coneHalfRad: 0.42, scale: 0.33 },
    { type: 'count',    spriteKey: 'd_count',    name: 'Граф Теней',     minFloor: 2, speed: 72, chaseSpeed: 112, coneLen: 195, coneHalfRad: 0.42, scale: 0.32 },
    { type: 'ghost',    spriteKey: 'd_ghost',    name: 'Призрак Замка',  minFloor: 3, speed: 62, chaseSpeed: 96,  coneLen: 170, coneHalfRad: 0.46, scale: 0.33 },
    { type: 'bat',      spriteKey: 'd_bat',      name: 'Ночной Нетопырь', minFloor: 3, speed: 78, chaseSpeed: 116, coneLen: 175, coneHalfRad: 0.40, scale: 0.34 },
    { type: 'mimic',    spriteKey: 'd_mimic',    name: 'Зубастый Сундук', minFloor: 4, speed: 66, chaseSpeed: 106, coneLen: 160, coneHalfRad: 0.46, scale: 0.34 }
];

const HOLE_PALETTE = [
    { name: 'Золотой лаз',   hex: 0xf59e0b, css: '#f59e0b', glow: '#fde047' },
    { name: 'Изумрудный лаз', hex: 0x10b981, css: '#10b981', glow: '#6ee7b7' },
    { name: 'Рубиновый лаз',  hex: 0xf43f5e, css: '#f43f5e', glow: '#fda4af' },
    { name: 'Сапфировый лаз', hex: 0x38bdf8, css: '#38bdf8', glow: '#bae6fd' },
    { name: 'Аметистовый лаз', hex: 0xa855f7, css: '#a855f7', glow: '#e9d5ff' }
];

function createRng(seed) {
    let s = (seed >>> 0) || 987654321;
    return function rng() {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Generates an infinitely scalable, non-repeating 3/4 Castle Stealth Floor.
 *
 * Grid cell types:
 *  '#' = Solid 3D Castle Wall (with top cap + front 3D cliff face)
 *  '.' = Main Hall Walkable Floor
 *  'B' = Elevated 3D Balcony Platform (separated from '.' by cliff edge — reachable ONLY via Burrow!)
 *  'V' = Iron-Barred Vault Room (separated from '.' by iron grate — reachable ONLY via Burrow!)
 *  'G' = Iron Grate Barrier (blocks walking, allows sight, shows why you need the Burrow!)
 *  'S' = Secret Hidden Chamber inside the walls (reachable ONLY via Burrow!)
 */
export function generateHeistFloor(floorNumber = 1, customSeed = null) {
    const floor = Math.max(1, floorNumber | 0);
    const seed = customSeed || (Math.floor(Date.now() % 100000000) + floor * 15485863);
    const rng = createRng(seed);

    const biome = CASTLE_BIOMES[(floor - 1) % CASTLE_BIOMES.length];

    // Cell size 60px gives generous room for 3/4 walls, furniture props, and smooth touch control
    const cell = 60;
    const W = Math.min(28, 18 + Math.min(10, Math.floor((floor - 1) * 1.2)));
    const H = Math.min(20, 13 + Math.min(7, Math.floor((floor - 1) * 0.8)));

    const grid = Array.from({ length: H }, () => Array(W).fill('#'));
    const zoneIdGrid = Array.from({ length: H }, () => Array(W).fill(-1));

    // 1. Carve Main Grand Hall (1..2 interconnected wings where monsters patrol)
    const mainX1 = 2;
    const mainX2 = W - 3;
    const mainY1 = 4;
    const mainY2 = H - 3;

    for (let y = mainY1; y <= mainY2; y++) {
        for (let x = mainX1; x <= mainX2; x++) {
            grid[y][x] = '.';
            zoneIdGrid[y][x] = 0;
        }
    }

    // Carve architectural wall islands / pillars / divider walls inside the Main Hall
    // so stealth line-of-sight and patrol loops feel like a real castle
    const midX = Math.floor((mainX1 + mainX2) / 2);
    const midY = Math.floor((mainY1 + mainY2) / 2);

    const layoutVariant = (floor + Math.floor(rng() * 4)) % 4;
    if (layoutVariant === 0) {
        // Twin colonnade pillars with central royal carpet
        for (let x = mainX1 + 3; x <= mainX2 - 3; x += 4) {
            if (Math.abs(x - midX) <= 1) continue;
            grid[mainY1 + 2][x] = '#';
            grid[mainY2 - 2][x] = '#';
        }
        // Central divider wall with top & bottom passages
        for (let y = mainY1 + 2; y <= mainY2 - 2; y++) {
            grid[y][midX] = '#';
        }
    } else if (layoutVariant === 1) {
        // Cross-wing castle layout with 4 corner alcoves and central fountain/pillar block
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                grid[midY + dy][midX + dx] = '#';
            }
        }
        for (let y = mainY1; y <= mainY1 + 2; y++) grid[y][midX - 4] = '#';
        for (let y = mainY2 - 2; y <= mainY2; y++) grid[y][midX + 4] = '#';
    } else if (layoutVariant === 2) {
        // Winding S-Gallery with two partial partition walls
        const w1 = mainX1 + Math.floor((mainX2 - mainX1) * 0.35);
        const w2 = mainX1 + Math.floor((mainX2 - mainX1) * 0.68);
        for (let y = mainY1; y <= mainY2 - 3; y++) grid[y][w1] = '#';
        for (let y = mainY1 + 3; y <= mainY2; y++) grid[y][w2] = '#';
    } else {
        // Grand Banquet Hall with long table islands
        for (let x = mainX1 + 3; x <= midX - 2; x++) grid[midY][x] = '#';
        for (let x = midX + 2; x <= mainX2 - 3; x++) grid[midY][x] = '#';
        grid[mainY1 + 2][midX] = '#';
        grid[mainY2 - 2][midX] = '#';
    }

    // 2. Carve Special Burrow-Only Zones!
    // Zone 1: ELEVATED 3D BALCONY ('B') along the top-left or top-right (rows 1..2)
    // Visually raised high above the main hall; separated by row 3 cliff wall/balustrade!
    const balcOnRight = rng() > 0.5;
    const balcX1 = balcOnRight ? midX + 1 : 2;
    const balcX2 = balcOnRight ? W - 3 : midX - 1;
    const balcY1 = 1;
    const balcY2 = 2;
    for (let y = balcY1; y <= balcY2; y++) {
        for (let x = balcX1; x <= balcX2; x++) {
            grid[y][x] = 'B';
            zoneIdGrid[y][x] = 1;
        }
    }
    // Row 3 below the balcony is a 3D cliff edge ('#') so nobody can walk up without a burrow!
    for (let x = balcX1; x <= balcX2; x++) {
        grid[3][x] = '#';
    }

    // Zone 2: IRON-BARRED TREASURY VAULT ('V') on the opposite top side or bottom corner!
    // Separated from the main hall by an Iron Grate ('G') — you can see inside,
    // and you MUST hold «НОРА» at a burrow to tunnel underneath the grate!
    const vaultX1 = balcOnRight ? 2 : midX + 1;
    const vaultX2 = balcOnRight ? Math.min(midX - 1, 7) : Math.max(midX + 2, W - 3);
    const vaultY1 = 1;
    const vaultY2 = 2;
    for (let y = vaultY1; y <= vaultY2; y++) {
        for (let x = vaultX1; x <= vaultX2; x++) {
            grid[y][x] = 'V';
            zoneIdGrid[y][x] = 2;
        }
    }
    // Put Iron Grate ('G') along row 3 below the vault so the player sees the iron bars!
    for (let x = vaultX1; x <= vaultX2; x++) {
        grid[3][x] = 'G';
    }

    // Zone 3 (on Floor 2+): SECRET WALL CHAMBER ('S') at the bottom-right or bottom-left
    let secretRoom = null;
    if (floor >= 2) {
        const secX1 = W - 6;
        const secX2 = W - 3;
        const secY1 = H - 2;
        const secY2 = H - 2;
        // Ensure row H-3 above it is solid wall '#'
        for (let x = secX1 - 1; x <= secX2; x++) {
            grid[H - 3][x] = '#';
        }
        for (let x = secX1; x <= secX2; x++) {
            grid[secY1][x] = 'S';
            zoneIdGrid[secY1][x] = 3;
        }
        secretRoom = { x1: secX1, x2: secX2, y: secY1 };
    }

    // 3. Player Spawn Point (bottom-left of Main Hall)
    const spawnGx = mainX1 + 1;
    const spawnGy = mainY2 - 1;
    grid[spawnGy][spawnGx] = '.';
    grid[spawnGy - 1][spawnGx] = '.';
    grid[spawnGy][spawnGx + 1] = '.';

    const spawn = {
        gx: spawnGx,
        gy: spawnGy,
        x: (spawnGx + 0.5) * cell,
        y: (spawnGy + 0.5) * cell
    };

    // 4. Create Connected Burrow Network (`holes` & `burrowPairs`)
    // Every Burrow Pair (and multi-branch network) has a clear purpose:
    //   Pair 0 (Золотой лаз): Main Hall (near spawn/center) <-> Inside the Iron-Barred Vault ('V')!
    //   Pair 1 (Изумрудный лаз): Main Hall <-> Up onto the Elevated 3D Balcony ('B')!
    //   Pair 2 (Рубиновый лаз): Stealth escape shortcut across the Main Hall (behind pillars/monsters)!
    //   Pair 3 (Сапфировый лаз, Floor 2+): Main Hall <-> Inside the Secret Wall Chamber ('S')!
    const burrowPairs = [];
    const holes = [];

    const addBurrowPair = (pairIdx, gxA, gyA, zoneA, gxB, gyB, zoneB, hintLabel) => {
        const pal = HOLE_PALETTE[pairIdx % HOLE_PALETTE.length];
        // Ensure walkable tiles at both mouths
        if (grid[gyA][gxA] === '#' || grid[gyA][gxA] === 'G') grid[gyA][gxA] = '.';
        const idA = `hole_${pairIdx}_a`;
        const idB = `hole_${pairIdx}_b`;

        const mouthA = {
            id: idA,
            pairId: pairIdx,
            partnerId: idB,
            label: `${pairIdx + 1}А`,
            pairNum: pairIdx + 1,
            name: pal.name,
            hint: hintLabel,
            colorHex: pal.hex,
            colorCss: pal.css,
            glowCss: pal.glow,
            gx: gxA,
            gy: gyA,
            x: (gxA + 0.5) * cell,
            y: (gyA + 0.5) * cell,
            zone: zoneA
        };

        const mouthB = {
            id: idB,
            pairId: pairIdx,
            partnerId: idA,
            label: `${pairIdx + 1}Б`,
            pairNum: pairIdx + 1,
            name: pal.name,
            hint: hintLabel,
            colorHex: pal.hex,
            colorCss: pal.css,
            glowCss: pal.glow,
            gx: gxB,
            gy: gyB,
            x: (gxB + 0.5) * cell,
            y: (gyB + 0.5) * cell,
            zone: zoneB
        };

        mouthA.targets = [mouthB];
        mouthB.targets = [mouthA];

        burrowPairs.push({ index: pairIdx, palette: pal, a: mouthA, b: mouthB, hint: hintLabel });
        holes.push(mouthA, mouthB);
    };

    // Pair 0: Main Hall -> Iron-Barred Vault ('V')
    const vaultMouthGx = Math.floor((vaultX1 + vaultX2) / 2);
    const vaultMouthGy = vaultY2;
    const hallVaultEntryGx = Math.max(mainX1 + 2, Math.min(mainX2 - 2, vaultMouthGx));
    const hallVaultEntryGy = mainY1 + 1;
    grid[hallVaultEntryGy][hallVaultEntryGx] = '.';
    addBurrowPair(0, hallVaultEntryGx, hallVaultEntryGy, 'hall', vaultMouthGx, vaultMouthGy, 'vault', 'За решётку сокровищницы!');

    // Pair 1: Main Hall -> Elevated 3D Balcony ('B')
    const balcMouthGx = Math.floor((balcX1 + balcX2) / 2);
    const balcMouthGy = balcY2;
    const hallBalcEntryGx = Math.max(mainX1 + 2, Math.min(mainX2 - 2, balcMouthGx));
    const hallBalcEntryGy = mainY2 - 1;
    grid[hallBalcEntryGy][hallBalcEntryGx] = '.';
    addBurrowPair(1, hallBalcEntryGx, hallBalcEntryGy, 'hall', balcMouthGx, balcMouthGy, 'balcony', 'На высокий балкон!');

    // Pair 2: Tactical Escape Tunnel across the Main Hall (left wing <-> right wing)
    const escLeftGx = mainX1 + 1;
    const escLeftGy = mainY1 + 1;
    const escRightGx = mainX2 - 1;
    const escRightGy = mainY1 + 2;
    grid[escLeftGy][escLeftGx] = '.';
    grid[escRightGy][escRightGx] = '.';
    addBurrowPair(2, escLeftGx, escLeftGy, 'hall', escRightGx, escRightGy, 'hall', 'Побег через весь зал!');

    // Pair 3 (Floor 2+): Main Hall -> Secret Wall Chamber ('S')
    if (secretRoom) {
        const secMouthGx = secretRoom.x1;
        const secMouthGy = secretRoom.y;
        const hallSecGx = midX;
        const hallSecGy = mainY2 - 1;
        grid[hallSecGy][hallSecGx] = '.';
        addBurrowPair(3, hallSecGx, hallSecGy, 'hall', secMouthGx, secMouthGy, 'secret', 'В тайную комнату!');
    }

    // Also link adjacent hall holes as secondary targets so holding «НОРА» lets you aim with the joystick between 2 exits!
    const hallHoles = holes.filter(h => h.zone === 'hall');
    if (hallHoles.length >= 2) {
        for (let i = 0; i < hallHoles.length; i++) {
            const h = hallHoles[i];
            const alt = hallHoles[(i + 1) % hallHoles.length];
            if (alt && alt.id !== h.id && !h.targets.includes(alt)) {
                h.targets.push(alt);
            }
        }
    }

    // 5. Place Key Objectives on the Balcony & Inside the Vault (so Burrows are 100% essential & rewarding!)
    // - On the Elevated 3D Balcony ('B'): The Golden Key (`d_key`) + a Royal Chest (`chest_closed`)!
    const keyGx = balcOnRight ? balcX2 - 1 : balcX1 + 1;
    const keyGy = balcY1;
    const goldenKey = {
        gx: keyGx,
        gy: keyGy,
        x: (keyGx + 0.5) * cell,
        y: (keyGy + 0.5) * cell
    };

    // - Inside the Iron-Barred Vault ('V'): Captive Pet Friend inside a Cage (`cage.svg`)!
    const petGx = vaultX1 === 2 ? vaultX1 + 1 : vaultX2 - 1;
    const petGy = vaultY1;
    const petFriendCfg = CAPTIVE_FRIENDS[(floor - 1) % CAPTIVE_FRIENDS.length];
    const captivePets = [
        {
            id: 'pet_vault',
            ...petFriendCfg,
            gx: petGx,
            gy: petGy,
            x: (petGx + 0.5) * cell,
            y: (petGy + 0.5) * cell,
            requiresKey: true
        }
    ];

    // - Treasure Chests (`chest_closed.svg`):
    //   1 on the Elevated Balcony, 1 in the Main Hall, and 1 in the Secret Room (if present)
    const chests = [
        {
            id: 'chest_balcony',
            gx: balcOnRight ? balcX1 + 1 : balcX2 - 1,
            gy: balcY1,
            x: ((balcOnRight ? balcX1 + 1 : balcX2 - 1) + 0.5) * cell,
            y: (balcY1 + 0.5) * cell,
            cheeseValue: 20 + floor * 3,
            relicIcon: 'crown'
        },
        {
            id: 'chest_hall',
            gx: mainX2 - 1,
            gy: midY,
            x: (mainX2 - 0.5) * cell,
            y: (midY + 0.5) * cell,
            cheeseValue: 18 + floor * 2,
            relicIcon: 'gift'
        }
    ];
    grid[midY][mainX2 - 1] = '.';

    if (secretRoom) {
        chests.push({
            id: 'chest_secret',
            gx: secretRoom.x2,
            gy: secretRoom.y,
            x: (secretRoom.x2 + 0.5) * cell,
            y: (secretRoom.y + 0.5) * cell,
            cheeseValue: 30 + floor * 4,
            relicIcon: 'crown'
        });
    }

    // 6. Exit Stairs (`stairs.svg`) — Opens once the Captive Friend is rescued from the Vault!
    const exitGx = mainX2 - 1;
    const exitGy = mainY2 - 1;
    grid[exitGy][exitGx] = '.';
    const exit = {
        gx: exitGx,
        gy: exitGy,
        x: (exitGx + 0.5) * cell,
        y: (exitGy + 0.5) * cell
    };

    // 7. Rich SVG World Props (`bookshelf`, `candelabra_lit`, `torch_sconce`, `redCarpet`, `glowpod`, `moonflower`, `mushroom`, `tile_butter`)
    const props = [];

    // Wall Torches & Bookshelves along top walls of the Main Hall
    for (let x = mainX1 + 1; x <= mainX2 - 1; x += 3) {
        if (grid[3][x] === '#') {
            props.push({
                type: (x % 2 === 0) ? 'torch_sconce' : 'bookshelf',
                x: (x + 0.5) * cell,
                y: 3.65 * cell,
                depthOffset: -2
            });
        }
    }

    // Lit Candelabras & Royal Urns near pillars
    for (let y = mainY1 + 1; y <= mainY2 - 1; y++) {
        for (let x = mainX1 + 1; x <= mainX2 - 1; x++) {
            if (grid[y][x] === '#' && grid[y + 1]?.[x] === '.') {
                if (rng() < 0.45) {
                    props.push({
                        type: rng() > 0.5 ? 'candelabra_lit' : 'relic_urn',
                        x: (x + 0.5) * cell,
                        y: (y + 0.82) * cell
                    });
                }
            }
        }
    }

    // Velvet Shadow Hiding Spots (using `glowpod.svg` & `moonflower.svg`)
    const shadowZones = [];
    const shadowCandidates = [
        { gx: mainX1 + 2, gy: midY },
        { gx: midX - 2, gy: mainY1 + 2 },
        { gx: midX + 2, gy: mainY2 - 2 },
        { gx: mainX2 - 3, gy: mainY1 + 2 }
    ];
    shadowCandidates.forEach((sc) => {
        if (grid[sc.gy]?.[sc.gx] === '.') {
            shadowZones.push({
                gx: sc.gx,
                gy: sc.gy,
                x: (sc.gx + 0.5) * cell,
                y: (sc.gy + 0.5) * cell,
                r: cell * 0.68
            });
        }
    });

    // Cheese wedges scattered across the Main Hall, Balcony, Vault, and Secret Room
    const cheeses = [];
    for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
            const t = grid[y][x];
            if (t === '.' || t === 'B' || t === 'V' || t === 'S') {
                const chance = (t === 'S' || t === 'B' || t === 'V') ? 0.38 : 0.11;
                if (rng() < chance && Math.hypot(x - spawnGx, y - spawnGy) > 2.2) {
                    cheeses.push({
                        x: (x + 0.5) * cell,
                        y: (y + 0.5) * cell,
                        value: t === 'S' ? 6 : 3
                    });
                }
            }
        }
    }

    // 8. Spawn Daughter's Hand-Drawn Monsters with Smooth Patrol Loops in the Main Hall
    const eligiblePool = MONSTER_POOL.filter(m => m.minFloor <= floor);
    const numMonsters = Math.min(6, 2 + Math.floor(floor * 0.75));
    const speedScale = 1 + Math.min(0.38, (floor - 1) * 0.045);
    const monsters = [];

    // Generate clean rectangular or L-shaped patrol loops inside the Main Hall away from spawn
    for (let i = 0; i < numMonsters; i++) {
        const template = eligiblePool[(floor + i) % eligiblePool.length];
        const bandX1 = Math.max(mainX1 + 3, Math.floor(mainX1 + ((mainX2 - mainX1) / numMonsters) * i));
        const bandX2 = Math.min(mainX2 - 1, Math.max(bandX1 + 3, Math.floor(mainX1 + ((mainX2 - mainX1) / numMonsters) * (i + 1))));
        const pyTop = mainY1 + 1 + (i % 2);
        const pyBot = mainY2 - 1 - ((i + 1) % 2);

        // Carve walkable patrol perimeter so the monster never gets stuck on a pillar
        const waypoints = [];
        const candidates = [
            { gx: bandX1, gy: pyTop },
            { gx: bandX2, gy: pyTop },
            { gx: bandX2, gy: pyBot },
            { gx: bandX1, gy: pyBot }
        ];
        candidates.forEach((pt) => {
            const cx = Math.max(mainX1 + 1, Math.min(mainX2 - 1, pt.gx));
            const cy = Math.max(mainY1 + 1, Math.min(mainY2 - 1, pt.gy));
            grid[cy][cx] = '.';
            waypoints.push({ x: (cx + 0.5) * cell, y: (cy + 0.5) * cell });
        });

        // Also ensure straight lines between consecutive waypoints are clear
        for (let w = 0; w < waypoints.length; w++) {
            const a = candidates[w];
            const b = candidates[(w + 1) % candidates.length];
            const xMin = Math.min(a.gx, b.gx), xMax = Math.max(a.gx, b.gx);
            const yMin = Math.min(a.gy, b.gy), yMax = Math.max(a.gy, b.gy);
            for (let y = yMin; y <= yMax; y++) {
                for (let x = xMin; x <= xMax; x++) {
                    if (y >= mainY1 && y <= mainY2 && x >= mainX1 && x <= mainX2) {
                        grid[y][x] = '.';
                    }
                }
            }
        }

        monsters.push({
            ...template,
            id: `monster_${i}`,
            speed: Math.round(template.speed * speedScale),
            chaseSpeed: Math.round(template.chaseSpeed * speedScale),
            x: waypoints[0].x,
            y: waypoints[0].y,
            waypoints
        });
    }

    return {
        floor,
        seed,
        theme: biome,
        biome,
        cell,
        W,
        H,
        grid,
        zoneIdGrid,
        balconyBounds: { x1: balcX1, x2: balcX2, y1: balcY1, y2: balcY2 },
        vaultBounds: { x1: vaultX1, x2: vaultX2, y1: vaultY1, y2: vaultY2 },
        secretRoom,
        spawn,
        exit,
        holes,
        burrowPairs,
        goldenKey,
        captivePets,
        chests,
        props,
        shadowZones,
        cheeses,
        monsters
    };
}
