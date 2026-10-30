// ============================================================================
// HomePlanetRenderer.js — Отрисовка круглой Домашней Планеты (своей и в гостях),
// растущей Горы Сыра, Гардероба, Космодрома и совместного бега игроков в реальном времени
// ============================================================================

import { PlayerProfile, getPlayerSkinSprite } from '../core/PlayerProfile.js';

export const HOME_ZONES = [
    { id: 'cosmodrome', angle: 0,     name: '🚀 Космодром',        actionLabel: 'ВЗЛЁТ!',    icon: '🚀', hint: 'Вернуться на карту Космоса' },
    { id: 'storage',    angle: -1.05, name: '🧀 Хранилище Сыра',   actionLabel: 'ВЫГРУЗИТЬ', icon: '🧀', hint: 'Сложить сыр из ракеты на Склад' },
    { id: 'wardrobe',   angle: 1.05,  name: '👗 Гардероб Скинов',  actionLabel: 'ГАРДЕРОБ',  icon: '👗', hint: 'Купить и надеть скин Мышонка Пи' }
];

export class HomePlanetRenderer {
    draw(ctx, viewW, viewH, state, timeSec, peersOnPlanet = []) {
        const cx = viewW / 2, cy = viewH * 0.62, R = Math.min(viewW, viewH) * 0.34;
        const sky = ctx.createRadialGradient(cx, cy, R * 0.5, cx, cy, Math.max(viewW, viewH));
        sky.addColorStop(0, '#1e1b4b'); sky.addColorStop(0.55, '#0f172a'); sky.addColorStop(1, '#040613');
        ctx.fillStyle = sky; ctx.fillRect(0, 0, viewW, viewH);

        for (let i = 0; i < 55; i++) {
            const sx = (i * 193) % viewW, sy = (i * 131) % Math.round(viewH * 0.75);
            ctx.fillStyle = `rgba(254, 240, 138, ${0.35 + 0.45 * Math.sin(timeSec * 2 + i)})`;
            ctx.beginPath(); ctx.arc(sx, sy, 1.2 + (i % 2), 0, Math.PI * 2); ctx.fill();
        }

        ctx.save();
        ctx.translate(cx, cy);
        const atmo = ctx.createRadialGradient(0, 0, R * 0.85, 0, 0, R * 1.48);
        atmo.addColorStop(0, 'rgba(250, 204, 21, 0.36)'); atmo.addColorStop(0.6, 'rgba(56, 189, 248, 0.14)'); atmo.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = atmo; ctx.beginPath(); ctx.arc(0, 0, R * 1.48, 0, Math.PI * 2); ctx.fill();

        const storedCheese = state.isVisiting
            ? (state.visitData?.homeSnapshot?.storedCheese || 0)
            : PlayerProfile.storedCheese;

        ctx.save();
        ctx.rotate(-state.playerAngle * 0.55);
        for (const z of HOME_ZONES) {
            ctx.save(); ctx.rotate(z.angle); ctx.translate(0, -R);
            const isNear = state.activeZone?.id === z.id;
            if (z.id === 'storage') this._drawStorageSilo(ctx, isNear, timeSec, storedCheese);
            else if (z.id === 'wardrobe') this._drawWardrobeBoutique(ctx, isNear, timeSec, state.isVisiting);
            else if (z.id === 'cosmodrome') this._drawCosmodrome(ctx, isNear, state.launchProgress, timeSec);
            ctx.restore();
        }

        const bodyG = ctx.createRadialGradient(-R * 0.25, -R * 0.3, R * 0.1, 0, 0, R);
        bodyG.addColorStop(0, '#fde047'); bodyG.addColorStop(0.68, '#eab308'); bodyG.addColorStop(1, '#a16207');
        ctx.fillStyle = bodyG; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 12;
        ctx.beginPath(); ctx.arc(0, 0, R - 4, 0, Math.PI * 2); ctx.stroke();

        ctx.fillStyle = 'rgba(161, 98, 7, 0.28)';
        [[-0.35, -0.45, 0.12], [0.4, -0.35, 0.1], [0.05, -0.6, 0.08], [-0.45, 0.2, 0.14], [0.35, 0.3, 0.11]].forEach(([x, y, r]) => {
            ctx.beginPath(); ctx.arc(x * R, y * R, r * R, 0, Math.PI * 2); ctx.fill();
        });

        // Draw remote players (host / guests) running on this planet in real time
        for (const peer of peersOnPlanet) {
            this._drawSurfaceMouse(
                ctx, R, peer.rHomeAngle || 0, peer.facing || 1,
                Boolean(peer.moving), peer.equippedSkinId, peer.nickname || 'Пи', timeSec, true
            );
        }

        // Draw local Mousie Pi
        if (state.launchProgress <= 0.05) {
            this._drawSurfaceMouse(
                ctx, R, state.playerAngle, state.facing,
                state.moving, PlayerProfile.equippedSkinId, PlayerProfile.nickname, timeSec, false
            );
        }

        for (const fw of state.flyingCheese) {
            const pAngle = fw.startAngle + (HOME_ZONES[1].angle - fw.startAngle) * fw.t;
            const arcH = R + 28 + Math.sin(fw.t * Math.PI) * 75;
            ctx.save();
            ctx.translate(Math.sin(pAngle) * arcH, -Math.cos(pAngle) * arcH);
            ctx.rotate(fw.t * 10);
            ctx.fillStyle = '#facc15'; ctx.strokeStyle = '#ca8a04'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(-9, 6); ctx.lineTo(10, 6); ctx.lineTo(2, -9); ctx.closePath();
            ctx.fill(); ctx.stroke();
            ctx.restore();
        }

        ctx.restore();
        ctx.restore();
    }

    _drawSurfaceMouse(ctx, R, angle, facing, moving, skinId, nickname, timeSec, isRemote) {
        ctx.save();
        ctx.rotate(angle);
        ctx.translate(0, -R - 26);

        ctx.font = '900 11.5px "Nunito", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = isRemote ? '#4ade80' : '#fef08a';
        ctx.fillText(nickname, 0, -35);

        if (facing < 0) ctx.scale(-1, 1);
        const skin = getPlayerSkinSprite(skinId);
        const img = moving ? (Math.floor(timeSec * 9) % 2 === 0 ? skin.walk1 : skin.walk2) : skin.idle;
        if (img && img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, -28, -30, 56, 56);
        } else {
            ctx.fillStyle = skin.bodyColor || '#38bdf8';
            ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
    }

    _drawStorageSilo(ctx, isNear, timeSec, stored) {
        const fillRatio = Math.min(1, stored / 1200);
        const moundH = 14 + fillRatio * 58;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
        ctx.strokeStyle = isNear ? '#4ade80' : '#facc15';
        ctx.lineWidth = isNear ? 4 : 2.5;
        ctx.beginPath(); ctx.roundRect(-42, -88, 84, 88, [28, 28, 6, 6]); ctx.fill(); ctx.stroke();

        const grad = ctx.createLinearGradient(0, -moundH, 0, 0);
        grad.addColorStop(0, '#fef08a'); grad.addColorStop(1, '#d97706');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.moveTo(-36, -4); ctx.quadraticCurveTo(0, -moundH - 22, 36, -4); ctx.closePath(); ctx.fill();

        ctx.font = '900 13px "Nunito", sans-serif';
        ctx.textAlign = 'center'; ctx.fillStyle = '#fde047';
        ctx.fillText(`🧀 СКЛАД: ${stored}`, 0, -98 - Math.sin(timeSec * 3) * 2);
    }

    _drawWardrobeBoutique(ctx, isNear, timeSec, isVisiting) {
        ctx.fillStyle = '#3b0764';
        ctx.strokeStyle = isNear ? '#4ade80' : '#e879f9';
        ctx.lineWidth = isNear ? 4 : 2.5;
        ctx.beginPath(); ctx.arc(0, -34, 38, Math.PI, 0); ctx.lineTo(38, 0); ctx.lineTo(-38, 0); ctx.closePath();
        ctx.fill(); ctx.stroke();

        ctx.fillStyle = 'rgba(244, 114, 182, 0.35)';
        ctx.beginPath(); ctx.arc(0, -28, 20, 0, Math.PI * 2); ctx.fill();
        ctx.font = '24px "Nunito", sans-serif'; ctx.textAlign = 'center'; ctx.fillText('👗', 0, -20);
        ctx.font = '900 13px "Nunito", sans-serif'; ctx.fillStyle = '#f5d0fe';
        ctx.fillText(isVisiting ? 'СКИНЫ ДРУГА' : 'ГАРДЕРОБ', 0, -82 - Math.sin(timeSec * 3) * 2);
    }

    _drawCosmodrome(ctx, isNear, launchProgress, timeSec) {
        ctx.fillStyle = '#334155';
        ctx.strokeStyle = isNear ? '#4ade80' : '#38bdf8';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.roundRect(-36, -10, 72, 12, 5); ctx.fill(); ctx.stroke();

        ctx.save();
        ctx.translate(0, -Math.pow(launchProgress, 2.2) * 520);
        if (launchProgress > 0) {
            for (let i = 0; i < 6; i++) {
                ctx.fillStyle = i % 2 === 0 ? '#fb923c' : '#fde047';
                ctx.beginPath(); ctx.arc((Math.random() - 0.5) * 22, -4 + Math.random() * 28, 7 + Math.random() * 8, 0, Math.PI * 2); ctx.fill();
            }
        }
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.moveTo(-14, -18); ctx.lineTo(-26, -4); ctx.lineTo(-10, -8); ctx.closePath();
        ctx.moveTo(14, -18);  ctx.lineTo(26, -4);  ctx.lineTo(10, -8);  ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#f8fafc'; ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(0, -38, 15, 28, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#0ea5e9';
        ctx.beginPath(); ctx.arc(0, -42, 8, 0, Math.PI * 2); ctx.fill();
        ctx.restore();

        if (launchProgress <= 0) {
            ctx.font = '900 13px "Nunito", sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#7dd3fc';
            ctx.fillText('🚀 КОСМОДРОМ', 0, -82 - Math.sin(timeSec * 3) * 2);
        }
    }
}
