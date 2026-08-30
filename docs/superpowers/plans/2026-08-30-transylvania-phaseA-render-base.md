# Transylvania Phase A — Render Base & Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Transylvania mode renders crisply at device resolution (no browser upscaling), with anti-aliased shapes, its own themed loading screen, a clean story intro (HUD/sticks hidden, touch-aware hints, no emoji), and the Nunito font bundled locally and ready before the first frame (spec `docs/superpowers/specs/2026-08-30-transylvania-art-overhaul.md` §3.A).

**Architecture:** For `?mode=transylvania` only, `main.js` boots Phaser in `Scale.NONE` with game size = CSS size × `DPR` (integer, ≤3) and `zoom = 1/DPR`, so the canvas backing store is device pixels while its CSS size is unchanged; `resolution: DPR` makes every `Text` rasterise at device resolution. `DungeonScene` zooms its camera by `DPR` (world units stay CSS px), keeps all screen-space objects in two fixed containers (`fxLayer` for the darkness RT, `uiLayer` for HUD/touch/overlays) whose offset makes child coordinates equal CSS px, and converts pointer coordinates to CSS px at the six input entry points. Everything else (HUD layout, touch maths, lighting formulas, world bake) keeps working in CSS px. Other modes (snowball/GameScene) are untouched: they keep `Scale.RESIZE` and `DPR = 1`.

**Tech Stack:** Phaser **3.70.0** (CDN, `www/game-phaser.html` ~line 243; `node_modules` is 3.90 — verify against 3.70 semantics, they are unchanged for ScaleManager/Container/Camera), ES modules, Capacitor 5 Android WebView, headless-Chromium screenshot pipeline (see memory `screenshot-pipeline`; scratchpad `shoot.cjs`).

**Ground rules:** stage only the files each task names (never `git add -A`); no refactors/comments outside the snippets; Scene instance is reused on restart → every new field is (re)assigned in `create()`; syntax-check with `cp <file> <scratch>/x.mjs && /opt/homebrew/bin/node --check <scratch>/x.mjs`; `node --test tools/tests/hudLayout.test.mjs` must stay green; after all tasks `cap sync`.

**Verified facts (2026-08-30, HEAD `fdb163a`):**
- `www/js/main.js`: `urlParams`/`mode` at 17-18; config object 52-80 (`scale` 61-67 RESIZE; `render` 68-78 with `antialias:false, antialiasGL:false`); `const game = new Phaser.Game(config)` at 85; debounced resize handler 110-116 calls `game.scale.refresh()`.
- Phaser `ScaleManager.updateScale` RESIZE branch sets `canvas.width = parent CSS width` and ignores `zoom` → backing store is CSS px today. In `Scale.NONE`, `resize(w,h)` sets `canvas.width/height = w,h` and `style.width/height = w*zoom, h*zoom` (source `node_modules/phaser/src/scale/ScaleManager.js` 831-880).
- `Config.js:32` — `resolution: ['resolution', 0]` exists; `TextStyle.resolution` 0 → uses game config resolution.
- `Container.addHandler` (Container.js:431-444) removes the child from the scene display list; `Container.sort('depth')` exists (621); `ContainerWebGLRenderer` multiplies child scrollFactor by the container's (122).
- `Camera.js:503`: `renderRoundPixels` only when zoom is an integer → use an **integer** DPR.
- `DungeonScene.js` (~6960 lines): `create()` 226-345 — `state='intro'` 236, `setBounds` 321, `startFollow` 323, keyboard 284-287, `IS_TOUCH` block 294-314 (touch setup 295, `setTouchUIVisible(isMobileUA)` 297, pointer handlers 303/311), `setupLighting()` 327, `setupCrosshair()` 330, LINEAR-filter loop 331-337, `buildHUD()` 339, `scale.on('resize')` ~350, `showStoryIntro()` last. `setupLighting` 406-428 (`lightRT` camera-sized at 422, depth 700, scrollFactor 0), `updateLighting` 469-526 (`rt.resize` check 474-476, comment "assumes cam.zoom === 1" 478, `inView` uses `cam.width/height` 481-483, light positions `x - ox` = world − scroll). `IS_TOUCH` const at 113. Touch pointer handlers 5940-5943 (`touchDown/touchMove/touchUp`), exit button 5755. `cam.width/cam.height/cameras.main.width/height` used at 34 sites (HUD/touch/overlays/culling). 70 `setScrollFactor(0)` objects. `hudLayout.computeHudLayout` accepts a `uiScale` override.
- `BootScene.js`: loader drawn in `preload()` 12-112 (bg 21, snowflakes 29, 🐭 36, title 40, subtitle '❄️ Снежные битвы ❄️' 48, progress box/bar 62-66, tips incl. '💡 Прыгай с помощью ПРОБЕЛ или W' 89, progress handler 98-112); mode read in `create()` 181 from `config.mode`; transylvania branch 186-201.
- Story intro `showStoryIntro()` ~5570-5690: hint label 5661-5663 (`IS_TOUCH` ternary with ◀ ▶ 💨 emoji), `drawGothicButton('▶ НАЧАТЬ')` 5682; dismissal tween sets `state='play'` ~5686-5692.
- `www/game-phaser.html`: Google Fonts `<link>` 13-15; `#game-container` CSS 36-44; canvas CSS 45.
- Nunito woff2 (Cyrillic subset is a separate file — download the full CSS and take the `cyrillic` + `latin` blocks): `curl -sL -A "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36" "https://fonts.googleapis.com/css2?family=Nunito:wght@400;700;900&display=swap"` returns `@font-face` blocks with `unicode-range` and `.woff2` URLs on fonts.gstatic.com.

---

### Task 1: Bundle Nunito locally and boot Phaser after the font is ready

**Files:**
- Create: `www/assets/fonts/nunito-{400,700,900}-{latin,cyrillic}.woff2` (6 files), `www/assets/fonts/nunito.css`
- Modify: `www/game-phaser.html` (font link → local CSS), `www/js/main.js` (boot after `document.fonts`)

- [ ] **Step 1: Download the font files**

```bash
mkdir -p www/assets/fonts
UA="Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36"
curl -sL -A "$UA" "https://fonts.googleapis.com/css2?family=Nunito:wght@400;700;900&display=swap" > /tmp/nunito.css
# For each weight, the CSS has one @font-face block per subset; take the `cyrillic` and `latin` blocks (NOT cyrillic-ext/latin-ext/vietnamese).
python3 - <<'EOF'
import re, urllib.request, pathlib
css = open('/tmp/nunito.css').read()
blocks = re.findall(r'/\* (\w[\w-]*) \*/\s*@font-face \{(.*?)\}', css, re.S)
out = []
for subset, body in blocks:
    if subset not in ('latin', 'cyrillic'): continue
    weight = re.search(r'font-weight: (\d+)', body).group(1)
    url = re.search(r'url\((https://[^)]+\.woff2)\)', body).group(1)
    rng = re.search(r'unicode-range: ([^;]+);', body).group(1)
    name = f'nunito-{weight}-{subset}.woff2'
    urllib.request.urlretrieve(url, f'www/assets/fonts/{name}')
    out.append(f"@font-face {{ font-family: 'Nunito'; font-style: normal; font-weight: {weight}; font-display: swap; src: url('{name}') format('woff2'); unicode-range: {rng}; }}")
pathlib.Path('www/assets/fonts/nunito.css').write_text('\n'.join(out) + '\n')
print(len(out), 'faces')
EOF
ls -la www/assets/fonts/     # 6 woff2 (each 10-30 KB) + nunito.css
```
Expected: `6 faces`.

- [ ] **Step 2: Use the local CSS in `game-phaser.html`** — replace the three Google Fonts lines (`<link rel="preconnect" …googleapis>`, `<link rel="preconnect" …gstatic…>`, `<link href="https://fonts.googleapis.com/css2?family=Nunito…">`) with:

```html
    <link rel="stylesheet" href="assets/fonts/nunito.css">
```
(keep the comment line above them). `grep -n "googleapis\|gstatic" www/game-phaser.html` → no hits.

- [ ] **Step 3: Boot after the font loads** — in `www/js/main.js` replace `const game = new Phaser.Game(config);` (line 85) with:

```js
// Wait for Nunito so the first Text textures don't bake a fallback font (bounded to 1.5 s).
let game = null;
const _boot = () => { if (!game) game = new Phaser.Game(config); };
if (document.fonts && document.fonts.load) {
    Promise.race([
        Promise.all([document.fonts.load('400 16px Nunito'), document.fonts.load('700 16px Nunito'), document.fonts.load('900 16px Nunito')]),
        new Promise((r) => setTimeout(r, 1500)),
    ]).then(_boot, _boot);
} else {
    _boot();
}
```
Then check every other use of `game` in `main.js` (`grep -n "\bgame\b" www/js/main.js`): the resize handler (`game.scale.refresh()`) already sits in a `try {}` — make it `if (game) game.scale.refresh();` inside the try; any `export`/`window.game =` assignment must move inside `_boot` (after the `new`). If `game` is exported as a const binding elsewhere, report it.

- [ ] **Step 4: Verify** — `node --check` on a copy of `main.js`; serve `www/` (`python3 -m http.server 8765 --bind 127.0.0.1` in the background if not running) and screenshot `http://127.0.0.1:8765/game-phaser.html?mode=transylvania&runMode=story` with the pipeline (12 s) → intro title renders in Nunito 900 (rounded terminals, not Arial); DevTools-less check: `curl -sI http://127.0.0.1:8765/assets/fonts/nunito-900-cyrillic.woff2 | head -1` → 200.

- [ ] **Step 5: Commit**

```bash
git add www/assets/fonts www/game-phaser.html www/js/main.js
git commit -m "feat(platform): bundle Nunito locally and boot Phaser after fonts load (offline-safe, no fallback-font first frame)"
```

---

### Task 2: Anti-aliasing on; drop the manual LINEAR loop

**Files:**
- Modify: `www/js/main.js` (render config), `www/js/scenes/DungeonScene.js` (remove the filter loop 331-337)

- [ ] **Step 1:** In `main.js` `render:` change `antialias: false,` → `antialias: true,` and `antialiasGL: false,` → `antialiasGL: true,`. Keep `pixelArt: false`, `roundPixels: true`, `autoMobilePipeline: false` and its comment untouched.
- [ ] **Step 2:** In `DungeonScene.js` delete the whole block (comment + `for` loop) that starts with `// Vector-sourced textures (characters, skins, HUD icons) are drawn well below their source size` and calls `setFilter(Phaser.Textures.FilterMode.LINEAR)` — with `antialias:true` Phaser defaults every texture to LINEAR. `grep -n "FilterMode" www/js/scenes/DungeonScene.js` → no hits.
- [ ] **Step 3:** Syntax check both files; screenshot the game with a held touch (pipeline `g3-sticks.png` step) → stick rings and knob edges are smooth, no staircase.
- [ ] **Step 4: Commit** — `git add www/js/main.js www/js/scenes/DungeonScene.js && git commit -m "render: enable WebGL anti-aliasing (smooth sticks/rings/arrows); textures default to LINEAR"`

---

### Task 3: Device-resolution rendering for the Transylvania mode (DPR)

**Files:**
- Modify: `www/js/main.js` (mode-specific scale config, DPR export, resize handler), `www/js/scenes/DungeonScene.js` (camera zoom, fixed layers, `viewW/viewH`, pointer conversion, lightRT size)

Design (do not deviate without reporting):
- `DPR = 1` for every mode except `transylvania`; for `transylvania`: `DPR = clamp(Math.ceil(window.devicePixelRatio || 1), 1, 3)`, overridable by `?dpr=<n>` (kill-switch `?dpr=1`). Integer → `roundPixels` stays effective.
- Transylvania scale config: `{ mode: Phaser.Scale.NONE, parent: 'game-container', autoCenter: Phaser.Scale.NO_CENTER, width: cssW * DPR, height: cssH * DPR, zoom: 1 / DPR }` where `cssW/cssH` = `#game-container` client size (fallback `window.innerWidth/innerHeight`). `resolution: DPR` at the top level of the config (Text rasterisation). The resize handler calls `game.scale.resize(cssW * DPR, cssH * DPR)` for transylvania and `game.scale.refresh()` otherwise. Expose `window.__GAME_DPR = DPR` before the game boots.
- `DungeonScene`: `this.dpr = window.__GAME_DPR || 1`; getters `viewW = cameras.main.width / dpr`, `viewH = cameras.main.height / dpr` (CSS px = world px). `cameras.main.setZoom(this.dpr)` immediately after `setBounds`. Two fixed containers created right after the camera setup: `this.fxLayer` (depth 700) and `this.uiLayer` (depth 989), both `setScrollFactor(0)`, scale 1, positioned at `(viewW * (dpr - 1) / 2, viewH * (dpr - 1) / 2)` — with camera zoom `z` about the camera centre, a fixed object at container-local `(X, Y)` lands on screen at device px `(X·z, Y·z)`, i.e. **child coordinates are CSS px**. Every screen-space object (scrollFactor 0) is moved into a layer by `_pinFixed()`: `lightRT` (depth 700) → `fxLayer`; everything else → `uiLayer` sorted by `depth`. Floating world text (depth 800, scrollFactor 1) stays on the display list between the two layers.
- Pointer coordinates arrive in device px; the six `this.input.on(...)` entry points wrap the pointer with `_cssPointer(p)` → `{ x: p.x / dpr, y: p.y / dpr, worldX: p.worldX, worldY: p.worldY, id: p.id, isDown: p.isDown, pointer: p }` (add fields the handlers actually read — grep them). Interactive objects (exit button, gothic buttons/cards) are hit-tested by Phaser through the container/camera transforms — no change.
- All 34 `cam.width/cam.height/cameras.main.width/height` reads become `this.viewW/this.viewH` (they all want the visible CSS-px size: HUD layout, touch layout, overlays, culling, lightRT size). `lightRT` is created at `viewW × viewH` and resized against `viewW/viewH`; light positions (`x - cam.scrollX`) are already CSS px under zoom — unchanged. Update the comment at 478.

- [ ] **Step 1: `main.js`** — after `const mode = urlParams.get('mode') || 'menu';` add:

```js
// Device-pixel rendering for the Transylvania mode only (other modes keep RESIZE at 1×).
const _dprParam = parseFloat(urlParams.get('dpr'));
const DPR = (mode === 'transylvania')
    ? Math.max(1, Math.min(3, Number.isFinite(_dprParam) ? Math.round(_dprParam) : Math.ceil(window.devicePixelRatio || 1)))
    : 1;
window.__GAME_DPR = DPR;
const _cssSize = () => {
    const el = document.getElementById('game-container');
    const w = (el && el.clientWidth) || window.innerWidth, h = (el && el.clientHeight) || window.innerHeight;
    return { w: Math.max(1, Math.floor(w)), h: Math.max(1, Math.floor(h)) };
};
```
In the config object replace the `scale: {...}` block with:
```js
    scale: (mode === 'transylvania')
        ? { mode: Phaser.Scale.NONE, parent: 'game-container', autoCenter: Phaser.Scale.NO_CENTER,
            width: _cssSize().w * DPR, height: _cssSize().h * DPR, zoom: 1 / DPR }
        : { mode: Phaser.Scale.RESIZE, parent: 'game-container', autoCenter: Phaser.Scale.CENTER_BOTH, width: '100%', height: '100%' },
    resolution: DPR,
```
and in the resize handler replace `game.scale.refresh();` with:
```js
            if (!game) return;
            if (mode === 'transylvania') { const s = _cssSize(); game.scale.resize(s.w * DPR, s.h * DPR); }
            else game.scale.refresh();
```
(`width: GAME.WIDTH, height: GAME.HEIGHT` at the top level stay — the scale block wins.) Verify `game-container` fills the viewport (`game-phaser.html` CSS 36-44: `position:fixed; inset:0` or width/height 100%) — if it is sized by the canvas instead, use `window.inner*` in `_cssSize`.

- [ ] **Step 2: `DungeonScene` fields + getters** — in `create()`'s reset block add `this.dpr = window.__GAME_DPR || 1; this.fxLayer = null; this.uiLayer = null;`. Add to the class (near `buildHUD`):

```js
    get viewW() { return this.cameras.main.width / this.dpr; }
    get viewH() { return this.cameras.main.height / this.dpr; }
    _layerOffset() { return { x: this.viewW * (this.dpr - 1) / 2, y: this.viewH * (this.dpr - 1) / 2 }; }
    _createFixedLayers() {
        const o = this._layerOffset();
        this.fxLayer = this.add.container(o.x, o.y).setScrollFactor(0).setDepth(700);
        this.uiLayer = this.add.container(o.x, o.y).setScrollFactor(0).setDepth(LAYER.UI_TOUCH);
    }
    // Move every top-level screen-space object into its fixed layer (call after creating HUD/overlays).
    _pinFixed() {
        if (!this.uiLayer) return;
        const list = this.sys.displayList.list;
        let moved = false;
        for (let i = list.length - 1; i >= 0; i--) {
            const o = list[i];
            if (o === this.uiLayer || o === this.fxLayer || o.scrollFactorX !== 0 || o.parentContainer) continue;
            (o.depth <= 800 ? this.fxLayer : this.uiLayer).add(o);
            moved = true;
        }
        if (moved) this.uiLayer.sort('depth');
    }
    _cssPointer(p) {
        const d = this.dpr;
        return { x: p.x / d, y: p.y / d, worldX: p.worldX, worldY: p.worldY, id: p.id, isDown: p.isDown, pointer: p };
    }
```
Call `this._createFixedLayers();` right after `this.cameras.main.setBounds(...)` and add `this.cameras.main.setZoom(this.dpr);` on the next line (before `startFollow`).

- [ ] **Step 3: Pin after creation** — add `this._pinFixed();` (a) at the end of `create()` (after `showStoryIntro()`), (b) at the end of `showStoryIntro()`, `showRelicPicker()`, `showUpgradePicker()`, `openInRunShop()`, `showOverlay()`, `flashNoCheese()` (after their objects exist; for methods that create objects inside callbacks/tweens, pin inside the callback too), and (c) inside `updateHUD()`'s add-hearts-on-demand branch after `repositionHUD()`. `grep -n "_pinFixed()" www/js/scenes/DungeonScene.js` → ≥ 8 sites. Also in `repositionHUD()` (called on resize) update the layer positions: `const o = this._layerOffset(); this.fxLayer.setPosition(o.x, o.y); this.uiLayer.setPosition(o.x, o.y);` (guard `if (this.uiLayer)`).

- [ ] **Step 4: CSS-px sizes everywhere** — replace every `cam.width` → `this.viewW`, `cam.height` → `this.viewH`, `this.cameras.main.width/height` → `this.viewW/viewH` (34 sites: `grep -n "cam\.width\|cam\.height\|cameras\.main\.width\|cameras\.main\.height"`). Special cases: `setupLighting` creates `lightRT` at `(this.viewW, this.viewH)`; `updateLighting` compares `rt.width !== this.viewW` and replaces the comment at 478 with `// Light positions are world − scroll = CSS px; the camera zoom (dpr) maps them to device px via fxLayer`. After the replacement `grep -c "this.viewW\|this.viewH"` ≥ 34 and the old patterns → 0 hits (except inside the two getters).

- [ ] **Step 5: Pointer entry points** — at the six `this.input.on(...)` handlers (303, 311, 5940-5943) pass `this._cssPointer(p)` instead of `p` (e.g. `(p) => this.touchDown(this._cssPointer(p))`). Read `touchDown/touchMove/touchUp` and the two aim handlers: every pointer field they read must exist on the proxy — extend `_cssPointer` if needed (e.g. `event`, `button`, `wasTouch`, `pointerType`); report the final field list. `p.worldX/worldY` stay world px (Phaser applies the zoom) — used by the mouse aim code.

- [ ] **Step 6: Safe-area and HUD scale** — `repositionHUD()` and the two fallback layout calls now pass `W: this.viewW, H: this.viewH` (done by Step 4); `readSafeArea()` returns CSS px — correct as is. Nothing else in `hudLayout` changes (uiScale stays CSS-based; Text crispness comes from `resolution: DPR`).

- [ ] **Step 7: Verify**
  - Syntax check; `node --test tools/tests/hudLayout.test.mjs` green.
  - Screenshot pipeline at `deviceScaleFactor: 2` (Playwright `shoot.cjs`, viewport 915×412): (1) `?dpr=1` baseline, (2) default (DPR 2): HUD text and hearts visibly sharper, sticks appear at the same CSS size and position as in (1), story intro centred, exit button in the top-right corner, floating text ("🧀 Тайник!" etc.) still bright above the darkness, cone light follows the player.
  - Also 360×640 (portrait emulation is blocked by the rotate overlay in index.html but `game-phaser.html` renders) — HUD in the corners, no offset drift.
  - Console: no errors; `game.scale.gameSize` = 1830×824 for 915×412 @2.
  - Report the measured `game.canvas.width/height` and `style.width/height` from `page.evaluate`.

- [ ] **Step 8: Commit**

```bash
git add www/js/main.js www/js/scenes/DungeonScene.js
git commit -m "render: device-pixel canvas for Transylvania (camera zoom = DPR, fixed UI layers in CSS px, Text resolution), ?dpr= override"
```

---

### Task 4: Themed loading screen for the Transylvania mode

**Files:**
- Modify: `www/js/scenes/BootScene.js` (`preload()` loader block 12-112)

- [ ] **Step 1:** At the top of `preload()` read the mode: `const mode = new URLSearchParams(window.location.search).get('mode') || 'menu'; const isCastle = (mode === 'transylvania');` (BootScene already reads `config.mode` in `create()` — reuse that source if it is reachable in `preload()`; otherwise the URL).
- [ ] **Step 2:** Wrap the existing snow loader (bg fill, snowflakes, 🐭, title, subtitle, blue progress box/bar, tips, progress handler) so it runs only when `!isCastle`, and add the castle variant (same `progress`/`complete` wiring, same element cleanup list):

```js
        if (isCastle) {
            const bg = this.add.graphics();
            bg.fillGradientStyle(0x1a0c2e, 0x1a0c2e, 0x07030f, 0x07030f, 1);
            bg.fillRect(0, 0, width, height);
            // Moon + glow
            const moon = this.add.graphics();
            moon.fillStyle(0xfff4c8, 0.12); moon.fillCircle(width * 0.82, height * 0.22, 74);
            moon.fillStyle(0xfff4c8, 1);    moon.fillCircle(width * 0.82, height * 0.22, 46);
            moon.fillStyle(0x1a0c2e, 1);    moon.fillCircle(width * 0.85, height * 0.20, 40);
            // Castle silhouette (three towers)
            const castle = this.add.graphics();
            castle.fillStyle(0x0b0616, 1);
            castle.fillRect(0, height * 0.78, width, height * 0.22);
            for (const [cx, w, h] of [[width * 0.18, 70, 150], [width * 0.5, 110, 210], [width * 0.8, 70, 150]]) {
                castle.fillRect(cx - w / 2, height * 0.78 - h, w, h);
                for (let i = -2; i <= 2; i++) castle.fillRect(cx + i * (w / 4) - 6, height * 0.78 - h - 16, 12, 16);
            }
            const F = '"Nunito", "Roboto", system-ui, sans-serif';
            const titleText = this.add.text(width / 2, height * 0.30, 'МЫШОНОК ПИ', {
                fontFamily: F, fontSize: '54px', fontStyle: '900', color: '#f3d27a', stroke: '#1a0a2e', strokeThickness: 8,
            }).setOrigin(0.5);
            const subtitleText = this.add.text(width / 2, height * 0.30 + 46, 'и Замок Теней', {
                fontFamily: F, fontSize: '26px', fontStyle: '700', color: '#d8c0f0', stroke: '#1a0a2e', strokeThickness: 5,
            }).setOrigin(0.5);
            const barWidth = Math.min(420, width * 0.6), barHeight = 22, barX = width / 2 - barWidth / 2, barY = height * 0.58;
            const progressBox = this.add.graphics();
            progressBox.fillStyle(0x0d0618, 0.95); progressBox.fillRoundedRect(barX - 4, barY - 4, barWidth + 8, barHeight + 8, 12);
            progressBox.lineStyle(2, 0xe8b54a, 0.8); progressBox.strokeRoundedRect(barX - 4, barY - 4, barWidth + 8, barHeight + 8, 12);
            const progressBar = this.add.graphics();
            const loadingText = this.add.text(width / 2, barY + barHeight + 28, 'Замок просыпается…', {
                fontFamily: F, fontSize: '18px', fontStyle: '700', color: '#c8b0e8',
            }).setOrigin(0.5);
            const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
            const tips = isTouch
                ? ['Левый стик — ходьба, правый — прицел и огонь', 'Кнопка рывка спасает от укуса', 'Крадись мимо спящих стражей', 'Сыр — это деньги лавки дядюшки']
                : ['WASD — ходьба, мышь — прицел, ЛКМ — огонь', 'SHIFT — рывок, C — красться, B — бросить книгу', 'Сыр — это деньги лавки дядюшки'];
            const tipText = this.add.text(width / 2, height - 44, tips[Math.floor(Math.random() * tips.length)], {
                fontFamily: F, fontSize: '15px', color: '#8a70b0',
            }).setOrigin(0.5);
            this.load.on('progress', (value) => {
                progressBar.clear();
                progressBar.fillStyle(0xe8b54a, 1);
                progressBar.fillRoundedRect(barX, barY, Math.max(8, barWidth * value), barHeight, 10);
                progressBar.fillStyle(0xfff0c0, 0.35);
                progressBar.fillRoundedRect(barX, barY, Math.max(8, barWidth * value), barHeight / 3, 6);
            });
            this.load.on('complete', () => {
                [bg, moon, castle, titleText, subtitleText, progressBox, progressBar, loadingText, tipText].forEach((o) => o.destroy());
            });
        } else {
            … existing snow loader, unchanged …
        }
```
Match the existing loader's element-destroy mechanism (it may destroy in `create()` via a stored array — do the same for the castle elements) and keep the `this.load.*` asset lines after the block untouched.
- [ ] **Step 3:** Syntax check; screenshot `game-phaser.html?mode=transylvania&runMode=story` at ~3 s (Playwright `waitForTimeout(2500)`) → castle loader visible, no snowflakes, no keyboard hint on a touch UA; the snowball mode (`?mode=solo`) still shows the snow loader (screenshot).
- [ ] **Step 4: Commit** — `git add www/js/scenes/BootScene.js && git commit -m "feat(boot): castle-themed loading screen for the Transylvania mode (no snow, touch-aware tips)"`

---

### Task 5: Clean story intro — HUD/sticks hidden, touch-aware hints, no emoji

**Files:**
- Modify: `www/js/scenes/DungeonScene.js` (`create()`, `showStoryIntro()`, intro dismissal)

- [ ] **Step 1:** Add a helper next to `setTouchUIVisible`:

```js
    _setHudVisible(v) {
        const objs = [
            ...(this.heartIcons || []), this.cheeseIcon, this.cheeseText, this.keyIcon, this.compass, this.compassLabel,
            this.powerupIcon, this.powerupText, this.suspicionMeter, this.suspicionLabel,
            this.bookCounterIcon, this.bookCounterText, this.crouchIcon, this.exitBtnBg, this.exitBtn,
        ];
        for (const o of objs) if (o) o.setVisible(v);
        this._hudHidden = !v;
    }
```
In `updateHUD()` guard the per-frame visibility writers so they don't re-show hidden elements: the suspicion meter/label `setVisible(true)` and the power-up icon/text `setVisible(true)` must be skipped while `this._hudHidden` (wrap with `if (!this._hudHidden)`); the compass label `setVisible(true)` in `updateCompass()` likewise. `_hudHidden` is reset in `create()`.
- [ ] **Step 2:** In `create()` after `this.buildHUD();` add `this._setHudVisible(false);` and change the touch-visibility call at 297 to keep sticks hidden during the intro: `this.setTouchUIVisible(false); this._touchWanted = isMobileUA;` (keep `if (isMobileUA) this._touchUsed = true;`). In the two "first touch" handlers (306/314) that call `setTouchUIVisible(true)`, guard with `if (this.state === 'play')` and otherwise set `this._touchWanted = true`.
- [ ] **Step 3:** In the intro dismissal (where `this.state = 'play'` is set ~5686-5692) add right after it: `this._setHudVisible(true); if (this.joy) this.setTouchUIVisible(!!(this._touchWanted || this._touchUsed)); this._pinFixed();`. Also handle `keydown-ENTER` if it has its own path (it calls the same dismiss function — verify).
- [ ] **Step 4:** Hint text (5661-5663) → 
```js
        const hintLabel = IS_TOUCH
            ? 'Левый стик — ходьба   ·   Правый — прицел и огонь   ·   Кнопка — рывок'
            : 'WASD — ходьба   ·   Мышь — прицел   ·   ЛКМ / Space — огонь   ·   SHIFT — рывок   ·   C — красться';
```
and the button label `'▶ НАЧАТЬ'` → `'НАЧАТЬ'` (5682). `grep -n "💨\|▶ НАЧАТЬ" www/js/scenes/DungeonScene.js` inside `showStoryIntro` → 0 hits.
- [ ] **Step 5:** Verify by screenshots (pipeline): (1) intro frame — no hearts/sticks/exit button visible under the panel; (2) after `Enter` — HUD and sticks appear; (3) with a held touch — sticks work. Desktop (no touch UA): sticks never appear. Syntax check.
- [ ] **Step 6: Commit** — `git add www/js/scenes/DungeonScene.js && git commit -m "feat(intro): HUD and touch controls hidden until play; touch-aware hints without emoji"`

---

### Task 6: Sync + acceptance (screenshots, then human on device)

- [ ] **Step 1:** `/opt/homebrew/bin/node --test tools/tests/hudLayout.test.mjs` → fail 0; `/opt/homebrew/bin/node node_modules/@capacitor/cli/bin/capacitor sync` → `Sync finished`.
- [ ] **Step 2: Screenshot set** (Playwright, DPR 2, 915×412 and 640×360): loader (castle), intro (clean), play + HUD (crisp text; compare a 200×100 crop of the hearts/cheese counter with the `?dpr=1` run), sticks held (smooth edges), lose overlay (still centred, readable — it is not yet rebuilt; confirm it isn't clipped/offset).
- [ ] **Step 3: Device (Pixel 9a):** `?fps=1` in combat vs Phase 1 numbers; text crisp; sticks smooth; safe-area unchanged; fonts Nunito offline (airplane mode); no wrong-mode loader; intro clean; snowball mode unaffected.
- [ ] **Step 4:** Report; if fps drops below 55 in combat at DPR 3, set the cap to 2 (`Math.min(2, …)` in `main.js`) in a follow-up commit.

---

## Out of scope (next plans)
- B: SVG art kit + tilemap floor/walls; C: characters presentation; D: UI kit + overlays; E: menus; F: sound; G: juice.
