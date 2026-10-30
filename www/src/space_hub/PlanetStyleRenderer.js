// ============================================================================
// PlanetStyleRenderer.js — Процедурная 2D-отрисовка 6 биомов планет,
// честных двухпроходных 3D-колец и спутников (задняя и передняя дуги)
// ============================================================================

export const BIOME_CATALOG = [
    { id: 'snowy',  name: '❄️ Снежная',   baseColor: '#7dd3fc', accentColor: '#0284c7', atmo: 'rgba(125, 211, 252, 0.45)', ringCol: '#bae6fd' },
    { id: 'cheesy', name: '🧀 Сырная',    baseColor: '#fde047', accentColor: '#d97706', atmo: 'rgba(250, 204, 21, 0.45)',  ringCol: '#fef08a' },
    { id: 'candy',  name: '🍬 Конфетная', baseColor: '#f472b6', accentColor: '#db2777', atmo: 'rgba(244, 114, 182, 0.45)', ringCol: '#6ee7b7' },
    { id: 'lava',   name: '🌋 Лавовая',   baseColor: '#fb923c', accentColor: '#3b0764', atmo: 'rgba(249, 115, 22, 0.48)',  ringCol: '#fdba74' },
    { id: 'jungle', name: '🌴 Джунгли',   baseColor: '#4ade80', accentColor: '#0284c7', atmo: 'rgba(74, 222, 128, 0.45)',  ringCol: '#86efac' },
    { id: 'cyber',  name: '💿 Неон',      baseColor: '#22d3ee', accentColor: '#1e1b4b', atmo: 'rgba(34, 211, 238, 0.48)',  ringCol: '#f472b6' }
];

export const RING_CATALOG = [
    { id: 'saturn',    name: '🪐 Кольца Сатурна' },
    { id: 'belt',      name: '☄️ Пояс осколков' },
    { id: 'satellite', name: '🌙 Спутник-пончик' },
    { id: 'halo',      name: '🌈 Неоновое гало' }
];

export function getBiomeDef(biomeId) {
    return BIOME_CATALOG.find(b => b.id === biomeId) || BIOME_CATALOG[1];
}

export function drawStyledPlanet(ctx, R, style = {}, timeSec = 0, opts = {}) {
    const b = getBiomeDef(style.biome || 'cheesy');
    const ringType = style.ringType || 'saturn';
    const sx = opts.sx || 1, sy = opts.sy || 1;

    // 1. Атмосферное свечение
    const atmo = ctx.createRadialGradient(0, 0, R * 0.72, 0, 0, R * 1.58);
    atmo.addColorStop(0, b.atmo); atmo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = atmo; ctx.beginPath(); ctx.arc(0, 0, R * 1.58, 0, Math.PI * 2); ctx.fill();

    // 2. Задняя половина колец / спутника (ДО круга планеты)
    _drawOrbitHalf(ctx, R, ringType, b, timeSec, false);

    ctx.save();
    ctx.scale(sx, sy);

    // 3. Внешний рельеф на кромке сферы (вулканы / кроны деревьев / Гора Сыра)
    _drawRimDetails(ctx, R, b.id, timeSec, opts.storedCheese);

    // 4. Сфера планеты с ctx.clip() и уникальным биомом внутри
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.clip();
    _drawBiomeSurface(ctx, R, b, timeSec);

    // Полупрозрачный серп ночной тени и солнечный блик для объёма
    ctx.fillStyle = 'rgba(4, 7, 22, 0.38)';
    ctx.beginPath(); ctx.arc(R * 0.36, R * 0.14, R * 0.96, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.26)';
    ctx.beginPath(); ctx.ellipse(-R * 0.36, -R * 0.36, R * 0.24, R * 0.13, -0.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.restore();

    // 5. Живые частицы биома + Передняя половина колец / спутника (ПОВЕРХ круга планеты)
    _drawBiomeAmbient(ctx, R, b.id, timeSec);
    _drawOrbitHalf(ctx, R, ringType, b, timeSec, true);
}

function _drawRimDetails(ctx, R, biomeId, timeSec, storedCheese) {
    if (biomeId === 'lava') {
        [-2.1, -0.7, 0.85, 2.3].forEach((ang, i) => {
            ctx.save(); ctx.rotate(ang); ctx.translate(0, -R);
            ctx.fillStyle = '#4c1d95';
            ctx.beginPath(); ctx.moveTo(-R * 0.16, 4); ctx.lineTo(-R * 0.07, -R * 0.12); ctx.lineTo(R * 0.07, -R * 0.12); ctx.lineTo(R * 0.16, 4); ctx.fill();
            ctx.fillStyle = '#fb923c';
            ctx.beginPath(); ctx.arc(0, -R * 0.12, R * (0.04 + 0.02 * Math.sin(timeSec * 6 + i)), 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        });
    } else if (biomeId === 'jungle') {
        [-2.4, -1.35, -0.35, 0.65, 1.75].forEach((ang, i) => {
            ctx.save(); ctx.rotate(ang); ctx.translate(0, -R);
            ctx.fillStyle = '#78350f'; ctx.fillRect(-3, -R * 0.1, 6, R * 0.14);
            ctx.fillStyle = i % 2 === 0 ? '#22c55e' : '#4ade80';
            ctx.beginPath(); ctx.arc(0, -R * 0.13, R * 0.13, 0, Math.PI * 2);
            ctx.arc(-R * 0.08, -R * 0.09, R * 0.09, 0, Math.PI * 2); ctx.arc(R * 0.08, -R * 0.09, R * 0.09, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        });
    }
    if (typeof storedCheese === 'number') {
        const ratio = Math.min(1, Math.max(0, storedCheese) / 900);
        const mh = 10 + ratio * 32, mw = 18 + ratio * 22;
        ctx.save(); ctx.translate(0, -R + 5);
        const cg = ctx.createLinearGradient(0, -mh, 0, 4);
        cg.addColorStop(0, '#fef08a'); cg.addColorStop(1, '#ca8a04');
        ctx.fillStyle = cg; ctx.strokeStyle = '#a16207'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-mw, 4); ctx.quadraticCurveTo(0, -mh * 1.45, mw, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fde047'; ctx.font = '800 10px "Nunito", sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(`🧀${storedCheese}`, 0, -mh * 0.75 - 4);
        ctx.restore();
    }
}

function _drawBiomeSurface(ctx, R, b, timeSec) {
    const g = ctx.createRadialGradient(-R * 0.3, -R * 0.3, R * 0.08, 0, 0, R);
    g.addColorStop(0, b.baseColor); g.addColorStop(0.7, b.accentColor); g.addColorStop(1, '#090d1e');
    ctx.fillStyle = g; ctx.fillRect(-R, -R, R * 2, R * 2);

    if (b.id === 'snowy') {
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath(); ctx.ellipse(0, -R * 0.78, R * 0.85, R * 0.34, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(0, R * 0.82, R * 0.78, R * 0.28, 0, 0, Math.PI * 2); ctx.fill();
        for (let i = -4; i <= 4; i++) {
            const ix = i * R * 0.16, ih = R * (0.14 + (Math.abs(i) % 2) * 0.08);
            ctx.beginPath(); ctx.moveTo(ix - R * 0.05, -R * 0.52); ctx.lineTo(ix, -R * 0.52 + ih); ctx.lineTo(ix + R * 0.05, -R * 0.52); ctx.fill();
        }
        ctx.fillStyle = 'rgba(224, 242, 254, 0.75)';
        [[-0.35, 0.05], [0.28, -0.1], [0.1, 0.28]].forEach(([cx, cy]) => {
            ctx.save(); ctx.translate(cx * R, cy * R); ctx.rotate(0.45); ctx.fillRect(-R * 0.08, -R * 0.08, R * 0.16, R * 0.16); ctx.restore();
        });
    } else if (b.id === 'cheesy') {
        [[-0.32, -0.22, 0.2], [0.26, -0.18, 0.14], [-0.12, 0.28, 0.18], [0.32, 0.26, 0.12], [-0.45, 0.15, 0.11]].forEach(([x, y, r]) => {
            ctx.fillStyle = '#a16207'; ctx.beginPath(); ctx.arc(x * R, y * R, r * R, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#ca8a04'; ctx.beginPath(); ctx.arc((x + 0.03) * R, (y + 0.03) * R, r * R * 0.78, 0, Math.PI * 2); ctx.fill();
        });
    } else if (b.id === 'candy') {
        for (let y = -R; y < R; y += R * 0.34) {
            ctx.fillStyle = Math.round((y + R) / (R * 0.34)) % 2 === 0 ? 'rgba(110, 231, 183, 0.55)' : 'rgba(251, 207, 232, 0.65)';
            ctx.beginPath(); ctx.moveTo(-R, y); ctx.bezierCurveTo(-R * 0.3, y + R * 0.18, R * 0.3, y - R * 0.18, R, y);
            ctx.lineTo(R, y + R * 0.18); ctx.lineTo(-R, y + R * 0.18); ctx.closePath(); ctx.fill();
        }
        ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
        [[-0.28, -0.15], [0.25, 0.2]].forEach(([x, y]) => {
            ctx.beginPath(); ctx.arc(x * R, y * R, R * 0.16, 0, Math.PI * 2); ctx.arc((x + 0.12) * R, y * R, R * 0.12, 0, Math.PI * 2); ctx.fill();
        });
    } else if (b.id === 'lava') {
        ctx.fillStyle = '#2e1065'; ctx.fillRect(-R, -R, R * 2, R * 2);
        ctx.strokeStyle = '#fb923c'; ctx.lineWidth = Math.max(2.5, R * 0.055); ctx.lineCap = 'round';
        [[-0.6, -0.3, -0.1, 0.05, 0.45, -0.2], [-0.4, 0.35, 0.05, 0.15, 0.55, 0.4], [-0.1, -0.6, 0.12, -0.1, -0.2, 0.5]].forEach(pts => {
            ctx.beginPath(); ctx.moveTo(pts[0] * R, pts[1] * R); ctx.lineTo(pts[2] * R, pts[3] * R); ctx.lineTo(pts[4] * R, pts[5] * R); ctx.stroke();
        });
    } else if (b.id === 'jungle') {
        ctx.fillStyle = '#0284c7'; ctx.fillRect(-R, -R, R * 2, R * 2);
        ctx.fillStyle = '#22c55e';
        [[-0.32, -0.22, 0.44], [0.28, 0.18, 0.38], [-0.15, 0.42, 0.3]].forEach(([x, y, r]) => {
            ctx.beginPath(); ctx.arc(x * R, y * R, r * R, 0, Math.PI * 2); ctx.fill();
        });
    } else if (b.id === 'cyber') {
        ctx.fillStyle = '#0f172a'; ctx.fillRect(-R, -R, R * 2, R * 2);
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.55)'; ctx.lineWidth = 1.6;
        for (let i = -3; i <= 3; i++) {
            ctx.beginPath(); ctx.ellipse(0, i * R * 0.26, R, R * 0.12, 0, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.ellipse(0, 0, Math.abs(i) * R * 0.28, R, 0, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.fillStyle = 'rgba(244, 114, 182, 0.42)';
        ctx.fillRect(-R, ((timeSec * 40) % (R * 1.6)) - R * 0.8, R * 2, R * 0.12);
    }
}

function _drawBiomeAmbient(ctx, R, biomeId, timeSec) {
    const colors = { snowy: '#ffffff', cheesy: '#facc15', candy: '#f472b6', lava: '#fb923c', jungle: '#bef264', cyber: '#22d3ee' };
    ctx.fillStyle = colors[biomeId] || '#fde047';
    for (let i = 0; i < 6; i++) {
        const a = timeSec * (0.7 + (i % 2) * 0.3) + i * 1.05, dist = R * (1.14 + Math.sin(timeSec * 2 + i) * 0.08);
        const px = Math.cos(a) * dist, py = Math.sin(a) * dist;
        if (biomeId === 'candy') {
            ctx.fillStyle = ['#f472b6', '#6ee7b7', '#fde047', '#60a5fa'][i % 4];
            ctx.save(); ctx.translate(px, py); ctx.rotate(a); ctx.fillRect(-4, -2, 8, 4); ctx.restore();
        } else if (biomeId === 'cyber') ctx.fillRect(px - 2.5, py - 2.5, 5, 5);
        else { ctx.beginPath(); ctx.arc(px, py, biomeId === 'cheesy' ? 4 : 2.6, 0, Math.PI * 2); ctx.fill(); }
    }
}

function _drawOrbitHalf(ctx, R, ringType, b, timeSec, isFront) {
    if (!ringType || ringType === 'none') return;
    const startA = isFront ? 0 : Math.PI, endA = isFront ? Math.PI : Math.PI * 2;
    ctx.save(); ctx.rotate(-0.32 + Math.sin(timeSec * 0.7) * 0.05);
    if (ringType === 'saturn') {
        ctx.strokeStyle = b.ringCol; ctx.globalAlpha = 0.78; ctx.lineWidth = Math.max(4, R * 0.08);
        ctx.beginPath(); ctx.ellipse(0, 0, R * 1.48, R * 0.38, 0, startA, endA); ctx.stroke();
        ctx.strokeStyle = b.baseColor; ctx.globalAlpha = 0.48; ctx.lineWidth = Math.max(2, R * 0.04);
        ctx.beginPath(); ctx.ellipse(0, 0, R * 1.68, R * 0.45, 0, startA, endA); ctx.stroke();
    } else if (ringType === 'halo') {
        ['#f472b6', '#fde047', '#22d3ee'].forEach((col, idx) => {
            ctx.strokeStyle = col; ctx.globalAlpha = 0.65; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.ellipse(0, 0, R * (1.38 + idx * 0.1), R * (0.34 + idx * 0.04), 0, startA, endA); ctx.stroke();
        });
    } else if (ringType === 'belt') {
        for (let i = 0; i < 14; i++) {
            const a = (i / 14) * Math.PI * 2 + timeSec * 0.65;
            if ((Math.sin(a) >= 0) !== isFront) continue;
            ctx.fillStyle = i % 2 === 0 ? b.ringCol : b.baseColor;
            ctx.beginPath(); ctx.arc(Math.cos(a) * R * 1.52, Math.sin(a) * R * 0.4, Math.max(3, R * 0.055), 0, Math.PI * 2); ctx.fill();
        }
    } else if (ringType === 'satellite') {
        ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(0, 0, R * 1.55, R * 0.42, 0, startA, endA); ctx.stroke();
        const sa = timeSec * 1.35;
        if ((Math.sin(sa) >= 0) === isFront) {
            const sx = Math.cos(sa) * R * 1.55, sy = Math.sin(sa) * R * 0.42, sr = Math.max(7, R * 0.12);
            ctx.fillStyle = '#f472b6'; ctx.strokeStyle = '#fef08a'; ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#0f172a'; ctx.beginPath(); ctx.arc(sx, sy, sr * 0.35, 0, Math.PI * 2); ctx.fill();
        }
    }
    ctx.restore();
}
