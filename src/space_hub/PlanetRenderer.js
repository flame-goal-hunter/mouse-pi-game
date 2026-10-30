// ============================================================================
// PlanetRenderer.js — Отрисовка центральных планет мини-игр с уникальными
// биомами, 3D-кольцами, спутниками и кружащими ракетами игроков онлайн
// ============================================================================

import { SPACE_CONFIG } from './SpaceConfig.js';
import { getPlayerSkinSprite } from '../core/PlayerProfile.js';
import { SpaceNetwork } from './SpaceNetwork.js';
import { drawStyledPlanet } from './PlanetStyleRenderer.js';

export class PlanetRenderer {
    constructor() {
        this.states = new Map();
        this.images = new Map();
        for (const p of SPACE_CONFIG.planets) {
            this.states.set(p.id, {
                bobPhase: Math.random() * Math.PI * 2,
                squashVel: 0,
                squashOffset: 0,
                dockGlow: 0
            });
            if (p.monsterImg) {
                const img = new Image();
                img.src = p.monsterImg;
                this.images.set(p.id, img);
            }
        }
    }

    triggerSquash(planetId) {
        const st = this.states.get(planetId);
        if (st) st.squashVel = 4.2;
    }

    update(dt, activePlanetId) {
        for (const p of SPACE_CONFIG.planets) {
            const st = this.states.get(p.id);
            st.bobPhase += dt * 1.85;
            const springF = -65 * st.squashOffset - 9.5 * st.squashVel;
            st.squashVel += springF * dt;
            st.squashOffset += st.squashVel * dt;
            const targetGlow = p.id === activePlanetId ? 1 : 0;
            st.dockGlow += (targetGlow - st.dockGlow) * Math.min(1, dt * 8);
        }
    }

    draw(ctx, timeSec) {
        const peers = SpaceNetwork.getOnlinePeers();
        for (const p of SPACE_CONFIG.planets) {
            const playingHere = peers.filter(peer => peer.currentLocation === p.id);
            this._drawPlanet(ctx, p, timeSec, playingHere);
        }
    }

    _drawPlanet(ctx, p, timeSec, playingHere) {
        const st = this.states.get(p.id);
        const bobY = Math.sin(st.bobPhase) * 6;
        const sx = 1 + st.squashOffset * 0.22;
        const sy = 1 - st.squashOffset * 0.22;

        ctx.save();
        ctx.translate(p.x, p.y + bobY);

        if (st.dockGlow > 0.02) {
            ctx.save();
            ctx.rotate(timeSec * 1.3);
            ctx.strokeStyle = p.locked ? 'rgba(248, 113, 113, 0.85)' : 'rgba(74, 222, 128, 0.92)';
            ctx.lineWidth = 4 * st.dockGlow;
            ctx.setLineDash([16, 10]);
            ctx.beginPath();
            ctx.arc(0, 0, p.radius + 30 + Math.sin(timeSec * 6) * 4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        // Выглядывающий монстрик-хранитель планеты
        const img = this.images.get(p.id);
        if (img && img.complete && img.naturalWidth > 0) {
            ctx.save();
            const peek = Math.sin(timeSec * 2.2 + p.x) * 4;
            ctx.translate(p.radius * 0.56, -p.radius * 0.68 + peek);
            ctx.rotate(0.28);
            const sz = p.radius * 0.68;
            ctx.drawImage(img, -sz / 2, -sz / 2, sz, sz);
            ctx.restore();
        }

        // Процедурная планета с биомом, 3D-кольцами и частицами
        drawStyledPlanet(ctx, p.radius, { biome: p.biome || 'lava', ringType: p.ringType || 'saturn' }, timeSec, { sx, sy });

        // Орбитальные ракеты игроков онлайн и значок 🎮 N
        if (playingHere.length > 0) {
            playingHere.forEach((peer, idx) => {
                const a = timeSec * 1.4 + (idx / playingHere.length) * Math.PI * 2;
                const ox = Math.cos(a) * (p.radius + 36);
                const oy = Math.sin(a) * (p.radius + 36);
                const skin = getPlayerSkinSprite(peer.equippedSkinId);
                ctx.save();
                ctx.translate(ox, oy);
                ctx.rotate(a + Math.PI / 2);
                ctx.fillStyle = '#f8fafc'; ctx.strokeStyle = skin.bodyColor || '#38bdf8'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.ellipse(0, 0, 12, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                ctx.fillStyle = '#ef4444';
                ctx.beginPath(); ctx.arc(8, 0, 4.5, -1.2, 1.2); ctx.fill();
                ctx.restore();
            });

            ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
            ctx.strokeStyle = '#4ade80';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.roundRect(-34, -p.radius - 40, 68, 24, 12); ctx.fill(); ctx.stroke();
            ctx.font = '900 13px "Nunito", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#4ade80';
            ctx.fillText(`🎮 ${playingHere.length}`, 0, -p.radius - 24);
        }

        ctx.font = '900 13px "Nunito", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fef08a';
        ctx.fillText(p.badge, 0, p.radius + 26);
        ctx.font = '900 16px "Nunito", sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(p.name, 0, p.radius + 46);
        ctx.restore();
    }
}
