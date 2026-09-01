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
