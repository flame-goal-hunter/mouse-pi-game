#!/usr/bin/env python3
"""
Convert ice-arena.json: individual tile images → grid spritesheet.
Keeps all layers, spawns, pickups as-is. Only remaps tile IDs and tileset.
"""
import json
import os
from PIL import Image

TILE = 70
COLS = 7
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
INPUT = os.path.join(SCRIPT_DIR, '..', 'www', 'assets', 'maps', 'ice-arena.json')
OUTPUT_SHEET = os.path.join(SCRIPT_DIR, '..', 'www', 'assets', 'snow', 'sheet.png')

with open(INPUT) as f:
    data = json.load(f)

# Build GID → image path mapping
tileset = data['tilesets'][0]
firstgid = tileset['firstgid']
maps_dir = os.path.dirname(os.path.abspath(INPUT))

gid_to_path = {}
for t in tileset.get('tiles', []):
    gid = firstgid + t['id']
    rel = t['image'].replace('\\/', '/')
    gid_to_path[gid] = os.path.normpath(os.path.join(maps_dir, rel))

# Find all used GIDs across ALL tile layers
all_gids = set()
for layer in data['layers']:
    if layer.get('type') == 'tilelayer' and 'data' in layer:
        for g in layer['data']:
            if g > 0:
                all_gids.add(g)

used_gids = sorted(all_gids)
print(f"Unique tiles: {len(used_gids)}")

# Verify files exist
for gid in used_gids:
    p = gid_to_path.get(gid)
    exists = p and os.path.exists(p)
    print(f"  GID {gid} → {os.path.basename(p) if p else '???'} {'OK' if exists else 'MISSING!'}")
    if not exists:
        print(f"    Full path: {p}")
        exit(1)

# Build spritesheet
n = len(used_gids)
rows = (n + COLS - 1) // COLS
sheet_w, sheet_h = COLS * TILE, rows * TILE

sheet = Image.new('RGBA', (sheet_w, sheet_h), (0, 0, 0, 0))
old_to_new = {}

for idx, old_gid in enumerate(used_gids):
    new_gid = idx + 1
    old_to_new[old_gid] = new_gid
    c, r = idx % COLS, idx // COLS
    img = Image.open(gid_to_path[old_gid]).convert('RGBA')
    if img.size != (TILE, TILE):
        img = img.resize((TILE, TILE), Image.LANCZOS)
    sheet.paste(img, (c * TILE, r * TILE))
    print(f"  [{new_gid:2d}] ← GID {old_gid} = {os.path.basename(gid_to_path[old_gid])}")

os.makedirs(os.path.dirname(OUTPUT_SHEET), exist_ok=True)
sheet.save(OUTPUT_SHEET)
print(f"\nSpritesheet: {OUTPUT_SHEET} ({sheet_w}x{sheet_h})")

# Remap tile data in all layers
for layer in data['layers']:
    if layer.get('type') == 'tilelayer' and 'data' in layer:
        layer['data'] = [old_to_new.get(g, 0) if g > 0 else 0 for g in layer['data']]

# Replace tileset definition
data['tilesets'] = [{
    "columns": COLS,
    "firstgid": 1,
    "image": "../snow/sheet.png",
    "imageheight": sheet_h,
    "imagewidth": sheet_w,
    "margin": 0,
    "name": "snow",
    "spacing": 0,
    "tilecount": n,
    "tileheight": TILE,
    "tilewidth": TILE
}]

# Save (overwrite original)
with open(INPUT, 'w') as f:
    json.dump(data, f, indent=1)

print(f"Updated: {INPUT}")
print(f"\nGID mapping:")
for old, new in sorted(old_to_new.items()):
    print(f"  {old} → {new}")
