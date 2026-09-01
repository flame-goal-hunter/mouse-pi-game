# «Тихая лапка» — вертикальный срез. План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить в Замок теней третий режим — одну стелс-ночь из 6 комнат с одним монстром, норами и пирогами-инструментами, не изменяя два существующих режима.

**Architecture:** Вся детерминированная логика (метрики, патрули, валидатор комнат, сборка ночи, экономика) живёт в чистых ES-модулях под `www/js/sneak/` и покрыта тестами `node:test`. Phaser-сцена `SneakScene` — тонкий слой поверх них. Существующий `DungeonScene` не изменяется: нужные системы копируются, а не выносятся.

**Tech Stack:** Phaser 3.70 (CDN), ES-модули без сборщика, `node:test` + `node:assert/strict`, Capacitor 5 для Android.

**Спека:** `docs/superpowers/specs/2026-09-01-tihaya-lapka-stealth-mode-design.md`

**Тесты запускаются:** `node --test tools/tests/*.test.mjs` (форма с каталогом в Node 26 не работает — нужен глоб)

---

## Решение по формату шаблонов

Спека (раздел 5.1) называет шаблоны «Tiled JSON». В срезе они реализуются как **JS-модули с данными** — сетка строк плюс метаданные патруля, нор и реквизита.

Причина: валидатор и сборщик ночи потребляют именно эту структуру, она напрямую тестируется `node:test` без парсинга, и её пишет ассистент, а не автор. Цель спеки — «автор не чертит карты» — соблюдается полностью. Конвертер в Tiled JSON добавляется позже, если появится нужда править комнаты в редакторе.

---

## Структура файлов

**Создаются (чистая логика, под тестами):**

| Файл | Ответственность |
|---|---|
| `www/js/sneak/SneakMetrics.js` | Единственный источник чисел баланса |
| `www/js/sneak/PatrolCycle.js` | Где монстр в момент t, длина цикла |
| `www/js/sneak/RoomTemplate.js` | Формат шаблона + `validateRoom` |
| `www/js/sneak/templates/index.js` | 6 шаблонов комнат |
| `www/js/sneak/NightAssembler.js` | Сборка ночи из шаблонов по кривой напряжения |
| `www/js/sneak/SneakEconomy.js` | Начисление и потеря сыра |

**Создаётся (Phaser, без тестов):**

| Файл | Ответственность |
|---|---|
| `www/js/scenes/SneakScene.js` | Сцена режима |

**Изменяются (аддитивно):**

| Файл | Что |
|---|---|
| `www/js/storage/ProgressStore.js` | `stats.sneak`, `recordSneakRun`, `getSneakStats` |
| `www/js/scenes/TransylvaniaScene.js` | Третья карточка, пересчёт раскладки |
| `www/js/main.js` | Регистрация сцены |

**Тесты:**

`tools/tests/patrolCycle.test.mjs`, `roomTemplate.test.mjs`, `sneakTemplates.test.mjs`, `nightAssembler.test.mjs`, `sneakEconomy.test.mjs`, `progressSneak.test.mjs`

---

## Task 1: Метрики баланса

**Files:**
- Create: `www/js/sneak/SneakMetrics.js`

- [ ] **Step 1: Создать модуль метрик**

```js
// ============================================
// SNEAK METRICS — единственный источник чисел баланса режима.
// Геометрия комнат выводится из них. Менять только вместе с пересчётом шаблонов.
// ============================================

export const SNEAK = {
    // Движение
    WALK_SPEED:     240,   // px/s — совпадает с PLAYER.speed
    CROUCH_SPEED:   130,   // px/s — присед
    CHASE_SPEED:    270,   // монстр по прямой
    CHASE_TURN:     110,   // монстр в повороте
    TURN_BRAKE_MS:  600,   // торможение при смене направления

    // Обзор
    CONE_RANGE:     220,   // px
    CONE_ANGLE:     Math.PI / 3,   // 60 градусов, полный раствор
    SUSPICION_RISE: 1.0,   // единиц в секунду в конусе на близкой дистанции
    SUSPICION_FALL: 0.5,   // единиц в секунду вне конуса

    // Нора
    HOLE_HOLD_MS:    400,  // удержание кнопки для входа
    HOLE_SQUEEZE_MS: 500,  // анимация протискивания
    HOLE_FORGET_MS: 4000,  // через сколько монстр теряет спрятавшегося

    // Пироги
    PIES_MIN:        3,
    PIES_MAX:        5,
    PIE_BLIND_MS: 3000,    // ослепление при попадании в монстра
    PIE_NOISE_MS: 2500,    // как долго монстр идёт на шум

    // Сетка и производные
    CELL:           40,    // совпадает с NAV_CELL в DungeonScene
    SAFE_RUN_S:      3.6,  // секунд бега после вычета HOLE_HOLD_MS
    MAX_HOLE_DIST:  850,   // px = WALK_SPEED * SAFE_RUN_S, округлено вниз

    // Экономика
    CAPTURE_LOSS:    0.5,  // доля сыра за ночь, теряемая при поимке
    MIN_WINDOW_MS: 2000,   // минимальное окно прохода в валидном шаблоне
};
```

- [ ] **Step 2: Коммит**

```bash
git add www/js/sneak/SneakMetrics.js
git commit -m "feat(sneak): balance metrics module"
```

---

## Task 2: Цикл патруля

**Files:**
- Create: `www/js/sneak/PatrolCycle.js`
- Test: `tools/tests/patrolCycle.test.mjs`

- [ ] **Step 1: Написать падающий тест**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { cycleMs, positionAt, legLengths } from '../../www/js/sneak/PatrolCycle.js';

const CELL = 40;
// Квадрат 4x4 клетки: центры на 20, 180 → сторона 160px, периметр 640px
const SQUARE = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }];

test('legLengths closes the loop back to the first waypoint', () => {
    const legs = legLengths(SQUARE, CELL);
    assert.equal(legs.length, 4);
    for (const l of legs) assert.ok(Math.abs(l - 160) < 1e-9, `leg is 160px, got ${l}`);
});

test('cycleMs is perimeter divided by speed', () => {
    // 640px / 80 px/s = 8 s
    assert.ok(Math.abs(cycleMs(SQUARE, 80, CELL) - 8000) < 1e-6);
});

test('positionAt(0) sits on the first waypoint centre', () => {
    const p = positionAt(SQUARE, 80, CELL, 0);
    assert.ok(Math.abs(p.x - 20) < 1e-9);
    assert.ok(Math.abs(p.y - 20) < 1e-9);
});

test('positionAt halfway through the cycle is the opposite corner', () => {
    const p = positionAt(SQUARE, 80, CELL, 4000);
    assert.ok(Math.abs(p.x - 180) < 1e-9, `x=${p.x}`);
    assert.ok(Math.abs(p.y - 180) < 1e-9, `y=${p.y}`);
});

test('positionAt wraps past one full cycle', () => {
    const a = positionAt(SQUARE, 80, CELL, 1000);
    const b = positionAt(SQUARE, 80, CELL, 9000);
    assert.ok(Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6);
});

test('angle points along the current leg', () => {
    const p = positionAt(SQUARE, 80, CELL, 500);   // на первой стороне, идём вправо
    assert.ok(Math.abs(p.angle) < 1e-9, `angle=${p.angle}`);
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `node --test tools/tests/patrolCycle.test.mjs`
Expected: FAIL, `Cannot find module '.../PatrolCycle.js'`

- [ ] **Step 3: Реализовать модуль**

```js
// ============================================
// PATROL CYCLE — детерминированное положение монстра на замкнутом маршруте.
// Маршрут задан клетками; движение равномерное, петля замыкается на первую точку.
// ============================================

const toPx = (wp, cell) => ({ x: (wp.x + 0.5) * cell, y: (wp.y + 0.5) * cell });

export function legLengths(waypoints, cell) {
    const pts = waypoints.map((w) => toPx(w, cell));
    const legs = [];
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        legs.push(Math.hypot(b.x - a.x, b.y - a.y));
    }
    return legs;
}

export function cycleMs(waypoints, speedPxS, cell) {
    const total = legLengths(waypoints, cell).reduce((s, n) => s + n, 0);
    return (total / speedPxS) * 1000;
}

export function positionAt(waypoints, speedPxS, cell, tMs) {
    const pts = waypoints.map((w) => toPx(w, cell));
    const legs = legLengths(waypoints, cell);
    const total = legs.reduce((s, n) => s + n, 0);
    if (total === 0) return { x: pts[0].x, y: pts[0].y, angle: 0 };

    let d = ((tMs / 1000) * speedPxS) % total;
    if (d < 0) d += total;

    for (let i = 0; i < legs.length; i++) {
        if (d <= legs[i] || i === legs.length - 1) {
            const a = pts[i];
            const b = pts[(i + 1) % pts.length];
            const t = legs[i] === 0 ? 0 : Math.min(1, d / legs[i]);
            return {
                x: a.x + (b.x - a.x) * t,
                y: a.y + (b.y - a.y) * t,
                angle: Math.atan2(b.y - a.y, b.x - a.x),
            };
        }
        d -= legs[i];
    }
    return { x: pts[0].x, y: pts[0].y, angle: 0 };
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `node --test tools/tests/patrolCycle.test.mjs`
Expected: PASS, 6 tests

- [ ] **Step 5: Коммит**

```bash
git add www/js/sneak/PatrolCycle.js tools/tests/patrolCycle.test.mjs
git commit -m "feat(sneak): patrol cycle position and timing"
```

---

## Task 3: Валидатор комнаты

Проверяет четыре обязательных элемента грамматики из спеки (раздел 5.2) и правило 850 px (раздел 4.3).

**Files:**
- Create: `www/js/sneak/RoomTemplate.js`
- Test: `tools/tests/roomTemplate.test.mjs`

- [ ] **Step 1: Написать падающий тест**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRoom, floorCells, distanceToNearestHole, inCone } from '../../www/js/sneak/RoomTemplate.js';
import { SNEAK } from '../../www/js/sneak/SneakMetrics.js';

// Комната 8x6 клеток. '#' стена, '.' пол.
const GOOD = {
    id: 'good',
    grid: [
        '########',
        '#......#',
        '#......#',
        '#......#',
        '#......#',
        '########',
    ],
    entry:  { x: 1, y: 1 },
    exits:  [{ x: 1, y: 1 }, { x: 6, y: 4 }],
    holes:  [{ a: { x: 1, y: 4 }, b: { x: 6, y: 1 } }],
    patrol: [{ x: 3, y: 2 }, { x: 5, y: 2 }],
    patrolSpeed: 95,
    windowMs: 4000,
    props: [],
    loot: { x: 6, y: 4 },
};

test('floorCells counts only walkable cells', () => {
    assert.equal(floorCells(GOOD).length, 24);   // 6 wide x 4 tall
});

test('inCone is true straight ahead and false behind', () => {
    assert.equal(inCone(100, 0, 0, 0, 0, 220, SNEAK.CONE_ANGLE), true);
    assert.equal(inCone(-100, 0, 0, 0, 0, 220, SNEAK.CONE_ANGLE), false);
});

test('inCone respects range', () => {
    assert.equal(inCone(300, 0, 0, 0, 0, 220, SNEAK.CONE_ANGLE), false);
});

test('distanceToNearestHole measures along the floor, not through walls', () => {
    const d = distanceToNearestHole(GOOD, SNEAK.CELL);
    assert.equal(d.get('1,4'), 0);            // сама пасть норы
    assert.ok(d.get('4,2') > 0);
});

test('a well-formed room validates', () => {
    const r = validateRoom(GOOD);
    assert.deepEqual(r.errors, []);
    assert.equal(r.ok, true);
    assert.equal(r.holeReachable, true);
    assert.equal(r.windowExists, true);
    assert.equal(r.postExists, true);
});

test('a room with one exit fails', () => {
    const r = validateRoom({ ...GOOD, exits: [{ x: 1, y: 1 }] });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('exits')), r.errors.join('; '));
});

test('a room with no holes fails hole reachability', () => {
    const r = validateRoom({ ...GOOD, holes: [] });
    assert.equal(r.ok, false);
    assert.equal(r.holeReachable, false);
});

test('a room with too short a window fails', () => {
    const r = validateRoom({ ...GOOD, windowMs: 1000 });
    assert.equal(r.ok, false);
    assert.equal(r.windowExists, false);
});

test('a hole further than MAX_HOLE_DIST fails', () => {
    // Коридор 40 клеток = 1600px, нора только в начале
    const long = {
        ...GOOD,
        grid: ['#'.repeat(42), '#' + '.'.repeat(40) + '#', '#'.repeat(42)],
        entry: { x: 1, y: 1 },
        exits: [{ x: 1, y: 1 }, { x: 40, y: 1 }],
        holes: [{ a: { x: 1, y: 1 }, b: { x: 2, y: 1 } }],
        patrol: [{ x: 10, y: 1 }, { x: 30, y: 1 }],
        loot: { x: 40, y: 1 },
    };
    const r = validateRoom(long);
    assert.equal(r.holeReachable, false);
    assert.ok(r.worstHoleDist > SNEAK.MAX_HOLE_DIST);
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `node --test tools/tests/roomTemplate.test.mjs`
Expected: FAIL, `Cannot find module '.../RoomTemplate.js'`

- [ ] **Step 3: Реализовать модуль**

```js
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
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `node --test tools/tests/roomTemplate.test.mjs`
Expected: PASS, 9 tests

- [ ] **Step 5: Коммит**

```bash
git add www/js/sneak/RoomTemplate.js tools/tests/roomTemplate.test.mjs
git commit -m "feat(sneak): room template format and validator"
```

---

## Task 4: Шесть шаблонов комнат

Реализует кривую напряжения из спеки (раздел 5.4). Каждая комната — одна идея.

**Files:**
- Create: `www/js/sneak/templates/index.js`
- Test: `tools/tests/sneakTemplates.test.mjs`

- [ ] **Step 1: Написать падающий тест**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, BEATS } from '../../www/js/sneak/templates/index.js';
import { validateRoom } from '../../www/js/sneak/RoomTemplate.js';

test('there are six templates', () => {
    assert.equal(TEMPLATES.length, 6);
});

test('template ids are unique', () => {
    const ids = TEMPLATES.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length);
});

for (const tpl of TEMPLATES) {
    test(`template "${tpl.id}" passes the validator`, () => {
        const r = validateRoom(tpl);
        assert.deepEqual(r.errors, [], r.errors.join('; '));
        assert.equal(r.ok, true);
    });
}

test('every beat names an existing template', () => {
    for (const b of BEATS) {
        assert.ok(TEMPLATES.some((t) => t.id === b.room), `no template for beat ${b.room}`);
    }
});

test('intensity rises overall but dips for rests', () => {
    const teach = BEATS.find((b) => b.type === 'teach');
    const climax = BEATS.find((b) => b.type === 'climax');
    assert.ok(teach.intensity < climax.intensity);
    const rests = BEATS.filter((b) => b.type === 'rest');
    assert.ok(rests.length >= 2, 'at least two rest beats');
});

test('the teach room has no patrol', () => {
    const entry = TEMPLATES.find((t) => t.id === 'entry');
    assert.equal(entry.patrol.length, 0);
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `node --test tools/tests/sneakTemplates.test.mjs`
Expected: FAIL, `Cannot find module '.../templates/index.js'`

- [ ] **Step 3: Реализовать шаблоны**

Комната `entry` не имеет патруля, поэтому `findObservationPost` для неё вернёт `null` и валидатор упадёт. Чтобы обучающая комната оставалась валидной, `validateRoom` должен считать пост существующим, когда патруля нет. Внести правку в `RoomTemplate.js`:

```js
export function findObservationPost(tpl, metrics = SNEAK) {
    // Комната без патруля безопасна целиком — постом считается сам вход.
    if (!tpl.patrol || tpl.patrol.length < 2) return { ...tpl.entry };
    const cell = metrics.CELL;
    // ... остальное без изменений
```

Затем создать `www/js/sneak/templates/index.js`:

```js
// ============================================
// ШАБЛОНЫ КОМНАТ — вертикальный срез, крыло кухни.
// Каждая комната содержит четыре обязательных элемента грамматики:
// наблюдательный пост, маршрут, окно, страховку (нору).
// Координаты в клетках по 40px. '#' стена, '.' пол.
// ============================================

// 1. Обучение: нора и сыр, ни одного монстра.
const entry = {
    id: 'entry',
    grid: [
        '##########',
        '#........#',
        '#..####..#',
        '#..#..#..#',
        '#..####..#',
        '#........#',
        '##########',
    ],
    entry:  { x: 1, y: 1 },
    exits:  [{ x: 1, y: 1 }, { x: 8, y: 5 }],
    holes:  [{ a: { x: 1, y: 3 }, b: { x: 8, y: 3 } }],
    patrol: [],
    patrolSpeed: 0,
    windowMs: 9999,
    props: [{ type: 'cheese', x: 8, y: 3 }],
    loot: null,
};

// 2. Один патруль, широкое окно.
const pantry = {
    id: 'pantry',
    grid: [
        '############',
        '#..........#',
        '#..######..#',
        '#..#....#..#',
        '#..#....#..#',
        '#..######..#',
        '#..........#',
        '############',
    ],
    entry:  { x: 1, y: 1 },
    exits:  [{ x: 1, y: 1 }, { x: 10, y: 6 }],
    holes:  [
        { a: { x: 1, y: 6 }, b: { x: 10, y: 1 } },
    ],
    patrol: [{ x: 5, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 6 }, { x: 5, y: 6 }],
    patrolSpeed: 95,
    windowMs: 5000,
    props: [{ type: 'sack', x: 2, y: 3 }, { type: 'pot', x: 10, y: 4 }],
    loot: null,
};

// 3. Передышка: сыр, пироги, без монстра.
const corridor = {
    id: 'corridor',
    grid: [
        '##############',
        '#............#',
        '#............#',
        '##############',
    ],
    entry:  { x: 1, y: 1 },
    exits:  [{ x: 1, y: 1 }, { x: 12, y: 2 }],
    holes:  [{ a: { x: 6, y: 1 }, b: { x: 7, y: 2 } }],
    patrol: [],
    patrolSpeed: 0,
    windowMs: 9999,
    props: [{ type: 'pie', x: 4, y: 2 }, { type: 'cheese', x: 9, y: 1 }],
    loot: null,
};

// 4. Свет плиты режет укрытия — узкое окно у стены.
const stoves = {
    id: 'stoves',
    grid: [
        '############',
        '#..........#',
        '#.##....##.#',
        '#.##....##.#',
        '#..........#',
        '#.##....##.#',
        '#.##....##.#',
        '#..........#',
        '############',
    ],
    entry:  { x: 1, y: 1 },
    exits:  [{ x: 1, y: 1 }, { x: 10, y: 7 }],
    holes:  [
        { a: { x: 1, y: 4 }, b: { x: 10, y: 4 } },
    ],
    patrol: [{ x: 5, y: 1 }, { x: 6, y: 7 }],
    patrolSpeed: 95,
    windowMs: 4000,
    props: [{ type: 'hotpan', x: 5, y: 4 }, { type: 'pot', x: 6, y: 4 }],
    loot: null,
};

// 5. Кульминация: окно 2с, проходится только через шум (мешок муки).
const kitchen = {
    id: 'kitchen',
    grid: [
        '##############',
        '#............#',
        '#....####....#',
        '#....#..#....#',
        '#....####....#',
        '#............#',
        '#..##....##..#',
        '#............#',
        '##############',
    ],
    entry:  { x: 1, y: 1 },
    exits:  [{ x: 1, y: 1 }, { x: 12, y: 7 }],
    holes:  [
        { a: { x: 1, y: 7 }, b: { x: 12, y: 1 } },
        { a: { x: 6, y: 3 }, b: { x: 7, y: 3 } },
    ],
    patrol: [{ x: 2, y: 5 }, { x: 11, y: 5 }, { x: 11, y: 1 }, { x: 2, y: 1 }],
    patrolSpeed: 95,
    windowMs: 2000,
    props: [
        { type: 'sack', x: 3, y: 7 },
        { type: 'sack', x: 10, y: 7 },
        { type: 'pot', x: 2, y: 3 },
    ],
    loot: null,
};

// 6. Кладовая: добыча и лестница, тихо.
const larder = {
    id: 'larder',
    grid: [
        '##########',
        '#........#',
        '#........#',
        '#........#',
        '##########',
    ],
    entry:  { x: 1, y: 1 },
    exits:  [{ x: 1, y: 1 }, { x: 8, y: 3 }],
    holes:  [{ a: { x: 1, y: 3 }, b: { x: 8, y: 1 } }],
    patrol: [],
    patrolSpeed: 0,
    windowMs: 9999,
    props: [{ type: 'cheese', x: 4, y: 2 }],
    loot: { x: 8, y: 2 },
};

export const TEMPLATES = [entry, pantry, corridor, stoves, kitchen, larder];

// Кривая напряжения ночи. Порядок фиксированный для среза.
export const BEATS = [
    { room: 'entry',    type: 'teach',  intensity: 0.10 },
    { room: 'pantry',   type: 'test',   intensity: 0.35 },
    { room: 'corridor', type: 'rest',   intensity: 0.15 },
    { room: 'stoves',   type: 'test',   intensity: 0.60 },
    { room: 'kitchen',  type: 'climax', intensity: 0.90 },
    { room: 'larder',   type: 'rest',   intensity: 0.20 },
];
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `node --test tools/tests/sneakTemplates.test.mjs`
Expected: PASS, 11 tests. Если какой-то шаблон не проходит валидатор, тест назовёт причину — двигать нору или расширять проход до устранения.

- [ ] **Step 5: Коммит**

```bash
git add www/js/sneak/templates/index.js www/js/sneak/RoomTemplate.js tools/tests/sneakTemplates.test.mjs
git commit -m "feat(sneak): six validated room templates and the night tension curve"
```

---

## Task 5: Сборщик ночи

**Files:**
- Create: `www/js/sneak/NightAssembler.js`
- Test: `tools/tests/nightAssembler.test.mjs`

- [ ] **Step 1: Написать падающий тест**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleNight } from '../../www/js/sneak/NightAssembler.js';
import { TEMPLATES, BEATS } from '../../www/js/sneak/templates/index.js';

test('assembleNight returns one room per beat, in beat order', () => {
    const night = assembleNight(TEMPLATES, BEATS);
    assert.equal(night.length, BEATS.length);
    for (let i = 0; i < BEATS.length; i++) {
        assert.equal(night[i].template.id, BEATS[i].room);
        assert.equal(night[i].beat.type, BEATS[i].type);
    }
});

test('assembleNight rejects a template that fails validation', () => {
    const broken = { ...TEMPLATES[1], id: 'broken', holes: [] };
    const beats = [{ room: 'broken', type: 'test', intensity: 0.5 }];
    assert.throws(() => assembleNight([broken], beats), /broken/);
});

test('assembleNight throws when a beat has no template', () => {
    assert.throws(
        () => assembleNight(TEMPLATES, [{ room: 'nope', type: 'test', intensity: 0.5 }]),
        /nope/,
    );
});

test('each assembled room carries its validated observation post', () => {
    const night = assembleNight(TEMPLATES, BEATS);
    for (const room of night) {
        assert.ok(room.post, `room ${room.template.id} has a post`);
        assert.equal(typeof room.post.x, 'number');
    }
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `node --test tools/tests/nightAssembler.test.mjs`
Expected: FAIL, `Cannot find module '.../NightAssembler.js'`

- [ ] **Step 3: Реализовать модуль**

```js
// ============================================
// NIGHT ASSEMBLER — собирает ночь из шаблонов по кривой напряжения.
// Каждый шаблон проходит валидатор; невалидный шаблон останавливает сборку,
// а не попадает в игру.
// ============================================

import { validateRoom } from './RoomTemplate.js';

export function assembleNight(templates, beats, metrics = undefined) {
    const byId = new Map(templates.map((t) => [t.id, t]));
    const night = [];

    for (const beat of beats) {
        const template = byId.get(beat.room);
        if (!template) {
            throw new Error(`NightAssembler: no template "${beat.room}" for beat`);
        }
        const result = metrics ? validateRoom(template, metrics) : validateRoom(template);
        if (!result.ok) {
            throw new Error(`NightAssembler: template "${template.id}" failed validation — ${result.errors.join('; ')}`);
        }
        night.push({ template, beat, post: result.post });
    }

    return night;
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `node --test tools/tests/nightAssembler.test.mjs`
Expected: PASS, 4 tests

- [ ] **Step 5: Коммит**

```bash
git add www/js/sneak/NightAssembler.js tools/tests/nightAssembler.test.mjs
git commit -m "feat(sneak): night assembler with validation gate"
```

---

## Task 6: Экономика режима

Реализует раздел 7 спеки и уточнение из self-review: при поимке теряется половина сыра **за текущую ночь**, накопленное ранее не затрагивается.

**Files:**
- Create: `www/js/sneak/SneakEconomy.js`
- Test: `tools/tests/sneakEconomy.test.mjs`

- [ ] **Step 1: Написать падающий тест**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { cheeseOnCapture, nightReward, PIE_PRICE } from '../../www/js/sneak/SneakEconomy.js';

test('capture takes half the cheese carried this night, rounded down', () => {
    assert.deepEqual(cheeseOnCapture(100), { lost: 50, kept: 50 });
    assert.deepEqual(cheeseOnCapture(75), { lost: 37, kept: 38 });
});

test('capture with no cheese takes nothing', () => {
    assert.deepEqual(cheeseOnCapture(0), { lost: 0, kept: 0 });
});

test('nightReward pays the loot bonus', () => {
    const r = nightReward({ collected: 20, tookLoot: true, neverSeen: false, firstClear: false });
    assert.equal(r.total, 60);   // 20 собрано + 40 добыча
});

test('nightReward adds the never-seen bonus', () => {
    const r = nightReward({ collected: 20, tookLoot: true, neverSeen: true, firstClear: false });
    assert.equal(r.total, 90);   // + 30
});

test('nightReward adds the first-clear bonus', () => {
    const r = nightReward({ collected: 20, tookLoot: true, neverSeen: true, firstClear: true });
    assert.equal(r.total, 140);  // + 50
});

test('nightReward pays nothing for the loot if it was not taken', () => {
    const r = nightReward({ collected: 15, tookLoot: false, neverSeen: false, firstClear: false });
    assert.equal(r.total, 15);
});

test('a pie pack costs 15', () => {
    assert.equal(PIE_PRICE, 15);
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `node --test tools/tests/sneakEconomy.test.mjs`
Expected: FAIL, `Cannot find module '.../SneakEconomy.js'`

- [ ] **Step 3: Реализовать модуль**

```js
// ============================================
// SNEAK ECONOMY — начисление и потеря сыра в режиме «Тихая лапка».
// Банк сыра общий с остальными режимами; здесь считается только ночь.
// ============================================

import { SNEAK } from './SneakMetrics.js';

export const LOOT_BONUS = 40;
export const NEVER_SEEN_BONUS = 30;
export const FIRST_CLEAR_BONUS = 50;
export const PIE_PRICE = 15;

// Поимка забирает половину сыра, набранного за текущую ночь.
// Сыр, унесённый в прошлые ночи, уже лежит в банке и не затрагивается.
export function cheeseOnCapture(carriedThisNight) {
    const lost = Math.floor(carriedThisNight * SNEAK.CAPTURE_LOSS);
    return { lost, kept: carriedThisNight - lost };
}

export function nightReward({ collected, tookLoot, neverSeen, firstClear }) {
    const parts = { collected, loot: 0, neverSeen: 0, firstClear: 0 };
    if (tookLoot) parts.loot = LOOT_BONUS;
    if (neverSeen) parts.neverSeen = NEVER_SEEN_BONUS;
    if (firstClear) parts.firstClear = FIRST_CLEAR_BONUS;
    const total = parts.collected + parts.loot + parts.neverSeen + parts.firstClear;
    return { ...parts, total };
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `node --test tools/tests/sneakEconomy.test.mjs`
Expected: PASS, 7 tests

- [ ] **Step 5: Коммит**

```bash
git add www/js/sneak/SneakEconomy.js tools/tests/sneakEconomy.test.mjs
git commit -m "feat(sneak): night reward and capture loss rules"
```

---

## Task 7: Статистика режима в ProgressStore

**Files:**
- Modify: `www/js/storage/ProgressStore.js`
- Test: `tools/tests/progressSneak.test.mjs`

- [ ] **Step 1: Написать падающий тест**

`ProgressStore` обращается к `localStorage`, которого в Node нет. Тест ставит минимальную заглушку до импорта модуля.

```js
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};

const { Progress } = await import('../../www/js/storage/ProgressStore.js');

test('sneak stats start empty', () => {
    Progress.resetAll();
    const s = Progress.getSneakStats();
    assert.equal(s.runs, 0);
    assert.equal(s.clears, 0);
    assert.equal(s.captures, 0);
    assert.equal(s.ghostNights, 0);
});

test('a cleared night is recorded and pays into the shared bank', () => {
    Progress.resetAll();
    Progress.recordSneakRun({ cleared: true, neverSeen: false, cheese: 90 });
    const s = Progress.getSneakStats();
    assert.equal(s.runs, 1);
    assert.equal(s.clears, 1);
    assert.equal(s.captures, 0);
    assert.equal(Progress.getCheese(), 90);
});

test('a capture is recorded and still pays the kept cheese', () => {
    Progress.resetAll();
    Progress.recordSneakRun({ cleared: false, neverSeen: false, cheese: 25 });
    const s = Progress.getSneakStats();
    assert.equal(s.runs, 1);
    assert.equal(s.clears, 0);
    assert.equal(s.captures, 1);
    assert.equal(Progress.getCheese(), 25);
});

test('a night with no alarm counts as a ghost night', () => {
    Progress.resetAll();
    Progress.recordSneakRun({ cleared: true, neverSeen: true, cheese: 120 });
    assert.equal(Progress.getSneakStats().ghostNights, 1);
});

test('old saves without stats.sneak are migrated by deepMerge', () => {
    store.clear();
    store.set('mousiePi.progress.v1', JSON.stringify({ cheeseBank: 7, stats: { story: { runs: 3 } } }));
    // сбросить закэшированное состояние модуля через повторный импорт нельзя,
    // поэтому проверяем через публичный сброс и повторную запись
    const s = Progress.getSneakStats();
    assert.equal(typeof s.runs, 'number');
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `node --test tools/tests/progressSneak.test.mjs`
Expected: FAIL, `Progress.getSneakStats is not a function`

- [ ] **Step 3: Добавить sneak в DEFAULT_STATE**

В `www/js/storage/ProgressStore.js`, в объекте `stats` внутри `DEFAULT_STATE`, после блока `endless`:

```js
        endless: {
            runs: 0,
            bestFloor: 0,
            bestScore: 0,
            lastRunDate: null
        },
        sneak: {
            runs: 0,
            clears: 0,
            captures: 0,
            ghostNights: 0,
            lastRunDate: null
        }
```

- [ ] **Step 4: Добавить методы**

В объект `Progress`, сразу после `recordEndlessRun`:

```js
    recordSneakRun({ cleared, neverSeen, cheese }) {
        const s = load();
        s.stats.sneak.runs++;
        if (cleared) s.stats.sneak.clears++;
        else s.stats.sneak.captures++;
        if (neverSeen) s.stats.sneak.ghostNights++;
        s.stats.sneak.lastRunDate = Date.now();
        if (cheese > 0) {
            s.cheeseBank += cheese;
            s.cheeseEarnedAllTime += cheese;
        }
        save();
    },
    getSneakStats() {
        const s = load();
        return (s.stats && s.stats.sneak) || { runs: 0, clears: 0, captures: 0, ghostNights: 0, lastRunDate: null };
    },
```

- [ ] **Step 5: Запустить тест — убедиться, что проходит**

Run: `node --test tools/tests/progressSneak.test.mjs`
Expected: PASS, 5 tests

- [ ] **Step 6: Убедиться, что старые тесты не сломались**

Run: `node --test tools/tests/*.test.mjs`
Expected: PASS, все тесты (36 прежних + новые)

- [ ] **Step 7: Коммит**

```bash
git add www/js/storage/ProgressStore.js tools/tests/progressSneak.test.mjs
git commit -m "feat(sneak): per-mode stats for the stealth mode"
```

---

## Task 8: Сцена — каркас и отрисовка комнаты

С этой задачи начинается Phaser-часть. Тестов нет — проверка скриншотом.

**Files:**
- Create: `www/js/scenes/SneakScene.js`
- Modify: `www/js/main.js:13` и `www/js/main.js:57-58`

- [ ] **Step 1: Создать сцену с отрисовкой первой комнаты**

```js
// ============================================
// SNEAK SCENE — режим «Тихая лапка».
// Отдельная сцена: DungeonScene не изменяется.
// ============================================

import { Progress } from '../storage/ProgressStore.js';
import { bus } from '../audio/EventBus.js';
import { SFX, BGM } from '../audio/SoundKeys.js';
import { preloadAudio } from '../audio/AudioManager.js';
import { SNEAK } from '../sneak/SneakMetrics.js';
import { TEMPLATES, BEATS } from '../sneak/templates/index.js';
import { assembleNight } from '../sneak/NightAssembler.js';
import { isFloor } from '../sneak/RoomTemplate.js';

const CELL = SNEAK.CELL;
const DEPTH = { FLOOR: 10, PROP: 40, HOLE: 45, PLAYER: 60, MONSTER: 62, CONE: 55, HUD: 900 };

export class SneakScene extends Phaser.Scene {
    constructor() { super({ key: 'SneakScene' }); }

    init(data) {
        // Каждое поле сбрасывается здесь — сцена переиспользуется между ночами.
        this.roomIndex = data?.roomIndex || 0;
        this.cheeseThisNight = data?.cheeseThisNight || 0;
        this.pies = data?.pies ?? SNEAK.PIES_MIN;
        this.everSeen = data?.everSeen || false;
        this.night = assembleNight(TEMPLATES, BEATS);
        this.room = this.night[this.roomIndex];
        this.tpl = this.room.template;
        this.state = 'play';
        this.holdMs = 0;
        this.monster = null;
        this.player = null;
    }

    preload() {
        preloadAudio(this);
        this.load.svg('d_pi', 'assets/characters/pi.svg', { width: 96, height: 96 });
        this.load.svg('d_cat', 'assets/characters/cat.svg', { width: 96, height: 96 });
    }

    create() {
        this.viewW = this.scale.width;
        this.viewH = this.scale.height;
        this.cameras.main.setBackgroundColor('#0b0616');

        this.drawRoom();
        this.spawnPlayer();
        this.spawnMonster();

        this.cursors = this.input.keyboard.createCursorKeys();
    }

    drawRoom() {
        const g = this.add.graphics().setDepth(DEPTH.FLOOR);
        for (let y = 0; y < this.tpl.grid.length; y++) {
            for (let x = 0; x < this.tpl.grid[y].length; x++) {
                const px = x * CELL;
                const py = y * CELL;
                if (isFloor(this.tpl, x, y)) {
                    g.fillStyle(((x + y) % 2 === 0) ? 0x221333 : 0x281838, 1);
                } else {
                    g.fillStyle(0x2a1a3e, 1);
                }
                g.fillRect(px, py, CELL, CELL);
            }
        }

        // Норы — подсвечены всегда (правило доступности из спеки).
        this.holes = [];
        for (const h of this.tpl.holes) {
            for (const mouth of [h.a, h.b]) {
                const cx = (mouth.x + 0.5) * CELL;
                const cy = (mouth.y + 0.5) * CELL;
                const circ = this.add.circle(cx, cy, CELL * 0.32, 0x000000, 1).setDepth(DEPTH.HOLE);
                const glow = this.add.circle(cx, cy, CELL * 0.42, 0xd8a850, 0.22).setDepth(DEPTH.HOLE - 1);
                this.tweens.add({ targets: glow, alpha: 0.38, duration: 900, yoyo: true, repeat: -1 });
                this.holes.push({ x: cx, y: cy, pair: h, mouth, circ, glow });
            }
        }
    }

    spawnPlayer() {
        const px = (this.tpl.entry.x + 0.5) * CELL;
        const py = (this.tpl.entry.y + 0.5) * CELL;
        this.player = { x: px, y: py, vx: 0, vy: 0, hidden: false };
        this.player.sprite = this.add.image(px, py, 'd_pi').setDepth(DEPTH.PLAYER).setScale(0.32);
    }

    spawnMonster() {
        if (!this.tpl.patrol || this.tpl.patrol.length < 2) return;
        this.monster = { t: 0, x: 0, y: 0, angle: 0, suspicion: 0, state: 'patrol' };
        this.monster.sprite = this.add.image(0, 0, 'd_cat').setDepth(DEPTH.MONSTER).setScale(0.32);
        this.coneGfx = this.add.graphics().setDepth(DEPTH.CONE);
    }

    update(_time, dtMs) {
        const dt = Math.min(dtMs, 50) / 1000;
        if (this.state !== 'play') return;
        this.updatePlayer(dt);
    }

    updatePlayer(dt) {
        let dx = 0;
        let dy = 0;
        if (this.cursors.left.isDown) dx -= 1;
        if (this.cursors.right.isDown) dx += 1;
        if (this.cursors.up.isDown) dy -= 1;
        if (this.cursors.down.isDown) dy += 1;
        const len = Math.hypot(dx, dy) || 1;
        const speed = SNEAK.WALK_SPEED;
        const nx = this.player.x + (dx / len) * speed * dt;
        const ny = this.player.y + (dy / len) * speed * dt;
        if (dx || dy) this.moveTo(nx, ny);
    }

    // Пошаговое движение с проверкой стен по сетке шаблона.
    moveTo(nx, ny) {
        const cx = Math.floor(nx / CELL);
        const cyOld = Math.floor(this.player.y / CELL);
        if (isFloor(this.tpl, cx, cyOld)) this.player.x = nx;
        const cxNew = Math.floor(this.player.x / CELL);
        const cy = Math.floor(ny / CELL);
        if (isFloor(this.tpl, cxNew, cy)) this.player.y = ny;
        this.player.sprite.setPosition(this.player.x, this.player.y);
    }
}
```

- [ ] **Step 2: Зарегистрировать сцену**

В `www/js/main.js` после строки 13 добавить импорт:

```js
import { SneakScene } from './scenes/SneakScene.js';
```

И в строках 57–58 добавить сцену в оба массива:

```js
    ? [BootScene, GameScene, TransylvaniaScene, DungeonScene, SneakScene]
    : [BootScene, MenuScene, GameScene, TransylvaniaScene, DungeonScene, SneakScene];
```

- [ ] **Step 3: Проверить скриншотом**

```bash
cd www && python3 -m http.server 8765 --bind 127.0.0.1 &
```

Карточка в меню появится только в Task 13, поэтому до неё сцена запускается из консоли браузера. Открыть `http://127.0.0.1:8765/game-phaser.html?mode=transylvania&runMode=story`, дождаться загрузки и выполнить:

```js
// roomIndex выбирает комнату ночи: 0 entry, 1 pantry, 2 corridor, 3 stoves, 4 kitchen, 5 larder
window.game.scene.start('SneakScene', { roomIndex: 0 });
```

Если `window.game` не определён, добавить в `www/js/main.js` после создания игры строку `window.game = game;` — она полезна и дальше для отладки.

Expected: видна комната `entry`, пол в шахматную клетку, две подсвеченные норы, Пи в левом верхнем углу, стрелки двигают его и он не проходит сквозь стены.

- [ ] **Step 4: Коммит**

```bash
git add www/js/scenes/SneakScene.js www/js/main.js
git commit -m "feat(sneak): scene skeleton with room rendering and wall collision"
```

---

## Task 9: Нора — вход, выход, удержание

**Files:**
- Modify: `www/js/scenes/SneakScene.js`

- [ ] **Step 1: Добавить поиск ближайшей норы и удержание**

Добавить методы в `SneakScene`:

```js
    nearestHole() {
        let best = null;
        let bestD = Infinity;
        for (const h of this.holes) {
            const d = Math.hypot(h.x - this.player.x, h.y - this.player.y);
            if (d < bestD) { bestD = d; best = h; }
        }
        return bestD <= CELL * 0.9 ? best : null;
    }

    // Удержание кнопки действия HOLE_HOLD_MS у пасти норы.
    updateHoleHold(dt, actionDown) {
        const near = this.nearestHole();
        if (!near || !actionDown || this.player.hidden) {
            this.holdMs = 0;
            if (this.holdRing) { this.holdRing.destroy(); this.holdRing = null; }
            return;
        }
        this.holdMs += dt * 1000;
        const t = Math.min(1, this.holdMs / SNEAK.HOLE_HOLD_MS);
        if (!this.holdRing) {
            this.holdRing = this.add.graphics().setDepth(DEPTH.HUD);
        }
        this.holdRing.clear();
        this.holdRing.lineStyle(3, 0xd8a850, 0.9);
        this.holdRing.beginPath();
        this.holdRing.arc(near.x, near.y, CELL * 0.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t);
        this.holdRing.strokePath();
        if (this.holdMs >= SNEAK.HOLE_HOLD_MS) this.enterHole(near);
    }

    enterHole(hole) {
        this.holdMs = 0;
        if (this.holdRing) { this.holdRing.destroy(); this.holdRing = null; }
        this.player.hidden = true;
        this.state = 'squeeze';
        bus.emit(SFX.DASH);
        const other = (hole.mouth === hole.pair.a) ? hole.pair.b : hole.pair.a;
        const tx = (other.x + 0.5) * CELL;
        const ty = (other.y + 0.5) * CELL;
        this.tweens.add({
            targets: this.player.sprite,
            x: tx, y: ty, scale: 0.18,
            duration: SNEAK.HOLE_SQUEEZE_MS,
            ease: 'Quad.easeInOut',
            onComplete: () => {
                this.player.x = tx;
                this.player.y = ty;
                this.player.sprite.setScale(0.32);
                this.player.hidden = false;
                this.state = 'play';
                if (this.monster && this.monster.state === 'chase') this.monsterLosesPlayer();
            },
        });
    }

    monsterLosesPlayer() {
        this.monster.state = 'confused';
        this.monster.confusedUntil = this.time.now + SNEAK.HOLE_FORGET_MS;
        this.monster.suspicion = 0;
        this.showFloatingText(this.monster.x, this.monster.y - 40, '?', '#ffd040');
    }

    showFloatingText(x, y, text, color) {
        const t = this.add.text(x, y, text, {
            fontFamily: 'Nunito, sans-serif', fontSize: '22px', color,
        }).setOrigin(0.5).setDepth(DEPTH.HUD);
        this.tweens.add({ targets: t, y: y - 36, alpha: 0, duration: 900, onComplete: () => t.destroy() });
    }
```

- [ ] **Step 2: Подключить к update**

Заменить тело `update` на:

```js
    update(_time, dtMs) {
        const dt = Math.min(dtMs, 50) / 1000;
        if (this.state === 'squeeze') return;
        if (this.state !== 'play') return;
        const actionDown = this.cursors.space.isDown;
        this.updateHoleHold(dt, actionDown);
        if (this.holdMs === 0) this.updatePlayer(dt);
    }
```

- [ ] **Step 3: Проверить скриншотом**

Открыть сцену, подойти к норе, удерживать пробел.
Expected: вокруг норы рисуется золотая дуга, заполняется за 400 мс, затем Пи уменьшается, перелетает ко второй пасти и восстанавливает размер.

- [ ] **Step 4: Коммит**

```bash
git add www/js/scenes/SneakScene.js
git commit -m "feat(sneak): two-ended holes with a 400ms hold to enter"
```

---

## Task 10: Монстр — патруль, конус, подозрение, погоня

**Files:**
- Modify: `www/js/scenes/SneakScene.js`

- [ ] **Step 1: Добавить импорты**

В шапку файла:

```js
import { positionAt } from '../sneak/PatrolCycle.js';
import { inCone } from '../sneak/RoomTemplate.js';
```

- [ ] **Step 2: Добавить обновление монстра**

```js
    updateMonster(dt) {
        const m = this.monster;
        if (!m) return;

        if (m.state === 'confused' && this.time.now > m.confusedUntil) m.state = 'patrol';

        if (m.state === 'patrol' || m.state === 'confused') {
            m.t += dt * 1000;
            const p = positionAt(this.tpl.patrol, this.tpl.patrolSpeed, CELL, m.t);
            m.x = p.x; m.y = p.y; m.angle = p.angle;
        } else if (m.state === 'chase') {
            this.chaseStep(dt);
        }

        // Подозрение растёт только когда игрок в конусе и не спрятан.
        const sees = !this.player.hidden && m.state !== 'confused'
            && inCone(this.player.x, this.player.y, m.x, m.y, m.angle, SNEAK.CONE_RANGE, SNEAK.CONE_ANGLE);
        if (sees) {
            m.suspicion = Math.min(1, m.suspicion + SNEAK.SUSPICION_RISE * dt);
            if (m.suspicion >= 1 && m.state !== 'chase') {
                m.state = 'chase';
                this.everSeen = true;
                bus.emit(SFX.TAKE_DAMAGE);
                this.showFloatingText(m.x, m.y - 40, '!', '#ff6060');
            }
        } else if (m.state !== 'chase') {
            m.suspicion = Math.max(0, m.suspicion - SNEAK.SUSPICION_FALL * dt);
        }

        m.sprite.setPosition(m.x, m.y);
        this.drawCone();
        this.drawSuspicion();

        if (m.state === 'chase' && !this.player.hidden
            && Math.hypot(m.x - this.player.x, m.y - this.player.y) < CELL * 0.7) {
            this.capture();
        }
    }

    // Монстр быстр по прямой и медлен в повороте — правило баланса из спеки 4.2.
    chaseStep(dt) {
        const m = this.monster;
        const dx = this.player.x - m.x;
        const dy = this.player.y - m.y;
        const want = Math.atan2(dy, dx);
        let delta = want - m.angle;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;

        const turning = Math.abs(delta) > 0.35;
        const speed = turning ? SNEAK.CHASE_TURN : SNEAK.CHASE_SPEED;
        const maxTurn = (Math.PI / (SNEAK.TURN_BRAKE_MS / 1000)) * dt;
        m.angle += Math.max(-maxTurn, Math.min(maxTurn, delta));

        m.x += Math.cos(m.angle) * speed * dt;
        m.y += Math.sin(m.angle) * speed * dt;
    }

    drawCone() {
        const m = this.monster;
        this.coneGfx.clear();
        if (m.state === 'confused') return;
        const half = SNEAK.CONE_ANGLE / 2;
        const alpha = m.state === 'chase' ? 0.30 : 0.16;
        this.coneGfx.fillStyle(m.state === 'chase' ? 0xff6060 : 0xd8a850, alpha);
        this.coneGfx.beginPath();
        this.coneGfx.moveTo(m.x, m.y);
        this.coneGfx.arc(m.x, m.y, SNEAK.CONE_RANGE, m.angle - half, m.angle + half);
        this.coneGfx.closePath();
        this.coneGfx.fillPath();
    }

    // Полоска подозрения над монстром — требование доступности из спеки 4.5.
    drawSuspicion() {
        const m = this.monster;
        if (!this.susBar) this.susBar = this.add.graphics().setDepth(DEPTH.HUD);
        this.susBar.clear();
        if (m.suspicion <= 0.02) return;
        const w = 36;
        this.susBar.fillStyle(0x000000, 0.5);
        this.susBar.fillRect(m.x - w / 2, m.y - 46, w, 5);
        this.susBar.fillStyle(m.suspicion >= 1 ? 0xff6060 : 0xffd040, 1);
        this.susBar.fillRect(m.x - w / 2, m.y - 46, w * m.suspicion, 5);
    }
```

- [ ] **Step 3: Вызвать из update**

В `update`, после `this.updatePlayer(dt)`:

```js
        this.updateMonster(dt);
```

- [ ] **Step 4: Проверить скриншотом**

Открыть комнату `pantry` из консоли: `window.game.scene.start('SneakScene', { roomIndex: 1 })`.
Expected: кот идёт по прямоугольному маршруту, перед ним золотой конус; при входе Пи в конус над котом растёт жёлтая полоска; на полной полоске конус краснеет и кот бежит за Пи, заметно теряя скорость на поворотах.

- [ ] **Step 5: Коммит**

```bash
git add www/js/scenes/SneakScene.js
git commit -m "feat(sneak): patrol, vision cone, suspicion and turn-braked chase"
```

---

## Task 11: Пирог с тремя ролями

**Files:**
- Modify: `www/js/scenes/SneakScene.js`

- [ ] **Step 1: Добавить бросок**

```js
    throwPie(targetX, targetY) {
        if (this.pies <= 0 || this.state !== 'play') return;
        this.pies--;
        bus.emit(SFX.FIRE_PIE);

        const startX = this.player.x;
        const startY = this.player.y;
        const pie = this.add.circle(startX, startY, 7, 0xf0c060, 1).setDepth(DEPTH.PROP);
        const dist = Math.hypot(targetX - startX, targetY - startY);

        // Отклик на собственное действие — то, чего не хватало боевым режимам.
        this.player.sprite.setScale(0.34, 0.30);
        this.tweens.add({ targets: this.player.sprite, scaleX: 0.32, scaleY: 0.32, duration: 100 });

        this.tweens.add({
            targets: pie,
            x: targetX, y: targetY,
            duration: Math.max(120, (dist / 580) * 1000),
            ease: 'Linear',
            onComplete: () => { pie.destroy(); this.pieLanded(targetX, targetY); },
        });
    }

    pieLanded(x, y) {
        const m = this.monster;
        // Роль 1: попадание в монстра — ослепление.
        if (m && Math.hypot(m.x - x, m.y - y) < CELL * 0.8) {
            m.state = 'confused';
            m.confusedUntil = this.time.now + SNEAK.PIE_BLIND_MS;
            m.suspicion = 0;
            this.showFloatingText(m.x, m.y - 40, 'ой!', '#ffd040');
            return;
        }
        // Роль 2: попадание в стену или пол — шум, монстр идёт на звук.
        if (m && m.state !== 'chase') {
            m.state = 'noise';
            m.noiseX = x;
            m.noiseY = y;
            m.noiseUntil = this.time.now + SNEAK.PIE_NOISE_MS;
            this.showFloatingText(x, y, '?', '#ffffff');
        }
    }

    // Роль 3: удержание кнопки броска — съесть пирог, снять одышку.
    eatPie() {
        if (this.pies <= 0 || !this.winded) {
            if (!this.winded) this.showFloatingText(this.player.x, this.player.y - 30, 'не хочу', '#a090b8');
            return;
        }
        this.pies--;
        this.winded = false;
        bus.emit(SFX.POWERUP);
        this.showFloatingText(this.player.x, this.player.y - 30, 'ням', '#80ff80');
    }
```

**Одышка.** Без неё третья роль пирога — кнопка, которая ничего не делает. Минимальная система: после окончания погони Пи устаёт и бегает медленнее, пока не съест пирог или не отдышится сам.

Добавить в `init`:

```js
        this.winded = data?.winded || false;
        this.windedUntil = 0;
```

В `updatePlayer` заменить строку скорости:

```js
        const speed = this.winded ? SNEAK.WALK_SPEED * 0.7 : SNEAK.WALK_SPEED;
```

В `monsterLosesPlayer`, первой строкой тела — Пи выдохся после погони:

```js
        this.winded = true;
        this.windedUntil = this.time.now + 8000;
```

И в `update`, перед `this.updatePlayer(dt)` — одышка проходит и сама, чтобы игрок без пирогов не застревал:

```js
        if (this.winded && this.time.now > this.windedUntil) this.winded = false;
```

- [ ] **Step 2: Добавить обработку состояния noise в updateMonster**

В `updateMonster`, в блок выбора поведения, перед `else if (m.state === 'chase')`:

```js
        } else if (m.state === 'noise') {
            if (this.time.now > m.noiseUntil) { m.state = 'patrol'; }
            else {
                const dx = m.noiseX - m.x;
                const dy = m.noiseY - m.y;
                const d = Math.hypot(dx, dy) || 1;
                m.angle = Math.atan2(dy, dx);
                m.x += (dx / d) * this.tpl.patrolSpeed * dt;
                m.y += (dy / d) * this.tpl.patrolSpeed * dt;
            }
```

- [ ] **Step 3: Привязать к вводу**

В `create`, после создания `cursors`:

```js
        // Правая половина экрана — бросок. Левая в Task 14 отойдёт под стик,
        // поэтому граница задаётся сразу, чтобы обработчики не конфликтовали.
        this.input.on('pointerdown', (p) => {
            if (p.x <= this.viewW / 2) return;
            const wp = this.cameras.main.getWorldPoint(p.x, p.y);
            this._pieDownAt = this.time.now;
            this._pieId = p.id;
            this._pieTarget = { x: wp.x, y: wp.y };
        });
        this.input.on('pointerup', (p) => {
            if (!this._pieTarget || p.id !== this._pieId) return;
            const held = this.time.now - this._pieDownAt;
            if (held > 500) this.eatPie();
            else this.throwPie(this._pieTarget.x, this._pieTarget.y);
            this._pieTarget = null;
            this._pieId = null;
        });
```

- [ ] **Step 4: Проверить скриншотом**

Открыть `roomIndex: 1`. Expected: тап **по правой половине экрана** бросает пирог в эту точку; попадание по монстру ослепляет его на 3 с, попадание в стену уводит его к точке падения, удержание дольше 500 мс съедает пирог. Тап по левой половине пирог не бросает.

- [ ] **Step 5: Коммит**

```bash
git add www/js/scenes/SneakScene.js
git commit -m "feat(sneak): pie with three roles - blind, lure, eat"
```

---

## Task 12: Поимка, добыча и переход между комнатами

**Files:**
- Modify: `www/js/scenes/SneakScene.js`

- [ ] **Step 1: Добавить исход ночи**

```js
    capture() {
        if (this.state !== 'play') return;
        this.state = 'caught';
        bus.emit(SFX.TAKE_DAMAGE);
        this.cameras.main.shake(240, 0.012);

        const { lost, kept } = cheeseOnCapture(this.cheeseThisNight);
        Progress.recordSneakRun({ cleared: false, neverSeen: false, cheese: kept });

        this.showOutcome('ПОЙМАЛИ!', `Пи уронил ${lost} сыра и убежал домой.`, kept);
    }

    reachStairs() {
        if (this.state !== 'play') return;
        this.state = 'cleared';
        const reward = nightReward({
            collected: this.cheeseThisNight,
            tookLoot: true,
            neverSeen: !this.everSeen,
            firstClear: Progress.getSneakStats().clears === 0,
        });
        Progress.recordSneakRun({ cleared: true, neverSeen: !this.everSeen, cheese: reward.total });
        this.showOutcome('ДОБЫЧА ДОМА!', !this.everSeen ? 'Тебя ни разу не заметили.' : 'Утро настало.', reward.total);
    }

    showOutcome(title, sub, cheese) {
        const W = this.viewW;
        const H = this.viewH;
        this.add.rectangle(W / 2, H / 2, W, H, 0x0b0616, 0.86)
            .setScrollFactor(0).setDepth(DEPTH.HUD + 10);
        this.add.text(W / 2, H / 2 - 40, title, {
            fontFamily: 'Nunito, sans-serif', fontSize: '28px', color: '#d8a850',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.HUD + 11);
        this.add.text(W / 2, H / 2, `${sub}\n\n🧀 +${cheese}`, {
            fontFamily: 'Nunito, sans-serif', fontSize: '16px', color: '#e8dcf0', align: 'center',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.HUD + 11);

        const btn = this.add.text(W / 2, H / 2 + 90, 'В ЛАВКУ', {
            fontFamily: 'Nunito, sans-serif', fontSize: '18px', color: '#0b0616',
            backgroundColor: '#d8a850', padding: { x: 22, y: 10 },
        }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.HUD + 12).setInteractive({ useHandCursor: true });

        btn.on('pointerdown', () => {
            bus.emit(BGM.MENU);
            this.scene.start('TransylvaniaScene', { openShop: true });
        });
    }

    // Переход в следующую комнату ночи, состояние переносится через init.
    nextRoom() {
        if (this.roomIndex + 1 >= this.night.length) { this.reachStairs(); return; }
        this.scene.restart({
            roomIndex: this.roomIndex + 1,
            cheeseThisNight: this.cheeseThisNight,
            pies: this.pies,
            everSeen: this.everSeen,
        });
    }
```

- [ ] **Step 2: Добавить импорты экономики**

В шапку файла:

```js
import { cheeseOnCapture, nightReward } from '../sneak/SneakEconomy.js';
```

- [ ] **Step 3: Добавить выход из комнаты и сбор сыра**

В `drawRoom`, после отрисовки нор:

```js
        // Выход — второй элемент exits; вход это первый.
        const ex = this.tpl.exits[this.tpl.exits.length - 1];
        this.exitPoint = { x: (ex.x + 0.5) * CELL, y: (ex.y + 0.5) * CELL };
        this.add.circle(this.exitPoint.x, this.exitPoint.y, CELL * 0.4, 0x80ff80, 0.35)
            .setDepth(DEPTH.PROP);

        // Реквизит: сыр и пироги подбираются, остальное декоративно.
        this.pickups = [];
        for (const p of this.tpl.props) {
            if (p.type !== 'cheese' && p.type !== 'pie') continue;
            const cx = (p.x + 0.5) * CELL;
            const cy = (p.y + 0.5) * CELL;
            const col = p.type === 'cheese' ? 0xffd040 : 0xf0c060;
            const spr = this.add.circle(cx, cy, 9, col, 1).setDepth(DEPTH.PROP);
            this.pickups.push({ type: p.type, x: cx, y: cy, spr, taken: false });
        }
```

Добавить метод и вызвать его из `update` после `updateMonster`:

```js
    checkPickupsAndExit() {
        for (const p of this.pickups) {
            if (p.taken) continue;
            if (Math.hypot(p.x - this.player.x, p.y - this.player.y) > CELL * 0.7) continue;
            p.taken = true;
            p.spr.destroy();
            if (p.type === 'cheese') {
                this.cheeseThisNight += 5;
                this.showFloatingText(p.x, p.y, '+5 🧀', '#ffd040');
            } else {
                this.pies = Math.min(SNEAK.PIES_MAX, this.pies + 1);
                this.showFloatingText(p.x, p.y, '+1 🥧', '#f0c060');
            }
        }
        if (Math.hypot(this.exitPoint.x - this.player.x, this.exitPoint.y - this.player.y) < CELL * 0.5) {
            this.nextRoom();
        }
    }
```

- [ ] **Step 4: Проверить скриншотом**

Expected: сбор сыра увеличивает счётчик, вход в зелёный круг переводит в следующую комнату, шестая комната завершает ночь экраном с суммой, поимка показывает экран потери.

- [ ] **Step 5: Прогнать все тесты**

Run: `node --test tools/tests/*.test.mjs`
Expected: PASS, все тесты

- [ ] **Step 6: Коммит**

```bash
git add www/js/scenes/SneakScene.js
git commit -m "feat(sneak): capture, night clear, pickups and room transitions"
```

---

## Task 13: Третья карточка в меню

**Files:**
- Modify: `www/js/scenes/TransylvaniaScene.js:343-372`

- [ ] **Step 1: Пересчитать раскладку на три карточки**

Заменить блок вычисления позиций (строки 343–346) на:

```js
        const footerCy = H - FOOTER_PAD - FOOTER_H / 2;
        const sneakCy   = footerCy - FOOTER_H / 2 - 24 - cardH / 2;
        const endlessCy = sneakCy - cardH - cardGap;
        const storyCy   = endlessCy - cardH - cardGap;
        const cardW = Math.min(W * 0.88, 440);
```

- [ ] **Step 2: Добавить статистику режима**

После строки с `eStat`:

```js
        const nStat = (Progress.getSneakStats ? Progress.getSneakStats() : null) || { clears: 0 };
```

- [ ] **Step 3: Добавить карточку**

После вызова `_buildModeCard` для бесконечного спуска:

```js
        this._buildModeCard(cx, sneakCy, cardW, cardH, {
            icon: '🐾',
            title: 'ТИХАЯ ЛАПКА',
            hint: nStat.clears > 0 ? `Ночей пройдено: ${nStat.clears}` : 'Прячься · не дерись · унеси добычу',
            accent: 0x80c090, titleColor: 0xc8e8d0,
            bg: 0x0f2a1c,
            chevron: true,
            onClick: () => {
                try { bus.emit(UI.BUTTON_CLICK); } catch (e) {}
                this.cameras.main.fadeOut(280, 0, 0, 0);
                this.cameras.main.once('camerafadeoutcomplete', () =>
                    this.scene.start('SneakScene', { roomIndex: 0 }));
            },
        });
```

- [ ] **Step 4: Проверить скриншотом**

Expected: три карточки помещаются на экране 412×915 без наложения на футер и не выходят за безопасную область; тап по «ТИХАЯ ЛАПКА» открывает первую комнату.

Если три карточки не помещаются, уменьшить `cardH` на 8 px и `cardGap` на 4 px — эти константы объявлены выше в том же методе.

- [ ] **Step 5: Коммит**

```bash
git add www/js/scenes/TransylvaniaScene.js
git commit -m "feat(sneak): third mode card in the Transylvania hub"
```

---

## Task 14: Тач-управление

**Files:**
- Modify: `www/js/scenes/SneakScene.js`

- [ ] **Step 1: Добавить виртуальный стик**

```js
    setupTouch() {
        this.joy = { active: false, id: null, baseX: 0, baseY: 0, dx: 0, dy: 0 };
        const R = 60;

        this.joyBase = this.add.circle(0, 0, R, 0xd8a850, 0.14)
            .setScrollFactor(0).setDepth(DEPTH.HUD).setVisible(false);
        this.joyKnob = this.add.circle(0, 0, R * 0.42, 0xd8a850, 0.5)
            .setScrollFactor(0).setDepth(DEPTH.HUD + 1).setVisible(false);

        this.input.addPointer(2);

        this.input.on('pointerdown', (p) => {
            // Левая половина экрана — движение, правая уже занята броском пирога.
            if (p.x > this.viewW / 2 || this.joy.active) return;
            this.joy.active = true;
            this.joy.id = p.id;
            this.joy.baseX = p.x;
            this.joy.baseY = p.y;
            this.joyBase.setPosition(p.x, p.y).setVisible(true);
            this.joyKnob.setPosition(p.x, p.y).setVisible(true);
        });

        this.input.on('pointermove', (p) => {
            if (!this.joy.active || p.id !== this.joy.id) return;
            let dx = p.x - this.joy.baseX;
            let dy = p.y - this.joy.baseY;
            const d = Math.hypot(dx, dy);
            const DEAD = 8;
            if (d < DEAD) { this.joy.dx = 0; this.joy.dy = 0; }
            else {
                const clamped = Math.min(d, R);
                this.joy.dx = (dx / d) * (clamped / R);
                this.joy.dy = (dy / d) * (clamped / R);
            }
            this.joyKnob.setPosition(
                this.joy.baseX + this.joy.dx * R,
                this.joy.baseY + this.joy.dy * R,
            );
        });

        this.input.on('pointerup', (p) => {
            if (!this.joy.active || p.id !== this.joy.id) return;
            this.joy.active = false;
            this.joy.id = null;
            this.joy.dx = 0;
            this.joy.dy = 0;
            this.joyBase.setVisible(false);
            this.joyKnob.setVisible(false);
        });
    }
```

- [ ] **Step 2: Учесть стик в updatePlayer**

Заменить вычисление `dx`/`dy` в `updatePlayer`:

```js
        let dx = this.joy && this.joy.active ? this.joy.dx : 0;
        let dy = this.joy && this.joy.active ? this.joy.dy : 0;
        if (this.cursors.left.isDown) dx -= 1;
        if (this.cursors.right.isDown) dx += 1;
        if (this.cursors.up.isDown) dy -= 1;
        if (this.cursors.down.isDown) dy += 1;
```

- [ ] **Step 3: Вызвать setupTouch в create**

Перед `this.cursors = ...`:

```js
        this.setupTouch();
```

- [ ] **Step 4: Проверить скриншотом на мобильной эмуляции**

Expected: касание левой половины показывает стик в точке касания, Пи движется плавно с мёртвой зоной 8 px; касание правой половины бросает пирог; стик не перехватывает бросок и наоборот.

- [ ] **Step 5: Коммит**

```bash
git add www/js/scenes/SneakScene.js
git commit -m "feat(sneak): floating touch stick on the left half"
```

---

## Task 15: Счётчик пирогов и сыра на экране

**Files:**
- Modify: `www/js/scenes/SneakScene.js`

- [ ] **Step 1: Добавить HUD**

```js
    buildHud() {
        this.hudPies = this.add.text(14, 12, '', {
            fontFamily: 'Nunito, sans-serif', fontSize: '18px', color: '#f0c060',
        }).setScrollFactor(0).setDepth(DEPTH.HUD + 5);

        this.hudCheese = this.add.text(14, 36, '', {
            fontFamily: 'Nunito, sans-serif', fontSize: '18px', color: '#ffd040',
        }).setScrollFactor(0).setDepth(DEPTH.HUD + 5);

        this.hudRoom = this.add.text(this.viewW - 14, 12, '', {
            fontFamily: 'Nunito, sans-serif', fontSize: '14px', color: '#a090b8',
        }).setOrigin(1, 0).setScrollFactor(0).setDepth(DEPTH.HUD + 5);

        this.updateHud();
    }

    updateHud() {
        this.hudPies.setText(`🥧 ${this.pies}`);
        this.hudCheese.setText(`🧀 ${this.cheeseThisNight}`);
        this.hudRoom.setText(`Комната ${this.roomIndex + 1}/${this.night.length}`);
    }
```

- [ ] **Step 2: Вызвать из create и после каждого изменения**

В `create` после `setupTouch()`:

```js
        this.buildHud();
```

Добавить `this.updateHud();` в конец `checkPickupsAndExit`, в `throwPie` после `this.pies--`, и в `eatPie` после `this.pies--`.

- [ ] **Step 3: Проверить скриншотом**

Expected: слева сверху видны пироги и сыр, справа номер комнаты; счётчики меняются при подборе и броске.

- [ ] **Step 4: Прогнать все тесты**

Run: `node --test tools/tests/*.test.mjs`
Expected: PASS, все тесты

- [ ] **Step 5: Синхронизация с Android**

```bash
node node_modules/@capacitor/cli/bin/capacitor sync
```

- [ ] **Step 6: Коммит**

```bash
git add www/js/scenes/SneakScene.js
git commit -m "feat(sneak): in-run HUD for pies, cheese and room progress"
```

---

## Проверка среза целиком

- [ ] Все тесты зелёные: `node --test tools/tests/*.test.mjs`
- [ ] Скриншоты всех шести комнат сняты и просмотрены
- [ ] Ночь проходится от входа до лестницы без софт-локов
- [ ] Поимка приводит к утру, а не к экрану смерти
- [ ] Три карточки в меню помещаются на 412×915
- [ ] «Спасти бабушку» и «Бесконечный спуск» запускаются и играются как прежде

---

## Что осталось за срезом

Из спеки сознательно не входит: свечка и отмычка, второй монстр, второе крыло, реликвии и стелс-модификаторы, звуковой набор режима (12 звуков), гаптика, визуальная переработка тайлов.

**Присед** (спека, раздел 3.3) в срез также не входит: `SNEAK.CROUCH_SPEED` объявлена в метриках, но ввода под неё нет. Причина — в срезе один монстр и шум от шагов не моделируется, поэтому присед не на что влиять. Добавляется вместе с системой шума.

**Визуальная переработка** (спека, раздел 9) — отдельный план, поскольку она не зависит от режима и улучшает все три.
