// ============================================================================
// PlanetRenderer.js — Живые 3D-мультяшные планеты, трассы, спутники и монстры
// ============================================================================

import { SPACE_CONFIG } from './SpaceConfig.js';

export class PlanetRenderer {
    constructor() {
        this.planetMap = new Map();
        this.planets = SPACE_CONFIG.planets.map((cfg, idx) => {
            const img = new Image();
            if (cfg.monsterImg) img.src = cfg.monsterImg;
            const state = {
                cfg,
                phase: idx * 1.15,
                squash: 0,
                squashVel: 0,
                dockRingAlpha: 0,
                monsterImage: img
            };
            this.planetMap.set(cfg.id, state);
            return state;
        });
    }

    triggerSquash(planetId) {
        const p = this.planetMap.get(planetId);
        if (p) p.squashVel = 7.5;
    }

    update(dt, activePlanetId) {
        for (const p of this.planets) {
            const force = -110 * p.squash - 10.5 * p.squashVel;
            p.squashVel += force * dt;
            p.squash += p.squashVel * dt;
            const targetAlpha = (p.cfg.id === activePlanetId) ? 1 : 0;
            p.dockRingAlpha += (targetAlpha - p.dockRingAlpha) * Math.min(1, 10 * dt);
        }
    }

    draw(ctx, timeSec) {
        ctx.save();
        ctx.setLineDash([12, 12]);
        ctx.lineDashOffset = -timeSec * 28;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(125, 211, 252, 0.34)';
        for (const [idA, idB] of SPACE_CONFIG.links) {
            const a = this.planetMap.get(idA)?.cfg, b = this.planetMap.get(idB)?.cfg;
            if (!a || !b) continue;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
        ctx.restore();

        for (const p of this.planets) {
            const { cfg, monsterImage } = p;
            const bobY = Math.sin(timeSec * 1.8 + p.phase) * 7;
            const sx = 1 + p.squash * 0.22, sy = 1 - p.squash * 0.22;
            const r = cfg.radius;

            ctx.save();
            ctx.translate(cfg.x, cfg.y + bobY);

            if (p.dockRingAlpha > 0.02) {
                ctx.save();
                ctx.globalAlpha = p.dockRingAlpha;
                ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 4;
                ctx.setLineDash([14, 10]); ctx.rotate(timeSec * 0.9);
                ctx.beginPath(); ctx.arc(0, 0, r + 32, 0, Math.PI * 2); ctx.stroke();
                ctx.restore();
            }

            ctx.scale(sx, sy);

            const atm = ctx.createRadialGradient(0, 0, r * 0.65, 0, 0, r * 1.55);
            atm.addColorStop(0, cfg.glowColor);
            atm.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.globalAlpha = 0.45; ctx.fillStyle = atm;
            ctx.beginPath(); ctx.arc(0, 0, r * 1.55, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 1;

            if (monsterImage.complete && monsterImage.naturalWidth > 0) {
                const peekWave = Math.sin(timeSec * 2.2 + p.phase) * 5;
                ctx.save();
                ctx.translate(r * 0.48, -r * 0.78 + peekWave);
                ctx.rotate(0.24);
                ctx.drawImage(monsterImage, -28, -32, 56, 62);
                ctx.restore();
            }

            if (cfg.hasRing) {
                ctx.save();
                ctx.rotate(-0.32 + Math.sin(timeSec + p.phase) * 0.06);
                ctx.strokeStyle = cfg.ringColor; ctx.lineWidth = 10;
                ctx.beginPath(); ctx.ellipse(0, 0, r * 1.55, r * 0.42, 0, Math.PI, Math.PI * 2); ctx.stroke();
                ctx.restore();
            }

            const bodyGrad = ctx.createRadialGradient(-r * 0.32, -r * 0.32, r * 0.12, 0, 0, r);
            bodyGrad.addColorStop(0, cfg.hiColor);
            bodyGrad.addColorStop(0.55, cfg.baseColor);
            bodyGrad.addColorStop(1, '#0f172a');
            ctx.fillStyle = bodyGrad;
            ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();

            ctx.save();
            ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
            ctx.fillStyle = 'rgba(255,255,255,0.14)';
            ctx.beginPath(); ctx.arc(-r * 0.28, -r * 0.2, r * 0.22, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(r * 0.18, r * 0.28, r * 0.16, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = 'rgba(6, 8, 24, 0.42)';
            ctx.beginPath(); ctx.arc(r * 0.36, r * 0.12, r * 0.95, 0, Math.PI * 2); ctx.fill();
            ctx.restore();

            ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();

            if (cfg.hasRing) {
                ctx.save();
                ctx.rotate(-0.32 + Math.sin(timeSec + p.phase) * 0.06);
                ctx.strokeStyle = cfg.ringColor; ctx.lineWidth = 10;
                ctx.beginPath(); ctx.ellipse(0, 0, r * 1.55, r * 0.42, 0, 0, Math.PI); ctx.stroke();
                ctx.restore();
            }

            const moonAngle = timeSec * 1.35 + p.phase;
            ctx.fillStyle = cfg.moonColor;
            ctx.beginPath();
            ctx.arc(Math.cos(moonAngle) * (r + 24), Math.sin(moonAngle) * (r * 0.55), 9, 0, Math.PI * 2);
            ctx.fill();

            ctx.font = '900 15px Comfortaa, Nunito, sans-serif';
            ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = '#090d16';
            ctx.strokeText(`${cfg.badge} ${cfg.name}`, 0, -r - 18);
            ctx.fillStyle = '#fef08a';
            ctx.fillText(`${cfg.badge} ${cfg.name}`, 0, -r - 18);
            ctx.restore();
        }
    }
}
