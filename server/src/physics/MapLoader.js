// Loads a Tiled JSON map and populates SimplePhysicsWorld + extracts spawns/pickups
import { readFileSync } from 'node:fs';

export function loadMap(path, world) {
    const json = JSON.parse(readFileSync(path, 'utf8'));
    const width = json.width;
    const height = json.height;
    const tileSize = json.tilewidth;

    world.tileSize = tileSize;
    world.gridWidth = width;
    world.gridHeight = height;
    world.tileGrid = [];
    for (let y = 0; y < height; y++) world.tileGrid[y] = new Array(width).fill(0);

    const tileset = json.tilesets[0];
    const firstgid = tileset.firstgid || 1;

    // Parse slope data from tileset embedded objects (Tiled "Tile Collision Editor")
    parseSlopeData(world, tileset);

    // Build collidable tile id set: any tile that has 'collides' property OR is in a slope
    const collidableLocalIds = new Set();
    if (tileset.tiles) {
        for (const t of tileset.tiles) {
            const localId = t.id;
            const props = t.properties || [];
            const collides = props.find(p => p.name === 'collides');
            const hasCollision = !!t.objectgroup?.objects?.length;
            if ((collides && collides.value === true) || hasCollision) {
                collidableLocalIds.add(localId);
            }
        }
    }
    // Fallback: treat all tiles in tileset as collidable if no metadata exists
    if (collidableLocalIds.size === 0 && tileset.tiles) {
        for (const t of tileset.tiles) collidableLocalIds.add(t.id);
    }

    // Find platforms layer
    const platformsLayer = json.layers.find(l => l.name === 'platforms' && l.type === 'tilelayer');
    if (!platformsLayer) throw new Error('platforms layer not found in map');

    let solidCount = 0;
    let slopeCount = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const gid = platformsLayer.data[y * width + x];
            if (gid === 0) continue;
            const localId = gid - firstgid;
            if (world.slopeHeights.has(localId)) {
                world.tileGrid[y][x] = localId;
                slopeCount++;
            } else if (collidableLocalIds.has(localId) || collidableLocalIds.size === 0) {
                world.tileGrid[y][x] = -1;
            }
            solidCount++;
        }
    }
    world.solidGrid = world.tileGrid;

    // Extract spawns
    const spawns = [];
    const spawnsLayer = json.layers.find(l => l.name === 'spawns' && l.type === 'objectgroup');
    if (spawnsLayer) {
        for (const o of spawnsLayer.objects) {
            spawns.push({ x: o.x, y: o.y });
        }
    }

    // Extract pickups
    const pickups = [];
    const pickupsLayer = json.layers.find(l => l.name === 'pickups' && l.type === 'objectgroup');
    if (pickupsLayer) {
        for (const o of pickupsLayer.objects) {
            pickups.push({ x: o.x, y: o.y, type: o.name || 'health' });
        }
    }

    console.log(`[MapLoader] ${width}x${height} tiles, solid=${solidCount}, slopes=${slopeCount}, spawns=${spawns.length}, pickups=${pickups.length}`);

    return { spawns, pickups, width, height, tileSize };
}

function parseSlopeData(world, tileset) {
    if (!tileset.tiles) return;
    for (const t of tileset.tiles) {
        const objects = t.objectgroup?.objects;
        if (!objects || objects.length === 0) continue;

        const obj = objects[0];
        const polygon = obj.polygon;
        if (!polygon || polygon.length < 3) continue;

        const vertices = polygon.map(p => ({
            x: obj.x + p.x,
            y: obj.y + p.y
        }));

        const ts = world.tileSize || tileset.tilewidth;
        const heights = new Float32Array(ts);
        for (let lx = 0; lx < ts; lx++) {
            heights[lx] = polygonGroundY(vertices, lx + 0.5, ts);
        }
        if (heights[0] > ts - 1) heights[0] = ts;
        if (heights[ts - 1] < 1) heights[ts - 1] = 0;
        if (heights[0] < 1) heights[0] = 0;
        if (heights[ts - 1] > ts - 1) heights[ts - 1] = ts;

        world.slopeHeights.set(t.id, heights);
    }
}

function polygonGroundY(vertices, localX, ts) {
    let minY = ts;
    for (let i = 0; i < vertices.length; i++) {
        const a = vertices[i];
        const b = vertices[(i + 1) % vertices.length];
        if ((a.x <= localX && b.x > localX) || (b.x <= localX && a.x > localX)) {
            const t = (localX - a.x) / (b.x - a.x);
            const y = a.y + t * (b.y - a.y);
            if (y < minY) minY = y;
        }
    }
    return Math.max(0, Math.min(ts, minY));
}
