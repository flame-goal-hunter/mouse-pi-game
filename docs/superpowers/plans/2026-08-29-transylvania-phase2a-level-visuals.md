# Transylvania Phase 2a: Level Visuals («Тёплая готика») — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every dungeon floor look designed instead of drafted — stone plates without the 1px grid, brick walls with a gold skirting, all decor types actually drawn (no more mushrooms-everywhere), decor layered correctly under walls again, and each biome visibly different in darkness and palette (spec §4 of `docs/superpowers/specs/2026-08-29-transylvania-polish-design.md`).

**Architecture:** All level art stays procedural Phaser Graphics, drawn once at build time and baked into the existing `worldRT` (Phase 1). This plan adds a shared `decorGfx` layer that every prop painter draws into, then bakes it BETWEEN floor and walls (floor → decor → walls → sconces), which restores the pre-Phase-1 layering and removes ~70-85 Graphics objects. Palette/darkness/decor-weights live in `www/js/scenes/Biomes.js`; painters and drawing in `www/js/scenes/DungeonScene.js`. Biome mechanic tiles (butter / vines / thorn / hotpan) are NOT baked — hotpan redraws per phase and vines grow at runtime — they stay as the few live Graphics they are today (deviation from the spec line that mentioned tiles; decor is the ~80-object problem, tiles are 4-13).

**Tech Stack:** Phaser 3.70 (CDN), vanilla ES modules, no build step.

**Testing note:** no JS test runner in this repo. Every task ends with a syntax check (`node --check` on an `.mjs` copy) and a code-level assertion (grep counts). Visual acceptance is done by the human on device at the end (Task 9 checklist). Run locally: `cd www && python3 -m http.server 8080` → `http://localhost:8080/game-phaser.html?mode=transylvania&runMode=story&fps=1`; use `runMode=endless` to reach floors 2-5 quickly (each floor = next biome).

**Git:** branch `network_mode`, working tree clean at `ac8ee04`. Stage only the files named in each task. Never `git add -A`.

**Depth-constants scope note (spec §4 last bullet):** the spec asks for one table instead of ~40 magic depths. This plan introduces the `LAYER` table and applies it to every level-visual depth (world/tile/decor/wall/sconce/flame/eyes) — values unchanged, zero visual change. The HUD/UI depth band (989-3000) is replaced in plan 2b together with the HUD rework, where those objects are being repositioned anyway.

---

### Task 1: Biome palette, darkness and decor weights

**Files:**
- Modify: `www/js/scenes/Biomes.js` (the five biome objects)

- [ ] **Step 1: Dungeon (floor 1) — warm-gothic violet stone, deepest baseline darkness**

Replace these lines inside the `id: 'dungeon'` object:

```js
        floorColorA: 0x181020, floorColorB: 0x1c1428,
        gridColor:   0x080410,
        wallFill:    0x2a182a, wallShadow: 0x100410, wallHighlight: 0x3d2440,
        // Unified moderate darkness — lantern always matters; color varies per biome
        darknessColor: 0x080418, darknessAlpha: 0.76,
```

with:

```js
        floorColorA: 0x221333, floorColorB: 0x281838,
        gridColor:   0x120820,
        wallFill:    0x2a1a3e, wallShadow: 0x120818, wallHighlight: 0x3e2a56,
        // Warm gothic: violet stone, amber torch pools; darkest of the "normal" floors
        darknessColor: 0x080418, darknessAlpha: 0.78,
```

(decorWeights for dungeon stay: mushroom 3, bone 3, cobweb 1, skull 2, chain 1 — the painters for skull/chain arrive in Task 4.)

- [ ] **Step 2: Kitchen (floor 2) — lightest, warm hearth**

Replace inside `id: 'kitchen'`:

```js
        floorColorA: 0x2a1810, floorColorB: 0x301c10,
        gridColor:   0x180a04,
```
```js
        darknessColor: 0x3a1808, darknessAlpha: 0.76,
```

with:

```js
        floorColorA: 0x2c1a12, floorColorB: 0x321e14,
        gridColor:   0x1a0c06,
```
```js
        darknessColor: 0x3a1808, darknessAlpha: 0.60,
```

- [ ] **Step 3: Library (floor 3) — cool ink-blue floor, candle-warm; wire the unused `candle` painter**

Replace inside `id: 'library'`:

```js
        floorColorA: 0x0c0a1a, floorColorB: 0x10102a,
        gridColor:   0x040408,
```
```js
        darknessColor: 0x0a0a20, darknessAlpha: 0.76,
        decorWeights: [
            { type: 'book',      w: 5 },
            { type: 'scroll',    w: 3 },
            { type: 'inkwell',   w: 2 },
            { type: 'bookshelf', w: 4 },  // cover prop
            { type: 'forbiddenBook', w: 0 } // dynamic spawn — 3 per floor in stealth rooms
        ],
```

with:

```js
        floorColorA: 0x14122a, floorColorB: 0x181632,
        gridColor:   0x0a0818,
```
```js
        darknessColor: 0x0a0a20, darknessAlpha: 0.70,
        decorWeights: [
            { type: 'book',      w: 5 },
            { type: 'scroll',    w: 3 },
            { type: 'inkwell',   w: 2 },
            { type: 'bookshelf', w: 4 },
            { type: 'candle',    w: 2 },
            { type: 'forbiddenBook', w: 0 } // dynamic spawn — 3 per floor in stealth rooms
        ],
```

- [ ] **Step 4: Garden (floor 4) — moonlit blue darkness (accent from mockup B); wire `flower` + `vine`**

Replace inside `id: 'garden'`:

```js
        floorColorA: 0x0e2230, floorColorB: 0x142838,
        gridColor:   0x040c08,
```
```js
        // Green-tinted moonlit darkness — garden feel
        darknessColor: 0x081810, darknessAlpha: 0.76,
        decorWeights: [
            { type: 'moonflower', w: 3 },
            { type: 'glowpod',    w: 2 },
            { type: 'hedge_tuft', w: 3 },
            { type: 'lilypad',    w: 1 }
        ],
```

with:

```js
        floorColorA: 0x10222e, floorColorB: 0x142836,
        gridColor:   0x081418,
```
```js
        // Moonlit blue darkness — the one cool floor (accent from the "Лунная ночь" mockup)
        darknessColor: 0x0a1428, darknessAlpha: 0.74,
        decorWeights: [
            { type: 'moonflower', w: 3 },
            { type: 'glowpod',    w: 2 },
            { type: 'hedge_tuft', w: 3 },
            { type: 'lilypad',    w: 1 },
            { type: 'flower',     w: 2 },
            { type: 'vine',       w: 1 }
        ],
```

- [ ] **Step 5: Throne (floor 5) — darkest, and kill the gold 1px grid**

Replace inside `id: 'throne'`:

```js
        floorColorA: 0x1a0814, floorColorB: 0x200a18,
        gridColor:   0xffd060,
```
```js
        darknessColor: 0x180408, darknessAlpha: 0.76,
```

with:

```js
        floorColorA: 0x1c0a16, floorColorB: 0x220c1a,
        gridColor:   0x2a0c1c,
```
```js
        darknessColor: 0x180408, darknessAlpha: 0.82,
```

- [ ] **Step 6: Verify**

```bash
grep -n "darknessAlpha" www/js/scenes/Biomes.js
```
Expected: exactly five hits with values 0.78, 0.60, 0.70, 0.74, 0.82 in that order. `grep -n "0xffd060" www/js/scenes/Biomes.js` → no hits. Syntax:

```bash
cp www/js/scenes/Biomes.js /tmp/biomes_check.mjs && /opt/homebrew/bin/node --check /tmp/biomes_check.mjs && echo OK
```

- [ ] **Step 7: Commit**

```bash
git add www/js/scenes/Biomes.js
git commit -m "visual: per-biome darkness and warm-gothic palette; wire candle/flower/vine decor; drop throne gold grid"
```

---

### Task 2: `LAYER` depth table for level visuals (values unchanged)

**Files:**
- Modify: `www/js/scenes/DungeonScene.js` — module constants (next to `const PLAYER = {...}`), `buildWorld()`, `drawCarvedFloor()`, `drawBiomeTile()`, `placeSpookyEyes()`

- [ ] **Step 1: Define the table**

Immediately after the `const POWERUP_EMOJI = {...};` line (module scope, above the class), add:

```js
// Render-depth bands for level visuals. Values are the historical magic numbers —
// this table only names them. UI bands (989+) are named in the HUD rework.
const LAYER = {
    WORLD:  -100,   // baked RenderTexture: floor + decor + walls + sconces
    TILE:    -90,   // live biome tiles (butter / vines / thorn / hotpan)
    DECOR:   -50,   // decor layer before baking
    WALL:     50,   // wall Graphics before baking (and weak-wall overlays 51-52)
    SCONCE:   70,
    FLAME:    81,
    EYES:     82,
};
const WALL_TRIM_GOLD = 0xd8a850;   // gilded skirting where walls meet the floor
```

- [ ] **Step 2: Apply it (search each exact string, replace the number only)**

| Location | Find | Replace with |
|---|---|---|
| `buildWorld()` top | `this.wallGfx = this.add.graphics().setDepth(50);` | `this.wallGfx = this.add.graphics().setDepth(LAYER.WALL);` |
| `buildWorld()` top | `this.torchSconceGfx = this.add.graphics().setDepth(70);` | `...setDepth(LAYER.SCONCE);` |
| `buildWorld()` top | `this.flameGfx = this.add.graphics().setDepth(81);  // ALL torch flames, one clear per frame` | `...setDepth(LAYER.FLAME);  // ALL torch flames, one clear per frame` |
| `buildWorld()` bake block | `.setOrigin(0).setDepth(-100);` | `.setOrigin(0).setDepth(LAYER.WORLD);` |
| `drawCarvedFloor()` | `floor.setDepth(-100);` | `floor.setDepth(LAYER.WORLD);` |
| `drawBiomeTile()` | `const g = this.add.graphics().setDepth(-90);` | `const g = this.add.graphics().setDepth(LAYER.TILE);` |
| `placeSpookyEyes()` ONLY | the `.setDepth(82)` on the eye objects created inside `placeSpookyEyes` | `.setDepth(LAYER.EYES)` |

For the last row: `grep -n "setDepth(82)"` returns 4 hits; change only the one(s) inside `placeSpookyEyes()` (between `placeSpookyEyes() {` and the next method). The other `82`s are smoke/spark FX and stay numeric.

- [ ] **Step 3: Verify**

```bash
grep -c "LAYER\." www/js/scenes/DungeonScene.js
```
Expected: 7 (or 8 if placeSpookyEyes had two eye objects) uses. `grep -n "setDepth(-100)\|setDepth(-90)\|setDepth(70)\|setDepth(81)" www/js/scenes/DungeonScene.js` → no hits. Syntax:

```bash
cp www/js/scenes/DungeonScene.js /tmp/ds_check.mjs && /opt/homebrew/bin/node --check /tmp/ds_check.mjs && echo OK
```

- [ ] **Step 4: Commit**

```bash
git add www/js/scenes/DungeonScene.js
git commit -m "refactor: LAYER depth table for level visuals (values unchanged)"
```

---

### Task 3: Shared `decorGfx` layer, painters draw into it, decor baked between floor and walls

**Files:**
- Modify: `www/js/scenes/DungeonScene.js` — `buildWorld()` (create + bake), `drawDecor()`, all 17 painters (`drawPot` … `drawCobweb`, `drawMushroom`, `drawBone`)

- [ ] **Step 1: Create the layer**

In `buildWorld()`, right after the `this.flameGfx = ...` line, add:

```js
        this.decorGfx = this.add.graphics().setDepth(LAYER.DECOR);   // all props; baked under walls
```

- [ ] **Step 2: Convert the 15 painters that allocate their own Graphics**

Every kitchen/library/garden/throne/cobweb painter starts with the exact line `        const g = this.add.graphics().setDepth(-50);`. Replace all of them:

```bash
grep -c "const g = this.add.graphics().setDepth(-50);" www/js/scenes/DungeonScene.js   # expect 15
sed -i '' 's/const g = this\.add\.graphics()\.setDepth(-50);/const g = this.decorGfx;/' www/js/scenes/DungeonScene.js
grep -c "const g = this.add.graphics().setDepth(-50);" www/js/scenes/DungeonScene.js   # expect 0
grep -c "const g = this.decorGfx;" www/js/scenes/DungeonScene.js                        # expect 15
```

- [ ] **Step 3: Convert `drawMushroom` and `drawBone` (they set depth at the end)**

In `drawMushroom(x, y)` replace its first line `        const g = this.add.graphics();` with `        const g = this.decorGfx;` and DELETE its last line `        g.setDepth(-50);`. Do exactly the same in `drawBone(x, y)`. Then:

```bash
grep -c "const g = this.decorGfx;" www/js/scenes/DungeonScene.js   # expect 17
grep -n "g.setDepth(-50);" www/js/scenes/DungeonScene.js            # expect no hits
```

- [ ] **Step 4: Guard the dispatcher**

At the top of `drawDecor(x, y, type)` (before the `switch`), add:

```js
        if (!this.decorGfx) { console.warn('[DungeonScene] drawDecor after bake:', type); return; }
```

- [ ] **Step 5: Bake decor between floor and walls**

In the `=== BAKE static geometry ===` block of `buildWorld()`, replace:

```js
        worldRT.draw(this.floorGfx);
        worldRT.draw(this.wallGfx);
        worldRT.draw(this.torchSconceGfx);
        this.floorGfx.destroy();        this.floorGfx = null;
        this.wallGfx.destroy();         this.wallGfx = null;
        this.torchSconceGfx.destroy();  this.torchSconceGfx = null;
```

with:

```js
        worldRT.draw(this.floorGfx);
        worldRT.draw(this.decorGfx);      // props sit ON the floor, UNDER wall bricks
        worldRT.draw(this.wallGfx);
        worldRT.draw(this.torchSconceGfx);
        this.floorGfx.destroy();        this.floorGfx = null;
        this.decorGfx.destroy();        this.decorGfx = null;
        this.wallGfx.destroy();         this.wallGfx = null;
        this.torchSconceGfx.destroy();  this.torchSconceGfx = null;
```

Also update the comment above it from `// floor (~7k cmds) + walls (~3.5k cmds) + sconces were Graphics command` to `// floor (~7k cmds) + decor (~80 objects) + walls (~3.5k cmds) + sconces were Graphics command`.

- [ ] **Step 6: Verify**

```bash
grep -n "decorGfx" www/js/scenes/DungeonScene.js
```
Expected: creation in buildWorld, the guard in drawDecor, 17 painter uses, 2 lines in the bake block (draw + destroy/null). `grep -n "drawDecor(" www/js/scenes/DungeonScene.js` → definition + one call in `placeRandomTorches` (build time, before the bake). Syntax check as in Task 2.

- [ ] **Step 7: Commit**

```bash
git add www/js/scenes/DungeonScene.js
git commit -m "perf+visual: all decor props draw into one layer, baked between floor and walls (restores layering, -80 Graphics)"
```

---

### Task 4: Painters — skull, chain, bookshelf, red carpet

**Files:**
- Modify: `www/js/scenes/DungeonScene.js` — `drawDecor()` switch; new methods placed immediately BEFORE `drawCobweb(x, y)`

- [ ] **Step 1: Add the four painters** (insert before the `// ----- Universal cobweb (dungeon) -----` comment)

```js
    // ----- Dungeon / throne: skull, chain -----
    drawSkull(x, y) {
        const g = this.decorGfx;
        g.lineStyle(1.5, 0x1a1024, 1);
        // Cranium
        g.fillStyle(0xe8e0d0, 1);
        g.fillCircle(x, y - 3, 7);
        g.strokeCircle(x, y - 3, 7);
        // Jaw
        g.fillRoundedRect(x - 5, y + 1, 10, 5, 2);
        g.strokeRoundedRect(x - 5, y + 1, 10, 5, 2);
        // Eye sockets + nose
        g.fillStyle(0x1a1024, 1);
        g.fillCircle(x - 3, y - 4, 2);
        g.fillCircle(x + 3, y - 4, 2);
        g.fillTriangle(x, y - 1, x - 1.2, y + 1, x + 1.2, y + 1);
        // Teeth
        g.lineStyle(1, 0x1a1024, 0.8);
        for (let i = -3; i <= 3; i += 2) g.lineBetween(x + i, y + 2, x + i, y + 5);
    }
    drawChain(x, y) {
        const g = this.decorGfx;
        // Four links lying diagonally on the floor, alternating orientation
        for (let i = 0; i < 4; i++) {
            const lx = x - 9 + i * 6, ly = y + 4 - i * 3;
            const wide = (i & 1) === 0;
            g.lineStyle(2, 0x1a1024, 1);
            g.strokeEllipse(lx, ly, wide ? 8 : 5, wide ? 5 : 8);
            g.lineStyle(1, 0x9a9aa4, 0.9);
            g.strokeEllipse(lx, ly, wide ? 6 : 3.5, wide ? 3.5 : 6);
        }
        // Anchor ring at the end
        g.lineStyle(2, 0x1a1024, 1);
        g.strokeCircle(x + 12, y - 8, 3.5);
        g.lineStyle(1, 0x9a9aa4, 0.9);
        g.strokeCircle(x + 12, y - 8, 2);
    }

    // ----- Library: bookshelf -----
    drawBookshelf(x, y) {
        const g = this.decorGfx;
        g.lineStyle(1.5, 0x1a1024, 1);
        // Case
        g.fillStyle(0x4a2a12, 1);
        g.fillRect(x - 13, y - 30, 26, 34);
        g.strokeRect(x - 13, y - 30, 26, 34);
        // Cornice
        g.fillStyle(0x6a3e1c, 1);
        g.fillRect(x - 15, y - 33, 30, 4);
        g.strokeRect(x - 15, y - 33, 30, 4);
        // Three shelves of books
        const colors = [0x7a3030, 0x2a5078, 0x4a6028, 0x7a4a10, 0x5a3a7a];
        for (let s = 0; s < 3; s++) {
            const sy = y - 26 + s * 11;
            let bx = x - 11;
            while (bx < x + 10) {
                const bw = 3 + Math.floor(Math.random() * 3);   // 3..5
                const bh = 7 + Math.floor(Math.random() * 3);   // 7..9
                g.fillStyle(colors[Math.floor(Math.random() * colors.length)], 1);
                g.fillRect(bx, sy + (9 - bh), bw, bh);
                g.lineStyle(1, 0x1a1024, 0.8);
                g.strokeRect(bx, sy + (9 - bh), bw, bh);
                bx += bw + 1;
            }
            g.fillStyle(0x6a3e1c, 1);
            g.fillRect(x - 13, sy + 9, 26, 2);
        }
    }

    // ----- Throne: red carpet -----
    drawRedCarpet(x, y) {
        const g = this.decorGfx;
        g.fillStyle(0x7a1020, 1);
        g.lineStyle(1.5, 0x1a1024, 1);
        g.fillRoundedRect(x - 22, y - 11, 44, 22, 2);
        g.strokeRoundedRect(x - 22, y - 11, 44, 22, 2);
        // Gold border
        g.lineStyle(1.5, WALL_TRIM_GOLD, 0.9);
        g.strokeRect(x - 18, y - 7, 36, 14);
        // Fringe on both short ends
        g.lineStyle(1, WALL_TRIM_GOLD, 0.8);
        for (let i = -9; i <= 9; i += 3) {
            g.lineBetween(x - 22, y + i, x - 25, y + i);
            g.lineBetween(x + 22, y + i, x + 25, y + i);
        }
    }

```

- [ ] **Step 2: Wire them in `drawDecor`**

Add these cases to the `switch (type)` (anywhere before `default:`):

```js
            case 'skull':     return this.drawSkull(x, y);
            case 'chain':     return this.drawChain(x, y);
            case 'bookshelf': return this.drawBookshelf(x, y);
            case 'redCarpet': return this.drawRedCarpet(x, y);
```

- [ ] **Step 3: Verify**

`grep -n "drawSkull\|drawChain\|drawBookshelf\|drawRedCarpet" www/js/scenes/DungeonScene.js` → 4 definitions + 4 cases. Syntax check.

- [ ] **Step 4: Commit**

```bash
git add www/js/scenes/DungeonScene.js
git commit -m "visual: skull, chain, bookshelf and red-carpet decor painters"
```

---

### Task 5: Painters — moonflower, glowpod, hedge tuft, lily pad; retire broken glass; no more silent mushroom fallback

**Files:**
- Modify: `www/js/scenes/DungeonScene.js` — `drawDecor()`, new garden painters (insert before `// ----- Throne: goblet -----`), delete `drawBrokenGlass`

- [ ] **Step 1: Add the four garden painters** (insert before the `// ----- Throne: goblet -----` comment)

```js
    // ----- Garden: moonflower, glowpod, hedge tuft, lily pad -----
    drawMoonflower(x, y) {
        const g = this.decorGfx;
        // Soft glow halo
        g.fillStyle(0xbfd8ff, 0.18);
        g.fillCircle(x, y - 10, 11);
        // Stem + leaf
        g.lineStyle(2, 0x2e5a3a, 1);
        g.lineBetween(x, y + 2, x, y - 8);
        g.fillStyle(0x3a7c46, 1);
        g.fillEllipse(x - 4, y - 3, 6, 3);
        // Six pale petals
        g.fillStyle(0xdbe8ff, 1);
        g.lineStyle(1, 0x1a1024, 0.6);
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            g.fillEllipse(x + Math.cos(a) * 4.5, y - 10 + Math.sin(a) * 4.5, 5, 3);
        }
        // Glowing center
        g.fillStyle(0xfff4c8, 1);
        g.fillCircle(x, y - 10, 2.5);
    }
    drawGlowpod(x, y) {
        const g = this.decorGfx;
        // Outer glow
        g.fillStyle(0x7ad0a0, 0.2);
        g.fillCircle(x, y - 4, 11);
        // Stem
        g.lineStyle(2, 0x2e5a3a, 1);
        g.lineBetween(x, y + 4, x, y - 2);
        // Pod
        g.fillStyle(0x5ab884, 1);
        g.lineStyle(1.5, 0x1a1024, 1);
        g.fillEllipse(x, y - 6, 9, 13);
        g.strokeEllipse(x, y - 6, 9, 13);
        // Bright core + highlight
        g.fillStyle(0xd0ffe0, 0.95);
        g.fillEllipse(x, y - 6, 4, 7);
        g.fillStyle(0xffffff, 0.7);
        g.fillEllipse(x - 2, y - 9, 1.5, 2.5);
    }
    drawHedgeTuft(x, y) {
        const g = this.decorGfx;
        g.lineStyle(1.5, 0x1a3a22, 1);
        const blobs = [[-6, 2, 5], [0, -2, 6], [6, 2, 5], [-3, 4, 4], [3, 4, 4]];
        for (const [dx, dy, r] of blobs) {
            g.fillStyle(0x2e6a3a, 1);
            g.fillCircle(x + dx, y + dy, r);
            g.strokeCircle(x + dx, y + dy, r);
        }
        // Leaf highlights
        g.fillStyle(0x4c9a58, 0.9);
        g.fillCircle(x - 5, y, 2);
        g.fillCircle(x + 1, y - 4, 2.2);
        g.fillCircle(x + 6, y, 1.8);
    }
    drawLilypad(x, y) {
        const g = this.decorGfx;
        // Pad
        g.fillStyle(0x3f8a4a, 1);
        g.lineStyle(1.5, 0x1a3a22, 1);
        g.fillEllipse(x, y, 18, 11);
        g.strokeEllipse(x, y, 18, 11);
        // Notch cut toward the center — painted in the floor color so it reads as a gap
        g.fillStyle(this.biome.floorColorA, 1);
        g.fillTriangle(x, y, x + 10, y - 3, x + 10, y + 3);
        g.lineStyle(1.5, 0x1a3a22, 1);
        g.lineBetween(x, y, x + 9, y - 3);
        g.lineBetween(x, y, x + 9, y + 3);
        // Pink bud
        g.fillStyle(0xff8fb0, 1);
        g.lineStyle(1, 0x1a1024, 0.7);
        g.fillCircle(x - 4, y - 2, 2.5);
        g.strokeCircle(x - 4, y - 2, 2.5);
    }

```

- [ ] **Step 2: Delete `drawBrokenGlass`** — remove the whole method (from `    drawBrokenGlass(x, y) {` through its closing `    }`) and the `case 'glass':    return this.drawBrokenGlass(x, y);` line in `drawDecor`. No biome ever requested `'glass'`.

- [ ] **Step 3: Wire the garden painters and make unknown types loud**

In `drawDecor`'s switch add:

```js
            case 'moonflower': return this.drawMoonflower(x, y);
            case 'glowpod':    return this.drawGlowpod(x, y);
            case 'hedge_tuft': return this.drawHedgeTuft(x, y);
            case 'lilypad':    return this.drawLilypad(x, y);
```

and replace the `default:         return this.drawMushroom(x, y);` line with:

```js
            default:
                console.warn('[DungeonScene] unknown decor type', type);
                return;
```

- [ ] **Step 4: Verify every weighted decor type has a painter**

```bash
grep -o "type: '[a-zA-Z_]*', *w: [1-9]" www/js/scenes/Biomes.js | sed "s/type: '\([a-zA-Z_]*\)'.*/\1/" | sort -u
```
Expected list: book bone bookshelf candle chain cobweb flower glowpod goblet hedge_tuft inkwell knife lilypad moonflower mushroom plate pot redCarpet sack scroll skull vine. For EACH, `grep -c "case '<type>'" www/js/scenes/DungeonScene.js` must be 1. `grep -n "drawBrokenGlass\|'glass'"` → no hits. Syntax check.

- [ ] **Step 5: Commit**

```bash
git add www/js/scenes/DungeonScene.js
git commit -m "visual: garden decor painters (moonflower, glowpod, hedge tuft, lily pad); remove dead glass painter; warn on unknown decor"
```

---

### Task 6: Floor — 80px stone plates, no grid, sparse cracks

**Files:**
- Modify: `www/js/scenes/DungeonScene.js` — `drawCarvedFloor()`

- [ ] **Step 1: Replace the whole method**

```js
    drawCarvedFloor() {
        const T = NAV_CELL;
        const floor = this.add.graphics();
        floor.setDepth(LAYER.WORLD);
        this.floorGfx = floor;
        const b = this.biome;
        const grid = this.navGrid;
        const isFloor = (r, c) => r >= 0 && r < NAV_H && c >= 0 && c < NAV_W && grid[r][c] === 'floor';

        // 1. Stone plates: 80px (2×2 nav cells), two close tones in a checker of PLATES
        for (let r = 0; r < NAV_H; r++) {
            for (let c = 0; c < NAV_W; c++) {
                if (grid[r][c] !== 'floor') continue;
                const variant = ((r >> 1) + (c >> 1)) & 1;
                floor.fillStyle(variant ? b.floorColorB : b.floorColorA, 1);
                floor.fillRect(c * T, r * T, T, T);
            }
        }
        // 2. Mortar seams ONLY on plate boundaries (every 80px) and only between two floor cells
        floor.lineStyle(1, b.gridColor, 0.35);
        for (let r = 0; r < NAV_H; r++) {
            for (let c = 0; c < NAV_W; c++) {
                if (grid[r][c] !== 'floor') continue;
                const x = c * T, y = r * T;
                if ((c & 1) === 0 && isFloor(r, c - 1)) floor.lineBetween(x, y, x, y + T);
                if ((r & 1) === 0 && isFloor(r - 1, c)) floor.lineBetween(x, y, x + T, y);
            }
        }
        // 3. Sparse detail: cracks (4% of cells) and pebbles (2%)
        for (let r = 0; r < NAV_H; r++) {
            for (let c = 0; c < NAV_W; c++) {
                if (grid[r][c] !== 'floor') continue;
                const roll = Math.random();
                if (roll >= 0.06) continue;
                const cx = c * T + T / 2, cy = r * T + T / 2;
                if (roll < 0.04) {
                    floor.lineStyle(1, b.gridColor, 0.55);
                    floor.beginPath();
                    floor.moveTo(cx - 9, cy - 3);
                    floor.lineTo(cx - 2, cy + 2);
                    floor.lineTo(cx + 4, cy - 1);
                    floor.lineTo(cx + 10, cy + 5);
                    floor.strokePath();
                } else {
                    floor.fillStyle(b.gridColor, 0.5);
                    floor.fillCircle(cx + 6, cy - 5, 1.5);
                    floor.fillCircle(cx - 7, cy + 6, 1.2);
                }
            }
        }
        // Apply biome-specific mechanic tiles (slippery butter / vines / etc.)
        this.spawnBiomeTiles();
    }
```

- [ ] **Step 2: Verify**

`grep -n "strokeRect(x, y, T, T)" www/js/scenes/DungeonScene.js` → no hits (the per-cell grid is gone). `grep -c "this.spawnBiomeTiles();"` → still 1 call from this method. Syntax check.

- [ ] **Step 3: Commit**

```bash
git add www/js/scenes/DungeonScene.js
git commit -m "visual: floor is 80px stone plates with plate-only seams and sparse cracks (no 1px grid)"
```

---

### Task 7: Walls — running-bond brickwork, dark top cant, gold skirting

**Files:**
- Modify: `www/js/scenes/DungeonScene.js` — `addWall(x, y, w, h)` (drawing part only; the spatial-hash part stays)

- [ ] **Step 1: Replace the drawing section**

In `addWall`, replace everything from the comment `        // === Draw on SHARED wall graphics (consolidated draw call) ===` to the end of the method with:

```js
        // === Draw on SHARED wall graphics (baked once in buildWorld) ===
        const g = this.wallGfx;
        g.fillStyle(b.wallFill, 1);
        g.fillRect(x, y, w, h);
        // Running-bond brickwork: two courses, the lower one offset by half a brick
        const brickW = 30, courseH = h / 2;
        g.lineStyle(1.2, b.wallShadow, 0.75);
        g.lineBetween(x, y + courseH, x + w, y + courseH);
        for (let course = 0; course < 2; course++) {
            const cy = y + course * courseH;
            const offset = course === 0 ? 0 : brickW / 2;
            for (let bx = x + offset; bx < x + w; bx += brickW) {
                g.lineBetween(bx, cy, bx, cy + courseH);
            }
        }
        // Dark recessed cant along the top edge, thin highlight under it
        g.fillStyle(b.wallShadow, 0.85);
        g.fillRect(x, y, w, 4);
        g.fillStyle(b.wallHighlight, 0.9);
        g.fillRect(x, y + 4, w, 2);
        // Gilded skirting where the wall meets the floor
        g.fillStyle(WALL_TRIM_GOLD, 0.55);
        g.fillRect(x, y + h - 2, w, 2);
        g.lineStyle(1, b.wallShadow, 0.9);
        g.lineBetween(x, y + h - 2, x + w, y + h - 2);
    }
```

- [ ] **Step 2: Verify**

`grep -n "const brickW = 60" www/js/scenes/DungeonScene.js` → no hits; `grep -c "WALL_TRIM_GOLD"` → 4 (const + carpet ×2 + wall). The `this.walls.push(wall)` and spatial-hash lines above the drawing section are untouched (`git diff` shows only the drawing block changed). Syntax check.

- [ ] **Step 3: Commit**

```bash
git add www/js/scenes/DungeonScene.js
git commit -m "visual: walls get running-bond bricks, dark top cant and gold skirting"
```

---

### Task 8: Keep props off wall edges at placement time

**Files:**
- Modify: `www/js/scenes/DungeonScene.js` — `placeRandomTorches()` props loop

- [ ] **Step 1: Add a clearance check**

In the `// Biome-themed props` loop of `placeRandomTorches()`, replace:

```js
                if (this.navGrid[gr]?.[gc] !== 'floor') continue;
                const type = pickDecor(this.biome.decorWeights);
```

with:

```js
                if (this.navGrid[gr]?.[gc] !== 'floor') continue;
                if (this.pointInWalls(x, y, 18)) continue;   // keep prop bodies off the brick edge
                const type = pickDecor(this.biome.decorWeights);
```

(`pointInWalls` uses `this.walls` + the spatial hash, both fully built before `placeRandomTorches` runs. Larger props — bookshelf 30px, carpet 50px — may still tuck under a wall; since Task 3 draws walls OVER decor again, that reads as "pushed against the wall", which is fine.)

- [ ] **Step 2: Verify + commit**

Syntax check, then:

```bash
git add www/js/scenes/DungeonScene.js
git commit -m "visual: props keep 18px clearance from walls"
```

---

### Task 9: Sync + device acceptance (human)

- [ ] **Step 1:** `/opt/homebrew/bin/node node_modules/@capacitor/cli/bin/capacitor sync` — expected `Sync finished`.
- [ ] **Step 2: Device checklist** (endless mode reaches all five biomes fastest):
  1. Floor 1 (подземелье): violet 80px plates, no fine grid, occasional crack/pebble; walls show two brick courses, dark top, gold skirting; skulls/chains/bones/mushrooms/cobwebs all appear; props never draw over brick (walls cover them).
  2. Floor 2 (кухня): clearly the brightest floor; pots/plates/knives/sacks.
  3. Floor 3 (библиотека): bookshelves with colored books, candles with tiny flames, no mushrooms at all.
  4. Floor 4 (сад): blue-tinted darkness (cooler than the others); moonflowers glow, glowpods, hedge tufts, lily pads, flowers, vines; no mushrooms.
  5. Floor 5 (трон): darkest floor; red carpets with gold border, goblets, chains; NO gold grid on the floor.
  6. `?fps=1`: fps unchanged or better than Phase 1 (decor is baked now); no console warnings `unknown decor type`.
- [ ] **Step 3:** Report results; any biome that reads "same as the others" gets its darknessAlpha/colors tuned in a follow-up commit.

---

## Out of scope (plan 2b — HUD & icons)

- Emoji → SVG for world objects and HUD (chest, relic chest, book, candelabra, 💤, compass, hearts…).
- HUD grid/uiScale/overlap fixes, pickers and overlays responsive layout.
- Naming the UI depth band (989-3000) in `LAYER`.
