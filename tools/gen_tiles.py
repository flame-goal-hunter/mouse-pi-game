#!/usr/bin/env python3
"""Generate per-biome SVG tilesets for the Transylvania mode.

Reads the biome palettes from www/js/scenes/Biomes.js (single source of truth)
and writes www/assets/tiles/<biome>.svg — one row of 16 tiles, 40×40 each
(viewBox 0 0 640 40). Phaser loads each sheet with load.svg at 40·dpr px per
tile and uses it as a tileset (see DungeonScene TILE constants).

Tile indices:
  0-3   floor plate A quarters (TL, TR, BL, BR)   — an 80×80 stone plate = 2×2 cells
  4-7   floor plate B quarters (TL, TR, BL, BR)
  8     crack overlay (transparent background)
  9     pebbles overlay (transparent background)
  10    wall: plain (brick courses only)
  11    wall: top cant (dark recess + highlight at the top edge)
  12    wall: skirting (gold trim at the bottom edge)
  13    wall: cant + skirting
  14    empty (transparent)
  15    weak-wall crack overlay (transparent background)

Style (from the character art): dark outline #1a1a1a, soft bevels, one highlight.
Run: python3 tools/gen_tiles.py
"""
import re
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
BIOMES_JS = ROOT / 'www' / 'js' / 'scenes' / 'Biomes.js'
OUT_DIR = ROOT / 'www' / 'assets' / 'tiles'

T = 40            # cell size
GOLD = '#d8a850'  # WALL_TRIM_GOLD in DungeonScene.js
INK = '#1a1a1a'


def hex6(v):
    return '#%06x' % v


def mix(c, target, t):
    """Blend colour int c toward target int by t (0..1). Returns '#rrggbb'."""
    r = int(((c >> 16) & 255) * (1 - t) + ((target >> 16) & 255) * t)
    g = int(((c >> 8) & 255) * (1 - t) + ((target >> 8) & 255) * t)
    b = int((c & 255) * (1 - t) + (target & 255) * t)
    return '#%02x%02x%02x' % (r, g, b)


def parse_biomes(src):
    """Return list of dicts with id + palette ints, in file order."""
    biomes = []
    for m in re.finditer(r"id:\s*'([a-z]+)'", src):
        bid = m.group(1)
        chunk = src[m.start(): m.start() + 2000]
        def col(name):
            mm = re.search(name + r":\s*0x([0-9a-fA-F]{6})", chunk)
            if not mm:
                raise SystemExit(f'{bid}: missing {name}')
            return int(mm.group(1), 16)
        biomes.append({
            'id': bid,
            'floorA': col('floorColorA'), 'floorB': col('floorColorB'), 'grid': col('gridColor'),
            'wallFill': col('wallFill'), 'wallShadow': col('wallShadow'), 'wallHighlight': col('wallHighlight'),
        })
    return biomes


def plate_quarter(fill, grid, q):
    """One 40×40 quarter of an 80×80 stone plate. q in TL,TR,BL,BR."""
    light = mix(fill, 0xffffff, 0.14)
    dark = mix(fill, 0x000000, 0.28)
    seam = hex6(grid)
    parts = [f'<rect x="0" y="0" width="{T}" height="{T}" fill="{fill_hex(fill)}"/>']
    # Bevel: light along the plate's top/left, dark along bottom/right (2px inside the seam)
    if q in ('TL', 'TR'):
        parts.append(f'<rect x="0" y="1" width="{T}" height="2" fill="{light}" opacity="0.55"/>')
    if q in ('TL', 'BL'):
        parts.append(f'<rect x="1" y="0" width="2" height="{T}" fill="{light}" opacity="0.45"/>')
    if q in ('BL', 'BR'):
        parts.append(f'<rect x="0" y="{T-3}" width="{T}" height="2" fill="{dark}" opacity="0.6"/>')
    if q in ('TR', 'BR'):
        parts.append(f'<rect x="{T-3}" y="0" width="2" height="{T}" fill="{dark}" opacity="0.5"/>')
    # Mortar seam on the plate's top and left outer edges (each plate draws only these two)
    if q in ('TL', 'TR'):
        parts.append(f'<rect x="0" y="0" width="{T}" height="1" fill="{seam}" opacity="0.7"/>')
    if q in ('TL', 'BL'):
        parts.append(f'<rect x="0" y="0" width="1" height="{T}" fill="{seam}" opacity="0.7"/>')
    # A few speckles for stone texture (deterministic per quarter)
    spots = {'TL': [(12, 27, 1.4), (29, 9, 1.0)], 'TR': [(9, 14, 1.2), (24, 31, 1.5)],
             'BL': [(27, 12, 1.1), (14, 24, 1.4)], 'BR': [(8, 30, 1.0), (30, 20, 1.3)]}[q]
    for (x, y, r) in spots:
        parts.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{dark}" opacity="0.35"/>')
    return parts


def fill_hex(v):
    return hex6(v)


def crack(grid):
    c = hex6(grid)
    return [f'<polyline points="9,15 17,20 22,17 28,25 33,24" fill="none" stroke="{c}" stroke-width="1.4" '
            f'stroke-linecap="round" stroke-linejoin="round" opacity="0.7"/>',
            f'<polyline points="22,17 24,12" fill="none" stroke="{c}" stroke-width="1" stroke-linecap="round" opacity="0.6"/>']


def pebbles(grid):
    c = hex6(grid)
    return [f'<circle cx="26" cy="15" r="1.7" fill="{c}" opacity="0.6"/>',
            f'<circle cx="13" cy="26" r="1.3" fill="{c}" opacity="0.55"/>',
            f'<circle cx="30" cy="27" r="1.0" fill="{c}" opacity="0.5"/>']


def wall(fill, shadow, highlight, cap, skirt):
    f, s, h = hex6(fill), hex6(shadow), hex6(highlight)
    brick_light = mix(fill, 0xffffff, 0.10)
    parts = [f'<rect x="0" y="0" width="{T}" height="{T}" fill="{f}"/>']
    # Two brick courses (40×20), lower course offset by half a brick — 40px periodic
    # course 0: brick spans x 0..40 ; course 1: bricks x -20..20 and 20..60
    parts.append(f'<rect x="1" y="1" width="{T-2}" height="1.5" fill="{brick_light}" opacity="0.5"/>')   # brick top light
    parts.append(f'<rect x="21" y="21" width="{T-2}" height="1.5" fill="{brick_light}" opacity="0.5"/>')
    parts.append(f'<rect x="-19" y="21" width="{T-2}" height="1.5" fill="{brick_light}" opacity="0.5"/>')
    parts.append(f'<rect x="0" y="19" width="{T}" height="1.5" fill="{s}" opacity="0.8"/>')   # horizontal mortar
    parts.append(f'<rect x="0" y="0" width="1.5" height="20" fill="{s}" opacity="0.8"/>')     # vertical mortar course 0
    parts.append(f'<rect x="20" y="20" width="1.5" height="20" fill="{s}" opacity="0.8"/>')   # vertical mortar course 1
    parts.append(f'<rect x="0" y="{T-1.5}" width="{T}" height="1.5" fill="{s}" opacity="0.6"/>')  # bottom mortar
    if cap:
        parts.append(f'<rect x="0" y="0" width="{T}" height="4" fill="{s}" opacity="0.85"/>')
        parts.append(f'<rect x="0" y="4" width="{T}" height="2" fill="{h}" opacity="0.9"/>')
    if skirt:
        parts.append(f'<rect x="0" y="{T-3}" width="{T}" height="1" fill="{s}" opacity="0.9"/>')
        parts.append(f'<rect x="0" y="{T-2}" width="{T}" height="2" fill="{GOLD}" opacity="0.6"/>')
    return parts


def weak_crack():
    return [f'<polyline points="20,2 17,10 22,16 16,24 21,31 18,38" fill="none" stroke="{INK}" stroke-width="2.2" '
            f'stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>',
            f'<polyline points="17,10 11,13 M22,16 28,18 M16,24 10,27 M21,31 27,33" fill="none" stroke="{INK}" '
            f'stroke-width="1.4" stroke-linecap="round" opacity="0.8"/>']


def build_sheet(b):
    tiles = []
    for fill in (b['floorA'], b['floorB']):
        for q in ('TL', 'TR', 'BL', 'BR'):
            tiles.append(plate_quarter(fill, b['grid'], q))
    tiles.append(crack(b['grid']))
    tiles.append(pebbles(b['grid']))
    for cap, skirt in ((False, False), (True, False), (False, True), (True, True)):
        tiles.append(wall(b['wallFill'], b['wallShadow'], b['wallHighlight'], cap, skirt))
    tiles.append([])                    # 14 empty
    tiles.append(weak_crack())          # 15
    assert len(tiles) == 16
    groups = []
    for i, parts in enumerate(tiles):
        inner = '\n    '.join(parts)
        groups.append(f'  <g transform="translate({i * T},0)" clip-path="url(#cell)">\n    {inner}\n  </g>')
    body = '\n'.join(groups)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {16 * T} {T}" shape-rendering="geometricPrecision">\n'
            f'  <defs><clipPath id="cell"><rect x="0" y="0" width="{T}" height="{T}"/></clipPath></defs>\n'
            f'{body}\n</svg>\n')


def main():
    src = BIOMES_JS.read_text()
    biomes = parse_biomes(src)
    if not biomes:
        raise SystemExit('no biomes parsed')
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for b in biomes:
        (OUT_DIR / f"{b['id']}.svg").write_text(build_sheet(b))
        print('wrote', b['id'])


if __name__ == '__main__':
    main()
