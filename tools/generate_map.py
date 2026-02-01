#!/usr/bin/env python3
"""
Generate ice-arena.json map for Mousie Pi snowball game
Map size: 100x75 tiles (7000x5250 pixels)
Tile size: 70x70 pixels

Based on visual analysis of www/assets/ice/sheet.png (14x7 grid = 98 tiles)
"""

import json
import random

# Map dimensions
WIDTH = 100
HEIGHT = 75
TILE_SIZE = 70

# =============================================================================
# TILE IDs from sheet.png (14 columns x 7 rows, firstgid=1)
# =============================================================================

# Row 0 (ID 1-14): Snow platforms
SNOW_LEFT = 1          # Platform left edge with chevron
SNOW_MID = 2           # Platform middle with chevron
SNOW_RIGHT = 3         # Platform right edge with chevron
SNOW_HILL = 4          # Hill shape
SNOW_SMALL = 5         # Small snow piece
SNOW_LARGE = 6         # Large chevron block
SNOW_GROUND_1 = 7      # Ground piece 1
SNOW_GROUND_2 = 8      # Ground piece 2
SNOW_GROUND_3 = 9      # Ground piece 3
ICE_TOP = 10           # Ice with dark top
ICE_SOLID = 11         # Solid ice block
ICE_VARIANT = 12       # Ice variant
SNOWBALL_SMALL = 13    # Small snowball decoration
SNOWBALL_BIG = 14      # Big snowball decoration

# Row 1 (ID 15-28): Large platforms, ice blocks
ICE_CURVE = 15         # Ice with curved bottom
ICE_PLAT_LEFT = 16     # Large platform left
ICE_PLAT_MID = 17      # Large platform middle (chevron)
ICE_PLAT_RIGHT = 18    # Large platform right
ICE_CLIFF_L = 19       # Ice cliff left
ICE_CLIFF_R = 20       # Ice cliff right
ICE_BLOCK = 21         # Plain ice block
ICE_BLOCK_2 = 22       # Ice block variant
ICE_BLOCK_3 = 23       # Ice block variant
WATER_DARK = 24        # Dark water block
WATER_DARK_2 = 25      # Dark water variant
ICE_SHINE = 26         # Ice with shine
EMPTY_27 = 27          # Empty/transparent
EMPTY_28 = 28          # Empty/transparent

# Row 2 (ID 29-42): Icicles
ICICLE_ROW = 29        # Row of icicles
ICICLE_SMALL = 30      # Small icicles
ICICLE_MED = 31        # Medium icicles
ICICLE_SINGLE = 32     # Single icicle
# 33-42: More icicle variants (mostly empty)

# Row 3 (ID 43-56): Plants, trunks, water, igloo
PLANT_BLUE = 43        # Blue plant
PLANT_CYAN = 44        # Cyan plant
STUMP_LEFT = 45        # Tree stump left
STUMP_RIGHT = 46       # Tree stump right
TRUNK_BRANCH = 47      # Trunk with branches
TRUNK_PLAIN = 48       # Plain trunk
TRUNK_LEFT = 49        # Trunk with left branch
WATER_SURFACE = 50     # Water surface (waves)
WATER_MID = 51         # Water middle depth
WATER_DEEP = 52        # Water deep
IGLOO = 53             # Full igloo with door
# 54-56: Empty or more water

# Row 4 (ID 57-70): Tree parts, candy canes
TREE_TOP_GREEN = 57    # Green tree top
TREE_MID_GREEN = 58    # Green tree middle
TREE_TOP_SNOW = 59     # Snowy tree top
TREE_TRUNK = 60        # Vertical trunk
TREE_TRUNK_BARK = 61   # Trunk with bark detail
CANDY_RED_1 = 62       # Candy cane red part
CANDY_RED_2 = 63       # Candy cane red part 2
CANDY_GREEN_1 = 64     # Candy cane green part
CANDY_GREEN_2 = 65     # Candy cane green part 2
# 66-70: More candy pieces

# Row 5 (ID 71-84): Decorations, hills, pines
DECOR_GRASS = 71       # Small grass
ROCK = 72              # Rock
ROCK_ALT = 73          # Rock variant
HILL_LEFT = 74         # Green hill left
HILL_MID = 75          # Green hill middle
HILL_RIGHT = 76        # Green hill right
PINE_LARGE = 77        # Large pine tree
PINE_MED = 78          # Medium pine tree
PINE_SMALL = 79        # Small pine tree
# 80-84: More pines

# Row 6 (ID 85-98): More pine trees
PINE_VAR_1 = 85
PINE_VAR_2 = 86
PINE_VAR_3 = 87
# 88-98: More variants


def create_empty_layer(width, height):
    """Create empty tile data array"""
    return [0] * (width * height)


def set_tile(data, x, y, tile_id, width=WIDTH):
    """Set tile at position"""
    if 0 <= x < width and 0 <= y < HEIGHT:
        data[y * width + x] = tile_id


def get_tile(data, x, y, width=WIDTH):
    """Get tile at position"""
    if 0 <= x < width and 0 <= y < HEIGHT:
        return data[y * width + x]
    return 0


def draw_platform(data, x, y, length, fill_depth=2):
    """Draw a snow platform with ice fill underneath"""
    if length < 1:
        return

    # Snow top layer
    if length == 1:
        set_tile(data, x, y, SNOW_MID)
    elif length == 2:
        set_tile(data, x, y, SNOW_LEFT)
        set_tile(data, x + 1, y, SNOW_RIGHT)
    else:
        set_tile(data, x, y, SNOW_LEFT)
        for i in range(1, length - 1):
            set_tile(data, x + i, y, SNOW_MID)
        set_tile(data, x + length - 1, y, SNOW_RIGHT)

    # Ice block fill underneath
    for dy in range(1, fill_depth + 1):
        if y + dy < HEIGHT:
            for i in range(length):
                set_tile(data, x + i, y + dy, ICE_BLOCK)


def draw_thin_platform(data, x, y, length):
    """Draw a thin platform (no fill underneath)"""
    draw_platform(data, x, y, length, fill_depth=0)


def draw_pine_tree(data, x, y, size='medium'):
    """Draw a pine tree at position (y is the ground level)"""
    if size == 'large':
        set_tile(data, x, y - 1, PINE_LARGE)
    elif size == 'medium':
        set_tile(data, x, y - 1, PINE_MED)
    else:
        set_tile(data, x, y - 1, PINE_SMALL)


def draw_water(data, start_y, width, height):
    """Draw water at bottom of map (3 layers)"""
    for y in range(start_y, height):
        layer_depth = y - start_y
        for x in range(width):
            if layer_depth == 0:
                tile = WATER_SURFACE
            elif layer_depth == 1:
                tile = WATER_MID
            else:
                tile = WATER_DEEP
            set_tile(data, x, y, tile, width)


def add_decorations(data, ground_y):
    """Add random decorations near ground level"""
    # Rocks
    for _ in range(25):
        x = random.randint(0, WIDTH - 1)
        if get_tile(data, x, ground_y - 1) == 0:
            set_tile(data, x, ground_y - 1, ROCK if random.random() > 0.5 else ROCK_ALT)

    # Snowballs
    for _ in range(20):
        x = random.randint(0, WIDTH - 1)
        if get_tile(data, x, ground_y - 1) == 0:
            set_tile(data, x, ground_y - 1, SNOWBALL_SMALL if random.random() > 0.5 else SNOWBALL_BIG)

    # Plants
    for _ in range(15):
        x = random.randint(0, WIDTH - 1)
        if get_tile(data, x, ground_y - 1) == 0:
            set_tile(data, x, ground_y - 1, PLANT_BLUE if random.random() > 0.5 else PLANT_CYAN)


def generate_map():
    """Generate the complete map with beautiful terrain"""
    # Create layers
    background = create_empty_layer(WIDTH, HEIGHT)
    platforms = create_empty_layer(WIDTH, HEIGHT)

    # ==========================================================================
    # GROUND LEVEL (y = 70-74)
    # ==========================================================================
    ground_y = 70

    # Main ground - full width snow platform
    draw_platform(platforms, 0, ground_y, WIDTH, fill_depth=2)

    # Water at bottom (3 rows)
    draw_water(platforms, ground_y + 3, WIDTH, HEIGHT)

    # ==========================================================================
    # PLATFORMS - Multiple levels with varying layouts
    # ==========================================================================

    # Level 1 (y = 62) - Wide, easy to reach
    draw_platform(platforms, 3, 62, 18)
    draw_platform(platforms, 35, 62, 25)
    draw_platform(platforms, 78, 62, 18)

    # Level 2 (y = 54) - Medium platforms
    draw_platform(platforms, 8, 54, 14)
    draw_platform(platforms, 28, 54, 16)
    draw_platform(platforms, 52, 54, 14)
    draw_platform(platforms, 72, 54, 16)

    # Level 3 (y = 46) - Scattered
    draw_platform(platforms, 0, 46, 10)
    draw_platform(platforms, 18, 46, 12)
    draw_platform(platforms, 40, 46, 14)
    draw_platform(platforms, 62, 46, 12)
    draw_platform(platforms, 85, 46, 12)

    # Level 4 (y = 38) - More spacing
    draw_platform(platforms, 5, 38, 12)
    draw_platform(platforms, 30, 38, 14)
    draw_platform(platforms, 55, 38, 12)
    draw_platform(platforms, 78, 38, 14)

    # Level 5 (y = 30) - Higher, harder
    draw_platform(platforms, 12, 30, 10)
    draw_platform(platforms, 38, 30, 18)
    draw_platform(platforms, 70, 30, 10)

    # Level 6 (y = 22) - Thin platforms
    draw_thin_platform(platforms, 22, 22, 8)
    draw_thin_platform(platforms, 45, 22, 10)
    draw_thin_platform(platforms, 68, 22, 8)

    # Level 7 (y = 14) - High
    draw_platform(platforms, 30, 14, 12)
    draw_platform(platforms, 55, 14, 12)

    # Level 8 (y = 6) - Top platforms
    draw_platform(platforms, 38, 6, 8)
    draw_platform(platforms, 52, 6, 8)

    # ==========================================================================
    # BACKGROUND DECORATIONS
    # ==========================================================================

    # Pine trees on ground
    tree_positions = [5, 15, 25, 35, 50, 60, 75, 85, 95]
    for x in tree_positions:
        size = random.choice(['large', 'medium', 'small'])
        draw_pine_tree(background, x, ground_y, size)

    # Small trees on lower platforms
    platform_tree_spots = [(10, 61), (45, 61), (85, 61), (32, 53), (75, 53)]
    for x, y in platform_tree_spots:
        if random.random() > 0.3:
            draw_pine_tree(background, x, y, 'small')

    # Igloos on ground
    set_tile(background, 20, ground_y - 1, IGLOO)
    set_tile(background, 80, ground_y - 1, IGLOO)

    # Add random decorations
    add_decorations(background, ground_y)

    # ==========================================================================
    # SPAWN POINTS
    # ==========================================================================
    spawns = [
        {"id": 1, "name": "spawn1", "x": 12 * TILE_SIZE, "y": (ground_y - 1) * TILE_SIZE},
        {"id": 2, "name": "spawn2", "x": 88 * TILE_SIZE, "y": (ground_y - 1) * TILE_SIZE},
        {"id": 3, "name": "spawn3", "x": 40 * TILE_SIZE, "y": 52 * TILE_SIZE},
        {"id": 4, "name": "spawn4", "x": 60 * TILE_SIZE, "y": 52 * TILE_SIZE},
    ]

    # ==========================================================================
    # BUILD MAP JSON
    # ==========================================================================
    map_data = {
        "compressionlevel": -1,
        "height": HEIGHT,
        "infinite": False,
        "layers": [
            {
                "data": background,
                "height": HEIGHT,
                "id": 1,
                "name": "background",
                "opacity": 1,
                "type": "tilelayer",
                "visible": True,
                "width": WIDTH,
                "x": 0,
                "y": 0
            },
            {
                "data": platforms,
                "height": HEIGHT,
                "id": 2,
                "name": "platforms",
                "opacity": 1,
                "type": "tilelayer",
                "visible": True,
                "width": WIDTH,
                "x": 0,
                "y": 0
            },
            {
                "draworder": "topdown",
                "id": 3,
                "name": "spawns",
                "objects": [
                    {
                        "height": 0,
                        "id": s["id"],
                        "name": s["name"],
                        "point": True,
                        "rotation": 0,
                        "type": "",
                        "visible": True,
                        "width": 0,
                        "x": s["x"],
                        "y": s["y"]
                    } for s in spawns
                ],
                "opacity": 1,
                "type": "objectgroup",
                "visible": True,
                "x": 0,
                "y": 0
            }
        ],
        "nextlayerid": 4,
        "nextobjectid": 5,
        "orientation": "orthogonal",
        "renderorder": "right-down",
        "tiledversion": "1.10.2",
        "tileheight": TILE_SIZE,
        "tilesets": [
            {
                "columns": 14,
                "firstgid": 1,
                "image": "../ice/sheet.png",
                "imageheight": 490,
                "imagewidth": 980,
                "margin": 0,
                "name": "ice",
                "spacing": 0,
                "tilecount": 98,
                "tileheight": TILE_SIZE,
                "tilewidth": TILE_SIZE
            }
        ],
        "tilewidth": TILE_SIZE,
        "type": "map",
        "version": "1.10",
        "width": WIDTH
    }

    return map_data


if __name__ == "__main__":
    import os

    # Generate the map
    map_data = generate_map()

    # Output path
    output_path = os.path.join(os.path.dirname(__file__), "..", "www", "assets", "maps", "ice-arena.json")

    # Write to file
    with open(output_path, "w") as f:
        json.dump(map_data, f, indent=1)

    print(f"Generated map: {WIDTH}x{HEIGHT} tiles ({WIDTH * TILE_SIZE}x{HEIGHT * TILE_SIZE} pixels)")
    print(f"Saved to: {output_path}")
