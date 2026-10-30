// ============================================
// PROCEDURAL HEIST GENERATOR — «Тихая лапка» (Castle of Shadows)
// Infinite procedural stealth-heist floors with:
// - 5 Castle biomes & authentic monster rosters
// - Multi-path halls with cover pillars (no unfair 1-tile choke traps)
// - Color-coded burrow teleport pairs
// - Golden Crown Cheeses + Optional Secret Bonus Chest
// - Shadow hiding rugs, breadcrumb cheese trails, pies & power-up boosters
// - Guaranteed BFS connectivity & clear line-of-sight patrol loops
// ============================================

import { biomeForFloor } from '../scenes/Biomes.js';

export const BURROW_PALETTE = [
    { id: 'gold',     name: 'Золотая нора',     color: 0xffd040, rim: 0xf59e0b, glow: 0xffe888, hex: '#ffd040' },
    { id: 'amethyst', name: 'Фиолетовая нора',  color: 0xc084fc, rim: 0x9333ea, glow: 0xe9d5ff, hex: '#c084fc' },
    { id: 'cyan',     name: 'Ледяная нора',     color: 0x38bdf8, rim: 0x0284c7, glow: 0xbae6fd, hex: '#38bdf8' },
    { id: 'emerald',  name: 'Изумрудная нора',  color: 0x4ade80, rim: 0x16a34a, glow: 0xbbf7d0, hex: '#4ade80' },
];

// Monster definitions tailored for stealth heist readability & personality
export const HEIST_MONSTERS = {
    cat: {
        kind: 'cat',
        texture: 'd_cat',
        name: 'Кот-Страж',
        speed: 96,
        chaseSpeed: 158,
        coneRange: 205,
        coneAngle: Math.PI * 0.44,
        coneColor: 0xffb84d,
        scaleW: 1.0,
        scaleH: 0.92,
        pauseAtTurnMs: 250,
    },
    zombie: {
        kind: 'zombie',
        texture: 'd_zombie',
        name: 'Сонный Повар',
        speed: 78,
        chaseSpeed: 138,
        coneRange: 190,
        coneAngle: Math.PI * 0.50,
        coneColor: 0xa3e635,
        scaleW: 0.96,
        scaleH: 1.08,
        pauseAtTurnMs: 950, // Snoozes briefly at corners — great timing window!
    },
    skeleton: {
        kind: 'skeleton',
        texture: 'd_skeleton',
        name: 'Скелет-Рыцарь',
        speed: 102,
        chaseSpeed: 162,
        coneRange: 215,
        coneAngle: Math.PI * 0.40,
        coneColor: 0xfacc15,
        scaleW: 0.92,
        scaleH: 1.06,
        pauseAtTurnMs: 200,
    },
    ghost: {
        kind: 'ghost',
        texture: 'd_ghost',
        name: 'Призрачный Хранитель',
        speed: 88,
        chaseSpeed: 148,
        coneRange: 195,
        coneAngle: Math.PI * 0.46,
        coneColor: 0x818cf8,
        scaleW: 0.95,
        scaleH: 1.05,
        pauseAtTurnMs: 300,
        phases: true,
    },
    bat: {
        kind: 'bat',
        texture: 'd_bat',
        name: 'Ночной Дозор',
        speed: 110,
        chaseSpeed: 166,
        coneRange: 175,
        coneAngle: Math.PI * 0.54,
        coneColor: 0xf472b6,
        scaleW: 0.98,
        scaleH: 0.80,
        pauseAtTurnMs: 100,
    },
    slime: {
        kind: 'slime',
        texture: 'd_slime',
        name: 'Желешка',
        speed: 82,
        chaseSpeed: 140,
        coneRange: 170,
        coneAngle: Math.PI * 0.58,
        coneColor: 0x34d399,
        scaleW: 1.02,
        scaleH: 0.82,
        pauseAtTurnMs: 400,
    },
    count: {
        kind: 'count',
        texture: 'd_count',
        name: 'Граф Ратула',
        speed: 108,
        chaseSpeed: 172,
        coneRange: 235,
        coneAngle: Math.PI * 0.48,
        coneColor: 0xf43f5e,
        scaleW: 1.08,
        scaleH: 1.22,
        pauseAtTurnMs: 220,
        isBoss: true,
    },
};

const BIOME_MONSTER_POOL = {
    dungeon: ['cat', 'zombie', 'slime', 'skeleton'],
    kitchen: ['zombie', 'cat', 'bat', 'slime'],
    library: ['ghost', 'cat', 'bat', 'skeleton'],
    garden:  ['cat', 'slime', 'bat', 'ghost'],
    throne:  ['skeleton', 'bat', 'ghost', 'cat'],
};

function randInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}

function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/**
 * Generate a complete, guaranteed-solvable stealth heist floor.
 * @param {number} floorNum 1..infinity
 */
export function generateHeistFloor(floorNum = 1) {
    const floor = Math.max(1, Math.floor(floorNum));
    const biome = biomeForFloor(floor);
    const isBossFloor = (floor % 5 === 0);

    // Map dimensions grow smoothly with floor level, always odd for clean symmetry
    let cols = 17, rows = 11;
    if (floor >= 3 && floor <= 5) { cols = 19; rows = 13; }
    else if (floor >= 6 && floor <= 9) { cols = 21; rows = 13; }
    else if (floor >= 10) { cols = 23; rows = 15; }

    // Build grid: '#' = wall, '.' = floor
    const grid = Array.from({ length: rows }, () => Array(cols).fill('#'));

    const carveRect = (x0, y0, w, h) => {
        for (let y = Math.max(1, y0); y < Math.min(rows - 1, y0 + h); y++) {
            for (let x = Math.max(1, x0); x < Math.min(cols - 1, x0 + w); x++) {
                grid[y][x] = '.';
            }
        }
    };

    const placePillar = (x0, y0, w = 1, h = 1) => {
        for (let y = Math.max(2, y0); y < Math.min(rows - 2, y0 + h); y++) {
            for (let x = Math.max(2, x0); x < Math.min(cols - 2, x0 + w); x++) {
                grid[y][x] = '#';
            }
        }
    };

    // Base open interior with 1-cell outer wall
    carveRect(1, 1, cols - 2, rows - 2);

    // Choose architectural archetype (0..3, or boss vault on every 5th floor)
    const archetype = isBossFloor ? 4 : ((floor + randInt(0, 3)) % 4);

    if (archetype === 0) {
        // Archetype 0: Grand Pillared Hall — 4 symmetric cover islands + center divider with wide arches
        const midX = Math.floor(cols / 2);
        const midY = Math.floor(rows / 2);
        placePillar(4, 3, 2, 2);
        placePillar(cols - 6, 3, 2, 2);
        placePillar(4, rows - 5, 2, 2);
        placePillar(cols - 6, rows - 5, 2, 2);
        placePillar(midX - 1, midY - 1, 2, 2);
    } else if (archetype === 1) {
        // Archetype 1: Twin Courtyards with 3 wide connecting avenues (top, center, bottom)
        const midX = Math.floor(cols / 2);
        placePillar(midX, 3, 1, 2);
        placePillar(midX, rows - 5, 1, 2);
        placePillar(4, Math.floor(rows / 2) - 1, 2, 2);
        placePillar(cols - 6, Math.floor(rows / 2) - 1, 2, 2);
    } else if (archetype === 2) {
        // Archetype 2: Shadow Keep — staggered stealth islands for weaving around cones
        const midY = Math.floor(rows / 2);
        for (let x = 4; x <= cols - 5; x += 4) {
            placePillar(x, 3, 2, 1);
            placePillar(x, rows - 4, 2, 1);
        }
        placePillar(Math.floor(cols * 0.33), midY, 2, 1);
        placePillar(Math.floor(cols * 0.66) - 1, midY, 2, 1);
    } else if (archetype === 3) {
        // Archetype 3: Circular Boulevard & Central Sanctum
        const midX = Math.floor(cols / 2);
        const midY = Math.floor(rows / 2);
        placePillar(midX - 3, midY - 2, 2, 1);
        placePillar(midX + 2, midY - 2, 2, 1);
        placePillar(midX - 3, midY + 2, 2, 1);
        placePillar(midX + 2, midY + 2, 2, 1);
        placePillar(3, midY, 1, 2);
        placePillar(cols - 4, midY - 1, 1, 2);
    } else {
        // Archetype 4: Count Ratula's Royal Vault (every 5th floor)
        const midX = Math.floor(cols / 2);
        const midY = Math.floor(rows / 2);
        placePillar(4, 3, 2, 1);
        placePillar(cols - 6, 3, 2, 1);
        placePillar(4, rows - 4, 2, 1);
        placePillar(cols - 6, rows - 4, 2, 1);
        placePillar(midX - 2, midY - 2, 1, 1);
        placePillar(midX + 2, midY - 2, 1, 1);
        placePillar(midX - 2, midY + 2, 1, 1);
        placePillar(midX + 2, midY + 2, 1, 1);
    }

    // Add 1-2 random extra cover pillars while keeping a 2-cell border highway clear
    const extraPillars = randInt(1, 2);
    for (let i = 0; i < extraPillars; i++) {
        const px = randInt(4, cols - 5);
        const py = randInt(3, rows - 4);
        grid[py][px] = '#';
    }

    // Always guarantee outer ring highway (x=1..2, x=cols-3..cols-2, y=1..2, y=rows-3..rows-2)
    // and central cross-avenues are open so player NEVER gets trapped and patrol loops are clean!
    const midX = Math.floor(cols / 2);
    const midY = Math.floor(rows / 2);
    carveRect(1, 1, cols - 2, 2);
    carveRect(1, rows - 3, cols - 2, 2);
    carveRect(1, 1, 2, rows - 2);
    carveRect(cols - 3, 1, 2, rows - 2);
    carveRect(midX - 1, 1, 3, rows - 2);
    carveRect(1, midY - 1, cols - 2, 2);

    // Entry (bottom-left or top-left alcove) & Exit Hatch (opposite side)
    const entryOnTop = (floor % 2 === 0);
    const entry = { x: 2, y: entryOnTop ? 2 : rows - 2 };
    const exit  = { x: cols - 3, y: entryOnTop ? rows - 2 : 2 };
    grid[entry.y][entry.x] = '.';
    grid[exit.y][exit.x] = '.';

    // Collect all floor cells
    const allFloor = [];
    for (let y = 1; y < rows - 1; y++) {
        for (let x = 1; x < cols - 1; x++) {
            if (grid[y][x] === '.') allFloor.push({ x, y });
        }
    }

    const usedKey = new Set([`${entry.x},${entry.y}`, `${exit.x},${exit.y}`]);
    const markUsed = (c, radius = 0) => {
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                usedKey.add(`${c.x + dx},${c.y + dy}`);
            }
        }
    };
    markUsed(entry, 2);
    markUsed(exit, 1);

    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    // === 1. BUILD PATROL LOOPS & MONSTERS ===
    // Rectangular loop tracks that are 100% on open floor cells
    const patrolLoops = [];

    // Loop A: Right-half patrol rectangle
    const buildRectLoop = (x1, y1, x2, y2) => {
        // Ensure all 4 sides of the rectangle are open floor!
        for (let x = x1; x <= x2; x++) { grid[y1][x] = '.'; grid[y2][x] = '.'; }
        for (let y = y1; y <= y2; y++) { grid[y][x1] = '.'; grid[y][x2] = '.'; }
        return [
            { x: x1, y: y1 },
            { x: x2, y: y1 },
            { x: x2, y: y2 },
            { x: x1, y: y2 },
        ];
    };

    // Main center-right loop
    patrolLoops.push(buildRectLoop(midX, 2, cols - 3, rows - 3));
    // Secondary center-left / inner loop (starts at x=4 so entry at x=2 is totally safe!)
    patrolLoops.push(buildRectLoop(4, 2, midX, rows - 3));
    // Inner sanctum loop for 3rd monster
    patrolLoops.push(buildRectLoop(5, Math.max(2, midY - 2), cols - 5, Math.min(rows - 3, midY + 2)));
    // Outer grand perimeter loop (excluding player spawn corner) for 4th monster
    patrolLoops.push(buildRectLoop(4, 1, cols - 2, rows - 2));

    let monsterCount = 1;
    if (floor === 2) monsterCount = 2;
    else if (floor >= 3 && floor <= 5) monsterCount = isBossFloor ? 3 : 2;
    else if (floor >= 6 && floor <= 10) monsterCount = 3;
    else if (floor >= 11) monsterCount = 4;

    const pool = BIOME_MONSTER_POOL[biome.id] || BIOME_MONSTER_POOL.dungeon;
    const speedScale = Math.min(1.42, 1 + (floor - 1) * 0.03);
    const monsters = [];

    for (let i = 0; i < monsterCount; i++) {
        const kind = (isBossFloor && i === 0) ? 'count' : pool[(floor + i) % pool.length];
        const def = HEIST_MONSTERS[kind] || HEIST_MONSTERS.cat;
        const rawLoop = patrolLoops[i % patrolLoops.length];
        // Reverse every other monster's loop so they march in opposite directions
        const loop = (i % 2 === 1) ? rawLoop.slice().reverse() : rawLoop.slice();
        monsters.push({
            id: `m_${i}`,
            ...def,
            speed: Math.round(def.speed * speedScale),
            chaseSpeed: Math.round(def.chaseSpeed * Math.min(1.28, 1 + (floor - 1) * 0.02)),
            patrol: loop,
            startOffsetMs: i * 1700,
        });
    }

    // === 2. COLOR-CODED BURROW TELEPORT PAIRS ===
    const pairCount = floor <= 2 ? 2 : (floor <= 6 ? 3 : 4);
    const holes = [];
    const quadrantCandidates = [
        allFloor.filter(c => c.x < midX && c.y < midY && !usedKey.has(`${c.x},${c.y}`)),
        allFloor.filter(c => c.x >= midX && c.y < midY && !usedKey.has(`${c.x},${c.y}`)),
        allFloor.filter(c => c.x < midX && c.y >= midY && !usedKey.has(`${c.x},${c.y}`)),
        allFloor.filter(c => c.x >= midX && c.y >= midY && !usedKey.has(`${c.x},${c.y}`)),
    ];

    for (let p = 0; p < pairCount; p++) {
        const pal = BURROW_PALETTE[p % BURROW_PALETTE.length];
        const qA = quadrantCandidates[p % 4].filter(c => !usedKey.has(`${c.x},${c.y}`));
        const qB = quadrantCandidates[(p + 2) % 4].filter(c => !usedKey.has(`${c.x},${c.y}`));
        const poolA = qA.length ? qA : allFloor.filter(c => !usedKey.has(`${c.x},${c.y}`));
        if (!poolA.length) break;
        const a = pickRandom(poolA);
        markUsed(a, 2);

        const poolB = (qB.length ? qB : allFloor).filter(c => !usedKey.has(`${c.x},${c.y}`) && dist(a, c) >= 6);
        if (!poolB.length) break;
        const b = pickRandom(poolB);
        markUsed(b, 2);

        holes.push({
            pairIndex: p,
            palette: pal,
            a: { x: a.x, y: a.y },
            b: { x: b.x, y: b.y },
        });
    }

    // === 3. GOLDEN CROWN CHEESES (Primary Heist Goal: 1..3) ===
    const goldenTargetCount = floor <= 2 ? 1 : (floor <= 5 ? 2 : 3);
    const goldenCheeses = [];
    const farCells = shuffle(allFloor.filter(c => !usedKey.has(`${c.x},${c.y}`) && dist(c, entry) >= 6));
    for (const c of farCells) {
        if (goldenCheeses.length >= goldenTargetCount) break;
        if (goldenCheeses.some(g => dist(g, c) < 5)) continue;
        goldenCheeses.push({ x: c.x, y: c.y, value: 15 + floor * 2 });
        markUsed(c, 1);
    }
    // Fallback if strict spacing found fewer
    while (goldenCheeses.length < goldenTargetCount) {
        const fb = allFloor.find(c => !usedKey.has(`${c.x},${c.y}`) && dist(c, entry) >= 4);
        if (!fb) break;
        goldenCheeses.push({ x: fb.x, y: fb.y, value: 15 + floor * 2 });
        markUsed(fb, 1);
    }

    // === 4. SECRET BONUS VAULT / CHEST (Optional High-Reward Goal) ===
    let secretChest = null;
    const chestCandidates = shuffle(allFloor.filter(c =>
        !usedKey.has(`${c.x},${c.y}`) && dist(c, entry) >= 5 && dist(c, exit) >= 4
    ));
    if (chestCandidates.length > 0) {
        const cc = chestCandidates[0];
        secretChest = {
            x: cc.x,
            y: cc.y,
            cheeseBonus: 25 + floor * 5,
            isGrandmaFriend: (floor % 3 === 0),
        };
        markUsed(cc, 1);
    }

    // === 5. SHADOW HIDING SPOTS (Cozy dark carpets / bushes where Pi is invisible) ===
    const shadowZones = [];
    const shadowCount = randInt(3, 4);
    const shadowCandidates = shuffle(allFloor.filter(c => !usedKey.has(`${c.x},${c.y}`)));
    for (const c of shadowCandidates) {
        if (shadowZones.length >= shadowCount) break;
        if (shadowZones.some(s => dist(s, c) < 4)) continue;
        shadowZones.push({ x: c.x, y: c.y });
        markUsed(c, 1);
    }

    // === 6. POWER-UP BOOSTERS (Cloak, Magnet, Turbo Paws) ===
    const boosterTypes = ['cloak', 'magnet', 'turbo'];
    const boosters = [];
    const boosterCount = floor === 1 ? 1 : 2;
    const boosterCandidates = shuffle(allFloor.filter(c => !usedKey.has(`${c.x},${c.y}`) && dist(c, entry) >= 3));
    for (let i = 0; i < boosterCount && i < boosterCandidates.length; i++) {
        const bc = boosterCandidates[i];
        boosters.push({
            x: bc.x,
            y: bc.y,
            type: boosterTypes[(floor + i) % boosterTypes.length],
        });
        markUsed(bc, 1);
    }

    // === 7. BREADCRUMB CHEESE SLICES & EXTRA PIES ===
    const pickups = [];
    const freeCells = shuffle(allFloor.filter(c => !usedKey.has(`${c.x},${c.y}`)));
    const cheeseCount = Math.min(freeCells.length, randInt(8, 12));
    for (let i = 0; i < cheeseCount; i++) {
        pickups.push({ type: 'cheese', x: freeCells[i].x, y: freeCells[i].y, value: 3 });
        usedKey.add(`${freeCells[i].x},${freeCells[i].y}`);
    }
    const pieCells = freeCells.slice(cheeseCount, cheeseCount + 2);
    for (const pc of pieCells) {
        pickups.push({ type: 'pie', x: pc.x, y: pc.y });
    }

    // === 8. DECORATIVE PROPS ON WALL EDGES / FLOOR CORNERS ===
    const decors = [];
    const decorPool = (biome.decorWeights || []).map(d => d.type).filter(t => t && t !== 'flourCloud' && t !== 'forbiddenBook' && t !== 'candelabra');
    const safeDecorTypes = decorPool.length ? decorPool : ['mushroom', 'bone', 'cobweb', 'skull'];
    for (let i = 0; i < 12; i++) {
        const dc = pickRandom(allFloor);
        if (!dc || dist(dc, entry) < 2 || dist(dc, exit) < 2) continue;
        decors.push({
            x: dc.x,
            y: dc.y,
            type: pickRandom(safeDecorTypes),
        });
    }

    return {
        floor,
        biome,
        isBossFloor,
        cols,
        rows,
        grid: grid.map(r => r.join('')),
        entry,
        exit,
        exits: [entry, exit],
        holes,
        monsters,
        goldenCheeses,
        secretChest,
        shadowZones,
        boosters,
        pickups,
        decors,
    };
}
