# Transylvania Phase 2b — HUD & Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The in-game HUD and touch controls scale with the screen (`uiScale`), respect the safe-area, never overlap on 360×640, and use SVG icons instead of emoji (spec §5, acceptance criteria 4 and the HUD half of 5).

**Architecture:** A pure layout module (`www/js/ui/hudLayout.js`, no Phaser, unit-tested with `node --test`) computes every HUD/touch position and size from `W, H, safe-area, uiScale`. `DungeonScene.buildHUD()` creates Images (SVG textures) instead of emoji Texts under the **same field names**, `repositionHUD()` applies the layout (also on resize), `updateHUD()`/`updateCompass()` swap textures instead of strings. The UI depth band is named in `LAYER`. Overlays/pickers, world-object emoji and floating-text emoji are **plan 2c**.

**Tech Stack:** Phaser 3.70 (CDN — verify APIs against 3.70, not the 3.90 in node_modules), ES modules, SVG via `this.load.svg(key, url, {width, height})`, Node 26 `node --test` for the layout module (Node auto-detects ESM in typeless `.js`; a `MODULE_TYPELESS_PACKAGE_JSON` warning is harmless).

**Ground rules:** only touch the files each task names; stage only those files (never `git add -A`); no comments/refactors outside the snippets; syntax-check DungeonScene.js with `cp www/js/scenes/DungeonScene.js <scratch>/ds.mjs && /opt/homebrew/bin/node --check <scratch>/ds.mjs`; the Scene instance is reused on restart — every new field is (re)assigned in `create()`/`buildHUD()`/`setupTouchControls()`.

**Current facts (verified 2026-08-29, HEAD `cffba2f`):** `buildHUD()` ≈ line 5663, `repositionHUD()` ≈ 5750, `updateHUD()` ≈ 5780, `setupTouchControls()` ≈ 5852, `positionJoystick()` ≈ 5930, `updateCompass()` ≈ 6247, `preload()` ≈ 174-200, `create()` calls `buildHUD()` ≈ 311 and `setupTouchControls()` ≈ 270-275, `this.scale.on('resize', () => this.repositionHUD())` ≈ 320. `LAYER` const ≈ line 33. Existing SVG textures: `d_key` (60×32), `d_cheese` (48×40), `d_grandma` (135×150), `d_pie` (40×40). `POWERUP_EMOJI` ≈ line 26. No `www/assets/ui/` dir yet; no `tools/tests/` yet.

---

### Task 1: Name the UI depth band in `LAYER`

**Files:**
- Modify: `www/js/scenes/DungeonScene.js` — `LAYER` const (~line 33) and every UI `setDepth(...)` / overlay `const D = ...` site

- [ ] **Step 1: Extend the table** — replace the existing `const LAYER = { … EYES: 82 … };` block so it becomes (keep the existing WORLD…EYES entries and their comments exactly as they are; append the UI part inside the same object):

```js
    // ---- UI band (scrollFactor 0). Values are the historical magic numbers.
    UI_TOUCH: 989,        // stick / dash outer halos
    UI_TOUCH_BASE: 990,   // stick bases, dash base, touch labels
    UI_TOUCH_HINT: 990.5, // stick hints, dash cooldown arc
    UI_TOUCH_KNOB: 991,
    UI_TOUCH_LABEL: 992,  // dash icon
    UI_HUD_BG: 999,       // exit button disc
    UI_HUD: 1000,         // hearts, counters, icons
    UI_HUD_2: 1001,       // suspicion meter ring
    UI_HUD_3: 1002,       // suspicion eye
    UI_COMPASS: 1100,
    UI_COMPASS_LABEL: 1101,
    UI_OVERLAY: 2000,     // win/lose overlay, upgrade picker
    UI_SHOP: 2200,
    UI_PICKER: 2300,      // relic picker
    UI_INTRO: 2500,       // story / floor intro
    UI_FLASH: 3000,       // flashNoCheese
    UI_DEBUG: 5000,       // fps overlay
```

- [ ] **Step 2: Replace the literals** — for each value, replace `setDepth(<value>)` in HUD/touch code and `const D = <value>;` in overlay methods with the constant. Find them with:

```bash
grep -n "setDepth(989)\|setDepth(990)\|setDepth(990.5)\|setDepth(991)\|setDepth(992)\|setDepth(999)\|setDepth(1000)\|setDepth(1001)\|setDepth(1002)\|setDepth(1100)\|setDepth(1101)\|setDepth(3000)\|setDepth(5000)" www/js/scenes/DungeonScene.js
grep -n "const D = 2000\|const D = 2200\|const D = 2300\|const D = 2500\|D = 2010" www/js/scenes/DungeonScene.js
```

Rules: `D = 2010` (drawGothicButton default) → `D = LAYER.UI_OVERLAY + 10`. Leave the world-space aim line / crosshair (`setDepth(1999)`, `setDepth(2000)` inside the aim code, `scrollFactor 1`) numeric. Leave any `setDepth(D + n)` as is.

- [ ] **Step 3: Verify**

```bash
grep -c "\bLAYER\.UI_" www/js/scenes/DungeonScene.js     # expect ≥ 30
grep -n "setDepth(1000)\|setDepth(990)\|setDepth(989)\|const D = 2[0-9]00;" www/js/scenes/DungeonScene.js   # expect no hits
```
Syntax check. Then `git diff --stat` must show only DungeonScene.js.

- [ ] **Step 4: Commit**

```bash
git add www/js/scenes/DungeonScene.js
git commit -m "refactor: name the UI depth band in LAYER (values unchanged)"
```

---

### Task 2: SVG icon set + preload + smooth filtering

**Files:**
- Create: `www/assets/ui/heart.svg`, `heart_empty.svg`, `eye.svg`, `book.svg`, `paw.svg`, `stairs.svg`, `target.svg`, `bolt.svg`, `shield.svg`, `flame.svg`, `move.svg`, `dash.svg`, `close.svg` (13 files)
- Modify: `www/js/scenes/DungeonScene.js` — module constants (after `POWERUP_EMOJI`), `preload()`, `create()` (before `buildHUD()`)

Style: viewBox 0 0 64 64, dark outline `#1a0a2e`, gold `#e8b54a`, cream `#fff0d6` («Тёплая готика»). Icons are loaded at 64px and downscaled, so keep shapes bold.

- [ ] **Step 1: Create the 13 SVG files** with exactly this content:

`www/assets/ui/heart.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path d="M32 56 L10 34 C2 26 6 12 18 12 C25 12 30 17 32 21 C34 17 39 12 46 12 C58 12 62 26 54 34 Z" fill="#ff4d6a" stroke="#1a0a2e" stroke-width="4" stroke-linejoin="round"/>
  <ellipse cx="21" cy="22" rx="5" ry="3.5" fill="#ffd0d8" opacity="0.85"/>
</svg>
```

`www/assets/ui/heart_empty.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path d="M32 56 L10 34 C2 26 6 12 18 12 C25 12 30 17 32 21 C34 17 39 12 46 12 C58 12 62 26 54 34 Z" fill="#2a1c38" stroke="#7a6a8a" stroke-width="4" stroke-linejoin="round"/>
</svg>
```

`www/assets/ui/eye.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path d="M6 32 C16 16 48 16 58 32 C48 48 16 48 6 32 Z" fill="#fff0d6" stroke="#1a0a2e" stroke-width="4" stroke-linejoin="round"/>
  <circle cx="32" cy="32" r="10" fill="#e8b54a" stroke="#1a0a2e" stroke-width="3"/>
  <circle cx="32" cy="32" r="4.5" fill="#1a0a2e"/>
  <circle cx="36" cy="28" r="2" fill="#ffffff"/>
</svg>
```

`www/assets/ui/book.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect x="12" y="8" width="40" height="48" rx="4" fill="#b8302e" stroke="#1a0a2e" stroke-width="4"/>
  <rect x="12" y="8" width="9" height="48" rx="3" fill="#7a1a1c" stroke="#1a0a2e" stroke-width="3"/>
  <rect x="26" y="14" width="20" height="36" fill="none" stroke="#e8b54a" stroke-width="2.5" opacity="0.9"/>
  <rect x="49" y="12" width="3" height="40" fill="#fff0d6"/>
</svg>
```

`www/assets/ui/paw.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <g fill="#ffb3c1" stroke="#1a0a2e" stroke-width="3.5">
    <ellipse cx="16" cy="24" rx="6" ry="8"/>
    <ellipse cx="32" cy="16" rx="6.5" ry="8.5"/>
    <ellipse cx="48" cy="24" rx="6" ry="8"/>
    <path d="M32 30 C44 30 52 40 50 50 C48 58 38 58 32 54 C26 58 16 58 14 50 C12 40 20 30 32 30 Z"/>
  </g>
</svg>
```

`www/assets/ui/stairs.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path d="M8 56 L8 40 L22 40 L22 28 L36 28 L36 16 L56 16 L56 56 Z" fill="#8a6ab0" stroke="#1a0a2e" stroke-width="4" stroke-linejoin="round"/>
  <path d="M20 6 L20 22 M12 15 L20 23 L28 15" fill="none" stroke="#e8b54a" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

`www/assets/ui/target.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="22" fill="#fff0d6" stroke="#1a0a2e" stroke-width="4"/>
  <circle cx="32" cy="32" r="13" fill="#ff4d6a" stroke="#1a0a2e" stroke-width="3"/>
  <circle cx="32" cy="32" r="5" fill="#fff0d6" stroke="#1a0a2e" stroke-width="3"/>
  <path d="M32 4 V12 M32 52 V60 M4 32 H12 M52 32 H60" stroke="#1a0a2e" stroke-width="4" stroke-linecap="round"/>
</svg>
```

`www/assets/ui/bolt.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path d="M36 4 L14 36 L30 36 L26 60 L50 26 L34 26 Z" fill="#ffd24a" stroke="#1a0a2e" stroke-width="4" stroke-linejoin="round"/>
</svg>
```

`www/assets/ui/shield.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path d="M32 4 L54 12 C54 34 46 50 32 60 C18 50 10 34 10 12 Z" fill="#6a3d9a" stroke="#1a0a2e" stroke-width="4" stroke-linejoin="round"/>
  <path d="M32 12 L46 17 C46 32 40 44 32 51 C24 44 18 32 18 17 Z" fill="#e8b54a" opacity="0.9"/>
</svg>
```

`www/assets/ui/flame.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path d="M32 4 C36 16 48 20 48 36 C48 48 40 58 32 58 C24 58 16 48 16 36 C16 28 20 24 22 20 C24 28 28 30 30 26 C32 20 30 12 32 4 Z" fill="#ff7a2a" stroke="#1a0a2e" stroke-width="4" stroke-linejoin="round"/>
  <path d="M32 30 C36 36 40 38 40 46 C40 52 36 56 32 56 C28 56 24 52 24 46 C24 40 30 38 32 30 Z" fill="#ffd24a"/>
</svg>
```

`www/assets/ui/move.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="#ffffff">
  <path d="M32 2 L40 12 L35 12 L35 26 L29 26 L29 12 L24 12 Z"/>
  <path d="M32 62 L24 52 L29 52 L29 38 L35 38 L35 52 L40 52 Z"/>
  <path d="M2 32 L12 24 L12 29 L26 29 L26 35 L12 35 L12 40 Z"/>
  <path d="M62 32 L52 40 L52 35 L38 35 L38 29 L52 29 L52 24 Z"/>
</svg>
```

`www/assets/ui/dash.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="round">
  <path d="M8 20 H40"/>
  <path d="M14 32 H52"/>
  <path d="M8 44 H36"/>
  <path d="M46 26 L56 32 L46 38" stroke-width="5" stroke-linejoin="round"/>
</svg>
```

`www/assets/ui/close.svg` (the X sits in the central 40% so the image can be displayed at the full button diameter and act as the hit area)
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="#fff0d6" stroke-width="6" stroke-linecap="round">
  <path d="M22 22 L42 42 M42 22 L22 42"/>
</svg>
```

- [ ] **Step 2: Validate the files**

```bash
ls www/assets/ui/*.svg | wc -l    # 13
python3 -c "import xml.dom.minidom,glob; [xml.dom.minidom.parse(f) for f in glob.glob('www/assets/ui/*.svg')]; print('SVG_OK')"
```

- [ ] **Step 3: Module constants** — in `DungeonScene.js`, right after the `const POWERUP_EMOJI = {...};` line add:

```js
const POWERUP_ICON = { triple: 'ui_target', speed: 'ui_bolt', shield: 'ui_shield', fire: 'ui_flame' };
const UI_ICON_NAMES = ['heart', 'heart_empty', 'eye', 'book', 'paw', 'stairs', 'target', 'bolt', 'shield', 'flame', 'move', 'dash', 'close'];
```

- [ ] **Step 4: Preload** — in `preload()`, after the last existing `this.load.svg(...)` line, add:

```js
        for (const n of UI_ICON_NAMES) this.load.svg('ui_' + n, `assets/ui/${n}.svg`, { width: 64, height: 64 });
```

- [ ] **Step 5: Smooth downscaling** — the game runs with `antialias: false` (NEAREST filtering). In `create()`, immediately BEFORE the `this.buildHUD();` call, add:

```js
        // HUD icons are drawn far below their 64px source — bilinear filter only for these textures
        for (const k of [...UI_ICON_NAMES.map(n => 'ui_' + n), 'd_key', 'd_cheese', 'd_grandma']) {
            if (this.textures.exists(k)) this.textures.get(k).setFilter(Phaser.Textures.FilterMode.LINEAR);
        }
```

- [ ] **Step 6: Verify**

```bash
grep -c "ui_' + n" www/js/scenes/DungeonScene.js      # 2 (preload + filter loop)
grep -n "POWERUP_ICON\|UI_ICON_NAMES" www/js/scenes/DungeonScene.js
```
Syntax check.

- [ ] **Step 7: Commit**

```bash
git add www/assets/ui www/js/scenes/DungeonScene.js
git commit -m "assets: 13 SVG HUD icons, preloaded with bilinear filtering"
```

---

### Task 3: Pure layout module + safe-area reader + tests (TDD)

**Files:**
- Create: `www/js/ui/hudLayout.js`, `www/js/ui/safeArea.js`, `tools/tests/hudLayout.test.mjs`

- [ ] **Step 1: Write the failing test** `tools/tests/hudLayout.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { uiScaleFor, computeHudLayout } from '../../www/js/ui/hudLayout.js';

const VIEWPORTS = [[360, 640], [640, 360], [800, 360], [412, 915], [915, 412], [1400, 1050], [2400, 1080]];
const ZERO = { top: 0, right: 0, bottom: 0, left: 0 };
const PORTRAIT_NOTCH = { top: 24, right: 0, bottom: 34, left: 0 };
const LANDSCAPE_NOTCH = { top: 0, right: 44, bottom: 24, left: 44 };
const safesFor = (W, H) => (W >= H ? [ZERO, PORTRAIT_NOTCH, LANDSCAPE_NOTCH] : [ZERO, PORTRAIT_NOTCH]);

const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

test('uiScale is clamped to [0.8, 1.3]', () => {
    assert.equal(uiScaleFor(360, 640), 0.8);
    assert.equal(uiScaleFor(640, 360), 0.8);
    assert.equal(uiScaleFor(1400, 1050), 1.3);
    assert.ok(Math.abs(uiScaleFor(640, 640) - 1) < 1e-9);
});

for (const [W, H] of VIEWPORTS) for (const safe of safesFor(W, H)) {
    test(`no HUD overlaps and everything on-screen at ${W}x${H} safe=${JSON.stringify(safe)}`, () => {
        const L = computeHudLayout({ W, H, safe, maxHp: 5 });
        assert.ok(L.rects.length >= 8, 'rects listed');
        for (const r of L.rects) {
            assert.ok(r.x >= safe.left && r.y >= safe.top && r.x + r.w <= W - safe.right && r.y + r.h <= H - safe.bottom, `${r.name} inside safe area`);
        }
        for (let i = 0; i < L.rects.length; i++) for (let j = i + 1; j < L.rects.length; j++) {
            assert.ok(!overlaps(L.rects[i], L.rects[j]), `${L.rects[i].name} overlaps ${L.rects[j].name}`);
        }
        // touch: dash button (right column) never reaches the exit button, sticks stay inside the safe area
        const t = L.touch;
        const dashTop = H - t.bottomOff - t.joyR - t.dashGap - 2 * t.dashR;
        assert.ok(dashTop > L.exit.cy + L.exit.r, 'dash button below exit button');
        assert.ok(t.sideOffLeft - t.joyR >= safe.left && H - t.bottomOff + t.joyR <= H - safe.bottom, 'move stick inside safe area');
        assert.ok(W - t.sideOffRight + t.joyR <= W - safe.right, 'aim stick inside safe area');
    });
}

test('cheese group is pushed right of the key on narrow screens', () => {
    const L = computeHudLayout({ W: 360, H: 640, maxHp: 5 });
    assert.ok(L.cheese.iconX >= L.key.x + L.key.w + 6);
});

test('layout scales with uiScale', () => {
    const a = computeHudLayout({ W: 640, H: 360, maxHp: 5 });
    const b = computeHudLayout({ W: 1400, H: 1050, maxHp: 5 });
    assert.ok(b.hearts[0].size > a.hearts[0].size);
    assert.ok(b.touch.joyR > a.touch.joyR);
});
```

- [ ] **Step 2: Run it — expect failure** (module missing)

```bash
/opt/homebrew/bin/node --test tools/tests/hudLayout.test.mjs
```
Expected: `Cannot find module … hudLayout.js` (fail).

- [ ] **Step 3: Write `www/js/ui/hudLayout.js`**

```js
// Pure HUD layout — no Phaser, no DOM. All sizes are base px × uiScale.
// Consumed by DungeonScene.repositionHUD()/setupTouchControls(); tested by tools/tests/hudLayout.test.mjs.

export function uiScaleFor(W, H) {
    return Math.min(1.3, Math.max(0.8, Math.min(W, H) / 640));
}

const BASE = {
    margin: 12, heart: 26, heartGap: 4, keyW: 40, keyH: 21, keyGap: 10,
    rowGap: 8, statusH: 28, meterR: 14, eye: 16, bookIcon: 22, bookFont: 17, paw: 22, itemGap: 10,
    powerIcon: 22, powerFont: 18,
    cheeseW: 24, cheeseH: 20, cheeseGap: 6, cheeseFont: 22, cheeseTextW: 64, comboFont: 26, comboGap: 4,
    exitR: 22, exitIcon: 44, compassLabel: 26, compassArrow: 18,
    joyR: 76, dashR: 52, touchPad: 18, dashGap: 26, touchFont: 11,
};

export function computeHudLayout({ W, H, safe = { top: 0, right: 0, bottom: 0, left: 0 }, maxHp = 5, uiScale }) {
    const s = uiScale ?? uiScaleFor(W, H);
    const px = (v) => Math.round(v * s);
    const M = px(BASE.margin);
    const left = safe.left + M, top = safe.top + M, right = W - safe.right - M;
    const rects = [];
    const rect = (name, x, y, w, h) => rects.push({ name, x, y, w, h });

    // --- Top-left: hearts + key
    const heart = px(BASE.heart), heartGap = px(BASE.heartGap);
    const hearts = [];
    for (let i = 0; i < maxHp; i++) hearts.push({ x: left + i * (heart + heartGap), y: top, size: heart });
    const heartsRight = left + maxHp * (heart + heartGap) - heartGap;
    rect('hearts', left, top, heartsRight - left, heart);
    const key = { x: heartsRight + px(BASE.keyGap), y: top + Math.round((heart - px(BASE.keyH)) / 2), w: px(BASE.keyW), h: px(BASE.keyH) };
    rect('key', key.x, key.y, key.w, key.h);
    const leftClusterRight = key.x + key.w;

    // --- Status row under the hearts: suspicion meter, book counter, crouch paw
    const rowY = top + heart + px(BASE.rowGap);
    const statusH = px(BASE.statusH), itemGap = px(BASE.itemGap), rowCy = rowY + statusH / 2;
    let x = left;
    const meterR = px(BASE.meterR);
    const meter = { cx: x + meterR, cy: rowCy, r: meterR };
    const eye = { cx: meter.cx, cy: meter.cy, size: px(BASE.eye) };
    rect('meter', x, rowY, meterR * 2, statusH);
    x += meterR * 2 + itemGap;
    const bookIcon = px(BASE.bookIcon), bookFont = px(BASE.bookFont), bookTextW = Math.round(bookFont * 1.6);
    const book = { cx: x + bookIcon / 2, cy: rowCy, size: bookIcon };
    const bookText = { x: x + bookIcon + px(4), y: rowCy, fontSize: bookFont };
    rect('book', x, rowY, bookIcon + px(4) + bookTextW, statusH);
    x += bookIcon + px(4) + bookTextW + itemGap;
    const pawSize = px(BASE.paw);
    const paw = { cx: x + pawSize / 2, cy: rowCy, size: pawSize };
    rect('paw', x, rowY, pawSize, statusH);

    // --- Power-up timer row under the status row
    const powerY = rowY + statusH + px(BASE.rowGap);
    const powerIcon = px(BASE.powerIcon), powerFont = px(BASE.powerFont);
    const powerup = {
        iconCx: left + powerIcon / 2, iconCy: powerY + statusH / 2, size: powerIcon,
        textX: left + powerIcon + px(6), textY: powerY + statusH / 2, fontSize: powerFont,
    };
    rect('powerup', left, powerY, powerIcon + px(6) + Math.round(powerFont * 3), statusH);

    // --- Top-centre: cheese counter (+ combo under it); pushed right if it would touch the key
    const cheeseW = px(BASE.cheeseW), cheeseH = px(BASE.cheeseH);
    const groupW = cheeseW + px(BASE.cheeseGap) + px(BASE.cheeseTextW);
    const groupLeft = Math.max(Math.round(W / 2 - groupW / 2), leftClusterRight + px(8));
    const cheese = {
        iconX: groupLeft, iconY: top + Math.round((heart - cheeseH) / 2), iconW: cheeseW, iconH: cheeseH,
        textX: groupLeft + cheeseW + px(BASE.cheeseGap), textY: top + heart / 2, fontSize: px(BASE.cheeseFont),
    };
    rect('cheese', groupLeft, top, groupW, heart);
    const combo = { x: groupLeft + groupW / 2, y: top + heart + px(BASE.comboGap), fontSize: px(BASE.comboFont) };

    // --- Top-right: exit button
    const exitR = px(BASE.exitR);
    const exit = { cx: right - exitR, cy: top + exitR, r: exitR, iconSize: px(BASE.exitIcon) };
    rect('exit', exit.cx - exitR, exit.cy - exitR, exitR * 2, exitR * 2);

    // --- Compass ring around the screen centre (radius rule unchanged from before)
    const compass = { ringR: Math.min(W, H) * 0.40, labelSize: px(BASE.compassLabel), arrowSize: px(BASE.compassArrow) };

    // --- Touch controls (radii are applied once at setup; offsets every reposition)
    const joyR = px(BASE.joyR), dashR = px(BASE.dashR), pad = px(BASE.touchPad);
    const touch = {
        joyR, dashR,
        bottomOff: joyR + pad + safe.bottom,
        sideOffLeft: joyR + pad + safe.left,
        sideOffRight: joyR + pad + safe.right,
        dashGap: px(BASE.dashGap),
        labelFont: px(BASE.touchFont),
    };

    return { s, W, H, safe, hearts, key, meter, eye, book, bookText, paw, powerup, cheese, combo, exit, compass, touch, rects };
}
```

- [ ] **Step 4: Write `www/js/ui/safeArea.js`**

```js
// Reads CSS env(safe-area-inset-*) through a hidden probe element.
// Needs <meta name="viewport" … viewport-fit=cover> (already set in game-phaser.html).
let probe = null;

export function readSafeArea() {
    if (typeof document === 'undefined' || !document.body) return { top: 0, right: 0, bottom: 0, left: 0 };
    if (!probe) {
        probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
            'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);';
        document.body.appendChild(probe);
    }
    const cs = getComputedStyle(probe);
    const n = (v) => Math.max(0, parseFloat(v) || 0);
    return { top: n(cs.paddingTop), right: n(cs.paddingRight), bottom: n(cs.paddingBottom), left: n(cs.paddingLeft) };
}
```

- [ ] **Step 5: Run the tests — expect all pass**

```bash
/opt/homebrew/bin/node --test tools/tests/hudLayout.test.mjs
```
Expected: `pass N`, `fail 0`. If an overlap assertion fails, fix the layout (not the test) and report which pair overlapped.

- [ ] **Step 6: Commit**

```bash
git add www/js/ui/hudLayout.js www/js/ui/safeArea.js tools/tests/hudLayout.test.mjs
git commit -m "feat(ui): pure HUD layout module with uiScale + safe-area reader, node tests"
```

---

### Task 4: HUD uses the layout and SVG icons

**Files:**
- Modify: `www/js/scenes/DungeonScene.js` — imports, `buildHUD()`, `repositionHUD()`, `updateHUD()` (hearts, cheese, suspicion ring radius, power-up), `updateCompass()`, exit-button touch guards

- [ ] **Step 1: Imports** — after the existing `import { RELICS, … } from './Relics.js';` line add:

```js
import { computeHudLayout } from '../ui/hudLayout.js';
import { readSafeArea } from '../ui/safeArea.js';
```

- [ ] **Step 2: Replace `buildHUD()` entirely** with:

```js
    buildHUD() {
        const FONT = '"Nunito", "Roboto", system-ui, sans-serif';
        const D = LAYER.UI_HUD;
        this.heartIcons = [];
        for (let i = 0; i < PLAYER.maxHp; i++) {
            this.heartIcons.push(this.add.image(0, 0, 'ui_heart').setOrigin(0, 0).setScrollFactor(0).setDepth(D));
        }
        this.cheeseIcon = this.add.image(0, 0, 'd_cheese').setOrigin(0, 0).setScrollFactor(0).setDepth(D);
        this.cheeseText = this.add.text(0, 0, '0/0', {
            fontFamily: FONT, fontSize: '24px',
            color: '#fff0a0', stroke: '#0a0410', strokeThickness: 5, fontStyle: '900',
        }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(D);
        this.keyIcon = this.add.image(0, 0, 'd_key').setOrigin(0, 0).setScrollFactor(0).setDepth(D).setAlpha(0.25);
        this.objectiveText = this.add.text(0, 0, 'Найди ключ', {
            fontFamily: FONT, fontSize: '17px', fontStyle: '500',
            color: '#f0d8ff', stroke: '#0a0410', strokeThickness: 3
        }).setScrollFactor(0).setDepth(D);
        this.scoreText = this.add.text(0, 0, '0', {
            fontFamily: FONT, fontSize: '22px',
            color: '#ffffff', stroke: '#0a0410', strokeThickness: 4, fontStyle: '700',
        }).setScrollFactor(0).setDepth(D);
        // Floor badge (hidden — shown by the floor intro)
        const floorLabel = this.isFinalFloor
            ? this.biome.name
            : `${this.biome.name} (${this.chapter}/${TOTAL_FLOORS})`;
        this.chapterText = this.add.text(0, 0, floorLabel, {
            fontFamily: FONT, fontSize: '13px',
            color: this.isFinalFloor ? '#ff8060' : '#d0b0f0',
            stroke: '#0a0410', strokeThickness: 2, fontStyle: '700', letterSpacing: 1,
        }).setScrollFactor(0).setDepth(D);
        this.upgradeIconsText = this.add.text(0, 0, '', { fontSize: '18px', color: '#ffffff' }).setScrollFactor(0).setDepth(D);
        // Combo display — centred under the cheese counter
        this.comboText = this.add.text(0, 0, '', {
            fontFamily: FONT, fontSize: '30px',
            color: '#e8b54a', stroke: '#3a1248', strokeThickness: 5, fontStyle: '900',
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(D).setVisible(false);
        // COMPASS arrow toward current objective (key → grandma / stairs)
        this.compass = this.add.graphics().setScrollFactor(0).setDepth(LAYER.UI_COMPASS);
        this.compassLabel = this.add.image(0, 0, 'd_key').setOrigin(0.5).setScrollFactor(0).setDepth(LAYER.UI_COMPASS_LABEL);
        this._compassKey = null; this._compassAngle = undefined;  // fresh Graphics — force first redraw
        // Active power-up: icon + remaining seconds
        this.powerupIcon = this.add.image(0, 0, 'ui_bolt').setOrigin(0.5).setScrollFactor(0).setDepth(D).setVisible(false);
        this.powerupText = this.add.text(0, 0, '', {
            fontFamily: FONT, fontSize: '20px',
            color: '#ffffff', stroke: '#0a0410', strokeThickness: 4, fontStyle: '700',
        }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(D).setVisible(false);
        // === Suspicion meter — small circular gauge in the status row ===
        this.suspicionMeter = this.add.graphics().setScrollFactor(0).setDepth(LAYER.UI_HUD_2).setVisible(false);
        this.suspicionLabel = this.add.image(0, 0, 'ui_eye').setOrigin(0.5).setScrollFactor(0).setDepth(LAYER.UI_HUD_3).setVisible(false);
        // === Distraction book counter ===
        this.bookCounterIcon = this.add.image(0, 0, 'ui_book').setOrigin(0.5).setScrollFactor(0).setDepth(D);
        this.bookCounterText = this.add.text(0, 0, '×3', {
            fontFamily: FONT, fontSize: '17px',
            color: '#ffffff', stroke: '#0a0410', strokeThickness: 3, fontStyle: '700',
        }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(D);
        // === Crouch indicator ===
        this.crouchIcon = this.add.image(0, 0, 'ui_paw').setOrigin(0.5).setScrollFactor(0).setDepth(D).setAlpha(0.35);
        // Exit button — disc drawn in repositionHUD (radius scales), icon doubles as the hit area
        this.exitBtnBg = this.add.graphics().setScrollFactor(0).setDepth(LAYER.UI_HUD_BG);
        this.exitBtn = this.add.image(0, 0, 'ui_close').setOrigin(0.5).setScrollFactor(0).setDepth(D)
            .setInteractive({ useHandCursor: true })
            .on('pointerdown', () => this.exitToMenu());
        this.repositionHUD();
    }
```

- [ ] **Step 3: Replace `repositionHUD()` entirely** with:

```js
    repositionHUD() {
        if (!this.heartIcons) return;
        const cam = this.cameras.main;
        const L = computeHudLayout({ W: cam.width, H: cam.height, safe: readSafeArea(), maxHp: PLAYER.maxHp });
        this._hudLayout = L;
        for (let i = 0; i < this.heartIcons.length; i++) {
            const h = L.hearts[i];
            this.heartIcons[i].setPosition(h.x, h.y).setDisplaySize(h.size, h.size);
        }
        this.keyIcon.setPosition(L.key.x, L.key.y).setDisplaySize(L.key.w, L.key.h);
        this.cheeseIcon.setPosition(L.cheese.iconX, L.cheese.iconY).setDisplaySize(L.cheese.iconW, L.cheese.iconH);
        this.cheeseText.setPosition(L.cheese.textX, L.cheese.textY).setFontSize(L.cheese.fontSize);
        this.comboText.setPosition(L.combo.x, L.combo.y).setFontSize(L.combo.fontSize);
        // === MINIMAL HUD — stat counters hidden; floor/score shown by intro and win/lose screens ===
        this.objectiveText.setVisible(false);
        this.scoreText.setVisible(false);
        this.chapterText.setVisible(false);
        this.upgradeIconsText.setVisible(false);
        this.comboText.setVisible(false);       // (re-enabled per-frame in updateHUD if active)
        // Status row
        this.suspicionMeter.setPosition(L.meter.cx, L.meter.cy);
        this.suspicionLabel.setPosition(L.eye.cx, L.eye.cy).setDisplaySize(L.eye.size, L.eye.size);
        this.bookCounterIcon.setPosition(L.book.cx, L.book.cy).setDisplaySize(L.book.size, L.book.size);
        this.bookCounterText.setPosition(L.bookText.x, L.bookText.y).setFontSize(L.bookText.fontSize);
        this.crouchIcon.setPosition(L.paw.cx, L.paw.cy).setDisplaySize(L.paw.size, L.paw.size);
        // Power-up row
        this.powerupIcon.setPosition(L.powerup.iconCx, L.powerup.iconCy).setDisplaySize(L.powerup.size, L.powerup.size);
        this.powerupText.setPosition(L.powerup.textX, L.powerup.textY).setFontSize(L.powerup.fontSize);
        // Exit button
        this.exitBtnBg.clear();
        this.exitBtnBg.fillStyle(0x140820, 0.92);
        this.exitBtnBg.fillCircle(0, 0, L.exit.r);
        this.exitBtnBg.lineStyle(2, 0xe8b54a, 0.75);
        this.exitBtnBg.strokeCircle(0, 0, L.exit.r);
        this.exitBtnBg.setPosition(L.exit.cx, L.exit.cy);
        this.exitBtn.setPosition(L.exit.cx, L.exit.cy).setDisplaySize(L.exit.iconSize, L.exit.iconSize);
        // Compass: label size / ring radius depend on the screen — force a redraw
        this._compassKey = null;
        if (this.joy) this.positionJoystick();
    }
```

- [ ] **Step 4: `updateHUD()` edits** (keep everything else as is):

Hearts + cheese (first lines of the method):
```js
        for (let i = 0; i < this.heartIcons.length; i++) {
            const key = i < this.player.hp ? 'ui_heart' : 'ui_heart_empty';
            if (this.heartIcons[i].texture.key !== key) this.heartIcons[i].setTexture(key);
        }
        this.cheeseText.setText(`${this.cheeseGot}/${this.cheeseTotal}`);
```
Suspicion ring: the meter draws `strokeCircle(0, 0, 16)` and an `arc(0, 0, 16, …)` — replace both `16` with `this._hudLayout.meter.r`, and the line widths `3`/`4` with `Math.max(2, Math.round(3 * this._hudLayout.s))` / `Math.max(3, Math.round(4 * this._hudLayout.s))`.

Power-up block — replace the `const emoji = …` / `const txt = …` lines and the visibility toggles:
```js
            const txt = `${remaining}с`;
            const iconKey = POWERUP_ICON[this.activePowerup.type] || 'ui_bolt';
            if (this.powerupIcon.texture.key !== iconKey) this.powerupIcon.setTexture(iconKey);
            if (this.powerupText.text !== txt) this.powerupText.setText(txt);
            …(colour caching unchanged)…
            this.powerupText.setVisible(true);
            this.powerupIcon.setVisible(true);
        } else {
            if (this.activePowerup) this.activePowerup = null;
            this._powerupColorApplied = null;
            this.powerupText.setVisible(false);
            this.powerupIcon.setVisible(false);
        }
```

- [ ] **Step 5: `updateCompass()` edits** — replace the three `emoji = '🔑' / '👵' / '⬇'` assignments with `icon = 'key' / 'grandma' / 'exit'` (rename the variable `emoji` → `icon` throughout the method, including the cache key `const key = icon + '|' + …`). Replace `const size = 18;` with `const size = this._hudLayout ? this._hudLayout.compass.arrowSize : 18;` and `const ringR = Math.min(cam.width, cam.height) * 0.40;` with `const ringR = this._hudLayout ? this._hudLayout.compass.ringR : Math.min(cam.width, cam.height) * 0.40;`. Replace `this.compassLabel.setText(emoji);` with:

```js
        const COMPASS_ICON = { key: ['d_key', 1.5, 0.8], grandma: ['d_grandma', 0.9, 1.0], exit: ['ui_stairs', 1, 1] };
        const [tex, wf, hf] = COMPASS_ICON[icon];
        const ls = this._hudLayout ? this._hudLayout.compass.labelSize : 26;
        if (this.compassLabel.texture.key !== tex) this.compassLabel.setTexture(tex);
        this.compassLabel.setDisplaySize(ls * wf, ls * hf);
```
and change the label offset `26` in `setPosition(ax - Math.cos(angle) * 26, …)` to `ls`.

- [ ] **Step 6: Exit-button touch guards** — there are two places that treat the top-right 60×60 px as the exit button (`grep -n "W - 60\|width - 60" www/js/scenes/DungeonScene.js`: `_inExitBtnArea` and the guard inside `touchDown`). Replace each condition with a circle test on the layout:

```js
        const e = this._hudLayout && this._hudLayout.exit;
        if (e && Math.hypot(p.x - e.cx, p.y - e.cy) < e.r + 10) …
```
(keep whatever each site does when the condition is true; if a site has no `p`, use the pointer variable it already uses).

- [ ] **Step 7: Sweep the remaining references** — every use of a converted field must still make sense for an `Image`:

```bash
grep -n "heartIcons\|compassLabel\|suspicionLabel\|bookCounterIcon\|crouchIcon\|keyIcon\|exitBtn\b" www/js/scenes/DungeonScene.js
grep -n "\.setText(" www/js/scenes/DungeonScene.js | grep -n "heartIcons\|compassLabel\|suspicionLabel\|bookCounterIcon\|crouchIcon\|keyIcon\|exitBtn\b"   # expect none
```
`setScale`/`setAlpha`/`setVisible`/tweens on these objects are fine. Anything calling `setText`/`setColor`/`setFontSize` on them must be converted (`setTexture`/`setTint`) — list each in the report. Also confirm no other code reads `this._touchUiSmall` (that field goes away in Task 5, still present now).

- [ ] **Step 8: Verify**

```bash
grep -n "🔑\|❤️\|🖤\|🧀\|👁\|📕\|🦶\|👵\|✕" www/js/scenes/DungeonScene.js | sed -n '1,40p'
```
Expected: no hits inside `buildHUD`/`repositionHUD`/`updateHUD`/`updateCompass` (hits elsewhere — world objects, floating text, overlays — are plan 2c and stay). `grep -c "computeHudLayout(" ` → 1 (repositionHUD). Syntax check. `/opt/homebrew/bin/node --test tools/tests/hudLayout.test.mjs` still passes.

- [ ] **Step 9: Commit**

```bash
git add www/js/scenes/DungeonScene.js
git commit -m "feat(hud): layout-driven HUD with uiScale + safe-area, SVG icons instead of emoji, no overlaps"
```

---

### Task 5: Touch controls use the layout and SVG hints

**Files:**
- Modify: `www/js/scenes/DungeonScene.js` — `setupTouchControls()`, `positionJoystick()`

- [ ] **Step 1: Sizes from the layout** — at the top of `setupTouchControls()` replace

```js
        const isSmall = (window.innerHeight < 500) || (window.innerWidth < 800);
        const JOY_R = isSmall ? 58 : 76;
        const DASH_R = isSmall ? 42 : 52;
        this._touchUiSmall = isSmall;
```
with
```js
        const cam = this.cameras.main;
        const L = this._hudLayout || computeHudLayout({ W: cam.width, H: cam.height, safe: readSafeArea(), maxHp: PLAYER.maxHp });
        const JOY_R = L.touch.joyR;
        const DASH_R = L.touch.dashR;
        const LABEL_FONT = `${L.touch.labelFont}px`;
```
(`setupTouchControls()` runs before `buildHUD()` in `create()`, hence the fallback.)

- [ ] **Step 2: Hints as images** — replace the three emoji Texts:

```js
        this.joyHints = this.add.image(0, 0, 'ui_move').setOrigin(0.5).setScrollFactor(0)
            .setDepth(LAYER.UI_TOUCH_HINT).setAlpha(0.15).setDisplaySize(JOY_R * 1.2, JOY_R * 1.2);
```
```js
        this.aimStickHint = this.add.image(0, 0, 'd_pie').setOrigin(0.5).setScrollFactor(0)
            .setDepth(LAYER.UI_TOUCH_HINT).setAlpha(0.45).setDisplaySize(JOY_R * 0.7, JOY_R * 0.7);
```
```js
        this.dashBtnLabel = this.add.image(0, 0, 'ui_dash').setOrigin(0.5).setScrollFactor(0)
            .setDepth(LAYER.UI_TOUCH_LABEL).setDisplaySize(DASH_R * 0.8, DASH_R * 0.8);
```
The three text labels (`joyLabel 'ХОДЬБА'`, `aimLabel 'ПРИЦЕЛ + ОГОНЬ'`, `dashLabel 'РЫВОК'`) keep their style but use `fontSize: LABEL_FONT`.

- [ ] **Step 3: `positionJoystick()` offsets from the layout** — replace

```js
        const small = this._touchUiSmall;
        const bottomOff = small ? this.joy.R + 18 : 130;
        const sideOff   = small ? this.joy.R + 18 : 130;
```
with
```js
        const L = this._hudLayout || computeHudLayout({ W, H, safe: readSafeArea(), maxHp: PLAYER.maxHp });
        const bottomOff = L.touch.bottomOff;
        const sideOffL = L.touch.sideOffLeft, sideOffR = L.touch.sideOffRight;
```
then use `sideOffL` for the move stick (`this.joy.baseX = sideOffL`), `sideOffR` for the aim stick and dash (`W - sideOffR`), and `const gap = L.touch.dashGap;` instead of `small ? 22 : 30`.

- [ ] **Step 4: Sweep** — `grep -n "_touchUiSmall\|isSmall" www/js/scenes/DungeonScene.js` → no hits. Every `dashBtnLabel`/`joyHints`/`aimStickHint` use (`grep -n`) must be Image-compatible (alpha/position/scale tweens OK; no `setText`). `setTouchUIVisible()` still lists the same 15 objects.

- [ ] **Step 5: Verify** — syntax check; `grep -n "✥\|🥧\|💨" www/js/scenes/DungeonScene.js` shows no hits inside `setupTouchControls` (the `💨` floating texts elsewhere are plan 2c).

- [ ] **Step 6: Commit**

```bash
git add www/js/scenes/DungeonScene.js
git commit -m "feat(touch): stick/dash sizes and offsets from uiScale + safe-area, SVG hints"
```

---

### Task 6: Sync + acceptance (human)

- [ ] **Step 1:** `/opt/homebrew/bin/node --test tools/tests/hudLayout.test.mjs` → `fail 0`; `/opt/homebrew/bin/node node_modules/@capacitor/cli/bin/capacitor sync` → `Sync finished`.
- [ ] **Step 2: Desktop check** — open the game in Chrome, DevTools device mode at **360×640** and **640×360**: hearts+key top-left, cheese centre (pushed right of the key on 360 wide), exit top-right, status row (eye ring / book ×3 / paw) under the hearts, power-up timer under it after picking a power-up; nothing overlaps; sticks/dash inside the screen; resize the window — HUD re-lays out.
- [ ] **Step 3: Device check** — on the phone: no emoji anywhere in the HUD or touch controls; icons crisp (not blocky); safe-area respected (nothing under the notch / gesture bar); exit button tappable, and a tap near it does not spawn the aim stick; compass shows key → grandma → stairs; damage swaps hearts to the dark ones; `?fps=1` unchanged.
- [ ] **Step 4:** Report; anything that reads wrong gets a follow-up commit.

---

## Out of scope (plan 2c — overlays, world objects, floating text)

- Emoji → SVG for world objects (chest, relic chest, book, candelabra, 💤, ❗, 👂, 🔒/🔓, stairs arrow, captive bubble), relic/upgrade/biome icons in pickers and panel themes, floating-text emoji.
- Upgrade/relic pickers, shop, win/lose overlays and story intro re-laid out from screen size (cards ≥ 96px, scroll when short, buttons ≥ 48px); `_pickerElements`/`_shopElements` reset in `create()`.
