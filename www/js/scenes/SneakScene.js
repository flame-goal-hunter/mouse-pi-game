// ============================================
// SNEAK SCENE — режим «Тихая лапка».
// Отдельная сцена: DungeonScene не изменяется.
// ============================================

import { Progress } from '../storage/ProgressStore.js';
import { bus } from '../audio/EventBus.js';
import { SFX, BGM } from '../audio/SoundKeys.js';
import { preloadAudio } from '../audio/AudioManager.js';
import { SNEAK } from '../sneak/SneakMetrics.js';
import { TEMPLATES, BEATS } from '../sneak/templates/index.js';
import { assembleNight } from '../sneak/NightAssembler.js';
import { isFloor, inCone } from '../sneak/RoomTemplate.js';
import { positionAt } from '../sneak/PatrolCycle.js';
import { cheeseOnCapture, nightReward } from '../sneak/SneakEconomy.js';

const CELL = SNEAK.CELL;
const DEPTH = { FLOOR: 10, FLOOR_MARK: 14, PROP: 40, HOLE: 45, PLAYER: 60, MONSTER: 62, CONE: 55, HUD: 900 };

export class SneakScene extends Phaser.Scene {
    constructor() { super({ key: 'SneakScene' }); }

    init(data) {
        // Каждое поле сбрасывается здесь — сцена переиспользуется между ночами.
        this.roomIndex = data?.roomIndex || 0;
        this.cheeseThisNight = data?.cheeseThisNight || 0;
        this.pies = data?.pies ?? SNEAK.PIES_MIN;
        this.everSeen = data?.everSeen || false;
        this.winded = data?.winded || false;
        this.windedUntil = data?.windedUntil || 0;
        this.night = assembleNight(TEMPLATES, BEATS);
        this.room = this.night[this.roomIndex];
        this.tpl = this.room.template;
        this.state = 'play';
        this.holdMs = 0;
        this.holdArmed = true;
        // Отрисовываются лениво в updateHoleHold/drawSuspicion — без сброса здесь
        // они остались бы указывать на графику, уничтоженную прошлым restart().
        this.holdRing = null;
        this.susBar = null;
        this.monster = null;
        this.player = null;
        this.hudPies = null;
        this.hudCheese = null;
        this.hudRoom = null;
    }

    preload() {
        preloadAudio(this);
        // Пути и размеры совпадают с DungeonScene:285-309 — Phaser пропускает
        // ключи, уже лежащие в кэше, поэтому повторная загрузка бесплатна.
        const base = 'assets/characters/transylvania/';
        this.load.svg('d_pi',  base + 'pi.svg',  { width: 150, height: 172 });
        this.load.svg('d_cat', base + 'cat.svg', { width: 165, height: 150 });
    }

    create() {
        this.viewW = this.scale.width;
        this.viewH = this.scale.height;
        this.cameras.main.setBackgroundColor('#0b0616');

        this.drawRoom();
        this.setupCamera();
        this.drawPatrolRoute();
        this.spawnPlayer();
        this.spawnMonster();

        // Вторая, незумленная камера — для стика и HUD. Копит список уже
        // существующих игровых объектов и игнорирует их: иначе она бы
        // рисовала всю комнату повторно поверх зумленной главной камеры.
        const worldObjects = this.children.list.slice();
        this.uiCam = this.cameras.add(0, 0, this.viewW, this.viewH);
        this.uiCam.ignore(worldObjects);

        this.setupTouch();
        this.buildHud();

        this.cursors = this.input.keyboard.createCursorKeys();

        // Правая половина экрана — бросок. Левая — стик (setupTouch).
        // Граница задаётся сразу, чтобы обработчики не конфликтовали.
        this.input.on('pointerdown', (p) => {
            if (this.state !== 'play' || p.x <= this.viewW / 2) return;
            const wp = this.cameras.main.getWorldPoint(p.x, p.y);
            this._pieDownAt = this.time.now;
            this._pieId = p.id;
            this._pieTarget = { x: wp.x, y: wp.y };
        });
        this.input.on('pointerup', (p) => {
            if (this.state !== 'play' || !this._pieTarget || p.id !== this._pieId) return;
            const held = this.time.now - this._pieDownAt;
            if (held > 500) this.eatPie();
            else this.throwPie(this._pieTarget.x, this._pieTarget.y);
            this._pieTarget = null;
            this._pieId = null;
        });
    }

    setupTouch() {
        this.joy = { active: false, id: null, baseX: 0, baseY: 0, dx: 0, dy: 0 };
        const R = 60;

        this.joyBase = this.add.circle(0, 0, R, 0xd8a850, 0.14)
            .setScrollFactor(0).setDepth(DEPTH.HUD).setVisible(false);
        this.joyKnob = this.add.circle(0, 0, R * 0.42, 0xd8a850, 0.5)
            .setScrollFactor(0).setDepth(DEPTH.HUD + 1).setVisible(false);
        // Стик рисуется в экранных пикселях через uiCam — на зумленной
        // главной камере он оказался бы не под пальцем и не того размера.
        this.cameras.main.ignore([this.joyBase, this.joyKnob]);

        this.input.addPointer(2);

        this.input.on('pointerdown', (p) => {
            if (p.x > this.viewW / 2 || this.joy.active) return;
            this.joy.active = true;
            this.joy.id = p.id;
            this.joy.baseX = p.x;
            this.joy.baseY = p.y;
            this.joyBase.setPosition(p.x, p.y).setVisible(true);
            this.joyKnob.setPosition(p.x, p.y).setVisible(true);
        });

        this.input.on('pointermove', (p) => {
            if (!this.joy.active || p.id !== this.joy.id) return;
            let dx = p.x - this.joy.baseX;
            let dy = p.y - this.joy.baseY;
            const d = Math.hypot(dx, dy);
            const DEAD = 8;
            if (d < DEAD) { this.joy.dx = 0; this.joy.dy = 0; }
            else {
                const clamped = Math.min(d, R);
                this.joy.dx = (dx / d) * (clamped / R);
                this.joy.dy = (dy / d) * (clamped / R);
            }
            this.joyKnob.setPosition(
                this.joy.baseX + this.joy.dx * R,
                this.joy.baseY + this.joy.dy * R,
            );
        });

        this.input.on('pointerup', (p) => {
            if (!this.joy.active || p.id !== this.joy.id) return;
            this.joy.active = false;
            this.joy.id = null;
            this.joy.dx = 0;
            this.joy.dy = 0;
            this.joyBase.setVisible(false);
            this.joyKnob.setVisible(false);
        });
    }

    buildHud() {
        this.hudPies = this.add.text(14, 12, '', {
            fontFamily: 'Nunito, sans-serif', fontSize: '18px', color: '#f0c060',
        }).setScrollFactor(0).setDepth(DEPTH.HUD + 5);

        this.hudCheese = this.add.text(14, 36, '', {
            fontFamily: 'Nunito, sans-serif', fontSize: '18px', color: '#ffd040',
        }).setScrollFactor(0).setDepth(DEPTH.HUD + 5);

        this.hudRoom = this.add.text(this.viewW - 14, 12, '', {
            fontFamily: 'Nunito, sans-serif', fontSize: '14px', color: '#a090b8',
        }).setOrigin(1, 0).setScrollFactor(0).setDepth(DEPTH.HUD + 5);

        this.cameras.main.ignore([this.hudPies, this.hudCheese, this.hudRoom]);

        this.updateHud();
    }

    updateHud() {
        this.hudPies.setText(`🥧 ${this.pies}`);
        this.hudCheese.setText(`🧀 ${this.cheeseThisNight}`);
        this.hudRoom.setText(`Комната ${this.roomIndex + 1}/${this.night.length}`);
    }

    drawRoom() {
        const g = this.add.graphics().setDepth(DEPTH.FLOOR);
        for (let y = 0; y < this.tpl.grid.length; y++) {
            for (let x = 0; x < this.tpl.grid[y].length; x++) {
                const px = x * CELL;
                const py = y * CELL;
                if (isFloor(this.tpl, x, y)) {
                    g.fillStyle(((x + y) % 2 === 0) ? 0x1a1030 : 0x1e1436, 1);
                    g.fillRect(px, py, CELL, CELL);
                } else {
                    g.fillStyle(0x4a3568, 1);
                    g.fillRect(px, py, CELL, CELL);
                    // Светлая верхняя грань даёт стене высоту.
                    g.fillStyle(0x6a4d90, 1);
                    g.fillRect(px, py, CELL, 4);
                }
            }
        }

        // Норы — подсвечены всегда (правило доступности из спеки).
        this.holes = [];
        for (const h of this.tpl.holes) {
            for (const mouth of [h.a, h.b]) {
                const cx = (mouth.x + 0.5) * CELL;
                const cy = (mouth.y + 0.5) * CELL;
                const circ = this.add.circle(cx, cy, CELL * 0.32, 0x000000, 1).setDepth(DEPTH.HOLE);
                const glow = this.add.circle(cx, cy, CELL * 0.42, 0xd8a850, 0.22).setDepth(DEPTH.HOLE - 1);
                this.tweens.add({ targets: glow, alpha: 0.38, duration: 900, yoyo: true, repeat: -1 });
                this.holes.push({ x: cx, y: cy, pair: h, mouth, circ, glow });
            }
        }

        // Выход — последний элемент exits; вход это первый.
        const ex = this.tpl.exits[this.tpl.exits.length - 1];
        this.exitPoint = { x: (ex.x + 0.5) * CELL, y: (ex.y + 0.5) * CELL };
        this.exitDisc = this.add.circle(this.exitPoint.x, this.exitPoint.y, CELL * 0.4, 0x80ff80, 0.35)
            .setDepth(DEPTH.PROP);
        this.spawnPrize();

        // Реквизит: сыр и пироги подбираются, остальное декоративно.
        this.pickups = [];
        for (const p of this.tpl.props) {
            if (p.type !== 'cheese' && p.type !== 'pie') continue;
            const cx = (p.x + 0.5) * CELL;
            const cy = (p.y + 0.5) * CELL;
            const col = p.type === 'cheese' ? 0xffd040 : 0xf0c060;
            const spr = this.add.circle(cx, cy, 9, col, 1).setDepth(DEPTH.PROP);
            this.pickups.push({ type: p.type, x: cx, y: cy, spr, taken: false });
        }
    }

    // Finding 26: rooms had no goal but a green circle, so the honest verdict was
    // 'просто мимо пробегаешь'. Every room holds a prize under the guard's nose and
    // the way out stays shut until it is lifted.
    spawnPrize() {
        // The prize sits at the far end of the patrol route, or the corner furthest
        // from the exit — guarded by construction either way.
        let best = null, bestD = -1;
        const cand = [];
        if (Array.isArray(this.tpl.patrol)) {
            for (const q of this.tpl.patrol) cand.push({ x: (q.x + 0.5) * CELL, y: (q.y + 0.5) * CELL });
        }
        for (let r = 0; r < this.tpl.grid.length; r++) {
            const row = this.tpl.grid[r];
            for (let c = 0; c < row.length; c++) {
                if (row[c] === '.') cand.push({ x: (c + 0.5) * CELL, y: (r + 0.5) * CELL });
            }
        }
        // Furthest from the exit is usually the entrance, i.e. where Pi is standing —
        // he would pocket it on the first frame. Take the cell that is far from BOTH.
        const en = this.tpl.exits[0];
        const entry = { x: (en.x + 0.5) * CELL, y: (en.y + 0.5) * CELL };
        for (const q of cand) {
            const dExit = Math.hypot(q.x - this.exitPoint.x, q.y - this.exitPoint.y);
            const dEntry = Math.hypot(q.x - entry.x, q.y - entry.y);
            if (dEntry < CELL * 2.5) continue;             // never in Pi's lap
            const d = Math.min(dExit, dEntry);
            if (d > bestD) { bestD = d; best = q; }
        }
        if (!best) { this.prize = null; return; }
        const glow = this.add.circle(best.x, best.y, 20, 0xffd040, 0.28).setDepth(DEPTH.PROP - 1);
        const spr = this.add.image(best.x, best.y, 'd_cheese').setDisplaySize(30, 25).setDepth(DEPTH.PROP);
        this.tweens.add({ targets: glow, scale: 1.5, alpha: 0.1,
            duration: 950, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.prize = { x: best.x, y: best.y, spr, glow, taken: false };
        this.exitDisc.setFillStyle(0xff6060, 0.22);   // shut until the prize is lifted
    }

    // Камера идёт за Пи и не мельчит: маршрут патруля показан линией на полу,
    // а не тем, что комната втиснута в экран целиком (находка 28 реестра).
    setupCamera() {
        const w = this.tpl.grid[0].length * CELL;
        const h = this.tpl.grid.length * CELL;
        const pad = 24;
        const fit = Math.min((this.viewW - pad * 2) / w, (this.viewH - pad * 2) / h, 1.6);
        const cam = this.cameras.main;
        // Never below 1:1 — that is what made everything tiny on a phone.
        cam.setZoom(Math.max(1.0, Math.min(1.6, fit * 1.6)));
        cam.setBounds(0, 0, w, h);
        cam.centerOn(w / 2, h / 2);
        this._camReady = true;
    }

    // The patrol route, drawn once as a dotted trail with a marker at each turn, so a
    // player can still read where the guard will be without zooming the world out.
    drawPatrolRoute() {
        if (!this.tpl.patrol || this.tpl.patrol.length < 2) return;
        const g = this.add.graphics().setDepth(DEPTH.FLOOR_MARK ?? 1);
        g.setAlpha(0.5);
        const pts = this.tpl.patrol.map(p => ({ x: (p.x + 0.5) * CELL, y: (p.y + 0.5) * CELL }));
        for (let i = 0; i < pts.length; i++) {
            const a = pts[i], b = pts[(i + 1) % pts.length];
            const dx = b.x - a.x, dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            const dots = Math.max(1, Math.round(len / 22));
            for (let k = 0; k < dots; k++) {
                const t = k / dots;
                g.fillStyle(0xe8b54a, 0.55);
                g.fillCircle(a.x + dx * t, a.y + dy * t, 2.4);
            }
            g.fillStyle(0xe8b54a, 0.9);
            g.fillCircle(a.x, a.y, 5);
        }
        this.patrolRouteGfx = g;
    }

    spawnPlayer() {
        const px = (this.tpl.entry.x + 0.5) * CELL;
        const py = (this.tpl.entry.y + 0.5) * CELL;
        this.player = { x: px, y: py, vx: 0, vy: 0, hidden: false };
        this.player.sprite = this.add.image(px, py, 'd_pi').setDepth(DEPTH.PLAYER).setScale(0.32);
        if (this._camReady) this.cameras.main.startFollow(this.player.sprite, true, 0.12, 0.12);
    }

    spawnMonster() {
        if (!this.tpl.patrol || this.tpl.patrol.length < 2) return;
        const start = positionAt(this.tpl.patrol, this.tpl.patrolSpeed, CELL, 0);
        this.monster = { t: 0, x: start.x, y: start.y, angle: start.angle, suspicion: 0, state: 'patrol' };
        this.monster.sprite = this.add.image(start.x, start.y, 'd_cat').setDepth(DEPTH.MONSTER).setScale(0.32);
        this.coneGfx = this.add.graphics().setDepth(DEPTH.CONE);
    }

    update(_time, dtMs) {
        const dt = Math.min(dtMs, 50) / 1000;
        if (this.state === 'squeeze') return;
        if (this.state !== 'play') return;
        if (this.winded && this.time.now > this.windedUntil) this.winded = false;
        const actionDown = this.cursors.space.isDown;
        this.updateHoleHold(dt, actionDown);
        if (this.holdMs === 0) this.updatePlayer(dt);
        this.updateMonster(dt);
        this.checkPickupsAndExit();
    }

    nearestHole() {
        let best = null;
        let bestD = Infinity;
        for (const h of this.holes) {
            const d = Math.hypot(h.x - this.player.x, h.y - this.player.y);
            if (d < bestD) { bestD = d; best = h; }
        }
        return bestD <= CELL * 0.9 ? best : null;
    }

    // Удержание кнопки действия HOLE_HOLD_MS у пасти норы.
    updateHoleHold(dt, actionDown) {
        if (!actionDown) this.holdArmed = true;
        const near = this.nearestHole();
        this._showHoleHint(near, actionDown);
        if (!near || !actionDown || this.player.hidden || !this.holdArmed) {
            this.holdMs = 0;
            if (this.holdRing) { this.holdRing.destroy(); this.holdRing = null; }
            return;
        }
        this.holdMs += dt * 1000;
        const t = Math.min(1, this.holdMs / SNEAK.HOLE_HOLD_MS);
        if (!this.holdRing) {
            this.holdRing = this.add.graphics().setDepth(DEPTH.HUD);
            this.uiCam.ignore(this.holdRing);
        }
        this.holdRing.clear();
        this.holdRing.lineStyle(3, 0xd8a850, 0.9);
        this.holdRing.beginPath();
        this.holdRing.arc(near.x, near.y, CELL * 0.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t);
        this.holdRing.strokePath();
        if (this.holdMs >= SNEAK.HOLE_HOLD_MS) this.enterHole(near);
    }

    enterHole(hole) {
        this.holdMs = 0;
        if (this.holdRing) { this.holdRing.destroy(); this.holdRing = null; }
        this.player.hidden = true;
        this.state = 'squeeze';
        this.holdArmed = false;
        bus.emit(SFX.PLAYER_DASH);
        const other = (hole.mouth === hole.pair.a) ? hole.pair.b : hole.pair.a;
        const tx = (other.x + 0.5) * CELL;
        const ty = (other.y + 0.5) * CELL;
        this.tweens.add({
            targets: this.player.sprite,
            x: tx, y: ty, scale: 0.18,
            duration: SNEAK.HOLE_SQUEEZE_MS,
            ease: 'Quad.easeInOut',
            onComplete: () => {
                this.player.x = tx;
                this.player.y = ty;
                this.player.sprite.setScale(0.32);
                this.player.hidden = false;
                this.state = 'play';
                if (this.monster && this.monster.state === 'chase') this.monsterLosesPlayer();
            },
        });
    }

    monsterLosesPlayer() {
        this.winded = true;
        this.windedUntil = this.time.now + 8000;
        this.monster.state = 'confused';
        this.monster.confusedUntil = this.time.now + SNEAK.HOLE_FORGET_MS;
        this.monster.suspicion = 0;
        this.showFloatingText(this.monster.x, this.monster.y - 40, '?', '#ffd040');
    }

    showFloatingText(x, y, text, color) {
        const t = this.add.text(x, y, text, {
            fontFamily: 'Nunito, sans-serif', fontSize: '22px', color,
        }).setOrigin(0.5).setDepth(DEPTH.HUD);
        this.uiCam.ignore(t);
        this.tweens.add({ targets: t, y: y - 36, alpha: 0, duration: 900, onComplete: () => t.destroy() });
    }

    throwPie(targetX, targetY) {
        if (this.pies <= 0 || this.state !== 'play') return;
        this.pies--;
        this.updateHud();
        bus.emit(SFX.FIRE_PIE);

        const startX = this.player.x;
        const startY = this.player.y;
        const pie = this.add.circle(startX, startY, 7, 0xf0c060, 1).setDepth(DEPTH.PROP);
        this.uiCam.ignore(pie);
        const dist = Math.hypot(targetX - startX, targetY - startY);

        // Отклик на собственное действие — то, чего не хватало боевым режимам.
        this.player.sprite.setScale(0.34, 0.30);
        this.tweens.add({ targets: this.player.sprite, scaleX: 0.32, scaleY: 0.32, duration: 100 });

        this.tweens.add({
            targets: pie,
            x: targetX, y: targetY,
            duration: Math.max(120, (dist / 580) * 1000),
            ease: 'Linear',
            onComplete: () => { pie.destroy(); this.pieLanded(targetX, targetY); },
        });
    }

    // A prompt at the mouth of a hole: nothing told the player it is a hold, not a tap.
    _showHoleHint(near, actionDown) {
        if (!near || this.player.hidden) {
            if (this.holeHint) { this.holeHint.destroy(); this.holeHint = null; this._hintFor = null; }
            return;
        }
        if (this.holeHint && this._hintFor === near) {
            this.holeHint.setAlpha(actionDown ? 0.35 : 1);
            return;
        }
        if (this.holeHint) this.holeHint.destroy();
        this._hintFor = near;
        this.holeHint = this.add.text(near.x, near.y - CELL * 0.75, 'ДЕРЖИ', {
            fontFamily: '"Nunito", sans-serif', fontStyle: '900', fontSize: '15px',
            color: '#1a0c2e', backgroundColor: '#e8b54a', padding: { x: 7, y: 3 },
        }).setOrigin(0.5, 1).setDepth(DEPTH.HUD);
        this.uiCam.ignore(this.holeHint);
        this.tweens.add({ targets: this.holeHint, y: near.y - CELL * 0.95,
            duration: 620, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    pieLanded(x, y) {
        const m = this.monster;
        // Роль 1: попадание в монстра — ослепление.
        if (m && Math.hypot(m.x - x, m.y - y) < CELL * 0.8) {
            m.state = 'confused';
            m.confusedUntil = this.time.now + SNEAK.PIE_BLIND_MS;
            m.suspicion = 0;
            this.showFloatingText(m.x, m.y - 40, 'НИЧЕГО НЕ ВИДНО!', '#ffd040');
            this._markBlinded(m);
            return;
        }
        // Роль 2: попадание в стену или пол — шум, монстр идёт на звук.
        if (m && m.state !== 'chase') {
            m.state = 'noise';
            m.noiseX = x;
            m.noiseY = y;
            m.noiseUntil = this.time.now + SNEAK.PIE_NOISE_MS;
            this.showFloatingText(x, y - 20, 'ШУМ — он пойдёт сюда', '#ffffff');
            this._markNoise(x, y);
        }
    }

    // Роль 3: удержание кнопки броска — съесть пирог, снять одышку.
    // A badge over a blinded guard, and a ring where the noise landed: without them
    // the pie's three jobs are invisible.
    _markBlinded(m) {
        const b = this.add.text(m.x, m.y - 58, '✖ ✖', {
            fontFamily: '"Nunito", sans-serif', fontStyle: '900', fontSize: '16px', color: '#ffd040',
        }).setOrigin(0.5).setDepth(DEPTH.HUD);
        this.uiCam.ignore(b);
        const until = m.confusedUntil;
        const tick = this.time.addEvent({ delay: 60, loop: true, callback: () => {
            if (!b.scene) { tick.remove(); return; }
            b.setPosition(m.x, m.y - 58);
            if (this.time.now > until || m.state !== 'confused') { b.destroy(); tick.remove(); }
        }});
    }

    _markNoise(x, y) {
        const g = this.add.graphics().setDepth(DEPTH.FLOOR_MARK);
        this.uiCam.ignore(g);
        g.lineStyle(3, 0xffffff, 0.8);
        g.strokeCircle(x, y, CELL * 0.3);
        this.tweens.add({ targets: g, alpha: 0, duration: SNEAK.PIE_NOISE_MS,
            onComplete: () => g.destroy() });
        this.tweens.add({ targets: { r: 0 }, r: 1, duration: 600, repeat: 1,
            onUpdate: (tw, t) => { g.clear(); g.lineStyle(3, 0xffffff, 0.8 * (1 - t.r));
                g.strokeCircle(x, y, CELL * (0.3 + t.r * 0.5)); } });
    }

    eatPie() {
        if (this.pies <= 0 || !this.winded) {
            if (!this.winded) this.showFloatingText(this.player.x, this.player.y - 30, 'не хочу', '#a090b8');
            return;
        }
        this.pies--;
        this.updateHud();
        this.winded = false;
        bus.emit(SFX.COLLECT_POWERUP);
        this.showFloatingText(this.player.x, this.player.y - 30, 'ням', '#80ff80');
    }

    updateMonster(dt) {
        const m = this.monster;
        if (!m) return;

        if (m.state === 'confused' && this.time.now > m.confusedUntil) m.state = 'patrol';

        if (m.state === 'patrol' || m.state === 'confused') {
            m.t += dt * 1000;
            const p = positionAt(this.tpl.patrol, this.tpl.patrolSpeed, CELL, m.t);
            m.x = p.x; m.y = p.y; m.angle = p.angle;
        } else if (m.state === 'noise') {
            // m.t не тикает всё время noise — маршрут патруля стоит на паузе.
            // Когда шум стихает, монстр не телепортируется на маршрут, а идёт
            // к точке, где он его покинул, и только там возвращается в 'patrol'.
            const overdue = this.time.now > m.noiseUntil;
            const target = overdue ? positionAt(this.tpl.patrol, this.tpl.patrolSpeed, CELL, m.t) : { x: m.noiseX, y: m.noiseY };
            const dx = target.x - m.x;
            const dy = target.y - m.y;
            const d = Math.hypot(dx, dy);
            if (overdue && d < CELL * 0.3) {
                m.state = 'patrol';
            } else {
                m.angle = Math.atan2(dy, dx);
                const step = this.tpl.patrolSpeed * dt;
                if (d > step) {
                    // The 'heading for the noise' branch ignored walls too
                    this.moveMonsterBy(m, (dx / d) * step, (dy / d) * step);
                } else {
                    m.x = target.x; m.y = target.y;
                }
            }
        } else if (m.state === 'chase') {
            this.chaseStep(dt);
        }

        // Подозрение растёт только когда игрок в конусе и не спрятан.
        const sees = !this.player.hidden && m.state !== 'confused'
            && inCone(this.player.x, this.player.y, m.x, m.y, m.angle, SNEAK.CONE_RANGE, SNEAK.CONE_ANGLE);
        if (sees) {
            m.suspicion = Math.min(1, m.suspicion + SNEAK.SUSPICION_RISE * dt);
            if (m.suspicion >= 1 && m.state !== 'chase') {
                m.state = 'chase';
                this.everSeen = true;
                bus.emit(SFX.TAKE_DAMAGE);
                this.showFloatingText(m.x, m.y - 40, '!', '#ff6060');
            }
        } else if (m.state !== 'chase') {
            m.suspicion = Math.max(0, m.suspicion - SNEAK.SUSPICION_FALL * dt);
        }

        m.sprite.setPosition(m.x, m.y);
        this.drawCone();
        this.drawSuspicion();

        if (m.state === 'chase' && !this.player.hidden
            && Math.hypot(m.x - this.player.x, m.y - this.player.y) < CELL * 0.7) {
            this.capture();
        }
    }

    // Монстр быстр по прямой и медлен в повороте — правило баланса режима.
    chaseStep(dt) {
        const m = this.monster;
        const dx = this.player.x - m.x;
        const dy = this.player.y - m.y;
        const want = Math.atan2(dy, dx);
        let delta = want - m.angle;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;

        const turning = Math.abs(delta) > 0.35;
        const speed = turning ? SNEAK.CHASE_TURN : SNEAK.CHASE_SPEED;
        const maxTurn = (Math.PI / (SNEAK.TURN_BRAKE_MS / 1000)) * dt;
        m.angle += Math.max(-maxTurn, Math.min(maxTurn, delta));

        this.moveMonsterBy(m, Math.cos(m.angle) * speed * dt, Math.sin(m.angle) * speed * dt);
    }

    // The monster gets the same wall check the player has had all along.
    moveMonsterBy(m, dx, dy) {
        const nx = m.x + dx, ny = m.y + dy;
        const cyOld = Math.floor(m.y / CELL);
        if (isFloor(this.tpl, Math.floor(nx / CELL), cyOld)) m.x = nx;
        const cxNew = Math.floor(m.x / CELL);
        if (isFloor(this.tpl, cxNew, Math.floor(ny / CELL))) m.y = ny;
        if (m.sprite) m.sprite.setPosition(m.x, m.y);
    }

    drawCone() {
        const m = this.monster;
        this.coneGfx.clear();
        if (m.state === 'confused') return;
        const half = SNEAK.CONE_ANGLE / 2;
        const alpha = m.state === 'chase' ? 0.30 : 0.16;
        this.coneGfx.fillStyle(m.state === 'chase' ? 0xff6060 : 0xd8a850, alpha);
        this.coneGfx.beginPath();
        this.coneGfx.moveTo(m.x, m.y);
        this.coneGfx.arc(m.x, m.y, SNEAK.CONE_RANGE, m.angle - half, m.angle + half);
        this.coneGfx.closePath();
        this.coneGfx.fillPath();
    }

    // Полоска подозрения над монстром — требование доступности: ребёнок
    // должен понимать, что происходит, а не угадывать.
    drawSuspicion() {
        const m = this.monster;
        if (!this.susBar) {
            this.susBar = this.add.graphics().setDepth(DEPTH.HUD);
            this.uiCam.ignore(this.susBar);
        }
        this.susBar.clear();
        if (m.suspicion <= 0.02) return;
        const w = 36;
        this.susBar.fillStyle(0x000000, 0.5);
        this.susBar.fillRect(m.x - w / 2, m.y - 46, w, 5);
        this.susBar.fillStyle(m.suspicion >= 1 ? 0xff6060 : 0xffd040, 1);
        this.susBar.fillRect(m.x - w / 2, m.y - 46, w * m.suspicion, 5);
    }

    capture() {
        if (this.state !== 'play') return;
        this.state = 'caught';
        bus.emit(SFX.TAKE_DAMAGE);
        this.cameras.main.shake(240, 0.012);

        const { lost, kept } = cheeseOnCapture(this.cheeseThisNight);
        Progress.recordSneakRun({ cleared: false, neverSeen: false, cheese: kept });

        this.showOutcome('ПОЙМАЛИ!', `Пи уронил ${lost} сыра и убежал домой.`, kept);
    }

    reachStairs() {
        if (this.state !== 'play') return;
        this.state = 'cleared';
        const reward = nightReward({
            collected: this.cheeseThisNight,
            tookLoot: true,
            neverSeen: !this.everSeen,
            firstClear: Progress.getSneakStats().clears === 0,
        });
        Progress.recordSneakRun({ cleared: true, neverSeen: !this.everSeen, cheese: reward.total });
        this.showOutcome('ДОБЫЧА ДОМА!', !this.everSeen ? 'Тебя ни разу не заметили.' : 'Утро настало.', reward.total);
    }

    // Переход в следующую комнату ночи, состояние переносится через init.
    nextRoom() {
        if (this.roomIndex + 1 >= this.night.length) { this.reachStairs(); return; }
        this.scene.restart({
            roomIndex: this.roomIndex + 1,
            cheeseThisNight: this.cheeseThisNight,
            pies: this.pies,
            everSeen: this.everSeen,
            winded: this.winded,
            windedUntil: this.windedUntil,
        });
    }

    // Камера комнаты зумирована и центрирована не на (0,0), а на её собственный
    // размер — оверлей рисуется через отдельную UI-камеру без зума и скролла,
    // чтобы быть одного размера и на одном месте в любой из шести комнат.
    showOutcome(title, sub, cheese) {
        const w = this.viewW;
        const h = this.viewH;
        const worldObjects = this.children.list.slice();
        const objs = [];

        const bg = this.add.rectangle(w / 2, h / 2, w, h, 0x0b0616, 0.92).setDepth(DEPTH.HUD);
        objs.push(bg);
        const panelW = Math.min(320, w - 48);
        const panel = this.add.rectangle(w / 2, h / 2, panelW, 260, 0x2a1c44, 1)
            .setStrokeStyle(3, 0x8a68c8).setDepth(DEPTH.HUD + 1);
        objs.push(panel);
        const titleT = this.add.text(w / 2, h / 2 - 90, title, {
            fontFamily: 'Nunito, sans-serif', fontSize: '30px', color: '#ffd040', fontStyle: 'bold',
        }).setOrigin(0.5).setDepth(DEPTH.HUD + 2);
        objs.push(titleT);
        const subT = this.add.text(w / 2, h / 2 - 40, sub, {
            fontFamily: 'Nunito, sans-serif', fontSize: '16px', color: '#e8dcff', align: 'center',
            wordWrap: { width: panelW - 32 },
        }).setOrigin(0.5).setDepth(DEPTH.HUD + 2);
        objs.push(subT);
        const cheeseT = this.add.text(w / 2, h / 2 + 15, `+${cheese} \u{1F9C0}`, {
            fontFamily: 'Nunito, sans-serif', fontSize: '26px', color: '#ffd040', fontStyle: 'bold',
        }).setOrigin(0.5).setDepth(DEPTH.HUD + 2);
        objs.push(cheeseT);
        const btnBg = this.add.rectangle(w / 2, h / 2 + 85, 220, 54, 0x6a4d90, 1)
            .setStrokeStyle(2, 0xd8a850).setDepth(DEPTH.HUD + 2).setInteractive({ useHandCursor: true });
        objs.push(btnBg);
        const btnT = this.add.text(w / 2, h / 2 + 85, 'В ЛАВКУ', {
            fontFamily: 'Nunito, sans-serif', fontSize: '20px', color: '#ffffff', fontStyle: 'bold',
        }).setOrigin(0.5).setDepth(DEPTH.HUD + 3);
        objs.push(btnT);
        btnBg.on('pointerdown', () => {
            bus.emit(BGM.MENU);
            this.scene.start('TransylvaniaScene', { openShop: true });
        });

        const uiCam = this.cameras.add(0, 0, w, h);
        uiCam.ignore(worldObjects);
        this.cameras.main.ignore(objs);
        // Стик/HUD живут на своей персистентной uiCam — без этого она бы
        // рисовала оверлей повторно (её депth 905 у HUD-текста выше панели).
        this.uiCam.ignore(objs);
    }

    checkPickupsAndExit() {
        for (const p of this.pickups) {
            if (p.taken) continue;
            if (Math.hypot(p.x - this.player.x, p.y - this.player.y) > CELL * 0.7) continue;
            p.taken = true;
            p.spr.destroy();
            if (p.type === 'cheese') {
                this.cheeseThisNight += 5;
                this.showFloatingText(p.x, p.y, '+5 \u{1F9C0}', '#ffd040');
            } else {
                this.pies = Math.min(SNEAK.PIES_MAX, this.pies + 1);
                this.showFloatingText(p.x, p.y, '+1 \u{1F967}', '#f0c060');
            }
        }
        if (this.prize && !this.prize.taken) {
            if (Math.hypot(this.prize.x - this.player.x, this.prize.y - this.player.y) < CELL * 0.6) {
                this.prize.taken = true;
                this.cheeseThisNight += 12;
                this.prize.spr.destroy(); this.prize.glow.destroy();
                this.showFloatingText(this.prize.x, this.prize.y - 30, 'ДОБЫЧА! Теперь к выходу', '#ffd040');
                this.exitDisc.setFillStyle(0x80ff80, 0.35);
            }
        }
        if (this.prize && !this.prize.taken) return;   // the way out stays shut
        if (Math.hypot(this.exitPoint.x - this.player.x, this.exitPoint.y - this.player.y) < CELL * 0.5) {
            this.nextRoom();
        }
        this.updateHud();
    }

    updatePlayer(dt) {
        let dx = this.joy && this.joy.active ? this.joy.dx : 0;
        let dy = this.joy && this.joy.active ? this.joy.dy : 0;
        if (this.cursors.left.isDown) dx -= 1;
        if (this.cursors.right.isDown) dx += 1;
        if (this.cursors.up.isDown) dy -= 1;
        if (this.cursors.down.isDown) dy += 1;
        const len = Math.hypot(dx, dy);
        if (!len) return;
        // Клавиатура всегда даёт полный ход (как раньше — деление на len его
        // и обеспечивает), а стик сохраняет аналоговую величину наклона:
        // magnitude берёт len напрямую, только ограничивая сверху единицей.
        const magnitude = Math.min(1, len);
        const speed = this.winded ? SNEAK.WALK_SPEED * 0.7 : SNEAK.WALK_SPEED;
        const nx = this.player.x + (dx / len) * magnitude * speed * dt;
        const ny = this.player.y + (dy / len) * magnitude * speed * dt;
        this.moveTo(nx, ny);
    }

    // Пошаговое движение с проверкой стен по сетке шаблона.
    moveTo(nx, ny) {
        const cx = Math.floor(nx / CELL);
        const cyOld = Math.floor(this.player.y / CELL);
        if (isFloor(this.tpl, cx, cyOld)) this.player.x = nx;
        const cxNew = Math.floor(this.player.x / CELL);
        const cy = Math.floor(ny / CELL);
        if (isFloor(this.tpl, cxNew, cy)) this.player.y = ny;
        this.player.sprite.setPosition(this.player.x, this.player.y);
    }
}
