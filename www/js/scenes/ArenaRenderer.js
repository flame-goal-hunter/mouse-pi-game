// ============================================================================
// ARENA RENDERER — Teeworlds HD / Badland-Inspired Seamless Vector Terrain
// ============================================================================
// Renders the entire Snowball Arena with zero tile seams and locked 60-120 FPS:
//   1. Camera-pinned Alpine Night Sky Dome + Bezier Aurora + 3D Split-Facet
//      Matterhorn Glacier Peaks + Midground Nordic Spruce Ridges & Warm Village Lights.
//   2. Single Consolidated Terrain CanvasTexture (at 0.65x super-sampled scale
//      matching camera zoom ~0.58) combining:
//      - Half-edge contour extracted rock massifs with 3D bevelled stone rims,
//        recessed cavern cross-sections, and sedimentary rock strata
//      - Continuous overhanging snow cushions across flat ledges & 45° ski-slopes
//      - Translucent under-ceiling icicle clusters
//      - Timber & steel truss suspension bridges
//      - Chamfered glacial crystal grapple pods with baked radial glow
//      - Baked warm golden street-lanterns & crystal light pools (zero WebGL
//        BlendModes.ADD flushes or per-frame tweens!).
// ============================================================================

export class ArenaRenderer {
    /**
     * @param {Phaser.Scene} scene
     * @param {Phaser.Tilemaps.Tilemap} map
     * @param {Phaser.Tilemaps.TilemapLayer} platformLayer
     */
    static renderArena(scene, map, platformLayer) {
        const T = map.tileWidth;   // 70
        const W = map.width;       // 72
        const H = map.height;      // 36
        const mapW = W * T;        // 5040
        const mapH = H * T;        // 2520

        const tileset = map.tilesets[0];
        const firstgid = tileset?.firstgid || 1;

        // Discover slope & material localIds from tileset metadata
        const slopeURIds = new Set([4, 87]);
        const slopeULIds = new Set([5, 89]);
        const bridgeIds = new Set([6, 7, 8, 84, 85, 86]);
        const crystalIds = new Set([9, 10]);

        const tileProps = tileset?.tileProperties || {};
        const tileData = tileset?.tileData || {};
        for (const idStr of Object.keys(tileProps)) {
            const id = parseInt(idStr, 10);
            const mat = tileProps[idStr]?.material;
            if (mat === 'slope_ur') slopeURIds.add(id);
            else if (mat === 'slope_ul') slopeULIds.add(id);
            else if (mat === 'bridge') bridgeIds.add(id);
            else if (mat === 'crystal') crystalIds.add(id);
        }
        for (const idStr of Object.keys(tileData)) {
            const objs = tileData[idStr]?.objectgroup?.objects;
            if (!objs || !objs.length || !objs[0].polygon) continue;
            const poly = objs[0].polygon;
            const hasTopRight = poly.some(p => p.x > 35 && p.y < 35);
            const hasTopLeft = poly.some(p => p.x < 35 && p.y < 35);
            if (hasTopRight && !hasTopLeft) slopeURIds.add(parseInt(idStr, 10));
            else if (hasTopLeft && !hasTopRight) slopeULIds.add(parseInt(idStr, 10));
        }

        // Classify every cell in platformLayer into semantic material + shape
        //   0 = empty
        //   1 = ROCK_FULL
        //   2 = ROCK_SLOPE_UR (bottom-left to top-right)
        //   3 = ROCK_SLOPE_UL (top-left to bottom-right)
        //   4 = WOOD_BRIDGE
        //   5 = HOOK_CRYSTAL
        const grid = Array.from({ length: H }, () => new Int8Array(W));

        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const tile = platformLayer.getTileAt(x, y);
                if (!tile || tile.index <= 0) continue;
                const localId = tile.index - firstgid;

                if (slopeURIds.has(localId)) {
                    grid[y][x] = 2;
                } else if (slopeULIds.has(localId)) {
                    grid[y][x] = 3;
                } else if (crystalIds.has(localId)) {
                    grid[y][x] = 5;
                } else if (bridgeIds.has(localId)) {
                    grid[y][x] = 4;
                } else {
                    grid[y][x] = 1;
                }
            }
        }

        // 1. Render Sky Dome + Curtained Aurora + 3D Split-Facet Glacier Panorama
        this._createSkyAndParallaxLayers(scene, mapW, mapH);

        // 2. Render Single Consolidated Terrain CanvasTexture at 0.65x resolution
        //    (matches camera zoom ~0.58 while cutting GPU fill & memory by 60%)
        const RES = 0.65;
        const texW = Math.round(mapW * RES);
        const texH = Math.round(mapH * RES);
        const mainKey = 'arena-terrain-main-tex';

        if (scene.textures.exists(mainKey)) scene.textures.remove(mainKey);
        const mainTex = scene.textures.createCanvas(mainKey, texW, texH);
        const ctx = mainTex.getContext();

        ctx.save();
        ctx.scale(RES, RES);

        // Extract exact closed polygon loops for all ROCK_SNOW cells (types 1, 2, 3)
        const { loops, topChains, bottomChains } = this._extractRockContours(grid, W, H, T);

        // 2a. Draw hanging translucent icicles under rock ceilings FIRST
        this._drawUnderLedgeIcicles(ctx, bottomChains);

        // 2b. Draw every ROCK_SNOW massif with 3D bevelled rim & recessed cavern cross-section
        for (let i = 0; i < loops.length; i++) {
            this._drawRockMassif(ctx, loops[i], i, mapW, mapH);
        }

        // 2c. Draw Timber & Iron Catwalk Bridges (type 4)
        const bridges = this._extractHorizontalSpans(grid, W, H, 4);
        for (const b of bridges) {
            this._drawTimberBridge(ctx, b.x1 * T, b.y * T, (b.x2 - b.x1 + 1) * T, T);
        }

        // 2d. Draw Glacial Crystal Grapple Pods (type 5)
        const crystalPods = this._extractRectPods(grid, W, H, 5);
        for (const pod of crystalPods) {
            this._drawCrystalGrapplePod(
                ctx,
                pod.x1 * T,
                pod.y1 * T,
                (pod.x2 - pod.x1 + 1) * T,
                (pod.y2 - pod.y1 + 1) * T
            );
        }

        // 2e. Draw Continuous Overhanging Fluffy Snow Blankets across all top chains
        for (const chain of topChains) {
            this._drawContinuousSnowBlanket(ctx, chain);
        }

        // 2f. Bake Warm Golden Street-Lanterns & Glowing Crystal Pools directly onto terrain
        this._drawBakedLanternsAndCrystals(ctx, T);

        ctx.restore();
        mainTex.refresh();

        scene.add.image(0, 0, mainKey)
            .setOrigin(0, 0)
            .setScale(1 / RES)
            .setDepth(2);
    }

    // ========================================================================
    // SKY DOME, CURTAINED AURORA & 3D SPLIT-FACET ALPINE PANORAMA
    // ========================================================================

    static _createSkyAndParallaxLayers(scene, mapW, mapH) {
        const skyKey = 'arena-sky-dome-tex';
        const midKey = 'arena-mid-mountains-tex';
        for (const k of [skyKey, midKey]) {
            if (scene.textures.exists(k)) scene.textures.remove(k);
        }

        // --- LAYER A: Sky Dome + Aurora + Moon + Distant Matterhorn Peaks ---
        // Rendered at 1600x960 and pinned to camera viewport (scrollFactor 0)
        // so it NEVER shows a seam or edge regardless of camera zoom or scroll!
        const skyW = 1600;
        const skyH = 960;
        const skyTex = scene.textures.createCanvas(skyKey, skyW, skyH);
        this._drawSkyAndDistantPeaks(skyTex.getContext(), skyW, skyH);
        skyTex.refresh();

        const skyImg = scene.add.image(0, 0, skyKey)
            .setOrigin(0.5, 0.5)
            .setDepth(-30)
            .setScrollFactor(0, 0);

        const fitSkyToCamera = () => {
            const cam = scene.cameras?.main;
            if (!cam || !skyImg.active) return;
            const z = cam.zoom || 0.6;
            const vw = cam.width / z;
            const vh = cam.height / z;
            skyImg.setPosition(cam.width * 0.5, cam.height * 0.5);
            skyImg.setDisplaySize(vw + 80, vh + 80);
        };
        fitSkyToCamera();
        scene.scale.on('resize', fitSkyToCamera);
        scene.events.once('update', fitSkyToCamera);
        scene.events.once('shutdown', () => scene.scale.off('resize', fitSkyToCamera));

        // --- LAYER B: Mid-Distance Parallax Alpine Ridge, Spruce Forests & Village Lights ---
        const midW = 2520;
        const midH = 1100;
        const midTex = scene.textures.createCanvas(midKey, midW, midH);
        this._drawMidgroundAlpineRidge(midTex.getContext(), midW, midH);
        midTex.refresh();

        scene.add.image(-300, mapH - 1850, midKey)
            .setOrigin(0, 0)
            .setScale(2.2, 1.85)
            .setDepth(-20)
            .setScrollFactor(0.25, 0.35);
    }

    static _drawSkyAndDistantPeaks(ctx, W, H) {
        ctx.save();

        // 1. Vibrant TF2-Inspired Cartoon Alpine Sky Gradient (Deep Cobalt -> Electric Cyan -> Warm Golden Horizon!)
        const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
        skyGrad.addColorStop(0.00, '#0f4c9c');
        skyGrad.addColorStop(0.26, '#1d82e8');
        skyGrad.addColorStop(0.55, '#52b8ff');
        skyGrad.addColorStop(0.82, '#b8ecff');
        skyGrad.addColorStop(1.00, '#fff4c8');
        ctx.fillStyle = skyGrad;
        ctx.fillRect(0, 0, W, H);

        // 2. Radiant Alpine Sun + Diagonal Atmospheric Sunbeams
        const sunX = W * 0.76;
        const sunY = H * 0.19;

        // Soft diagonal sunbeams streaming across the valley
        ctx.save();
        for (let i = -3; i <= 3; i++) {
            const beamAngle = 0.42 + i * 0.11;
            const bx = sunX - Math.sin(beamAngle) * 750;
            const by = sunY + Math.cos(beamAngle) * 750;
            const bGrad = ctx.createLinearGradient(sunX, sunY, bx, by);
            bGrad.addColorStop(0.0, 'rgba(255, 253, 232, 0.22)');
            bGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.08)');
            bGrad.addColorStop(1.0, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = bGrad;
            ctx.beginPath();
            ctx.moveTo(sunX - 18, sunY);
            ctx.lineTo(sunX + 18, sunY);
            ctx.lineTo(bx + 95, by);
            ctx.lineTo(bx - 95, by);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();

        // Outer solar bloom
        const haloGrad = ctx.createRadialGradient(sunX, sunY, 24, sunX, sunY, 280);
        haloGrad.addColorStop(0.00, 'rgba(255, 253, 224, 0.85)');
        haloGrad.addColorStop(0.25, 'rgba(254, 249, 195, 0.42)');
        haloGrad.addColorStop(0.60, 'rgba(224, 242, 254, 0.16)');
        haloGrad.addColorStop(1.00, 'rgba(224, 242, 254, 0)');
        ctx.fillStyle = haloGrad;
        ctx.beginPath();
        ctx.arc(sunX, sunY, 280, 0, Math.PI * 2);
        ctx.fill();

        // Crisp Sun Disc
        const discGrad = ctx.createRadialGradient(sunX, sunY, 6, sunX, sunY, 48);
        discGrad.addColorStop(0, '#ffffff');
        discGrad.addColorStop(0.7, '#fef9c3');
        discGrad.addColorStop(1, 'rgba(254, 240, 138, 0.9)');
        ctx.fillStyle = discGrad;
        ctx.beginPath();
        ctx.arc(sunX, sunY, 48, 0, Math.PI * 2);
        ctx.fill();

        // 3. Fluffy Sunlit Cumulus Clouds drifting across the blue sky
        const clouds = [
            { x: 210,  y: 155, scale: 1.15 },
            { x: 560,  y: 115, scale: 0.92 },
            { x: 960,  y: 170, scale: 1.05 },
            { x: 1390, y: 140, scale: 0.88 },
        ];
        for (const c of clouds) {
            this._drawFluffyCloud(ctx, c.x, c.y, c.scale);
        }

        // 4. Far Atmospheric Horizon Range (Continuous curved Alpine ridgeline with saddles & sub-peaks)
        const baseY = H + 20;
        const farRidge = [
            [0, 490], [65, 455], [130, 468], [210, 410], [275, 392], [340, 428],
            [420, 445], [510, 385], [585, 360], [650, 395], [735, 430], [820, 380],
            [905, 348], [975, 372], [1055, 418], [1140, 390], [1230, 342], [1310, 365],
            [1395, 415], [1480, 388], [1550, 368], [1600, 410]
        ];
        const farGrad = ctx.createLinearGradient(0, 340, 0, baseY);
        farGrad.addColorStop(0.00, '#cbe6ff');
        farGrad.addColorStop(0.45, '#99c7ee');
        farGrad.addColorStop(1.00, '#6da3d4');
        ctx.beginPath();
        ctx.moveTo(0, baseY);
        ctx.lineTo(farRidge[0][0], farRidge[0][1]);
        for (let i = 0; i < farRidge.length - 1; i++) {
            const mx = (farRidge[i][0] + farRidge[i + 1][0]) * 0.5;
            const my = (farRidge[i][1] + farRidge[i + 1][1]) * 0.5;
            ctx.quadraticCurveTo(farRidge[i][0], farRidge[i][1], mx, my);
        }
        ctx.lineTo(W, farRidge[farRidge.length - 1][1]);
        ctx.lineTo(W, baseY);
        ctx.closePath();
        ctx.fillStyle = farGrad;
        ctx.fill();

        // 5. Monumental Multi-Shouldered Alpine Massifs (Stepped ridges, curved cols, arêtes & couloirs!)
        const massifs = [
            {
                // Left Massif (Broad double-crowned massif with stepped western shoulder)
                leftSlope: [[-70, baseY], [-10, 560], [35, 495], [78, 472], [122, 418], [156, 392], [182, 384]],
                rightSlope: [[182, 384], [208, 394], [248, 432], [285, 448], [335, 510], [410, baseY]],
                arete: [[182, 384], [168, 438], [192, 495], [174, 565], [205, 650], [190, baseY]],
                spur: [[122, 418], [108, 485], [126, 560], [105, 660]],
            },
            {
                // Center-Left Grand Massif (Jungfrau / Eiger style terraced summit crown)
                leftSlope: [[260, baseY], [325, 555], [375, 478], [418, 442], [458, 368], [492, 332], [524, 314]],
                rightSlope: [[524, 314], [556, 326], [590, 372], [632, 392], [678, 458], [735, 535], [810, baseY]],
                arete: [[524, 314], [505, 378], [534, 446], [512, 528], [548, 620], [535, baseY]],
                spur: [[458, 368], [438, 445], [462, 530], [440, 645]],
            },
            {
                // Center-Right Massif (Broad glacier dome with craggy eastern buttress)
                leftSlope: [[650, baseY], [715, 565], [765, 492], [810, 455], [852, 395], [888, 362], [918, 350]],
                rightSlope: [[918, 350], [948, 360], [985, 405], [1028, 422], [1072, 485], [1130, 555], [1200, baseY]],
                arete: [[918, 350], [898, 412], [926, 475], [904, 552], [935, 635], [922, baseY]],
                spur: [[852, 395], [835, 468], [855, 545], [832, 650]],
            },
            {
                // Far-Right High Alpine Massif (Sweeping sunlit snowfields & stepped ridge)
                leftSlope: [[1040, baseY], [1110, 545], [1165, 465], [1212, 425], [1258, 348], [1295, 312], [1330, 296]],
                rightSlope: [[1330, 296], [1364, 308], [1405, 358], [1448, 382], [1495, 448], [1560, 525], [1660, baseY]],
                arete: [[1330, 296], [1308, 365], [1342, 438], [1318, 520], [1355, 615], [1340, baseY]],
                spur: [[1258, 348], [1236, 428], [1262, 515], [1240, 640]],
            },
        ];

        const traceSmoothChain = (pts, moveFirst = true) => {
            if (moveFirst) ctx.moveTo(pts[0][0], pts[0][1]);
            else ctx.lineTo(pts[0][0], pts[0][1]);
            for (let i = 0; i < pts.length - 1; i++) {
                const mx = (pts[i][0] + pts[i + 1][0]) * 0.5;
                const my = (pts[i][1] + pts[i + 1][1]) * 0.5;
                ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
            }
            const last = pts[pts.length - 1];
            ctx.lineTo(last[0], last[1]);
        };

        for (const m of massifs) {
            const topPt = m.arete[0];
            const leftBase = m.leftSlope[0];
            const rightBase = m.rightSlope[m.rightSlope.length - 1];

            // 5a. Sunlit Snow-Draped Western Face (Soft sculpted curve + dazzling snow gradient)
            const litGrad = ctx.createLinearGradient(topPt[0], topPt[1], leftBase[0], baseY);
            litGrad.addColorStop(0.00, '#ffffff');
            litGrad.addColorStop(0.28, '#f0f8ff');
            litGrad.addColorStop(0.62, '#c3e2fc');
            litGrad.addColorStop(1.00, '#8abce8');

            ctx.beginPath();
            traceSmoothChain(m.leftSlope, true);
            for (let i = 1; i < m.arete.length; i++) {
                ctx.lineTo(m.arete[i][0], m.arete[i][1]);
            }
            ctx.closePath();
            ctx.fillStyle = litGrad;
            ctx.fill();

            // Secondary sunlit snow spur facet on the left flank
            ctx.beginPath();
            for (let i = 0; i < m.spur.length; i++) {
                if (i === 0) ctx.moveTo(m.spur[i][0], m.spur[i][1]);
                else ctx.lineTo(m.spur[i][0], m.spur[i][1]);
            }
            ctx.lineTo(m.arete[3][0], m.arete[3][1]);
            ctx.lineTo(m.arete[1][0], m.arete[1][1]);
            ctx.closePath();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.38)';
            ctx.fill();

            // 5b. Cool Sky-Shaded Eastern Glacier & Rock Face
            const shadGrad = ctx.createLinearGradient(topPt[0], topPt[1], rightBase[0], baseY);
            shadGrad.addColorStop(0.00, '#d8eeff');
            shadGrad.addColorStop(0.35, '#8abae6');
            shadGrad.addColorStop(0.72, '#5c91c4');
            shadGrad.addColorStop(1.00, '#4678ab');

            ctx.beginPath();
            traceSmoothChain(m.rightSlope, true);
            for (let i = m.arete.length - 1; i >= 0; i--) {
                ctx.lineTo(m.arete[i][0], m.arete[i][1]);
            }
            ctx.closePath();
            ctx.fillStyle = shadGrad;
            ctx.fill();

            // 5c. Diagonal Snow Couloirs & Rock Terraces on the Shaded Face (breaks up flat shading!)
            ctx.save();
            ctx.clip();
            ctx.fillStyle = 'rgba(224, 242, 254, 0.28)';
            for (let k = 1; k <= 3; k++) {
                const ax = m.arete[k][0];
                const ay = m.arete[k][1];
                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.quadraticCurveTo(ax + 55, ay + 35, ax + 135, ay + 95);
                ctx.lineTo(ax + 115, ay + 112);
                ctx.quadraticCurveTo(ax + 45, ay + 52, ax - 4, ay + 18);
                ctx.closePath();
                ctx.fill();
            }
            ctx.restore();

            // 5d. Crisp Glowing Snow Cornice & Arête Ridge Crest
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
            ctx.lineWidth = 3.5;
            ctx.lineCap = 'round';
            ctx.beginPath();
            traceSmoothChain(m.leftSlope, true);
            ctx.stroke();

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            traceSmoothChain(m.arete, true);
            ctx.stroke();
        }

        // 6. Soft Valley Cloud Banks nestled between the Mountain Massifs
        const valleyClouds = [
            { x: 320,  y: 465, scale: 1.25 },
            { x: 740,  y: 445, scale: 1.35 },
            { x: 1120, y: 435, scale: 1.20 },
        ];
        for (const vc of valleyClouds) {
            this._drawFluffyCloud(ctx, vc.x, vc.y, vc.scale);
        }

        // 7. Soft Daytime Horizon Snow Mist blending into midground
        const mistGrad = ctx.createLinearGradient(0, H * 0.58, 0, H);
        mistGrad.addColorStop(0.00, 'rgba(224, 242, 254, 0)');
        mistGrad.addColorStop(0.60, 'rgba(224, 242, 254, 0.48)');
        mistGrad.addColorStop(1.00, 'rgba(210, 236, 255, 0.88)');
        ctx.fillStyle = mistGrad;
        ctx.fillRect(0, H * 0.58, W, H * 0.42);

        ctx.restore();
    }

    static _drawFluffyCloud(ctx, cx, cy, scale = 1) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);

        // Soft blue-grey cloud underside shadow
        ctx.fillStyle = 'rgba(186, 230, 253, 0.65)';
        const puffs = [
            { x: -55, y: 8,  r: 28 },
            { x: -22, y: -4, r: 38 },
            { x: 20,  y: -2, r: 34 },
            { x: 54,  y: 10, r: 25 },
        ];
        ctx.beginPath();
        for (const p of puffs) {
            ctx.moveTo(p.x + p.r, p.y + 6);
            ctx.arc(p.x, p.y + 6, p.r, 0, Math.PI * 2);
        }
        ctx.fill();

        // Sunlit pure white cloud body
        ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
        ctx.beginPath();
        for (const p of puffs) {
            ctx.moveTo(p.x + p.r, p.y);
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        }
        ctx.fill();

        ctx.restore();
    }

    static _drawMidgroundAlpineRidge(ctx, W, H) {
        ctx.save();

        // 1. Mid-Distance Sunlit Snow Foothills Ridge
        ctx.beginPath();
        ctx.moveTo(0, H);
        for (let x = 0; x <= W; x += 30) {
            const y = 320 + Math.sin(x * 0.0038) * 110 + Math.cos(x * 0.0085 + 1.2) * 55;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(W, H);
        ctx.closePath();

        const hillGrad = ctx.createLinearGradient(0, 200, 0, H);
        hillGrad.addColorStop(0.00, '#d8efff');
        hillGrad.addColorStop(0.45, '#9ec9ed');
        hillGrad.addColorStop(1.00, '#6ea2d1');
        ctx.fillStyle = hillGrad;
        ctx.fill();

        // Gleaming white snow crest along the foothill ridge
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 5;
        ctx.beginPath();
        for (let x = 0; x <= W; x += 30) {
            const y = 320 + Math.sin(x * 0.0038) * 110 + Math.cos(x * 0.0085 + 1.2) * 55;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // 2. Distant Nordic Spruce Forest Line (Daytime Pine Green + White Snow Caps)
        for (let x = 25; x < W - 25; x += 38) {
            const groundY = 470 + Math.sin(x * 0.0042 + 0.7) * 75;
            const treeH = 75 + ((x * 31) % 50);
            const treeW = 22 + ((x * 17) % 10);
            this._drawSpruceSilhouette(ctx, x, groundY, treeW, treeH, '#2e6b6e', 'rgba(255, 255, 255, 0.82)');
        }

        // Soft sunlit valley mist ribbon between back and front forest tiers
        const valleyMist = ctx.createLinearGradient(0, 440, 0, 660);
        valleyMist.addColorStop(0, 'rgba(255, 255, 255, 0)');
        valleyMist.addColorStop(0.5, 'rgba(240, 249, 255, 0.45)');
        valleyMist.addColorStop(1, 'rgba(240, 249, 255, 0)');
        ctx.fillStyle = valleyMist;
        ctx.fillRect(0, 440, W, 220);

        // 3. Closer Snow-Draped Valley Slope & Tall Evergreen Spruces (Front Tier)
        ctx.beginPath();
        ctx.moveTo(0, H);
        for (let x = 0; x <= W; x += 28) {
            const y = 560 + Math.cos(x * 0.0045 + 2.4) * 85 + Math.sin(x * 0.011) * 35;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(W, H);
        ctx.closePath();

        const nearHillGrad = ctx.createLinearGradient(0, 480, 0, H);
        nearHillGrad.addColorStop(0.00, '#c8e8ff');
        nearHillGrad.addColorStop(0.45, '#7cc0f5');
        nearHillGrad.addColorStop(1.00, '#3b82c4');
        ctx.fillStyle = nearHillGrad;
        ctx.fill();

        // Front Spruce Trees (Vibrant Cartoon Emerald + Crisp Outline + White Snow Boughs)
        for (let x = 45; x < W - 45; x += 56) {
            const groundY = 575 + Math.cos(x * 0.0045 + 2.4) * 85 + Math.sin(x * 0.011) * 35;
            const treeH = 95 + ((x * 43) % 65);
            const treeW = 28 + ((x * 19) % 14);
            this._drawSpruceSilhouette(ctx, x, groundY, treeW, treeH, '#15803d', 'rgba(255, 255, 255, 0.95)');
        }

        ctx.restore();
    }

    static _drawSpruceSilhouette(ctx, x, baseY, halfW, height, bodyColor, snowHighlightColor) {
        const tiers = 4;
        ctx.fillStyle = bodyColor;
        for (let t = 0; t < tiers; t++) {
            const frac = t / tiers;
            const topY = baseY - height + frac * height * 0.68;
            const botY = topY + height * (0.36 + frac * 0.08);
            const w = halfW * (0.38 + frac * 0.68);

            ctx.beginPath();
            ctx.moveTo(x, topY);
            ctx.quadraticCurveTo(x - w * 0.45, (topY + botY) * 0.5, x - w, botY);
            ctx.quadraticCurveTo(x, botY - 6, x + w, botY);
            ctx.quadraticCurveTo(x + w * 0.45, (topY + botY) * 0.5, x, topY);
            ctx.closePath();
            ctx.fill();

            // Frosted snow cap on upper boughs
            if (t < 2) {
                ctx.fillStyle = snowHighlightColor;
                ctx.beginPath();
                ctx.moveTo(x, topY);
                ctx.lineTo(x - w * 0.65, topY + (botY - topY) * 0.55);
                ctx.quadraticCurveTo(x, topY + (botY - topY) * 0.35, x + w * 0.65, topY + (botY - topY) * 0.55);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = bodyColor;
            }
        }
    }

    // ========================================================================
    // HALF-EDGE CONTOUR EXTRACTION (Exact Union of Squares + 45° Triangles)
    // ========================================================================

    static _extractRockContours(grid, W, H, T) {
        const edgeMap = new Map();

        const addDirectedEdge = (x1, y1, x2, y2) => {
            const revKey = `${x2},${y2}->${x1},${y1}`;
            if (edgeMap.has(revKey)) {
                edgeMap.delete(revKey);
            } else {
                const key = `${x1},${y1}->${x2},${y2}`;
                edgeMap.set(key, { x1, y1, x2, y2 });
            }
        };

        for (let gy = 0; gy < H; gy++) {
            for (let gx = 0; gx < W; gx++) {
                const cell = grid[gy][gx];
                if (cell !== 1 && cell !== 2 && cell !== 3) continue;

                const x0 = gx * T;
                const y0 = gy * T;
                const x1 = (gx + 1) * T;
                const y1 = (gy + 1) * T;

                if (cell === 1) {
                    addDirectedEdge(x0, y0, x1, y0);
                    addDirectedEdge(x1, y0, x1, y1);
                    addDirectedEdge(x1, y1, x0, y1);
                    addDirectedEdge(x0, y1, x0, y0);
                } else if (cell === 2) {
                    addDirectedEdge(x0, y1, x1, y0);
                    addDirectedEdge(x1, y0, x1, y1);
                    addDirectedEdge(x1, y1, x0, y1);
                } else if (cell === 3) {
                    addDirectedEdge(x0, y0, x1, y1);
                    addDirectedEdge(x1, y1, x0, y1);
                    addDirectedEdge(x0, y1, x0, y0);
                }
            }
        }

        const outgoing = new Map();
        for (const e of edgeMap.values()) {
            const k = `${e.x1},${e.y1}`;
            if (!outgoing.has(k)) outgoing.set(k, []);
            outgoing.get(k).push(e);
        }

        const used = new Set();
        const rawLoops = [];

        for (const e of edgeMap.values()) {
            const startKey = `${e.x1},${e.y1}->${e.x2},${e.y2}`;
            if (used.has(startKey)) continue;

            const loop = [];
            let cur = e;
            while (cur) {
                const curKey = `${cur.x1},${cur.y1}->${cur.x2},${cur.y2}`;
                used.add(curKey);
                loop.push({ x: cur.x1, y: cur.y1 });

                const nextVertKey = `${cur.x2},${cur.y2}`;
                const candidates = outgoing.get(nextVertKey) || [];
                let nextEdge = null;
                for (const cand of candidates) {
                    const cKey = `${cand.x1},${cand.y1}->${cand.x2},${cand.y2}`;
                    if (!used.has(cKey)) {
                        nextEdge = cand;
                        break;
                    }
                }
                cur = nextEdge;
            }
            if (loop.length >= 3) {
                rawLoops.push(loop);
            }
        }

        const loops = rawLoops.map(loop => this._simplifyCollinearLoop(loop));

        const topChains = [];
        const bottomChains = [];

        for (const loop of loops) {
            const n = loop.length;
            const isTopEdge = (i) => {
                const a = loop[i];
                const b = loop[(i + 1) % n];
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                return dx > 0 && Math.abs(dy) <= dx + 1 && a.y >= 3 * T && b.y >= 3 * T && a.y < (H - 1) * T && b.y < (H - 1) * T;
            };

            for (let i = 0; i < n; i++) {
                if (isTopEdge(i) && !isTopEdge((i - 1 + n) % n)) {
                    const chain = [loop[i]];
                    let j = i;
                    let steps = 0;
                    while (isTopEdge(j) && steps < n) {
                        chain.push(loop[(j + 1) % n]);
                        j = (j + 1) % n;
                        steps++;
                    }
                    if (chain.length >= 2) topChains.push(chain);
                }
            }

            for (let i = 0; i < n; i++) {
                const a = loop[i];
                const b = loop[(i + 1) % n];
                if (b.x < a.x && a.y === b.y && a.y >= 2 * T && a.y < (H - 2) * T) {
                    bottomChains.push({ x1: b.x, x2: a.x, y: a.y });
                }
            }
        }

        return { loops, topChains, bottomChains };
    }

    static _simplifyCollinearLoop(loop) {
        if (loop.length <= 3) return loop;
        const out = [];
        const n = loop.length;
        for (let i = 0; i < n; i++) {
            const prev = loop[(i - 1 + n) % n];
            const cur = loop[i];
            const next = loop[(i + 1) % n];
            const dx1 = cur.x - prev.x;
            const dy1 = cur.y - prev.y;
            const dx2 = next.x - cur.x;
            const dy2 = next.y - cur.y;
            const cross = dx1 * dy2 - dy1 * dx2;
            const dot = dx1 * dx2 + dy1 * dy2;
            if (Math.abs(cross) < 1 && dot > 0) continue;
            out.push(cur);
        }
        return out;
    }

    static _traceRoundedPolygon(ctx, pts, defaultRadius = 18, mapW = 5040, mapH = 2520) {
        const n = pts.length;
        if (n < 3) return;

        ctx.beginPath();
        for (let i = 0; i < n; i++) {
            const prev = pts[(i - 1 + n) % n];
            const cur = pts[i];
            const next = pts[(i + 1) % n];

            const onBorder = (cur.x <= 2 || cur.x >= mapW - 2 || cur.y <= 2 || cur.y >= mapH - 2);
            const v1x = prev.x - cur.x;
            const v1y = prev.y - cur.y;
            const v2x = next.x - cur.x;
            const v2y = next.y - cur.y;
            const len1 = Math.hypot(v1x, v1y);
            const len2 = Math.hypot(v2x, v2y);

            const r = onBorder ? 0 : Math.min(defaultRadius, len1 * 0.35, len2 * 0.35);

            if (r < 2) {
                if (i === 0) ctx.moveTo(cur.x, cur.y);
                else ctx.lineTo(cur.x, cur.y);
            } else {
                const p1x = cur.x + (v1x / len1) * r;
                const p1y = cur.y + (v1y / len1) * r;
                const p2x = cur.x + (v2x / len2) * r;
                const p2y = cur.y + (v2y / len2) * r;

                if (i === 0) ctx.moveTo(p1x, p1y);
                else ctx.lineTo(p1x, p1y);
                ctx.quadraticCurveTo(cur.x, cur.y, p2x, p2y);
            }
        }
        ctx.closePath();
    }

    // ========================================================================
    // 3D BEVELLED CROSS-SECTION ALPINE ROCK MASSIF RENDERING
    // ========================================================================

    static _drawRockMassif(ctx, loop, seedIdx, mapW, mapH) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of loop) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }

        // 1. Crisp Offset Drop Shadow behind the island
        ctx.save();
        ctx.translate(0, 14);
        this._traceRoundedPolygon(ctx, loop, 18, mapW, mapH);
        ctx.fillStyle = 'rgba(28, 64, 108, 0.28)';
        ctx.fill();
        ctx.restore();

        // 2. Clipped Interior 3D Cross-Section Rock Shader (Studio-Grade Glacial Slate & Chiseled Ice-Rock)
        ctx.save();
        this._traceRoundedPolygon(ctx, loop, 18, mapW, mapH);
        ctx.clip();

        // 2a. Rich cohesive Alpine Glacial Slate vertical gradient
        const rockGrad = ctx.createLinearGradient(0, minY, 0, maxY);
        rockGrad.addColorStop(0.00, '#335c85');
        rockGrad.addColorStop(0.32, '#244466');
        rockGrad.addColorStop(0.70, '#18304c');
        rockGrad.addColorStop(1.00, '#0f2036');
        ctx.fillStyle = rockGrad;
        ctx.fillRect(minX - 10, minY - 10, (maxX - minX) + 20, (maxY - minY) + 20);

        // 2b. Clean Geometric Chiseled Rock Planes (Rayman Legends / Ori style low-poly cliff facets)
        let hash = (seedIdx + 1) * 2654435761;
        const rand = () => {
            hash = (hash ^ (hash >>> 15)) * 2246822519;
            return ((hash >>> 0) % 10000) / 10000;
        };

        const stepY = 78;
        const stepX = 110;
        const cols = Math.ceil((maxX - minX) / stepX) + 2;
        const rows = Math.ceil((maxY - minY) / stepY) + 2;

        // Generate jittered grid vertices for crisp polygonal rock facets
        const verts = [];
        for (let r = 0; r <= rows; r++) {
            const rowArr = [];
            for (let c = 0; c <= cols; c++) {
                const jx = (rand() - 0.5) * stepX * 0.52;
                const jy = (rand() - 0.5) * stepY * 0.52;
                rowArr.push({
                    x: minX - 30 + c * stepX + jx,
                    y: minY - 30 + r * stepY + jy
                });
            }
            verts.push(rowArr);
        }

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const p00 = verts[r][c];
                const p10 = verts[r][c + 1];
                const p01 = verts[r + 1][c];
                const p11 = verts[r + 1][c + 1];

                // Upper-left triangle facet (catches cool sky light)
                const shade1 = rand();
                ctx.beginPath();
                ctx.moveTo(p00.x, p00.y);
                ctx.lineTo(p10.x, p10.y);
                ctx.lineTo(p01.x, p01.y);
                ctx.closePath();
                ctx.fillStyle = shade1 > 0.55
                    ? 'rgba(147, 197, 253, 0.09)'
                    : (shade1 > 0.25 ? 'rgba(56, 189, 248, 0.04)' : 'rgba(9, 19, 34, 0.14)');
                ctx.fill();

                // Lower-right triangle facet (deeper shadow plane)
                const shade2 = rand();
                ctx.beginPath();
                ctx.moveTo(p10.x, p10.y);
                ctx.lineTo(p11.x, p11.y);
                ctx.lineTo(p01.x, p01.y);
                ctx.closePath();
                ctx.fillStyle = shade2 > 0.65
                    ? 'rgba(186, 230, 253, 0.06)'
                    : 'rgba(9, 19, 34, 0.20)';
                ctx.fill();

                // Subtle chiseled ridge seam on selected facets
                if (rand() > 0.55) {
                    ctx.beginPath();
                    ctx.moveTo(p10.x, p10.y);
                    ctx.lineTo(p01.x, p01.y);
                    ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                }
            }
        }

        // 2c. Refined Inner Bevel Rim (gives crisp 3D depth without swallowing thin platforms)
        this._traceRoundedPolygon(ctx, loop, 18, mapW, mapH);
        ctx.strokeStyle = 'rgba(125, 211, 252, 0.22)';
        ctx.lineWidth = 11;
        ctx.lineJoin = 'round';
        ctx.stroke();

        ctx.restore();

        // 3. Crisp Studio Ink Silhouette Contour
        ctx.save();
        this._traceRoundedPolygon(ctx, loop, 18, mapW, mapH);
        ctx.strokeStyle = '#091526';
        ctx.lineWidth = 5.5;
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.restore();
    }

    // ========================================================================
    // CONTINUOUS OVERHANGING SNOW BLANKETS (Flows over flat & 45° slopes!)
    // ========================================================================

    static _drawContinuousSnowBlanket(ctx, chain) {
        if (chain.length < 2) return;

        const overhangs = 12;
        const pts = [];
        for (let i = 0; i < chain.length; i++) {
            let x = chain[i].x;
            let y = chain[i].y;
            if (i === 0 && x > 10) x -= overhangs;
            if (i === chain.length - 1 && x < 5030) x += overhangs;
            pts.push({ x, y });
        }

        const topCurve = [];
        const botCurve = [];
        const sampleDist = 22;

        for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i];
            const b = pts[i + 1];
            const segLen = Math.hypot(b.x - a.x, b.y - a.y);
            const steps = Math.max(1, Math.round(segLen / sampleDist));

            for (let s = 0; s < steps; s++) {
                if (i > 0 && s === 0) continue;
                const t = s / steps;
                const px = a.x + (b.x - a.x) * t;
                const py = a.y + (b.y - a.y) * t;

                const puff = Math.sin(px * 0.045) * 2.5 + Math.cos(px * 0.11) * 1.5;
                const drip = Math.sin(px * 0.065 + 1.4) * 5.0 + Math.cos(px * 0.14) * 3.0;

                topCurve.push({ x: px, y: py - 8 + puff });
                botCurve.push({ x: px, y: py + 17 + drip });
            }
        }

        const last = pts[pts.length - 1];
        topCurve.push({ x: last.x, y: last.y - 6 });
        botCurve.push({ x: last.x, y: last.y + 15 });

        if (topCurve.length < 2) return;

        const traceSnowRibbon = (yOffsetBot = 0) => {
            ctx.beginPath();
            ctx.moveTo(topCurve[0].x, topCurve[0].y + 6);

            for (let i = 0; i < topCurve.length - 1; i++) {
                const c = topCurve[i];
                const n = topCurve[i + 1];
                const mx = (c.x + n.x) * 0.5;
                const my = (c.y + n.y) * 0.5;
                ctx.quadraticCurveTo(c.x, c.y, mx, my);
            }
            const lastT = topCurve[topCurve.length - 1];
            const lastB = botCurve[botCurve.length - 1];
            ctx.lineTo(lastT.x, lastT.y + 6);
            ctx.quadraticCurveTo(lastT.x + 5, (lastT.y + lastB.y) * 0.5, lastB.x, lastB.y + yOffsetBot);

            for (let i = botCurve.length - 1; i > 0; i--) {
                const c = botCurve[i];
                const n = botCurve[i - 1];
                const mx = (c.x + n.x) * 0.5;
                const my = (c.y + n.y) * 0.5 + yOffsetBot;
                ctx.quadraticCurveTo(c.x, c.y + yOffsetBot, mx, my);
            }
            const firstB = botCurve[0];
            const firstT = topCurve[0];
            ctx.quadraticCurveTo(firstT.x - 5, (firstT.y + firstB.y) * 0.5, firstT.x, firstT.y + 6);
            ctx.closePath();
        };

        // 1. Cast shadow of overhanging snow cap onto the rock below
        ctx.save();
        traceSnowRibbon(6);
        ctx.fillStyle = 'rgba(6, 12, 26, 0.50)';
        ctx.fill();
        ctx.restore();

        // 2. Lower Ice-Blue Snow Shadow Lip
        ctx.save();
        traceSnowRibbon(0);
        ctx.fillStyle = '#7dd3fc';
        ctx.fill();
        ctx.restore();

        // 3. Mid Periwinkle Snow Layer
        ctx.save();
        traceSnowRibbon(-4);
        ctx.fillStyle = '#dbeafe';
        ctx.fill();
        ctx.restore();

        // 4. Pure Sunlit White Upper Snow Blanket
        ctx.save();
        traceSnowRibbon(-8);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.restore();

        // 5. Crisp Outer Contour around the Snow Blanket
        ctx.save();
        traceSnowRibbon(0);
        ctx.strokeStyle = '#0f2547';
        ctx.lineWidth = 3.5;
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.restore();
    }

    // ========================================================================
    // HANGING TRANSLUCENT ICICLES UNDER ROCK CEILINGS
    // ========================================================================

    static _drawUnderLedgeIcicles(ctx, bottomChains) {
        ctx.save();
        for (const seg of bottomChains) {
            const y = seg.y - 2;
            const startX = seg.x1 + 14;
            const endX = seg.x2 - 14;

            for (let x = startX; x < endX; x += 24) {
                const h = 16 + ((x * 37) % 26);
                const w = 8 + ((x * 13) % 6);

                const grad = ctx.createLinearGradient(x, y, x, y + h);
                grad.addColorStop(0, '#bae6fd');
                grad.addColorStop(0.6, '#38bdf8');
                grad.addColorStop(1, 'rgba(224, 242, 254, 0.85)');

                ctx.beginPath();
                ctx.moveTo(x - w * 0.5, y);
                ctx.lineTo(x + w * 0.5, y);
                ctx.lineTo(x, y + h);
                ctx.closePath();
                ctx.fillStyle = grad;
                ctx.fill();
                ctx.strokeStyle = '#0c4a6e';
                ctx.lineWidth = 1.8;
                ctx.stroke();
            }
        }
        ctx.restore();
    }

    // ========================================================================
    // TIMBER & IRON SUSPENSION BRIDGES (WOOD_BRIDGE)
    // ========================================================================

    static _extractHorizontalSpans(grid, W, H, targetType) {
        const spans = [];
        for (let y = 0; y < H; y++) {
            let x = 0;
            while (x < W) {
                if (grid[y][x] === targetType) {
                    const x1 = x;
                    while (x + 1 < W && grid[y][x + 1] === targetType) x++;
                    spans.push({ x1, x2: x, y });
                }
                x++;
            }
        }
        return spans;
    }

    static _roundRectPath(ctx, x, y, w, h, r) {
        const rad = Math.max(0, Math.min(r, w * 0.5, h * 0.5));
        ctx.beginPath();
        ctx.moveTo(x + rad, y);
        ctx.lineTo(x + w - rad, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
        ctx.lineTo(x + w, y + h - rad);
        ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
        ctx.lineTo(x + rad, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
        ctx.lineTo(x, y + rad);
        ctx.quadraticCurveTo(x, y, x + rad, y);
        ctx.closePath();
    }

    static _drawTimberBridge(ctx, x, y, width, _height) {
        ctx.save();

        // 1. Under-bridge arched steel truss & diagonal struts
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(x - 10, y + 48);
        ctx.quadraticCurveTo(x + width * 0.5, y + 6, x + width + 10, y + 48);
        ctx.stroke();

        ctx.lineWidth = 3.5;
        for (let px = x + 28; px < x + width - 10; px += 46) {
            ctx.beginPath();
            ctx.moveTo(px, y + 18);
            ctx.lineTo(px, y + 42);
            ctx.stroke();
        }

        // 2. Main Horizontal Steel Girder Beam
        const beamGrad = ctx.createLinearGradient(x, y + 16, x, y + 34);
        beamGrad.addColorStop(0, '#475569');
        beamGrad.addColorStop(0.5, '#1e293b');
        beamGrad.addColorStop(1, '#0f172a');
        ctx.fillStyle = beamGrad;
        this._roundRectPath(ctx, x - 6, y + 16, width + 12, 18, 6);
        ctx.fill();
        ctx.strokeStyle = '#090d16';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Steel rivets along the girder
        ctx.fillStyle = '#94a3b8';
        for (let rx = x + 10; rx < x + width - 4; rx += 28) {
            ctx.beginPath();
            ctx.arc(rx, y + 25, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }

        // 3. Individual Bevelled Warm Cedar Planks along the top
        const plankW = 32;
        const gap = 3;
        for (let px = x; px < x + width - 4; px += plankW + gap) {
            const pw = Math.min(plankW, x + width - px);
            const pGrad = ctx.createLinearGradient(px, y, px, y + 20);
            pGrad.addColorStop(0, '#d97706');
            pGrad.addColorStop(0.35, '#b45309');
            pGrad.addColorStop(1, '#78350f');

            ctx.fillStyle = pGrad;
            this._roundRectPath(ctx, px, y + 1, pw, 18, 5);
            ctx.fill();
            ctx.strokeStyle = '#271206';
            ctx.lineWidth = 2.5;
            ctx.stroke();

            ctx.fillStyle = 'rgba(254, 243, 199, 0.28)';
            ctx.fillRect(px + 3, y + 3, pw - 6, 3);
        }

        // 4. Thin Snow Cushions on the Bridge
        for (let sx = x + 8; sx < x + width - 28; sx += 52) {
            const sw = 34 + ((sx * 17) % 14);
            this._roundRectPath(ctx, sx, y - 4, sw, 9, 5);
            ctx.fillStyle = '#f8fafc';
            ctx.fill();
            ctx.strokeStyle = '#1e3a8a';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        ctx.restore();
    }

    // ========================================================================
    // TEEWORLDS-STYLE GLACIAL CRYSTAL GRAPPLE PODS (HOOK_CRYSTAL)
    // ========================================================================

    static _extractRectPods(grid, W, H, targetType) {
        const visited = Array.from({ length: H }, () => new Uint8Array(W));
        const pods = [];

        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                if (grid[y][x] !== targetType || visited[y][x]) continue;
                let x2 = x;
                while (x2 + 1 < W && grid[y][x2 + 1] === targetType && !visited[y][x2 + 1]) x2++;
                let y2 = y;
                while (y2 + 1 < H) {
                    let rowOk = true;
                    for (let tx = x; tx <= x2; tx++) {
                        if (grid[y2 + 1][tx] !== targetType || visited[y2 + 1][tx]) {
                            rowOk = false;
                            break;
                        }
                    }
                    if (!rowOk) break;
                    y2++;
                }
                for (let ty = y; ty <= y2; ty++) {
                    for (let tx = x; tx <= x2; tx++) visited[ty][tx] = 1;
                }
                pods.push({ x1: x, y1: y, x2, y2 });
            }
        }
        return pods;
    }

    static _drawCrystalGrapplePod(ctx, x, y, w, h) {
        const ch = 16;
        const cx = x + w * 0.5;
        const cy = y + h * 0.5;

        const traceChamfer = (inset = 0) => {
            const ix = x + inset, iy = y + inset;
            const iw = w - inset * 2, ih = h - inset * 2;
            const c = Math.max(4, ch - inset * 0.6);
            ctx.beginPath();
            ctx.moveTo(ix + c, iy);
            ctx.lineTo(ix + iw - c, iy);
            ctx.lineTo(ix + iw, iy + c);
            ctx.lineTo(ix + iw, iy + ih - c);
            ctx.lineTo(ix + iw - c, iy + ih);
            ctx.lineTo(ix + c, iy + ih);
            ctx.lineTo(ix, iy + ih - c);
            ctx.lineTo(ix, iy + c);
            ctx.closePath();
        };

        // 1. Baked Radial Cyan Aura (fast radial gradient instead of shadowBlur)
        const auraR = Math.max(w, h) * 0.75;
        const auraGrad = ctx.createRadialGradient(cx, cy, auraR * 0.2, cx, cy, auraR);
        auraGrad.addColorStop(0, 'rgba(56, 189, 248, 0.35)');
        auraGrad.addColorStop(1, 'rgba(56, 189, 248, 0)');
        ctx.fillStyle = auraGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, auraR, 0, Math.PI * 2);
        ctx.fill();

        // 2. Outer Dark-Steel Armor Frame
        ctx.save();
        traceChamfer(0);
        const frameGrad = ctx.createLinearGradient(x, y, x, y + h);
        frameGrad.addColorStop(0, '#334155');
        frameGrad.addColorStop(0.5, '#1e293b');
        frameGrad.addColorStop(1, '#0f172a');
        ctx.fillStyle = frameGrad;
        ctx.fill();
        ctx.strokeStyle = '#090d16';
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.restore();

        // 3. Inner Glowing Glacial Crystal Core
        ctx.save();
        traceChamfer(10);
        ctx.clip();

        const iceGrad = ctx.createLinearGradient(x, y + 10, x + w, y + h - 10);
        iceGrad.addColorStop(0.0, '#7dd3fc');
        iceGrad.addColorStop(0.35, '#38bdf8');
        iceGrad.addColorStop(0.7, '#0284c7');
        iceGrad.addColorStop(1.0, '#0369a1');
        ctx.fillStyle = iceGrad;
        ctx.fillRect(x, y, w, h);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.26)';
        for (let sx = x - h; sx < x + w + h; sx += 64) {
            ctx.beginPath();
            ctx.moveTo(sx, y);
            ctx.lineTo(sx + 24, y);
            ctx.lineTo(sx - 18, y + h);
            ctx.lineTo(sx - 42, y + h);
            ctx.closePath();
            ctx.fill();
        }

        traceChamfer(10);
        ctx.strokeStyle = '#e0f2fe';
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.restore();

        // 4. Grapple Target Emblem + Under-Pod Iron Grapple Rings
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, Math.min(w, h) * 0.22, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
        ctx.fill();
        ctx.strokeStyle = '#e0f2fe';
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        for (let rx = x + 40; rx <= x + w - 40; rx += 65) {
            ctx.beginPath();
            ctx.arc(rx, y + h + 6, 8, 0, Math.PI * 2);
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 3.5;
            ctx.stroke();
        }
        ctx.restore();
    }

    // ========================================================================
    // BAKED WARM GOLDEN STREET-LANTERNS & GLOWING CRYSTALS (Zero GPU Overhead)
    // ========================================================================

    static _drawBakedLanternsAndCrystals(ctx, T) {
        const lanterns = [
            { tx: 14.5, ty: 25 },  // Left Sunken Cavern Under-Tunnel
            { tx: 27.5, ty: 23 },  // Left Waterside Watchtower
            { tx: 45.0, ty: 21 },  // Right Inner Cliff Bastion
            { tx: 55.0, ty: 25 },  // Right Sunken Cavern Under-Tunnel
            { tx: 14.0, ty: 18 },  // Left-Mid Cavern Bunker
            { tx: 8.0,  ty: 10 },  // Left Upper Gallery
            { tx: 14.5, ty: 8  },  // Left Upper Bastion
            { tx: 26.5, ty: 13 },  // Center-Left Ziggurat Crown
            { tx: 45.0, ty: 12 },  // Center-Right Fortress Arch
            { tx: 57.5, ty: 8  },  // Right Upper Vaulted Gallery
            { tx: 58.5, ty: 17 },  // Right-Mid Cavern Bunker
        ];

        ctx.save();
        for (const l of lanterns) {
            const lx = l.tx * T;
            const ly = l.ty * T;

            // Warm radial light halo around lantern head (baked into texture!)
            const halo = ctx.createRadialGradient(lx, ly - 64, 4, lx, ly - 64, 120);
            halo.addColorStop(0.00, 'rgba(254, 240, 138, 0.58)');
            halo.addColorStop(0.35, 'rgba(251, 191, 36, 0.24)');
            halo.addColorStop(1.00, 'rgba(251, 191, 36, 0)');
            ctx.fillStyle = halo;
            ctx.beginPath();
            ctx.arc(lx, ly - 64, 120, 0, Math.PI * 2);
            ctx.fill();

            // Warm golden reflection pool on the snow below
            const pool = ctx.createRadialGradient(lx, ly - 2, 4, lx, ly - 2, 58);
            pool.addColorStop(0.00, 'rgba(253, 224, 71, 0.35)');
            pool.addColorStop(1.00, 'rgba(253, 224, 71, 0)');
            ctx.fillStyle = pool;
            ctx.beginPath();
            ctx.ellipse(lx, ly - 2, 58, 12, 0, 0, Math.PI * 2);
            ctx.fill();

            // Wrought-iron lantern post & housing
            ctx.fillStyle = '#0f172a';
            ctx.fillRect(lx - 3, ly - 58, 6, 58);
            ctx.fillRect(lx - 9, ly - 6, 18, 6);
            this._roundRectPath(ctx, lx - 10, ly - 74, 20, 18, 4);
            ctx.fillStyle = '#1e293b';
            ctx.fill();
            ctx.strokeStyle = '#090d16';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Glowing warm bulb
            ctx.fillStyle = '#fef9c3';
            ctx.beginPath();
            ctx.arc(lx, ly - 65, 6, 0, Math.PI * 2);
            ctx.fill();
        }

        // Glowing Glacial Crystal Clusters embedded along cavern ceilings & tunnel walls
        const crystalClusters = [
            { tx: 9.0,  ty: 13.0, flip: 1 },   // Under Left Upper Gallery ceiling
            { tx: 14.5, ty: 21.0, flip: 1 },   // Under Left-Mid Bunker ceiling
            { tx: 25.5, ty: 20.0, flip: 1 },   // Under Ziggurat cavern ceiling
            { tx: 36.0, ty: 17.0, flip: 1 },   // Under Central Citadel keel
            { tx: 48.5, ty: 18.0, flip: 1 },   // Under Center-Right Arch ceiling
            { tx: 58.0, ty: 20.0, flip: 1 },   // Under Right-Mid Bunker ceiling
            { tx: 57.5, ty: 11.0, flip: 1 },   // Under Right Upper Gallery ceiling
            { tx: 9.0,  ty: 5.0,  flip: 1 },   // Under Left Ceiling Stalactite
            { tx: 25.0, ty: 6.0,  flip: 1 },   // Under Center-Left Ceiling Stalactite
            { tx: 47.0, ty: 6.0,  flip: 1 },   // Under Center-Right Ceiling Stalactite
            { tx: 63.0, ty: 5.0,  flip: 1 },   // Under Right Ceiling Stalactite
        ];

        for (const c of crystalClusters) {
            const cx = c.tx * T;
            const cy = c.ty * T;

            const glow = ctx.createRadialGradient(cx, cy + 16 * c.flip, 4, cx, cy + 16 * c.flip, 88);
            glow.addColorStop(0.0, 'rgba(56, 189, 248, 0.42)');
            glow.addColorStop(0.5, 'rgba(14, 165, 233, 0.14)');
            glow.addColorStop(1.0, 'rgba(14, 165, 233, 0)');
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(cx, cy + 16 * c.flip, 88, 0, Math.PI * 2);
            ctx.fill();

            const shards = [
                { dx: -14, ang: -0.28, len: 28, w: 9 },
                { dx: 0,   ang: 0.04,  len: 38, w: 12 },
                { dx: 13,  ang: 0.30,  len: 25, w: 8 },
            ];
            for (const sh of shards) {
                ctx.save();
                ctx.translate(cx + sh.dx, cy - 4 * c.flip);
                ctx.rotate(sh.ang);
                ctx.beginPath();
                ctx.moveTo(-sh.w * 0.5, 0);
                ctx.lineTo(sh.w * 0.5, 0);
                ctx.lineTo(sh.w * 0.22, sh.len * c.flip);
                ctx.lineTo(0, (sh.len + 9) * c.flip);
                ctx.lineTo(-sh.w * 0.22, sh.len * c.flip);
                ctx.closePath();
                ctx.fillStyle = '#38bdf8';
                ctx.fill();
                ctx.strokeStyle = '#e0f2fe';
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.restore();
            }
        }

        ctx.restore();
    }
}
