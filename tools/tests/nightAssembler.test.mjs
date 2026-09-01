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
