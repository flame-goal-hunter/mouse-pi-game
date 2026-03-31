# Mousie Pi Game — Development Rules

## Project Overview
2D multiplayer snowball fight game. Phaser 3 + Capacitor (Android).

## Architecture
- **Entry**: `www/js/main.js` → Phaser.Game
- **Scenes**: BootScene → MenuScene → GameScene
- **Physics**: `www/js/physics/SimplePhysicsWorld.js` (custom, not Phaser arcade)
- **AI**: `www/js/ai/` (TriNav, PlatformNav)
- **Maps**: Tiled JSON format in `www/assets/maps/`
- **Tilesets**: `www/assets/snow/sheet.png` (current spritesheet)

## CRITICAL RULES

### Never overwrite ice-arena.json directly
The user edits maps in Tiled and exports to `ice-arena.json`. After export, run
`python3 tools/assemble_map.py` to convert individual tile images → spritesheet.
Generator output goes to `ice-arena-generated.json`.

### Map JSON required layers
The game expects these layer names in exact order:
1. `background` (tilelayer) — decorations, no collision
2. `water` (tilelayer) — water tiles
3. `platforms` (tilelayer) — all solid geometry, collision via `setCollisionByExclusion([-1, 0])`
4. `spawns` (objectgroup) — point objects named spawn1, spawn2, etc.
5. `pickups` (objectgroup) — point objects named health/speed/fire/shield/doublejump
6. `trees` (tilelayer) — decorative layer above platforms

### Tileset pipeline
The user draws maps in Tiled using individual Kenney tile PNGs from Downloads.
Phaser CANNOT load individual-image tilesets (`columns: 0`). The pipeline:
1. User exports TMX/JSON from Tiled → `www/assets/maps/ice-arena.json`
2. Run `python3 tools/assemble_map.py` — assembles used tiles into `www/assets/snow/sheet.png` grid spritesheet and remaps GIDs in the JSON
3. Run `npx cap sync` (or `node node_modules/@capacitor/cli/bin/capacitor sync`)

### Tileset references in code
- **BootScene.js:132**: `this.load.image('ice-tiles', 'assets/snow/sheet.png')`
- **BootScene.js:133**: `this.load.tilemapTiledJSON('ice-map', 'assets/maps/ice-arena.json')`
- **GameScene.js:227**: `this.map.addTilesetImage('snow', 'ice-tiles')` — 'snow' matches tileset name in JSON

If assemble_map.py changes the tileset name, update GameScene accordingly.

### Capacitor / Android build
- Capacitor 5.7 — do NOT use AGP > 8.x or Gradle > 8.x
- `android/build.gradle`: AGP 8.2.2
- `android/gradle/wrapper/gradle-wrapper.properties`: Gradle 8.5
- After any www/ changes: `npx cap sync` before building APK
- Node.js is at `/opt/homebrew/bin/node` (not in default PATH in this env)

### Code style
- Do not modify files that weren't asked to change
- Do not add docstrings/comments to existing code
- Do not refactor surrounding code when fixing a bug
- Keep responses concise — user understands Russian

## File locations
- Game source: `www/js/`
- Assets: `www/assets/`
- Maps: `www/assets/maps/ice-arena.json`
- Current tileset: `www/assets/snow/sheet.png`
- Old tileset (unused): `www/assets/ice/sheet.png`
- Map converter: `tools/assemble_map.py`
- Android project: `android/`
- Capacitor config: `capacitor.config.json`
