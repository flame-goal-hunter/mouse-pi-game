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


def mix_i(c, target, t):
    """Blend colour int c toward target int by t (0..1). Returns an int."""
    r = int(((c >> 16) & 255) * (1 - t) + ((target >> 16) & 255) * t)
    g = int(((c >> 8) & 255) * (1 - t) + ((target >> 8) & 255) * t)
    b = int((c & 255) * (1 - t) + (target & 255) * t)
    return (r << 16) | (g << 8) | b


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
        # Biomes.js also holds FLOOR_MODIFIERS, whose entries have an id and no palette —
        # skip anything that is not a biome instead of failing on it.
        if not re.search(r"floorColorA:\s*0x", chunk):
            continue
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


def _stone_quarter(fill, grid, q, seam_on=True):
    """Default: an 80x80 bevelled stone plate, split into 40x40 quarters."""
    light = mix(fill, 0xffffff, 0.24)
    dark = mix(fill, 0x000000, 0.22)
    seam = hex6(grid)
    base = mix(fill, 0xffffff, 0.10)
    parts = [f'<rect x="0" y="0" width="{T}" height="{T}" fill="{base}"/>']
    if q in ('TL', 'TR'):
        parts.append(f'<rect x="0" y="1" width="{T}" height="2" fill="{light}" opacity="0.55"/>')
    if q in ('TL', 'BL'):
        parts.append(f'<rect x="1" y="0" width="2" height="{T}" fill="{light}" opacity="0.45"/>')
    if q in ('BL', 'BR'):
        parts.append(f'<rect x="0" y="{T-3}" width="{T}" height="2" fill="{dark}" opacity="0.6"/>')
    if q in ('TR', 'BR'):
        parts.append(f'<rect x="{T-3}" y="0" width="2" height="{T}" fill="{dark}" opacity="0.5"/>')
    # Finding 17 — the most harmful visual defect in the registry: every plate drew its
    # own edge seam, so a seam landed on every cell and the floor read as a ruled table.
    # Only the A plate seams, and softly; B is seamless, so the two break the grid up.
    if seam_on:
        if q in ('TL', 'TR'):
            parts.append(f'<rect x="0" y="0" width="{T}" height="1" fill="{seam}" opacity="0.34"/>')
        if q in ('TL', 'BL'):
            parts.append(f'<rect x="0" y="0" width="1" height="{T}" fill="{seam}" opacity="0.34"/>')
    spots = {'TL': [(12, 27, 1.4), (29, 9, 1.0)], 'TR': [(9, 14, 1.2), (24, 31, 1.5)],
             'BL': [(27, 12, 1.1), (14, 24, 1.4)], 'BR': [(8, 30, 1.0), (30, 20, 1.3)]}[q]
    for (x, y, r) in spots:
        parts.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{dark}" opacity="0.35"/>')
    return parts


def _tile_quarter(fill, grid, q):
    """Kitchen: glazed ceramic squares, one per quarter, with grout and a corner sheen."""
    grout = hex6(grid)
    face_i = mix_i(fill, 0xffffff, 0.30 if q in ('TL', 'BR') else 0.14)   # checkerboard
    face = hex6(face_i)
    shine = mix(face_i, 0xffffff, 0.45)
    return [
        f'<rect x="0" y="0" width="{T}" height="{T}" fill="{grout}"/>',
        f'<rect x="1.5" y="1.5" width="{T-3}" height="{T-3}" rx="2" fill="{face}"/>',
        f'<path d="M4 12 Q6 5 13 4" fill="none" stroke="{shine}" stroke-width="2.4" '
        f'stroke-linecap="round" opacity="0.55"/>',
    ]


def _plank_quarter(fill, grid, q):
    """Library: wooden boards. Two 20px boards per quarter, staggered per plate half."""
    grain = mix(fill, 0x000000, 0.30)
    seam = mix(fill, 0x000000, 0.45)
    top = 'T' in q
    parts = [f'<rect x="0" y="0" width="{T}" height="{T}" fill="{mix(fill, 0xffffff, 0.12)}"/>']
    for i, by in enumerate((0, 20)):
        board = mix(fill, 0xffffff, 0.18 if (i + (0 if top else 1)) % 2 == 0 else 0.06)
        parts.append(f'<rect x="0" y="{by}" width="{T}" height="19" fill="{board}"/>')
        parts.append(f'<rect x="0" y="{by+19}" width="{T}" height="1" fill="{seam}" opacity="0.75"/>')
        # grain lines + a nail at the board end
        parts.append(f'<path d="M2 {by+6} H36 M6 {by+13} H32" stroke="{grain}" stroke-width="0.8" '
                     f'opacity="0.35" fill="none"/>')
        nx = 4 if q in ('TL', 'BL') else 34
        parts.append(f'<circle cx="{nx}" cy="{by+10}" r="1.2" fill="{seam}" opacity="0.6"/>')
    return parts


def _flag_quarter(fill, grid, q):
    """Garden: irregular flagstones with moss creeping into the seams."""
    stone = mix(fill, 0xffffff, 0.16)
    edge = mix(fill, 0x000000, 0.30)
    moss = mix(0x4a7c3a, fill, 0.35)
    shapes = {
        'TL': 'M3 4 L34 2 L37 30 L20 37 L2 32 Z',
        'TR': 'M4 3 L36 5 L38 34 L14 36 L2 20 Z',
        'BL': 'M2 6 L22 2 L37 12 L34 36 L6 34 Z',
        'BR': 'M6 2 L36 6 L35 33 L10 37 L3 18 Z',
    }[q]
    return [
        f'<rect x="0" y="0" width="{T}" height="{T}" fill="{moss}"/>',
        f'<path d="{shapes}" fill="{stone}" stroke="{edge}" stroke-width="1.4" stroke-linejoin="round"/>',
        f'<circle cx="{6 if q[1] == "L" else 34}" cy="{34 if q[0] == "B" else 6}" r="2.6" '
        f'fill="{moss}" opacity="0.85"/>',
    ]


def _marble_quarter(fill, grid, q):
    """Throne: polished marble with veining and a gold inlay along the plate border."""
    base_i = mix_i(fill, 0xffffff, 0.16)
    base = hex6(base_i)
    vein = mix(fill, 0xffffff, 0.42)
    deep = mix(fill, 0x000000, 0.25)
    parts = [f'<rect x="0" y="0" width="{T}" height="{T}" fill="{base}"/>',
             f'<rect x="0" y="0" width="{T}" height="{T//2}" fill="{mix(base_i, 0xffffff, 0.06)}"/>']
    veins = {'TL': 'M2 30 Q14 20 12 6 M22 38 Q30 26 38 24',
             'TR': 'M38 28 Q26 22 28 8 M4 36 Q12 24 2 18',
             'BL': 'M2 8 Q16 16 14 32 M26 2 Q30 14 38 16',
             'BR': 'M38 10 Q24 18 26 34 M2 4 Q10 16 4 26'}[q]
    parts.append(f'<path d="{veins}" fill="none" stroke="{vein}" stroke-width="1.3" opacity="0.5"/>')
    parts.append(f'<path d="{veins}" fill="none" stroke="{deep}" stroke-width="0.6" opacity="0.35"/>')
    # Gold inlay on the plate's outer edges only
    if q in ('TL', 'TR'):
        parts.append(f'<rect x="0" y="0" width="{T}" height="1.6" fill="{GOLD}" opacity="0.55"/>')
    if q in ('TL', 'BL'):
        parts.append(f'<rect x="0" y="0" width="1.6" height="{T}" fill="{GOLD}" opacity="0.55"/>')
    return parts


FLOOR_STYLE = {'kitchen': _tile_quarter, 'library': _plank_quarter,
               'garden': _flag_quarter, 'throne': _marble_quarter}


def plate_quarter(fill, grid, q, biome='dungeon', seam_on=True):
    fn = FLOOR_STYLE.get(biome, _stone_quarter)
    try:
        return fn(fill, grid, q, seam_on)
    except TypeError:
        return fn(fill, grid, q)


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


def _wall_brick(fill, shadow, highlight):
    f, s_, _h = hex6(fill), hex6(shadow), hex6(highlight)
    bl = mix(fill, 0xffffff, 0.10)
    return [
        f'<rect x="0" y="0" width="{T}" height="{T}" fill="{f}"/>',
        f'<rect x="1" y="1" width="{T-2}" height="1.5" fill="{bl}" opacity="0.5"/>',
        f'<rect x="21" y="21" width="{T-2}" height="1.5" fill="{bl}" opacity="0.5"/>',
        f'<rect x="-19" y="21" width="{T-2}" height="1.5" fill="{bl}" opacity="0.5"/>',
        f'<rect x="0" y="19" width="{T}" height="1.5" fill="{s_}" opacity="0.8"/>',
        f'<rect x="0" y="0" width="1.5" height="20" fill="{s_}" opacity="0.8"/>',
        f'<rect x="20" y="20" width="1.5" height="20" fill="{s_}" opacity="0.8"/>',
        f'<rect x="0" y="{T-1.5}" width="{T}" height="1.5" fill="{s_}" opacity="0.6"/>',
    ]


def _wall_glazed(fill, shadow, highlight):
    """Kitchen: square glazed tiles, 20px grid, with a highlight corner on each."""
    s_ = hex6(shadow)
    # Deliberately darker and cooler than the floor tile: in the kitchen both surfaces
    # are square ceramic, so only value separates wall from floor.
    face_i = mix_i(fill, 0x000000, 0.16)
    face = hex6(face_i)
    shine = mix(face_i, 0xffffff, 0.34)
    grout = mix(fill, 0x000000, 0.55)
    parts = [f'<rect x="0" y="0" width="{T}" height="{T}" fill="{grout}"/>']
    for cx in (0, 20):
        for cy in (0, 20):
            parts.append(f'<rect x="{cx+1}" y="{cy+1}" width="18" height="18" rx="1.5" fill="{face}"/>')
            parts.append(f'<path d="M{cx+3} {cx and cy and cy+8 or cy+8} Q{cx+4} {cy+3} {cx+9} {cy+3}" '
                         f'fill="none" stroke="{shine}" stroke-width="1.6" stroke-linecap="round" opacity="0.5"/>')
    return parts


def _wall_shelf(fill, shadow, highlight):
    """Library: the wall IS the bookcase — shelf boards with rows of spines."""
    f, s_ = hex6(fill), hex6(shadow)
    board = mix(fill, 0xffffff, 0.22)
    back = mix(fill, 0x000000, 0.35)
    spine_colours = ['#8c3b3b', '#3b5c8c', '#7a6a2e', '#4a7c3a', '#6a3b7a', '#a8632e']
    parts = [f'<rect x="0" y="0" width="{T}" height="{T}" fill="{back}"/>']
    for row, sy in enumerate((0, 20)):
        x = 1.5
        i = row * 3
        while x < T - 2:
            w = 3 + ((i * 7) % 4)
            h = 12 + ((i * 5) % 4)
            col = spine_colours[i % len(spine_colours)]
            parts.append(f'<rect x="{x:.1f}" y="{sy + 17 - h}" width="{w}" height="{h}" '
                         f'rx="0.8" fill="{col}" opacity="0.92"/>')
            x += w + 1.2
            i += 1
        parts.append(f'<rect x="0" y="{sy + 17}" width="{T}" height="3" fill="{board}"/>')
        parts.append(f'<rect x="0" y="{sy + 20 - 0.8}" width="{T}" height="0.8" fill="{s_}" opacity="0.8"/>')
    return parts


def _wall_hedge(fill, shadow, highlight):
    """Garden: clipped hedge over the stone — leafy clumps, no brick courses."""
    s_ = hex6(shadow)
    leaf_d = mix(fill, 0x000000, 0.28)
    leaf_m = mix(0x4a7c3a, fill, 0.30)
    leaf_l = mix(0x6fae55, fill, 0.20)
    parts = [f'<rect x="0" y="0" width="{T}" height="{T}" fill="{leaf_d}"/>']
    blobs = [(6, 7, 7), (20, 5, 8), (33, 9, 7), (12, 19, 8), (28, 20, 8),
             (4, 31, 7), (19, 33, 8), (35, 30, 7)]
    for i, (x, y, r) in enumerate(blobs):
        parts.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{leaf_m}"/>')
        parts.append(f'<circle cx="{x - r*0.3:.1f}" cy="{y - r*0.35:.1f}" r="{r*0.45:.1f}" '
                     f'fill="{leaf_l}" opacity="0.75"/>')
    parts.append(f'<rect x="0" y="{T-2}" width="{T}" height="2" fill="{s_}" opacity="0.5"/>')
    return parts


def _wall_drape(fill, shadow, highlight):
    """Throne: dressed stone with a hanging banner panel."""
    f, s_, h = hex6(fill), hex6(shadow), hex6(highlight)
    block = mix(fill, 0xffffff, 0.10)
    cloth = mix(0x7a1230, fill, 0.25)
    cloth_l = mix(0x9c1b3d, fill, 0.15)
    parts = [f'<rect x="0" y="0" width="{T}" height="{T}" fill="{f}"/>',
             f'<rect x="0" y="0" width="{T}" height="19" fill="{block}"/>',
             f'<rect x="0" y="19" width="{T}" height="1.4" fill="{s_}" opacity="0.85"/>',
             f'<rect x="0" y="20" width="{T}" height="19" fill="{block}" opacity="0.75"/>',
             f'<rect x="0" y="{T-1.4}" width="{T}" height="1.4" fill="{s_}" opacity="0.7"/>',
             # banner panel down the middle of every second column (20px period)
             f'<rect x="12" y="0" width="16" height="{T}" fill="{cloth}" opacity="0.9"/>',
             f'<rect x="13.5" y="0" width="3" height="{T}" fill="{cloth_l}" opacity="0.5"/>',
             f'<rect x="12" y="0" width="16" height="{T}" fill="none" stroke="{GOLD}" '
             f'stroke-width="1" opacity="0.55"/>']
    return parts


WALL_STYLE = {'kitchen': _wall_glazed, 'library': _wall_shelf,
              'garden': _wall_hedge, 'throne': _wall_drape}


def wall(fill, shadow, highlight, cap, skirt, biome='dungeon', edge_l=False, edge_r=False):
    s_, h = hex6(shadow), hex6(highlight)
    parts = WALL_STYLE.get(biome, _wall_brick)(fill, shadow, highlight)
    if cap:
        # Top face: a deeper recess plus a lit lip, so the wall reads as having height
        parts.append(f'<rect x="0" y="0" width="{T}" height="5" fill="{s_}" opacity="0.9"/>')
        parts.append(f'<rect x="0" y="5" width="{T}" height="2.5" fill="{h}" opacity="0.9"/>')
    if skirt:
        parts.append(f'<rect x="0" y="{T-3}" width="{T}" height="1" fill="{s_}" opacity="0.9"/>')
        parts.append(f'<rect x="0" y="{T-2}" width="{T}" height="2" fill="{GOLD}" opacity="0.6"/>')
    # Side faces — the corner tiles the registry asked for
    if edge_l:
        parts.append(f'<rect x="0" y="0" width="3" height="{T}" fill="{s_}" opacity="0.75"/>')
        parts.append(f'<rect x="3" y="0" width="1.5" height="{T}" fill="{h}" opacity="0.45"/>')
    if edge_r:
        parts.append(f'<rect x="{T-3}" y="0" width="3" height="{T}" fill="{s_}" opacity="0.75"/>')
        parts.append(f'<rect x="{T-4.5}" y="0" width="1.5" height="{T}" fill="{h}" opacity="0.45"/>')
    return parts


def weak_crack():
    return [f'<polyline points="20,2 17,10 22,16 16,24 21,31 18,38" fill="none" stroke="{INK}" stroke-width="2.2" '
            f'stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>',
            f'<polyline points="17,10 11,13 M22,16 28,18 M16,24 10,27 M21,31 27,33" fill="none" stroke="{INK}" '
            f'stroke-width="1.4" stroke-linecap="round" opacity="0.8"/>']


def build_sheet(b):
    tiles = []
    for plate, fill in enumerate((b['floorA'], b['floorB'])):
        for q in ('TL', 'TR', 'BL', 'BR'):
            tiles.append(plate_quarter(fill, b['grid'], q, b['id'], seam_on=(plate == 0)))
    tiles.append(crack(b['grid']))
    tiles.append(pebbles(b['grid']))
    # 10..25 — wall bit-field: +1 cap, +2 skirt, +4 left edge, +8 right edge
    for m in range(16):
        tiles.append(wall(b['wallFill'], b['wallShadow'], b['wallHighlight'],
                          bool(m & 1), bool(m & 2), b['id'],
                          edge_l=bool(m & 4), edge_r=bool(m & 8)))
    tiles.append([])                    # 26 empty
    tiles.append(weak_crack())          # 27
    assert len(tiles) == 28, len(tiles)
    groups = []
    for i, parts in enumerate(tiles):
        inner = '\n    '.join(parts)
        groups.append(f'  <g transform="translate({i * T},0)" clip-path="url(#cell)">\n    {inner}\n  </g>')
    body = '\n'.join(groups)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {len(tiles) * T} {T}" shape-rendering="geometricPrecision">\n'
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
