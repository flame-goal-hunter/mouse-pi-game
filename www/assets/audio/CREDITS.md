# Audio credits

All sounds in `www/assets/audio/` are **CC0 1.0** (public domain dedication).
CC0 requires no attribution, but provenance is documented here for future reference.

## Sound effects (`sfx/`) — Kenney

Source: [kenney.nl](https://kenney.nl), CC0 1.0 Universal. Packs used:

- **Interface Sounds** — https://kenney.nl/assets/interface-sounds
  `ui_click`, `ui_back`, `ui_buy`, `ui_deny`, `ui_open`, `ui_close`, `ui_tick`,
  `cheese`, `heart`, `powerup`, `alarm`
- **Impact Sounds** — https://kenney.nl/assets/impact-sounds
  `hit_enemy_a/b/c`, `hit_wall_a/b`, `take_damage`, `enemy_death_a/b`, `boss_hit`,
  `squelch`, `book_thud`, `step_stone_1/2/3`, `step_wood_1/2/3`, `step_carpet_1/2/3`,
  `step_grass_1/2/3`, `sting_boss`
- **RPG Audio** — https://kenney.nl/assets/rpg-audio
  `throw_a`, `throw_b`, `dash`, `key`, `chest`, `coins`, `torch`, `door`
- **Music Jingles** — https://kenney.nl/assets/music-jingles
  `sting_win` (8-Bit jingles/jingles_NES00), `sting_lose` (Steel jingles/jingles_STEEL02),
  `sting_death` (Steel jingles/jingles_STEEL07), `sting_floor` (Pizzicato jingles/jingles_PIZZI01),
  `sting_boss_phase` (Steel jingles/jingles_STEEL13)

### Reused files (no duplicate copy)
- `suspicion` reuses `ui_tick.ogg` (same file, different event mapping in `SoundMap.js`).
- `ghost` reuses `throw_a.ogg` at a lower playback rate (same file, different event mapping).

## Ambient music loops (`bgm/`) — OpenGameArt

Source: [opengameart.org](https://opengameart.org), CC0.

| file | used by | OGA page |
|---|---|---|
| `cavern.ogg` | dungeon, library | https://opengameart.org/content/dark-cavern-ambient (`dark_cavern_ambient_001.ogg`) |
| `hall.ogg` | kitchen, menu | https://opengameart.org/content/dark-cavern-ambient (`dark_cavern_ambient_002.ogg`) |
| `garden.ogg` | garden | https://opengameart.org/content/cathedral-in-the-forest-ambient-loop (`forest_2_0.ogg`) |
| `throne.ogg` | throne | https://opengameart.org/content/dark-place-loop (`dark_place.ogg`) |

## Re-download recipe (if source cache is cleared)

- Kenney: fetch `https://kenney.nl/assets/<pack>` with a desktop User-Agent and
  scrape for `href='...kenney_<pack>.zip'`, then unzip.
- OpenGameArt: `https://opengameart.org/sites/default/files/<name>.ogg`.
