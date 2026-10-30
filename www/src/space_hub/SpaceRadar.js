// ============================================================================
// SpaceRadar.js — Мягкие стрелочки-индикаторы (радар) по краям экрана,
// указывающие направление и расстояние до планет за пределами кадра
// ============================================================================

import { SPACE_CONFIG } from './SpaceConfig.js';

export class SpaceRadar {
    draw(ctx, camX, camY, viewW, viewH, timeSec) {
        const halfW = viewW / 2;
        const halfH = viewH / 2;
        const padX = Math.min(72, viewW * 0.1);
        const padY = Math.min(76, viewH * 0.13);
        const rx = Math.max(80, halfW - padX);
        const ry = Math.max(70, halfH - padY);

        for (const p of SPACE_CONFIG.planets) {
            const dx = p.x - camX;
            const dy = p.y - camY;
            if (Math.abs(dx) < halfW - p.radius * 0.5 && Math.abs(dy) < halfH - p.radius * 0.5) {
                continue;
            }

            const angle = Math.atan2(dy, dx);
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const t = 1 / Math.hypot(cos / rx, sin / ry);
            const ix = halfW + cos * t;
            const iy = halfH + sin * t;
            const distMeters = Math.max(10, Math.round((Math.hypot(dx, dy) - p.radius) / 4));
            const pulse = 0.85 + Math.sin(timeSec * 4 + p.x * 0.01) * 0.15;

            ctx.save();
            ctx.translate(ix, iy);

            // Soft radar pill background
            ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
            ctx.strokeStyle = p.coreColor;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, 22 * pulse, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Directional pointer chevron on outer edge
            ctx.save();
            ctx.rotate(angle);
            ctx.fillStyle = p.coreColor;
            ctx.beginPath();
            ctx.moveTo(31, 0);
            ctx.lineTo(21, -7);
            ctx.lineTo(23, 0);
            ctx.lineTo(21, 7);
            ctx.closePath();
            ctx.fill();
            ctx.restore();

            // Planet emoji icon & distance
            const emoji = (p.badge || '🪐').split(' ')[0];
            ctx.font = '14px "Nunito", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(emoji, 0, -3);

            ctx.font = '800 9.5px "Nunito", sans-serif';
            ctx.fillStyle = '#e2e8f0';
            ctx.fillText(`${distMeters}м`, 0, 11);

            ctx.restore();
        }
    }
}
