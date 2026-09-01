// ============================================
// ROOM TEMPLATE — формат шаблона комнаты и его валидация.
//
// Шаблон:
//   id           строка
//   grid         массив строк, '#' стена, всё остальное пол
//   entry        {x,y} клетка входа
//   exits        [{x,y}] минимум два
//   holes        [{a:{x,y}, b:{x,y}}] двусторонние норы
//   patrol       [{x,y}] замкнутый маршрут монстра
//   patrolSpeed  px/s
//   windowMs     спроектированное окно прохода
//   props        [{type,x,y}]
//   loot         {x,y} или null
// ============================================

import { SNEAK } from './SneakMetrics.js';
import { legLengths, cycleMs, positionAt } from './PatrolCycle.js';

const key = (x, y) => `${x},${y}`;

function hasValidEntry(tpl) {
    return !!tpl.entry && Number.isFinite(tpl.entry.x) && Number.isFinite(tpl.entry.y);
}

export function isFloor(tpl, x, y) {
    if (!Array.isArray(tpl.grid)) return false;
    if (y < 0 || y >= tpl.grid.length) return false;
    const row = tpl.grid[y];
    if (typeof row !== 'string' || x < 0 || x >= row.length) return false;
    return row[x] === '.';
}

export function floorCells(tpl) {
    if (!Array.isArray(tpl.grid)) return [];
    const out = [];
    for (let y = 0; y < tpl.grid.length; y++) {
        for (let x = 0; x < tpl.grid[y].length; x++) {
            if (isFloor(tpl, x, y)) out.push({ x, y });
        }
    }
    return out;
}

// Ширина конуса задаётся полным раствором; сравниваем с половиной.
// Нефинитный вход (NaN/Infinity, напр. из-за patrolSpeed=0) считаем видимым —
// ошибаться в опасную сторону, а не молча объявлять клетку безопасной.
export function inCone(px, py, mx, my, angle, range, coneAngle) {
    if (![px, py, mx, my, angle, range, coneAngle].every(Number.isFinite)) return true;
    const dx = px - mx;
    const dy = py - my;
    const dist = Math.hypot(dx, dy);
    if (dist > range) return false;
    if (dist === 0) return true;
    let delta = Math.atan2(dy, dx) - angle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return Math.abs(delta) <= coneAngle / 2;
}

const NEIGHBORS_8 = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
];

// Соседи клетки пола: 4 ортогональных + 4 диагональных. Диагональ разрешена,
// только если обе смежные ортогональные клетки — тоже пол (нельзя срезать угол стены).
function floorNeighbors(tpl, cx, cy, cell) {
    const out = [];
    for (const [dx, dy] of NEIGHBORS_8) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!isFloor(tpl, nx, ny)) continue;
        if (dx !== 0 && dy !== 0) {
            if (!isFloor(tpl, cx + dx, cy) || !isFloor(tpl, cx, cy + dy)) continue;
        }
        out.push({ x: nx, y: ny, cost: dx !== 0 && dy !== 0 ? cell * Math.SQRT2 : cell });
    }
    return out;
}

// Дейкстра от набора источников по клеткам пола. Игрок движется непрерывно
// (свободные vx/vy), поэтому расстояние вдоль пола — не Манхэттен, а с учётом диагоналей.
// Возвращает Map 'x,y' -> расстояние в пикселях.
function floorDistances(tpl, sources, cell) {
    const dist = new Map();
    const visited = new Set();
    const frontier = [];
    for (const s of sources) {
        if (!s || !isFloor(tpl, s.x, s.y)) continue;
        const k = key(s.x, s.y);
        if (!dist.has(k)) dist.set(k, 0);
        frontier.push({ x: s.x, y: s.y, d: 0 });
    }
    while (frontier.length) {
        let bi = 0;
        for (let i = 1; i < frontier.length; i++) if (frontier[i].d < frontier[bi].d) bi = i;
        const cur = frontier.splice(bi, 1)[0];
        const ck = key(cur.x, cur.y);
        if (visited.has(ck)) continue;
        visited.add(ck);
        for (const n of floorNeighbors(tpl, cur.x, cur.y, cell)) {
            const nk = key(n.x, n.y);
            const nd = cur.d + n.cost;
            if (!dist.has(nk) || nd < dist.get(nk)) {
                dist.set(nk, nd);
                frontier.push({ x: n.x, y: n.y, d: nd });
            }
        }
    }
    return dist;
}

// Расстояние от каждой клетки пола до ближайшей пасти норы, вдоль пола, не через стены.
export function distanceToNearestHole(tpl, cell = SNEAK.CELL) {
    const holes = Array.isArray(tpl.holes) ? tpl.holes : [];
    const sources = [];
    for (const h of holes) {
        if (h && h.a) sources.push(h.a);
        if (h && h.b) sources.push(h.b);
    }
    return floorDistances(tpl, sources, cell);
}

function reachableFromEntry(tpl, cell) {
    if (!hasValidEntry(tpl)) return new Map();
    return floorDistances(tpl, [tpl.entry], cell);
}

// Наблюдательный пост: клетка в 4 клетках от входа, ни разу не попадающая
// в конус монстра за полный цикл патруля.
export function findObservationPost(tpl, metrics = SNEAK) {
    if (!hasValidEntry(tpl)) return null;
    const hasPatrol = Array.isArray(tpl.patrol) && tpl.patrol.length >= 2;
    if (!hasPatrol) {
        // Нет патруля — нет монстра, вся комната безопасна, пост — сама точка входа.
        return isFloor(tpl, tpl.entry.x, tpl.entry.y) ? { x: tpl.entry.x, y: tpl.entry.y } : null;
    }
    if (!Number.isFinite(tpl.patrolSpeed) || tpl.patrolSpeed <= 0) {
        // Патруль задан, но скорость невалидна — это баг шаблона, а не безопасная комната.
        return null;
    }
    const cell = metrics.CELL;
    const cyc = cycleMs(tpl.patrol, tpl.patrolSpeed, cell);
    const legs = legLengths(tpl.patrol, cell);
    const step = 10; // px хода монстра между пробами
    const SAMPLES = Math.max(60, Math.ceil(legs.reduce((s, n) => s + n, 0) / step));
    const reachable = reachableFromEntry(tpl, cell);
    for (const c of floorCells(tpl)) {
        if (Math.abs(c.x - tpl.entry.x) > 4 || Math.abs(c.y - tpl.entry.y) > 4) continue;
        if (!reachable.has(key(c.x, c.y))) continue;
        const px = (c.x + 0.5) * cell;
        const py = (c.y + 0.5) * cell;
        let safe = true;
        for (let i = 0; i < SAMPLES; i++) {
            const m = positionAt(tpl.patrol, tpl.patrolSpeed, cell, (cyc * i) / SAMPLES);
            if (inCone(px, py, m.x, m.y, m.angle, metrics.CONE_RANGE, metrics.CONE_ANGLE)) {
                safe = false;
                break;
            }
        }
        if (safe) return c;
    }
    return null;
}

const GRID_GLYPHS = new Set(['#', '.']);

// Проверяет форму grid: непустой массив строк одинаковой длины из '#'/'.'.
// Не бросает исключений ни на каких входных данных.
function validateGrid(tpl, errors) {
    if (!Array.isArray(tpl.grid) || tpl.grid.length === 0) {
        errors.push(`room "${tpl.id}" grid must be a non-empty array of rows`);
        return;
    }
    const width = typeof tpl.grid[0] === 'string' ? tpl.grid[0].length : 0;
    for (let y = 0; y < tpl.grid.length; y++) {
        const row = tpl.grid[y];
        if (typeof row !== 'string') {
            errors.push(`room "${tpl.id}" grid row ${y} must be a string`);
            continue;
        }
        if (row.length !== width) {
            errors.push(`room "${tpl.id}" grid row ${y} has length ${row.length}, expected ${width}`);
        }
        for (let x = 0; x < row.length; x++) {
            if (!GRID_GLYPHS.has(row[x])) {
                errors.push(`room "${tpl.id}" grid row ${y} col ${x} has unknown glyph "${row[x]}"`);
            }
        }
    }
}

function validateExits(tpl, reachable, errors) {
    if (!Array.isArray(tpl.exits)) {
        errors.push(`room "${tpl.id}" exits must be an array`);
        return;
    }
    const distinct = new Set();
    for (const e of tpl.exits) {
        if (e && Number.isFinite(e.x) && Number.isFinite(e.y)) distinct.add(key(e.x, e.y));
    }
    if (distinct.size < 2) {
        errors.push(`room "${tpl.id}" needs at least 2 distinct exits, has ${distinct.size}`);
    }
    for (const e of tpl.exits) {
        if (!e || !Number.isFinite(e.x) || !Number.isFinite(e.y)) {
            errors.push(`room "${tpl.id}" exit is missing x/y`);
            continue;
        }
        if (!isFloor(tpl, e.x, e.y)) {
            errors.push(`room "${tpl.id}" exit (${e.x},${e.y}) is not a floor cell`);
        } else if (!reachable.has(key(e.x, e.y))) {
            errors.push(`room "${tpl.id}" exit (${e.x},${e.y}) is not reachable from entry`);
        }
    }
}

function validateHoles(tpl, errors) {
    const holes = Array.isArray(tpl.holes) ? tpl.holes : [];
    holes.forEach((h, i) => {
        if (!h || !h.a || !h.b) {
            errors.push(`room "${tpl.id}" hole ${i} is missing mouth a or b`);
            return;
        }
        if (!isFloor(tpl, h.a.x, h.a.y)) {
            errors.push(`room "${tpl.id}" hole ${i} mouth a (${h.a.x},${h.a.y}) is not a floor cell`);
        }
        if (!isFloor(tpl, h.b.x, h.b.y)) {
            errors.push(`room "${tpl.id}" hole ${i} mouth b (${h.b.x},${h.b.y}) is not a floor cell`);
        }
        if (h.a.x === h.b.x && h.a.y === h.b.y) {
            errors.push(`room "${tpl.id}" hole ${i} has both mouths on the same cell (${h.a.x},${h.a.y})`);
        }
    });
}

export function validateRoom(tpl, metrics = SNEAK) {
    tpl = tpl || {};
    const errors = [];

    validateGrid(tpl, errors);

    if (!hasValidEntry(tpl)) {
        errors.push(`room "${tpl.id}" entry is missing or invalid`);
    } else if (!isFloor(tpl, tpl.entry.x, tpl.entry.y)) {
        errors.push(`room "${tpl.id}" entry (${tpl.entry.x},${tpl.entry.y}) is not a floor cell`);
    }

    const reachable = reachableFromEntry(tpl, metrics.CELL);

    validateExits(tpl, reachable, errors);
    validateHoles(tpl, errors);

    const dist = distanceToNearestHole(tpl, metrics.CELL);
    const floors = floorCells(tpl);
    let worstHoleDist = Infinity;
    let unreachable = 0;
    if (dist.size === 0) {
        worstHoleDist = Infinity;
        unreachable = floors.length;
    } else {
        worstHoleDist = 0;
        for (const c of floors) {
            const d = dist.get(key(c.x, c.y));
            if (d === undefined) { unreachable++; continue; }
            if (d > worstHoleDist) worstHoleDist = d;
        }
    }
    const holeReachable = floors.length > 0 && unreachable === 0 && worstHoleDist <= metrics.MAX_HOLE_DIST;
    if (floors.length === 0) {
        errors.push(`room "${tpl.id}" has no floor cells`);
    } else if (unreachable > 0) {
        errors.push(`room "${tpl.id}" has ${unreachable} floor cells with no hole reachable`);
    } else if (worstHoleDist > metrics.MAX_HOLE_DIST) {
        errors.push(`room "${tpl.id}" farthest cell is ${worstHoleDist}px from a hole, max ${metrics.MAX_HOLE_DIST}`);
    }

    const windowExists = Number.isFinite(tpl.windowMs) && tpl.windowMs >= metrics.MIN_WINDOW_MS;
    if (!windowExists) {
        errors.push(`room "${tpl.id}" window is ${tpl.windowMs || 0}ms, min ${metrics.MIN_WINDOW_MS}`);
    }

    if (Array.isArray(tpl.patrol) && tpl.patrol.length >= 2 &&
        (!Number.isFinite(tpl.patrolSpeed) || tpl.patrolSpeed <= 0)) {
        errors.push(`room "${tpl.id}" has a patrol but patrolSpeed is ${tpl.patrolSpeed}, must be > 0`);
    }

    const post = findObservationPost(tpl, metrics);
    const postExists = post !== null;
    if (!postExists) {
        errors.push(`room "${tpl.id}" has no observation post near the entry`);
    }

    return {
        ok: errors.length === 0,
        holeReachable,
        windowExists,
        postExists,
        post,
        worstHoleDist,
        errors,
    };
}
