// ============================================================================
// SpaceBackground.js — Процедурные туманности и 3 слоя звёзд с параллаксом (0.1, 0.3, 0.6)
// ============================================================================

import { SPACE_CONFIG } from './SpaceConfig.js';

export class SpaceBackground {
    constructor() {
        const wSpan = SPACE_CONFIG.world.halfWidth * 2;
        const hSpan = SPACE_CONFIG.world.halfHeight * 2;
        this.layers = SPACE_CONFIG.background.parallaxLayers.map((cfg) => {
            const stars = [];
            for (let i = 0; i < cfg.count; i++) {
                stars.push({
                    x: (Math.random() - 0.5) * wSpan,
                    y: (Math.random() - 0.5) * hSpan,
                    r: cfg.minSize + Math.random() * (cfg.maxSize - cfg.minSize),
                    phase: Math.random() * Math.PI * 2,
                    speed: 1.5 + Math.random() * 2.5,
                    tint: Math.random() > 0.78 ? '#bae6fd' : (Math.random() > 0.85 ? '#fef08a' : '#ffffff')
                });
            }
            return { cfg, stars };
        });
    }

    draw(ctx, camX, camY, viewW, viewH, timeSec) {
        const wSpan = SPACE_CONFIG.world.halfWidth * 2;
        const hSpan = SPACE_CONFIG.world.halfHeight * 2;
        const bgCfg = SPACE_CONFIG.background;

        // 1. Deep Space Screen Gradient
        const skyGrad = ctx.createLinearGradient(0, 0, 0, viewH);
        skyGrad.addColorStop(0, bgCfg.baseColorTop || '#040613');
        skyGrad.addColorStop(1, bgCfg.baseColorBottom || '#0c1130');
        ctx.fillStyle = skyGrad;
        ctx.fillRect(0, 0, viewW, viewH);

        // 2. Soft Radial Gradient Nebulas (with gentle 0.22 parallax)
        ctx.save();
        ctx.translate(viewW / 2 - camX * 0.22, viewH / 2 - camY * 0.22);
        for (const neb of bgCfg.nebulas) {
            const g = ctx.createRadialGradient(neb.x, neb.y, 10, neb.x, neb.y, neb.r);
            g.addColorStop(0, neb.color);
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(neb.x, neb.y, neb.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();

        // 3. Three Parallax Star Layers (0.1, 0.3, 0.6) with Twinkling
        for (const layer of this.layers) {
            const p = layer.cfg.factor;
            const baseAlpha = layer.cfg.alpha;

            for (const s of layer.stars) {
                let sx = ((s.x - camX * p) % wSpan);
                if (sx < -wSpan / 2) sx += wSpan;
                if (sx > wSpan / 2) sx -= wSpan;

                let sy = ((s.y - camY * p) % hSpan);
                if (sy < -hSpan / 2) sy += hSpan;
                if (sy > hSpan / 2) sy -= hSpan;

                const screenX = viewW / 2 + sx;
                const screenY = viewH / 2 + sy;
                if (screenX < -10 || screenX > viewW + 10 || screenY < -10 || screenY > viewH + 10) {
                    continue;
                }

                const twinkle = 0.55 + 0.45 * Math.sin(timeSec * s.speed + s.phase);
                ctx.globalAlpha = baseAlpha * twinkle;
                ctx.fillStyle = s.tint;
                ctx.beginPath();
                ctx.arc(screenX, screenY, s.r, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.globalAlpha = 1;
    }
}
