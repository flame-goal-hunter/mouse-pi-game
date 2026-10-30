import { generateHeistFloor } from '../sneak/ProceduralHeistGenerator.js';
import { Progress } from '../storage/ProgressStore.js';
import { bus } from '../audio/EventBus.js';
import { SFX } from '../audio/SoundKeys.js';
import { preloadAudio } from '../audio/AudioManager.js';

// ============================================================================
// SneakScene.js — «Тихая лапка» (Silent Paw)
//
// 1. HD 3/4 Castle Canvas2D Renderer (Snowball ArenaRenderer style):
//    - 3D bevelled castle walls with top caps, front masonry cliff faces,
//      wooden baseboards, and soft drop shadows (`shadowBlur`).
//    - Elevated 3D Balconies ('B') with stone balustrades & cliff drop-offs.
//    - Iron-Barred Treasury Vaults ('V' & 'G') with metallic 3D grate bars.
//    - Real SVG world props from `assets/world/*.svg` (`bookshelf`, `cage`,
//      `candelabra_lit`, `torch_sconce`, `chest_closed`, `chest_open`,
//      `glowpod`, `moonflower`, `relic_urn`, `lock`, `unlock`, `stairs`).
//
// 2. Signature Hold-to-Burrow Mechanic («Нажать у норки, задержать — и попасть!»):
//    - Stand near any Burrow and HOLD the glossy «ДЕРЖИ: НОРА» button (or Space).
//    - While holding (0.55s):
//      * A golden progress ring fills around the burrow (0% -> 100%).
//      * Pi tucks into the burrow mouth (safe from monster vision!) while a
//        glowing underground preview line shows where you will emerge
//        (up on the 3D Balcony, inside the Iron Vault, into the Secret Room,
//        or across the hall!). Tilt the joystick while holding to switch branches!
//    - When the ring completes:
//      * Pi zips underground with an animated floor-ripple wave & pops out
//        at the destination! Chasing monsters lose track of Pi ("?").
// ============================================================================

const HOLD_BURROW_MS = 540;
const SQUEEZE_TRAVEL_MS = 380;

const PLAYER_BASE_SPEED = 182;
const PLAYER_DASH_SPEED = 355;
const PLAYER_DASH_MS = 250;
const PLAYER_DASH_CD_MS = 1550;

const PIE_SPEED = 430;
const PIE_BLIND_RADIUS = 95;
const PIE_HEAR_RADIUS = 360;
const PIE_BLIND_MS = 4200;
const PIE_DISTRACT_MS = 3600;

const WHISTLE_DISTRACT_MS = 4400;
const CATCH_DIST = 34;
const SUSPICION_FILL_MS = 520;
const SUSPICION_DECAY_MS = 900;

const SKIN_KEYS = [
    'brown', 'pink', 'yellow-antler', 'robot', 'green-monster', 'shadow',
    'devil', 'angel', 'yellow-lion', 'bear', 'frog', 'professor',
    'pirate', 'astronaut', 'kitty', 'beaver', 'cockroach'
];

const RUN_PERKS = [
    {
        id: 'fast_burrow',
        icon: '🕳️',
        title: 'Мастер Норок',
        desc: 'Кольцо входа в норку заполняется в 2 раза быстрее + 3 сек. ускорения после выхода!',
        color: '#10b981'
    },
    {
        id: 'ninja_paws',
        icon: '🐾',
        title: 'Бархатные Лапки',
        desc: '+18% к скорости бега и тихий шаг',
        color: '#38bdf8'
    },
    {
        id: 'cake_factory',
        icon: '🥧',
        title: 'Запас Пирогов',
        desc: '+2 сырных пирога на каждом этаже для ослепления монстров',
        color: '#f472b6'
    },
    {
        id: 'cheese_magnet',
        icon: '🧲',
        title: 'Сырный Магнит',
        desc: 'Сыр сам притягивается к Пи издалека (+30% к ценности сыра)',
        color: '#facc15'
    },
    {
        id: 'extra_heart',
        icon: '💖',
        title: 'Тёплое Сердечко',
        desc: 'Полное исцеление сердечек + 20 бонусного сыра в копилку',
        color: '#fb7185'
    }
];

export class SneakScene extends Phaser.Scene {
    constructor() {
        super({ key: 'SneakScene' });
    }

    init(data) {
        this.floor = Math.max(
            1,
            data?.floor || (typeof data?.roomIndex === 'number' ? data.roomIndex + 1 : 1)
        );
        this.carriedCheese = data?.carriedCheese ?? 0;
        this.bankedInRun = data?.bankedInRun ?? 0;
        this.totalRescuedInRun = data?.totalRescuedInRun ?? 0;
        this.rescuedFollowers = data?.rescuedFollowers ? [...data.rescuedFollowers] : [];
        this.streak = data?.streak ?? 1.0;
        this.hearts = data?.hearts ?? 3;
        this.maxHearts = data?.maxHearts ?? 3;
        this.piesLeft = data?.piesLeft ?? 2;
        this.runPerks = data?.runPerks ? { ...data.runPerks } : {};
        this.everSeenInRun = data?.everSeenInRun ?? false;
    }

    preload() {
        preloadAudio(this);

        const base = 'assets/characters/transylvania/';
        this.load.svg('d_pi',       base + 'pi.svg',       { width: 150, height: 172 });
        this.load.svg('d_pi_walk1', base + 'pi-walk1.svg', { width: 150, height: 172 });
        this.load.svg('d_pi_walk2', base + 'pi-walk2.svg', { width: 150, height: 172 });

        const backBase = base + 'back/';
        this.load.svg('d_pi_b',       backBase + 'pi.svg',       { width: 150, height: 172 });
        this.load.svg('d_pi_walk1_b', backBase + 'pi-walk1.svg', { width: 150, height: 172 });
        this.load.svg('d_pi_walk2_b', backBase + 'pi-walk2.svg', { width: 150, height: 172 });

        const skinBase = base + 'skins/';
        for (const k of SKIN_KEYS) {
            const safeId = k.replace(/-/g, '_');
            this.load.svg('skin_' + safeId,         skinBase + k + '.svg',       { width: 150, height: 172 });
            this.load.svg('skin_' + safeId + '_w1', skinBase + k + '-walk1.svg', { width: 150, height: 172 });
            this.load.svg('skin_' + safeId + '_w2', skinBase + k + '-walk2.svg', { width: 150, height: 172 });
            this.load.svg('skin_' + safeId + '_b',  backBase + k + '.svg',       { width: 150, height: 172 });
        }

        // Daughter's hand-drawn monsters
        this.load.svg('d_zombie',   base + 'zombie.svg',   { width: 180, height: 210 });
        this.load.svg('d_count',    base + 'count.svg',    { width: 200, height: 234 });
        this.load.svg('d_cat',      base + 'cat.svg',      { width: 165, height: 150 });
        this.load.svg('d_slime',    base + 'slime.svg',    { width: 180, height: 135 });
        this.load.svg('d_cheese',   base + 'cheese.svg',   { width: 48,  height: 40 });
        this.load.svg('d_pie',      base + 'pie.svg',      { width: 40,  height: 40 });
        this.load.svg('d_key',      base + 'key.svg',      { width: 60,  height: 32 });
        this.load.svg('d_grandma',  base + 'grandma.svg',  { width: 135, height: 150 });
        this.load.svg('d_bat',      base + 'bat.svg',      { width: 150, height: 120 });
        this.load.svg('d_skeleton', base + 'skeleton.svg', { width: 150, height: 180 });
        this.load.svg('d_ghost',    base + 'ghost.svg',    { width: 150, height: 180 });
        this.load.svg('d_mimic',    base + 'mimic.svg',    { width: 150, height: 150 });

        // Handcrafted SVG World Props & Badges from `assets/world/`
        const dpr = window.__GAME_DPR || 1;
        const propScale = Math.round(64 * dpr);
        const worldProps = [
            'bookshelf', 'cage', 'candelabra_lit', 'chest_closed', 'chest_open',
            'cobweb', 'glowpod', 'goblet', 'lock', 'moonflower', 'mushroom',
            'pot', 'redCarpet', 'relic_urn', 'stairs', 'torch_sconce', 'unlock',
            'badge_alert', 'badge_anger', 'badge_ear', 'badge_sleep', 'badge_sparkle'
        ];
        for (const p of worldProps) {
            this.load.svg('w_' + p, `assets/world/${p}.svg`, { width: propScale, height: propScale });
        }
        this.load.svg('relic_crown', 'assets/relics/crown.svg', { width: propScale, height: propScale });
        this.load.svg('relic_gift',  'assets/relics/gift.svg',  { width: propScale, height: propScale });
    }

    create() {
        this.dpr = window.__GAME_DPR || 1;

        this.skinSpeedMul = 1;
        this.skinDashCdMul = 1;
        this.skinStealthMul = 1;
        try {
            const sk = Progress.getCurrentSkin?.();
            if (sk?.perk?.apply) {
                const dummy = { maxHp: this.maxHearts, speedMul: 1, dashCdMul: 1, stealthMul: 1 };
                sk.perk.apply(dummy);
                this.skinSpeedMul = dummy.speedMul || 1;
                this.skinDashCdMul = dummy.dashCdMul || 1;
                this.skinStealthMul = dummy.stealthMul || 1;
            }
        } catch (_) {}

        if (this.runPerks.cake_factory) {
            this.piesLeft = Math.min(9, this.piesLeft + 2);
        }

        // 1. Generate Infinite Procedural 3/4 Castle Floor
        this.room = generateHeistFloor(this.floor);
        this.biome = this.room.biome;

        const mapPxW = this.room.W * this.room.cell;
        const mapPxH = this.room.H * this.room.cell;

        this.cameras.main.setBackgroundColor('#090514');

        // 2. Render HD 3/4 Castle CanvasTexture (Snowball ArenaRenderer style!)
        this._render3D4CastleCanvas(mapPxW, mapPxH);
        this._placeSvgWorldProps();
        this._buildBurrowNetworkVisuals();
        this._buildShadowFlowers();
        this._buildObjectivesAndLoot();

        // 3. Player (Pi) + Follower Train + Burrow Hold Ring & Preview Line
        this._buildPlayer();

        // 4. Daughter's Hand-Drawn Monsters + Patrol Trail + Vision Cones
        this._buildPatrolTrails();
        this._buildMonsters();

        // 5. Camera setup — framed cleanly in CSS pixels * DPR
        const cssW = this.scale.width / this.dpr;
        const cssH = this.scale.height / this.dpr;
        const fitZoom = Math.min(cssW / (mapPxW + 60), cssH / (mapPxH + 80));
        const targetZoom = Math.max(0.68, Math.min(1.08, fitZoom * 1.22));
        this.cameras.main.setZoom(targetZoom * this.dpr);
        this.cameras.main.setBounds(-100, -90, mapPxW + 200, mapPxH + 180);
        this.cameras.main.startFollow(this.player, true, 0.14, 0.14);

        // 6. State flags for Hold-to-Burrow mechanic
        this.seenOnThisFloor = false;
        this.ended = false;
        this.isPaused = false;
        this.state = 'play'; // 'play' | 'squeeze'
        this.hasKey = false;
        this.friendRescued = false;
        this.exitUnlocked = false;

        this.holeHoldDown = false;
        this.holeHoldMs = 0;
        this.holeHoldArmed = true;
        this.activeNearHole = null;
        this.selectedTargetIdx = 0;
        this.branchSwitchCooldown = 0;

        this.invulnerableUntil = this.time.now + 1200;
        this.dashUntil = 0;
        this.dashCooldownUntil = 0;
        this.turboUntil = 0;
        this.whistleCooldownUntil = 0;

        // 7. Mount Glossy 3D Touch Controls & HUD
        this._mountDomControlsAndHud();
        this._setupKeyboard();
        this._showToast(`🏰 Этаж ${this.floor}: ${this.biome.name} — Ныряй в норки за Ключом и Другом!`, '#facc15');

        if (this.biome?.bgm) {
            bus.emit(this.biome.bgm);
        }
        this._playMusicalChime([523.25, 659.25, 783.99, 1046.5], 0.08, 'triangle');

        this.events.on('shutdown', () => this._unmountDomControls());
        this.events.on('destroy', () => this._unmountDomControls());
    }

    // =========================================================================
    // 1. HD 3/4 CASTLE CANVAS2D RENDERER (Rich 3D Walls, Balconies, Iron Vaults)
    // =========================================================================

    _render3D4CastleCanvas(mapPxW, mapPxH) {
        const { W, H, cell, grid, biome, balconyBounds, vaultBounds, secretRoom } = this.room;
        const texKey = `sneak_castle_canvas_${this.floor}_${this.room.seed}`;
        if (this.textures.exists(texKey)) this.textures.remove(texKey);

        const pad = cell * 2;
        const canvasW = mapPxW + pad * 2;
        const canvasH = mapPxH + pad * 2;

        const canvasTex = this.textures.createCanvas(texKey, canvasW, canvasH);
        const ctx = canvasTex.getContext();

        ctx.save();
        ctx.translate(pad, pad);

        // 1. Deep Atmospheric Outer Backdrop
        const bgGrad = ctx.createRadialGradient(
            mapPxW * 0.5, mapPxH * 0.5, cell * 2,
            mapPxW * 0.5, mapPxH * 0.5, Math.max(mapPxW, mapPxH) * 0.75
        );
        bgGrad.addColorStop(0, biome.wallFace);
        bgGrad.addColorStop(1, '#07040e');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(-pad, -pad, canvasW, canvasH);

        // 2. Render Walkable Floors (Main Hall '.', Elevated Balcony 'B', Iron Vault 'V', Secret Room 'S')
        for (let gy = 0; gy < H; gy++) {
            for (let gx = 0; gx < W; gx++) {
                const t = grid[gy][gx];
                if (t === '#') continue;

                const px = gx * cell;
                const py = gy * cell;

                // Base stone flagstone fill
                if (t === 'B') {
                    ctx.fillStyle = biome.balconyTop;
                } else if (t === 'V' || t === 'G') {
                    ctx.fillStyle = biome.vaultFloor;
                } else if (t === 'S') {
                    ctx.fillStyle = '#3b2110';
                } else {
                    ctx.fillStyle = ((gx + gy) % 2 === 0) ? biome.floorA : biome.floorB;
                }
                ctx.fillRect(px, py, cell, cell);

                // Recessed flagstone bevel & grout lines
                ctx.strokeStyle = biome.floorGrouts;
                ctx.lineWidth = 2;
                ctx.strokeRect(px + 1, py + 1, cell - 2, cell - 2);

                // Subtle inner highlight on each stone slab
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(px + 4, py + 4, cell - 8, cell - 8);

                // Secret Room golden floor shimmer
                if (t === 'S') {
                    ctx.fillStyle = 'rgba(250, 204, 21, 0.12)';
                    ctx.fillRect(px + 3, py + 3, cell - 6, cell - 6);
                }
            }
        }

        // 3. Royal Plush Carpet Runner down the center of the Main Hall
        const carpetY = Math.floor(H * 0.52) * cell;
        const carpetX1 = 3 * cell;
        const carpetW = (W - 6) * cell;
        ctx.save();
        ctx.fillStyle = biome.carpetColor;
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.roundRect(carpetX1, carpetY - cell * 0.45, carpetW, cell * 0.9, 12);
        ctx.fill();
        ctx.strokeStyle = biome.carpetGold;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.restore();

        // 4. Cast Soft Ambient Occlusion Shadows from all 3D Walls onto Walkable Floors
        ctx.save();
        for (let gy = 0; gy < H; gy++) {
            for (let gx = 0; gx < W; gx++) {
                if (grid[gy][gx] !== '#') continue;
                const px = gx * cell;
                const py = gy * cell;
                // If tile below is walkable, cast a rich 3/4 drop shadow downward
                if (gy + 1 < H && grid[gy + 1][gx] !== '#') {
                    const shGrad = ctx.createLinearGradient(0, py + cell, 0, py + cell + 26);
                    shGrad.addColorStop(0, 'rgba(0, 0, 0, 0.62)');
                    shGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                    ctx.fillStyle = shGrad;
                    ctx.fillRect(px, py + cell, cell, 26);
                }
            }
        }
        ctx.restore();

        // 5. Render 3/4 Perspective 3D Castle Walls ('#')
        // Each wall block has:
        // - Raised Roof Cap (upper 65% of cell or full cell if wall continues below)
        // - Vertical 3D Front Cliff Face with carved stone bricks & baseboard when exposed to floor below!
        const faceH = 24; // Height of the 3/4 front wall face
        for (let gy = 0; gy < H; gy++) {
            for (let gx = 0; gx < W; gx++) {
                if (grid[gy][gx] !== '#') continue;
                const px = gx * cell;
                const py = gy * cell;
                const exposedBelow = (gy + 1 < H && grid[gy + 1][gx] !== '#');
                const isBalconyCliff = (gy === 3 && gx >= balconyBounds.x1 && gx <= balconyBounds.x2);

                const capH = exposedBelow ? (cell - faceH) : cell;

                // Wall Top Roof Cap
                const capGrad = ctx.createLinearGradient(px, py, px, py + capH);
                capGrad.addColorStop(0, biome.wallTopHi);
                capGrad.addColorStop(1, biome.wallTop);
                ctx.fillStyle = capGrad;
                ctx.fillRect(px, py, cell, capH);

                // Stone block seams on top cap
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(px + 0.5, py + 0.5, cell - 1, capH - 1);

                // Top bevel highlight when air/floor is above
                if (gy > 0 && grid[gy - 1][gx] !== '#') {
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
                    ctx.fillRect(px, py, cell, 4);
                }

                // 3/4 Vertical Front Cliff Face (when exposed to a room below)
                if (exposedBelow) {
                    const fy = py + capH;
                    const faceGrad = ctx.createLinearGradient(px, fy, px, fy + faceH);
                    faceGrad.addColorStop(0, isBalconyCliff ? '#6d28d9' : biome.wallFace);
                    faceGrad.addColorStop(1, biome.wallFaceDark);
                    ctx.fillStyle = faceGrad;
                    ctx.fillRect(px, fy, cell, faceH);

                    // Carved stone courses on the front wall face
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(px + 3, fy + 3, cell * 0.45, faceH * 0.42);
                    ctx.strokeRect(px + cell * 0.5, fy + 3, cell * 0.45, faceH * 0.42);
                    ctx.strokeRect(px + 8, fy + faceH * 0.5, cell * 0.7, faceH * 0.35);

                    // Golden Balustrade Posts if this is the Elevated 3D Balcony Edge!
                    if (isBalconyCliff) {
                        ctx.fillStyle = '#fbbf24';
                        ctx.fillRect(px, py + capH - 5, cell, 5);
                        for (let bx = px + 8; bx < px + cell - 4; bx += 16) {
                            ctx.fillStyle = '#fde68a';
                            ctx.fillRect(bx, fy + 2, 6, faceH - 6);
                        }
                    } else {
                        // Classic wooden baseboard trim along bottom of wall face
                        ctx.fillStyle = '#451a03';
                        ctx.fillRect(px, fy + faceH - 5, cell, 5);
                        ctx.fillStyle = '#b45309';
                        ctx.fillRect(px, fy + faceH - 5, cell, 1.5);
                    }
                }
            }
        }

        // 6. Render 3D Iron Grate Bars ('G') in front of the Locked Treasury Vault ('V')
        for (let gy = 0; gy < H; gy++) {
            for (let gx = 0; gx < W; gx++) {
                if (grid[gy][gx] !== 'G') continue;
                const px = gx * cell;
                const py = gy * cell;

                // Shadow beneath the iron gate
                ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
                ctx.fillRect(px, py + cell * 0.65, cell, 14);

                // Horizontal iron crossbars
                ctx.fillStyle = '#475569';
                ctx.fillRect(px, py + 14, cell, 6);
                ctx.fillRect(px, py + cell - 14, cell, 6);

                // Vertical 3D metallic bars with specular shine
                for (let bx = px + 7; bx < px + cell; bx += 12) {
                    ctx.fillStyle = '#1e293b';
                    ctx.fillRect(bx - 1, py + 6, 6, cell - 12);
                    ctx.fillStyle = '#94a3b8';
                    ctx.fillRect(bx, py + 6, 3, cell - 12);
                    ctx.fillStyle = '#f8fafc';
                    ctx.fillRect(bx, py + 6, 1, cell - 12);
                }
            }
        }

        // 7. Bake Warm Torch & Burrow Glow Pools into the CanvasTexture
        this.room.props.forEach((p) => {
            if (p.type === 'torch_sconce' || p.type === 'candelabra_lit') {
                const rad = ctx.createRadialGradient(p.x, p.y, 4, p.x, p.y, cell * 1.85);
                rad.addColorStop(0, 'rgba(251, 191, 36, 0.28)');
                rad.addColorStop(0.5, 'rgba(245, 158, 11, 0.10)');
                rad.addColorStop(1, 'rgba(245, 158, 11, 0)');
                ctx.fillStyle = rad;
                ctx.beginPath();
                ctx.arc(p.x, p.y, cell * 1.85, 0, Math.PI * 2);
                ctx.fill();
            }
        });

        ctx.restore();
        canvasTex.refresh();

        this.add.image(-pad, -pad, texKey).setOrigin(0, 0).setDepth(1);

        // Zone Callout Banners (so the player immediately sees the Elevated Balcony & Iron Vault!)
        const balcCenterX = ((balconyBounds.x1 + balconyBounds.x2 + 1) * 0.5) * cell;
        const balcTopY = balconyBounds.y1 * cell - 12;
        this.add.text(balcCenterX, balcTopY, '👑 ВЫСОКИЙ 3D-БАЛКОН (ТОЛЬКО ЧЕРЕЗ НОРКУ!)', {
            fontFamily: 'Nunito, sans-serif',
            fontSize: '12px',
            fontStyle: '900',
            color: '#fef08a',
            stroke: '#1e1b4b',
            strokeThickness: 4
        }).setOrigin(0.5).setDepth(25).setResolution(this.dpr);

        const vaultCenterX = ((vaultBounds.x1 + vaultBounds.x2 + 1) * 0.5) * cell;
        const vaultTopY = vaultBounds.y1 * cell - 12;
        this.add.text(vaultCenterX, vaultTopY, '🔒 СОКРОВИЩНИЦА ЗА РЕШЁТКОЙ (НЫРЯЙ В НОРКУ!)', {
            fontFamily: 'Nunito, sans-serif',
            fontSize: '12px',
            fontStyle: '900',
            color: '#6ee7b7',
            stroke: '#064e3b',
            strokeThickness: 4
        }).setOrigin(0.5).setDepth(25).setResolution(this.dpr);

        if (secretRoom) {
            const secCenterX = ((secretRoom.x1 + secretRoom.x2 + 1) * 0.5) * cell;
            const secBotY = (secretRoom.y + 1) * cell + 10;
            this.add.text(secCenterX, secBotY, '✨ ТАЙНАЯ КОМНАТА В СТЕНЕ', {
                fontFamily: 'Nunito, sans-serif',
                fontSize: '11.5px',
                fontStyle: '900',
                color: '#bae6fd',
                stroke: '#0f172a',
                strokeThickness: 4
            }).setOrigin(0.5).setDepth(25).setResolution(this.dpr);
        }
    }

    _placeSvgWorldProps() {
        (this.room.props || []).forEach((p) => {
            const key = 'w_' + p.type;
            if (!this.textures.exists(key)) return;
            const spr = this.add.image(p.x, p.y, key)
                .setDisplaySize(44, 44)
                .setDepth(12 + (p.depthOffset || 0));

            if (p.type === 'torch_sconce' || p.type === 'candelabra_lit') {
                this.tweens.add({
                    targets: spr,
                    scaleX: spr.scaleX * 1.05,
                    scaleY: spr.scaleY * 1.05,
                    duration: 550 + Math.random() * 250,
                    yoyo: true,
                    repeat: -1,
                    ease: 'Sine.easeInOut'
                });
            }
        });
    }

    // =========================================================================
    // 2. BURROW NETWORK VISUALS + HOLD RING & UNDERGROUND PREVIEW TRAIL
    // =========================================================================

    _buildBurrowNetworkVisuals() {
        // Subtle permanent floor connection lines between paired burrows
        const connGfx = this.add.graphics().setDepth(4);
        this.room.burrowPairs.forEach((bp) => {
            connGfx.lineStyle(2.5, bp.palette.hex, 0.22);
            const steps = 16;
            for (let i = 0; i < steps; i += 2) {
                const t1 = i / steps;
                const t2 = (i + 1) / steps;
                connGfx.lineBetween(
                    Phaser.Math.Linear(bp.a.x, bp.b.x, t1),
                    Phaser.Math.Linear(bp.a.y, bp.b.y, t1),
                    Phaser.Math.Linear(bp.a.x, bp.b.x, t2),
                    Phaser.Math.Linear(bp.a.y, bp.b.y, t2)
                );
            }
        });

        this.holeVisuals = this.room.holes.map((h) => {
            const c = this.add.container(h.x, h.y).setDepth(14);

            // Outer pulsing magic aura
            const glow = this.add.circle(0, 0, 26, h.colorHex, 0.24);
            this.tweens.add({
                targets: glow,
                scale: 1.22,
                alpha: 0.42,
                duration: 880,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });

            // 3D Stone-Rimmed Archway Burrow Mouth
            const rim = this.add.graphics();
            rim.fillStyle(0x09040e, 1);
            rim.fillEllipse(0, 2, 38, 28);
            rim.lineStyle(4, h.colorHex, 1);
            rim.strokeEllipse(0, 2, 38, 28);
            rim.lineStyle(1.5, 0xffffff, 0.65);
            rim.strokeEllipse(0, 0, 32, 22);

            const badge = this.add.text(0, -22, `🕳️ #${h.pairNum}`, {
                fontFamily: 'Nunito, sans-serif',
                fontSize: '11px',
                fontStyle: '900',
                color: '#ffffff',
                backgroundColor: h.colorCss,
                padding: { x: 5, y: 1 }
            }).setOrigin(0.5).setResolution(this.dpr);

            c.add([glow, rim, badge]);
            return { data: h, container: c, glow, rim, badge };
        });

        // Dynamic graphics for Hold-at-Burrow progress ring & destination preview beam
        this.burrowPreviewGfx = this.add.graphics().setDepth(45);
        this.burrowHoldRingGfx = this.add.graphics().setDepth(46);
        this.burrowTargetLabel = this.add.text(0, 0, '', {
            fontFamily: 'Nunito, sans-serif',
            fontSize: '12.5px',
            fontStyle: '900',
            color: '#fef08a',
            backgroundColor: 'rgba(15, 23, 42, 0.9)',
            padding: { x: 8, y: 3 }
        }).setOrigin(0.5).setDepth(47).setVisible(false).setResolution(this.dpr);
    }

    _buildShadowFlowers() {
        this.shadowZones = (this.room.shadowZones || []).map((sz) => {
            const c = this.add.container(sz.x, sz.y).setDepth(8);
            const pool = this.add.circle(0, 0, sz.r, 0x3b0764, 0.55)
                .setStrokeStyle(2, 0xc084fc, 0.65);
            const flower = this.add.image(0, -2, 'w_moonflower').setDisplaySize(38, 38);
            c.add([pool, flower]);
            return { ...sz, container: c };
        });
    }

    // =========================================================================
    // 3. OBJECTIVES: GOLDEN KEY, CAGED FRIEND (`cage.svg`), CHESTS & STAIRS
    // =========================================================================

    _buildObjectivesAndLoot() {
        // 1. Golden Key on the Elevated 3D Balcony
        const gk = this.room.goldenKey;
        const keyContainer = this.add.container(gk.x, gk.y).setDepth(18);
        const keyGlow = this.add.circle(0, 0, 24, 0xfacc15, 0.3);
        const keySpr = this.add.image(0, 0, 'd_key').setDisplaySize(46, 26);
        const keyLbl = this.add.text(0, -24, 'КЛЮЧ', {
            fontFamily: 'Nunito, sans-serif',
            fontSize: '11px',
            fontStyle: '900',
            color: '#fef08a',
            stroke: '#0f172a',
            strokeThickness: 3.5
        }).setOrigin(0.5).setResolution(this.dpr);
        keyContainer.add([keyGlow, keySpr, keyLbl]);
        this.tweens.add({
            targets: keyContainer,
            y: gk.y - 6,
            duration: 760,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
        this.keyObj = { ...gk, container: keyContainer, collected: false };

        // 2. Captive Pet Friend inside a real `w_cage` SVG inside the Iron-Barred Vault!
        this.petObjs = (this.room.captivePets || []).map((pet) => {
            const c = this.add.container(pet.x, pet.y).setDepth(18);
            const aura = this.add.circle(0, 0, 28, 0x10b981, 0.25);
            const friendTex = this.textures.exists(pet.spriteKey) ? pet.spriteKey : 'd_pi';
            const friendSpr = this.add.image(0, 2, friendTex).setScale(0.24);
            const cageSpr = this.add.image(0, 0, 'w_cage').setDisplaySize(54, 54);
            const lockSpr = this.add.image(16, 14, 'w_lock').setDisplaySize(22, 22);
            const nameLbl = this.add.text(0, -34, pet.name, {
                fontFamily: 'Nunito, sans-serif',
                fontSize: '11.5px',
                fontStyle: '900',
                color: '#a7f3d0',
                stroke: '#064e3b',
                strokeThickness: 4
            }).setOrigin(0.5).setResolution(this.dpr);

            c.add([aura, friendSpr, cageSpr, lockSpr, nameLbl]);
            return { ...pet, container: c, cageSpr, lockSpr, friendSpr, rescued: false };
        });

        // 3. Treasure Chests (`w_chest_closed` -> `w_chest_open`)
        this.chestObjs = (this.room.chests || []).map((ch) => {
            const spr = this.add.image(ch.x, ch.y, 'w_chest_closed')
                .setDisplaySize(44, 40)
                .setDepth(16);
            return { ...ch, sprite: spr, opened: false };
        });

        // 4. Cheese Wedges (`d_cheese`)
        this.cheeseObjs = (this.room.cheeses || []).map((ch) => {
            const spr = this.add.image(ch.x, ch.y, 'd_cheese')
                .setDisplaySize(26, 22)
                .setDepth(15);
            return { ...ch, sprite: spr, collected: false };
        });

        // 5. Exit Stairs (`w_stairs`) — locked until the Captive Friend is rescued!
        const ex = this.room.exit;
        this.exitContainer = this.add.container(ex.x, ex.y).setDepth(16);
        this.exitGlow = this.add.circle(0, 0, 30, 0xf43f5e, 0.25)
            .setStrokeStyle(3, 0xf43f5e, 0.85);
        this.exitStairsSpr = this.add.image(0, 0, 'w_stairs').setDisplaySize(54, 58);
        this.exitLockSpr = this.add.image(0, 0, 'w_lock').setDisplaySize(26, 26);
        this.exitBadge = this.add.text(0, -36, 'ВЫХОД ЗАКРЫТ', {
            fontFamily: 'Nunito, sans-serif',
            fontSize: '11px',
            fontStyle: '900',
            color: '#fda4af',
            stroke: '#0f172a',
            strokeThickness: 3.5
        }).setOrigin(0.5).setResolution(this.dpr);
        this.exitContainer.add([this.exitGlow, this.exitStairsSpr, this.exitLockSpr, this.exitBadge]);

        this.thrownPies = [];
    }

    _unlockExitStairs() {
        if (this.exitUnlocked) return;
        this.exitUnlocked = true;
        this.exitGlow.setFillStyle(0x10b981, 0.35);
        this.exitGlow.setStrokeStyle(3.5, 0x34d399, 1);
        if (this.exitLockSpr) {
            this.exitLockSpr.setTexture('w_unlock');
            this.tweens.add({
                targets: this.exitLockSpr,
                y: -25,
                alpha: 0,
                duration: 600
            });
        }
        this.exitBadge.setText('ВЫХОД ОТКРЫТ!');
        this.exitBadge.setColor('#4ade80');
    }

    // =========================================================================
    // 4. PLAYER (PI) & FOLLOWER TRAIN
    // =========================================================================

    _buildPlayer() {
        const skinObj = Progress.getCurrentSkin?.() || { id: 'blue', spriteKey: 'd_pi' };
        let baseKey = skinObj.spriteKey || 'd_pi';
        if (!this.textures.exists(baseKey)) baseKey = 'd_pi';

        this.playerSkinBase = baseKey;
        this.playerWalk1 = this.textures.exists(baseKey + '_w1') ? baseKey + '_w1' : 'd_pi_walk1';
        this.playerWalk2 = this.textures.exists(baseKey + '_w2') ? baseKey + '_w2' : 'd_pi_walk2';

        const sx = this.room.spawn.x;
        const sy = this.room.spawn.y;

        this.playerHalo = this.add.circle(sx, sy + 10, 18, 0x38bdf8, 0.25)
            .setStrokeStyle(2, 0x38bdf8, 0.85)
            .setDepth(28);

        this.player = this.add.image(sx, sy, this.playerSkinBase)
            .setScale(0.29)
            .setDepth(30);

        this.playerFacing = { x: 1, y: 0 };
        this.walkAnimTimer = 0;
        this.playerTrail = [{ x: sx, y: sy }];

        // Follower sprites for friends rescued in this run
        this.followerSprites = this.rescuedFollowers.slice(-4).map((fKey) => {
            const tex = this.textures.exists(fKey) ? fKey : 'd_pi';
            return this.add.image(sx, sy, tex).setScale(0.21).setDepth(29);
        });
    }

    // =========================================================================
    // 5. DAUGHTER'S HAND-DRAWN MONSTERS & DOTTED PATROL ROUTES
    // =========================================================================

    _buildPatrolTrails() {
        const g = this.add.graphics().setDepth(5);
        this.room.monsters.forEach((m) => {
            const pts = m.waypoints;
            if (!pts || pts.length < 2) return;
            for (let i = 0; i < pts.length; i++) {
                const a = pts[i];
                const b = pts[(i + 1) % pts.length];
                const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
                const steps = Math.max(2, Math.floor(dist / 22));
                for (let s = 0; s < steps; s++) {
                    const t = s / steps;
                    g.fillStyle(0xfacc15, 0.22);
                    g.fillCircle(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 2.2);
                }
            }
        });
    }

    _buildMonsters() {
        this.monsters = this.room.monsters.map((m) => {
            const coneGfx = this.add.graphics().setDepth(20);
            const shadow = this.add.ellipse(m.x, m.y + 18, 38, 14, 0x000000, 0.38).setDepth(29);
            const tex = this.textures.exists(m.spriteKey) ? m.spriteKey : 'd_cat';
            const sprite = this.add.image(m.x, m.y, tex)
                .setScale(m.scale || 0.33)
                .setDepth(31);

            const badgeSpr = this.add.image(m.x, m.y - 42, 'w_badge_alert')
                .setDisplaySize(28, 28)
                .setDepth(36)
                .setVisible(false);

            return {
                cfg: m,
                x: m.x,
                y: m.y,
                facingRad: 0,
                wpIndex: 1 % m.waypoints.length,
                state: 'patrol', // 'patrol' | 'alert' | 'chase' | 'blind' | 'confused'
                suspicion: 0,
                investigateTarget: null,
                investigateUntil: 0,
                blindUntil: 0,
                confusedUntil: 0,
                sprite,
                shadow,
                coneGfx,
                badgeSpr
            };
        });
    }

    _setMonsterBadge(m, badgeKey) {
        if (!badgeKey) {
            m.badgeSpr.setVisible(false);
            return;
        }
        const tex = 'w_' + badgeKey;
        if (this.textures.exists(tex)) {
            m.badgeSpr.setTexture(tex).setDisplaySize(28, 28).setVisible(true);
        }
    }

    // =========================================================================
    // 6. HOLD-AT-BURROW MECHANIC («НАЖАТЬ В НОРКЕ, ЗАДЕРЖАТЬ — И ПОПАСТЬ!»)
    // =========================================================================

    _findNearestBurrowHole() {
        if (!this.player) return null;
        let best = null;
        let bestD = this.room.cell * 0.92;
        for (const h of this.room.holes) {
            const d = Math.hypot(this.player.x - h.x, this.player.y - h.y);
            if (d < bestD) {
                bestD = d;
                best = h;
            }
        }
        return best;
    }

    _updateBurrowHoldMechanic(time, dt) {
        if (this.state !== 'play') return;

        const nearHole = this._findNearestBurrowHole();
        if (nearHole !== this.activeNearHole) {
            this.activeNearHole = nearHole;
            this.selectedTargetIdx = 0;
        }

        const isHolding = this.holeHoldDown || (this.keys?.space?.isDown ?? false);
        if (!isHolding) {
            this.holeHoldArmed = true;
        }

        this._updateBurrowDomButton(nearHole, isHolding);

        if (!nearHole || !isHolding || !this.holeHoldArmed) {
            if (this.holeHoldMs > 0) {
                this.holeHoldMs = 0;
                this.player.setScale(0.29).setAlpha(1);
            }
            this.burrowHoldRingGfx.clear();
            this.burrowPreviewGfx.clear();
            this.burrowTargetLabel.setVisible(false);

            // Even when not holding yet, if standing right by a burrow, show a faint preview line to its primary exit
            if (nearHole && nearHole.targets?.length) {
                const dest = nearHole.targets[this.selectedTargetIdx % nearHole.targets.length];
                this.burrowPreviewGfx.lineStyle(3, nearHole.colorHex, 0.45);
                this.burrowPreviewGfx.lineBetween(nearHole.x, nearHole.y, dest.x, dest.y);
                this.burrowPreviewGfx.strokeCircle(dest.x, dest.y, 22);
            }
            return;
        }

        // Allow switching between burrow branches with the joystick while holding!
        if (nearHole.targets.length > 1 && time > this.branchSwitchCooldown) {
            const jx = this.joyVec?.x || 0;
            const jy = this.joyVec?.y || 0;
            if (Math.hypot(jx, jy) > 0.55) {
                // Pick the target most aligned with the joystick direction
                let bestIdx = 0;
                let bestDot = -Infinity;
                nearHole.targets.forEach((t, idx) => {
                    const dx = t.x - nearHole.x;
                    const dy = t.y - nearHole.y;
                    const len = Math.hypot(dx, dy) || 1;
                    const dot = (dx / len) * jx + (dy / len) * jy;
                    if (dot > bestDot) {
                        bestDot = dot;
                        bestIdx = idx;
                    }
                });
                if (bestIdx !== this.selectedTargetIdx) {
                    this.selectedTargetIdx = bestIdx;
                    this.branchSwitchCooldown = time + 220;
                    this._playMusicalChime([659.25], 0.04, 'sine');
                }
            }
        }

        // Accumulate Hold Progress Ring (faster if fast_burrow perk or Cloud friend is rescued!)
        const holdRequiredMs = this.runPerks.fast_burrow ? HOLD_BURROW_MS * 0.58 : HOLD_BURROW_MS;
        this.holeHoldMs += dt * 1000;
        const progress = Math.min(1, this.holeHoldMs / holdRequiredMs);

        // Tuck Pi into the mouth of the burrow while holding (safe from monsters after 15% hold!)
        this.player.x = Phaser.Math.Linear(this.player.x, nearHole.x, 0.25);
        this.player.y = Phaser.Math.Linear(this.player.y, nearHole.y, 0.25);
        this.player.setScale(0.29 * (1 - progress * 0.35));

        const targetHole = nearHole.targets[this.selectedTargetIdx % nearHole.targets.length];

        // 1. Draw the Glowing Progress Ring around the Burrow Mouth
        this.burrowHoldRingGfx.clear();
        this.burrowHoldRingGfx.lineStyle(6, 0x0f172a, 0.85);
        this.burrowHoldRingGfx.strokeCircle(nearHole.x, nearHole.y, 32);

        this.burrowHoldRingGfx.lineStyle(5, 0xfef08a, 1);
        this.burrowHoldRingGfx.beginPath();
        this.burrowHoldRingGfx.arc(
            nearHole.x,
            nearHole.y,
            32,
            -Math.PI / 2,
            -Math.PI / 2 + Math.PI * 2 * progress
        );
        this.burrowHoldRingGfx.strokePath();

        // 2. Draw the Glowing Underground Path & Target Highlight
        this.burrowPreviewGfx.clear();
        if (targetHole) {
            this.burrowPreviewGfx.lineStyle(4, nearHole.colorHex, 0.88);
            const steps = 14;
            for (let i = 0; i < steps; i += 2) {
                const t1 = i / steps;
                const t2 = (i + 1) / steps;
                this.burrowPreviewGfx.lineBetween(
                    Phaser.Math.Linear(nearHole.x, targetHole.x, t1),
                    Phaser.Math.Linear(nearHole.y, targetHole.y, t1),
                    Phaser.Math.Linear(nearHole.x, targetHole.x, t2),
                    Phaser.Math.Linear(nearHole.y, targetHole.y, t2)
                );
            }
            this.burrowPreviewGfx.fillStyle(nearHole.colorHex, 0.32);
            this.burrowPreviewGfx.fillCircle(targetHole.x, targetHole.y, 28 + Math.sin(time * 0.015) * 4);
            this.burrowPreviewGfx.lineStyle(3.5, 0xfef08a, 1);
            this.burrowPreviewGfx.strokeCircle(targetHole.x, targetHole.y, 28);

            this.burrowTargetLabel
                .setPosition(targetHole.x, targetHole.y - 36)
                .setText(`🎯 ВЫХОД: ${targetHole.hint}`)
                .setVisible(true);
        }

        // 3. Complete Hold -> Squeeze through the Burrow!
        if (progress >= 1 && targetHole) {
            this._enterBurrowAndTravel(nearHole, targetHole);
        }
    }

    _enterBurrowAndTravel(fromHole, toHole) {
        this.holeHoldMs = 0;
        this.holeHoldArmed = false;
        this.burrowHoldRingGfx.clear();
        this.burrowPreviewGfx.clear();
        this.burrowTargetLabel.setVisible(false);

        this.state = 'squeeze';
        bus.emit(SFX.DASH);
        this._playMusicalChime([523.25, 659.25, 783.99, 1046.5], 0.05, 'sine');

        // Any monster chasing Pi loses track immediately!
        this.monsters.forEach((m) => {
            if (m.state === 'chase' || m.state === 'alert') {
                m.state = 'confused';
                m.confusedUntil = this.time.now + 2800;
                m.suspicion = 0;
                this._setMonsterBadge(m, 'badge_sleep');
            }
        });

        // Underground carpet-bulge ripple particle trail from `fromHole` to `toHole`
        const ripple = this.add.circle(fromHole.x, fromHole.y, 16, fromHole.colorHex, 0.65)
            .setStrokeStyle(3, 0xfef08a, 0.95)
            .setDepth(27);

        this.tweens.add({
            targets: [this.player, ripple],
            x: toHole.x,
            y: toHole.y,
            duration: SQUEEZE_TRAVEL_MS,
            ease: 'Cubic.easeInOut',
            onUpdate: () => {
                this.playerHalo.setPosition(this.player.x, this.player.y + 10);
            },
            onComplete: () => {
                ripple.destroy();
                this.player.setScale(0.29).setAlpha(1);
                this.state = 'play';
                this.invulnerableUntil = Math.max(this.invulnerableUntil, this.time.now + 750);

                if (this.runPerks.fast_burrow) {
                    this.turboUntil = Math.max(this.turboUntil, this.time.now + 3000);
                }

                // Pop-out sparkle ring
                const popRing = this.add.circle(toHole.x, toHole.y, 10, 0xfef08a, 0.45).setDepth(27);
                this.tweens.add({
                    targets: popRing,
                    radius: 38,
                    alpha: 0,
                    duration: 320,
                    onComplete: () => popRing.destroy()
                });
            }
        });
    }

    // =========================================================================
    // 7. GLOSSY 3D TOUCH CONTROLS & HUD (Snowball Fight Style)
    // =========================================================================

    _mountDomControlsAndHud() {
        this._unmountDomControls();

        const ui = document.createElement('div');
        ui.id = 'sneak-touch-ui';
        ui.innerHTML = `
            <style>
                #sneak-touch-ui {
                    position: fixed;
                    inset: 0;
                    pointer-events: none;
                    z-index: 9999;
                    font-family: 'Nunito', sans-serif;
                    user-select: none;
                    -webkit-user-select: none;
                }
                .sneak-top-bar {
                    position: absolute;
                    top: max(8px, env(safe-area-inset-top, 8px));
                    left: max(12px, env(safe-area-inset-left, 12px));
                    right: max(12px, env(safe-area-inset-right, 12px));
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 8px;
                    pointer-events: none;
                }
                .sneak-pill {
                    pointer-events: auto;
                    background: rgba(15, 10, 30, 0.88);
                    border: 2px solid rgba(250, 204, 21, 0.55);
                    border-radius: 999px;
                    padding: 5px 14px;
                    color: #fff;
                    font-weight: 900;
                    font-size: clamp(12px, 2.6vw, 15px);
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    box-shadow: 0 6px 16px rgba(0,0,0,0.5);
                }
                .sneak-icon-btn {
                    pointer-events: auto;
                    width: 42px;
                    height: 42px;
                    border-radius: 50%;
                    border: 2px solid rgba(255,255,255,0.45);
                    background: linear-gradient(180deg, #475569, #1e293b);
                    color: #fff;
                    font-size: 18px;
                    font-weight: 900;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 4px 10px rgba(0,0,0,0.45);
                    cursor: pointer;
                }
                #sneak-joy-zone {
                    position: absolute;
                    left: max(18px, env(safe-area-inset-left, 18px));
                    bottom: max(16px, env(safe-area-inset-bottom, 16px));
                    width: 132px;
                    height: 132px;
                    border-radius: 50%;
                    background: radial-gradient(circle, rgba(168,85,247,0.24) 0%, rgba(15,23,42,0.72) 78%);
                    border: 2.5px solid rgba(216,180,254,0.55);
                    box-shadow: 0 6px 20px rgba(0,0,0,0.5);
                    pointer-events: auto;
                    touch-action: none;
                }
                #sneak-joy-knob {
                    position: absolute;
                    left: 50%;
                    top: 50%;
                    width: 54px;
                    height: 54px;
                    margin-left: -27px;
                    margin-top: -27px;
                    border-radius: 50%;
                    background: radial-gradient(circle at 32% 30%, #f5d0fe, #a855f7 62%, #6b21a8 100%);
                    border: 2.5px solid #fff;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                    pointer-events: none;
                }
                .sneak-right-cluster {
                    position: absolute;
                    right: max(16px, env(safe-area-inset-right, 16px));
                    bottom: max(14px, env(safe-area-inset-bottom, 14px));
                    display: flex;
                    align-items: flex-end;
                    gap: 10px;
                    pointer-events: none;
                }
                .sneak-gloss-btn {
                    pointer-events: auto;
                    touch-action: none;
                    position: relative;
                    border-radius: 50%;
                    border: 3px solid rgba(255,255,255,0.88);
                    color: #fff;
                    font-family: 'Nunito', sans-serif;
                    font-weight: 900;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 7px 18px rgba(0,0,0,0.55), inset 0 3px 6px rgba(255,255,255,0.45);
                    cursor: pointer;
                    transition: transform 0.08s ease;
                }
                .sneak-gloss-btn:active, .sneak-gloss-btn.holding {
                    transform: scale(0.92);
                }
                #sneak-btn-whistle {
                    width: 64px;
                    height: 64px;
                    background: radial-gradient(circle at 30% 25%, #fde047, #eab308 65%, #a16207 100%);
                }
                #sneak-btn-pie {
                    width: 72px;
                    height: 72px;
                    background: radial-gradient(circle at 30% 25%, #f9a8d4, #ec4899 65%, #9d174d 100%);
                }
                #sneak-btn-dash {
                    width: 76px;
                    height: 76px;
                    background: radial-gradient(circle at 30% 25%, #7dd3fc, #0284c7 65%, #075985 100%);
                }
                #sneak-btn-hole {
                    width: 96px;
                    height: 96px;
                    background: radial-gradient(circle at 30% 25%, #fde047, #d97706 62%, #78350f 100%);
                    border-color: #fef08a;
                    box-shadow: 0 0 26px rgba(250, 204, 21, 0.85), inset 0 3px 8px rgba(255,255,255,0.6);
                    display: none;
                }
                .sneak-badge-count {
                    position: absolute;
                    top: -4px;
                    right: -4px;
                    width: 24px;
                    height: 24px;
                    border-radius: 50%;
                    background: #0f172a;
                    border: 2px solid #facc15;
                    color: #fef08a;
                    font-size: 12px;
                    font-weight: 900;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                #sneak-toast-banner {
                    position: absolute;
                    top: 56px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: rgba(15, 23, 42, 0.94);
                    border: 2px solid #facc15;
                    border-radius: 999px;
                    padding: 6px 16px;
                    color: #fef08a;
                    font-weight: 900;
                    font-size: clamp(12px, 2.7vw, 15px);
                    box-shadow: 0 6px 18px rgba(0,0,0,0.5);
                    opacity: 0;
                    transition: opacity 0.22s ease;
                    pointer-events: none;
                    white-space: nowrap;
                }
                #sneak-modal-root {
                    position: fixed;
                    inset: 0;
                    background: rgba(8, 5, 20, 0.84);
                    backdrop-filter: blur(6px);
                    display: none;
                    align-items: center;
                    justify-content: center;
                    padding: 16px;
                    pointer-events: auto;
                    z-index: 10001;
                }
                #sneak-modal-root.visible {
                    display: flex;
                }
                .sneak-modal-card {
                    background: linear-gradient(180deg, #1e1b4b, #0f172a);
                    border: 3px solid #facc15;
                    border-radius: 24px;
                    padding: 18px 20px;
                    width: 100%;
                    max-width: 520px;
                    text-align: center;
                    color: #fff;
                    box-shadow: 0 16px 40px rgba(0,0,0,0.65);
                }
                .sneak-perk-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 10px;
                    margin: 14px 0;
                }
                .sneak-perk-card {
                    background: rgba(30, 41, 59, 0.92);
                    border: 2.5px solid #38bdf8;
                    border-radius: 16px;
                    padding: 10px 8px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 5px;
                    cursor: pointer;
                }
                .sneak-action-btn {
                    width: 100%;
                    padding: 11px 16px;
                    border-radius: 14px;
                    border: none;
                    color: #fff;
                    font-family: 'Nunito', sans-serif;
                    font-weight: 900;
                    font-size: 15px;
                    cursor: pointer;
                }
            </style>

            <div class="sneak-top-bar">
                <div style="display:flex;align-items:center;gap:6px;">
                    <button class="sneak-icon-btn" id="sneak-pause-btn" title="Пауза">⏸</button>
                    <div class="sneak-pill">
                        <span>🏰 Этаж ${this.floor}</span>
                        <span id="sneak-hud-hearts">❤️❤️❤️</span>
                    </div>
                </div>

                <div class="sneak-pill" id="sneak-hud-goal" style="border-color:#fde047;color:#fef08a;">
                    1️⃣ Нырни в норку на Балкон за Ключом!
                </div>

                <div class="sneak-pill">
                    <span id="sneak-hud-cheese" style="color:#facc15;">🧀 ${this.carriedCheese}</span>
                </div>
            </div>

            <div id="sneak-toast-banner"></div>

            <div id="sneak-joy-zone">
                <div id="sneak-joy-knob"></div>
            </div>

            <div class="sneak-right-cluster">
                <button class="sneak-gloss-btn" id="sneak-btn-whistle" title="Свистнуть и отвлечь стража">
                    <span style="font-size:21px;line-height:1;">📣</span>
                    <span style="font-size:9.5px;">СВИСТ</span>
                </button>
                <button class="sneak-gloss-btn" id="sneak-btn-pie" title="Бросить пирог">
                    <span style="font-size:23px;line-height:1;">🥧</span>
                    <span style="font-size:9.5px;">ПИРОГ</span>
                    <div class="sneak-badge-count" id="sneak-pie-count">${this.piesLeft}</div>
                </button>
                <button class="sneak-gloss-btn" id="sneak-btn-dash" title="Тихий кувырок">
                    <span style="font-size:23px;line-height:1;">💨</span>
                    <span style="font-size:9.5px;">КУВЫРОК</span>
                </button>
                <button class="sneak-gloss-btn" id="sneak-btn-hole" title="Удерживай, чтобы залезть в норку!">
                    <span style="font-size:28px;line-height:1;">🕳️</span>
                    <span style="font-size:11px;" id="sneak-hole-btn-text">ДЕРЖИ: НОРА</span>
                </button>
            </div>

            <div id="sneak-modal-root"></div>
        `;

        document.body.appendChild(ui);
        this.touchUiEl = ui;
        this.joyVec = { x: 0, y: 0 };

        // Virtual Joystick
        const joyZone = document.getElementById('sneak-joy-zone');
        const joyKnob = document.getElementById('sneak-joy-knob');
        let joyPointerId = null;
        const maxR = 42;

        const updateJoy = (clientX, clientY) => {
            const rect = joyZone.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            let dx = clientX - cx;
            let dy = clientY - cy;
            const dist = Math.hypot(dx, dy);
            if (dist > maxR) {
                dx = (dx / dist) * maxR;
                dy = (dy / dist) * maxR;
            }
            joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
            this.joyVec.x = dx / maxR;
            this.joyVec.y = dy / maxR;
        };

        const resetJoy = () => {
            joyPointerId = null;
            joyKnob.style.transform = 'translate(0px, 0px)';
            this.joyVec.x = 0;
            this.joyVec.y = 0;
        };

        joyZone.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            joyPointerId = e.pointerId;
            joyZone.setPointerCapture?.(e.pointerId);
            updateJoy(e.clientX, e.clientY);
        });
        joyZone.addEventListener('pointermove', (e) => {
            if (e.pointerId !== joyPointerId) return;
            updateJoy(e.clientX, e.clientY);
        });
        joyZone.addEventListener('pointerup', (e) => {
            if (e.pointerId === joyPointerId) resetJoy();
        });
        joyZone.addEventListener('pointercancel', resetJoy);

        // Hold-to-Burrow Button («ДЕРЖИ: НОРА»)
        const holeBtn = document.getElementById('sneak-btn-hole');
        if (holeBtn) {
            holeBtn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                holeBtn.setPointerCapture?.(e.pointerId);
                this.holeHoldDown = true;
                holeBtn.classList.add('holding');
            });
            const releaseHole = () => {
                this.holeHoldDown = false;
                holeBtn.classList.remove('holding');
            };
            holeBtn.addEventListener('pointerup', releaseHole);
            holeBtn.addEventListener('pointercancel', releaseHole);
            holeBtn.addEventListener('lostpointercapture', releaseHole);
        }

        // Other Action Buttons
        document.getElementById('sneak-pause-btn')?.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            this.togglePauseModal();
        });
        document.getElementById('sneak-btn-whistle')?.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            this._triggerWhistle();
        });
        document.getElementById('sneak-btn-pie')?.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            this._throwPie();
        });
        document.getElementById('sneak-btn-dash')?.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            this._triggerDash();
        });

        this._refreshHud();
    }

    _updateBurrowDomButton(nearHole, isHolding) {
        const holeBtn = document.getElementById('sneak-btn-hole');
        const labelEl = document.getElementById('sneak-hole-btn-text');
        if (!holeBtn || !labelEl) return;

        if (!nearHole) {
            holeBtn.style.display = 'none';
            this.holeHoldDown = false;
            return;
        }
        holeBtn.style.display = 'flex';
        labelEl.textContent = isHolding ? 'ЗАЛЕЗАЕМ...' : `ДЕРЖИ: НОРА #${nearHole.pairNum}`;
    }

    _unmountDomControls() {
        const existing = document.getElementById('sneak-touch-ui');
        if (existing) existing.remove();
        this.touchUiEl = null;
    }

    _refreshHud() {
        const heartsEl = document.getElementById('sneak-hud-hearts');
        if (heartsEl) {
            heartsEl.textContent = '❤️'.repeat(Math.max(0, this.hearts)) + '🖤'.repeat(Math.max(0, this.maxHearts - this.hearts));
        }
        const cheeseEl = document.getElementById('sneak-hud-cheese');
        if (cheeseEl) {
            cheeseEl.textContent = `🧀 ${this.carriedCheese}`;
        }
        const pieEl = document.getElementById('sneak-pie-count');
        if (pieEl) {
            pieEl.textContent = `${this.piesLeft}`;
        }
        const goalEl = document.getElementById('sneak-hud-goal');
        if (goalEl) {
            if (!this.hasKey) {
                goalEl.textContent = '1️⃣ Нырни в норку #2 на Балкон за Ключом!';
                goalEl.style.borderColor = '#fde047';
                goalEl.style.color = '#fef08a';
            } else if (!this.friendRescued) {
                goalEl.textContent = '2️⃣ Ключ есть! Нырни в норку #1 за решётку к Другу!';
                goalEl.style.borderColor = '#34d399';
                goalEl.style.color = '#a7f3d0';
            } else {
                goalEl.textContent = '3️⃣ Выход открыт! Беги к Лестнице на след. этаж!';
                goalEl.style.borderColor = '#4ade80';
                goalEl.style.color = '#86efac';
            }
        }
    }

    _showToast(msg, borderColor = '#facc15') {
        const el = document.getElementById('sneak-toast-banner');
        if (!el) return;
        el.textContent = msg;
        el.style.borderColor = borderColor;
        el.style.opacity = '1';
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            if (el) el.style.opacity = '0';
        }, 3000);
    }

    _setupKeyboard() {
        this.keys = this.input.keyboard?.addKeys({
            up: Phaser.Input.Keyboard.KeyCodes.W,
            down: Phaser.Input.Keyboard.KeyCodes.S,
            left: Phaser.Input.Keyboard.KeyCodes.A,
            right: Phaser.Input.Keyboard.KeyCodes.D,
            upArr: Phaser.Input.Keyboard.KeyCodes.UP,
            downArr: Phaser.Input.Keyboard.KeyCodes.DOWN,
            leftArr: Phaser.Input.Keyboard.KeyCodes.LEFT,
            rightArr: Phaser.Input.Keyboard.KeyCodes.RIGHT,
            space: Phaser.Input.Keyboard.KeyCodes.SPACE,
            e: Phaser.Input.Keyboard.KeyCodes.E,
            q: Phaser.Input.Keyboard.KeyCodes.Q
        });

        this.input.keyboard?.on('keydown-E', () => this._throwPie());
        this.input.keyboard?.on('keydown-Q', () => this._triggerWhistle());
    }

    // =========================================================================
    // 8. WHISTLE, PIE THROW & DASH
    // =========================================================================

    _triggerWhistle() {
        if (this.ended || this.isPaused || this.state !== 'play') return;
        const now = this.time.now;
        if (now < this.whistleCooldownUntil) return;
        this.whistleCooldownUntil = now + 2600;

        this._playMusicalChime([987.77, 1318.5, 1174.66], 0.06, 'sine');

        const ring = this.add.circle(this.player.x, this.player.y, 12, 0xfacc15, 0.25)
            .setStrokeStyle(3, 0xfef08a, 0.95)
            .setDepth(35);
        this.tweens.add({
            targets: ring,
            radius: 175,
            alpha: 0,
            duration: 620,
            onComplete: () => ring.destroy()
        });

        this.monsters.forEach((m) => {
            if (m.state === 'blind') return;
            if (Math.hypot(m.x - this.player.x, m.y - this.player.y) <= 320) {
                m.state = 'alert';
                m.investigateTarget = { x: this.player.x, y: this.player.y };
                m.investigateUntil = now + WHISTLE_DISTRACT_MS;
                this._setMonsterBadge(m, 'badge_ear');
            }
        });

        this._showToast('📣 Свист приманил стражей! Самое время нырнуть в норку!', '#facc15');
    }

    _throwPie() {
        if (this.ended || this.isPaused || this.state !== 'play') return;
        if (this.piesLeft <= 0) {
            this._showToast('🥧 Пироги закончились!', '#fda4af');
            return;
        }
        this.piesLeft--;
        this._refreshHud();
        bus.emit(SFX.PIE_THROW);

        const len = Math.hypot(this.playerFacing.x, this.playerFacing.y) || 1;
        const dx = this.playerFacing.x / len;
        const dy = this.playerFacing.y / len;

        const spr = this.add.image(this.player.x, this.player.y, 'd_pie')
            .setDisplaySize(30, 30)
            .setDepth(33);

        this.thrownPies.push({
            sprite: spr,
            x: this.player.x,
            y: this.player.y,
            vx: dx * PIE_SPEED,
            vy: dy * PIE_SPEED,
            bornAt: this.time.now
        });
    }

    _splatPieAt(wx, wy) {
        bus.emit(SFX.PIE_HIT);
        const splat = this.add.circle(wx, wy, 10, 0xf472b6, 0.55)
            .setStrokeStyle(3, 0xffffff, 0.95)
            .setDepth(24);
        this.tweens.add({
            targets: splat,
            radius: PIE_BLIND_RADIUS,
            alpha: 0,
            duration: 550,
            onComplete: () => splat.destroy()
        });

        const now = this.time.now;
        this.monsters.forEach((m) => {
            const d = Math.hypot(m.x - wx, m.y - wy);
            if (d <= PIE_BLIND_RADIUS) {
                m.state = 'blind';
                m.blindUntil = now + PIE_BLIND_MS;
                this._setMonsterBadge(m, 'badge_sleep');
            } else if (d <= PIE_HEAR_RADIUS && m.state !== 'blind') {
                m.state = 'alert';
                m.investigateTarget = { x: wx, y: wy };
                m.investigateUntil = now + PIE_DISTRACT_MS;
                this._setMonsterBadge(m, 'badge_ear');
            }
        });
    }

    _triggerDash() {
        if (this.ended || this.isPaused || this.state !== 'play') return;
        const now = this.time.now;
        if (now < this.dashCooldownUntil) return;

        this.dashUntil = now + PLAYER_DASH_MS;
        this.dashCooldownUntil = now + PLAYER_DASH_CD_MS * this.skinDashCdMul;
        bus.emit(SFX.DASH);

        this.tweens.add({
            targets: this.player,
            angle: 360,
            duration: PLAYER_DASH_MS,
            onComplete: () => this.player.setAngle(0)
        });
    }

    // =========================================================================
    // 9. MAIN UPDATE LOOP
    // =========================================================================

    update(time, delta) {
        if (this.ended || this.isPaused) return;
        const dt = Math.min(0.05, delta / 1000);

        this._updateBurrowHoldMechanic(time, dt);
        if (this.state === 'play' && this.holeHoldMs === 0) {
            this._updatePlayerMovement(time, dt);
        }
        this._updateObjectivesAndPickups(time, dt);
        this._updateThrownPies(time, dt);
        this._updateMonsters(time, dt);
    }

    _updatePlayerMovement(time, dt) {
        let ix = this.joyVec?.x || 0;
        let iy = this.joyVec?.y || 0;

        if (this.keys) {
            if (this.keys.left.isDown || this.keys.leftArr.isDown) ix -= 1;
            if (this.keys.right.isDown || this.keys.rightArr.isDown) ix += 1;
            if (this.keys.up.isDown || this.keys.upArr.isDown) iy -= 1;
            if (this.keys.down.isDown || this.keys.downArr.isDown) iy += 1;
        }

        const mag = Math.hypot(ix, iy);
        if (mag > 0.06) {
            const nx = ix / Math.max(1, mag);
            const ny = iy / Math.max(1, mag);
            this.playerFacing.x = nx;
            this.playerFacing.y = ny;

            let spd = PLAYER_BASE_SPEED * this.skinSpeedMul;
            if (time < this.dashUntil) spd = PLAYER_DASH_SPEED;
            if (time < this.turboUntil) spd *= 1.32;
            if (this.runPerks.ninja_paws) spd *= 1.18;

            const nextX = this.player.x + nx * spd * dt;
            const nextY = this.player.y + ny * spd * dt;
            const r = 14;

            if (this._canWalkAt(nextX, this.player.y, r)) this.player.x = nextX;
            if (this._canWalkAt(this.player.x, nextY, r)) this.player.y = nextY;

            if (Math.abs(nx) > 0.08) {
                this.player.setFlipX(nx < 0);
            }

            this.walkAnimTimer += dt * 11;
            const frame = Math.floor(this.walkAnimTimer) % 2;
            this.player.setTexture(frame === 0 ? this.playerWalk1 : this.playerWalk2);

            // Record breadcrumb trail for rescued follower train
            const head = this.playerTrail[0];
            if (!head || Math.hypot(this.player.x - head.x, this.player.y - head.y) > 8) {
                this.playerTrail.unshift({ x: this.player.x, y: this.player.y });
                if (this.playerTrail.length > 90) this.playerTrail.pop();
            }
        } else {
            this.player.setTexture(this.playerSkinBase);
        }

        this.playerHalo.setPosition(this.player.x, this.player.y + 10);

        // Update Follower Train positions
        this.followerSprites.forEach((spr, idx) => {
            const trailIdx = Math.min(this.playerTrail.length - 1, (idx + 1) * 5);
            const pt = this.playerTrail[trailIdx] || { x: this.player.x, y: this.player.y };
            spr.x = Phaser.Math.Linear(spr.x, pt.x, 0.25);
            spr.y = Phaser.Math.Linear(spr.y, pt.y, 0.25);
        });
    }

    _updateObjectivesAndPickups(time, dt) {
        const px = this.player.x;
        const py = this.player.y;
        const magnetR = this.runPerks.cheese_magnet ? 125 : 30;

        // 1. Cheese Wedges
        this.cheeseObjs.forEach((ch) => {
            if (ch.collected) return;
            const d = Math.hypot(px - ch.x, py - ch.y);
            if (d < magnetR && d > 22) {
                ch.x += ((px - ch.x) / d) * 260 * dt;
                ch.y += ((py - ch.y) / d) * 260 * dt;
                ch.sprite.setPosition(ch.x, ch.y);
            }
            if (d <= 26) {
                ch.collected = true;
                ch.sprite.destroy();
                const gain = Math.round(ch.value * (this.runPerks.cheese_magnet ? 1.3 : 1));
                this.carriedCheese += gain;
                this._refreshHud();
                bus.emit(SFX.CHEESE);
            }
        });

        // 2. Treasure Chests (`w_chest_closed` -> `w_chest_open`)
        this.chestObjs.forEach((ch) => {
            if (ch.opened) return;
            if (Math.hypot(px - ch.x, py - ch.y) <= 36) {
                ch.opened = true;
                ch.sprite.setTexture('w_chest_open');
                this.carriedCheese += ch.cheeseValue;
                this._refreshHud();
                bus.emit(SFX.CHEST_OPEN);
                this._playMusicalChime([523.25, 659.25, 783.99, 1046.5], 0.06, 'triangle');
                this._showToast(`👑 Сундук открыт! +${ch.cheeseValue} 🧀`, '#facc15');
            }
        });

        // 3. Golden Key on the Elevated Balcony
        if (this.keyObj && !this.keyObj.collected) {
            if (Math.hypot(px - this.keyObj.x, py - this.keyObj.y) <= 34) {
                this.keyObj.collected = true;
                this.keyObj.container.destroy();
                this.hasKey = true;
                this._refreshHud();
                bus.emit(SFX.KEY_PICKUP);
                this._playMusicalChime([659.25, 783.99, 1046.5, 1318.5], 0.06, 'triangle');
                this._showToast('🗝️ Ключ с высокого балкона взят! Теперь ныряй в норку #1 в Сокровищницу!', '#34d399');
            }
        }

        // 4. Captive Pet Friend inside the Iron-Barred Vault
        this.petObjs.forEach((pet) => {
            if (pet.rescued) return;
            if (Math.hypot(px - pet.x, py - pet.y) <= 38) {
                if (pet.requiresKey && !this.hasKey) {
                    this._showToast('🔒 Клетка заперта! Сначала нырни в норку #2 на Балкон за Ключом!', '#fde047');
                    return;
                }
                pet.rescued = true;
                pet.cageSpr.destroy();
                pet.lockSpr.destroy();
                this.friendRescued = true;
                this.totalRescuedInRun++;
                this.rescuedFollowers.push(pet.spriteKey);
                this.carriedCheese += 25;

                // Spawn follower sprite behind Pi
                const fSpr = this.add.image(pet.x, pet.y, pet.spriteKey).setScale(0.21).setDepth(29);
                this.followerSprites.push(fSpr);
                pet.container.destroy();

                this._unlockExitStairs();
                this._refreshHud();
                bus.emit(SFX.RELIC_PICKUP);
                this._playMusicalChime([523.25, 659.25, 783.99, 1046.5, 1318.5], 0.07, 'triangle');
                this._showToast(`🐾 ${pet.name} спасена (+25🧀)! Лестница на Этаж ${this.floor + 1} открыта!`, '#4ade80');
            }
        });

        // 5. Exit Stairs -> Next Infinite Floor!
        if (this.exitUnlocked && Math.hypot(px - this.room.exit.x, py - this.room.exit.y) <= 36) {
            this.onFloorCleared();
        }
    }

    _updateThrownPies(time, dt) {
        for (let i = this.thrownPies.length - 1; i >= 0; i--) {
            const p = this.thrownPies[i];
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.sprite.setPosition(p.x, p.y);
            p.sprite.rotation += 10 * dt;

            let hit = false;
            for (const m of this.monsters) {
                if (Math.hypot(m.x - p.x, m.y - p.y) <= 28) {
                    hit = true;
                    break;
                }
            }
            if (hit || !this._isWalkableCellAtWorld(p.x, p.y) || time - p.bornAt > 1100) {
                p.sprite.destroy();
                this.thrownPies.splice(i, 1);
                this._splatPieAt(p.x, p.y);
            }
        }
    }

    // =========================================================================
    // 10. MONSTER AI & VISION CONES
    // =========================================================================

    _updateMonsters(time, dt) {
        // Player is hidden if squeezing through a burrow, holding inside a burrow mouth (>15%), or standing on a Moonflower shadow!
        const holdingInBurrow = this.holeHoldMs > 85;
        const inShadow = this._isInsideShadow(this.player.x, this.player.y);
        const playerHidden = (this.state === 'squeeze') || holdingInBurrow || inShadow;

        this.monsters.forEach((m) => {
            if (m.state === 'blind') {
                if (time >= m.blindUntil) {
                    m.state = 'patrol';
                    this._setMonsterBadge(m, null);
                } else {
                    m.coneGfx.clear();
                    return;
                }
            }

            if (m.state === 'confused') {
                if (time >= m.confusedUntil) {
                    m.state = 'patrol';
                    this._setMonsterBadge(m, null);
                } else {
                    m.coneGfx.clear();
                    return;
                }
            }

            const dx = this.player.x - m.x;
            const dy = this.player.y - m.y;
            const dist = Math.hypot(dx, dy);
            let seesPlayer = false;

            if (!playerHidden && dist <= m.cfg.coneLen) {
                const angleToPlayer = Math.atan2(dy, dx);
                const diff = Math.abs(Phaser.Math.Angle.Wrap(angleToPlayer - m.facingRad));
                if (diff <= m.cfg.coneHalfRad && this._hasLineOfSight(m.x, m.y, this.player.x, this.player.y)) {
                    seesPlayer = true;
                }
            }

            if (seesPlayer) {
                m.suspicion = Math.min(1, m.suspicion + (dt * 1000) / SUSPICION_FILL_MS);
                if (m.suspicion >= 1) {
                    if (m.state !== 'chase') {
                        m.state = 'chase';
                        this.seenOnThisFloor = true;
                        this.everSeenInRun = true;
                        this._setMonsterBadge(m, 'badge_anger');
                    }
                    m.investigateTarget = { x: this.player.x, y: this.player.y };
                    m.investigateUntil = time + 2600;
                } else {
                    this._setMonsterBadge(m, 'badge_alert');
                }
            } else {
                m.suspicion = Math.max(0, m.suspicion - (dt * 1000) / SUSPICION_DECAY_MS);
                if ((m.state === 'chase' || m.state === 'alert') && time > m.investigateUntil) {
                    m.state = 'patrol';
                    this._setMonsterBadge(m, null);
                }
            }

            let targetX = m.x;
            let targetY = m.y;
            let spd = m.cfg.speed;

            if (m.state === 'chase' && !playerHidden) {
                targetX = this.player.x;
                targetY = this.player.y;
                spd = m.cfg.chaseSpeed;
            } else if ((m.state === 'alert' || m.state === 'chase') && m.investigateTarget) {
                targetX = m.investigateTarget.x;
                targetY = m.investigateTarget.y;
                spd = m.cfg.speed * 1.15;
            } else {
                const wp = m.cfg.waypoints[m.wpIndex] || m.cfg.waypoints[0];
                targetX = wp.x;
                targetY = wp.y;
                if (Math.hypot(targetX - m.x, targetY - m.y) < 12) {
                    m.wpIndex = (m.wpIndex + 1) % m.cfg.waypoints.length;
                }
            }

            const tdx = targetX - m.x;
            const tdy = targetY - m.y;
            const tDist = Math.hypot(tdx, tdy);
            if (tDist > 2) {
                const ux = tdx / tDist;
                const uy = tdy / tDist;
                m.facingRad = Phaser.Math.Angle.RotateTo(m.facingRad, Math.atan2(uy, ux), 4.5 * dt);

                const nx = m.x + ux * spd * dt;
                const ny = m.y + uy * spd * dt;
                if (this._isMonsterWalkable(nx, m.y)) m.x = nx;
                if (this._isMonsterWalkable(m.x, ny)) m.y = ny;

                if (Math.abs(ux) > 0.08) {
                    m.sprite.setFlipX(ux < 0);
                }
            }

            m.sprite.setPosition(m.x, m.y);
            m.shadow.setPosition(m.x, m.y + 18);
            m.badgeSpr.setPosition(m.x, m.y - 42);
            this._drawMonsterCone(m);

            if (!playerHidden && time >= this.invulnerableUntil) {
                if (Math.hypot(this.player.x - m.x, this.player.y - m.y) <= CATCH_DIST) {
                    this._onPlayerCaught(m);
                }
            }
        });
    }

    _drawMonsterCone(m) {
        const g = m.coneGfx;
        g.clear();
        const color = m.state === 'chase' ? 0xf43f5e : (m.suspicion > 0.15 ? 0xfacc15 : 0x38bdf8);
        const alpha = m.state === 'chase' ? 0.30 : 0.16;

        g.fillStyle(color, alpha);
        g.beginPath();
        g.moveTo(m.x, m.y);
        const steps = 10;
        const startA = m.facingRad - m.cfg.coneHalfRad;
        const endA = m.facingRad + m.cfg.coneHalfRad;
        for (let i = 0; i <= steps; i++) {
            const a = startA + (endA - startA) * (i / steps);
            g.lineTo(m.x + Math.cos(a) * m.cfg.coneLen, m.y + Math.sin(a) * m.cfg.coneLen);
        }
        g.closePath();
        g.fillPath();
    }

    _hasLineOfSight(x1, y1, x2, y2) {
        const steps = 10;
        for (let i = 1; i < steps; i++) {
            const t = i / steps;
            const sx = x1 + (x2 - x1) * t;
            const sy = y1 + (y2 - y1) * t;
            const gx = Math.floor(sx / this.room.cell);
            const gy = Math.floor(sy / this.room.cell);
            if (this.room.grid[gy]?.[gx] === '#') return false;
        }
        return true;
    }

    _onPlayerCaught(monster) {
        if (this.ended) return;
        bus.emit(SFX.CAUGHT);
        this.cameras.main.shake(220, 0.012);

        this.hearts = Math.max(0, this.hearts - 1);
        this._refreshHud();

        if (this.hearts > 0) {
            this.invulnerableUntil = this.time.now + 2400;
            const sx = this.room.spawn.x;
            const sy = this.room.spawn.y;
            this.player.setPosition(sx, sy);
            this.playerHalo.setPosition(sx, sy + 10);
            this._showToast(`💨 Успела увернуться в норку! Осталось сердечек: ${this.hearts}`, '#fca5a5');
            return;
        }

        this.ended = true;
        const unbankedOnFloor = Math.max(0, this.carriedCheese - (this.bankedInRun || 0));
        const keptOnFloor = Math.floor(unbankedOnFloor * 0.8);
        const totalKeptInRun = (this.bankedInRun || 0) + keptOnFloor;
        this.bankedInRun = totalKeptInRun;
        Progress.recordSneakRun({
            cleared: false,
            neverSeen: false,
            cheese: keptOnFloor,
            floor: this.floor
        });
        this._showGameOverModal(monster, totalKeptInRun);
    }

    // =========================================================================
    // 11. INFINITE FLOOR CLEAR MODAL, PAUSE & GAME OVER
    // =========================================================================

    onFloorCleared() {
        if (this.ended) return;
        this.ended = true;

        const floorBonus = 15 + this.floor * 5;
        const stealthBonus = this.seenOnThisFloor ? 0 : 15;
        const earned = floorBonus + stealthBonus;
        this.carriedCheese += earned;
        this._refreshHud();

        const unbankedFloorCheese = Math.max(0, this.carriedCheese - (this.bankedInRun || 0));
        this.bankedInRun = this.carriedCheese;
        Progress.recordSneakRun({
            cleared: true,
            neverSeen: !this.seenOnThisFloor,
            cheese: unbankedFloorCheese,
            floor: this.floor
        });

        bus.emit(SFX.VICTORY);
        this._playMusicalChime([523.25, 659.25, 783.99, 1046.5, 1318.5], 0.09, 'triangle');

        const modalRoot = document.getElementById('sneak-modal-root');
        if (!modalRoot) return;

        const shuffled = [...RUN_PERKS].sort(() => Math.random() - 0.5).slice(0, 3);
        modalRoot.innerHTML = `
            <div class="sneak-modal-card">
                <div style="font-weight:900;font-size:min(5vw, 22px);color:#fef08a;">
                    🏰 ЭТАЖ ${this.floor} ПРОЙДЕН! +${earned} 🧀
                </div>
                <div style="font-weight:800;font-size:min(3.4vw, 14px);color:#e2e8f0;margin-top:4px;">
                    🎁 Выбери 1 Супер-Способность на Этаж ${this.floor + 1}:
                </div>
                <div class="sneak-perk-grid">
                    ${shuffled.map((p, idx) => `
                        <div class="sneak-perk-card" data-perk-idx="${idx}" style="border-color:${p.color}">
                            <div style="font-size:32px;line-height:1;">${p.icon}</div>
                            <div style="font-weight:900;font-size:13px;color:${p.color};">${p.title}</div>
                            <div style="font-weight:700;font-size:11px;color:#cbd5e1;line-height:1.25;">${p.desc}</div>
                            <div style="font-weight:900;font-size:11px;color:#fef08a;margin-top:auto;">✨ ВЫБРАТЬ</div>
                        </div>
                    `).join('')}
                </div>
                <button class="sneak-action-btn" id="sneak-bank-exit-btn" style="background:#334155;border:2px solid #94a3b8;">
                    🏰 Забрать ${this.carriedCheese} 🧀 и выйти в меню
                </button>
            </div>
        `;
        modalRoot.classList.add('visible');

        modalRoot.querySelectorAll('.sneak-perk-card').forEach((el) => {
            el.addEventListener('click', () => {
                const idx = parseInt(el.getAttribute('data-perk-idx'), 10);
                bus.emit(SFX.CLICK);
                this._applyChosenPerkAndAdvance(shuffled[idx]);
            });
        });

        document.getElementById('sneak-bank-exit-btn')?.addEventListener('click', () => {
            bus.emit(SFX.CLICK);
            this._exitToCastleMenu();
        });
    }

    _applyChosenPerkAndAdvance(perk) {
        const nextPerks = { ...this.runPerks, [perk.id]: (this.runPerks[perk.id] || 0) + 1 };
        let nextHearts = this.hearts;
        let nextCheese = this.carriedCheese;
        let nextBanked = this.bankedInRun || 0;
        let nextPies = this.piesLeft;

        if (perk.id === 'extra_heart') {
            nextHearts = this.maxHearts;
            nextCheese += 20;
            nextBanked += 20;
            Progress.addCheese?.(20);
        } else if (perk.id === 'cake_factory') {
            nextPies = Math.min(9, nextPies + 2);
        }

        this.scene.restart({
            floor: this.floor + 1,
            carriedCheese: nextCheese,
            bankedInRun: nextBanked,
            totalRescuedInRun: this.totalRescuedInRun,
            rescuedFollowers: this.rescuedFollowers,
            streak: Math.min(3.0, +(this.streak + 0.2).toFixed(2)),
            hearts: nextHearts,
            maxHearts: this.maxHearts,
            piesLeft: nextPies,
            runPerks: nextPerks,
            everSeenInRun: this.everSeenInRun
        });
    }

    _showGameOverModal(monster, keptCheese) {
        const modalRoot = document.getElementById('sneak-modal-root');
        if (!modalRoot) return;

        modalRoot.innerHTML = `
            <div class="sneak-modal-card" style="border-color:#f43f5e;max-width:440px;">
                <div style="font-weight:900;font-size:min(5vw, 21px);color:#fda4af;">
                    🐾 ${monster.cfg.name} поймал Пи!
                </div>
                <div style="font-weight:800;font-size:14.5px;color:#f8fafc;margin:14px 0;line-height:1.5;">
                    Достигнут этаж: <b>${this.floor}</b><br>
                    Спасено друзей: <b>${this.totalRescuedInRun} 🐾</b><br>
                    Сохранено в копилку: <b style="color:#facc15;">+${keptCheese} 🧀</b>
                </div>
                <div style="display:flex;flex-direction:column;gap:8px;">
                    <button class="sneak-action-btn" id="sneak-retry-btn" style="background:linear-gradient(180deg,#10b981,#059669);">
                        🔄 НАЧАТЬ С ЭТАЖА 1
                    </button>
                    <button class="sneak-action-btn" id="sneak-gameover-menu-btn" style="background:#334155;">
                        🏰 В МЕНЮ ЗАМКА ТЕНЕЙ
                    </button>
                </div>
            </div>
        `;
        modalRoot.classList.add('visible');

        document.getElementById('sneak-retry-btn')?.addEventListener('click', () => {
            bus.emit(SFX.CLICK);
            this.scene.restart({ floor: 1 });
        });
        document.getElementById('sneak-gameover-menu-btn')?.addEventListener('click', () => {
            bus.emit(SFX.CLICK);
            this._exitToCastleMenu();
        });
    }

    togglePauseModal() {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage('toggleGameTopBarPause', '*');
            return;
        }
        if (this.ended) return;
        const modalRoot = document.getElementById('sneak-modal-root');
        if (!modalRoot) return;

        if (this.isPaused) {
            this.isPaused = false;
            modalRoot.classList.remove('visible');
            modalRoot.innerHTML = '';
            return;
        }

        this.isPaused = true;
        modalRoot.innerHTML = `
            <div class="sneak-modal-card" style="border-color:#38bdf8;max-width:360px;">
                <div style="font-weight:900;font-size:22px;color:#fef08a;margin-bottom:14px;">⏸ ПАУЗА</div>
                <div style="display:flex;flex-direction:column;gap:10px;">
                    <button class="sneak-action-btn" id="sneak-resume-btn" style="background:linear-gradient(180deg,#10b981,#059669);">
                        ▶ ПРОДОЛЖИТЬ
                    </button>
                    <button class="sneak-action-btn" id="sneak-pause-menu-btn" style="background:#475569;">
                        🏰 ВЫЙТИ В МЕНЮ
                    </button>
                </div>
            </div>
        `;
        modalRoot.classList.add('visible');

        document.getElementById('sneak-resume-btn')?.addEventListener('click', () => this.togglePauseModal());
        document.getElementById('sneak-pause-menu-btn')?.addEventListener('click', () => this._exitToCastleMenu());
    }

    _exitToCastleMenu() {
        const unbanked = Math.max(0, (this.carriedCheese || 0) - (this.bankedInRun || 0));
        if (unbanked > 0) {
            this.bankedInRun = this.carriedCheese;
            Progress.addCheese?.(unbanked);
        }
        this._unmountDomControls();
        bus.emit('bgm_stop');
        window.location.replace('transylvania-menu.html');
    }

    // =========================================================================
    // 12. WALKABILITY & AUDIO HELPERS
    // =========================================================================

    _isMonsterWalkable(wx, wy) {
        const gx = Math.floor(wx / this.room.cell);
        const gy = Math.floor(wy / this.room.cell);
        if (gy < 0 || gy >= this.room.H || gx < 0 || gx >= this.room.W) return false;
        return this.room.grid[gy][gx] === '.';
    }

    _isWalkableCellAtWorld(wx, wy) {
        const gx = Math.floor(wx / this.room.cell);
        const gy = Math.floor(wy / this.room.cell);
        if (gy < 0 || gy >= this.room.H || gx < 0 || gx >= this.room.W) return false;
        const t = this.room.grid[gy][gx];
        return t === '.' || t === 'B' || t === 'V' || t === 'S';
    }

    _canWalkAt(wx, wy, r) {
        return (
            this._isWalkableCellAtWorld(wx - r, wy - r) &&
            this._isWalkableCellAtWorld(wx + r, wy - r) &&
            this._isWalkableCellAtWorld(wx - r, wy + r) &&
            this._isWalkableCellAtWorld(wx + r, wy + r)
        );
    }

    _isInsideShadow(wx, wy) {
        for (const sz of this.shadowZones) {
            if (Math.hypot(wx - sz.x, wy - sz.y) <= sz.r) return true;
        }
        return false;
    }

    _playMusicalChime(freqs, noteDur = 0.07, wave = 'triangle') {
        if (localStorage.getItem('mousie_muted') === '1' || document.hidden) return;
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            if (!SneakScene._audioCtx) SneakScene._audioCtx = new Ctx();
            const ctx = SneakScene._audioCtx;
            if (ctx.state === 'suspended') return;

            const now = ctx.currentTime;
            freqs.forEach((f, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = wave;
                osc.frequency.setValueAtTime(f, now + i * noteDur);
                gain.gain.setValueAtTime(0.001, now + i * noteDur);
                gain.gain.linearRampToValueAtTime(0.11, now + i * noteDur + 0.012);
                gain.gain.exponentialRampToValueAtTime(0.0008, now + (i + 1) * noteDur + 0.06);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + i * noteDur);
                osc.stop(now + (i + 1) * noteDur + 0.07);
            });
        } catch (_) {}
    }
}
