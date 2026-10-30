// ============================================================================
// SNEAK SCENE — «Тихая лапка: Операция Нора» (Burrow Heist & Pet Rescue)
// ============================================================================
// Complete Redesign based on 10-Year-Old Player Psychology:
//   - Floating Magical Islands separated by starry chasms: Burrows are 100%
//     essential to travel between islands and rescue captive cute pets!
//   - "Я в домике!" Safe Burrow Peek Mode: diving into a burrow hides Pi
//     underground, lets her peek out safely at the exit hole, whistle (`📣 СВИСТ!`)
//     from the opposite hole to trick monsters, and pop out with a Ninja Boost!
//   - Cute Pet Follower Train ("Паровозик Друзей"): rescued pets (Мими 🎀,
//     Бублик 🧁, Облачко ☁️, Звёздочка ⭐, Лучик ✨) trot behind Pi and dive
//     through burrows with her!
//   - Glossy 3D HTML/CSS Arcade Controls & Crisp DOM HUD matching Snowball Fight.
//   - Between-Floor 1-of-3 Super-Perk Selector (Brawl Stars / Roguelite loop).
// ============================================================================

import { bus } from '../audio/EventBus.js';
import { Progress } from '../storage/ProgressStore.js';
import { SFX } from '../audio/SoundKeys.js';
import { preloadAudio } from '../audio/AudioManager.js';
import {
    generateHeistFloor,
    RUN_PERKS
} from '../sneak/ProceduralHeistGenerator.js';

const FONT = 'Nunito, sans-serif';

const PLAYER_BASE_SPEED = 248;
const PLAYER_RADIUS = 18;
const PLAYER_SPRITE_SCALE = 0.38;
const PLAYER_PEEK_SCALE = 0.25;

const HOLE_TRIGGER_RADIUS = 64;
const BURROW_PEEK_MAX_MS = 4200;
const DASH_DURATION_MS = 340;
const DASH_COOLDOWN_MS = 2200;
const DASH_SPEED_MUL = 2.05;

const CAKE_FLIGHT_MS = 320;
const CAKE_HEAR_RADIUS = 380;
const CAKE_BLIND_RADIUS = 95;
const CAKE_DISTRACT_MS = 3600;
const CAKE_BLIND_MS = 4000;

const WHISTLE_DISTRACT_MS = 4200;
const CATCH_DIST = 34;
const SUSPICION_FILL_MS = 480;
const SUSPICION_DECAY_MS = 900;

const SKIN_KEYS = [
    'brown', 'pink', 'yellow-antler', 'robot', 'green-monster', 'shadow',
    'devil', 'angel', 'yellow-lion', 'bear', 'frog', 'professor',
    'pirate', 'astronaut', 'kitty', 'cockroach'
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
        this.totalRescuedInRun = data?.totalRescuedInRun ?? 0;
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

        const dpr = window.__GAME_DPR || 1;
        this.load.svg('stairs',       'assets/world/stairs.svg',       { width: Math.round(72 * dpr), height: Math.round(80 * dpr) });
        this.load.svg('chest_closed', 'assets/world/chest_closed.svg', { width: Math.round(48 * dpr), height: Math.round(44 * dpr) });
        this.load.svg('chest_open',   'assets/world/chest_open.svg',   { width: Math.round(48 * dpr), height: Math.round(44 * dpr) });
    }

    create() {
        this.dpr = window.__GAME_DPR || 1;

        // Apply equipped skin sidegrades (e.g., Забавный таракан / Лягушонок / Тень)
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
            this.piesLeft = Math.min(9, this.piesLeft + 1);
        }

        // 1. Generate Multi-Island Burrow Heist Floor
        this.room = generateHeistFloor(this.floor);
        this.theme = this.room.theme;

        const mapPxW = this.room.W * this.room.cell;
        const mapPxH = this.room.H * this.room.cell;

        this.cameras.main.setBackgroundColor('#090614');

        // 2. Render Seamless HD Magical Islands & Subterranean Burrow Tubes
        this._ensureCustomTextures();
        this._renderMagicalIslands(mapPxW, mapPxH);
        this._buildBurrowEntrances();
        this._buildShadowCushions();
        this._buildEscapePortal();
        this._buildLootAndCaptivePets();

        // 3. Player (Pi) + Rescued Pet Follower Train
        this._buildPlayer();

        // 4. Daughter's Hand-Drawn Monsters + Vision Cones
        this._buildMonsters();

        // 5. Camera setup — account for DPR so world scale looks crisp & natural
        const cssW = this.scale.width / this.dpr;
        const cssH = this.scale.height / this.dpr;
        const fitCssZoom = Math.min(cssW / (mapPxW + 80), cssH / (mapPxH + 120));
        const worldCssZoom = Math.max(0.62, Math.min(0.95, fitCssZoom * 1.18));
        this.cameras.main.setZoom(worldCssZoom * this.dpr);
        this.cameras.main.setBounds(-120, -100, mapPxW + 240, mapPxH + 220);
        this.cameras.main.startFollow(this.player, false, 0.14, 0.14);

        // 6. State flags
        this.floorStartedAt = this.time.now;
        this.seenOnThisFloor = false;
        this.ended = false;
        this.isPaused = false;
        this.isTeleporting = false;
        this.inBurrowPeek = false;
        this.burrowPeekHole = null;
        this.burrowPeekMouth = null;
        this.burrowPeekUntil = 0;
        this.whistleCooldownUntil = 0;

        this.invulnerableUntil = this.time.now + 1200;
        this.dashUntil = 0;
        this.dashCooldownUntil = 0;
        this.activeBoosters = { cloak: 0, magnet: 0, turbo: 0 };

        // 7. Mount Crisp HTML/CSS HUD + Glossy 3D Arcade Controls (matching Snowballs)
        this._mountDomControlsAndHud();
        this._setupKeyboardAndMapTap();
        this._showFloorIntroBanner();

        // 8. Audio — start theme BGM + sparkling fanfare
        if (this.theme?.bgm) {
            bus.emit(this.theme.bgm);
        }
        this._playMusicalChime([523.25, 659.25, 783.99, 1046.5], 0.08, 'triangle');

        this.events.on('shutdown', () => this._unmountDomControls());
        this.events.on('destroy', () => this._unmountDomControls());
    }

    // =========================================================================
    // CUSTOM PROCEDURAL TEXTURES (Cute Pets, Crystal Bubbles, Strawberry Cakes)
    // =========================================================================

    _ensureCustomTextures() {
        const pets = [
            { key: 'pet_mimi', body: '#ffffff', ear: '#fbcfe8', bow: '#f43f5e', kind: 'mouse' },
            { key: 'pet_bublik', body: '#fed7aa', ear: '#fb923c', bow: '#f97316', kind: 'hamster' },
            { key: 'pet_cloud', body: '#e0f2fe', ear: '#7dd3fc', bow: '#0ea5e9', kind: 'cat' },
            { key: 'pet_star', body: '#f3e8ff', ear: '#d8b4fe', bow: '#eab308', kind: 'bunny' },
            { key: 'pet_luchik', body: '#ffedd5', ear: '#fb923c', bow: '#ec4899', kind: 'fox' }
        ];

        for (const p of pets) {
            if (this.textures.exists(p.key)) continue;
            const c = this.textures.createCanvas(p.key, 64, 64);
            const ctx = c.getContext();

            ctx.save();
            ctx.translate(32, 34);

            ctx.fillStyle = p.body;
            ctx.strokeStyle = '#1e1b4b';
            ctx.lineWidth = 2.8;
            if (p.kind === 'bunny') {
                for (const dir of [-1, 1]) {
                    ctx.beginPath();
                    ctx.ellipse(dir * 10, -18, 6, 13, dir * 0.15, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                    ctx.fillStyle = p.ear;
                    ctx.beginPath();
                    ctx.ellipse(dir * 10, -18, 3, 8, dir * 0.15, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = p.body;
                }
            } else {
                for (const dir of [-1, 1]) {
                    ctx.beginPath();
                    ctx.arc(dir * 13, -13, 8.5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                    ctx.fillStyle = p.ear;
                    ctx.beginPath();
                    ctx.arc(dir * 13, -13, 4.8, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = p.body;
                }
            }

            ctx.fillStyle = p.body;
            ctx.beginPath();
            ctx.ellipse(0, 2, 18, 16, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = 'rgba(244, 63, 94, 0.55)';
            ctx.beginPath();
            ctx.ellipse(-10, 4, 4.2, 2.6, 0, 0, Math.PI * 2);
            ctx.ellipse(10, 4, 4.2, 2.6, 0, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#0f172a';
            for (const dir of [-1, 1]) {
                ctx.beginPath();
                ctx.arc(dir * 6.5, -1, 3.3, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(dir * 6.5 - 1, -2.2, 1.3, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#0f172a';
            }

            ctx.fillStyle = '#f43f5e';
            ctx.beginPath();
            ctx.arc(0, 2.5, 2.0, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = p.bow;
            ctx.beginPath();
            ctx.arc(0, -13, 4.2, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
            c.refresh();
        }

        if (!this.textures.exists('heist_cake')) {
            const c = this.textures.createCanvas('heist_cake', 48, 48);
            const ctx = c.getContext();
            ctx.translate(24, 26);
            ctx.fillStyle = '#fde68a';
            ctx.strokeStyle = '#78350f';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.roundRect(-14, -4, 28, 14, 5);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#f472b6';
            ctx.beginPath();
            ctx.roundRect(-16, -11, 32, 10, 6);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#ef4444';
            ctx.beginPath();
            ctx.arc(0, -14, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            c.refresh();
        }
    }

    // =========================================================================
    // SEAMLESS MAGICAL ISLANDS & SUBTERRANEAN BURROW TUBES RENDERER
    // =========================================================================

    _renderMagicalIslands(mapPxW, mapPxH) {
        const texKey = `magical_islands_floor_${this.floor}_${this.room.seed}`;
        if (this.textures.exists(texKey)) {
            this.textures.remove(texKey);
        }

        const pad = 80;
        const canvasW = mapPxW + pad * 2;
        const canvasH = mapPxH + pad * 2;
        const canvasTex = this.textures.createCanvas(texKey, canvasW, canvasH);
        const ctx = canvasTex.getContext();
        const C = this.room.cell;
        const t = this.theme;

        ctx.save();
        ctx.translate(pad, pad);

        // 1. Deep Magical Starry Sky / Lagoon Background
        const skyGrad = ctx.createLinearGradient(0, -pad, 0, mapPxH + pad);
        skyGrad.addColorStop(0, t.skyTop);
        skyGrad.addColorStop(1, t.skyBot);
        ctx.fillStyle = skyGrad;
        ctx.fillRect(-pad, -pad, canvasW, canvasH);

        for (let i = 0; i < 6; i++) {
            const nx = ((i * 397 + 150) % mapPxW);
            const ny = ((i * 263 + 120) % mapPxH);
            const rad = 220 + (i % 3) * 80;
            const nGrad = ctx.createRadialGradient(nx, ny, 10, nx, ny, rad);
            nGrad.addColorStop(0, t.nebulaColor);
            nGrad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = nGrad;
            ctx.beginPath();
            ctx.arc(nx, ny, rad, 0, Math.PI * 2);
            ctx.fill();
        }

        for (let s = 0; s < 95; s++) {
            const sx = ((s * 173 + 41) % (canvasW - 20)) - pad + 10;
            const sy = ((s * 251 + 83) % (canvasH - 20)) - pad + 10;
            const sr = (s % 4 === 0) ? 2.4 : 1.3;
            ctx.fillStyle = (s % 5 === 0) ? t.accentHex : 'rgba(255, 255, 255, 0.65)';
            ctx.beginPath();
            ctx.arc(sx, sy, sr, 0, Math.PI * 2);
            ctx.fill();
        }

        // 2. Glowing Subterranean Energy Tubes connecting Burrow Pairs across the abyss!
        for (const h of this.room.holes) {
            const ax = (h.a.x + 0.5) * C;
            const ay = (h.a.y + 0.5) * C;
            const bx = (h.b.x + 0.5) * C;
            const by = (h.b.y + 0.5) * C;
            const mx = (ax + bx) / 2;
            const my = (ay + by) / 2 + (ay <= by ? -36 : 36);

            ctx.save();
            ctx.strokeStyle = h.color.hex;
            ctx.globalAlpha = 0.30;
            ctx.lineWidth = 34;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.quadraticCurveTo(mx, my, bx, by);
            ctx.stroke();

            ctx.globalAlpha = 0.75;
            ctx.strokeStyle = '#090d16';
            ctx.lineWidth = 20;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.quadraticCurveTo(mx, my, bx, by);
            ctx.stroke();

            ctx.globalAlpha = 0.95;
            ctx.strokeStyle = h.color.hex;
            ctx.lineWidth = 5;
            ctx.setLineDash([14, 12]);
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.quadraticCurveTo(mx, my, bx, by);
            ctx.stroke();
            ctx.restore();
        }

        // 3. Draw Each Floating Rounded Island with 3D Extruded Cliff & Pastel/Neon Top
        const cliffDepth = 26;
        const cornerRadius = 28;

        for (const isl of this.room.islands) {
            const ix = isl.x1 * C;
            const iy = isl.y1 * C;
            const iw = (isl.x2 - isl.x1 + 1) * C;
            const ih = (isl.y2 - isl.y1 + 1) * C;

            ctx.save();
            ctx.fillStyle = 'rgba(0, 0, 0, 0.52)';
            ctx.beginPath();
            ctx.roundRect(ix - 8, iy + 14, iw + 16, ih + cliffDepth + 14, cornerRadius + 6);
            ctx.fill();

            const cliffGrad = ctx.createLinearGradient(ix, iy + ih - 10, ix, iy + ih + cliffDepth);
            cliffGrad.addColorStop(0, t.islandCliffTop);
            cliffGrad.addColorStop(1, t.islandCliffBot);
            ctx.fillStyle = cliffGrad;
            ctx.beginPath();
            ctx.roundRect(ix, iy + cliffDepth, iw, ih, cornerRadius);
            ctx.fill();

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
            ctx.lineWidth = 2;
            for (let sx = ix + C; sx < ix + iw; sx += C) {
                ctx.beginPath();
                ctx.moveTo(sx, iy + ih);
                ctx.lineTo(sx, iy + ih + cliffDepth - 4);
                ctx.stroke();
            }

            ctx.save();
            ctx.beginPath();
            ctx.roundRect(ix, iy, iw, ih, cornerRadius);
            ctx.clip();

            const topGrad = ctx.createLinearGradient(ix, iy, ix, iy + ih);
            topGrad.addColorStop(0, t.islandTopA);
            topGrad.addColorStop(1, t.islandTopB);
            ctx.fillStyle = topGrad;
            ctx.fillRect(ix, iy, iw, ih);

            ctx.fillStyle = t.islandChecker;
            for (let gy = isl.y1; gy <= isl.y2; gy++) {
                for (let gx = isl.x1; gx <= isl.x2; gx++) {
                    if ((gx + gy) % 2 === 0) {
                        ctx.fillRect(gx * C + 4, gy * C + 4, C - 8, C - 8);
                    }
                }
            }

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
            ctx.lineWidth = 8;
            ctx.beginPath();
            ctx.roundRect(ix + 4, iy + 4, iw - 8, ih - 8, cornerRadius - 4);
            ctx.stroke();
            ctx.restore();

            ctx.strokeStyle = t.islandRim;
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.roundRect(ix, iy, iw, ih, cornerRadius);
            ctx.stroke();

            if (isl.pillarCell) {
                const px = isl.pillarCell.x * C;
                const py = isl.pillarCell.y * C;
                ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
                ctx.beginPath();
                ctx.roundRect(px + 4, py + 8, C - 8, C - 4, 18);
                ctx.fill();
                const pGrad = ctx.createLinearGradient(px, py, px, py + C);
                pGrad.addColorStop(0, t.islandRim);
                pGrad.addColorStop(1, t.islandCliffTop);
                ctx.fillStyle = pGrad;
                ctx.beginPath();
                ctx.roundRect(px + 6, py + 4, C - 12, C - 12, 18);
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2.5;
                ctx.stroke();
                ctx.fillStyle = 'rgba(255,255,255,0.85)';
                ctx.beginPath();
                ctx.arc(px + C / 2, py + C / 2 - 2, 10, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.restore();
        }

        ctx.restore();
        canvasTex.refresh();

        this.add.image(-pad, -pad, texKey).setOrigin(0, 0).setDepth(0);

        for (const isl of this.room.islands) {
            if (isl.role === 'start' || isl.role === 'portal') {
                const cx = ((isl.x1 + isl.x2 + 1) / 2) * C;
                const topY = isl.y1 * C - 16;
                const label = isl.role === 'start' ? '🐾 СТАРТ' : '🌈 ВЫХОД';
                this.add.text(cx, topY, label, {
                    fontFamily: FONT,
                    fontSize: '13px',
                    fontStyle: '900',
                    color: '#ffffff',
                    stroke: '#090614',
                    strokeThickness: 4,
                    backgroundColor: 'rgba(15, 23, 42, 0.75)',
                    padding: { x: 8, y: 3 }
                }).setOrigin(0.5).setDepth(5);
            }
        }
    }

    // =========================================================================
    // COLOR-CODED BURROW PORTALS (`🕳️ Норы-Туннели`)
    // =========================================================================

    _buildBurrowEntrances() {
        this.holeSprites = [];

        this.room.holes.forEach((h) => {
            const ax = (h.a.x + 0.5) * this.room.cell;
            const ay = (h.a.y + 0.5) * this.room.cell;
            const bx = (h.b.x + 0.5) * this.room.cell;
            const by = (h.b.y + 0.5) * this.room.cell;

            const makeBurrowMouth = (x, y, partnerX, partnerY, mouthKey) => {
                const outerGlow = this.add.circle(x, y, 34, h.color.ringColor, 0.28)
                    .setStrokeStyle(3.5, h.color.ringColor, 0.95)
                    .setDepth(6);

                const innerRing = this.add.circle(x, y, 24, h.color.coreColor, 0.94)
                    .setStrokeStyle(3, h.color.glowColor, 0.92)
                    .setDepth(6.2);

                const arrow = Math.abs(partnerX - x) > Math.abs(partnerY - y)
                    ? (partnerX > x ? '➔' : '⬅')
                    : (partnerY > y ? '⬇' : '⬆');
                const badge = this.add.text(x, y - 34, `${h.color.badge} НОРА ${arrow}`, {
                    fontFamily: FONT,
                    fontSize: '11px',
                    fontStyle: '900',
                    color: '#ffffff',
                    stroke: '#000000',
                    strokeThickness: 3.5,
                    backgroundColor: 'rgba(15, 23, 42, 0.84)',
                    padding: { x: 6, y: 2 }
                }).setOrigin(0.5).setDepth(7.5);

                this.tweens.add({
                    targets: outerGlow,
                    scaleX: 1.16,
                    scaleY: 1.16,
                    alpha: 0.48,
                    duration: 850,
                    yoyo: true,
                    repeat: -1,
                    ease: 'Sine.easeInOut'
                });

                return {
                    x,
                    y,
                    partnerX,
                    partnerY,
                    mouthKey,
                    outerGlow,
                    innerRing,
                    badge,
                    hole: h
                };
            };

            const mouthA = makeBurrowMouth(ax, ay, bx, by, 'a');
            const mouthB = makeBurrowMouth(bx, by, ax, ay, 'b');
            this.holeSprites.push({ hole: h, a: mouthA, b: mouthB });
        });
    }

    _buildShadowCushions() {
        this.shadowRects = [];
        for (const sz of (this.room.shadowZones || [])) {
            const x = (sz.x + 0.5) * this.room.cell;
            const y = (sz.y + 0.5) * this.room.cell;
            const r = this.room.cell * 0.42;

            const pad = this.add.circle(x, y, r, 0x311042, 0.72)
                .setStrokeStyle(2.5, 0xc084fc, 0.85)
                .setDepth(4.2);
            const lbl = this.add.text(x, y, '🐾 ТЕНЬ', {
                fontFamily: FONT,
                fontSize: '11px',
                fontStyle: '900',
                color: '#e9d5ff',
                stroke: '#000000',
                strokeThickness: 3
            }).setOrigin(0.5).setDepth(4.3);

            this.shadowRects.push({ x, y, r, pad, lbl });
        }
    }

    // =========================================================================
    // RAINBOW ESCAPE PORTAL (`🌈 ПОРТАЛ СПАСЕНИЯ`)
    // =========================================================================

    _buildEscapePortal() {
        const ex = this.room.primaryExit;
        this.exitPos = {
            x: (ex.x + 0.5) * this.room.cell,
            y: (ex.y + 0.5) * this.room.cell,
            r: 44
        };
        this.exitUnlocked = false;

        this.exitRingOuter = this.add.circle(this.exitPos.x, this.exitPos.y, 38, 0x475569, 0.32)
            .setStrokeStyle(4, 0x94a3b8, 0.85)
            .setDepth(6);
        this.exitRingInner = this.add.circle(this.exitPos.x, this.exitPos.y, 26, 0x1e293b, 0.85)
            .setStrokeStyle(2.5, 0xcbd5e1, 0.7)
            .setDepth(6.1);

        if (this.textures.exists('stairs')) {
            this.exitSprite = this.add.image(this.exitPos.x, this.exitPos.y, 'stairs')
                .setDisplaySize(54, 54)
                .setAlpha(0.6)
                .setDepth(6.3);
        }

        this.exitBadge = this.add.text(this.exitPos.x, this.exitPos.y - 44, '🔒 СПАСИ ДРУЗЕЙ', {
            fontFamily: FONT,
            fontSize: '12px',
            fontStyle: '900',
            color: '#cbd5e1',
            stroke: '#090614',
            strokeThickness: 4,
            backgroundColor: 'rgba(15, 23, 42, 0.85)',
            padding: { x: 8, y: 3 }
        }).setOrigin(0.5).setDepth(8);
    }

    _unlockEscapePortal() {
        if (this.exitUnlocked) return;
        this.exitUnlocked = true;

        this.exitRingOuter.setFillStyle(0x10b981, 0.38).setStrokeStyle(4.5, 0x34d399, 1.0);
        this.exitRingInner.setFillStyle(0x065f46, 0.90).setStrokeStyle(3, 0xa7f3d0, 1.0);
        if (this.exitSprite) {
            this.exitSprite.setAlpha(1).clearTint();
        }
        this.exitBadge.setText('🌈 ПОРТАЛ ОТКРЫТ!').setColor('#6ee7b7');

        this.tweens.add({
            targets: [this.exitRingOuter, this.exitBadge],
            scaleX: 1.14,
            scaleY: 1.14,
            duration: 520,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });

        bus.emit(SFX.DOOR_OPEN);
        this._playMusicalChime([587.33, 783.99, 987.77, 1174.66], 0.09, 'triangle');
        this._showToast('🌈 Все пушистики спасены! Прыгай в нору к Порталу Выхода!', '#4ade80');
    }

    // =========================================================================
    // CUTE CAPTIVE PETS, SURPRISE CHEST, BOOSTERS, CAKES & CRUMBS
    // =========================================================================

    _buildLootAndCaptivePets() {
        this.petTargets = [];
        this.rescuedPetsCount = 0;
        this.totalPetsToRescue = this.room.captivePets.length;

        for (const pet of this.room.captivePets) {
            const x = (pet.x + 0.5) * this.room.cell;
            const y = (pet.y + 0.5) * this.room.cell;
            const texKey = `pet_${pet.petDef.id}`;

            const padGlow = this.add.circle(x, y + 6, 30, 0xf472b6, 0.25)
                .setStrokeStyle(2.5, 0xfbcfe8, 0.85)
                .setDepth(6.5);

            const petSprite = this.add.image(x, y, this.textures.exists(texKey) ? texKey : 'd_grandma')
                .setDisplaySize(50, 50)
                .setDepth(7.2);

            const bubble = this.add.circle(x, y, 28, 0x38bdf8, 0.22)
                .setStrokeStyle(3, 0xe0f2fe, 0.95)
                .setDepth(7.5);
            const bubbleShine = this.add.circle(x - 9, y - 10, 6, 0xffffff, 0.65)
                .setDepth(7.6);

            const label = this.add.text(x, y - 40, `${pet.petDef.badge} ${pet.petDef.name}`, {
                fontFamily: FONT,
                fontSize: '12px',
                fontStyle: '900',
                color: '#fef08a',
                stroke: '#090614',
                strokeThickness: 4,
                backgroundColor: 'rgba(15, 23, 42, 0.84)',
                padding: { x: 7, y: 2 }
            }).setOrigin(0.5).setDepth(8.5);

            this.tweens.add({
                targets: [petSprite, bubble, bubbleShine],
                y: y - 5,
                duration: 750,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });

            this.petTargets.push({
                ...pet,
                wx: x,
                wy: y,
                texKey,
                taken: false,
                padGlow,
                petSprite,
                bubble,
                bubbleShine,
                label
            });
        }

        // 2. Secret Surprise Chest (`🎁 СУПЕР-СУНДУК`)
        this.secretChest = null;
        if (this.room.secretChest) {
            const sc = this.room.secretChest;
            const x = (sc.x + 0.5) * this.room.cell;
            const y = (sc.y + 0.5) * this.room.cell;
            const glow = this.add.circle(x, y, 26, 0xfacc15, 0.28)
                .setStrokeStyle(2.5, 0xfde047, 0.9)
                .setDepth(6.5);
            const sp = this.add.image(x, y, this.textures.exists('chest_closed') ? 'chest_closed' : 'd_cheese')
                .setDisplaySize(46, 44)
                .setDepth(7.2);
            const badge = this.add.text(x, y - 34, '🎁 СЮРПРИЗ x2', {
                fontFamily: FONT,
                fontSize: '11px',
                fontStyle: '900',
                color: '#fde047',
                stroke: '#090614',
                strokeThickness: 3.5,
                backgroundColor: 'rgba(15, 23, 42, 0.8)',
                padding: { x: 6, y: 2 }
            }).setOrigin(0.5).setDepth(8);

            this.secretChest = { ...sc, wx: x, wy: y, opened: false, glow, sp, badge };
        }

        // 3. Boosters (`🧥`, `🧲`, `⚡`)
        this.boosterNodes = [];
        for (const b of (this.room.boosters || [])) {
            const x = (b.x + 0.5) * this.room.cell;
            const y = (b.y + 0.5) * this.room.cell;
            const ring = this.add.circle(x, y, 22, b.color, 0.28)
                .setStrokeStyle(2.5, b.color, 0.95)
                .setDepth(6.8);
            const iconChar = b.type === 'cloak' ? '🧥' : b.type === 'magnet' ? '🧲' : '⚡';
            const icon = this.add.text(x, y, iconChar, { fontSize: '23px' })
                .setOrigin(0.5)
                .setDepth(7.2);
            this.tweens.add({
                targets: [ring, icon],
                y: y - 4,
                duration: 720,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });
            this.boosterNodes.push({ ...b, wx: x, wy: y, taken: false, ring, icon });
        }

        // 4. Cream Cakes (`🎂`)
        this.pieNodes = [];
        for (const p of (this.room.pies || [])) {
            const x = (p.x + 0.5) * this.room.cell;
            const y = (p.y + 0.5) * this.room.cell;
            const glow = this.add.circle(x, y, 20, 0xf472b6, 0.25)
                .setStrokeStyle(2, 0xfbcfe8, 0.85)
                .setDepth(6.5);
            const sp = this.add.image(x, y, 'heist_cake')
                .setDisplaySize(38, 38)
                .setDepth(7);
            this.pieNodes.push({ wx: x, wy: y, taken: false, glow, sp });
        }

        // 5. Star Cheese Crumbs (`🧀`)
        const cheeseTex = this.textures.exists('d_cheese') ? 'd_cheese' : 'heist_cake';
        this.crumbNodes = [];
        for (const c of (this.room.crumbs || [])) {
            const x = (c.x + 0.5) * this.room.cell;
            const y = (c.y + 0.5) * this.room.cell;
            const sp = this.add.image(x, y, cheeseTex)
                .setDisplaySize(30, 26)
                .setDepth(6.5);
            this.tweens.add({
                targets: sp,
                y: y - 3,
                duration: 680 + Math.random() * 250,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });
            this.crumbNodes.push({ ...c, wx: x, wy: y, taken: false, sp });
        }
    }

    // =========================================================================
    // PLAYER (PI / EQUIPPED SKIN) & CUTE PET FOLLOWER TRAIN (`Паровозик Друзей`)
    // =========================================================================

    _buildPlayer() {
        const startX = (this.room.entry.x + 0.5) * this.room.cell;
        const startY = (this.room.entry.y + 0.5) * this.room.cell;

        const skinObj = Progress.getCurrentSkin?.() || { id: 'blue', spriteKey: 'd_pi' };
        const skinKey = skinObj.spriteKey || 'd_pi';
        const isBase = (skinKey === 'd_pi' || skinObj.id === 'blue' || !this.textures.exists(skinKey));

        this.playerTexFront = isBase ? 'd_pi' : skinKey;
        this.playerTexWalk1 = isBase
            ? (this.textures.exists('d_pi_walk1') ? 'd_pi_walk1' : 'd_pi')
            : (this.textures.exists(`${skinKey}_w1`) ? `${skinKey}_w1` : skinKey);
        this.playerTexWalk2 = isBase
            ? (this.textures.exists('d_pi_walk2') ? 'd_pi_walk2' : 'd_pi')
            : (this.textures.exists(`${skinKey}_w2`) ? `${skinKey}_w2` : skinKey);
        this.playerTexBack = isBase
            ? (this.textures.exists('d_pi_b') ? 'd_pi_b' : 'd_pi')
            : (this.textures.exists(`${skinKey}_b`) ? `${skinKey}_b` : skinKey);

        this.playerHalo = this.add.circle(startX, startY + 10, 22, 0x38bdf8, 0.28)
            .setStrokeStyle(2.5, 0x7dd3fc, 0.85)
            .setDepth(11);

        this.player = this.add.image(startX, startY, this.playerTexFront)
            .setScale(PLAYER_SPRITE_SCALE)
            .setDepth(12);

        this.playerStatusBadge = this.add.text(startX, startY - 38, '', {
            fontFamily: FONT,
            fontSize: '12px',
            fontStyle: '900',
            color: '#6ee7b7',
            stroke: '#090614',
            strokeThickness: 4,
            backgroundColor: 'rgba(6, 78, 59, 0.88)',
            padding: { x: 7, y: 2 }
        }).setOrigin(0.5).setDepth(20).setVisible(false);

        this.playerVel = { x: 0, y: 0 };
        this.playerFacing = { x: 1, y: 0 };

        this.playerTrail = [{ x: startX, y: startY }];
        this.rescuedFollowers = [];
    }

    _addRescuedFollower(petTarget) {
        const followerSprite = this.add.image(this.player.x, this.player.y, petTarget.texKey)
            .setDisplaySize(40, 40)
            .setDepth(11.5);
        const followerHalo = this.add.circle(this.player.x, this.player.y + 8, 15, 0xf472b6, 0.25)
            .setDepth(11.2);
        this.rescuedFollowers.push({
            name: petTarget.petDef.name,
            badge: petTarget.petDef.badge,
            sprite: followerSprite,
            halo: followerHalo,
            bobPhase: this.rescuedFollowers.length * 1.3
        });
    }

    _updateFollowers(time) {
        if (!this.rescuedFollowers.length) return;
        const stepGap = 11;
        for (let i = 0; i < this.rescuedFollowers.length; i++) {
            const f = this.rescuedFollowers[i];
            if (this.inBurrowPeek || this.isTeleporting) {
                f.sprite.setVisible(false);
                f.halo.setVisible(false);
                continue;
            }
            f.sprite.setVisible(true);
            f.halo.setVisible(true);
            const idx = Math.max(0, this.playerTrail.length - 1 - (i + 1) * stepGap);
            const pt = this.playerTrail[idx] || this.player;
            const bob = Math.sin(time / 120 + f.bobPhase) * 3;
            f.sprite.setPosition(pt.x, pt.y + bob);
            f.halo.setPosition(pt.x, pt.y + 10);
        }
    }

    // =========================================================================
    // DAUGHTER'S HAND-DRAWN MONSTERS & VISION CONES
    // =========================================================================

    _buildMonsters() {
        this.visionGraphics = this.add.graphics().setDepth(5.2);
        this.monsters = [];

        for (const mCfg of this.room.monsters) {
            const startNode = mCfg.patrol[0];
            const wx = (startNode.x + 0.5) * this.room.cell;
            const wy = (startNode.y + 0.5) * this.room.cell;

            const tex = this.textures.exists(mCfg.def.texFront) ? mCfg.def.texFront : 'd_cat';
            const shadow = this.add.ellipse(wx, wy + 22, 42, 16, 0x000000, 0.42).setDepth(9.5);
            const sprite = this.add.image(wx, wy, tex)
                .setScale(mCfg.def.scale || 0.38)
                .setDepth(10);

            const badge = this.add.text(wx, wy - 44, '', {
                fontFamily: FONT,
                fontSize: '12px',
                fontStyle: '900',
                color: '#fef08a',
                stroke: '#090614',
                strokeThickness: 4,
                backgroundColor: 'rgba(15, 23, 42, 0.85)',
                padding: { x: 7, y: 2 }
            }).setOrigin(0.5).setDepth(18).setVisible(false);

            const nextNode = mCfg.patrol[1 % mCfg.patrol.length];
            const initAngle = Math.atan2(nextNode.y - startNode.y, nextNode.x - startNode.x);

            this.monsters.push({
                cfg: mCfg,
                sprite,
                shadow,
                badge,
                x: wx,
                y: wy,
                facing: initAngle,
                patrolIdx: 0,
                waitLeftMs: 0,
                suspicion: 0,
                state: 'patrol',
                stateTimerMs: 0,
                distractTarget: null,
                nextQuipAt: this.time.now + 2400 + Math.random() * 3500
            });
        }
    }

    // =========================================================================
    // CRISP HTML/CSS HUD + GLOSSY 3D TOUCH CONTROLS (Matching Snowball Fight)
    // =========================================================================

    _mountDomControlsAndHud() {
        this._unmountDomControls();

        this.joyVec = { x: 0, y: 0 };
        this._joyTouchId = null;
        this._joyOrigin = { x: 0, y: 0 };
        this._joyMouseDown = false;

        const root = document.createElement('div');
        root.id = 'sneak-touch-ui';
        root.innerHTML = `
            <style id="sneak-touch-styles">
                #sneak-touch-ui {
                    position: fixed;
                    inset: 0;
                    pointer-events: none;
                    z-index: 40;
                    user-select: none;
                    -webkit-user-select: none;
                    font-family: 'Nunito', sans-serif;
                }
                /* Top Crisp HTML HUD Bar */
                #sneak-hud-bar {
                    position: fixed;
                    top: 0; left: 0; right: 0;
                    padding: max(8px, env(safe-area-inset-top, 8px))
                             calc(14px + env(safe-area-inset-right, 0px)) 8px
                             calc(14px + env(safe-area-inset-left, 0px));
                    background: linear-gradient(180deg, rgba(9, 6, 20, 0.92) 0%, rgba(9, 6, 20, 0.65) 85%, transparent 100%);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 8px;
                    pointer-events: none;
                    z-index: 45;
                }
                .sneak-hud-left, .sneak-hud-right {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    background: rgba(15, 23, 42, 0.78);
                    border: 1.5px solid rgba(192, 132, 252, 0.42);
                    border-radius: 999px;
                    padding: 5px 13px;
                    backdrop-filter: blur(6px);
                    box-shadow: 0 4px 14px rgba(0,0,0,0.4);
                }
                #sneak-hud-floor {
                    font-weight: 900;
                    font-size: min(3.5vw, 15px);
                    color: #f8fafc;
                }
                #sneak-hud-hearts {
                    font-size: min(3.8vw, 16px);
                    letter-spacing: 1px;
                }
                .sneak-hud-center {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 2px;
                }
                #sneak-hud-goal {
                    background: rgba(15, 23, 42, 0.86);
                    border: 2px solid ${this.theme.accentHex};
                    border-radius: 999px;
                    padding: 4px 14px;
                    font-weight: 900;
                    font-size: min(3.3vw, 14px);
                    color: #fef08a;
                    box-shadow: 0 4px 14px rgba(0,0,0,0.45);
                }
                #sneak-hud-streak {
                    font-weight: 900;
                    font-size: min(2.8vw, 12px);
                    color: #f9a8d4;
                    text-shadow: 0 1px 3px #000;
                }
                #sneak-hud-cheese {
                    font-weight: 900;
                    font-size: min(4vw, 17px);
                    color: #facc15;
                }
                #sneak-hud-pause {
                    pointer-events: auto;
                    width: 34px;
                    height: 34px;
                    border-radius: 50%;
                    border: 2px solid rgba(148, 163, 184, 0.55);
                    background: rgba(30, 41, 59, 0.92);
                    color: #fff;
                    font-size: 15px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                }
                #sneak-hud-pause:active {
                    transform: scale(0.9);
                }
                /* Banner & Toast */
                #sneak-banner {
                    position: fixed;
                    top: 66px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: rgba(15, 23, 42, 0.94);
                    border: 2.5px solid ${this.theme.accentHex};
                    border-radius: 18px;
                    padding: 8px 18px;
                    text-align: center;
                    box-shadow: 0 10px 28px rgba(0,0,0,0.55);
                    transition: opacity 0.3s ease, transform 0.3s ease;
                    z-index: 44;
                    max-width: 90vw;
                }
                #sneak-banner .b-title {
                    font-weight: 900;
                    font-size: min(4vw, 17px);
                    color: #fef08a;
                }
                #sneak-banner .b-sub {
                    font-weight: 700;
                    font-size: min(2.9vw, 12.5px);
                    color: #e2e8f0;
                    margin-top: 2px;
                }
                #sneak-toast {
                    position: fixed;
                    top: 66px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: rgba(15, 23, 42, 0.92);
                    border: 2px solid #fde047;
                    border-radius: 999px;
                    padding: 6px 16px;
                    font-weight: 900;
                    font-size: min(3.4vw, 14px);
                    color: #fef08a;
                    box-shadow: 0 6px 20px rgba(0,0,0,0.5);
                    opacity: 0;
                    transition: opacity 0.22s ease;
                    z-index: 46;
                    white-space: nowrap;
                }
                /* Left 360 Virtual Thumbstick */
                #sneak-joy-zone {
                    position: fixed;
                    left: env(safe-area-inset-left, 0px);
                    bottom: env(safe-area-inset-bottom, 0px);
                    width: 44vw;
                    height: 52vh;
                    pointer-events: auto;
                    touch-action: none;
                }
                #sneak-joy-base {
                    position: absolute;
                    left: 26px;
                    bottom: 20px;
                    width: 132px;
                    height: 132px;
                    border-radius: 50%;
                    background: radial-gradient(circle at 50% 50%,
                        rgba(15, 23, 42, 0.45) 0%,
                        rgba(15, 23, 42, 0.76) 68%,
                        rgba(88, 28, 135, 0.85) 100%);
                    border: 2.5px solid rgba(192, 132, 252, 0.62);
                    box-shadow:
                        0 8px 26px rgba(2, 6, 23, 0.6),
                        inset 0 0 22px rgba(192, 132, 252, 0.24),
                        inset 0 2px 4px rgba(255, 255, 255, 0.25);
                    backdrop-filter: blur(6px);
                    -webkit-backdrop-filter: blur(6px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    pointer-events: none;
                    transition: border-color 0.12s ease, box-shadow 0.12s ease;
                }
                #sneak-joy-base::before {
                    content: '';
                    position: absolute;
                    inset: 14px;
                    border-radius: 50%;
                    border: 1.5px dashed rgba(233, 213, 255, 0.3);
                }
                #sneak-joy-base.is-active {
                    border-color: #38bdf8;
                    box-shadow:
                        0 0 28px rgba(56, 189, 248, 0.55),
                        0 8px 26px rgba(2, 6, 23, 0.65),
                        inset 0 0 26px rgba(56, 189, 248, 0.35);
                }
                #sneak-joy-stick {
                    position: relative;
                    width: 58px;
                    height: 58px;
                    border-radius: 50%;
                    background: radial-gradient(circle at 34% 30%,
                        #fdf4ff 0%,
                        #e879f9 28%,
                        #9333ea 76%,
                        #581c87 100%);
                    border: 2.5px solid rgba(255, 255, 255, 0.9);
                    box-shadow:
                        0 6px 16px rgba(2, 6, 23, 0.65),
                        0 0 14px rgba(217, 70, 239, 0.5),
                        inset 0 3px 6px rgba(255, 255, 255, 0.78),
                        inset 0 -4px 6px rgba(59, 7, 100, 0.7);
                    will-change: transform;
                }
                /* Right Glossy 3D Action Buttons */
                .sneak-3d-btn {
                    position: fixed;
                    pointer-events: auto;
                    touch-action: none;
                    border-radius: 50%;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 2px;
                    cursor: pointer;
                    outline: none;
                    padding: 0;
                    transition: transform 0.07s cubic-bezier(0.2, 0.9, 0.3, 1), filter 0.07s ease, box-shadow 0.1s ease;
                    will-change: transform;
                }
                .sneak-3d-btn::before {
                    content: '';
                    position: absolute;
                    top: 5px;
                    left: 16%;
                    right: 16%;
                    height: 34%;
                    border-radius: 999px;
                    background: linear-gradient(180deg, rgba(255, 255, 255, 0.55) 0%, rgba(255, 255, 255, 0.04) 100%);
                    pointer-events: none;
                }
                .sneak-3d-btn::after {
                    content: '';
                    position: absolute;
                    inset: -14px;
                    border-radius: 50%;
                }
                .sneak-3d-btn:active,
                .sneak-3d-btn.is-pressed {
                    transform: scale(0.88) translateY(2px);
                    filter: brightness(1.18);
                }
                .sneak-btn-icon {
                    font-size: 30px;
                    line-height: 1;
                    filter: drop-shadow(0 2px 3px rgba(0,0,0,0.45));
                    pointer-events: none;
                }
                .sneak-btn-label {
                    font-family: 'Nunito', sans-serif;
                    font-weight: 900;
                    font-size: 10.5px;
                    letter-spacing: 0.4px;
                    color: #ffffff;
                    text-shadow: 0 1.5px 2px rgba(0, 0, 0, 0.82);
                    line-height: 1;
                    pointer-events: none;
                }
                .sneak-btn-badge {
                    position: absolute;
                    top: -4px;
                    right: -4px;
                    min-width: 24px;
                    height: 24px;
                    padding: 0 6px;
                    border-radius: 999px;
                    background: #0f172a;
                    border: 2px solid #fde047;
                    color: #fde047;
                    font-family: 'Nunito', sans-serif;
                    font-weight: 900;
                    font-size: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 3px 8px rgba(0,0,0,0.5);
                    pointer-events: none;
                }
                #sneak-btn-burrow {
                    bottom: calc(18px + env(safe-area-inset-bottom, 0px));
                    right: calc(20px + env(safe-area-inset-right, 0px));
                    width: 94px;
                    height: 94px;
                    border: 3px solid rgba(254, 240, 138, 0.9);
                    background: radial-gradient(circle at 38% 30%,
                        #fde047 0%,
                        #eab308 48%,
                        #a16207 88%,
                        #713f12 100%);
                    box-shadow:
                        0 7px 22px rgba(202, 138, 4, 0.65),
                        0 0 0 4px rgba(250, 204, 21, 0.28),
                        inset 0 3px 6px rgba(255, 255, 255, 0.6),
                        inset 0 -5px 8px rgba(113, 63, 18, 0.75);
                }
                #sneak-btn-prank {
                    bottom: calc(16px + env(safe-area-inset-bottom, 0px));
                    right: calc(128px + env(safe-area-inset-right, 0px));
                    width: 82px;
                    height: 82px;
                    border: 3px solid rgba(251, 207, 232, 0.9);
                    background: radial-gradient(circle at 38% 30%,
                        #f9a8d4 0%,
                        #ec4899 48%,
                        #9d174d 88%,
                        #500724 100%);
                    box-shadow:
                        0 7px 20px rgba(190, 24, 93, 0.65),
                        0 0 0 3px rgba(236, 72, 153, 0.25),
                        inset 0 3px 6px rgba(255, 255, 255, 0.55),
                        inset 0 -5px 8px rgba(80, 7, 36, 0.75);
                }
                /* Fullscreen Modal Container (Perk Picker / Pause / Game Over) */
                #sneak-modal-root {
                    position: fixed;
                    inset: 0;
                    background: rgba(6, 4, 16, 0.85);
                    backdrop-filter: blur(8px);
                    -webkit-backdrop-filter: blur(8px);
                    display: none;
                    align-items: center;
                    justify-content: center;
                    z-index: 60;
                    pointer-events: auto;
                    padding: 14px;
                }
                #sneak-modal-root.visible {
                    display: flex;
                }
                .sneak-modal-card {
                    background: linear-gradient(180deg, #172142 0%, #0e152d 100%);
                    border: 3px solid #facc15;
                    border-radius: 24px;
                    padding: 18px 20px;
                    max-width: min(620px, 94vw);
                    width: 100%;
                    text-align: center;
                    color: #f8fafc;
                    box-shadow: 0 20px 50px rgba(0,0,0,0.75);
                }
                .sneak-perk-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 10px;
                    margin: 12px 0;
                }
                .sneak-perk-card {
                    background: rgba(30, 41, 59, 0.95);
                    border: 2.5px solid #38bdf8;
                    border-radius: 18px;
                    padding: 12px 8px;
                    cursor: pointer;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 5px;
                    transition: transform 0.12s ease, box-shadow 0.12s ease;
                }
                .sneak-perk-card:active {
                    transform: scale(0.95);
                }
                .sneak-action-btn {
                    border: none;
                    border-radius: 14px;
                    padding: 11px 20px;
                    font-family: 'Nunito', sans-serif;
                    font-weight: 900;
                    font-size: 14.5px;
                    cursor: pointer;
                    color: #fff;
                    margin: 4px;
                }
                @media (max-height: 430px) {
                    #sneak-joy-base { width: 114px; height: 114px; left: 18px; bottom: 12px; }
                    #sneak-joy-stick { width: 48px; height: 48px; }
                    #sneak-btn-burrow { width: 82px; height: 82px; bottom: calc(12px + env(safe-area-inset-bottom, 0px)); right: calc(14px + env(safe-area-inset-right, 0px)); }
                    #sneak-btn-prank { width: 72px; height: 72px; bottom: calc(12px + env(safe-area-inset-bottom, 0px)); right: calc(108px + env(safe-area-inset-right, 0px)); }
                }
            </style>

            <div id="sneak-hud-bar">
                <div class="sneak-hud-left">
                    <span id="sneak-hud-floor">🏰 ЭТАЖ ${this.floor}</span>
                    <span id="sneak-hud-hearts"></span>
                </div>
                <div class="sneak-hud-center">
                    <div id="sneak-hud-goal"></div>
                    <div id="sneak-hud-streak"></div>
                </div>
                <div class="sneak-hud-right">
                    <span id="sneak-hud-cheese">🧀 0</span>
                    <button id="sneak-hud-pause" type="button" aria-label="Пауза">⏸</button>
                </div>
            </div>

            <div id="sneak-banner">
                <div class="b-title">${this.room.title}</div>
                <div class="b-sub">${this.room.subtitle}</div>
            </div>
            <div id="sneak-toast"></div>

            <div id="sneak-joy-zone">
                <div id="sneak-joy-base">
                    <div id="sneak-joy-stick"></div>
                </div>
            </div>
            <button id="sneak-btn-prank" class="sneak-3d-btn" type="button" aria-label="Торт или Свист">
                <span class="sneak-btn-icon" id="sneak-prank-icon">🎂</span>
                <span class="sneak-btn-label" id="sneak-prank-label">ТОРТ!</span>
                <span class="sneak-btn-badge" id="sneak-prank-badge">${this.piesLeft}</span>
            </button>
            <button id="sneak-btn-burrow" class="sneak-3d-btn" type="button" aria-label="Нора или Рывок">
                <span class="sneak-btn-icon" id="sneak-burrow-icon">🕳️</span>
                <span class="sneak-btn-label" id="sneak-burrow-label">В НОРУ!</span>
            </button>

            <div id="sneak-modal-root"></div>
        `;
        document.body.appendChild(root);
        this._domRoot = root;

        const pauseBtn = document.getElementById('sneak-hud-pause');
        if (pauseBtn) {
            pauseBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.togglePauseModal();
            });
        }

        const zone = document.getElementById('sneak-joy-zone');
        const baseEl = document.getElementById('sneak-joy-base');
        const stickEl = document.getElementById('sneak-joy-stick');
        const maxRadius = 42;
        const deadzone = 7;

        const updateStick = (clientX, clientY) => {
            const dx = clientX - this._joyOrigin.x;
            const dy = clientY - this._joyOrigin.y;
            const dist = Math.hypot(dx, dy);
            const clamped = Math.min(dist, maxRadius);
            const angle = dist > 0.001 ? Math.atan2(dy, dx) : 0;
            const ox = Math.cos(angle) * clamped;
            const oy = Math.sin(angle) * clamped;
            stickEl.style.transform = `translate3d(${ox.toFixed(1)}px, ${oy.toFixed(1)}px, 0)`;

            if (dist > deadzone) {
                const mag = Math.min(1, (dist - deadzone) / (maxRadius - deadzone));
                this.joyVec.x = Math.cos(angle) * mag;
                this.joyVec.y = Math.sin(angle) * mag;
                if (this.inBurrowPeek && dist > maxRadius * 0.55) {
                    this.popOutOfBurrow(Math.cos(angle), Math.sin(angle));
                }
            } else {
                this.joyVec.x = 0;
                this.joyVec.y = 0;
            }
        };

        const startStick = (clientX, clientY) => {
            const rect = baseEl.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            if (Math.hypot(clientX - cx, clientY - cy) <= rect.width * 0.8) {
                this._joyOrigin.x = cx;
                this._joyOrigin.y = cy;
            } else {
                this._joyOrigin.x = clientX;
                this._joyOrigin.y = clientY;
            }
            baseEl.classList.add('is-active');
            updateStick(clientX, clientY);
        };

        const resetStick = () => {
            this._joyTouchId = null;
            this._joyMouseDown = false;
            this.joyVec.x = 0;
            this.joyVec.y = 0;
            baseEl.classList.remove('is-active');
            stickEl.style.transform = 'translate3d(0px, 0px, 0)';
        };

        zone.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (this._joyTouchId !== null) return;
            const t = e.changedTouches[0];
            if (!t) return;
            this._joyTouchId = t.identifier;
            startStick(t.clientX, t.clientY);
        }, { passive: false });

        zone.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (this._joyTouchId === null) return;
            for (let i = 0; i < e.touches.length; i++) {
                if (e.touches[i].identifier === this._joyTouchId) {
                    updateStick(e.touches[i].clientX, e.touches[i].clientY);
                    return;
                }
            }
        }, { passive: false });

        const endTouch = (e) => {
            e.preventDefault();
            if (this._joyTouchId === null) return;
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === this._joyTouchId) {
                    resetStick();
                    return;
                }
            }
        };
        zone.addEventListener('touchend', endTouch, { passive: false });
        zone.addEventListener('touchcancel', endTouch, { passive: false });

        zone.addEventListener('mousedown', (e) => {
            e.preventDefault();
            this._joyMouseDown = true;
            startStick(e.clientX, e.clientY);
        });
        this._onWinMouseMove = (e) => {
            if (this._joyMouseDown) updateStick(e.clientX, e.clientY);
        };
        this._onWinMouseUp = () => {
            if (this._joyMouseDown) resetStick();
        };
        window.addEventListener('mousemove', this._onWinMouseMove);
        window.addEventListener('mouseup', this._onWinMouseUp);

        const bindBtn = (id, fn) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                e.stopPropagation();
                btn.classList.add('is-pressed');
                fn();
            }, { passive: false });
            btn.addEventListener('touchend', (e) => {
                e.preventDefault();
                btn.classList.remove('is-pressed');
            }, { passive: false });
            btn.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                btn.classList.add('is-pressed');
                fn();
            });
            btn.addEventListener('mouseup', () => btn.classList.remove('is-pressed'));
            btn.addEventListener('mouseleave', () => btn.classList.remove('is-pressed'));
        };

        bindBtn('sneak-btn-burrow', () => this.onPrimaryActionPressed());
        bindBtn('sneak-btn-prank', () => this.onSecondaryActionPressed());

        this._refreshHud();
    }

    _unmountDomControls() {
        if (this._onWinMouseMove) {
            window.removeEventListener('mousemove', this._onWinMouseMove);
            this._onWinMouseMove = null;
        }
        if (this._onWinMouseUp) {
            window.removeEventListener('mouseup', this._onWinMouseUp);
            this._onWinMouseUp = null;
        }
        const existing = document.getElementById('sneak-touch-ui');
        if (existing) existing.remove();
        this._domRoot = null;
    }

    _setupKeyboardAndMapTap() {
        if (this.input.keyboard) {
            this.cursors = this.input.keyboard.createCursorKeys();
            this.wasd = this.input.keyboard.addKeys({
                up: Phaser.Input.Keyboard.KeyCodes.W,
                down: Phaser.Input.Keyboard.KeyCodes.S,
                left: Phaser.Input.Keyboard.KeyCodes.A,
                right: Phaser.Input.Keyboard.KeyCodes.D,
                space: Phaser.Input.Keyboard.KeyCodes.SPACE,
                e: Phaser.Input.Keyboard.KeyCodes.E,
                q: Phaser.Input.Keyboard.KeyCodes.Q,
                esc: Phaser.Input.Keyboard.KeyCodes.ESC
            });
            this.wasd.space.on('down', () => this.onPrimaryActionPressed());
            this.wasd.e.on('down', () => this.onPrimaryActionPressed());
            this.wasd.q.on('down', () => this.onSecondaryActionPressed());
            this.wasd.esc.on('down', () => this.togglePauseModal());
        }

        this.input.on('pointerdown', (pointer) => {
            if (this.ended || this.isPaused) return;
            const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
            const nearH = this.nearestHoleAt(this.player.x, this.player.y);
            if (nearH && nearH.dist <= HOLE_TRIGGER_RADIUS && Math.hypot(wp.x - nearH.mouth.x, wp.y - nearH.mouth.y) < 75) {
                this.enterHole(nearH.hole);
                return;
            }
            if (this.inBurrowPeek) {
                this.popOutOfBurrow();
                return;
            }
            if (this.piesLeft > 0) {
                this.throwCakeAt(wp.x, wp.y);
            }
        });
    }

    _refreshHud() {
        const heartsEl = document.getElementById('sneak-hud-hearts');
        const goalEl = document.getElementById('sneak-hud-goal');
        const streakEl = document.getElementById('sneak-hud-streak');
        const cheeseEl = document.getElementById('sneak-hud-cheese');

        if (heartsEl) {
            heartsEl.textContent = '❤️'.repeat(Math.max(0, this.hearts)) + '🖤'.repeat(Math.max(0, this.maxHearts - this.hearts));
        }
        if (goalEl) {
            if (this.rescuedPetsCount < this.totalPetsToRescue) {
                goalEl.textContent = `🐾 СПАСЕНО ДРУЗЕЙ: ${this.rescuedPetsCount} / ${this.totalPetsToRescue}`;
                goalEl.style.color = '#fef08a';
            } else {
                goalEl.textContent = '🌈 ВСЕ СПАСЕНЫ! ПРЫГАЙ В ПОРТАЛ!';
                goalEl.style.color = '#6ee7b7';
            }
        }
        if (streakEl) {
            const perkIcons = Object.keys(this.runPerks).map(k => {
                const p = RUN_PERKS.find(r => r.id === k);
                return p ? p.icon : '';
            }).join('');
            streakEl.textContent = `🔥 СЕРИЯ x${this.streak.toFixed(1)}${perkIcons ? ' • ' + perkIcons : ''}`;
        }
        if (cheeseEl) {
            cheeseEl.textContent = `🧀 ${this.carriedCheese}`;
        }

        const prankIcon = document.getElementById('sneak-prank-icon');
        const prankLabel = document.getElementById('sneak-prank-label');
        const prankBadge = document.getElementById('sneak-prank-badge');
        const prankBtn = document.getElementById('sneak-btn-prank');

        if (prankIcon && prankLabel && prankBadge && prankBtn) {
            if (this.inBurrowPeek) {
                prankIcon.textContent = '📣';
                prankLabel.textContent = 'СВИСТ!';
                prankBadge.textContent = '🔊';
                prankBtn.style.background = 'radial-gradient(circle at 38% 30%, #fde047 0%, #f97316 52%, #9a3412 100%)';
                prankBtn.style.opacity = '1';
            } else {
                prankIcon.textContent = '🎂';
                prankLabel.textContent = 'ТОРТ!';
                prankBadge.textContent = String(this.piesLeft);
                prankBtn.style.background = 'radial-gradient(circle at 38% 30%, #f9a8d4 0%, #ec4899 48%, #9d174d 88%, #500724 100%)';
                prankBtn.style.opacity = this.piesLeft > 0 ? '1' : '0.5';
            }
        }
    }

    _showFloorIntroBanner() {
        const bannerEl = document.getElementById('sneak-banner');
        if (!bannerEl) return;
        setTimeout(() => {
            if (bannerEl) {
                bannerEl.style.opacity = '0';
                bannerEl.style.transform = 'translateX(-50%) translateY(-10px)';
            }
        }, 2400);
    }

    _showToast(msg, color = '#fef08a') {
        const toastEl = document.getElementById('sneak-toast');
        if (!toastEl) return;
        toastEl.textContent = msg;
        toastEl.style.color = color;
        toastEl.style.opacity = '1';
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            if (toastEl) toastEl.style.opacity = '0';
        }, 1900);
    }

    _spawnFloatingSticker(x, y, text, color = '#fef08a') {
        const t = this.add.text(x, y - 14, text, {
            fontFamily: FONT,
            fontSize: '15px',
            fontStyle: '900',
            color,
            stroke: '#090614',
            strokeThickness: 4
        }).setOrigin(0.5).setDepth(45);
        this.tweens.add({
            targets: t,
            y: y - 54,
            alpha: 0,
            scaleX: 1.15,
            scaleY: 1.15,
            duration: 820,
            ease: 'Cubic.easeOut',
            onComplete: () => t.destroy()
        });
    }

    // =========================================================================
    // PRIMARY & SECONDARY ACTIONS: BURROW TELEPORT, PEEK, WHISTLE & CAKE
    // =========================================================================

    nearestHoleAt(x, y) {
        let best = null;
        for (const hs of this.holeSprites) {
            const dA = Math.hypot(x - hs.a.x, y - hs.a.y);
            if (!best || dA < best.dist) {
                best = { hole: hs.hole, mouth: hs.a, partner: hs.b, mouthKey: 'a', dist: dA };
            }
            const dB = Math.hypot(x - hs.b.x, y - hs.b.y);
            if (!best || dB < best.dist) {
                best = { hole: hs.hole, mouth: hs.b, partner: hs.a, mouthKey: 'b', dist: dB };
            }
        }
        return best;
    }

    onPrimaryActionPressed() {
        if (this.ended || this.isPaused || this.isTeleporting) return;

        if (this.inBurrowPeek) {
            this.popOutOfBurrow();
            return;
        }

        const nearH = this.nearestHoleAt(this.player.x, this.player.y);
        if (nearH && nearH.dist <= HOLE_TRIGGER_RADIUS) {
            this.enterHole(nearH.hole);
            return;
        }

        const cd = Math.round(DASH_COOLDOWN_MS * (this.skinDashCdMul || 1));
        if (this.time.now >= this.dashCooldownUntil) {
            this.dashUntil = this.time.now + DASH_DURATION_MS;
            this.dashCooldownUntil = this.time.now + cd;
            bus.emit(SFX.THROW);
            this._playMusicalChime([440, 659.25], 0.05, 'sine');
            this._spawnFloatingSticker(this.player.x, this.player.y, '💨 КУВЫРОК!', '#38bdf8');
        }
    }

    onSecondaryActionPressed() {
        if (this.ended || this.isPaused || this.isTeleporting) return;

        if (this.inBurrowPeek) {
            this.triggerBurrowWhistleDecoy();
            return;
        }

        if (this.piesLeft <= 0) {
            this._showToast('🎂 Тортики закончились! Ищи их на островах!', '#f472b6');
            return;
        }

        let targetX = this.player.x + this.playerFacing.x * 165;
        let targetY = this.player.y + this.playerFacing.y * 165;
        let bestDist = Infinity;

        for (const m of this.monsters) {
            const d = Math.hypot(m.x - this.player.x, m.y - this.player.y);
            if (d < bestDist && d < 460) {
                bestDist = d;
                targetX = m.x;
                targetY = m.y;
            }
        }

        this.throwCakeAt(targetX, targetY);
    }

    enterHole(hole) {
        if (this.ended || this.isTeleporting) return;

        const C = this.room.cell;
        const ax = (hole.a.x + 0.5) * C;
        const ay = (hole.a.y + 0.5) * C;
        const bx = (hole.b.x + 0.5) * C;
        const by = (hole.b.y + 0.5) * C;

        const distA = Math.hypot(this.player.x - ax, this.player.y - ay);
        const distB = Math.hypot(this.player.x - bx, this.player.y - by);
        const fromA = distA <= distB;

        const startX = fromA ? ax : bx;
        const startY = fromA ? ay : by;
        const destX = fromA ? bx : ax;
        const destY = fromA ? by : ay;
        const destMouthKey = fromA ? 'b' : 'a';

        this.isTeleporting = true;
        this.inBurrowPeek = false;
        this.invulnerableUntil = this.time.now + 1100;

        let escapedMonster = false;
        for (const m of this.monsters) {
            if (m.suspicion > 0.15) {
                escapedMonster = true;
                m.suspicion = 0;
                m.badge.setText('❓ В нору юркнула!').setVisible(true);
            }
        }
        if (escapedMonster) {
            const bonus = Math.round(6 * this.streak);
            this.carriedCheese += bonus;
            this.streak = Math.min(3.0, +(this.streak + 0.25).toFixed(2));
            this._spawnFloatingSticker(startX, startY, `🕳️ ХИТРЫЙ ПОБЕГ! +${bonus} 🧀`, '#facc15');
            this._refreshHud();
        }

        bus.emit(SFX.PICKUP);
        this._playMusicalChime([392, 523.25, 659.25, 783.99], 0.06, 'sine');

        const diveRing = this.add.circle(startX, startY, 16, hole.color.ringColor, 0.65).setDepth(25);
        this.tweens.add({
            targets: diveRing,
            scaleX: 2.4,
            scaleY: 2.4,
            alpha: 0,
            duration: 280,
            onComplete: () => diveRing.destroy()
        });

        const comet = this.add.circle(startX, startY, 14, hole.color.ringColor, 0.95)
            .setStrokeStyle(3, 0xffffff, 0.95)
            .setDepth(24);

        this.tweens.add({
            targets: this.player,
            x: startX,
            y: startY,
            scaleX: 0.08,
            scaleY: 0.08,
            angle: 180,
            duration: 140,
            onComplete: () => {
                this.player.setPosition(destX, destY);
                this.playerHalo.setPosition(destX, destY + 10);
                this.playerTrail = [{ x: destX, y: destY }];

                this.tweens.add({
                    targets: comet,
                    x: destX,
                    y: destY,
                    duration: 210,
                    ease: 'Sine.easeInOut',
                    onComplete: () => {
                        comet.destroy();
                        this.isTeleporting = false;

                        this.inBurrowPeek = true;
                        this.burrowPeekHole = hole;
                        this.burrowPeekMouth = destMouthKey;
                        this.burrowPeekUntil = this.time.now + BURROW_PEEK_MAX_MS;

                        this.player.setAngle(0).setScale(PLAYER_PEEK_SCALE).setAlpha(0.92);
                        this.playerHalo.setStrokeStyle(3, 0x34d399, 1.0).setFillStyle(0x10b981, 0.35);
                        this._refreshHud();
                    }
                });
            }
        });
    }

    popOutOfBurrow(dirX = 0, dirY = 0) {
        if (!this.inBurrowPeek) return;
        this.inBurrowPeek = false;
        this.burrowPeekHole = null;

        this.player.setScale(PLAYER_SPRITE_SCALE).setAlpha(1);
        this.dashUntil = this.time.now + 460;
        this.invulnerableUntil = this.time.now + 750;

        if (this.runPerks.ghost_cloak) {
            this.activeBoosters.cloak = Math.max(this.activeBoosters.cloak, this.time.now + 2500);
        }

        if (dirX !== 0 || dirY !== 0) {
            this.playerFacing = { x: dirX, y: dirY };
        }

        this._playMusicalChime([587.33, 880], 0.06, 'triangle');
        this._spawnFloatingSticker(
            this.player.x,
            this.player.y,
            this.runPerks.ghost_cloak ? '🧥 ПРЫЖОК-НЕВИДИМКА!' : '🚀 ПРЫГ ИЗ НОРЫ!',
            '#4ade80'
        );
        this._refreshHud();
    }

    triggerBurrowWhistleDecoy() {
        if (this.time.now < this.whistleCooldownUntil) return;
        this.whistleCooldownUntil = this.time.now + 1400;

        const C = this.room.cell;
        const playerIsland = this._findIslandAtWorld(this.player.x, this.player.y);

        let decoyX = this.player.x;
        let decoyY = this.player.y;

        if (playerIsland) {
            const cx1 = (playerIsland.x1 + 1) * C;
            const cy1 = (playerIsland.y1 + 1) * C;
            const cx2 = (playerIsland.x2) * C;
            const cy2 = (playerIsland.y2) * C;
            const corners = [
                { x: cx1, y: cy1 },
                { x: cx2, y: cy1 },
                { x: cx2, y: cy2 },
                { x: cx1, y: cy2 }
            ];
            corners.sort((a, b) =>
                Math.hypot(b.x - this.player.x, b.y - this.player.y) -
                Math.hypot(a.x - this.player.x, a.y - this.player.y)
            );
            decoyX = corners[0].x;
            decoyY = corners[0].y;
        }

        for (let r = 0; r < 2; r++) {
            const wave = this.add.circle(decoyX, decoyY, 18, 0xfacc15, 0.45)
                .setStrokeStyle(3, 0xfef08a, 0.95)
                .setDepth(28);
            this.tweens.add({
                targets: wave,
                scaleX: 4.2,
                scaleY: 4.2,
                alpha: 0,
                delay: r * 140,
                duration: 540,
                onComplete: () => wave.destroy()
            });
        }

        this._spawnFloatingSticker(decoyX, decoyY, '📣 ПИ-ПИ-ПИ! СЮДА!', '#fde047');
        this._playMusicalChime([783.99, 987.77, 783.99], 0.07, 'sine');

        const isHypno = !!this.runPerks.hypno_whistle;
        for (const m of this.monsters) {
            const mIsl = this._findIslandAtWorld(m.x, m.y);
            if (!playerIsland || (mIsl && mIsl.id === playerIsland.id)) {
                m.suspicion = 0;
                if (isHypno) {
                    m.state = 'stunned';
                    m.stateTimerMs = 3000;
                    m.badge.setText('💤 УСНУЛ ОТ СВИСТА!').setVisible(true);
                } else {
                    m.state = 'distracted';
                    m.stateTimerMs = WHISTLE_DISTRACT_MS;
                    m.distractTarget = { x: decoyX, y: decoyY };
                    m.badge.setText('🔔 Кто свистел?!').setVisible(true);
                }
            }
        }
    }

    throwCakeAt(targetX, targetY) {
        if (this.piesLeft <= 0 || this.ended) return;
        this.piesLeft--;
        this._refreshHud();
        bus.emit(SFX.THROW);

        const cake = this.add.image(this.player.x, this.player.y, 'heist_cake')
            .setDisplaySize(38, 38)
            .setDepth(30);

        this.tweens.add({
            targets: cake,
            x: targetX,
            y: targetY,
            angle: 360,
            duration: CAKE_FLIGHT_MS,
            ease: 'Quad.easeOut',
            onComplete: () => {
                cake.destroy();
                this._onCakeSplat(targetX, targetY);
            }
        });
    }

    _onCakeSplat(x, y) {
        bus.emit(SFX.DOOR_UNLOCK);
        this._playMusicalChime([349.23, 440, 587.33], 0.08, 'triangle');

        const splat = this.add.circle(x, y, 28, 0xf472b6, 0.78)
            .setStrokeStyle(4, 0xffffff, 0.95)
            .setDepth(5.8);
        this.tweens.add({
            targets: splat,
            alpha: 0,
            scaleX: 1.4,
            scaleY: 1.4,
            delay: 2400,
            duration: 600,
            onComplete: () => splat.destroy()
        });

        let blindedAny = false;
        for (const m of this.monsters) {
            const d = Math.hypot(m.x - x, m.y - y);
            if (d <= CAKE_BLIND_RADIUS) {
                m.state = 'blinded';
                m.stateTimerMs = CAKE_BLIND_MS;
                m.suspicion = 0;
                m.sprite.setTint(0xf9a8d4);
                m.badge.setText('🎂 В ТОРТЕ! 💫').setVisible(true);
                blindedAny = true;
            } else if (d <= CAKE_HEAR_RADIUS && m.state !== 'blinded') {
                m.state = 'distracted';
                m.stateTimerMs = CAKE_DISTRACT_MS;
                m.distractTarget = { x, y };
                m.suspicion = 0;
                m.badge.setText('🍰 Ой, тортик!').setVisible(true);
            }
        }

        if (blindedAny) {
            const bonus = 8;
            this.carriedCheese += bonus;
            this._spawnFloatingSticker(x, y, `💥 СЛАДКИЙ БАБАХ! +${bonus} 🧀`, '#f472b6');
            this._refreshHud();
        } else {
            this._spawnFloatingSticker(x, y, '🔔 ПЛЮХ!', '#fde047');
        }
    }

    // =========================================================================
    // MAIN UPDATE LOOP
    // =========================================================================

    update(time, delta) {
        if (this.ended || this.isPaused) return;
        const dt = Math.min(0.05, delta / 1000);

        if (!this.isTeleporting) {
            if (this.inBurrowPeek) {
                this._updateBurrowPeek(time);
            } else {
                this._updatePlayerMovement(dt, time);
            }
        }

        this._updateFollowers(time);
        this._updateDynamicActionButton(time);
        this._updatePickups(time);
        this._updateMonsters(dt, time);
    }

    _updateBurrowPeek(time) {
        const leftSec = Math.max(0, (this.burrowPeekUntil - time) / 1000);
        this.playerStatusBadge
            .setPosition(this.player.x, this.player.y - 38)
            .setText(`👀 В НОРКЕ (${leftSec.toFixed(1)}с) — НЕВИДИМА!`)
            .setVisible(true);

        if (this.cursors && this.wasd) {
            let kx = 0;
            let ky = 0;
            if (this.cursors.left.isDown || this.wasd.left.isDown) kx -= 1;
            if (this.cursors.right.isDown || this.wasd.right.isDown) kx += 1;
            if (this.cursors.up.isDown || this.wasd.up.isDown) ky -= 1;
            if (this.cursors.down.isDown || this.wasd.down.isDown) ky += 1;
            if (kx !== 0 || ky !== 0) {
                this.popOutOfBurrow(kx, ky);
                return;
            }
        }

        if (time >= this.burrowPeekUntil) {
            this.popOutOfBurrow();
        }
    }

    _updatePlayerMovement(dt, time) {
        let vx = this.joyVec ? this.joyVec.x : 0;
        let vy = this.joyVec ? this.joyVec.y : 0;

        if (this.cursors && this.wasd) {
            let kx = 0;
            let ky = 0;
            if (this.cursors.left.isDown || this.wasd.left.isDown) kx -= 1;
            if (this.cursors.right.isDown || this.wasd.right.isDown) kx += 1;
            if (this.cursors.up.isDown || this.wasd.up.isDown) ky -= 1;
            if (this.cursors.down.isDown || this.wasd.down.isDown) ky += 1;
            if (kx !== 0 || ky !== 0) {
                const len = Math.hypot(kx, ky);
                vx = kx / len;
                vy = ky / len;
            }
        }

        let speed = PLAYER_BASE_SPEED * (this.skinSpeedMul || 1);
        if (this.runPerks.speed_skates) speed *= 1.25;
        if (time < this.activeBoosters.turbo) speed *= 1.42;
        if (time < this.dashUntil) speed *= DASH_SPEED_MUL;

        this.playerVel.x = vx * speed;
        this.playerVel.y = vy * speed;

        if (Math.hypot(vx, vy) > 0.08) {
            const len = Math.hypot(vx, vy);
            this.playerFacing.x = vx / len;
            this.playerFacing.y = vy / len;
        }

        const nx = this.player.x + this.playerVel.x * dt;
        const ny = this.player.y + this.playerVel.y * dt;

        if (this._canWalkAt(nx, this.player.y, PLAYER_RADIUS)) this.player.x = nx;
        if (this._canWalkAt(this.player.x, ny, PLAYER_RADIUS)) this.player.y = ny;

        const lastPt = this.playerTrail[this.playerTrail.length - 1];
        if (!lastPt || Math.hypot(this.player.x - lastPt.x, this.player.y - lastPt.y) >= 4) {
            this.playerTrail.push({ x: this.player.x, y: this.player.y });
            if (this.playerTrail.length > 90) this.playerTrail.shift();
        }

        const moving = Math.hypot(this.playerVel.x, this.playerVel.y) > 12;
        if (moving) {
            if (this.playerVel.y < -45 && Math.abs(this.playerVel.y) > Math.abs(this.playerVel.x)) {
                this.player.setTexture(this.playerTexBack);
            } else {
                const frame = Math.floor(time / 110) % 2 === 0 ? this.playerTexWalk1 : this.playerTexWalk2;
                this.player.setTexture(frame);
            }
            if (Math.abs(this.playerVel.x) > 8) {
                this.player.setFlipX(this.playerVel.x < 0);
            }
        } else {
            this.player.setTexture(this.playerTexFront);
        }

        this.inShadow = this._isInsideShadowCushion(this.player.x, this.player.y);
        const hasCloak = time < this.activeBoosters.cloak;
        const isHidden = this.inShadow || hasCloak;

        this.player.setAlpha(isHidden ? 0.52 : 1.0);
        this.playerHalo.setPosition(this.player.x, this.player.y + 10);
        this.playerHalo.setStrokeStyle(2.5, isHidden ? 0xc084fc : 0x38bdf8, 0.9);

        if (hasCloak) {
            const sec = ((this.activeBoosters.cloak - time) / 1000).toFixed(1);
            this.playerStatusBadge.setPosition(this.player.x, this.player.y - 38)
                .setText(`🧥 НЕВИДИМКА ${sec}с`)
                .setVisible(true);
        } else if (this.inShadow) {
            this.playerStatusBadge.setPosition(this.player.x, this.player.y - 38)
                .setText('🐾 В ТЕНИ')
                .setVisible(true);
        } else {
            this.playerStatusBadge.setVisible(false);
        }

        if (this.exitUnlocked) {
            const dExit = Math.hypot(this.player.x - this.exitPos.x, this.player.y - this.exitPos.y);
            if (dExit <= this.exitPos.r) {
                this.onFloorCleared();
            }
        }
    }

    _updateDynamicActionButton(time) {
        const iconEl = document.getElementById('sneak-burrow-icon');
        const labelEl = document.getElementById('sneak-burrow-label');
        const btnEl = document.getElementById('sneak-btn-burrow');
        if (!iconEl || !labelEl || !btnEl) return;

        if (this.inBurrowPeek) {
            iconEl.textContent = '🚀';
            labelEl.textContent = 'ПРЫГ!';
            btnEl.style.background = 'radial-gradient(circle at 38% 30%, #6ee7b7 0%, #10b981 48%, #047857 90%)';
            return;
        }

        const nearH = this.nearestHoleAt(this.player.x, this.player.y);
        if (nearH && nearH.dist <= HOLE_TRIGGER_RADIUS) {
            iconEl.textContent = '🕳️';
            labelEl.textContent = 'В НОРУ!';
            btnEl.style.background = 'radial-gradient(circle at 38% 30%, #fde047 0%, #eab308 48%, #a16207 90%)';
        } else {
            const ready = time >= this.dashCooldownUntil;
            iconEl.textContent = '💨';
            labelEl.textContent = ready ? 'КУВЫРОК' : 'ЖДИ...';
            btnEl.style.background = ready
                ? 'radial-gradient(circle at 38% 30%, #7dd3fc 0%, #0ea5e9 48%, #0369a1 90%)'
                : 'radial-gradient(circle at 38% 30%, #64748b 0%, #334155 85%)';
        }
    }

    _updatePickups(time) {
        const magnetActive = time < this.activeBoosters.magnet || !!this.runPerks.cheese_magnet;
        const magnetRange = magnetActive ? 220 : 0;

        for (const c of this.crumbNodes) {
            if (c.taken) continue;
            const d = Math.hypot(this.player.x - c.wx, this.player.y - c.wy);
            if (magnetRange > 0 && d < magnetRange && d > 26) {
                c.wx += ((this.player.x - c.wx) / d) * 7.5;
                c.wy += ((this.player.y - c.wy) / d) * 7.5;
                c.sp.setPosition(c.wx, c.wy);
            }
            if (d <= 32) {
                c.taken = true;
                const gain = Math.max(1, Math.round(c.value * this.streak));
                this.carriedCheese += gain;
                bus.emit(SFX.CHEESE);
                this._playMusicalChime([659.25, 880], 0.04, 'sine');
                this._spawnFloatingSticker(c.wx, c.wy, `+${gain} 🧀`, '#fde047');
                c.sp.destroy();
                this._refreshHud();
            }
        }

        for (const p of this.pieNodes) {
            if (p.taken) continue;
            if (Math.hypot(this.player.x - p.wx, this.player.y - p.wy) <= 34) {
                p.taken = true;
                this.piesLeft = Math.min(9, this.piesLeft + 1);
                bus.emit(SFX.PICKUP);
                this._playMusicalChime([523.25, 783.99], 0.06, 'triangle');
                this._spawnFloatingSticker(p.wx, p.wy, '+1 🎂 ТОРТ!', '#f9a8d4');
                p.glow.destroy();
                p.sp.destroy();
                this._refreshHud();
            }
        }

        for (const b of this.boosterNodes) {
            if (b.taken) continue;
            if (Math.hypot(this.player.x - b.wx, this.player.y - b.wy) <= 34) {
                b.taken = true;
                this.activeBoosters[b.type] = time + b.durationMs;
                bus.emit(SFX.HEART);
                this._playMusicalChime([523.25, 659.25, 783.99, 1046.5], 0.07, 'triangle');
                this._spawnFloatingSticker(b.wx, b.wy, b.label, '#6ee7b7');
                b.ring.destroy();
                b.icon.destroy();
            }
        }

        if (this.secretChest && !this.secretChest.opened) {
            const sc = this.secretChest;
            if (Math.hypot(this.player.x - sc.wx, this.player.y - sc.wy) <= 40) {
                sc.opened = true;
                const gain = Math.round(sc.value * this.streak);
                this.carriedCheese += gain;
                this.piesLeft = Math.min(9, this.piesLeft + 1);
                this.streak = Math.min(3.0, +(this.streak + 0.35).toFixed(2));
                if (this.textures.exists('chest_open')) sc.sp.setTexture('chest_open');
                sc.badge.setText(`✨ +${gain} 🧀 & 🎂!`);
                bus.emit(SFX.CHEST);
                this._playMusicalChime([523.25, 659.25, 783.99, 1046.5, 1318.5], 0.08, 'triangle');
                this._spawnFloatingSticker(sc.wx, sc.wy, `🎁 СУПЕР-ТАЙНИК! +${gain} 🧀`, '#facc15');
                this._refreshHud();
            }
        }

        for (const pet of this.petTargets) {
            if (pet.taken) continue;
            if (Math.hypot(this.player.x - pet.wx, this.player.y - pet.wy) <= 42) {
                pet.taken = true;
                this.rescuedPetsCount++;
                this.totalRescuedInRun++;

                const gain = Math.round(pet.value * this.streak);
                this.carriedCheese += gain;
                this.streak = Math.min(3.0, +(this.streak + 0.25).toFixed(2));

                pet.padGlow.destroy();
                pet.bubble.destroy();
                pet.bubbleShine.destroy();
                pet.petSprite.destroy();
                pet.label.destroy();

                this._addRescuedFollower(pet);

                bus.emit(SFX.KEY);
                this._playMusicalChime([587.33, 783.99, 987.77, 1174.66], 0.08, 'triangle');
                this._spawnFloatingSticker(
                    pet.wx,
                    pet.wy,
                    `${pet.petDef.badge} ${pet.petDef.thanksText} +${gain} 🧀`,
                    '#f9a8d4'
                );
                this._refreshHud();

                if (this.rescuedPetsCount >= this.totalPetsToRescue) {
                    this._unlockEscapePortal();
                }
            }
        }
    }

    // =========================================================================
    // MONSTER AI, VISION CONES & 3-HEART SMOKE-BOMB ESCAPE
    // =========================================================================

    _updateMonsters(dt, time) {
        this.visionGraphics.clear();

        const playerHidden =
            this.inBurrowPeek ||
            this.isTeleporting ||
            this.inShadow ||
            time < this.activeBoosters.cloak ||
            time < this.invulnerableUntil;

        for (const m of this.monsters) {
            if (m.state === 'blinded' || m.state === 'stunned') {
                m.stateTimerMs -= dt * 1000;
                m.sprite.setAngle(Math.sin(time / 55) * 14);
                if (m.stateTimerMs <= 0) {
                    m.state = 'patrol';
                    m.sprite.setAngle(0).clearTint();
                    m.badge.setVisible(false);
                }
            } else if (m.state === 'distracted' && m.distractTarget) {
                m.stateTimerMs -= dt * 1000;
                this._stepMonsterToward(m, m.distractTarget.x, m.distractTarget.y, m.cfg.speed * 0.95, dt, time);
                if (m.stateTimerMs <= 0) {
                    m.state = 'patrol';
                    m.distractTarget = null;
                    m.badge.setVisible(false);
                }
            } else {
                const wp = m.cfg.patrol[m.patrolIdx];
                const tx = (wp.x + 0.5) * this.room.cell;
                const ty = (wp.y + 0.5) * this.room.cell;

                if (m.waitLeftMs > 0) {
                    m.waitLeftMs -= dt * 1000;
                } else {
                    const arrived = this._stepMonsterToward(m, tx, ty, m.cfg.speed, dt, time);
                    if (arrived) {
                        m.waitLeftMs = wp.waitMs || 350;
                        m.patrolIdx = (m.patrolIdx + 1) % m.cfg.patrol.length;
                    }
                }

                if (m.suspicion === 0 && time >= m.nextQuipAt) {
                    m.nextQuipAt = time + 4800 + Math.random() * 4000;
                    const lines = m.cfg.def.idleLines || ['Хм-м...'];
                    const line = lines[Math.floor(Math.random() * lines.length)];
                    m.badge.setText(line).setColor('#e2e8f0').setVisible(true);
                    this.time.delayedCall(1500, () => {
                        if (m.state === 'patrol' && m.suspicion === 0) m.badge.setVisible(false);
                    });
                }
            }

            m.shadow.setPosition(m.x, m.y + 22);
            m.badge.setPosition(m.x, m.y - 44);

            if (m.state !== 'blinded' && m.state !== 'stunned') {
                const seesPlayer = !playerHidden && this._canMonsterSeePlayer(m);
                const coneCol = m.suspicion > 0.25 ? m.cfg.def.alertColor : m.cfg.def.coneColor;
                const coneAlpha = 0.16 + m.suspicion * 0.22;
                this._drawVisionCone(m.x, m.y, m.facing, m.cfg.coneAngle, m.cfg.coneRange, coneCol, coneAlpha);

                if (seesPlayer) {
                    const fillRate = (this.skinStealthMul || 1);
                    m.suspicion = Math.min(1, m.suspicion + ((dt * 1000) / SUSPICION_FILL_MS) * fillRate);
                    this.seenOnThisFloor = true;
                    this.everSeenInRun = true;
                    const stepTowardPlayer = m.cfg.speed * (0.65 + 0.5 * m.suspicion);
                    this._stepMonsterToward(m, this.player.x, this.player.y, stepTowardPlayer, dt, time);
                    m.badge.setText(m.suspicion > 0.65 ? '❗ ДЕРЖИ ЕЁ!' : '👀 Ага! Мышка!')
                        .setColor('#fca5a5')
                        .setVisible(true);
                } else if (m.suspicion > 0) {
                    m.suspicion = Math.max(0, m.suspicion - (dt * 1000) / SUSPICION_DECAY_MS);
                    if (m.suspicion === 0 && m.state === 'patrol') {
                        m.badge.setVisible(false);
                    }
                }

                const distToPlayer = Math.hypot(m.x - this.player.x, m.y - this.player.y);
                if (!playerHidden && (m.suspicion >= 1 || distToPlayer <= CATCH_DIST)) {
                    this.onPlayerCaughtBy(m);
                    return;
                }
            }
        }
    }

    _stepMonsterToward(m, tx, ty, speed, dt, time) {
        const dx = tx - m.x;
        const dy = ty - m.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= 4) {
            m.x = tx;
            m.y = ty;
            m.sprite.setPosition(m.x, m.y);
            return true;
        }
        const step = Math.min(dist, speed * dt);
        m.x += (dx / dist) * step;
        m.y += (dy / dist) * step;
        m.facing = Math.atan2(dy, dx);

        const bob = Math.sin(time / 105) * 3;
        m.sprite.setPosition(m.x, m.y + bob);
        if (Math.abs(dx) > 2) {
            m.sprite.setFlipX(dx > 0);
        }
        return false;
    }

    _canMonsterSeePlayer(m) {
        const dx = this.player.x - m.x;
        const dy = this.player.y - m.y;
        const dist = Math.hypot(dx, dy);
        if (dist > m.cfg.coneRange) return false;

        const halfRad = (m.cfg.coneAngle * Math.PI) / 360;
        const angleToPlayer = Math.atan2(dy, dx);
        const diff = Math.atan2(Math.sin(angleToPlayer - m.facing), Math.cos(angleToPlayer - m.facing));
        if (Math.abs(diff) > halfRad) return false;

        const steps = Math.max(4, Math.ceil(dist / 22));
        for (let i = 1; i < steps; i++) {
            const sx = m.x + (dx * i) / steps;
            const sy = m.y + (dy * i) / steps;
            if (!this._isWalkableCellAtWorld(sx, sy)) return false;
        }
        return true;
    }

    _drawVisionCone(ox, oy, facing, coneAngleDeg, range, color, alpha) {
        const halfRad = (coneAngleDeg * Math.PI) / 360;
        const rays = 20;
        this.visionGraphics.fillStyle(color, alpha);
        this.visionGraphics.lineStyle(1.5, color, Math.min(0.85, alpha + 0.25));
        this.visionGraphics.beginPath();
        this.visionGraphics.moveTo(ox, oy);

        for (let i = 0; i <= rays; i++) {
            const a = facing - halfRad + (2 * halfRad * i) / rays;
            const cos = Math.cos(a);
            const sin = Math.sin(a);
            let r = range;
            for (let d = 20; d <= range; d += 18) {
                if (!this._isWalkableCellAtWorld(ox + cos * d, oy + sin * d)) {
                    r = d;
                    break;
                }
            }
            this.visionGraphics.lineTo(ox + cos * r, oy + sin * r);
        }
        this.visionGraphics.closePath();
        this.visionGraphics.fillPath();
        this.visionGraphics.strokePath();
    }

    onPlayerCaughtBy(monster) {
        if (this.ended) return;
        this.hearts = Math.max(0, this.hearts - 1);
        this.streak = 1.0;
        bus.emit(SFX.CAUGHT);
        this.cameras.main.shake(240, 0.012);
        this._refreshHud();

        if (this.hearts > 0) {
            this.invulnerableUntil = this.time.now + 2400;
            this._spawnFloatingSticker(this.player.x, this.player.y, '💨 ДЫМОВАЯ БОМБА!', '#cbd5e1');

            for (const m of this.monsters) {
                m.suspicion = 0;
                m.state = 'stunned';
                m.stateTimerMs = 2400;
                m.badge.setText('💨 Апчхи! Где мышка?!').setVisible(true);
            }

            const sx = (this.room.entry.x + 0.5) * this.room.cell;
            const sy = (this.room.entry.y + 0.5) * this.room.cell;
            this.player.setPosition(sx, sy);
            this.playerHalo.setPosition(sx, sy + 10);
            this.playerTrail = [{ x: sx, y: sy }];
            this._showToast(`💨 Спаслась дымовой шашкой! Осталось сердечек: ${this.hearts}`, '#fca5a5');
            return;
        }

        this.ended = true;
        const kept = Math.floor(this.carriedCheese * 0.8);
        Progress.recordSneakCaught({
            roomIndex: this.floor - 1,
            floor: this.floor,
            keptCheese: kept
        });
        this._showGameOverModal(monster, kept);
    }

    // =========================================================================
    // CRISP HTML MODALS: FLOOR CLEARED PERK PICKER, PAUSE & GAME OVER
    // =========================================================================

    onFloorCleared() {
        if (this.ended) return;
        this.ended = true;

        const floorBonus = 15 + this.floor * 5;
        const stealthBonus = this.seenOnThisFloor ? 0 : 12;
        const earned = floorBonus + stealthBonus;
        this.carriedCheese += earned;
        this._refreshHud();

        Progress.recordSneakClear({
            floor: this.floor,
            totalCheese: earned,
            everSeen: this.everSeenInRun
        });

        bus.emit(SFX.VICTORY);
        this._playMusicalChime([523.25, 659.25, 783.99, 1046.5, 1318.5], 0.09, 'triangle');

        const modalRoot = document.getElementById('sneak-modal-root');
        if (!modalRoot) return;

        const shuffled = [...RUN_PERKS].sort(() => Math.random() - 0.5).slice(0, 3);
        modalRoot.innerHTML = `
            <div class="sneak-modal-card">
                <div style="font-weight:900;font-size:min(5vw, 22px);color:#fef08a;">
                    🌈 ЭТАЖ ${this.floor} ПРОЙДЕН! +${earned} 🧀
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

        const exitBtn = document.getElementById('sneak-bank-exit-btn');
        if (exitBtn) {
            exitBtn.addEventListener('click', () => {
                bus.emit(SFX.CLICK);
                this._exitToCastleMenu();
            });
        }
    }

    _applyChosenPerkAndAdvance(perk) {
        const nextPerks = { ...this.runPerks, [perk.id]: (this.runPerks[perk.id] || 0) + 1 };
        let nextHearts = this.hearts;
        let nextCheese = this.carriedCheese;
        let nextPies = this.piesLeft;

        if (perk.id === 'extra_heart') {
            nextHearts = this.maxHearts;
            nextCheese += 15;
        } else if (perk.id === 'cake_factory') {
            nextPies = Math.min(9, nextPies + 2);
        }

        this.scene.restart({
            floor: this.floor + 1,
            carriedCheese: nextCheese,
            totalRescuedInRun: this.totalRescuedInRun,
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
                    Спасено пушистиков: <b>${this.totalRescuedInRun} 🐾</b><br>
                    Сохранено в банк (80%): <b style="color:#facc15;">+${keptCheese} 🧀</b>
                </div>
                <div style="display:flex;flex-direction:column;gap:8px;">
                    <button class="sneak-action-btn" id="sneak-retry-btn" style="background:linear-gradient(180deg,#10b981,#059669);">
                        🔄 НОВАЯ ОПЕРАЦИЯ (ЭТАЖ 1)
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
        this._unmountDomControls();
        bus.emit('bgm_stop');
        window.location.replace('transylvania-menu.html');
    }

    // =========================================================================
    // GEOMETRY & AUDIO HELPERS
    // =========================================================================

    _findIslandAtWorld(wx, wy) {
        const gx = Math.floor(wx / this.room.cell);
        const gy = Math.floor(wy / this.room.cell);
        for (const isl of this.room.islands) {
            if (gx >= isl.x1 && gx <= isl.x2 && gy >= isl.y1 && gy <= isl.y2) {
                return isl;
            }
        }
        return null;
    }

    _isWalkableCellAtWorld(wx, wy) {
        const gx = Math.floor(wx / this.room.cell);
        const gy = Math.floor(wy / this.room.cell);
        if (gy < 0 || gy >= this.room.H || gx < 0 || gx >= this.room.W) return false;
        return this.room.grid[gy][gx] !== '#';
    }

    _canWalkAt(wx, wy, r) {
        return (
            this._isWalkableCellAtWorld(wx - r, wy - r) &&
            this._isWalkableCellAtWorld(wx + r, wy - r) &&
            this._isWalkableCellAtWorld(wx - r, wy + r) &&
            this._isWalkableCellAtWorld(wx + r, wy + r)
        );
    }

    _isInsideShadowCushion(wx, wy) {
        for (const sr of this.shadowRects) {
            if (Math.hypot(wx - sr.x, wy - sr.y) <= sr.r) return true;
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
