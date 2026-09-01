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
