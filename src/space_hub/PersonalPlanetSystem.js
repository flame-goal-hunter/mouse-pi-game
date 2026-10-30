// ============================================================================
// PersonalPlanetSystem.js — Генерация координат Пояса Домашних Планет,
// уникального внешнего вида planetAppearance и отрисовка планеты с Горой Сыра
// ============================================================================

export const PLANET_THEMES = [
    { name: 'Сырное Золото',   baseColor: '#fde047', accentColor: '#d97706', atmosphereGlow: 'rgba(250, 204, 21, 0.42)' },
    { name: 'Розовый Кварц',   baseColor: '#f472b6', accentColor: '#be185d', atmosphereGlow: 'rgba(244, 114, 182, 0.42)' },
    { name: 'Бирюзовая Лагуна',baseColor: '#2dd4bf', accentColor: '#0f766e', atmosphereGlow: 'rgba(45, 212, 191, 0.42)' },
    { name: 'Лавандовый Сон',  baseColor: '#c084fc', accentColor: '#6b21a8', atmosphereGlow: 'rgba(192, 132, 252, 0.44)' },
    { name: 'Изумрудный Луг',  baseColor: '#4ade80', accentColor: '#15803d', atmosphereGlow: 'rgba(74, 222, 128, 0.42)' },
    { name: 'Коралловый Закат',baseColor: '#fb7185', accentColor: '#9f1239', atmosphereGlow: 'rgba(251, 113, 133, 0.42)' },
    { name: 'Сапфировый Бриз', baseColor: '#60a5fa', accentColor: '#1d4ed8', atmosphereGlow: 'rgba(96, 165, 250, 0.42)' }
];

export const RING_TYPES = ['single', 'double', 'tilted', 'none'];
export const CRATER_STYLES = ['craters', 'stripes', 'swirls'];

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
    const theme = PLANET_THEMES[h % PLANET_THEMES.length];
    return {
        baseColor: theme.baseColor,
        accentColor: theme.accentColor,
        atmosphereGlow: theme.atmosphereGlow,
        ringType: RING_TYPES[(h >> 3) % RING_TYPES.length],
        craterStyle: CRATER_STYLES[(h >> 5) % CRATER_STYLES.length]
    };
}

export function cyclePlanetAppearance(cur = {}) {
    const curIdx = Math.max(0, PLANET_THEMES.findIndex(t => t.baseColor === cur.baseColor));
    const nextTheme = PLANET_THEMES[(curIdx + 1) % PLANET_THEMES.length];
    const rIdx = Math.max(0, RING_TYPES.indexOf(cur.ringType));
    const cIdx = Math.max(0, CRATER_STYLES.indexOf(cur.craterStyle));
    return {
        baseColor: nextTheme.baseColor,
        accentColor: nextTheme.accentColor,
        atmosphereGlow: nextTheme.atmosphereGlow,
        ringType: RING_TYPES[(rIdx + 1) % RING_TYPES.length],
        craterStyle: CRATER_STYLES[(cIdx + 1) % CRATER_STYLES.length],
        themeName: nextTheme.name
    };
}

export function drawPersonalPlanetVisual(ctx, radius, app, storedCheese, timeSec) {
    const style = app || PLANET_THEMES[0];

    // 1. Atmosphere glow
    const atmo = ctx.createRadialGradient(0, 0, radius * 0.72, 0, 0, radius * 1.55);
    atmo.addColorStop(0, style.atmosphereGlow || 'rgba(250, 204, 21, 0.4)');
    atmo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = atmo;
    ctx.beginPath(); ctx.arc(0, 0, radius * 1.55, 0, Math.PI * 2); ctx.fill();

    // 2. Miniature Cheese Mountain on the crown of the planet (visible from space!)
    const cheeseRatio = Math.min(1, Math.max(0, (storedCheese || 0)) / 900);
    const moundH = 10 + cheeseRatio * 34;
    const moundW = 20 + cheeseRatio * 22;
    ctx.save();
    ctx.translate(0, -radius + 5);
    const cg = ctx.createLinearGradient(0, -moundH, 0, 4);
    cg.addColorStop(0, '#fef08a');
    cg.addColorStop(1, '#ca8a04');
    ctx.fillStyle = cg;
    ctx.strokeStyle = '#a16207';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-moundW, 4);
    ctx.quadraticCurveTo(0, -moundH * 1.5, moundW, 4);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fde047';
    ctx.font = '800 10px "Nunito", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`🧀${storedCheese || 0}`, 0, -moundH * 0.75 - 4);
    ctx.restore();

    // 3. Planet sphere body
    const bodyG = ctx.createRadialGradient(-radius * 0.3, -radius * 0.3, radius * 0.1, 0, 0, radius);
    bodyG.addColorStop(0, style.baseColor || '#fde047');
    bodyG.addColorStop(0.7, style.accentColor || '#d97706');
    bodyG.addColorStop(1, '#0f172a');
    ctx.fillStyle = bodyG;
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill();

    // 4. Surface pattern (craters / stripes / swirls) + 2D crescent shadow
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    if (style.craterStyle === 'stripes') {
        ctx.fillRect(-radius, -radius * 0.38, radius * 2, radius * 0.22);
        ctx.fillRect(-radius, radius * 0.12, radius * 2, radius * 0.18);
    } else if (style.craterStyle === 'swirls') {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(-radius * 0.1, 0, radius * 0.55, 0.2, 4.2); ctx.stroke();
    } else {
        ctx.beginPath(); ctx.arc(-radius * 0.28, -radius * 0.2, radius * 0.18, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(radius * 0.22, radius * 0.26, radius * 0.14, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(4, 7, 20, 0.35)';
    ctx.beginPath(); ctx.arc(radius * 0.36, radius * 0.12, radius * 0.95, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // 5. Planetary rings
    if (style.ringType && style.ringType !== 'none') {
        ctx.save();
        ctx.rotate(style.ringType === 'tilted' ? 0.52 : -0.28 + Math.sin(timeSec) * 0.05);
        ctx.strokeStyle = style.baseColor || '#fde047';
        ctx.globalAlpha = 0.72;
        ctx.lineWidth = 4.5;
        ctx.beginPath();
        ctx.ellipse(0, 0, radius * 1.42, radius * 0.34, 0, 0.12 * Math.PI, 0.88 * Math.PI);
        ctx.stroke();
        if (style.ringType === 'double') {
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.ellipse(0, 0, radius * 1.62, radius * 0.42, 0, 0.1 * Math.PI, 0.9 * Math.PI);
            ctx.stroke();
        }
        ctx.restore();
    }
}
