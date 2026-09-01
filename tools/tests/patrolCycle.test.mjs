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
