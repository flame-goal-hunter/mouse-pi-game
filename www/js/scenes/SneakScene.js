// ============================================
// SNEAK SCENE — режим «Тихая лапка».
// Отдельная сцена: DungeonScene не изменяется.
// ============================================

import { Progress } from '../storage/ProgressStore.js';
import { bus } from '../audio/EventBus.js';
import { SFX, UI, BGM } from '../audio/SoundKeys.js';
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
        // Приз рисуется этой текстурой. Без неё прямой вход в режим давал
        // квадрат «нет текстуры» вместо сыра.
        this.load.svg('d_cheese', base + 'cheese.svg', { width: 48, height: 40 });
    }

    create() {
        this.viewW = this.scale.width;
        this.viewH = this.scale.height;
        // Размер игры равен CSS-пикселям, умноженным на DPR (см. main.js). DungeonScene
        // это учитывает зумом камеры, а здесь не учитывалось — оттого комната и весь
        // интерфейс были ровно в DPR раз мельче, чем задумано.
        this.dpr = window.__GAME_DPR || 1;
        this.cssW = this.viewW / this.dpr;
        this.cssH = this.viewH / this.dpr;
        this.ui = (v) => Math.round(v * this.dpr);   // экранный размер -> физические пиксели
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
        this.buildHoleButton();
        this.buildGoalBanner();

        this.cursors = this.input.keyboard.createCursorKeys();

        // Правая половина экрана — бросок. Левая — стик (setupTouch).
        // Граница задаётся сразу, чтобы обработчики не конфликтовали.
        this.input.on('pointerdown', (p) => {
            if (this.state !== 'play') return;
            // Кнопка норы стоит в правом нижнем углу, то есть внутри зоны броска —
            // она забирает нажатие себе, иначе Пи кидал бы пирог вместо прыжка.
            if (this._overHoleButton(p)) {
                this.holeBtn.held = true;
                this.holeBtn.id = p.id;
                this.holeBtn.ring.setFillStyle(0x6a4d90, 0.95);
                return;
            }
            if (p.x <= this.viewW / 2) return;
            const wp = this.cameras.main.getWorldPoint(p.x, p.y);
            this._pieDownAt = this.time.now;
            this._pieId = p.id;
            this._pieTarget = { x: wp.x, y: wp.y };
        });
        this.input.on('pointerup', (p) => {
            if (this.holeBtn && this.holeBtn.held && p.id === this.holeBtn.id) {
                this.holeBtn.held = false;
                this.holeBtn.id = null;
                this.holeBtn.ring.setFillStyle(0x2a1c44, 0.92);
                return;
            }
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
        const R = this.ui(62);   // радиус в физических пикселях: иначе стик был втрое мельче пальца

        this.joyR = R;
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
            const DEAD = this.ui(8);
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

    // Вход в нору висел только на клавише «пробел»: на телефоне нажать было нечем,
    // а подсказка над норой говорила «ДЕРЖИ» и не показывала, что именно.
    // Кнопка появляется, только когда Пи у норы, — тогда её назначение очевидно.
    buildHoleButton() {
        const r = this.ui(38);
        const cx = this.viewW - r - this.ui(20);
        const cy = this.viewH - r - this.ui(20);
        this.holeBtn = {
            held: false, id: null, r, cx, cy,
            ring: this.add.circle(cx, cy, r, 0x2a1c44, 0.92).setStrokeStyle(this.ui(3), 0xd8a850),
            label: this.add.text(cx, cy, 'НОРА', {
                fontFamily: 'Nunito, sans-serif', fontSize: this.ui(15) + 'px',
                color: '#ffd040', fontStyle: 'bold',
            }).setOrigin(0.5),
        };
        for (const o of [this.holeBtn.ring, this.holeBtn.label]) {
            o.setScrollFactor(0).setDepth(DEPTH.HUD + 6).setVisible(false);
        }
        this.cameras.main.ignore([this.holeBtn.ring, this.holeBtn.label]);
    }

    // Что делать в комнате, было видно только по цвету кружка у выхода.
    // Строка задачи наверху и подпись у выхода снимают этот вопрос.
    buildGoalBanner() {
        this.goalText = this.add.text(this.viewW / 2, this.ui(14), '', {
            fontFamily: 'Nunito, sans-serif', fontSize: this.ui(16) + 'px',
            color: '#1a0c2e', backgroundColor: '#e8b54a', fontStyle: 'bold',
            padding: { x: this.ui(12), y: this.ui(5) },
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(DEPTH.HUD + 5);
        this.cameras.main.ignore(this.goalText);

        this.exitLabel = this.add.text(this.exitPoint.x, this.exitPoint.y - CELL * 0.62, 'ВЫХОД', {
            fontFamily: 'Nunito, sans-serif', fontSize: '12px', fontStyle: '900',
            color: '#0b0616', backgroundColor: '#80ff80', padding: { x: 5, y: 2 },
        }).setOrigin(0.5, 1).setDepth(DEPTH.PROP + 1);
        this.uiCam.ignore(this.exitLabel);
        this.updateGoal();

        if (this.roomIndex === 0) {
            const tip = this.add.text(this.viewW / 2, this.viewH - this.ui(16),
                'Стик — идти · справа — бросить пирог · у норы держи «НОРА»', {
                fontFamily: 'Nunito, sans-serif', fontSize: this.ui(13) + 'px',
                color: '#e8dcff', backgroundColor: '#2a1c44aa',
                padding: { x: this.ui(10), y: this.ui(5) },
            }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(DEPTH.HUD + 5);
            this.cameras.main.ignore(tip);
            this.tweens.add({ targets: tip, alpha: 0, delay: 6000, duration: 900,
                onComplete: () => tip.destroy() });
        }
    }

    updateGoal() {
        if (!this.goalText) return;
        const need = this.prize && !this.prize.taken;
        this.goalText.setText(need ? 'Забери добычу' : 'Уходи к выходу');
        if (this.exitLabel) this.exitLabel.setVisible(!need);
    }

    _overHoleButton(p) {
        const b = this.holeBtn;
        if (!b || !b.ring.visible) return false;
        // Палец засчитывается с запасом: попадать точно в круг ребёнку не обязательно.
        return Math.hypot(p.x - b.cx, p.y - b.cy) <= b.r * 1.35;
    }

    _setHoleButtonVisible(on) {
        const b = this.holeBtn;
        if (!b || b.ring.visible === on) return;
        b.ring.setVisible(on);
        b.label.setVisible(on);
        if (!on) { b.held = false; b.id = null; }
        else b.ring.setScale(0.7), this.tweens.add({ targets: [b.ring], scale: 1, duration: 180, ease: 'Back.easeOut' });
    }

    buildHud() {
        const m = this.ui(14);
        this.hudPies = this.add.text(m, this.ui(12), '', {
            fontFamily: 'Nunito, sans-serif', fontSize: this.ui(19) + 'px', color: '#f0c060',
        }).setScrollFactor(0).setDepth(DEPTH.HUD + 5);

        this.hudCheese = this.add.text(m, this.ui(38), '', {
            fontFamily: 'Nunito, sans-serif', fontSize: this.ui(19) + 'px', color: '#ffd040',
        }).setScrollFactor(0).setDepth(DEPTH.HUD + 5);

        this.hudRoom = this.add.text(this.viewW - m, this.ui(12), '', {
            fontFamily: 'Nunito, sans-serif', fontSize: this.ui(15) + 'px', color: '#a090b8',
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
        const rows = this.tpl.grid.length;
        const cols = this.tpl.grid[0].length;
        // Комната редко совпадает с пропорцией экрана. Поля вокруг заполняются той же
        // кладкой, иначе половина экрана оставалась чёрной и карта казалась мелкой.
        const B = 14;
        for (let y = -B; y < rows + B; y++) {
            for (let x = -B; x < cols + B; x++) {
                if (y >= 0 && y < rows && x >= 0 && x < cols) continue;
                g.fillStyle(0x3d2b57, 1);
                g.fillRect(x * CELL, y * CELL, CELL, CELL);
                g.fillStyle(0x543d75, 1);
                g.fillRect(x * CELL, y * CELL, CELL, 4);
            }
        }
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

    // Комната занимает экран целиком. Зум считается в CSS-пикселях и лишь потом
    // умножается на DPR — раньше этого множителя не было, и комната 560x360 рисовалась
    // на треть экрана.
    setupCamera() {
        const w = this.tpl.grid[0].length * CELL;
        const h = this.tpl.grid.length * CELL;
        const pad = 10;
        // Во сколько раз увеличить комнату, чтобы она заполнила экран по узкой стороне.
        const fit = Math.min((this.cssW - pad * 2) / w, (this.cssH - pad * 2) / h);
        const k = Math.max(1.0, Math.min(2.6, fit));
        const cam = this.cameras.main;
        cam.setZoom(this.dpr * k);
        this.roomW = w;
        this.roomH = h;
        // Комната целиком в кадре — камера стоит. Иначе идёт за Пи.
        this.roomFits = (w * k <= this.cssW + 1) && (h * k <= this.cssH + 1);
        // Границы ставятся только когда есть что ограничивать: при виде шире комнаты
        // они прижимали её к левому верхнему углу вместо центра.
        if (!this.roomFits) cam.setBounds(0, 0, w, h);
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
        // Спрайт держится в габарите клетки: при scale 0.32 он был 48x55 px при клетке 40
        // и половиной корпуса заезжал в стену даже стоя вплотную.
        this.player.sprite = this.add.image(px, py, 'd_pi').setDepth(DEPTH.PLAYER)
            .setDisplaySize(CELL * 0.82, CELL * 0.94);
        this._playerW = CELL * 0.82;
        this._playerH = CELL * 0.94;
        if (this._camReady && !this.roomFits) this.cameras.main.startFollow(this.player.sprite, true, 0.12, 0.12);
    }

    spawnMonster() {
        if (!this.tpl.patrol || this.tpl.patrol.length < 2) return;
        const start = positionAt(this.tpl.patrol, this.tpl.patrolSpeed, CELL, 0);
        this.monster = { t: 0, x: start.x, y: start.y, angle: start.angle, suspicion: 0, state: 'patrol' };
        this.monster.sprite = this.add.image(start.x, start.y, 'd_cat').setDepth(DEPTH.MONSTER)
            .setDisplaySize(CELL * 0.95, CELL * 0.86);
        this.coneGfx = this.add.graphics().setDepth(DEPTH.CONE);
    }

    update(_time, dtMs) {
        const dt = Math.min(dtMs, 50) / 1000;
        if (this.state === 'squeeze') return;
        if (this.state !== 'play') return;
        if (this.winded && this.time.now > this.windedUntil) this.winded = false;
        const actionDown = this.cursors.space.isDown || !!(this.holeBtn && this.holeBtn.held);
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
        this._setHoleButtonVisible(!!near && !this.player.hidden);
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
            x: tx, y: ty, scale: this.player.sprite.scaleX * 0.55,
            duration: SNEAK.HOLE_SQUEEZE_MS,
            ease: 'Quad.easeInOut',
            onComplete: () => {
                this.player.x = tx;
                this.player.y = ty;
                this.player.sprite.setDisplaySize(this._playerW, this._playerH);
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
        const sx = this.player.sprite.scaleX, sy = this.player.sprite.scaleY;
        this.player.sprite.setScale(sx * 1.08, sy * 0.92);
        this.tweens.add({ targets: this.player.sprite, scaleX: sx, scaleY: sy, duration: 100 });

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
        this.holeHint = this.add.text(near.x, near.y - CELL * 0.75, 'ДЕРЖИ «НОРА»', {
            fontFamily: '"Nunito", sans-serif', fontStyle: '900', fontSize: '13px',
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
            && inCone(this.player.x, this.player.y, m.x, m.y, m.angle, SNEAK.CONE_RANGE, SNEAK.CONE_ANGLE)
            && this._lineOfSight(m.x, m.y, this.player.x, this.player.y);
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

    // Монстр проверяется тем же габаритом, что и игрок.
    moveMonsterBy(m, dx, dy) {
        const r = SNEAK.BODY_R;
        if (this._free(m.x + dx, m.y, r)) m.x += dx;
        if (this._free(m.x, m.y + dy, r)) m.y += dy;
        if (m.sprite) m.sprite.setPosition(m.x, m.y);
    }

    // Стена перекрывает взгляд. Без этого сторож замечал Пи через кладку, а конус
    // рисовался поверх стен — выглядело как «сквозь стены всё видно».
    _lineOfSight(x0, y0, x1, y1) {
        const dx = x1 - x0, dy = y1 - y0;
        const dist = Math.hypot(dx, dy);
        // Шаг мельче половины клетки: на редкой сетке луч перешагивал угол стены.
        const steps = Math.ceil(dist / (CELL * 0.18));
        for (let i = 1; i < steps; i++) {
            const t = i / steps;
            const x = x0 + dx * t, y = y0 + dy * t;
            if (!isFloor(this.tpl, Math.floor(x / CELL), Math.floor(y / CELL))) return false;
        }
        return true;
    }

    // Расстояние до первой стены вдоль луча — им обрезается каждый край конуса.
    _rayHit(x0, y0, angle, maxDist) {
        const step = CELL * 0.28;
        const cx = Math.cos(angle), cy = Math.sin(angle);
        for (let d = step; d <= maxDist; d += step) {
            const x = x0 + cx * d, y = y0 + cy * d;
            if (!isFloor(this.tpl, Math.floor(x / CELL), Math.floor(y / CELL))) return d - step;
        }
        return maxDist;
    }

    drawCone() {
        const m = this.monster;
        this.coneGfx.clear();
        if (m.state === 'confused') return;
        const half = SNEAK.CONE_ANGLE / 2;
        const alpha = m.state === 'chase' ? 0.30 : 0.16;
        this.coneGfx.fillStyle(m.state === 'chase' ? 0xff6060 : 0xd8a850, alpha);
        // Веер лучей вместо дуги: каждый останавливается о стену, поэтому конус
        // ложится ровно на то, что сторож действительно видит.
        const RAYS = 26;
        this.coneGfx.beginPath();
        this.coneGfx.moveTo(m.x, m.y);
        for (let i = 0; i <= RAYS; i++) {
            const a = m.angle - half + (SNEAK.CONE_ANGLE * i) / RAYS;
            const d = this._rayHit(m.x, m.y, a, SNEAK.CONE_RANGE);
            this.coneGfx.lineTo(m.x + Math.cos(a) * d, m.y + Math.sin(a) * d);
        }
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
        const px = (v) => this.ui(v);

        const bg = this.add.rectangle(w / 2, h / 2, w, h, 0x0b0616, 0.92).setDepth(DEPTH.HUD);
        objs.push(bg);

        // Три ответа вместо одного: раньше после поимки предлагалась только лавка,
        // то есть переиграть ночь было нельзя вообще.
        const rows = [
            { label: 'ЕЩЁ РАЗ', main: true, act: () => this.scene.restart({ roomIndex: 0 }) },
            { label: 'В ЛАВКУ', act: () => { bus.emit(BGM.MENU); this.scene.start('TransylvaniaScene', { openShop: true }); } },
            { label: 'В МЕНЮ', act: () => { bus.emit(BGM.MENU); window.location.href = 'transylvania-menu.html'; } },
        ];
        const btnH = px(50), gap = px(10);
        const panelW = Math.min(px(330), w - px(40));
        const panelH = px(112) + rows.length * (btnH + gap);
        const panel = this.add.rectangle(w / 2, h / 2, panelW, panelH, 0x2a1c44, 1)
            .setStrokeStyle(px(3), 0x8a68c8).setDepth(DEPTH.HUD + 1);
        objs.push(panel);

        const top = h / 2 - panelH / 2;
        const titleT = this.add.text(w / 2, top + px(26), title, {
            fontFamily: 'Nunito, sans-serif', fontSize: px(27) + 'px', color: '#ffd040', fontStyle: 'bold',
        }).setOrigin(0.5).setDepth(DEPTH.HUD + 2);
        objs.push(titleT);
        const subT = this.add.text(w / 2, top + px(58), sub, {
            fontFamily: 'Nunito, sans-serif', fontSize: px(14) + 'px', color: '#e8dcff', align: 'center',
            wordWrap: { width: panelW - px(28) },
        }).setOrigin(0.5).setDepth(DEPTH.HUD + 2);
        objs.push(subT);
        const cheeseT = this.add.text(w / 2, top + px(88), `+${cheese} \u{1F9C0}`, {
            fontFamily: 'Nunito, sans-serif', fontSize: px(22) + 'px', color: '#ffd040', fontStyle: 'bold',
        }).setOrigin(0.5).setDepth(DEPTH.HUD + 2);
        objs.push(cheeseT);

        let y = top + px(112) + btnH / 2;
        for (const r of rows) {
            const bw = panelW - px(40);
            const b = this.add.rectangle(w / 2, y, bw, btnH, r.main ? 0xd8a850 : 0x6a4d90, 1)
                .setStrokeStyle(px(2), r.main ? 0xffd040 : 0xd8a850)
                .setDepth(DEPTH.HUD + 2).setInteractive({ useHandCursor: true });
            const t = this.add.text(w / 2, y, r.label, {
                fontFamily: 'Nunito, sans-serif', fontSize: px(17) + 'px',
                color: r.main ? '#2a1206' : '#ffffff', fontStyle: 'bold',
            }).setOrigin(0.5).setDepth(DEPTH.HUD + 3);
            objs.push(b, t);
            let fired = false;
            const go = () => { if (fired) return; fired = true; bus.emit(UI.BUTTON_CLICK); r.act(); };
            b.on('pointerdown', go);
            b.on('pointerover', () => b.setScale(1.03));
            b.on('pointerout', () => b.setScale(1));
            y += btnH + gap;
        }

        const uiCam = this.cameras.add(0, 0, w, h);
        uiCam.ignore(worldObjects);
        this.cameras.main.ignore(objs);
        // Стик/HUD живут на своей персистентной uiCam — без этого она бы
        // рисовала оверлей повторно (её депth 905 у HUD-текста выше панели).
        this.uiCam.ignore(objs);
        // Стик и кнопка норы после исхода уже ни к чему.
        for (const o of [this.joyBase, this.joyKnob, this.holeBtn?.ring, this.holeBtn?.label, this.goalText]) {
            if (o) o.setVisible(false);
        }
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
                this.updateGoal();
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

    // Проверка стен по всему габариту, а не по одной точке.
    // Раньше сверялась только клетка под центром: корпус шириной с клетку наполовину
    // заходил в стену, и это читалось как «хожу по стенам и сквозь стены».
    _free(x, y, r) {
        const l = x - r, rt = x + r, t = y - r, b = y + r;
        return isFloor(this.tpl, Math.floor(l / CELL), Math.floor(t / CELL))
            && isFloor(this.tpl, Math.floor(rt / CELL), Math.floor(t / CELL))
            && isFloor(this.tpl, Math.floor(l / CELL), Math.floor(b / CELL))
            && isFloor(this.tpl, Math.floor(rt / CELL), Math.floor(b / CELL));
    }

    // Оси проверяются раздельно, поэтому вдоль стены персонаж скользит, а не залипает.
    moveTo(nx, ny) {
        const r = SNEAK.BODY_R;
        if (this._free(nx, this.player.y, r)) this.player.x = nx;
        if (this._free(this.player.x, ny, r)) this.player.y = ny;
        this.player.sprite.setPosition(this.player.x, this.player.y);
    }
}
