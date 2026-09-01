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

test('inCone treats non-finite input as visible, not silently safe', () => {
    assert.equal(inCone(NaN, 0, 0, 0, 0, 220, SNEAK.CONE_ANGLE), true);
    assert.equal(inCone(0, 0, 0, 0, NaN, 220, SNEAK.CONE_ANGLE), true);
});

test('a room with no patrol treats the entry as a guaranteed-safe observation post', () => {
    const r = validateRoom({ ...GOOD, patrol: [], patrolSpeed: 0 });
    assert.equal(r.postExists, true);
    assert.deepEqual(r.post, { x: GOOD.entry.x, y: GOOD.entry.y });
    assert.equal(r.ok, true);
    assert.deepEqual(r.errors, []);
});

test('a room with a real patrol but patrolSpeed 0 is a template bug, not a pass', () => {
    const r = validateRoom({ ...GOOD, patrolSpeed: 0 });
    assert.equal(r.ok, false);
    assert.equal(r.postExists, false);
    assert.ok(r.errors.some((e) => e.includes('patrolSpeed')), r.errors.join('; '));
});

test('inCone boundary is exactly half the full cone angle, not the full angle', () => {
    const R = 100;
    const t29 = 29 * Math.PI / 180;
    const t31 = 31 * Math.PI / 180;
    assert.equal(inCone(R * Math.cos(t29), R * Math.sin(t29), 0, 0, 0, 220, SNEAK.CONE_ANGLE), true);
    assert.equal(inCone(R * Math.cos(t31), R * Math.sin(t31), 0, 0, 0, 220, SNEAK.CONE_ANGLE), false);
});

test('distanceToNearestHole respects a U-shaped wall, exact along-floor value', () => {
    const u = {
        grid: [
            '#######',
            '#.###.#',
            '#.###.#',
            '#.###.#',
            '#.....#',
            '#######',
        ],
        holes: [{ a: { x: 1, y: 1 }, b: { x: 1, y: 2 } }],
    };
    const d = distanceToNearestHole(u, SNEAK.CELL);
    assert.equal(d.get('5,1'), 360);
});

test('diagonal floor distance costs cell*SQRT2 and cannot cut a wall corner', () => {
    // open 2x2 block: (1,1) and (2,2) are diagonal neighbours through an open corner.
    // Both mouths sit on the single source cell (1,1) so the only path measured is the diagonal one.
    const openRoom = { grid: ['####', '#..#', '#..#', '####'], holes: [{ a: { x: 1, y: 1 }, b: { x: 1, y: 1 } }] };
    const d1 = distanceToNearestHole(openRoom, SNEAK.CELL);
    assert.equal(d1.get('2,2'), SNEAK.CELL * Math.SQRT2);

    // (1,1) and (2,2) touch only at a corner; both flanking cells are walls,
    // so they must NOT be treated as connected at all.
    const blockedRoom = { grid: ['####', '#.##', '##.#', '####'], holes: [{ a: { x: 1, y: 1 }, b: { x: 1, y: 1 } }] };
    const d2 = distanceToNearestHole(blockedRoom, SNEAK.CELL);
    assert.equal(d2.get('2,2'), undefined);
});

test('worstHoleDist boundary: 840px passes, 880px fails', () => {
    const corridor = (floorCols) => ({
        id: 'corridor',
        grid: [
            '#'.repeat(floorCols + 2),
            '#' + '.'.repeat(floorCols) + '#',
            '#'.repeat(floorCols + 2),
        ],
        entry: { x: 1, y: 1 },
        exits: [{ x: 1, y: 1 }, { x: floorCols, y: 1 }],
        holes: [{ a: { x: 1, y: 1 }, b: { x: 2, y: 1 } }],
        patrol: [],
        patrolSpeed: 0,
        windowMs: 4000,
        props: [],
        loot: { x: floorCols, y: 1 },
    });
    const pass = validateRoom(corridor(23));
    assert.equal(pass.worstHoleDist, 840);
    assert.equal(pass.holeReachable, true);

    const fail = validateRoom(corridor(24));
    assert.equal(fail.worstHoleDist, 880);
    assert.equal(fail.holeReachable, false);

    // 840/880 sit safely on either side of MAX_HOLE_DIST and can't tell <= apart from <.
    // Hit the threshold exactly (via a custom metrics.MAX_HOLE_DIST) to pin the comparator.
    const metrics = { ...SNEAK, MAX_HOLE_DIST: 800 };
    const atThreshold = validateRoom(corridor(22), metrics);
    assert.equal(atThreshold.worstHoleDist, 800);
    assert.equal(atThreshold.holeReachable, true);
});

test('exits must be an array of at least 2 distinct, floor, reachable cells', () => {
    const dup = validateRoom({ ...GOOD, exits: [{ x: 1, y: 1 }, { x: 1, y: 1 }] });
    assert.equal(dup.ok, false);
    assert.ok(dup.errors.some((e) => e.includes('distinct')), dup.errors.join('; '));

    const offGrid = validateRoom({ ...GOOD, exits: [{ x: 1, y: 1 }, { x: 99, y: 99 }] });
    assert.equal(offGrid.ok, false);
    assert.ok(offGrid.errors.some((e) => e.includes('floor')), offGrid.errors.join('; '));

    const notArray = validateRoom({ ...GOOD, exits: 'two' });
    assert.equal(notArray.ok, false);
    assert.ok(notArray.errors.some((e) => e.includes('exits')), notArray.errors.join('; '));
});

test('an exit that is floor but unreachable from the entry fails', () => {
    const room = {
        id: 'islands',
        grid: ['#######', '#.###.#', '#.###.#', '#######'],
        entry: { x: 1, y: 1 },
        exits: [{ x: 1, y: 1 }, { x: 5, y: 1 }],
        // a hole mouth in each island so this fails ONLY on exit reachability,
        // not incidentally on hole reachability too
        holes: [{ a: { x: 1, y: 1 }, b: { x: 1, y: 2 } }, { a: { x: 5, y: 1 }, b: { x: 5, y: 2 } }],
        patrol: [],
        patrolSpeed: 0,
        windowMs: 4000,
        props: [],
        loot: null,
    };
    const r = validateRoom(room);
    assert.equal(r.ok, false);
    assert.equal(r.holeReachable, true);
    assert.ok(r.errors.some((e) => e.includes('exit') && e.includes('reachable')), r.errors.join('; '));
});

test('an observation post candidate must be reachable from the entry, not just nearby', () => {
    const sealed = {
        id: 'sealed',
        grid: ['#######', '#.###.#', '#.###.#', '#######'],
        entry: { x: 1, y: 1 },
        exits: [{ x: 1, y: 1 }, { x: 1, y: 2 }],
        holes: [{ a: { x: 1, y: 1 }, b: { x: 1, y: 2 } }],
        patrol: [{ x: 1, y: 1 }, { x: 1, y: 2 }],
        patrolSpeed: 95,
        windowMs: 4000,
        props: [],
        loot: null,
    };
    const r = validateRoom(sealed);
    assert.equal(r.postExists, false);
    assert.equal(r.post, null);
});

test('a patrol that sweeps the entire near-entry box leaves no observation post', () => {
    const swept = {
        id: 'swept',
        grid: ['#'.repeat(15), '#' + '.'.repeat(12) + '#', '#'.repeat(15)],
        entry: { x: 1, y: 1 },
        exits: [{ x: 1, y: 1 }, { x: 12, y: 1 }],
        holes: [{ a: { x: 1, y: 1 }, b: { x: 12, y: 1 } }],
        patrol: [{ x: 2, y: 1 }, { x: 5, y: 1 }],
        patrolSpeed: 95,
        windowMs: 4000,
        props: [],
        loot: { x: 12, y: 1 },
    };
    const r = validateRoom(swept);
    assert.equal(r.postExists, false);
    assert.equal(r.post, null);
});

test('a hole mouth off the grid or on a wall is an explicit error', () => {
    const r = validateRoom({ ...GOOD, holes: [{ a: { x: 1, y: 4 }, b: { x: 0, y: 0 } }] });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('hole 0') && e.includes('mouth b')), r.errors.join('; '));
});

test('a hole with both mouths on the same cell is an explicit error', () => {
    const r = validateRoom({ ...GOOD, holes: [{ a: { x: 1, y: 4 }, b: { x: 1, y: 4 } }] });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('hole 0') && e.includes('same cell')), r.errors.join('; '));
});

test('a missing grid or entry produces errors instead of throwing', () => {
    assert.doesNotThrow(() => validateRoom({ id: 'broken' }));
    assert.doesNotThrow(() => validateRoom(undefined));
    assert.doesNotThrow(() => validateRoom(null));
    assert.equal(validateRoom(undefined).ok, false);
    const noGrid = validateRoom({ ...GOOD, grid: undefined });
    assert.equal(noGrid.ok, false);
    assert.ok(noGrid.errors.length > 0);

    const noEntry = validateRoom({ ...GOOD, entry: undefined });
    assert.equal(noEntry.ok, false);
    assert.ok(noEntry.errors.some((e) => e.includes('entry')), noEntry.errors.join('; '));
});

test('an unknown grid glyph is rejected', () => {
    const bad = { ...GOOD, grid: [...GOOD.grid] };
    bad.grid[2] = '#.X....#';
    const r = validateRoom(bad);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('glyph')), r.errors.join('; '));
});

test('a ragged grid row is rejected', () => {
    const bad = { ...GOOD, grid: [...GOOD.grid] };
    bad.grid[2] = '#.....#';
    const r = validateRoom(bad);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('length')), r.errors.join('; '));
});
