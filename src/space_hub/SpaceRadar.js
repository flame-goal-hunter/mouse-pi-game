// ============================================================================
// SpaceRadar.js — Радар планет + вечная золотая стрелочка-компас «МОЙ ДОМ 🏠»
// + путеводная стрелочка к выбранному в OnlineHUD другу
// ============================================================================

import { SPACE_CONFIG } from './SpaceConfig.js';
import { PlayerProfile } from '../core/PlayerProfile.js';
import { getPersonalPlanetCoords } from './PersonalPlanetSystem.js';

export class SpaceRadar {
    draw(ctx, camX, camY, viewW, viewH, timeSec, trackedTarget = null) {
        const halfW = viewW / 2;
        const halfH = viewH / 2;
        const padX = Math.min(72, viewW * 0.1);
        const padY = Math.min(82, viewH * 0.15);
        const rx = Math.max(80, halfW - padX);
        const ry = Math.max(70, halfH - padY);

        for (const p of SPACE_CONFIG.planets) {
            const dx = p.x - camX;
            const dy = p.y - camY;
            if (Math.abs(dx) < halfW - p.radius * 0.5 && Math.abs(dy) < halfH - p.radius * 0.5) continue;
            const emoji = (p.badge || '🪐').split(' ')[0];
            this._drawIndicator(ctx, dx, dy, p.radius, halfW, halfH, rx, ry, p.coreColor, emoji, null, timeSec + p.x * 0.01, false);
        }

        // Golden compass arrow to the player's own Home Planet ("МОЙ ДОМ 🏠")
        const myHome = getPersonalPlanetCoords(PlayerProfile.playerId);
        const hdx = myHome.x - camX;
        const hdy = myHome.y - camY;
        if (Math.hypot(hdx, hdy) > 220) {
            this._drawIndicator(
                ctx, hdx, hdy, 76, halfW, halfH, rx * 0.92, ry * 0.92,
                '#facc15', '🏠', 'МОЙ ДОМ', timeSec * 1.6, true
            );
        }

        if (trackedTarget) {
            const dx = trackedTarget.x - camX;
            const dy = trackedTarget.y - camY;
            this._drawIndicator(
                ctx, dx, dy, 25, halfW, halfH, rx * 0.84, ry * 0.84,
                trackedTarget.color || '#22d3ee',
                trackedTarget.badge || '🧭',
                trackedTarget.label,
                timeSec * 2,
                true
            );
        }
    }

    _drawIndicator(ctx, dx, dy, rad, halfW, halfH, rx, ry, color, emoji, label, phase, isHighlighted) {
        const angle = Math.atan2(dy, dx);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const edgeDist = 1 / Math.hypot(cos / rx, sin / ry);
        const rawDist = Math.hypot(dx, dy);
        const clampDist = isHighlighted ? Math.min(rawDist * 0.65, edgeDist) : edgeDist;
        if (clampDist < 42) return;

        const ix = halfW + cos * clampDist;
        const iy = halfH + sin * clampDist;
        const distMeters = Math.max(5, Math.round((rawDist - rad) / 4));
        const pulse = (isHighlighted ? 1.04 : 0.88) + Math.sin(phase * 4) * 0.12;

        ctx.save();
        ctx.translate(ix, iy);

        ctx.fillStyle = isHighlighted ? 'rgba(15, 23, 42, 0.94)' : 'rgba(15, 23, 42, 0.82)';
        ctx.strokeStyle = color;
        ctx.lineWidth = isHighlighted ? 3 : 2;
        ctx.beginPath();
        ctx.arc(0, 0, (isHighlighted ? 24 : 21) * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.save();
        ctx.rotate(angle);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(33, 0);
        ctx.lineTo(21, -7.5);
        ctx.lineTo(24, 0);
        ctx.lineTo(21, 7.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        ctx.font = '14px "Nunito", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(emoji, 0, -4);

        ctx.font = '800 9.5px "Nunito", sans-serif';
        ctx.fillStyle = isHighlighted ? '#fde047' : '#e2e8f0';
        ctx.fillText(`${distMeters}м`, 0, 10);

        if (label) {
            ctx.font = '900 10.5px "Nunito", sans-serif';
            ctx.fillStyle = color;
            ctx.fillText(label, 0, 33);
        }
        ctx.restore();
    }
}
