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

# Tiled flip flags (high bits of GID)
FLIP_H = 0x80000000
FLIP_V = 0x40000000
FLIP_D = 0x20000000
FLIP_MASK = FLIP_H | FLIP_V | FLIP_D

# Find all used GIDs (strip flip bits for identification, but preserve them for output)
all_gids = set()
for layer in data['layers']:
    if layer.get('type') == 'tilelayer' and 'data' in layer:
        for g in layer['data']:
            if g > 0:
                base_gid = g & ~FLIP_MASK
                if base_gid > 0:
                    all_gids.add(base_gid)

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

# Build spritesheet with 2px margin + 2px spacing (fixes tile seams)
MARGIN = 2
SPACING = 2
n = len(used_gids)
rows = (n + COLS - 1) // COLS
cell = TILE + SPACING
sheet_w = MARGIN * 2 + COLS * cell - SPACING
sheet_h = MARGIN * 2 + rows * cell - SPACING

sheet = Image.new('RGBA', (sheet_w, sheet_h), (0, 0, 0, 0))
old_to_new = {}

for idx, old_gid in enumerate(used_gids):
    new_gid = idx + 1
    old_to_new[old_gid] = new_gid
    c, r = idx % COLS, idx // COLS
    img = Image.open(gid_to_path[old_gid]).convert('RGBA')
    if img.size != (TILE, TILE):
        img = img.resize((TILE, TILE), Image.LANCZOS)
    px = MARGIN + c * cell
    py = MARGIN + r * cell
    sheet.paste(img, (px, py))
    # Extrude edges by 1px to prevent seam bleeding
    # Top edge
    sheet.paste(img.crop((0, 0, TILE, 1)), (px, py - 1))
    # Bottom edge
    sheet.paste(img.crop((0, TILE - 1, TILE, TILE)), (px, py + TILE))
    # Left edge
    sheet.paste(img.crop((0, 0, 1, TILE)), (px - 1, py))
    # Right edge
    sheet.paste(img.crop((TILE - 1, 0, TILE, TILE)), (px + TILE, py))
    print(f"  [{new_gid:2d}] ← GID {old_gid} = {os.path.basename(gid_to_path[old_gid])}")

os.makedirs(os.path.dirname(OUTPUT_SHEET), exist_ok=True)
sheet.save(OUTPUT_SHEET)
print(f"\nSpritesheet: {OUTPUT_SHEET} ({sheet_w}x{sheet_h})")

# Remap tile data in all layers (preserve flip bits)
for layer in data['layers']:
    if layer.get('type') == 'tilelayer' and 'data' in layer:
        new_data = []
        for g in layer['data']:
            if g <= 0:
                new_data.append(0)
            else:
                flip = g & FLIP_MASK
                base = g & ~FLIP_MASK
                new_gid = old_to_new.get(base, 0)
                new_data.append((new_gid | flip) if new_gid > 0 else 0)
        layer['data'] = new_data

# Replace tileset definition
data['tilesets'] = [{
    "columns": COLS,
    "firstgid": 1,
    "image": "../snow/sheet.png",
    "imageheight": sheet_h,
    "imagewidth": sheet_w,
    "margin": MARGIN,
    "name": "snow",
    "spacing": SPACING,
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
