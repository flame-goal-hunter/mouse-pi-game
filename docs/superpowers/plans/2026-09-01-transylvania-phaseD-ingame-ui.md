# Transylvania Phase D — In-game UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every screen the player sees after choosing a mode looks like the rebuilt menus, not like 2010 shareware: the story intro, the upgrade picker, the relic picker, the in-run shop, the win/lose overlays and the floating text. No emoji as icons, no glossy purple gradients, text never overflows its frame, targets ≥48 px — plus a pause/settings overlay with volume and mute, which the game does not have at all (user: «меню когда я выбрал режим игры — по-прежнему убожество»).

**Architecture:** All six screens are already drawn through three helpers in `DungeonScene.js` — `drawGothicPanel(cx, cy, w, h, opts)`, `drawGothicCard(...)`, `drawGothicButton(cx, cy, w, h, label, opts)`. Restyling those three restyles everything at once; each screen then only needs its content fixed (icons instead of emoji, sane layout, correct sizes). The visual language is the one already shipped in the menus: `--bg #1a0c2e`, surface `#241338`, surface-2 `#2e1a46`, gold `#e8b54a` / bright `#f6d77a`, text `#f4ecff`, muted `#b9a6d4`, danger `#ff4a5c`, ok `#5cd67a`; display font Comfortaa 700, body Nunito 400/700/900; radius 14-20; press feedback `scale .97` over 180 ms; scrim `rgba(8,3,16,.72)`.

**Tech stack:** Phaser **3.70** (CDN), device-pixel canvas from Phase A (`this.dpr`, camera zoom = dpr, fixed `uiLayer` in CSS px, `_pinFixed()` after creating overlay objects, `add.text` wrapper injects `resolution`), SVG icon kit in `www/assets/ui/`, `www/assets/ui-menu/`, `www/assets/world/`, character art in `www/assets/characters/transylvania/`.

**Ground rules:** stage only the files each task names (never `git add -A`; never touch `guardrail/`); every overlay object must be created through the existing helpers so it lands in `uiLayer` (call `this._pinFixed()` at the end of each screen builder, as the current code does); Scene instance is reused — reset any new field in `create()`; `node --check` + `node --test tools/tests/hudLayout.test.mjs` stay green; verify every screen with a screenshot at **915×412 and 640×360** (the pipeline is in memory `screenshot-pipeline`; overlays can be forced from `page.evaluate` via `window.__game.scene.getScene('DungeonScene')`); `cap sync` at the end.

**Verified facts (2026-09-01, HEAD `59d345d`):**
- Helpers: `drawGothicPanel` ~6811, `drawGothicCard` ~6879, `drawGothicButton` ~6953 (default depth `LAYER.UI_OVERLAY + 10`). They draw with `Graphics` (`fillRoundedRect`, corner fleurons, theme emoji at 24 px alpha .55) and a **glossy vertical gradient** on buttons/cards — that gloss is the "plastic" look the user objects to.
- Screens: `showStoryIntro` ~5570-5700 (title, subtitle, floor line, body, hint, `drawGothicButton('НАЧАТЬ')`; **the gothic frame is drawn 2.6× the title height and the body text overflows it** — see `D1-intro.png`), `showUpgradePicker` ~6437 (3 cards with a 48 px emoji each, header `✨ Этаж N пройден!`, stats line `❤️ 5/5 🧀 0 в банке`, `🏪 ЛАВКА` button), `showRelicPicker` ~6366 (3 cards, rarity tag, 48 px emoji), `openInRunShop` ~6566 (skins grid + upgrade rows, emoji), `showOverlay` ~6979 (win/lose: stacked emoji + title + sub + 1-2 buttons).
- Data needing icons: `UPGRADES` (8 entries, `emoji` field) at `DungeonScene.js:158`; `PERMANENT_UPGRADES` (5) in `www/js/storage/ProgressStore.js:26`; `RELICS` (16, `emoji` field) in `www/js/scenes/Relics.js`.
- Existing icons that already fit: `ui/heart`, `ui/bolt`, `ui/dash`, `ui/flame`, `ui/target`, `ui/shield`, `ui/stairs`, `ui/paw`, `ui/eye`, `ui/book`, `ui/close`, `ui-menu/{check,infinity,trophy,scroll,shop,skull,arrow_left}`, `world/{skull,relic_urn,chest_closed,lock,…}`, `characters/transylvania/{cheese,pie,ghost,grandma,pi}`.
- `Progress.getAudioPrefs()` / `setAudioPref` / `toggleMute` exist in `ProgressStore.js` but **nothing in the game calls them** — there is no settings UI.
- Fixed in `59d345d`: the in-run shop used to crash (`PERMANENT_UPGRADES` was never imported).

---

### Task 1: Icons for relics and upgrades

**Files:** create `www/assets/relics/*.svg` (10 new); modify `www/js/scenes/Relics.js`, `www/js/scenes/DungeonScene.js` (UPGRADES), `www/js/storage/ProgressStore.js` (PERMANENT_UPGRADES)

- [ ] **Step 1:** Author 10 new icons in the established style (viewBox 0 0 64 64, outline `#1a1a1a` 3-4 px, flat fill + one highlight, readable at 40 px): `magnet` (horseshoe magnet, red/steel), `star_spread` (four-point star with three diverging trails), `bounce` (ball with a curved bounce arc), `crit` (jagged burst/explosion), `thorns` (three spikes on a curved twig), `tornado` (funnel spiral), `crown` (gold crown, three points), `hourglass` (wooden frame, amber sand), `blood_drop` (red drop with a highlight), `gift` (box with a gold ribbon). Validate with `xml.dom.minidom`.
- [ ] **Step 2:** Add an `icon` field next to each `emoji` (keep `emoji` for now so nothing breaks) mapping every entry to a texture key:
  - RELICS: pierce→`ui_target`, magnet→`relic_magnet`, spread→`relic_star_spread`, sturdy→`ui_shield`, flame_trail→`ui_flame`, bounce→`relic_bounce`, crit→`relic_crit`, thorns→`relic_thorns`, combo_heart→`ui_heart`, dash_burst→`ui_dash`, ghost_walk→`d_ghost`, pie_storm→`relic_tornado`, undying→`prop_skull`, gold_pie→`relic_crown`, time_warp→`relic_hourglass`, cheese_explosion→`d_cheese`.
  - UPGRADES: hp→`ui_heart`, dash→`ui_dash`, speed→`ui_bolt`, damage→`ui_flame`, firerate→`ui_target`, piesize→`d_pie`, lifesteal→`relic_blood_drop`, cheese→`d_cheese`.
  - PERMANENT_UPGRADES: hp1→`ui_heart`, speed1→`ui_bolt`, dash1→`ui_dash`, dmg1→`ui_flame`, powerup→`relic_gift`.
- [ ] **Step 3:** Load the new icons in `DungeonScene.preload()` (same pattern as `WORLD_SVGS`, at `css × dpr`, keys `relic_*`), and make sure the HTML menu's shop can also reach them (it uses `<img>` paths, so it just needs the file path — check `transylvania-menu.js`'s upgrade rows and switch them to the new files where the mapping differs).
- [ ] **Step 4:** Verify: every `icon` value resolves to a loaded texture (`page.evaluate` over RELICS/UPGRADES asserting `textures.exists`), SVGs valid, no console errors. Commit `assets: SVG icons for relics and upgrades`.

---

### Task 2: Restyle the three gothic helpers

**Files:** `www/js/scenes/DungeonScene.js` (`drawGothicPanel`, `drawGothicCard`, `drawGothicButton`)

- [ ] **Step 1: Panel** — flat `--bg` fill at 0.97 with a 2 px `--gold` border at 0.55, radius 20, one soft outer shadow (a second rounded rect at 0.35 black, offset 4 px); keep the four corner accents but redraw them as small gold arcs (no fleuron emoji); **delete the four decorative theme emoji** (the `opts.theme` array) and the `theme` parameter's emoji use — if a screen wants an accent, it passes an icon key now.
- [ ] **Step 2: Card** — `--surface` fill, 1.5 px border `rgba(244,236,255,.14)`, radius 16, **no gradient**; selected/hover state = `--surface-2` + 2 px `--gold` border; press feedback `scale .97` 180 ms (keep the existing hit rect).
- [ ] **Step 3: Button** — two variants via `opts.variant`: `primary` = `--gold` fill, `#2a1206` label, no gloss; `secondary` = transparent fill, 2 px `--gold` border, `--text` label. Min height 48 (respect `h` if larger), radius 14, label Comfortaa 700 for primary / Nunito 700 for secondary, press `scale .97`, and a `disabled` state at 0.45 alpha that ignores taps. Remove the vertical gloss rect entirely.
- [ ] **Step 4:** Every existing caller keeps working (same signatures; `theme` becomes optional and ignored). Screenshot the intro, both pickers and the win overlay before/after to confirm nothing collapsed. Commit `feat(ui): flat gold-on-violet panels, cards and buttons replace the glossy gothic style`.

---

### Task 3: Story intro — the screen right after choosing the mode

**Files:** `www/js/scenes/DungeonScene.js` (`showStoryIntro`)

- [ ] **Step 1:** Rebuild the layout so the panel actually contains its content: measure the text blocks first (`Phaser.GameObjects.Text` `.height` after creation, or compute from font sizes), then size the panel to `contentHeight + 2 × padding` and centre it; the title, floor line, body, hint and button all live inside with ≥16 px padding. Target: at 915×412 the panel is ≤ 78 % of the height and nothing crosses its border.
- [ ] **Step 2:** Restyle: title in Comfortaa 700 gold (`--gold-bright` with a 2 px `#1a0a2e` stroke, no neon glow), subtitle `--text-muted`, floor line as a small gold pill (`Этаж 1/5`), body `--text` at 15-17 px with `wordWrap` inside the panel, hint row in `--text-muted` 12-13 px, primary button «НАЧАТЬ» (variant `primary`).
- [ ] **Step 3:** Add Pi to the panel: `this.add.image(..., 'd_pi')` at ~90 px on the left of the text block (the hero the player just chose — read the equipped skin key the scene already uses), with the cage/grandma silhouette hinted behind if it fits. Keep it optional at 640×360 (hide when the panel is short).
- [ ] **Step 4:** Verify at 915×412 and 640×360: screenshot, assert with `page.evaluate` that every intro element's rect is inside the panel rect, and that ENTER/tap still dismisses and starts the floor (the `startGame` closure, `FLOOR_ENTER` sound, HUD/sticks reveal). Commit `feat(ui): story intro fits its panel, flat gold styling, hero portrait`.

---

### Task 4: Upgrade picker, relic picker, win/lose

**Files:** `www/js/scenes/DungeonScene.js` (`showUpgradePicker`, `showRelicPicker`, `showOverlay`)

- [ ] **Step 1: Upgrade picker** — header «Этаж N пройден» (no `✨`), stats row as two pills with `ui_heart` + `d_cheese` icons and tabular numbers, three cards each with the upgrade's **icon** at 44 px (from Task 1), name (Nunito 700 16 px), description (`--text-muted` 13 px, wrapped), and a level pill `(2/4)` where a cap exists; card min height 150; the «ЛАВКА» button becomes a `secondary` button with the `shop` icon; add a `primary` «ДАЛЬШЕ» affordance only if the current flow needs one (read the code — today picking a card advances).
- [ ] **Step 2: Relic picker** — same treatment; rarity tag as a coloured pill (`RARITY_COLORS`), icon 44 px, no emoji; keep the aim-indicator hide/restore added in Phase A.
- [ ] **Step 3: Win/lose** — replace the stacked emoji with an image (`d_grandma` + Pi for the win, `prop_skull` or `d_ghost` for the loss), title in Comfortaa, sub in `--text-muted`, buttons: primary «ЕЩЁ РАЗ» / secondary «В ЛАВКУ» (keep whatever the current actions are), a stats strip (floor reached, cheese earned, kills) built from the scene's existing counters if they are already displayed; ensure the panel fits at 640×360.
- [ ] **Step 4:** All three: no emoji left (`grep` the three method ranges), every button ≥48 px, `_pinFixed()` called, screenshots at both sizes, and the existing actions still work (pick upgrade → next floor; pick relic → resume; win/lose buttons → hub, with the music handoff from Phase F). Commit `feat(ui): upgrade/relic pickers and win-lose overlays restyled with real icons`.

---

### Task 5: In-run shop + pause/settings

**Files:** `www/js/scenes/DungeonScene.js` (`openInRunShop`, `closeInRunShop`, plus a new pause overlay), `www/js/storage/ProgressStore.js` only if a pref getter is missing

- [ ] **Step 1: Shop** — restyle to match the HTML menu's shop: two columns (skins / upgrades) in landscape, one column when short; skin cards ≥96 px with the SVG preview, price pill with `d_cheese`, owned = `ui-menu/check` + «НАДЕТ» in `--ok`, unaffordable dimmed; upgrade rows with the Task-1 icons, level `(N/M)`, price pill; internal scrolling if the content overflows (the current code clips — read `openInRunShop`'s `cy + cardH/2 > …` guard and replace it with a scrollable container or paging); close button uses `ui_close`. Verify the crash fix from `59d345d` holds (open the shop from the upgrade picker in the headless run).
- [ ] **Step 2: Pause / settings** — the game has no pause and no way to change volume. Add a pause overlay opened by the HUD's existing exit-adjacent affordance (add a small pause button next to it, ≥48 px, icon from the kit — add a `pause.svg` if none exists): darken the scene (`scrim`), show «ПАУЗА», three slider-ish rows (master / effects / music) built from `drawGothicButton`-style −/+ steppers or a simple 5-segment bar (no HTML), a mute toggle, and buttons «ПРОДОЛЖИТЬ» (primary) / «В МЕНЮ» (secondary). Wire to `Progress.setAudioPref` / `toggleMute` and apply immediately through `window.audio.applyPrefs(...)`. While paused: `this.physics?.pause?.()` is not used here — instead set the scene's own `state = 'paused'` so `update()` early-returns (check how `state` gates `update`), pause the tween manager and the music (`window.audio.pauseAll?.()` or fade), and resume cleanly.
- [ ] **Step 3:** Verify: open/close the shop and buy something; open pause mid-floor, change a volume, confirm the sound level changes and the pref persists across a scene restart; confirm the game does not run while paused (player position unchanged after 2 s) and resumes correctly; screenshots at both sizes. Commit `feat(ui): in-run shop restyled and a pause screen with volume and mute`.

---

### Task 6: Floating text, sweep, acceptance

**Files:** `www/js/scenes/DungeonScene.js`, `www/js/scenes/Relics.js`, `www/js/storage/ProgressStore.js`

- [ ] **Step 1:** Floating combat text (`showFloatingText` and its ~16 call sites) still carries emoji (`🧀 Тайник!`, `📕 +1 урон`, `💨 Облако муки!`, `🏆`, `+❤️`…). Strip the emoji from the strings; where the icon carried meaning, either draw a small icon next to the text (a pooled image beside the pooled text) or reword. Keep the pools intact.
- [ ] **Step 2:** Remove the now-dead `emoji` fields from `RELICS`, `UPGRADES` and `PERMANENT_UPGRADES` once every consumer uses `icon` (grep first: the HTML menu reads these tables too).
- [ ] **Step 3: Sweep** — `grep -nP "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]" www/js/scenes/DungeonScene.js www/js/scenes/Relics.js www/js/storage/ProgressStore.js www/js/scenes/TransylvaniaScene.js` → no hits (this is spec §4 item 2 for the whole game).
- [ ] **Step 4:** `node --test tools/tests/hudLayout.test.mjs`; `node --check`; `cap sync`; full screenshot set (intro, upgrade, relic, shop, pause, win, lose) at 915×412 and 640×360; a 30 s play run with zero console errors.
- [ ] **Step 5: Device checklist** — every screen readable at arm's length, buttons hit first time, pause works mid-fight, volume changes are audible, shop purchases apply, nothing overflows its panel.

---

## Out of scope
Phase C (character animation) and the control rework are separate plans, executed after this one. Story content (§6 of the original spec), procedural floors (§9) and the economy (§10) remain for later phases.
