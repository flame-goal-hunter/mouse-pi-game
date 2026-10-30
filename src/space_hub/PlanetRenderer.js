// ============================================================================
// PlanetRenderer.js — Живые мультяшные планеты в рукавах спиральной галактики:
// неоновая атмосфера, серп тени 2D-объёма, кольца/спутники, монстры и squash & stretch
// ============================================================================

import { SPACE_CONFIG } from './SpaceConfig.js';
import { getPlayerSkinSprite } from '../core/PlayerProfile.js';

export class PlanetRenderer {
    constructor() {
        this.states = new Map();
        this.images = new Map();
        for (const p of SPACE_CONFIG.planets) {
            this.states.set(p.id, {
                bobPhase: Math.random() * Math.PI * 2,
                orbitAngle: Math.random() * Math.PI * 2,
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
            st.orbitAngle += dt * 1.15;
            const springF = -65 * st.squashOffset - 9.5 * st.squashVel;
            st.squashVel += springF * dt;
            st.squashOffset += st.squashVel * dt;
            const targetGlow = p.id === activePlanetId ? 1 : 0;
            st.dockGlow += (targetGlow - st.dockGlow) * Math.min(1, dt * 8);
        }
    }

    draw(ctx, timeSec) {
        for (const p of SPACE_CONFIG.planets) this._drawPlanet(ctx, p, timeSec);
    }

    _drawPlanet(ctx, p, timeSec) {
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
            ctx.arc(0, 0, p.radius + 26 + Math.sin(timeSec * 6) * 4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        const atmo = ctx.createRadialGradient(0, 0, p.radius * 0.75, 0, 0, p.radius * 1.55);
        atmo.addColorStop(0, p.atmoColor);
        atmo.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = atmo;
        ctx.beginPath();
        ctx.arc(0, 0, p.radius * 1.55, 0, Math.PI * 2);
        ctx.fill();

        const img = p.isHomePlanet ? getPlayerSkinSprite().idle : this.images.get(p.id);
        if (img && img.complete && img.naturalWidth > 0) {
            ctx.save();
            const peek = Math.sin(timeSec * 2.2 + p.x) * 4;
            ctx.translate(p.radius * 0.56, -p.radius * 0.66 + peek);
            ctx.rotate(0.28);
            const sz = p.radius * 0.68;
            ctx.drawImage(img, -sz / 2, -sz / 2, sz, sz);
            ctx.restore();
        }

        ctx.save();
        ctx.scale(sx, sy);

        const bodyG = ctx.createRadialGradient(-p.radius * 0.32, -p.radius * 0.32, p.radius * 0.1, 0, 0, p.radius);
        bodyG.addColorStop(0, p.coreColor);
        bodyG.addColorStop(0.62, p.midColor);
        bodyG.addColorStop(1, p.rimColor);
        ctx.fillStyle = bodyG;
        ctx.beginPath();
        ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.13)';
        ctx.beginPath(); ctx.arc(-p.radius * 0.28, -p.radius * 0.22, p.radius * 0.2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(p.radius * 0.2, p.radius * 0.3, p.radius * 0.14, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(5, 8, 22, 0.36)';
        ctx.beginPath();
        ctx.arc(p.radius * 0.36, p.radius * 0.12, p.radius * 0.95, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.rotate(-0.35 + Math.sin(timeSec * 0.9) * 0.08);
        ctx.strokeStyle = p.ringColor;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.radius * 1.42, p.radius * 0.36, 0, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
        ctx.restore();

        const mx = Math.cos(st.orbitAngle) * (p.radius * 1.36);
        const my = Math.sin(st.orbitAngle) * (p.radius * 0.55);
        ctx.fillStyle = p.moonColor;
        ctx.beginPath();
        ctx.arc(mx, my, 8.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.font = '900 13px "Nunito", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fef08a';
        ctx.fillText(p.badge, 0, p.radius + 24);
        ctx.font = '900 16px "Nunito", sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(p.name, 0, p.radius + 44);
        ctx.restore();
    }
}
