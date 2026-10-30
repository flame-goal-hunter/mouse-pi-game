#!/usr/bin/env python3
"""
Procedural generator for the Snowball Arena ('ice-arena.json') and its
consolidated tileset spritesheet ('www/assets/snow/sheet.png').

Pure Python 3 implementation (uses only stdlib `struct` and `zlib`).
Builds a Teeworlds-inspired Alpine Canyon Arena (48x26 tiles = 3360x1820 px)
with:
  - 45-degree sloped hills & ramps (full SimplePhysicsWorld polygon collision)
  - Solid canyon side cliffs & deep bedrock foundations framing the central icy chasm
  - Semantic material tile IDs so ArenaRenderer.js can render seamless vector/canvas
    rock & snow massifs, timber suspension bridges, and crystal grapple pods.
"""

import json
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICE_TILES_DIR = os.path.join(ROOT, "www", "assets", "ice", "tiles")
OUT_SHEET_PATH = os.path.join(ROOT, "www", "assets", "snow", "sheet.png")
OUT_MAP_PATH = os.path.join(ROOT, "www", "assets", "maps", "ice-arena.json")

_REQUIRED_TILES = [
    "tundraCenter",
    "tundraMid",
    "tundraLeft",
    "tundraRight",
    "tundraHillLeft",
    "tundraHillRight",
    "tundraHalfLeft",
    "tundraHalfMid",
    "tundraHalfRight",
    "iceBlock",
    "iceBlockAlt",
    "iceWater",
    "iceWaterDeep",
    "iceWaterDeepAlt",
]
_ALL_EXISTING = sorted(
    f[:-4] for f in os.listdir(ICE_TILES_DIR)
    if f.endswith(".png") and not f.startswith(".")
)
TILE_NAMES = (_REQUIRED_TILES + [t for t in _ALL_EXISTING if t not in _REQUIRED_TILES])[:47]

TILE_SIZE = 70
MARGIN = 2
SPACING = 2
COLS = 8
ROWS = (len(TILE_NAMES) + COLS - 1) // COLS


def _paeth(a, b, c):
    p = a + b - c
    pa = abs(p - a)
    pb = abs(p - b)
    pc = abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    elif pb <= pc:
        return b
    return c


def read_png_rgba(path):
    with open(path, "rb") as f:
        data = f.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"Not a valid PNG: {path}")

    pos = 8
    width = height = bit_depth = color_type = None
    plte = None
    trns = None
    idat_chunks = []

    while pos < len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        chunk_type = data[pos + 4:pos + 8]
        chunk_data = data[pos + 8:pos + 8 + length]
        pos += 12 + length

        if chunk_type == b"IHDR":
            width, height, bit_depth, color_type, _, _, _ = struct.unpack(">IIBBBBB", chunk_data)
        elif chunk_type == b"PLTE":
            plte = chunk_data
        elif chunk_type == b"tRNS":
            trns = chunk_data
        elif chunk_type == b"IDAT":
            idat_chunks.append(chunk_data)
        elif chunk_type == b"IEND":
            break

    raw = zlib.decompress(b"".join(idat_chunks))
    if bit_depth != 8:
        raise ValueError(f"Unsupported bit depth {bit_depth} in {path}")

    bpp = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color_type]
    stride = width * bpp
    recon = bytearray(height * stride)

    in_pos = 0
    for y in range(height):
        ftype = raw[in_pos]
        in_pos += 1
        row_out = y * stride
        prev_out = (y - 1) * stride
        for x in range(stride):
            val = raw[in_pos]
            in_pos += 1
            a = recon[row_out + x - bpp] if x >= bpp else 0
            b = recon[prev_out + x] if y > 0 else 0
            c = recon[prev_out + x - bpp] if (y > 0 and x >= bpp) else 0
            if ftype == 0:
                recon[row_out + x] = val
            elif ftype == 1:
                recon[row_out + x] = (val + a) & 0xFF
            elif ftype == 2:
                recon[row_out + x] = (val + b) & 0xFF
            elif ftype == 3:
                recon[row_out + x] = (val + ((a + b) >> 1)) & 0xFF
            elif ftype == 4:
                recon[row_out + x] = (val + _paeth(a, b, c)) & 0xFF

    rgba = bytearray(width * height * 4)
    for i in range(width * height):
        out_i = i * 4
        if color_type == 6:
            rgba[out_i:out_i + 4] = recon[i * 4:i * 4 + 4]
        elif color_type == 2:
            rgba[out_i:out_i + 3] = recon[i * 3:i * 3 + 3]
            rgba[out_i + 3] = 255
        elif color_type == 4:
            g = recon[i * 2]
            a = recon[i * 2 + 1]
            rgba[out_i:out_i + 4] = bytes((g, g, g, a))
        elif color_type == 0:
            g = recon[i]
            rgba[out_i:out_i + 4] = bytes((g, g, g, 255))
        elif color_type == 3:
            idx = recon[i]
            r = plte[idx * 3]
            g = plte[idx * 3 + 1]
            b = plte[idx * 3 + 2]
            a = trns[idx] if (trns and idx < len(trns)) else 255
            rgba[out_i:out_i + 4] = bytes((r, g, b, a))

    return width, height, rgba


def write_png_rgba(path, width, height, rgba):
    stride = width * 4
    raw = bytearray((stride + 1) * height)
    for y in range(height):
        raw[y * (stride + 1)] = 0
        start = y * (stride + 1) + 1
        raw[start:start + stride] = rgba[y * stride:(y + 1) * stride]

    def make_chunk(ctype, cdata):
        crc = zlib.crc32(ctype + cdata) & 0xFFFFFFFF
        return struct.pack(">I", len(cdata)) + ctype + cdata + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    compressed = zlib.compress(bytes(raw), 9)
    png_bytes = (
        b"\x89PNG\r\n\x1a\n"
        + make_chunk(b"IHDR", ihdr)
        + make_chunk(b"IDAT", compressed)
        + make_chunk(b"IEND", b"")
    )
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(png_bytes)


def build_spritesheet():
    sheet_w = MARGIN * 2 + COLS * TILE_SIZE + (COLS - 1) * SPACING
    sheet_h = MARGIN * 2 + ROWS * TILE_SIZE + (ROWS - 1) * SPACING
    sheet_rgba = bytearray(sheet_w * sheet_h * 4)

    def put_px(sx, sy, r, g, b, a):
        if 0 <= sx < sheet_w and 0 <= sy < sheet_h:
            idx = (sy * sheet_w + sx) * 4
            sheet_rgba[idx] = r
            sheet_rgba[idx + 1] = g
            sheet_rgba[idx + 2] = b
            sheet_rgba[idx + 3] = a

    for idx, name in enumerate(TILE_NAMES):
        tile_path = os.path.join(ICE_TILES_DIR, f"{name}.png")
        w, h, rgba = read_png_rgba(tile_path)

        col = idx % COLS
        row = idx // COLS
        ox = MARGIN + col * (TILE_SIZE + SPACING)
        oy = MARGIN + row * (TILE_SIZE + SPACING)

        def get_tile_px(tx, ty):
            tx = max(0, min(w - 1, tx))
            ty = max(0, min(h - 1, ty))
            i = (ty * w + tx) * 4
            return rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]

        for y in range(h):
            for x in range(w):
                r, g, b, a = get_tile_px(x, y)
                put_px(ox + x, oy + y, r, g, b, a)

        for x in range(w):
            put_px(ox + x, oy - 1, *get_tile_px(x, 0))
            put_px(ox + x, oy + h, *get_tile_px(x, h - 1))
        for y in range(h):
            put_px(ox - 1, oy + y, *get_tile_px(0, y))
            put_px(ox + w, oy + y, *get_tile_px(w - 1, y))

    write_png_rgba(OUT_SHEET_PATH, sheet_w, sheet_h, sheet_rgba)
    print(f"[generate_ice_arena] Wrote spritesheet: {OUT_SHEET_PATH} ({sheet_w}x{sheet_h})")
    return sheet_w, sheet_h


def gid(name):
    return TILE_NAMES.index(name) + 1


def build_arena_map():
    """
    Builds a 72x36 tiles (5040x2520 px) Teeworlds-inspired Alpine Canyon & Cavern Arena:
      - 4 vertical tiers, cavern tunnels, long 45° ski-ramps, and a 9-pod Hook Highway
      - Material 1 (ROCK_SNOW):
          tundraCenter, tundraMid, tundraLeft, tundraRight
          tundraHillLeft  (45° slope UP-RIGHT: rises from bottom-left to top-right)
          tundraHillRight (45° slope UP-LEFT:  rises from top-left to bottom-right)
      - Material 2 (WOOD_BRIDGE):
          tundraHalfLeft, tundraHalfMid, tundraHalfRight (thin timber suspension bridges)
      - Material 3 (HOOK_CRYSTAL):
          iceBlock, iceBlockAlt (high-altitude glacial crystal grapple pods)
    """
    W, H = 72, 36

    bg = [[0 for _ in range(W)] for _ in range(H)]
    water = [[0 for _ in range(W)] for _ in range(H)]
    plat = [[0 for _ in range(W)] for _ in range(H)]
    trees = [[0 for _ in range(W)] for _ in range(H)]

    T_ROCK = gid("tundraCenter")
    T_SNOW_TOP = gid("tundraMid")
    T_SLOPE_UR = gid("tundraHillLeft")   # rises left -> right: (0,70)-(70,0)-(70,70)
    T_SLOPE_UL = gid("tundraHillRight")  # rises right -> left: (0,0)-(70,70)-(0,70)

    T_BRIDGE_L = gid("tundraHalfLeft")
    T_BRIDGE_M = gid("tundraHalfMid")
    T_BRIDGE_R = gid("tundraHalfRight")

    T_HOOK_A = gid("iceBlock")
    T_HOOK_B = gid("iceBlockAlt")

    T_WATER_TOP = gid("iceWater")
    T_WATER_DEEP = gid("iceWaterDeep")
    T_WATER_ALT = gid("iceWaterDeepAlt")

    def fill_rock(x1, y1, x2, y2, snow_top=True):
        for y in range(y1, y2 + 1):
            for x in range(x1, x2 + 1):
                if 0 <= x < W and 0 <= y < H:
                    plat[y][x] = T_SNOW_TOP if (snow_top and y == y1) else T_ROCK

    def add_stair_ramp_ur(x_start, y_bottom, steps, bottom_fill_y):
        """45-degree ramp rising left-to-right from (x_start, y_bottom) for `steps` tiles."""
        for s in range(steps):
            x = x_start + s
            y = y_bottom - s
            plat[y][x] = T_SLOPE_UR
            for fy in range(y + 1, bottom_fill_y + 1):
                plat[fy][x] = T_ROCK

    def add_stair_ramp_ul(x_start, y_bottom, steps, bottom_fill_y):
        """45-degree ramp rising right-to-left from (x_start, y_bottom) for `steps` tiles."""
        for s in range(steps):
            x = x_start - s
            y = y_bottom - s
            plat[y][x] = T_SLOPE_UL
            for fy in range(y + 1, bottom_fill_y + 1):
                plat[fy][x] = T_ROCK

    def place_bridge(x1, x2, y):
        for x in range(x1, x2 + 1):
            if x == x1:
                plat[y][x] = T_BRIDGE_L
            elif x == x2:
                plat[y][x] = T_BRIDGE_R
            else:
                plat[y][x] = T_BRIDGE_M

    def place_hook_pod(x1, y1, x2, y2):
        for y in range(y1, y2 + 1):
            for x in range(x1, x2 + 1):
                plat[y][x] = T_HOOK_A if (x + y) % 2 == 0 else T_HOOK_B

    # =========================================================================
    # 1. ENCLOSED SCULPTED CAVERN & FORTRESS ROOF (y=0..5 — Natural Rock Vaults!)
    # =========================================================================
    # Sculpted natural granite & icicle ceiling vaults across the top of the arena
    # with narrow alpine skylight shafts (x=18, 35..36, 53) and hanging stalactites!

    # Vault 1: Left Cavern Roof & Hanging Stalactite Tooth (x=0..17)
    fill_rock(0, 0, 17, 2, snow_top=False)
    fill_rock(4, 3, 13, 3, snow_top=False)
    fill_rock(7, 4, 10, 4, snow_top=False)  # Stalactite rib over Left Upper Gallery

    # Vault 2: Center-Left Arching Roof & Deep Stalactite Pillar (x=19..34)
    fill_rock(19, 0, 34, 2, snow_top=False)
    fill_rock(21, 3, 32, 3, snow_top=False)
    fill_rock(23, 4, 27, 5, snow_top=False)  # Deep hanging stalactite over Ziggurat gap

    # Central Apex Hanging Rock Keystone (x=35..36, y=1..4)
    fill_rock(35, 1, 36, 4, snow_top=True)

    # Vault 3: Center-Right Arching Roof & Deep Stalactite Pillar (x=37..52)
    fill_rock(37, 0, 52, 2, snow_top=False)
    fill_rock(39, 3, 50, 3, snow_top=False)
    fill_rock(44, 4, 48, 5, snow_top=False)  # Deep hanging stalactite over Right Archway

    # Vault 4: Right Cavern Roof & Hanging Stalactite Tooth (x=54..71)
    fill_rock(54, 0, 71, 2, snow_top=False)
    fill_rock(58, 3, 67, 3, snow_top=False)
    fill_rock(61, 4, 64, 4, snow_top=False)

    # =========================================================================
    # 2. OUTER CANYON CLIFF WALLS & LABYRINTH SIDE ALCOVES (x=0..1, x=70..71)
    # =========================================================================
    # Left Outer Wall (y=3..35, connected seamlessly to Vault 1!) with Fortress Alcove at y=16..18
    fill_rock(0, 3, 1, 35, snow_top=False)
    fill_rock(2, 16, 4, 18, snow_top=True)
    plat[16][5] = T_SLOPE_UL
    plat[17][5] = T_ROCK
    plat[18][5] = T_ROCK

    # Right Outer Wall (y=3..35, connected seamlessly to Vault 4!) with Fortress Alcove at y=14..16
    fill_rock(70, 3, 71, 35, snow_top=False)
    fill_rock(67, 14, 69, 16, snow_top=True)
    plat[14][66] = T_SLOPE_UR
    plat[15][66] = T_ROCK
    plat[16][66] = T_ROCK

    # =========================================================================
    # 3. LOWER FLOOR MASSIFS & CENTRAL "dm6" GLACIAL PIT (y=21..35)
    # =========================================================================
    # Left Ground Labyrinth Floor:
    #   High Terrace (x=2..8, y=22) -> Sunken Cavern Floor (x=9..19, y=25) ->
    #   Shoreline Tunnel Floor (x=20..29, y=26) -> Waterside Watchtower (x=26..29, y=23)
    fill_rock(2, 22, 8, 35, snow_top=True)
    fill_rock(9, 25, 19, 35, snow_top=True)
    add_stair_ramp_ul(11, 24, 3, 24)  # 3-tile 45° ramp from y=22 down to y=25

    fill_rock(20, 26, 29, 35, snow_top=True)
    add_stair_ramp_ul(20, 25, 1, 25)  # 1-tile 45° step from y=25 down to y=26

    # Left Waterside Watchtower Bastion (x=26..29, y=23..25)
    fill_rock(26, 23, 29, 25, snow_top=True)
    add_stair_ramp_ur(23, 25, 3, 25)  # 3-tile 45° ramp rising to Watchtower (y=23)

    # Right Ground Labyrinth Floor:
    #   Inner Cliff Bastion (x=42..47, y=21) -> Sunken Cavern Valley (x=48..61, y=25) ->
    #   Far-Right Fortress Terrace (x=62..69, y=22)
    fill_rock(42, 25, 69, 35, snow_top=True)
    fill_rock(42, 21, 47, 24, snow_top=True)
    add_stair_ramp_ul(51, 24, 4, 24)  # Long 4-tile 45° ski-ramp from y=21 down to y=25!

    fill_rock(63, 22, 69, 24, snow_top=True)
    add_stair_ramp_ur(60, 24, 3, 24)  # 3-tile 45° ramp rising to Right Terrace (y=22)

    # Central Glacial Water Pit (x=30..41, y=30..34) & Stepping Spire (x=34..37, y=24..27)
    fill_rock(30, 35, 41, 35, snow_top=False)
    for y in range(30, 35):
        for x in range(30, 42):
            if y == 30:
                water[y][x] = T_WATER_TOP
            else:
                water[y][x] = T_WATER_DEEP if (x + y) % 2 == 0 else T_WATER_ALT

    # Thick Sculpted Central Pit Pillar (x=34..37, y=24..27 — 4 tiles tall!)
    fill_rock(34, 24, 37, 27, snow_top=True)
    plat[24][34] = T_SLOPE_UR
    plat[24][37] = T_SLOPE_UL
    fill_rock(35, 28, 36, 28, snow_top=False)  # Deep rock root over the water

    place_bridge(30, 33, 23)
    place_bridge(38, 41, 21)

    # =========================================================================
    # 4. LARGE MULTI-SHAPED LABYRINTH STRUCTURES (Teeworlds dm1 / ctf2 style!)
    # =========================================================================

    # --- STRUCTURE A: Left Upper Gallery & Stepped Overhang (x=4..17, y=8..12) ---
    # An L-shaped / stepped upper deck creating an indoor tunnel below (y=13..24)
    # and an upper corridor above (y=4..9)!
    fill_rock(5, 10, 11, 12, snow_top=True)
    plat[10][4] = T_SLOPE_UR
    plat[11][4] = T_ROCK
    plat[12][4] = T_ROCK
    fill_rock(12, 8, 16, 12, snow_top=True)   # Thick 5-tile vertical bastion block!
    add_stair_ramp_ur(10, 9, 2, 9)            # 2-tile 45° ramp from y=10 up to y=8
    plat[8][17] = T_SLOPE_UL
    plat[9][17] = T_ROCK
    plat[10][17] = T_ROCK
    plat[11][17] = T_ROCK

    # --- STRUCTURE B: Left-Mid Cavern Bunker (x=10..18, y=18..20) ---
    # Sits inside the left basin, splitting the lower space into an Upper Cavern
    # (y=13..18) and a Sunken Under-Tunnel (y=21..25)!
    fill_rock(10, 18, 17, 20, snow_top=True)
    plat[18][18] = T_SLOPE_UL
    plat[19][18] = T_ROCK
    plat[20][18] = T_ROCK

    place_bridge(6, 9, 18)

    # --- STRUCTURE C: Center-Left Stepped Ziggurat Massif (x=21..29, y=13..19) ---
    # A massive 7-tile-tall pyramidal/stepped formation with two walkable tiers
    # (lower terrace at y=16, upper crown at y=13) and a deep cavern underside at y=19!
    fill_rock(21, 16, 29, 18, snow_top=True)
    plat[16][20] = T_SLOPE_UR
    plat[17][20] = T_ROCK
    plat[18][20] = T_ROCK
    fill_rock(24, 13, 28, 15, snow_top=True)  # Upper Crown of the Ziggurat (y=13)
    add_stair_ramp_ur(21, 15, 3, 15)          # 3-tile 45° ramp up the Ziggurat face!
    plat[13][29] = T_SLOPE_UL
    plat[14][29] = T_ROCK
    plat[15][29] = T_ROCK
    fill_rock(23, 19, 27, 19, snow_top=False) # Deep rock underbelly over shore tunnel

    place_bridge(18, 20, 9)

    # --- STRUCTURE D: Central Hourglass Citadel Core (x=32..39, y=10..16) ---
    # Massive 7-tile-thick central fortress core dividing the center into:
    #   - Upper Ceiling Tunnel (y=5..10)
    #   - Mid Citadel Bridges & Flanking Shafts (y=12..16)
    #   - Lower Chasm Vault (y=17..24)
    fill_rock(33, 10, 38, 15, snow_top=True)
    plat[10][32] = T_SLOPE_UR
    plat[11][32] = T_ROCK
    plat[12][32] = T_ROCK
    plat[13][32] = T_ROCK
    plat[14][32] = T_ROCK
    plat[10][39] = T_SLOPE_UL
    plat[11][39] = T_ROCK
    plat[12][39] = T_ROCK
    plat[13][39] = T_ROCK
    plat[14][39] = T_ROCK
    fill_rock(34, 16, 37, 16, snow_top=False) # Sculpted lower keel of the Citadel

    place_bridge(30, 31, 14)
    place_bridge(40, 41, 13)

    # --- STRUCTURE E: Center-Right Inverted-L Fortress Arch (x=42..51, y=12..17) ---
    # A huge asymmetric L-shaped rock formation with a high left deck (y=12),
    # a 45° ramp descending right to a lower deck (y=14), and a deep right pillar (y=12..17)!
    fill_rock(43, 12, 46, 15, snow_top=True)
    plat[12][42] = T_SLOPE_UR
    plat[13][42] = T_ROCK
    plat[14][42] = T_ROCK
    plat[15][42] = T_ROCK
    fill_rock(47, 14, 50, 17, snow_top=True)
    add_stair_ramp_ul(48, 13, 2, 13)          # 2-tile 45° ramp from y=12 down to y=14
    plat[14][51] = T_SLOPE_UL
    plat[15][51] = T_ROCK
    plat[16][51] = T_ROCK
    plat[17][51] = T_ROCK

    # --- STRUCTURE F: Right Upper Vaulted Gallery (x=53..65, y=8..11) ---
    # Long upper labyrinth hall beneath Vault 4, with stepped underside
    fill_rock(54, 8, 60, 10, snow_top=True)
    plat[8][53] = T_SLOPE_UR
    plat[9][53] = T_ROCK
    plat[10][53] = T_ROCK
    fill_rock(61, 10, 64, 11, snow_top=True)
    add_stair_ramp_ul(62, 9, 2, 9)            # 2-tile 45° ramp from y=8 down to y=10
    plat[10][65] = T_SLOPE_UL
    plat[11][65] = T_ROCK

    # --- STRUCTURE G: Right-Mid Cavern Bunker (x=54..62, y=17..19) ---
    # Creates a two-level cavern on the right side (upper hall y=11..17, lower cave y=20..25)
    fill_rock(55, 17, 61, 19, snow_top=True)
    plat[17][54] = T_SLOPE_UR
    plat[18][54] = T_ROCK
    plat[19][54] = T_ROCK
    plat[17][62] = T_SLOPE_UL
    plat[18][62] = T_ROCK
    plat[19][62] = T_ROCK

    place_bridge(63, 65, 15)

    # =========================================================================
    # 5. NATURAL ROCK GRAPPLE CRAGS (Sculpted snow-topped rock nodes for hook swings!)
    # =========================================================================
    # Left & Right Upper Shaft Rock Crags
    fill_rock(18, 5, 20, 6, snow_top=True)
    plat[5][18] = T_SLOPE_UR
    plat[5][20] = T_SLOPE_UL

    fill_rock(51, 5, 53, 6, snow_top=True)
    plat[5][51] = T_SLOPE_UR
    plat[5][53] = T_SLOPE_UL

    # Central Chasm Under-Citadel Rock Crag (above water abyss)
    fill_rock(35, 19, 36, 20, snow_top=True)

    # =========================================================================
    # 6. SPAWN POINTS (8 balanced points across upper tunnels, mid halls & caves)
    # =========================================================================
    def px(tx, ty_ground):
        return {
            "x": int(round((tx + 0.5) * TILE_SIZE)),
            "y": int(round(ty_ground * TILE_SIZE - 45)),
        }

    spawns = [
        px(5, 22),    # 1. Left Lower Terrace (y=22)
        px(14, 18),   # 2. Left-Mid Cavern Bunker Deck (y=18)
        px(8, 10),    # 3. Left Upper Gallery Hall (y=10)
        px(26, 13),   # 4. Center-Left Ziggurat Crown (y=13)
        px(35, 10),   # 5. Central Hourglass Citadel Top (y=10)
        px(45, 12),   # 6. Center-Right Fortress Arch (y=12)
        px(57, 8),    # 7. Right Upper Vaulted Gallery (y=8)
        px(58, 17),   # 8. Right-Mid Cavern Bunker Deck (y=17)
    ]

    # =========================================================================
    # 7. PICKUPS / POWERUPS (12 strategic points inside tunnels, vaults & pit)
    # =========================================================================
    def pickup_obj(idx, ptype, tx, ty_ground):
        return {
            "height": 0,
            "id": 100 + idx,
            "name": ptype,
            "point": True,
            "rotation": 0,
            "type": "",
            "visible": True,
            "width": 0,
            "x": int(round((tx + 0.5) * TILE_SIZE)),
            "y": int(round(ty_ground * TILE_SIZE - 38)),
        }

    pickups = [
        pickup_obj(1,  "shield",     35.5, 10),  # Central Citadel Upper Tunnel (y=10)
        pickup_obj(2,  "fire",       35.5, 24),  # Central Pit Pillar over water (y=24)
        pickup_obj(3,  "health",     14.0, 8),   # Left Upper Gallery Bastion (y=8)
        pickup_obj(4,  "doublejump", 14.5, 18),  # Left-Mid Cavern Bunker (y=18)
        pickup_obj(5,  "speed",      14.5, 25),  # Left Sunken Cavern Under-Tunnel (y=25)
        pickup_obj(6,  "fire",       26.0, 13),  # Center-Left Ziggurat Crown (y=13)
        pickup_obj(7,  "health",     27.5, 23),  # Left Waterside Watchtower (y=23)
        pickup_obj(8,  "fire",       45.0, 12),  # Center-Right Fortress Arch (y=12)
        pickup_obj(9,  "health",     45.0, 21),  # Right Inner Cliff Bastion (y=21)
        pickup_obj(10, "shield",     57.0, 8),   # Right Upper Vaulted Gallery (y=8)
        pickup_obj(11, "doublejump", 58.0, 17),  # Right-Mid Cavern Bunker (y=17)
        pickup_obj(12, "speed",      55.0, 25),  # Right Sunken Cavern Under-Tunnel (y=25)
    ]

    spawn_objects = [
        {
            "height": 0,
            "id": i + 1,
            "name": f"spawn_{i + 1}",
            "point": True,
            "rotation": 0,
            "type": "",
            "visible": True,
            "width": 0,
            "x": s["x"],
            "y": s["y"],
        }
        for i, s in enumerate(spawns)
    ]

    def flatten(grid):
        return [cell for row in grid for cell in row]

    # Build tileset metadata including 45-degree slope collision polygons
    # Local IDs are 0-based (gid - 1)
    slope_ur_id = T_SLOPE_UR - 1  # tundraHillLeft: (0,70) -> (70,0) -> (70,70)
    slope_ul_id = T_SLOPE_UL - 1  # tundraHillRight: (0,0) -> (70,70) -> (0,70)
    bridge_ids = {T_BRIDGE_L - 1, T_BRIDGE_M - 1, T_BRIDGE_R - 1}
    crystal_ids = {T_HOOK_A - 1, T_HOOK_B - 1}

    tiles_meta = []
    for i in range(len(TILE_NAMES)):
        mat = "rock"
        if i == slope_ur_id:
            mat = "slope_ur"
        elif i == slope_ul_id:
            mat = "slope_ul"
        elif i in bridge_ids:
            mat = "bridge"
        elif i in crystal_ids:
            mat = "crystal"

        entry = {
            "id": i,
            "properties": [
                {"name": "collides", "type": "bool", "value": True},
                {"name": "material", "type": "string", "value": mat},
            ],
        }
        if i == slope_ur_id:
            entry["objectgroup"] = {
                "draworder": "index",
                "name": "",
                "opacity": 1,
                "type": "objectgroup",
                "visible": True,
                "x": 0,
                "y": 0,
                "objects": [
                    {
                        "id": 1,
                        "name": "",
                        "type": "",
                        "x": 0,
                        "y": 0,
                        "width": 0,
                        "height": 0,
                        "rotation": 0,
                        "visible": True,
                        "polygon": [
                            {"x": 0, "y": 70},
                            {"x": 70, "y": 0},
                            {"x": 70, "y": 70},
                        ],
                    }
                ],
            }
        elif i == slope_ul_id:
            entry["objectgroup"] = {
                "draworder": "index",
                "name": "",
                "opacity": 1,
                "type": "objectgroup",
                "visible": True,
                "x": 0,
                "y": 0,
                "objects": [
                    {
                        "id": 2,
                        "name": "",
                        "type": "",
                        "x": 0,
                        "y": 0,
                        "width": 0,
                        "height": 0,
                        "rotation": 0,
                        "visible": True,
                        "polygon": [
                            {"x": 0, "y": 0},
                            {"x": 70, "y": 70},
                            {"x": 0, "y": 70},
                        ],
                    }
                ],
            }
        tiles_meta.append(entry)

    sheet_w = MARGIN * 2 + COLS * TILE_SIZE + (COLS - 1) * SPACING
    sheet_h = MARGIN * 2 + ROWS * TILE_SIZE + (ROWS - 1) * SPACING

    tiled_json = {
        "compressionlevel": -1,
        "height": H,
        "infinite": False,
        "layers": [
            {
                "data": flatten(bg),
                "height": H,
                "id": 1,
                "name": "background",
                "opacity": 1,
                "type": "tilelayer",
                "visible": True,
                "width": W,
                "x": 0,
                "y": 0,
            },
            {
                "data": flatten(water),
                "height": H,
                "id": 6,
                "name": "water",
                "opacity": 1,
                "type": "tilelayer",
                "visible": True,
                "width": W,
                "x": 0,
                "y": 0,
            },
            {
                "data": flatten(plat),
                "height": H,
                "id": 2,
                "name": "platforms",
                "opacity": 1,
                "type": "tilelayer",
                "visible": True,
                "width": W,
                "x": 0,
                "y": 0,
            },
            {
                "draworder": "topdown",
                "id": 3,
                "name": "spawns",
                "objects": spawn_objects,
                "opacity": 1,
                "type": "objectgroup",
                "visible": True,
                "x": 0,
                "y": 0,
            },
            {
                "draworder": "topdown",
                "id": 4,
                "name": "pickups",
                "objects": pickups,
                "opacity": 1,
                "type": "objectgroup",
                "visible": True,
                "x": 0,
                "y": 0,
            },
            {
                "data": flatten(trees),
                "height": H,
                "id": 5,
                "name": "trees",
                "opacity": 1,
                "type": "tilelayer",
                "visible": True,
                "width": W,
                "x": 0,
                "y": 0,
            },
        ],
        "nextlayerid": 7,
        "nextobjectid": 200,
        "orientation": "orthogonal",
        "renderorder": "right-down",
        "tiledversion": "1.11.0",
        "tileheight": TILE_SIZE,
        "tilesets": [
            {
                "columns": COLS,
                "firstgid": 1,
                "image": "../snow/sheet.png",
                "imageheight": sheet_h,
                "imagewidth": sheet_w,
                "margin": MARGIN,
                "name": "snow",
                "spacing": SPACING,
                "tilecount": len(TILE_NAMES),
                "tileheight": TILE_SIZE,
                "tilewidth": TILE_SIZE,
                "tiles": tiles_meta,
            }
        ],
        "tilewidth": TILE_SIZE,
        "type": "map",
        "version": "1.10",
        "width": W,
    }

    with open(OUT_MAP_PATH, "w", encoding="utf-8") as f:
        json.dump(tiled_json, f, indent=2)

    print(f"[generate_ice_arena] Wrote map: {OUT_MAP_PATH} ({W}x{H} tiles = {W*TILE_SIZE}x{H*TILE_SIZE} px)")


if __name__ == "__main__":
    build_spritesheet()
    build_arena_map()
