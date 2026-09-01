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

test('an old save with no stats.sneak is migrated, keeping its existing data', async () => {
    // Module state is cached in a module-level variable, so a plain re-read would
    // see the singleton. A cache-busting query string gives a genuinely fresh
    // module instance that loads from the seeded localStorage.
    store.clear();
    store.set('mousiePi.progress.v1', JSON.stringify({
        cheeseBank: 7,
        stats: { story: { runs: 3, wins: 2 } },
    }));
    const fresh = await import('../../www/js/storage/ProgressStore.js?migration');
    const s = fresh.Progress.getSneakStats();
    assert.equal(s.runs, 0, 'sneak slot filled in by deepMerge');
    assert.equal(s.clears, 0);
    assert.equal(s.captures, 0);
    assert.equal(s.ghostNights, 0);
    assert.equal(fresh.Progress.getCheese(), 7, 'existing bank preserved');
    assert.equal(fresh.Progress.state.stats.story.runs, 3, 'existing story stats preserved');
});
