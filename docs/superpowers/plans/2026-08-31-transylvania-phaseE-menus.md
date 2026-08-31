# Transylvania Phase E — Menus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The launcher modal and the Castle-of-Shadows menu look and behave like a professional mobile game on a phone: nothing overlaps or overflows, no artefacts bleeding through from another layer, no emoji as icons, touch targets ≥48 px, and the Castle menu's stage shows **Pi together with the monster cast** (spec `docs/superpowers/specs/2026-08-30-transylvania-art-overhaul.md` §3.E, §4 item 3; user complaints: «меню не адаптировано под телефон, кнопки кривые, не помещаются, меню вообще с монстрами должно быть, какие-то артефакты»).

**Architecture:** One CSS token layer (`transylvania-menu.css` `:root`) carries the "warm gothic" design system — semantic colours, a 4/8 px spacing scale, radii, easing, elevation — and every rule consumes tokens instead of raw hex. The Castle menu becomes a fixed-height CSS **grid** that never scrolls: landscape = two columns (left: cast stage; right: title → mode cards → footer), portrait = stacked rows. Icons come from a small SVG set (`www/assets/ui-menu/`) plus the existing kit (`www/assets/ui/`, `www/assets/world/`, `www/assets/characters/transylvania/`). The launcher (`www/index.html`) stops painting the adventure canvas behind its modal and lays the mode tabs out in one row. Fonts are bundled locally (Comfortaa display + the already-bundled Nunito body) — no Google Fonts request.

**Design system (from the `ui-ux-pro-max` engine, adapted to this game's art):**
- Pairing "Soft Rounded" — **display: Comfortaa 700** (rounded, has Cyrillic), **body/UI: Nunito 400/700/900** (already bundled). Type scale 12 / 14 / 16 / 20 / 26 / 34.
- Palette (warm gothic, dark-only — the game has no light mode): `--bg-deep #100620`, `--bg #1a0c2e`, `--surface #241338`, `--surface-2 #2e1a46`, `--gold #e8b54a`, `--gold-bright #f6d77a`, `--text #f4ecff`, `--text-muted #b9a6d4`, `--danger #ff4a5c`, `--ok #5cd67a`, `--border rgba(244,236,255,.12)`, `--scrim rgba(8,3,16,.72)`.
- Rules that MUST hold (engine's CRITICAL/HIGH): contrast ≥4.5:1 for text (verify `--text-muted` on `--surface`), touch targets ≥48×48 with ≥8 px gaps, no emoji icons, no horizontal scroll, safe-area insets on every fixed edge, motion 150–300 ms on transform/opacity only + `prefers-reduced-motion` honoured, one primary CTA per screen (Спасти бабушку), modal scrim 40–60 % black, visible focus rings, press feedback within 100 ms.

**Tech stack:** plain HTML/CSS/JS (no framework), ES modules, Capacitor 5 Android WebView (landscape-locked by the manifest; `viewport-fit=cover`). Verify with the headless-Chromium/Playwright pipeline (memory `screenshot-pipeline`).

**Ground rules:** stage only the files each task names (never `git add -A`; never touch `guardrail/`); keep the contracts listed below working; `cap sync` at the end; screenshots at **915×412, 640×360 and 360×640** are the acceptance evidence for every visual task.

**Contracts that must keep working (verified 2026-08-31):**
- `transylvania-menu.js` addresses the DOM by id — keep every id: `#balance-value #hero-sprite #hero-name #story-hint #endless-hint #skin-grid #upgrade-list #bestiary-list #stats-block #achievements-list #toast #shop-modal #codex-modal #shop-balance-value #btn-back #btn-shop #btn-codex #card-story #card-endless` and the `[data-close="shop|codex"]` convention. `#hero-accent` is now unused (emoji accents were removed) — it may go, then delete its JS line too.
- Run start: `startRun(runMode)` → `game-phaser.html?mode=transylvania&runMode=story|endless` (`transylvania-menu.js:118`); `BootScene` parses those params.
- Return path: inside an iframe the menu posts `postMessage('closePhaserSnowball', '*')` (`transylvania-menu.js:~388`), handled by `index.html:~10629` → `stopPhaserSnowball()`.
- `index.html` launcher: `startTransylvaniaPreview()` (~10577) sets `#phaserFrame.src = 'transylvania-menu.html?_v=…'`, hides `#startScreen`/`#gameCanvas`, sets `phaserRunning = true`. `#transylvaniaOptions` (~481-485) is only shown/hidden at `:1347` and `:10554` — if it is removed, patch both.
- Progress/data: `www/js/storage/ProgressStore.js` (`Progress`, `SKINS`, `PERMANENT_UPGRADES`); the menu imports it as a module.
- Do NOT touch GameScene/multiplayer/PeerJS code in `index.html`.

---

### Task 1: Design tokens, local Comfortaa, menu icon set

**Files:**
- Create: `www/assets/fonts/comfortaa-{400,700}-{latin,cyrillic}.woff2` + append to `www/assets/fonts/nunito.css` (rename usage stays), `www/assets/ui-menu/{arrow_left,shop,scroll,check,infinity,trophy,skull}.svg`
- Modify: `www/transylvania-menu.html` (font links), `www/transylvania-menu.css` (`:root` tokens)

- [ ] **Step 1: Bundle Comfortaa** (same recipe as Nunito in `docs/superpowers/plans/2026-08-30-transylvania-phaseA-render-base.md` Task 1):
```bash
UA="Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36"
curl -sL -A "$UA" "https://fonts.googleapis.com/css2?family=Comfortaa:wght@400;700&display=swap" > /tmp/comfortaa.css
```
then the same python extractor, keeping only the `latin` and `cyrillic` subsets, writing `www/assets/fonts/comfortaa-<weight>-<subset>.woff2` and APPENDING the `@font-face` rules to `www/assets/fonts/nunito.css` (one stylesheet for both families; keep its existing rules untouched). Verify 4 new files and that each `@font-face` has a non-empty `unicode-range`.

- [ ] **Step 2: `transylvania-menu.html` head** — replace the three Google Fonts lines with `    <link rel="stylesheet" href="assets/fonts/nunito.css">`. `grep -n "googleapis\|gstatic" www/transylvania-menu.html` → no hits.

- [ ] **Step 3: Icon set** — create these seven files (viewBox 0 0 24 24, stroke `#f4ecff` unless a fill is given; they are recoloured by `filter`/`fill` in CSS):

`www/assets/ui-menu/arrow_left.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5 L8 12 L15 19"/></svg>
```
`www/assets/ui-menu/shop.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8 L5 3 H19 L21 8"/><path d="M3 8 h18 v3 a3 3 0 0 1-6 0 a3 3 0 0 1-6 0 a3 3 0 0 1-6 0 Z"/><path d="M5 13 v8 h14 v-8"/><path d="M10 21 v-5 h4 v5"/></svg>
```
`www/assets/ui-menu/scroll.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4 h11 a2 2 0 0 1 2 2 v12 a2 2 0 0 0 2 2 H8 a2 2 0 0 1-2-2 Z"/><path d="M6 4 a2 2 0 0 0-2 2 v2 h4"/><path d="M9 9 h7 M9 13 h7 M9 17 h4"/></svg>
```
`www/assets/ui-menu/check.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13 L9 18 L20 6"/></svg>
```
`www/assets/ui-menu/infinity.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M8.5 12 C8.5 9.5 6.8 8 5.2 8 C3.4 8 2 9.8 2 12 C2 14.2 3.4 16 5.2 16 C8.5 16 10 8 15.5 8 C19 8 22 9.5 22 12 C22 14.5 19 16 15.5 16 C13 16 11 14 9.5 12"/></svg>
```
`www/assets/ui-menu/trophy.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4 h10 v6 a5 5 0 0 1-10 0 Z"/><path d="M7 6 H4 a3 3 0 0 0 3 4"/><path d="M17 6 h3 a3 3 0 0 1-3 4"/><path d="M12 15 v3"/><path d="M8.5 21 h7 l-1-3 h-5 Z"/></svg>
```
`www/assets/ui-menu/skull.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3 C7 3 4 6.5 4 11 c0 2.5 1.3 4 2.6 4.8 V19 h10.8 v-3.2 C18.7 15 20 13.5 20 11 c0-4.5-3-8-8-8 Z"/><circle cx="9" cy="11" r="1.8" fill="currentColor" stroke="none"/><circle cx="15" cy="11" r="1.8" fill="currentColor" stroke="none"/><path d="M11 15 h2"/></svg>
```
Validate: `python3 -c "import xml.dom.minidom,glob; [xml.dom.minidom.parse(f) for f in glob.glob('www/assets/ui-menu/*.svg')]; print('SVG_OK')"`.

- [ ] **Step 4: Tokens** — at the very top of `www/transylvania-menu.css` replace the existing `:root` block (or add one if absent) with:
```css
:root {
    /* Warm gothic — dark only. Semantic tokens; never use raw hex below this block. */
    --bg-deep: #100620;   --bg: #1a0c2e;      --surface: #241338;   --surface-2: #2e1a46;
    --gold: #e8b54a;      --gold-bright: #f6d77a;
    --text: #f4ecff;      --text-muted: #b9a6d4;
    --danger: #ff4a5c;    --ok: #5cd67a;
    --border: rgba(244, 236, 255, 0.12);
    --scrim: rgba(8, 3, 16, 0.72);
    --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
    --space-5: 24px; --space-6: 32px; --space-7: 48px;
    --radius-sm: 8px; --radius: 14px; --radius-lg: 20px; --radius-pill: 999px;
    --tap: 48px;                                   /* minimum touch target */
    --font-display: 'Comfortaa', 'Nunito', system-ui, sans-serif;
    --font-body: 'Nunito', system-ui, sans-serif;
    --ease: cubic-bezier(0.2, 0.8, 0.3, 1);
    --dur: 180ms;
    --elev-1: 0 2px 8px rgba(0, 0, 0, 0.35);
    --elev-2: 0 8px 24px rgba(0, 0, 0, 0.45);
}
@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
}
```
Then sweep the file: every `font-family` uses the two tokens; obvious colour literals that match a token are replaced. Do NOT restructure layout here — Task 3 does that. `grep -c "var(--" www/transylvania-menu.css` ≥ 40 afterwards.

- [ ] **Step 5: Verify + commit** — serve and screenshot the menu at 915×412 (pipeline; see the Verify recipe in Task 3) just to confirm nothing broke and Comfortaa loads (title glyph shapes change). Then:
```bash
git add www/assets/fonts www/assets/ui-menu www/transylvania-menu.html www/transylvania-menu.css
git commit -m "feat(menu): design tokens, locally bundled Comfortaa, SVG menu icon set"
```

---

### Task 2: Launcher modal — kill the bleed-through, fit the card, enter the castle directly

**Files:**
- Modify: `www/index.html` (CSS block ~15-412 and the mode-select handlers ~1337-1402, `draw()` ~7361)

- [ ] **Step 1: Stop painting the game behind the overlay.** `draw()` (~7361) renders the adventure scene every frame even on the menu, and `.overlay` is only 92 % opaque — that is the source of the artefacts the user sees (a «🧀 0» counter, a face, «Огненная долина», «2%»). At the top of `draw()` add:
```js
    // Menu is up: paint a flat backdrop instead of the adventure scene (no bleed-through artefacts).
    const _startScreen = document.getElementById('startScreen');
    if (!phaserRunning && _startScreen && _startScreen.style.display !== 'none') {
        ctx.fillStyle = '#0f0820';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return;
    }
```
Read `draw()` first and place this after its existing guards but before the mode branches; make sure `ctx`/`canvas` are the names in scope. Verify by screenshot that the modal now sits on a flat field.

- [ ] **Step 2: Tabs in one row, CTA inside the card.** In the `<style>` block: `.mode-btn { min-width: 0; flex: 1 1 0; }` (was `min-width: 20vw`, which forced a second row at 915 px and pushed «Играть!» out of the card); shrink `.mode-icon` to `font-size: min(6vw, 28px)`; change `.overlay-content` from `height: 88vh` / `92vh` + `justify-content: center` to `max-height: 92vh; justify-content: flex-start; gap: 10px;` and give the per-mode panels `overflow-y: auto`. Keep `#adventureOptions .play-btn { margin-top: auto !important; }`. Acceptance: at 915×412 all four tabs are on one row and the «Играть!» button is fully inside the card with ≥8 px to the card edge.

- [ ] **Step 3: «Замок Теней» enters the castle menu directly.** In the `.mode-btn` handler (~1337-1364), when `data-mode === 'transylvania'`, call `startTransylvaniaPreview()` instead of only switching panels (keep the tab highlight for the frame before the iframe appears). Leave `#transylvaniaOptions` in the DOM (both `:1347` and `:10554` still touch it) but hide it permanently via CSS so the card doesn't show an empty panel. Verify the back path still works: iframe «‹ Меню» → `postMessage` → the launcher restores the modal.

- [ ] **Step 4: Touch/hit-area pass** — `.mode-btn`, `.diff-btn`, `.play-btn`: `min-height: 48px`, `touch-action: manipulation`, visible `:focus-visible` outline (2px `#e8b54a`), press feedback `transform: scale(.97)` with a 150 ms transition. No layout-shifting hover-only styling.

- [ ] **Step 5: Verify + commit** — screenshots at 915×412, 640×360 and 360×640 (portrait shows the rotate overlay — confirm that still works). Then:
```bash
git add www/index.html
git commit -m "fix(launcher): no game canvas bleeding through the mode modal, tabs fit one row, Play button inside the card, Castle tab enters its menu"
```

---

### Task 3: Castle menu layout — a grid that fits, in both orientations

**Files:**
- Modify: `www/transylvania-menu.html` (structure + icons), `www/transylvania-menu.css` (layout), `www/transylvania-menu.js` (only the `#hero-accent` line if that node is dropped)

- [ ] **Step 1: Structure.** Keep every contract id. Reorganise `#app` into a grid with a stage column:
```html
    <main id="app">
        <header id="header"> … back button (arrow_left.svg + «Меню») … balance pill (cheese.svg + #balance-value) … </header>
        <section id="stage">           <!-- NEW: cast diorama, filled by Task 4 -->
            <div id="stage-cast"></div>
            <div id="hero-plate"><img id="hero-sprite" …><div id="hero-shadow"></div></div>
            <div id="hero-pill" class="pill"><span id="hero-name">Мышонок Пи</span></div>
        </section>
        <section id="panel">           <!-- title + cards + footer -->
            <div id="title-block"> … </div>
            <div id="mode-cards"> … two .mode-card buttons … </div>
            <footer id="footer"> … ЛАВКА / КОДЕКС … </footer>
        </section>
    </main>
```
Card icons: story = `assets/characters/transylvania/grandma.svg` (the goal!), endless = `assets/ui-menu/infinity.svg`; chevrons = a rotated `arrow_left.svg` or a CSS caret; footer = `shop.svg` / `scroll.svg`; balance = `assets/characters/transylvania/cheese.svg`. All as `<img>` with `alt=""` + `aria-hidden="true"` (labels carry the meaning). No `&#…;` emoji entities anywhere: `grep -n "&#1[0-9]\{4\}" www/transylvania-menu.html` → no hits.

- [ ] **Step 2: Layout CSS.** `html, body { height: 100%; overflow: hidden; }` stays. `#app`:
```css
#app {
    position: relative; z-index: 2;
    height: 100%; max-width: 1100px; margin: 0 auto;
    display: grid; gap: var(--space-3);
    padding: calc(env(safe-area-inset-top, 0px) + var(--space-3)) calc(env(safe-area-inset-right, 0px) + var(--space-4))
             calc(env(safe-area-inset-bottom, 0px) + var(--space-3)) calc(env(safe-area-inset-left, 0px) + var(--space-4));
    grid-template-rows: auto 1fr;
    grid-template-columns: 1fr;
    grid-template-areas: "header" "panel";
}
@media (orientation: landscape) {
    #app { grid-template-columns: minmax(240px, 44%) 1fr; grid-template-areas: "header header" "stage panel"; }
}
@media (orientation: portrait) {
    #app { grid-template-rows: auto minmax(120px, 1fr) auto; grid-template-areas: "header" "stage" "panel"; }
}
#panel { display: flex; flex-direction: column; justify-content: center; gap: var(--space-3); min-height: 0; }
#mode-cards { display: flex; flex-direction: column; gap: var(--space-2); }
```
Sizes must be fluid so nothing overflows at 412 px height: title `font-size: clamp(20px, 4.4vh, 34px)`, subtitle `clamp(11px, 1.8vh, 14px)`, `.mode-card { min-height: max(56px, 12vh); }`, `.footer-btn { min-height: var(--tap); }`. **Delete the conflicting `@media (min-width: 900px)` block** (it re-inflates the title on a 915 px phone) and any `@media (max-height: 640px)` overrides it fights with; keep exactly the two orientation queries plus one `@media (max-width: 380px)` for tiny phones.

- [ ] **Step 3: Background layers.** `#sky` full-bleed gradient (`--bg-deep` → `--bg`); `#moon`/`#moon-glow` become **fixed to the stage side, never behind text**: in landscape put them at `left: 26%; top: 18%` behind `#stage`; in portrait at `right: 12%; top: 8%` but with `#header`/`#title-block` given `position: relative; z-index: 3`. `#fog` stays a slow-moving low-opacity layer (`transform` only, disabled under reduced-motion). Verify by screenshot that the moon never touches the title or the balance pill.

- [ ] **Step 4: Controls.** Every button: `min-height: var(--tap)`, `touch-action: manipulation`, `:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }`, `:active { transform: scale(.97); }` with `transition: transform var(--dur) var(--ease)`. `#card-story` is the single primary CTA — gold border + `--surface-2` fill + a subtle gold glow; `#card-endless` is secondary (border only, `--danger` accent stripe). Ensure ≥8 px gaps between all targets.

- [ ] **Step 5: Verify + commit.** Playwright screenshots at 915×412, 640×360, 360×640 (`E3-<w>x<h>.png`); check with `page.evaluate` that `document.documentElement.scrollHeight <= innerHeight` (no page scroll) and that the bounding boxes of `#title-block`, `#hero-pill`, `#balance-pill`, `#moon`, `#mode-cards`, `#footer` do not intersect (write the pairwise test). Look at the screenshots. Then:
```bash
git add www/transylvania-menu.html www/transylvania-menu.css www/transylvania-menu.js
git commit -m "feat(menu): Castle menu is a fits-on-screen grid (landscape two-column, portrait stacked), SVG icons, safe areas, 48px targets"
```

---

### Task 4: The cast — Pi and the monsters on the menu stage

**Files:**
- Modify: `www/transylvania-menu.html` (stage markup), `www/transylvania-menu.css` (stage styles + animations), `www/transylvania-menu.js` (`renderHero` extension)

- [ ] **Step 1: Markup.** Inside `#stage-cast` place the cast as `<img>` elements with per-character classes, ordered back-to-front: `bat` (top-left, flying), `ghost` (behind, drifting), `skeleton` (left), `zombie` (right-back), `cat` (right, sitting), `slime` (front-right, squashing), `mimic` (front-left, on the floor), `grandma` (small, behind bars — reuse `assets/world/cage.svg` in front of her at low opacity). Sources are `assets/characters/transylvania/<name>.svg`; each gets `alt=""` + `aria-hidden="true"`. Pi (`#hero-sprite`) stays the largest, centre-front, above the cast.

- [ ] **Step 2: CSS stage.** `#stage { position: relative; min-height: 0; }`; `#stage-cast img { position: absolute; height: <per-character>%; filter: drop-shadow(0 6px 10px rgba(0,0,0,.5)); }` with positions in %, so the composition scales with the column. Depth cue: back characters `opacity: .55; filter: brightness(.6)`, mid `.8`, front full. Pi: `height: 62%; max-height: 220px;` centred at the bottom of the stage with an elliptical shadow.
- [ ] **Step 3: Motion (150–300 ms rules do not apply to ambient loops; keep them slow and subtle).** Per-character `@keyframes` using **transform/opacity only**: bat flaps across a 6 s loop, ghost drifts up/down 4 s, slime squashes 2.4 s, cat tail-less bob 3 s, Pi breathes (`scale(1, 1.02)`) 2.8 s. Stagger with `animation-delay`. All disabled by the `prefers-reduced-motion` block from Task 1. No `filter` animation (expensive), no layout properties.
- [ ] **Step 4: Skin awareness.** `renderHero()` already swaps `#hero-sprite.src` to the equipped skin — keep that, and keep the `onerror` fallback to `pi.svg`. Add: when the equipped skin is not the default, give `#hero-plate` a gold ring so the player sees their purchase is worn.
- [ ] **Step 5: Verify + commit.** Screenshots at the three sizes; confirm the cast never overlaps `#hero-pill` or the panel column, and that at 360×640 the stage collapses to a shorter band with fewer visible characters (`display: none` for `mimic`/`skeleton` under `@media (orientation: portrait) and (max-height: 700px)` if needed). Then:
```bash
git add www/transylvania-menu.html www/transylvania-menu.css www/transylvania-menu.js
git commit -m "feat(menu): the Castle stage shows Pi with the monster cast (bat, ghost, skeleton, zombie, cat, slime, mimic, grandma)"
```

---

### Task 5: Shop modal

**Files:** `www/transylvania-menu.html`, `www/transylvania-menu.css`, `www/transylvania-menu.js` (`renderSkinGrid`, `renderUpgradeList`, `onSkinClick`, `onUpgradeClick`, `flashNoCheese`)

- [ ] **Step 1:** Column headers lose their emoji (`&#128045;`, `&#128170;`) → `<img src="assets/characters/transylvania/pi.svg">` (СКИНЫ) and `assets/ui/bolt.svg` (АПГРЕЙДЫ), 20 px, `aria-hidden`. Close button uses `assets/ui/close.svg`; balance pill uses `cheese.svg`.
- [ ] **Step 2:** `renderUpgradeList` currently prints an emoji per upgrade — map `PERMANENT_UPGRADES` ids to the icon kit: hp → `assets/ui/heart.svg`, speed → `assets/ui/bolt.svg`, dash → `assets/ui/dash.svg`, fire/damage → `assets/ui/flame.svg`, aim/triple → `assets/ui/target.svg`, shield → `assets/ui/shield.svg`, cheese/luck → `cheese.svg` (read the real ids first and report the mapping). Price rows show `cheese.svg` + the number in tabular figures (`font-variant-numeric: tabular-nums`).
- [ ] **Step 3:** Layout — `.modal-panel { width: min(96vw, 900px); height: min(94vh, 560px); }`, body `display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4);` in landscape, single column in portrait; each column `overflow-y: auto; overscroll-behavior: contain;` (scroll inside, never the page). Skin cards ≥96 px tall, grid `repeat(auto-fill, minmax(104px, 1fr))`. Buy buttons ≥48 px. Owned skin shows `check.svg` + «НАДЕТ» in `--ok`; locked shows the price; unaffordable is `opacity: .5` + `aria-disabled`.
- [ ] **Step 4:** Feedback — `flashNoCheese` shakes the balance pill (transform only) and shows the toast; toast has `role="status"` and auto-dismisses in 3 s; buying plays the press-scale and re-renders. Backdrop `background: var(--scrim)` (no `backdrop-filter` — Android WebView cost).
- [ ] **Step 5:** Verify (three sizes, both columns scroll, nothing clipped) + commit `feat(menu): shop restyled — SVG icons, scrollable columns, 48px buy targets, clear owned/locked states`.

---

### Task 6: Codex modal — silhouettes instead of «???»

**Files:** `www/transylvania-menu.html`, `www/transylvania-menu.css`, `www/transylvania-menu.js` (`ENEMY_LIST`, `renderBestiary`, `renderStats`, `renderAchievements`, `ACHIEVEMENTS`)

- [ ] **Step 1:** `ENEMY_LIST` entries currently carry an emoji — add a `sprite` field pointing at the real art (`assets/characters/transylvania/{zombie,cat,bat,slime,ghost,skeleton,mimic}.svg`; for enemies without their own art use the closest sprite and note it). Bestiary row = 44 px sprite + name + kill count. **Unmet enemies render the same sprite as a black silhouette** (`filter: brightness(0) opacity(.55)`) with the label «не встречен» — never «???».
- [ ] **Step 2:** Stats rows get icons from the kit (wins → `trophy.svg`, deepest floor → `assets/ui/stairs.svg`, silent runs → `assets/ui/paw.svg`, cheese → `cheese.svg`, skins → `assets/characters/transylvania/pi.svg`); numbers tabular. Achievements: unlocked → `check.svg` in `--ok`, locked → `assets/world/lock.svg` at `opacity: .5`; keep the achievement text.
- [ ] **Step 3:** Same panel/scroll/target rules as Task 5; two columns landscape, one portrait.
- [ ] **Step 4:** Verify + commit `feat(menu): codex shows enemy silhouettes and icon-led stats instead of «???» and emoji`.

---

### Task 7: Acceptance pass

- [ ] **Step 1:** Screenshot set at 915×412, 640×360, 360×640: launcher modal, Castle menu, shop, codex (12 shots). Look at each.
- [ ] **Step 2:** Automated checks via `page.evaluate` on the menu and both modals: (a) no element wider than the viewport (`document.documentElement.scrollWidth <= innerWidth`); (b) every `button`/`[role=button]` has `height ≥ 44` and `width ≥ 44`; (c) no two of the key boxes intersect; (d) `getComputedStyle` contrast spot-check for `--text-muted` on `--surface` (compute the ratio, must be ≥ 4.5); (e) no `&#1…;` emoji entity and no emoji character in the three menu files (`grep -P "[\x{1F300}-\x{1FAFF}\x{2190}-\x{27BF}]"`).
- [ ] **Step 3:** `/opt/homebrew/bin/node node_modules/@capacitor/cli/bin/capacitor sync`.
- [ ] **Step 4: Device checklist for the human** — launcher: no artefacts behind the card, all four tabs on one row, «Играть!» reachable, «Замок Теней» opens the castle menu instantly; castle menu: everything fits without scrolling in landscape, the cast is visible and animates, back returns to the launcher, shop/codex open and scroll, purchases work, cheese counter updates; portrait (if the player rotates before the lock kicks in) still readable.

---

## Out of scope
Phase C (characters presentation), Phase D (in-game UI kit and overlays/pickers/shop-in-run/floating text), Phase F (sound), Phase G (juice). The in-game HUD is already done (Phase 2b).
