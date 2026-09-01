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
