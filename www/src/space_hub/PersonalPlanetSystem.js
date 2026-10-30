// ============================================================================
// PersonalPlanetSystem.js — Генерация координат Пояса Домашних Планет,
// уникального внешнего вида planetAppearance (biome + ringType) и отрисовка
// ============================================================================

import { BIOME_CATALOG, RING_CATALOG, getBiomeDef, drawStyledPlanet } from './PlanetStyleRenderer.js';

export function hashString(str = '') {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return Math.abs(h);
}

export function getPersonalPlanetCoords(playerId) {
    const h = hashString(playerId || 'default');
    const slot = h % 28;
    const angle = (slot / 28) * Math.PI * 2 + 0.18;
    const radius = 1180 + (slot % 3) * 165;
    return {
        x: Math.round(Math.cos(angle) * radius),
        y: Math.round(Math.sin(angle) * radius)
    };
}

export function getDefaultAppearance(playerId, nickname = '') {
    const h = hashString(`${playerId}_${nickname}`);
    const biome = BIOME_CATALOG[h % BIOME_CATALOG.length];
    const ring = RING_CATALOG[(h >> 3) % RING_CATALOG.length];
    return {
        biome: biome.id,
        ringType: ring.id,
        baseColor: biome.baseColor,
        accentColor: biome.accentColor,
        atmosphereGlow: biome.atmo
    };
}

export function normalizeAppearance(app = {}) {
    const b = getBiomeDef(app.biome || 'cheesy');
    const r = RING_CATALOG.find(x => x.id === app.ringType) || RING_CATALOG[0];
    return {
        biome: b.id,
        biomeName: b.name,
        ringType: r.id,
        ringName: r.name,
        baseColor: b.baseColor,
        accentColor: b.accentColor,
        atmosphereGlow: b.atmo
    };
}

export function drawPersonalPlanetVisual(ctx, radius, app, storedCheese, timeSec) {
    const norm = normalizeAppearance(app);
    drawStyledPlanet(ctx, radius, norm, timeSec, { storedCheese: storedCheese || 0 });
}
