# Transylvania Phase 1: Performance Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the lag in the Transylvania mode menu chain and DungeonScene without changing any visuals or gameplay (spec §1 + §3 of `docs/superpowers/specs/2026-08-29-transylvania-polish-design.md`).

**Architecture:** Three fronts: (1) stop index.html's hidden canvas game loop from running behind the Phaser iframe and skip the pointless Phaser boot before the HTML menu; (2) bake DungeonScene's static level geometry (floor + walls + sconces) into a single RenderTexture drawn once; (3) replace the world-sized lighting RenderTexture + BitmapMask with a camera-sized erase-composited RT, and remove per-frame allocations, per-pickup infinite tweens, and per-object Graphics redraws.

**Tech Stack:** Phaser 3.70 (WebGL), vanilla JS, no build step. Files served from `www/`.

**Testing note (deviation from TDD):** this repo has no JS test runner and the changes are render/perf-behavior in a Phaser scene. Instead of unit tests, every task has an explicit manual verification step with exact URL, console commands, and expected numbers. A temporary FPS overlay (Task 1) provides before/after measurements. Do not skip verification steps.

**How to run locally:** `cd www && python3 -m http.server 8080`, then open `http://localhost:8080/game-phaser.html?mode=transylvania&runMode=story&fps=1` in Chrome. For the menu chain open `http://localhost:8080/index.html`.

**Git:** work on the current `network_mode` branch. There are unrelated uncommitted changes in the worktree — `git add` ONLY the files named in each commit step, never `git add -A`.

---

### Task 1: FPS overlay + baseline measurement

**Files:**
- Modify: `www/js/scenes/DungeonScene.js` (create — after HUD setup; update — end of method)

- [ ] **Step 1: Add FPS text object, enabled by `?fps=1`**

In `DungeonScene.create()`, right after the call to `this.setupHUD()` (search `setupHUD()` inside `create`), add:

```js
        // TEMP perf overlay — enabled with ?fps=1 (Phase 1 measurement)
        this._fpsDebug = new URLSearchParams(window.location.search).get('fps') === '1';
        if (this._fpsDebug) {
            this._fpsText = this.add.text(8, 8, '', {
                fontFamily: 'monospace', fontSize: '16px', color: '#00ff80',
                backgroundColor: '#000000aa', padding: { x: 6, y: 3 }
            }).setScrollFactor(0).setDepth(5000);
            this._fpsAccum = 0;
        }
```

- [ ] **Step 2: Update it twice a second in `update()`**

At the very top of `update(_time, dtMs)` (line ~288, before anything else), add:

```js
        if (this._fpsDebug) {
            this._fpsAccum = (this._fpsAccum || 0) + dtMs;
            if (this._fpsAccum > 500) {
                this._fpsAccum = 0;
                this._fpsText.setText(
                    'fps ' + this.game.loop.actualFps.toFixed(1) +
                    ' | enemies ' + (this.enemies ? this.enemies.length : 0) +
                    ' | tweens ' + this.tweens.getTweens().length
                );
            }
        }
```

- [ ] **Step 3: Record the baseline**

Run: open `http://localhost:8080/game-phaser.html?mode=transylvania&runMode=story&fps=1`, walk around floor 1 for ~30 s, fight enemies.
Record in the commit message: typical fps, tween count. Expected on desktop: fps well below 60 in DevTools → Performance → CPU 6x throttle; tween count 80–150.

- [ ] **Step 4: Commit**

```bash
git add www/js/scenes/DungeonScene.js
git commit -m "perf: add temporary FPS overlay for phase-1 measurements (baseline: <fill numbers>)"
```

---

### Task 2: Stop index.html's hidden game loop behind the Phaser iframe

**Files:**
- Modify: `www/index.html:7027-7028` (update guard), `www/index.html:7360-7389` (draw guard), `www/index.html:10652-10656` (gameLoop)

- [ ] **Step 1: Gate the rAF loop on `phaserRunning`**

Replace (line ~10652):

```js
        function gameLoop() {
            update();
            draw();
            requestAnimationFrame(gameLoop);
        }
```

with:

```js
        function gameLoop() {
            // While the Phaser iframe is up it owns rendering — the hidden canvas
            // must not simulate or draw anything (Android perf).
            if (!phaserRunning) {
                update();
                draw();
            }
            requestAnimationFrame(gameLoop);
        }
```

- [ ] **Step 2: Teach `update()` and `draw()` about the transylvania mode**

`startTransylvaniaPreview` sets `gameRunning = true; currentGameMode = 'transylvania'`, and neither function has a branch for it, so if `phaserRunning` ever drops while the mode is still set, the old adventure game would simulate + render. Add at the top of `update()` (line ~7028, directly after `if (!gameRunning || gamePaused) return;`):

```js
            if (currentGameMode === 'transylvania') return; // Phaser iframe owns this mode
```

And in `draw()`, after the snowball branch (line ~7387, right before `drawBackground();`), add:

```js
            // Transylvania is rendered by the Phaser iframe — keep canvas blank
            if (currentGameMode === 'transylvania') {
                ctx.fillStyle = '#0a0510';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                return;
            }
```

- [ ] **Step 3: Verify**

Run: open `http://localhost:8080/index.html`, click the Transylvania mode button. In DevTools → Performance record 5 s while the menu iframe is visible.
Expected: no repeating `update`/`draw` frames from index.html scripts in the flame chart (only the iframe's activity); Main-thread time of the parent page ≈ 0.

- [ ] **Step 4: Commit**

```bash
git add www/index.html
git commit -m "perf: idle index.html canvas loop while Phaser iframe is running"
```

---

### Task 3: Load the HTML menu directly in the iframe (skip the Phaser boot-redirect)

**Files:**
- Modify: `www/index.html:10569-10584` (`startTransylvaniaPreview`)

- [ ] **Step 1: Point the iframe at the menu page**

Replace the body of `startTransylvaniaPreview` (line ~10569):

```js
        function startTransylvaniaPreview() {
            stopMenuMusic();
            const frame = document.getElementById('phaserFrame');
            if (phaserRunning) frame.src = 'about:blank';

            const launchGame = () => {
                frame.src = 'game-phaser.html?mode=transylvania&_v=' + Date.now();
                frame.style.display = 'block';
                document.getElementById('startScreen').classList.remove('visible');
                document.getElementById('gameCanvas').style.display = 'none';
                phaserRunning = true;
                gameRunning = true;
                currentGameMode = 'transylvania';
            };
            if (phaserRunning) setTimeout(launchGame, 50); else launchGame();
        }
```

with:

```js
        function startTransylvaniaPreview() {
            stopMenuMusic();
            const frame = document.getElementById('phaserFrame');
            if (phaserRunning) frame.src = 'about:blank';

            const launchGame = () => {
                // Straight to the HTML menu — no Phaser boot just to redirect.
                // The menu itself navigates the iframe to game-phaser.html on "start run".
                frame.src = 'transylvania-menu.html?_v=' + Date.now();
                frame.style.display = 'block';
                document.getElementById('startScreen').classList.remove('visible');
                document.getElementById('gameCanvas').style.display = 'none';
                phaserRunning = true;
                gameRunning = true;
                currentGameMode = 'transylvania';
            };
            if (phaserRunning) setTimeout(launchGame, 50); else launchGame();
        }
```

The `mode=transylvania → redirect` branch in `BootScene.js:186-202` stays as a fallback for direct URL entry — do not touch it.

- [ ] **Step 2: Verify the full chain**

Run: from `index.html` click Transylvania → menu must appear (near-instant, no Phaser log lines like `[Mousie Pi] BUILD:` in the iframe console before the menu). Click «СПАСТИ БАБУШКУ» → DungeonScene starts. Click «Меню» back-button in the menu → returns to index.html start screen (postMessage `closePhaserSnowball` path).
Expected: exactly one Phaser boot per run (when the run starts), zero before that.

- [ ] **Step 3: Commit**

```bash
git add www/index.html
git commit -m "perf: iframe loads transylvania-menu.html directly, skipping Phaser boot-redirect"
```

---

### Task 4: Bake floor + walls + torch sconces into one static RenderTexture

**Files:**
- Modify: `www/js/scenes/DungeonScene.js:898-925` (`drawCarvedFloor`), `www/js/scenes/DungeonScene.js:708-809` (`buildWorld`)

- [ ] **Step 1: Make `drawCarvedFloor` store its Graphics on the scene**

In `drawCarvedFloor()` (line ~898) replace:

```js
        const floor = this.add.graphics();
        floor.setDepth(-100);
```

with:

```js
        const floor = this.add.graphics();
        floor.setDepth(-100);
        this.floorGfx = floor;
```

(the rest of the method is unchanged).

- [ ] **Step 2: Bake at the end of `buildWorld()`**

`buildWorld()` currently ends with (line ~805):

```js
        // Random torches per room (some lit, some unlit)
        this.placeRandomTorches();
        // SPOOKY eyes in dark corners — they fade when Pi approaches
        this.placeSpookyEyes();
    }
```

Replace with:

```js
        // Random torches per room (some lit, some unlit)
        this.placeRandomTorches();
        // SPOOKY eyes in dark corners — they fade when Pi approaches
        this.placeSpookyEyes();

        // === BAKE static geometry ===
        // floor (~7k cmds) + walls (~3.5k cmds) + sconces were Graphics command
        // buffers re-tessellated EVERY frame. Draw them once into a RenderTexture
        // and destroy the sources: per-frame cost becomes one textured quad.
        const worldRT = this.add.renderTexture(0, 0, WORLD_W, WORLD_H)
            .setOrigin(0).setDepth(-100);
        worldRT.draw(this.floorGfx);
        worldRT.draw(this.wallGfx);
        worldRT.draw(this.torchSconceGfx);
        this.floorGfx.destroy();        this.floorGfx = null;
        this.wallGfx.destroy();         this.wallGfx = null;
        this.torchSconceGfx.destroy();  this.torchSconceGfx = null;
        this.worldRT = worldRT;
    }
```

Draw order inside the RT preserves the old depths (floor −100 < walls 50 < sconces 70). Decorative props (`drawDecor` painters, depth −50) are NOT baked in this phase — they are all being redrawn in Phase 2 (spec §4) and will be baked then. Weak/breakable walls have their own Graphics and are untouched.

- [ ] **Step 3: Guard against post-bake writers**

`addWall` and `placeTorch` write to `this.wallGfx` / `this.torchSconceGfx`. They are only called from `buildWorld`/`placeRandomTorches` (before the bake), but `breakWeakWall` might redraw. Run:

```bash
grep -n "wallGfx\|torchSconceGfx\|floorGfx" www/js/scenes/DungeonScene.js
```

For any use OUTSIDE `buildWorld`/`addWall`/`placeTorch`/`drawCarvedFloor` (e.g. in a weak-wall or resize path), wrap it in a null-guard: `if (this.wallGfx) { ... }`. Expected: no such uses exist; if one appears, guard it and note it in the commit message.

- [ ] **Step 4: Verify**

Run: story floor 1 with `?fps=1`. Walk the whole floor.
Expected: level looks IDENTICAL (checker floor, brick walls, sconces); fps noticeably up (this is the single biggest win); no console errors; dashing into walls still collides (collision uses `this.walls` data, not the Graphics).
Also run one endless floor (`runMode=endless`) and pass through a floor transition (pick up key → exit) to confirm the next floor bakes cleanly after `scene.start` teardown.

- [ ] **Step 5: Commit**

```bash
git add www/js/scenes/DungeonScene.js
git commit -m "perf: bake floor/walls/sconces into a static RenderTexture (was ~10k Graphics cmds per frame)"
```

---

### Task 5: Camera-sized lighting (drop world RT + BitmapMask), 60 Hz update

**Files:**
- Modify: `www/js/scenes/DungeonScene.js:322-348` (`setupLighting`), `:389-439` (`updateLighting`), `:312-313` (update throttle)

- [ ] **Step 1: Rewrite `setupLighting`**

Replace the whole method (line ~322):

```js
    setupLighting() {
        this.createLightTextures();

        // Reusable sprites for stamping lights into the RT
        this._radialLight = this.add.image(-9999, -9999, 'lightRadial')
            .setOrigin(0.5).setVisible(false);
        this._coneLight = this.add.image(-9999, -9999, 'lightCone')
            .setOrigin(0, 0.5).setVisible(false);

        // Camera-sized darkness RT (screen space). We fill it with the biome
        // darkness color and ERASE light shapes out of it each frame.
        // Replaces: world-sized 2600×1900 RT (~20 MB) + inverted BitmapMask
        // (2 extra full-screen passes per frame).
        const b = this.biome || { darknessColor: 0x080418, darknessAlpha: 0.78 };
        const cam = this.cameras.main;
        this._darknessColor = b.darknessColor;
        this.lightRT = this.add.renderTexture(0, 0, cam.width, cam.height)
            .setOrigin(0).setScrollFactor(0).setDepth(700);
        this.lightRT.setAlpha(b.darknessAlpha != null ? b.darknessAlpha : 0.78);

        // Player's aim angle (for cone direction) - initialized to right
        this.player.aimAngle = 0;
    }
```

The old fields `this.darkness` and the mask no longer exist. Run `grep -n "this.darkness" www/js/scenes/DungeonScene.js` and delete every remaining reference (expected: only the ones inside the old `setupLighting`).

- [ ] **Step 2: Rewrite `updateLighting` in screen space with `erase`**

Replace the whole method (line ~389):

```js
    updateLighting() {
        if (!this.lightRT) return;
        const cam = this.cameras.main;
        const rt = this.lightRT;
        // Scale.RESIZE can change the canvas at any time (Android URL bar)
        if (rt.width !== cam.width || rt.height !== cam.height) {
            rt.resize(cam.width, cam.height);
        }
        rt.clear();
        rt.fill(this._darknessColor, 1);

        const ox = cam.scrollX, oy = cam.scrollY;
        const margin = 130;
        const inView = (x, y, r) =>
            x + r + margin >= ox && x - r - margin <= ox + cam.width &&
            y + r + margin >= oy && y - r - margin <= oy + cam.height;

        // 1. Pi's directional flashlight cone
        const flicker = 1 + Math.sin(this.time.now * 0.012) * 0.04 + (Math.random() - 0.5) * 0.03;
        const coneLen = 620 * flicker;
        const coneH = 480 * (coneLen / 512);
        this._coneLight.setPosition(this.player.x - ox, this.player.y - oy);
        this._coneLight.setRotation(this.player.aimAngle || 0);
        this._coneLight.setScale(coneLen / 512, coneH / 480);
        rt.erase(this._coneLight);

        // 2. Ambient halo around Pi
        const haloFlicker = 1 + Math.sin(this.time.now * 0.015 + 1.3) * 0.06;
        this._radialLight.setPosition(this.player.x - ox, this.player.y - oy);
        this._radialLight.setScale((220 * haloFlicker) / 256);
        rt.erase(this._radialLight);

        // 3. Torches in view
        for (const t of this.torches) {
            if (!t.lit) continue;
            if (!inView(t.x, t.y, t.baseRadius)) continue;
            const tf = 1 + Math.sin(this.time.now * 0.014 + t.flickerPhase) * 0.10
                         + Math.cos(this.time.now * 0.022 + t.flickerPhase) * 0.05;
            const r = t.baseRadius * tf;
            this._radialLight.setPosition(t.x - ox, t.y - oy);
            this._radialLight.setScale((r * 2) / 256);
            rt.erase(this._radialLight);
        }

        // 4. Exit door + key quest markers
        if (this.exit && inView(this.exit.x, this.exit.y, 90)) {
            this._radialLight.setPosition(this.exit.x - ox, this.exit.y - oy).setScale(180 / 256);
            rt.erase(this._radialLight);
        }
        if (this.keyPickup && !this.keyPickup.taken &&
            inView(this.keyPickup.x, this.keyPickup.y, 85)) {
            this._radialLight.setPosition(this.keyPickup.x - ox, this.keyPickup.y - oy).setScale(170 / 256);
            rt.erase(this._radialLight);
        }
    }
```

- [ ] **Step 3: Update every frame (kill the 30 Hz strobe)**

In `update()` replace (line ~312):

```js
        this._lightFrameTick = (this._lightFrameTick || 0) + 1;
        if (this._lightFrameTick % 2 === 0) this.updateLighting();
```

with:

```js
        this.updateLighting();
```

- [ ] **Step 4: Verify**

Run: story floor 1. Expected: darkness + flashlight cone + torch pools look the same as before, but the cone follows the aim stick smoothly (no 30 Hz stutter); rotate aim quickly to confirm. Resize the browser window mid-run — no crash, darkness still covers the full viewport. Check fps overlay: further improvement over Task 4.

- [ ] **Step 5: Commit**

```bash
git add www/js/scenes/DungeonScene.js
git commit -m "perf: camera-sized erase-composited lighting, 60Hz (was world-sized RT + BitmapMask at 30Hz)"
```

---

### Task 6: One shared Graphics for all torch flames

**Files:**
- Modify: `www/js/scenes/DungeonScene.js:441-492` (`updateTorches`, `drawTorchFlame`, `extinguishTorch`), `:1886-1906` (`placeTorch`), `:1909-1915` (`lightTorch`)

- [ ] **Step 1: Create the shared flame layer**

In `buildWorld()` at the top, right after `this.torchSconceGfx = this.add.graphics().setDepth(70);` (line ~711), add:

```js
        this.flameGfx = this.add.graphics().setDepth(81);  // ALL torch flames, one clear per frame
```

(Note: `flameGfx` is NOT baked in Task 4 — it must stay live. It is created before the bake block but never drawn into the RT.)

- [ ] **Step 2: Stop creating per-torch Graphics**

In `placeTorch` (line ~1902) replace:

```js
        // Flame stays per-torch (animated each frame)
        torch.flameGfx = this.add.graphics().setDepth(81);
        if (lit) this.drawTorchFlame(torch);
        this.torches.push(torch);
```

with:

```js
        this.torches.push(torch);
```

- [ ] **Step 3: Redraw all visible flames into the shared layer**

Replace `updateTorches` and `drawTorchFlame` (lines ~441-473):

```js
    updateTorches(dt) {
        // ONE clear + redraw of every visible lit flame into the shared layer
        if (!this.flameGfx) return;
        this.flameGfx.clear();
        const cam = this.cameras.main;
        const margin = 100;
        for (const t of this.torches) {
            if (!t.lit) continue;
            const visible =
                t.x + 40 + margin >= cam.scrollX &&
                t.x - 40 - margin <= cam.scrollX + cam.width &&
                t.y + 40 + margin >= cam.scrollY &&
                t.y - 40 - margin <= cam.scrollY + cam.height;
            if (!visible) continue;
            t.flameH = Math.sin(this.time.now * 0.022 + t.flickerPhase) * 3;
            this.drawTorchFlame(t);
            // Rare permanent extinction (atmosphere)
            if (Math.random() < 0.00004) this.extinguishTorch(t);
        }
    }

    drawTorchFlame(torch) {
        // Appends into the shared flameGfx — caller clears once per frame
        const f = this.flameGfx;
        if (!f || !torch.lit) return;
        const x = torch.x, y = torch.y;
        const h = torch.flameH || 0;
        f.fillStyle(0xff7020, 1);
        f.fillEllipse(x, y - 8 - h * 0.4, 7, 12 + h);
        f.fillStyle(0xffd040, 1);
        f.fillEllipse(x, y - 10 - h * 0.6, 4, 8 + h * 0.6);
        f.fillStyle(0xffffe0, 1);
        f.fillEllipse(x, y - 12 - h * 0.7, 1.5, 3.5 + h * 0.3);
    }
```

- [ ] **Step 4: Clean the two remaining per-torch references**

In `extinguishTorch` (line ~491) delete the line:

```js
        if (torch.flameGfx) torch.flameGfx.clear();
```

(the flame disappears next frame because `lit` is false). In `lightTorch` (line ~1913) delete the line `this.drawTorchFlame(torch);` — `updateTorches` draws it next frame. Then run `grep -n "flameGfx" www/js/scenes/DungeonScene.js` — expected remaining uses: the creation in `buildWorld`, `updateTorches`, `drawTorchFlame` only.

- [ ] **Step 5: Verify**

Run: story floor 1. Expected: flames flicker exactly as before; lighting a dark torch with a pie makes its flame appear; extinguished torches lose their flame. Tween/object counts in the fps overlay drop.

- [ ] **Step 6: Commit**

```bash
git add www/js/scenes/DungeonScene.js
git commit -m "perf: single shared Graphics for all torch flames (was 1 Graphics per torch)"
```

---

### Task 7: Pool floating text and poof particles

**Files:**
- Modify: `www/js/scenes/DungeonScene.js:4914-4930` (`showFloatingText`), `:5172-5191` (`poofAt`); add two pool helpers next to `poofAt`.

- [ ] **Step 1: Add the pools**

Insert immediately above `poofAt` (line ~5172):

```js
    // === Object pools — combat spawns these every hit; create/destroy churn
    // causes GC stalls and (for Text) GPU texture uploads on Android ===
    _getPooledCircle(x, y, r, color, alpha) {
        if (!this._circlePool) this._circlePool = [];
        let c = this._circlePool.pop();
        if (!c) {
            c = this.add.circle(x, y, r, color, alpha);
        } else {
            c.setPosition(x, y).setRadius(r).setFillStyle(color, alpha)
             .setScale(1).setAlpha(alpha).setActive(true).setVisible(true);
        }
        return c;
    }

    _releaseCircle(c) {
        this.tweens.killTweensOf(c);
        c.setActive(false).setVisible(false);
        if (this._circlePool.length < 64) this._circlePool.push(c);
        else c.destroy();
    }

    _getPooledText(x, y, text, style) {
        if (!this._textPool) this._textPool = [];
        let t = this._textPool.pop();
        if (!t) {
            t = this.add.text(x, y, text, style);
        } else {
            t.setStyle(style).setText(text).setPosition(x, y)
             .setAlpha(1).setActive(true).setVisible(true);
        }
        return t;
    }

    _releaseText(t) {
        this.tweens.killTweensOf(t);
        t.setActive(false).setVisible(false);
        if (this._textPool.length < 24) this._textPool.push(t);
        else t.destroy();
    }
```

- [ ] **Step 2: Rewrite `poofAt` on the circle pool**

Replace the whole method:

```js
    poofAt(x, y, color) {
        // Bigger, juicier explosion: 12 particles in larger range (pooled)
        for (let i = 0; i < 12; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Phaser.Math.Between(20, 50);
            const p = this._getPooledCircle(x, y, Phaser.Math.Between(4, 8), color, 0.95).setDepth(600);
            this.tweens.add({
                targets: p, x: x + Math.cos(angle) * dist, y: y + Math.sin(angle) * dist,
                alpha: 0, scale: 0.2, duration: 450, ease: 'Quad.easeOut',
                onComplete: () => this._releaseCircle(p)
            });
        }
        // Flash ring
        const ring = this._getPooledCircle(x, y, 20, color, 0.6).setDepth(601);
        this.tweens.add({
            targets: ring, scale: 2.2, alpha: 0,
            duration: 300, ease: 'Quad.easeOut',
            onComplete: () => this._releaseCircle(ring)
        });
    }
```

- [ ] **Step 3: Rewrite `showFloatingText` on the text pool**

Replace the whole method (line ~4914):

```js
    showFloatingText(x, y, text, color, size) {
        const t = this._getPooledText(x, y, text, {
            fontFamily: '"Nunito", "Roboto", system-ui, sans-serif',
            fontSize: size + 'px', color,
            fontStyle: '900',
            stroke: '#0a0410', strokeThickness: 4,
        });
        t.setOrigin(0.5).setDepth(800).setScale(0.7);
        this.tweens.add({
            targets: t, scale: 1.05, duration: 140, ease: 'Back.easeOut',
        });
        this.tweens.add({ targets: t, y: y - 56, alpha: 0, duration: 1100, ease: 'Cubic.easeOut',
            onComplete: () => this._releaseText(t) });
    }
```

- [ ] **Step 4: Verify**

Run: fight through a room, spam pies at a wall of enemies. Expected: damage popups and poofs look identical; DevTools → Performance shows no `Text.destroy`/`Text` constructor churn during combat; no visual glitches when many popups overlap (pool reuse). Kill 20+ enemies to cycle the pools hard.

- [ ] **Step 5: Commit**

```bash
git add www/js/scenes/DungeonScene.js
git commit -m "perf: pool floating text and poof particles (no create/destroy in combat)"
```

---

### Task 8: Manual bob animation for cheese/heart/key/exit (kill 60-120 infinite tweens)

**Files:**
- Modify: `www/js/scenes/DungeonScene.js:4551-4560` (`placeCheese`), `:4608-4631` (`spawnHeart`), `:4633-4654` (`spawnKey`), `:4664-4668` (`spawnExitDoor` glow tween), `update()` (~line 304)

- [ ] **Step 1: `placeCheese` without tweens**

Replace (line ~4551):

```js
    placeCheese(x, y) {
        const sprite = this.add.image(x, y, 'd_cheese').setScale(0.8).setDepth(150);
        const glow = this.add.circle(x, y, 18, 0xffd040, 0.15).setDepth(149);
        this.pickups.push({ sprite, glow, x, y, taken: false, bobPhase: Math.random() * Math.PI * 2 });
    }
```

- [ ] **Step 2: `spawnHeart` without the two infinite tweens**

In `spawnHeart` (line ~4608) delete both `this.tweens.add({ ... yoyo: true, repeat: -1 ... })` blocks (the sprite bob and the glow pulse). Keep the 12 s despawn `delayedCall` and its fade tween. Change the final push to:

```js
        this.pickups.push({ sprite, glow, x, y, taken: false, heart: true, bobPhase: Math.random() * Math.PI * 2 });
```

- [ ] **Step 3: `spawnKey` without tweens**

In `spawnKey` (line ~4645) delete both infinite tweens and change the assignment to:

```js
        this.keyPickup = { sprite, glow, x, y, taken: false, bobPhase: Math.random() * Math.PI * 2 };
```

- [ ] **Step 4: `spawnExitDoor` glow without tween**

In `spawnExitDoor` (line ~4665) delete the `this.tweens.add({ targets: ringGlow, ... repeat: -1 })` block. (`this.exit.glow` is already stored; the bob updater below pulses it.)

- [ ] **Step 5: Add the culled updater and call it**

Add this method near `updateTorches`:

```js
    updatePickupBob() {
        // Replaces per-pickup infinite tweens: one pass, view-culled, sin-driven
        const cam = this.cameras.main;
        const L = cam.scrollX - 60, R = cam.scrollX + cam.width + 60;
        const T = cam.scrollY - 60, B = cam.scrollY + cam.height + 60;
        const t = this.time.now;
        for (const pk of this.pickups) {
            if (pk.taken) continue;
            if (pk.x < L || pk.x > R || pk.y < T || pk.y > B) continue;
            const s = Math.sin(t * 0.0035 + (pk.bobPhase || 0));
            pk.sprite.y = pk.y - 3 - s * 3;
            if (pk.glow) pk.glow.setAlpha(0.095 + 0.055 * s);
        }
        const k = this.keyPickup;
        if (k && !k.taken && k.x >= L && k.x <= R && k.y >= T && k.y <= B) {
            const s = Math.sin(t * 0.0031 + (k.bobPhase || 0));
            k.sprite.y = k.y - 3 - s * 3;
            k.sprite.setAngle(s * 8);
            k.glow.setAlpha(0.14 + 0.08 * s);
        }
        const ex = this.exit;
        if (ex && ex.glow && ex.x >= L && ex.x <= R && ex.y >= T && ex.y <= B) {
            const s = Math.sin(t * 0.0022);
            ex.glow.setScale(1.15 + 0.15 * s);
            ex.glow.setAlpha(0.125 + 0.055 * s);
        }
    }
```

In `update()` add the call right after `this.updateTorches(totalDt);` (line ~304):

```js
        this.updatePickupBob();
```

- [ ] **Step 6: Verify**

Run: story floor 1 with `?fps=1`. Expected: cheese/key/exit still gently bob and pulse; the `tweens` count in the overlay drops by dozens (typically from >100 to <40); collecting cheese/heart/key still plays its one-shot collect animation correctly (collect anims tween `pk.sprite`, and `taken=true` stops the bob writer from fighting them).

- [ ] **Step 7: Commit**

```bash
git add www/js/scenes/DungeonScene.js
git commit -m "perf: view-culled manual bob for cheese/heart/key/exit, removing 60-120 infinite tweens"
```

---

### Task 9: Kill per-frame allocations in the hot path

**Files:**
- Modify: `www/js/scenes/DungeonScene.js:3722` (enemies filter), `:5141-5164` (`queryWallsAround`), `:4026-4049` (`buildDijkstraMap`), `:4100-4128` (`dijkstraStepFrom`), `:2576` (`exitBtnArea` closure), `:4280-4290` (`_shake` config), `:5477` (powerup emoji literal), `:2317` and `:3768` (`lastSeen` object literals)

- [ ] **Step 1: enemies compaction in place**

Replace (line ~3722):

```js
        this.enemies = this.enemies.filter(e => !(e.dead && e.cleanedUp));
```

with:

```js
        // In-place compaction — no new array/closure per substep
        let w = 0;
        for (let i = 0; i < this.enemies.length; i++) {
            const e = this.enemies[i];
            if (!(e.dead && e.cleanedUp)) this.enemies[w++] = e;
        }
        this.enemies.length = w;
```

- [ ] **Step 2: scratch buffers in `queryWallsAround`**

Replace the multi-cell path (lines ~5152-5163):

```js
        const seen = new Set();
        const result = [];
        for (let r = sR; r <= eR; r++) {
```

with:

```js
        if (!this._wallSeen) { this._wallSeen = new Set(); this._wallScratch = []; }
        const seen = this._wallSeen;
        const result = this._wallScratch;
        seen.clear();
        result.length = 0;
        for (let r = sR; r <= eR; r++) {
```

(the loop body and `return result;` stay). Callers consume the result synchronously before the next query — reuse is safe.

- [ ] **Step 3: persistent Int32Arrays in `buildDijkstraMap`**

Replace (lines ~4029 and ~4045):

```js
        const map = new Int32Array(size);
```
```js
        const queue = new Int32Array(size);
```

with a per-clearance scratch (insert at the top of the method after `const size = W * H;`):

```js
        if (!this._dijScratch) this._dijScratch = {};
        let scratch = this._dijScratch[minClearCells];
        if (!scratch) {
            scratch = { map: new Int32Array(size), queue: new Int32Array(size) };
            this._dijScratch[minClearCells] = scratch;
        }
        const map = scratch.map;
```

and where `queue` was allocated:

```js
        const queue = scratch.queue;
```

This is correct because the two live maps (`dijkstraMapSmall` = clearance 1, `dijkstraMapBoss` = clearance 2) use different keys, and each rebuild starts with `map.fill(INFTY)` which already exists at line ~4031.

- [ ] **Step 4: reuse the step object in `dijkstraStepFrom`**

Replace (line ~4127):

```js
        return { tx: (bestC + 0.5) * NAV_CELL, ty: (bestR + 0.5) * NAV_CELL };
```

with:

```js
        if (!this._dijStep) this._dijStep = { tx: 0, ty: 0 };
        this._dijStep.tx = (bestC + 0.5) * NAV_CELL;
        this._dijStep.ty = (bestR + 0.5) * NAV_CELL;
        return this._dijStep;
```

(callers use the result immediately and never store it — verify with `grep -n "dijkstraStepFrom" www/js/scenes/DungeonScene.js`; expected callers: `followPath` only.)

- [ ] **Step 5: hoist the exit-button closure**

In `updatePlayer` replace (line ~2576):

```js
        const exitBtnArea = (p) => p && p.x > this.cameras.main.width - 60 && p.y < 60;
        if (this.keys.SPACE.isDown) this.tryShoot();
        const mouse = this.input.mousePointer;
        if (mouse && mouse.isDown && !exitBtnArea(mouse)) this.tryShoot();
```

with:

```js
        if (this.keys.SPACE.isDown) this.tryShoot();
        const mouse = this.input.mousePointer;
        if (mouse && mouse.isDown && !this._inExitBtnArea(mouse)) this.tryShoot();
```

and add the method next to `updatePlayer`:

```js
    _inExitBtnArea(p) {
        return p && p.x > this.cameras.main.width - 60 && p.y < 60;
    }
```

- [ ] **Step 6: static `_shake` config + powerup emoji table**

Above the class (next to the `PLAYER` const, line ~33) add:

```js
const SHAKE_CFG = {
    sm:  { dur: 80,  amt: 0.004 },
    med: { dur: 140, amt: 0.010 },
    big: { dur: 220, amt: 0.018 },
    huge:{ dur: 380, amt: 0.026 },
};
const POWERUP_EMOJI = { triple: '🎯', speed: '⚡', shield: '🛡️', fire: '🔥' };
```

In `_shake` (line ~4283) replace the inline object with:

```js
        const cfg = SHAKE_CFG[tier] || SHAKE_CFG.sm;
```

In `updateHUD` (line ~5477) replace:

```js
            const emoji = { triple: '🎯', speed: '⚡', shield: '🛡️', fire: '🔥' }[this.activePowerup.type];
```

with:

```js
            const emoji = POWERUP_EMOJI[this.activePowerup.type];
```

- [ ] **Step 7: mutate `lastSeen` in place**

Run `grep -n "lastSeen = {" www/js/scenes/DungeonScene.js` (expected: ~line 2317 in `throwDistractionBook`, ~line 3768 in enemy LOS). Replace each `X.lastSeen = { x: A, y: B };` with:

```js
        if (!X.lastSeen) X.lastSeen = { x: 0, y: 0 };
        X.lastSeen.x = A; X.lastSeen.y = B;
```

(substitute the actual receiver/expressions at each site; verify no other code holds a long-lived reference to a `lastSeen` object — `grep -n "lastSeen" www/js/scenes/DungeonScene.js` and check each read site uses `.x/.y` immediately).

- [ ] **Step 8: Verify**

Run: story floor with `?fps=1`, fight, let a guard chase you (exercises Dijkstra + lastSeen), throw a distraction book from keyboard (B). Expected: identical behavior; in DevTools → Performance → Memory, the sawtooth GC allocation rate during combat is visibly flatter.

- [ ] **Step 9: Commit**

```bash
git add www/js/scenes/DungeonScene.js
git commit -m "perf: remove per-frame allocations (enemy filter, wall queries, dijkstra arrays, closures)"
```

---

### Task 10: Fix the stuck slow-motion bug and add timeScale hygiene

**Files:**
- Modify: `www/js/scenes/DungeonScene.js:4293-4310` (`_hitStop`), `create()` (timeScale reset + shutdown hook)

- [ ] **Step 1: Track and clear the hit-stop timeout**

Replace `_hitStop` (line ~4293):

```js
    // Brief slow-motion freeze for impact emphasis.
    _hitStop(ms) {
        if (!ms || ms <= 0) return;
        // Avoid stacking hit-stops within a window.
        if (this._hitStopUntil && this.time.now < this._hitStopUntil) return;
        this._hitStopUntil = this.time.now + ms;
        this.time.timeScale = 0.05;
        this.tweens.timeScale = 0.05;
        // Restore on REAL time (scene clock is scaled to 0.05 right now).
        // Tracked so shutdown can cancel it — otherwise a floor transition
        // during the freeze leaves the next scene stuck at 5% speed.
        if (this._hitStopTimeout) clearTimeout(this._hitStopTimeout);
        this._hitStopTimeout = setTimeout(() => {
            this._hitStopTimeout = null;
            if (!this.sys || !this.scene || !this.sys.isActive()) return;
            this.time.timeScale = 1;
            this.tweens.timeScale = 1;
        }, ms);
    }
```

- [ ] **Step 2: Reset scales on create, clean up on shutdown**

In `create()`, add as the FIRST two lines of the method:

```js
        // A hit-stop setTimeout from the previous floor may have died with the
        // scene — never inherit a scaled clock.
        this.time.timeScale = 1;
        this.tweens.timeScale = 1;
```

And next to the existing `this.events.once('shutdown', ...)` registration in `create()` (the one cleaning up the resize listener, line ~280), add:

```js
        this.events.once('shutdown', () => {
            if (this._hitStopTimeout) { clearTimeout(this._hitStopTimeout); this._hitStopTimeout = null; }
        });
```

- [ ] **Step 3: Verify**

Run: hit an enemy (hit-stop triggers), then immediately walk into the exit during the freeze window (spam it a few times across a floor transition). Expected: next floor always runs at normal speed. Also die during a hit-stop → restart runs at normal speed.

- [ ] **Step 4: Commit**

```bash
git add www/js/scenes/DungeonScene.js
git commit -m "fix: hit-stop can no longer leave the scene stuck in 5% slow motion across restarts"
```

---

### Task 11: Dirty-flag the per-frame HUD Graphics (compass, dash arc)

**Files:**
- Modify: `www/js/scenes/DungeonScene.js:5889-5940` (`updateCompass`), `:5612-5635` (`updateDashButton`)

- [ ] **Step 1: Compass redraws only when the angle or target changes**

In `updateCompass`, after `const angle = Math.atan2(dy, dx);` (line ~5910) insert:

```js
        // Skip the clear+retessellate when nothing moved meaningfully
        const key = emoji + '|' + this.cameras.main.width;
        if (this._compassKey === key && Math.abs((this._compassAngle ?? 99) - angle) < 0.02) return;
        this._compassKey = key;
        this._compassAngle = angle;
```

(everything below — ring position, clear, triangle, label — is unchanged and now runs only on change; the `!target` branch above already clears when the target disappears, and set `this._compassKey = null;` inside that branch right before `return` so the arrow redraws when a target reappears).

- [ ] **Step 2: Dash arc redraws only when the ready-state or arc length changes**

In `updateDashButton` (line ~5612), after the `const maxCd = ...` line insert:

```js
        const p = cdMs <= 0 ? -1 : Math.round((1 - Math.min(1, cdMs / maxCd)) * 50); // 2% buckets
        if (this._dashArcP === p) return;
        this._dashArcP = p;
```

and remove nothing else — `clear()` stays as the next statement.

- [ ] **Step 3: Verify**

Run: stand still with no aim input → DevTools Performance shows no per-frame Graphics work from compass/dash; move and dash → arrow and cooldown arc animate as before.

- [ ] **Step 4: Commit**

```bash
git add www/js/scenes/DungeonScene.js
git commit -m "perf: dirty-flag compass and dash-cooldown redraws"
```

---

### Task 12: Device verification + wrap-up

**Files:**
- Modify: none (verification); optionally remove nothing — the fps overlay stays behind `?fps=1` for later phases.

- [ ] **Step 1: Sync to Android**

Run: `node node_modules/@capacitor/cli/bin/capacitor sync` (Node is at `/opt/homebrew/bin/node` if not in PATH).
Expected: sync completes without errors.

- [ ] **Step 2: On-device acceptance run**

On the phone: main menu → Transylvania → menu appears < 1 s → start story → play 2 floors, fight, use dash, light a torch, collect key, descend.
Expected (spec §11 items 1, 2, 3, 10): smooth 60 fps feel in combat; single Phaser boot; floor transition never stuck in slow-mo; visuals identical to before Phase 1.

- [ ] **Step 3: Record after-numbers and commit any final tweaks**

Compare against Task 1 baseline (fps + tween count) and put both numbers in the final commit message:

```bash
git add -u www/js/scenes/DungeonScene.js www/index.html
git commit -m "perf: phase 1 complete — baseline <X> fps / <N> tweens → <Y> fps / <M> tweens"
```

---

## Out of scope for this plan (later phases)

- Main-menu button cosmetics from spec §1 — visual work, goes with the menu restyle (Phase 7).
- Decor prop Graphics merge/bake — Phase 2 redraws all painters (spec §4), baking happens there.
- Emoji → SVG replacements, HUD layout, biome darkness values — Phase 2 (spec §4, §5).
- Touch buttons for crouch/book, aim assist, haptics — Phase 3 (spec §8).
- Procedural floors 2-5 — Phase 4 (spec §9).
- Remaining minor `repeat: -1` tweens (chests, powerups, forbidden books, spooky eyes) — folded into Phase 2 when those objects get restyled.
