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
                    g.fillStyle(((x + y) % 2 === 0) ? 0x221333 : 0x281838, 1);
                } else {
                    g.fillStyle(0x2a1a3e, 1);
                }
                g.fillRect(px, py, CELL, CELL);
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

    spawnPlayer() {
        const px = (this.tpl.entry.x + 0.5) * CELL;
        const py = (this.tpl.entry.y + 0.5) * CELL;
        this.player = { x: px, y: py, vx: 0, vy: 0, hidden: false };
        this.player.sprite = this.add.image(px, py, 'd_pi').setDepth(DEPTH.PLAYER).setScale(0.32);
    }

    spawnMonster() {
        if (!this.tpl.patrol || this.tpl.patrol.length < 2) return;
        this.monster = { t: 0, x: 0, y: 0, angle: 0, suspicion: 0, state: 'patrol' };
        this.monster.sprite = this.add.image(0, 0, 'd_cat').setDepth(DEPTH.MONSTER).setScale(0.32);
        this.coneGfx = this.add.graphics().setDepth(DEPTH.CONE);
    }

    update(_time, dtMs) {
        const dt = Math.min(dtMs, 50) / 1000;
        if (this.state !== 'play') return;
        this.updatePlayer(dt);
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
