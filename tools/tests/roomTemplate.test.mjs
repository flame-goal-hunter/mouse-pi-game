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
