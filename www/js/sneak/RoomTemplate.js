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
import { cycleMs, positionAt } from './PatrolCycle.js';

const key = (x, y) => `${x},${y}`;

export function isFloor(tpl, x, y) {
    if (y < 0 || y >= tpl.grid.length) return false;
    const row = tpl.grid[y];
    if (x < 0 || x >= row.length) return false;
    return row[x] !== '#';
}

export function floorCells(tpl) {
    const out = [];
    for (let y = 0; y < tpl.grid.length; y++) {
        for (let x = 0; x < tpl.grid[y].length; x++) {
            if (isFloor(tpl, x, y)) out.push({ x, y });
        }
    }
    return out;
}

// Ширина конуса задаётся полным раствором; сравниваем с половиной.
export function inCone(px, py, mx, my, angle, range, coneAngle) {
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

// Многоисточниковый BFS от всех пастей нор по клеткам пола.
// Возвращает Map 'x,y' -> расстояние в пикселях вдоль пола.
export function distanceToNearestHole(tpl, cell = SNEAK.CELL) {
    const dist = new Map();
    const queue = [];
    for (const h of tpl.holes || []) {
        for (const mouth of [h.a, h.b]) {
            if (!isFloor(tpl, mouth.x, mouth.y)) continue;
            const k = key(mouth.x, mouth.y);
            if (!dist.has(k)) { dist.set(k, 0); queue.push(mouth); }
        }
    }
    let head = 0;
    while (head < queue.length) {
        const c = queue[head++];
        const d = dist.get(key(c.x, c.y));
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = c.x + dx;
            const ny = c.y + dy;
            if (!isFloor(tpl, nx, ny)) continue;
            const nk = key(nx, ny);
            if (dist.has(nk)) continue;
            dist.set(nk, d + cell);
            queue.push({ x: nx, y: ny });
        }
    }
    return dist;
}

// Наблюдательный пост: клетка в 4 клетках от входа, ни разу не попадающая
// в конус монстра за полный цикл патруля (60 равномерных проб).
export function findObservationPost(tpl, metrics = SNEAK) {
    if (!tpl.patrol || tpl.patrol.length < 2) return null;
    const cell = metrics.CELL;
    const cyc = cycleMs(tpl.patrol, tpl.patrolSpeed, cell);
    const SAMPLES = 60;
    for (const c of floorCells(tpl)) {
        if (Math.abs(c.x - tpl.entry.x) > 4 || Math.abs(c.y - tpl.entry.y) > 4) continue;
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

export function validateRoom(tpl, metrics = SNEAK) {
    const errors = [];

    if (!tpl.exits || tpl.exits.length < 2) {
        errors.push(`room "${tpl.id}" needs at least 2 exits, has ${tpl.exits ? tpl.exits.length : 0}`);
    }

    const dist = distanceToNearestHole(tpl, metrics.CELL);
    let worstHoleDist = Infinity;
    let unreachable = 0;
    if (dist.size === 0) {
        worstHoleDist = Infinity;
        unreachable = floorCells(tpl).length;
    } else {
        worstHoleDist = 0;
        for (const c of floorCells(tpl)) {
            const d = dist.get(key(c.x, c.y));
            if (d === undefined) { unreachable++; continue; }
            if (d > worstHoleDist) worstHoleDist = d;
        }
    }
    const holeReachable = unreachable === 0 && worstHoleDist <= metrics.MAX_HOLE_DIST;
    if (unreachable > 0) {
        errors.push(`room "${tpl.id}" has ${unreachable} floor cells with no hole reachable`);
    } else if (worstHoleDist > metrics.MAX_HOLE_DIST) {
        errors.push(`room "${tpl.id}" farthest cell is ${worstHoleDist}px from a hole, max ${metrics.MAX_HOLE_DIST}`);
    }

    const windowExists = (tpl.windowMs || 0) >= metrics.MIN_WINDOW_MS;
    if (!windowExists) {
        errors.push(`room "${tpl.id}" window is ${tpl.windowMs || 0}ms, min ${metrics.MIN_WINDOW_MS}`);
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
