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
import { isFloor } from '../sneak/RoomTemplate.js';
import { positionAt } from '../sneak/PatrolCycle.js';

const CELL = SNEAK.CELL;
const DEPTH = { FLOOR: 10, PROP: 40, HOLE: 45, PLAYER: 60, MONSTER: 62, CONE: 55, HUD: 900 };

export class SneakScene extends Phaser.Scene {
    constructor() { super({ key: 'SneakScene' }); }

    init(data) {
        // Каждое поле сбрасывается здесь — сцена переиспользуется между ночами.
        this.roomIndex = data?.roomIndex || 0;
        this.cheeseThisNight = data?.cheeseThisNight || 0;
        this.pies = data?.pies ?? SNEAK.PIES_MIN;
        this.everSeen = data?.everSeen || false;
        this.night = assembleNight(TEMPLATES, BEATS);
        this.room = this.night[this.roomIndex];
        this.tpl = this.room.template;
        this.state = 'play';
        this.holdMs = 0;
        this.holdArmed = true;
        this.monster = null;
        this.player = null;
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
        this.spawnPlayer();
        this.spawnMonster();

        this.cursors = this.input.keyboard.createCursorKeys();
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
    }

    // Комната видна целиком — механика требует читать весь маршрут патруля.
    setupCamera() {
        const w = this.tpl.grid[0].length * CELL;
        const h = this.tpl.grid.length * CELL;
        const pad = 24;
        const zoom = Math.min((this.viewW - pad * 2) / w, (this.viewH - pad * 2) / h, 1.6);
        const cam = this.cameras.main;
        cam.setZoom(Math.max(0.5, zoom));
        cam.centerOn(w / 2, h / 2);
    }

    spawnPlayer() {
        const px = (this.tpl.entry.x + 0.5) * CELL;
        const py = (this.tpl.entry.y + 0.5) * CELL;
        this.player = { x: px, y: py, vx: 0, vy: 0, hidden: false };
        this.player.sprite = this.add.image(px, py, 'd_pi').setDepth(DEPTH.PLAYER).setScale(0.32);
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
        const actionDown = this.cursors.space.isDown;
        this.updateHoleHold(dt, actionDown);
        if (this.holdMs === 0) this.updatePlayer(dt);
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
        if (!near || !actionDown || this.player.hidden || !this.holdArmed) {
            this.holdMs = 0;
            if (this.holdRing) { this.holdRing.destroy(); this.holdRing = null; }
            return;
        }
        this.holdMs += dt * 1000;
        const t = Math.min(1, this.holdMs / SNEAK.HOLE_HOLD_MS);
        if (!this.holdRing) {
            this.holdRing = this.add.graphics().setDepth(DEPTH.HUD);
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
        this.monster.state = 'confused';
        this.monster.confusedUntil = this.time.now + SNEAK.HOLE_FORGET_MS;
        this.monster.suspicion = 0;
        this.showFloatingText(this.monster.x, this.monster.y - 40, '?', '#ffd040');
    }

    showFloatingText(x, y, text, color) {
        const t = this.add.text(x, y, text, {
            fontFamily: 'Nunito, sans-serif', fontSize: '22px', color,
        }).setOrigin(0.5).setDepth(DEPTH.HUD);
        this.tweens.add({ targets: t, y: y - 36, alpha: 0, duration: 900, onComplete: () => t.destroy() });
    }

    updatePlayer(dt) {
        let dx = 0;
        let dy = 0;
        if (this.cursors.left.isDown) dx -= 1;
        if (this.cursors.right.isDown) dx += 1;
        if (this.cursors.up.isDown) dy -= 1;
        if (this.cursors.down.isDown) dy += 1;
        const len = Math.hypot(dx, dy) || 1;
        const speed = SNEAK.WALK_SPEED;
        const nx = this.player.x + (dx / len) * speed * dt;
        const ny = this.player.y + (dy / len) * speed * dt;
        if (dx || dy) this.moveTo(nx, ny);
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
