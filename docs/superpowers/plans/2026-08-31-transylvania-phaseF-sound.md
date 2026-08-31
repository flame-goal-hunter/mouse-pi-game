# Transylvania Phase F — Sound Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the oscillator-synthesised audio (the user's «звуковое сопровождение не профессиональное») with a curated set of **real CC0 samples**: ~40 sound effects and 4 ambient music loops, loudness-matched, with pitch variation and anti-spam limiting, plus footsteps and UI sounds in the HTML menus (spec `docs/superpowers/specs/2026-08-30-transylvania-art-overhaul.md` §3.F, §4 item 5).

**Architecture:** The event layer already exists and does not change: gameplay code emits `SFX.*` / `UI.*` / `BGM.*` names from `www/js/audio/SoundKeys.js` on the `EventBus`, and `AudioManager` subscribes. Today every handler calls a `ProceduralSfx` method. This phase introduces `www/js/audio/SoundMap.js` — a declarative table mapping each event to sample keys, a normalised volume, a base rate and jitter, and a retrigger guard — and rewires `AudioManager` to play Phaser sounds from that table, keeping `ProceduralSfx` only as the fallback when a sample is missing (so nothing goes silent if a file fails to load). Music plays through Phaser's sound manager with looping and cross-fade on floor changes. The HTML menus (outside Phaser) get a tiny `menuAudio.js` using plain `Audio` elements for click/back/buy/deny.

**Assets (already downloaded to `/tmp`, CC0, verified by browser decode):**
- **Kenney** packs (CC0, kenney.nl): `interface-sounds`, `impact-sounds`, `rpg-audio`, `music-jingles` — unzipped at `/tmp/kenney/<pack>/Audio/…`.
- **OpenGameArt** CC0 ambient loops at `/tmp/oga/`: `dark_cavern_ambient_001.ogg` (120 s, 1.7 MB), `dark_cavern_ambient_002.ogg` (120 s, 1.7 MB), `forest_2_0.ogg` (137 s, 2.9 MB), `dark_place.ogg` (55 s, 1.8 MB).
- If `/tmp` was cleared, re-download: Kenney pack pages expose the zip as `href='https://kenney.nl/media/pages/assets/<pack>/<hash>/kenney_<pack>.zip'` (scrape the page with a desktop UA); the OGA files are `https://opengameart.org/sites/default/files/<name>.ogg`.

**Measured levels** (browser `decodeAudioData`, peak/RMS) drive the per-sound `vol` so nothing jumps out: target RMS ≈ 0.13, `vol = clamp(0.13 / rms, 0.15, 3.0)` and never let `peak × vol` exceed 0.95. The table below already carries the computed values.

**Ground rules:** stage only the files each task names (never `git add -A`; never touch `guardrail/`); keep every event name in `SoundKeys.js` working; no regression for the other game modes (snowball/adventure use their own audio paths); `cap sync` at the end; verify by scripted playback in headless Chromium (decode + play every mapped sample, assert no missing files and no decode errors) — a human still confirms the feel on device.

---

### Task 1: Import and name the sample set

**Files:** create `www/assets/audio/sfx/*.ogg` (~40), `www/assets/audio/bgm/*.ogg` (4), `www/assets/audio/CREDITS.md`

- [ ] **Step 1:** Create the directories and copy the files below, renaming to the semantic name on the left. Sources: `K=/tmp/kenney`, `O=/tmp/oga`. (If a source path is missing, re-download per the header and report.)

**SFX — UI**
| target `www/assets/audio/sfx/…` | source |
|---|---|
| `ui_click.ogg` | `K/interface-sounds/Audio/click_002.ogg` |
| `ui_back.ogg` | `K/interface-sounds/Audio/back_002.ogg` |
| `ui_buy.ogg` | `K/interface-sounds/Audio/confirmation_002.ogg` |
| `ui_deny.ogg` | `K/interface-sounds/Audio/error_004.ogg` |
| `ui_open.ogg` | `K/interface-sounds/Audio/open_002.ogg` |
| `ui_close.ogg` | `K/interface-sounds/Audio/close_002.ogg` |
| `ui_tick.ogg` | `K/interface-sounds/Audio/tick_002.ogg` |

**SFX — combat / movement**
| target | source |
|---|---|
| `throw_a.ogg` / `throw_b.ogg` | `K/rpg-audio/Audio/cloth2.ogg` / `cloth3.ogg` |
| `dash.ogg` | `K/rpg-audio/Audio/cloth1.ogg` |
| `hit_enemy_a/b/c.ogg` | `K/impact-sounds/Audio/impactSoft_medium_00{1,2,3}.ogg` |
| `hit_wall_a/b.ogg` | `K/impact-sounds/Audio/impactSoft_heavy_00{0,2}.ogg` |
| `take_damage.ogg` | `K/impact-sounds/Audio/impactPunch_heavy_001.ogg` |
| `enemy_death_a/b.ogg` | `K/impact-sounds/Audio/impactGeneric_light_00{0,2}.ogg` |
| `boss_hit.ogg` | `K/impact-sounds/Audio/impactMetal_heavy_001.ogg` |
| `squelch.ogg` | `K/impact-sounds/Audio/impactSoft_medium_000.ogg` |

**SFX — pickups / world**
| target | source |
|---|---|
| `cheese.ogg` | `K/interface-sounds/Audio/pluck_001.ogg` |
| `heart.ogg` | `K/interface-sounds/Audio/confirmation_003.ogg` |
| `powerup.ogg` | `K/interface-sounds/Audio/maximize_006.ogg` |
| `key.ogg` | `K/rpg-audio/Audio/metalLatch.ogg` |
| `chest.ogg` | `K/rpg-audio/Audio/creak2.ogg` |
| `coins.ogg` | `K/rpg-audio/Audio/handleCoins.ogg` |
| `torch.ogg` | `K/rpg-audio/Audio/cloth4.ogg` |
| `door.ogg` | `K/rpg-audio/Audio/doorOpen_1.ogg` |

**SFX — stealth**
| target | source |
|---|---|
| `alarm.ogg` | `K/interface-sounds/Audio/error_006.ogg` |
| `suspicion.ogg` | `K/interface-sounds/Audio/tick_002.ogg` (same file, different mapping — copy once as `ui_tick.ogg` and reuse the key) |
| `book_thud.ogg` | `K/impact-sounds/Audio/impactWood_medium_002.ogg` |
| `ghost.ogg` | `K/rpg-audio/Audio/cloth2.ogg` (reuse `throw_a` key at a low rate — do not duplicate the file) |

**SFX — footsteps** (3 variants each)
| target | source |
|---|---|
| `step_stone_1/2/3.ogg` | `K/impact-sounds/Audio/footstep_concrete_00{0,1,2}.ogg` |
| `step_wood_1/2/3.ogg` | `K/impact-sounds/Audio/footstep_wood_00{0,1,2}.ogg` |
| `step_carpet_1/2/3.ogg` | `K/impact-sounds/Audio/footstep_carpet_00{0,1,2}.ogg` |
| `step_grass_1/2/3.ogg` | `K/impact-sounds/Audio/footstep_grass_00{0,1,2}.ogg` |

**Stings** (chosen by measured envelope: rising = victory, falling = defeat)
| target | source | why |
|---|---|---|
| `sting_win.ogg` | `K/music-jingles/Audio/NES jingles/jingles_NES00.ogg` | 1.76 s, energy sustained to the end (rising) |
| `sting_lose.ogg` | `K/music-jingles/Audio/Steel jingles/jingles_STEEL02.ogg` | 1.41 s, strong decay (falling) |
| `sting_death.ogg` | `K/music-jingles/Audio/Steel jingles/jingles_STEEL07.ogg` | 1.58 s, falling |
| `sting_floor.ogg` | `K/music-jingles/Audio/Pizzicato jingles/jingles_PIZZI01.ogg` | 1.0 s pizzicato, light |
| `sting_boss.ogg` | `K/impact-sounds/Audio/impactBell_heavy_001.ogg` | 1.76 s bell toll |
| `sting_boss_phase.ogg` | `K/music-jingles/Audio/Steel jingles/jingles_STEEL13.ogg` | 1.07 s |

**BGM** → `www/assets/audio/bgm/`
| target | source | used by |
|---|---|---|
| `cavern.ogg` | `O/dark_cavern_ambient_001.ogg` | dungeon, library |
| `hall.ogg` | `O/dark_cavern_ambient_002.ogg` | kitchen, menu |
| `garden.ogg` | `O/forest_2_0.ogg` | garden |
| `throne.ogg` | `O/dark_place.ogg` | throne |

- [ ] **Step 2: `www/assets/audio/CREDITS.md`** — list both sources with their licences: Kenney (kenney.nl, CC0 1.0, packs: Interface Sounds, Impact Sounds, RPG Audio, Music Jingles) and OpenGameArt CC0 loops (`ancient-caverns`/`dark-cavern-ambient`/`cathedral-in-the-forest`/`dark-place` pages with their URLs). CC0 needs no attribution, but the file documents provenance.
- [ ] **Step 3: Verify** — every target file exists and is non-empty; total size of `www/assets/audio` reported (expect ≈ 8-9 MB, dominated by BGM); `python3 -c "print(...)"` or `du -sh`. No file over 3 MB.
- [ ] **Step 4: Commit** — `git add www/assets/audio && git commit -m "assets: CC0 sound set — 40 sample effects (Kenney) and 4 ambient loops (OpenGameArt)"`

---

### Task 2: `SoundMap.js` — the declarative sound table

**Files:** create `www/js/audio/SoundMap.js`; modify `www/js/audio/SoundKeys.js` (add the footstep event)

- [ ] **Step 1:** In `SoundKeys.js` add to `SFX`: `FOOTSTEP: 'audio:footstep',` and `DOOR_OPEN: 'audio:doorOpen',` (keep every existing name).
- [ ] **Step 2:** Create `www/js/audio/SoundMap.js`:

```js
// ============================================
// SoundMap — event → sample table.
// `vol` values are loudness-matched (target RMS ≈ 0.13, peak-limited to 0.95).
// `rate`/`jitter` give per-play pitch variation; `guard` is the minimum ms between
// two plays of the same event (anti machine-gun).
// ============================================
import { SFX, UI, BGM } from './SoundKeys.js';

export const SFX_FILES = {
    // key: [file, volume]
    ui_click:   ['ui_click', 0.85],   ui_back:  ['ui_back', 0.9],   ui_buy:  ['ui_buy', 0.75],
    ui_deny:    ['ui_deny', 0.85],    ui_open:  ['ui_open', 0.9],   ui_close:['ui_close', 0.9],
    ui_tick:    ['ui_tick', 1.0],
    throw_a:    ['throw_a', 3.0],     throw_b:  ['throw_b', 3.0],   dash:    ['dash', 2.0],
    hit_enemy_a:['hit_enemy_a', 0.95],hit_enemy_b:['hit_enemy_b', 0.95], hit_enemy_c:['hit_enemy_c', 0.7],
    hit_wall_a: ['hit_wall_a', 0.95], hit_wall_b:['hit_wall_b', 0.95],
    take_damage:['take_damage', 1.0], enemy_death_a:['enemy_death_a', 1.4], enemy_death_b:['enemy_death_b', 1.4],
    boss_hit:   ['boss_hit', 2.0],    squelch:  ['squelch', 0.7],
    cheese:     ['cheese', 1.4],      heart:    ['heart', 0.75],    powerup: ['powerup', 0.65],
    key:        ['key', 1.3],         chest:    ['chest', 2.5],     coins:   ['coins', 3.0],
    torch:      ['torch', 3.0],       door:     ['door', 1.1],
    alarm:      ['alarm', 1.05],      book_thud:['book_thud', 1.7],
    step_stone_1:['step_stone_1', 1.4], step_stone_2:['step_stone_2', 1.4], step_stone_3:['step_stone_3', 1.4],
    step_wood_1: ['step_wood_1', 1.4],  step_wood_2: ['step_wood_2', 1.4],  step_wood_3: ['step_wood_3', 1.4],
    step_carpet_1:['step_carpet_1', 1.9],step_carpet_2:['step_carpet_2', 1.9],step_carpet_3:['step_carpet_3', 1.9],
    step_grass_1:['step_grass_1', 3.0], step_grass_2:['step_grass_2', 3.0], step_grass_3:['step_grass_3', 3.0],
    sting_win:  ['sting_win', 0.7],   sting_lose:['sting_lose', 0.8], sting_death:['sting_death', 0.9],
    sting_floor:['sting_floor', 0.7], sting_boss:['sting_boss', 2.2], sting_boss_phase:['sting_boss_phase', 0.75],
};

export const BGM_FILES = {
    cavern: ['cavern', 0.34], hall: ['hall', 0.34], garden: ['garden', 0.38], throne: ['throne', 0.5],
};

// event → { keys, rate, jitter, guard, cat }
export const EVENT_MAP = {
    [UI.BUTTON_CLICK]:   { keys: ['ui_click'],  jitter: 0.06, guard: 40,  cat: 'ui' },
    [UI.BUTTON_BACK]:    { keys: ['ui_back'],   jitter: 0.04, guard: 60,  cat: 'ui' },
    [UI.SHOP_BUY]:       { keys: ['ui_buy'],    guard: 120, cat: 'ui' },
    [UI.SHOP_DENY]:      { keys: ['ui_deny'],   guard: 200, cat: 'ui' },
    [UI.MENU_OPEN]:      { keys: ['ui_open'],   guard: 120, cat: 'ui' },
    [UI.HEARTBEAT_TICK]: { keys: ['hit_wall_a'], rate: 0.55, jitter: 0.03, guard: 300, cat: 'ui' },

    [SFX.FIRE_PIE]:      { keys: ['throw_a', 'throw_b'], rate: 1.25, jitter: 0.12, guard: 45 },
    [SFX.HIT_ENEMY]:     { keys: ['hit_enemy_a', 'hit_enemy_b', 'hit_enemy_c'], jitter: 0.14, guard: 40 },
    [SFX.HIT_WALL]:      { keys: ['hit_wall_a', 'hit_wall_b'], rate: 1.1, jitter: 0.12, guard: 50 },
    [SFX.TAKE_DAMAGE]:   { keys: ['take_damage'], rate: 1.05, jitter: 0.06, guard: 250 },
    [SFX.PLAYER_DASH]:   { keys: ['dash'], rate: 1.35, jitter: 0.08, guard: 120 },
    [SFX.PLAYER_DEATH]:  { keys: ['sting_death'], guard: 800 },
    [SFX.ENEMY_DEATH]:   { keys: ['enemy_death_a', 'enemy_death_b'], rate: 0.95, jitter: 0.16, guard: 40 },
    [SFX.BOSS_HIT]:      { keys: ['boss_hit'], jitter: 0.1, guard: 80 },
    [SFX.SLIME_SQUELCH]: { keys: ['squelch'], rate: 0.8, jitter: 0.12, guard: 90 },

    [SFX.COLLECT_CHEESE]:  { keys: ['cheese'], rate: 1.0, jitter: 0.05, guard: 30 },   // AudioManager adds a combo pitch ladder
    [SFX.COLLECT_HEART]:   { keys: ['heart'], guard: 150 },
    [SFX.COLLECT_POWERUP]: { keys: ['powerup'], guard: 150 },
    [SFX.KEY_GRAB]:        { keys: ['key'], rate: 1.1, guard: 200 },
    [SFX.OPEN_CHEST]:      { keys: ['chest'], rate: 1.05, jitter: 0.05, guard: 200 },
    [SFX.LIGHT_TORCH]:     { keys: ['torch'], rate: 0.7, jitter: 0.1, guard: 120 },
    [SFX.DOOR_OPEN]:       { keys: ['door'], rate: 0.95, guard: 300 },

    [SFX.ALARM_TRIGGER]:    { keys: ['alarm'], guard: 700 },
    [SFX.SUSPICION_TICK]:   { keys: ['ui_tick'], rate: 0.9, jitter: 0.05, guard: 180 },
    [SFX.DISTRACTION_THUD]: { keys: ['book_thud'], rate: 0.95, jitter: 0.08, guard: 150 },
    [SFX.GHOST_RUN]:        { keys: ['throw_a'], rate: 0.6, jitter: 0.06, guard: 400 },

    [SFX.BOSS_INTRO]:  { keys: ['sting_boss'], guard: 1500 },
    [SFX.BOSS_PHASE]:  { keys: ['sting_boss_phase'], guard: 800 },
    [SFX.WIN_STORY]:   { keys: ['sting_win'], guard: 2000 },
    [SFX.LOSE_STORY]:  { keys: ['sting_lose'], guard: 2000 },
    [SFX.FLOOR_ENTER]: { keys: ['sting_floor'], guard: 1000 },
    [SFX.FOOTSTEP]:    { keys: [], jitter: 0.14, guard: 0 },   // keys chosen per biome by AudioManager
};

// biome id → footstep sample family
export const FOOTSTEPS = {
    dungeon: ['step_stone_1', 'step_stone_2', 'step_stone_3'],
    kitchen: ['step_wood_1', 'step_wood_2', 'step_wood_3'],
    library: ['step_carpet_1', 'step_carpet_2', 'step_carpet_3'],
    garden:  ['step_grass_1', 'step_grass_2', 'step_grass_3'],
    throne:  ['step_carpet_1', 'step_carpet_2', 'step_carpet_3'],
};

// biome id → music key
export const BIOME_BGM = { dungeon: 'cavern', kitchen: 'hall', library: 'cavern', garden: 'garden', throne: 'throne' };
```
- [ ] **Step 2b:** `node --check` both files; `grep -c "SFX\.\|UI\." www/js/audio/SoundMap.js`.
- [ ] **Step 3: Commit** — `git add www/js/audio/SoundMap.js www/js/audio/SoundKeys.js && git commit -m "feat(audio): declarative sound map (samples, loudness, pitch jitter, retrigger guards)"`

---

### Task 3: `AudioManager` plays samples

**Files:** modify `www/js/audio/AudioManager.js`, `www/js/scenes/DungeonScene.js` (preload + footstep emission), `www/js/scenes/BootScene.js` if a shared preload is cleaner (report which you chose)

- [ ] **Step 1: Loading.** Add a `preloadAudio(scene)` helper exported from `AudioManager.js` (or a new `AudioLoader.js`) that queues every file in `SFX_FILES` (`scene.load.audio(key, 'assets/audio/sfx/<file>.ogg')`) and every `BGM_FILES` entry (`assets/audio/bgm/<file>.ogg`). Call it from `DungeonScene.preload()` (the Transylvania mode is the only consumer for now). Phaser's loader skips keys that already exist, so scene restarts are free.
- [ ] **Step 2: Playback.** In `AudioManager`, replace each `this.proc.<x>()` handler with `this._play(event)` driven by `EVENT_MAP`:
```js
    _play(event, opts = {}) {
        const cfg = EVENT_MAP[event];
        if (!cfg) return;
        const now = performance.now();
        if (cfg.guard && this._last[event] && now - this._last[event] < cfg.guard) return;
        this._last[event] = now;
        const keys = opts.keys || cfg.keys;
        if (!keys || !keys.length) return;
        const key = keys[(Math.random() * keys.length) | 0];
        const entry = SFX_FILES[key];
        if (!entry || !this.game.cache.audio.exists(key)) { this._fallback(event); return; }
        const rate = (opts.rate ?? cfg.rate ?? 1) * (1 + (Math.random() * 2 - 1) * (cfg.jitter || 0));
        const vol = entry[1] * (opts.vol ?? 1) * this._catVolume(cfg.cat || 'sfx');
        this.game.sound.play(key, { volume: Math.min(1, vol), rate });
    }
```
with `_catVolume` reading the existing preference system (`Progress.getAudioPrefs()`: master/sfx/music/muted — read the real shape) and `_fallback(event)` calling the old `ProceduralSfx` method for that event (keep a small event→method table) so a missing file never means silence.
- [ ] **Step 3: Cheese ladder.** `SFX.COLLECT_CHEESE` accepts a combo counter: when the gameplay emits it with a payload (`bus.emit(SFX.COLLECT_CHEESE, { combo })`), play at `rate = 1 + Math.min(combo, 8) * 0.06` so consecutive pickups rise in pitch. Read the emit site in `DungeonScene` and pass the value it already tracks (if none exists, use an internal counter in `AudioManager` that decays after 1.2 s).
- [ ] **Step 4: Music.** Replace `ProceduralBgm` usage: `playBgm(key)` starts `this.game.sound.add(key, { loop: true, volume: 0 })`, fades in over 800 ms, and cross-fades out any current track over 600 ms; `stopBgm()` fades out. Wire `BGM.*` events and the biome mapping (`BIOME_BGM`) — the scene emits `bgm:<biome>` already; make `AudioManager` resolve those names through `BIOME_BGM`. Respect the mute/volume prefs and pause music when the page is hidden (there is already a `visibilitychange` hook in `main.js` — check).
- [ ] **Step 5: Footsteps.** In `DungeonScene`'s player update, emit `SFX.FOOTSTEP` on a distance-based cadence (every ~46 px of travel while grounded and moving, ~2.6 steps/s at normal speed; halve the rate while crouching and use `vol: 0.45`). In `AudioManager`, resolve the sample family from `FOOTSTEPS[this._biome]` — the scene tells the manager its biome on floor start (add a small `setBiome(id)` call, or read it from the event payload).
- [ ] **Step 6: Verify** — `node --check` on every changed file; then a headless run: open the game, `page.evaluate` to emit every event name in `EVENT_MAP` with 120 ms between them while listening for console errors, and assert `game.cache.audio.exists(key)` is true for all `SFX_FILES`/`BGM_FILES` keys. Report any key that fell back to the synth. Play 20 s of a floor and confirm `game.sound.sounds.length` does not grow without bound (no leak).
- [ ] **Step 7: Commit** — `git add www/js/audio www/js/scenes/DungeonScene.js && git commit -m "feat(audio): sampled playback with pitch variation, retrigger guards, footsteps and looping music"`

---

### Task 4: Menu sounds (HTML pages)

**Files:** create `www/js/audio/menuAudio.js`; modify `www/transylvania-menu.js`, `www/transylvania-menu.html` (script tag if needed)

- [ ] **Step 1:** `menuAudio.js` — a 30-line module with a preloaded `Audio` per sound (`ui_click`, `ui_back`, `ui_buy`, `ui_deny`, `ui_open`), `volume` from `Progress.getAudioPrefs()` (import `ProgressStore`), a `play(name)` that clones the node (`cloneNode()` or resets `currentTime`) so rapid taps overlap, and a global mute check. Files come from `assets/audio/sfx/`.
- [ ] **Step 2:** Wire in `transylvania-menu.js`: card taps and footer buttons → `ui_click`; back → `ui_back`; opening shop/codex → `ui_open`; successful purchase → `ui_buy`; `flashNoCheese` → `ui_deny`. First interaction unlocks audio (browsers block autoplay) — do not attempt to play before the first user gesture.
- [ ] **Step 3: Verify** — headless: click each control, assert no console errors and that `play()` was called (spy or a counter on `window`). Confirm the page still works with audio blocked (no unhandled promise rejections — `play()` returns a promise; `.catch(() => {})`).
- [ ] **Step 4: Commit** — `git add www/js/audio/menuAudio.js www/transylvania-menu.js www/transylvania-menu.html && git commit -m "feat(menu): UI sounds in the Castle menu (click, back, open, buy, deny)"`

---

### Task 5: Balance pass and acceptance

- [ ] **Step 1: Loudness sanity in the real engine** — script: decode every shipped sample in headless Chromium, compute `rms × vol` for each mapped event, and print a sorted table. Anything more than 2.5× the median or below 0.35× is out of balance — adjust its `vol` in `SoundMap.js` and re-run. Report the final spread.
- [ ] **Step 2:** `/opt/homebrew/bin/node --test tools/tests/hudLayout.test.mjs` (regression), `node --check` on all changed JS, `/opt/homebrew/bin/node node_modules/@capacitor/cli/bin/capacitor sync`.
- [ ] **Step 3: Device checklist for the human** — headphones and speaker: menu clicks feel crisp, not clicky-loud; pie throws and hits read distinctly during a fight; footsteps audible but not annoying (they are the highest-frequency sound); cheese pickups rise in pitch on a streak; alarm is startling but not painful; boss bell lands; win/lose stings fit; music loops without an audible seam and ducks nothing important; muting in the settings silences everything; audio survives backgrounding and returning; no crackle on a mid-range phone.

---

## Out of scope
Phase C (characters presentation), Phase D (in-game UI kit and overlays), Phase G (juice). Voice-over, per-biome music variation beyond the four loops, and dynamic mixing (ducking music under stings) are deliberately not in this phase — note them for later if the device pass asks for them.
