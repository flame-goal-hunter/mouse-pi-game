// ============================================
// PLATFORM NAVIGATION - Graph-based pathfinding for platformer bots
// Builds a navigation graph from the tilemap where:
//   - Nodes = platforms (horizontal surface segments)
//   - Edges = traversal methods (walk, jump, fall, hook)
// Uses A* to find optimal paths between any two points
// ============================================

import { PHYS } from '../config.js';

export const EdgeType = {
    WALK: 'WALK',
    JUMP_ACROSS: 'JUMP_ACROSS',
    JUMP_UP: 'JUMP_UP',
    FALL: 'FALL',
    HOOK: 'HOOK'
};

class Platform {
    constructor(id, leftTileX, rightTileX, tileY, tileSize) {
        this.id = id;
        this.leftTileX = leftTileX;
        this.rightTileX = rightTileX;
        this.tileY = tileY;

        // World coordinates
        this.leftX = leftTileX * tileSize;
        this.rightX = (rightTileX + 1) * tileSize;
        this.surfaceY = tileY * tileSize; // top of the platform tile
        this.centerX = (this.leftX + this.rightX) / 2;
        this.width = this.rightX - this.leftX;
    }
}

class NavEdge {
    constructor(from, to, type, entryX, exitX, cost) {
        this.from = from;       // Platform id
        this.to = to;           // Platform id
        this.type = type;       // EdgeType
        this.entryX = entryX;   // World X to start action
        this.exitX = exitX;     // World X where we land
        this.cost = cost;
        this.hookTarget = null; // {x, y} for HOOK edges
    }
}

export class PlatformNav {
    constructor() {
        this.platforms = [];
        this.edges = [];
        this.adjacency = new Map(); // platformId -> NavEdge[]
        this.tileSize = 70;
    }

    build(platformLayer, mapWidth, mapHeight, tileSize, waterY = null) {
        this.tileSize = tileSize;
        this.waterY = waterY;
        this.platforms = this._buildPlatforms(platformLayer, mapWidth, mapHeight, tileSize);
        // Only auto-generate WALK edges; JUMP/FALL/HOOK loaded from Tiled via loadManualEdges()
        this.edges = this._buildWalkEdges(this.platforms, tileSize);

        // Build adjacency list
        this.adjacency.clear();
        for (const p of this.platforms) {
            this.adjacency.set(p.id, []);
        }
        for (const edge of this.edges) {
            this.adjacency.get(edge.from).push(edge);
        }
    }

    // ==========================================
    // STEP 1: Find all platforms
    // ==========================================

    _buildPlatforms(platformLayer, mapWidth, mapHeight, T) {
        const surfaces = [];

        for (let y = 0; y < mapHeight; y++) {
            for (let x = 0; x < mapWidth; x++) {
                const tile = platformLayer.getTileAt(x, y);
                if (!tile || tile.index <= 0) continue;

                // Surface tile = solid with empty above
                const above = y > 0 ? platformLayer.getTileAt(x, y - 1) : null;
                if (above && above.index > 0) continue;

                surfaces.push({ tileX: x, tileY: y });
            }
        }

        // Sort by Y then X for grouping
        surfaces.sort((a, b) => a.tileY - b.tileY || a.tileX - b.tileX);

        // Group into horizontal segments
        const platforms = [];
        let current = null;

        for (const s of surfaces) {
            if (current && s.tileY === current.tileY && s.tileX === current.rightTileX + 1) {
                current.rightTileX = s.tileX;
            } else {
                if (current) platforms.push(new Platform(platforms.length, current.leftTileX, current.rightTileX, current.tileY, T));
                current = { leftTileX: s.tileX, rightTileX: s.tileX, tileY: s.tileY };
            }
        }
        if (current) platforms.push(new Platform(platforms.length, current.leftTileX, current.rightTileX, current.tileY, T));

        return platforms;
    }

    // ==========================================
    // STEP 2a: Auto-generate WALK edges only
    // ==========================================

    _buildWalkEdges(platforms, T) {
        const edges = [];

        for (let i = 0; i < platforms.length; i++) {
            for (let j = 0; j < platforms.length; j++) {
                if (i === j) continue;

                const from = platforms[i];
                const to = platforms[j];

                const dyTiles = from.tileY - to.tileY;
                const gapRight = to.leftTileX - from.rightTileX - 1;
                const gapLeft = from.leftTileX - to.rightTileX - 1;
                const gap = Math.max(gapRight, gapLeft);
                const targetIsRight = to.centerX > from.centerX;

                // WALK: same height, gap <= 1
                if (dyTiles === 0 && gap <= 1) {
                    const entryX = targetIsRight ? from.rightX - T * 0.5 : from.leftX + T * 0.5;
                    const exitX = targetIsRight ? to.leftX + T * 0.5 : to.rightX - T * 0.5;
                    const dist = Math.abs(from.centerX - to.centerX);
                    edges.push(new NavEdge(i, j, EdgeType.WALK, entryX, exitX, dist));
                }
            }
        }

        return edges;
    }

    // ==========================================
    // STEP 2b: Load manual edges from Tiled object layer
    // ==========================================

    loadManualEdges(objects) {
        const TYPE_MAP = {
            'JUMP': null,          // resolved by dy
            'FALL': EdgeType.FALL,
            'HOOK': EdgeType.HOOK
        };
        const COST_MULT = {
            [EdgeType.JUMP_ACROSS]: 1.5,
            [EdgeType.JUMP_UP]: 2.0,
            [EdgeType.FALL]: 1.2,
            [EdgeType.HOOK]: 2.0
        };

        for (const obj of objects) {
            if (!obj.polyline || obj.polyline.length < 2) continue;

            const startX = obj.x + obj.polyline[0].x;
            const startY = obj.y + obj.polyline[0].y;
            const endX = obj.x + obj.polyline[1].x;
            const endY = obj.y + obj.polyline[1].y;

            // Find platforms at endpoints
            const fromPlatform = this.getPlatformAt(startX, startY);
            const toPlatform = this.getPlatformAt(endX, endY);
            if (!fromPlatform || !toPlatform || fromPlatform.id === toPlatform.id) {
                console.warn(`[Nav] Skipping object id=${obj.id} name="${obj.name || ''}": ` +
                    `from=${fromPlatform?.id ?? 'null'} to=${toPlatform?.id ?? 'null'} ` +
                    `(${startX.toFixed(0)},${startY.toFixed(0)})→(${endX.toFixed(0)},${endY.toFixed(0)})`);
                continue;
            }

            // Read custom properties
            const props = {};
            if (obj.properties) {
                for (const p of obj.properties) props[p.name] = p.value;
            }

            // Check built-in Tiled type/class field first, then custom property
            const typeStr = (props.type || obj.type || obj.class || '').toUpperCase();
            if (!TYPE_MAP.hasOwnProperty(typeStr)) {
                console.warn(`[Nav] Skipping object id=${obj.id} name="${obj.name || ''}": unknown type "${typeStr}"`);
                continue;
            }

            let edgeType = TYPE_MAP[typeStr];

            // JUMP → JUMP_UP or JUMP_ACROSS based on vertical direction
            if (typeStr === 'JUMP') {
                edgeType = (endY < startY) ? EdgeType.JUMP_UP : EdgeType.JUMP_ACROSS;
            }

            const bidirectional = props.bidirectional || false;

            // Create edge
            const dist = Math.hypot(endX - startX, endY - startY);
            const cost = dist * (COST_MULT[edgeType] || 1.5);

            const e = new NavEdge(fromPlatform.id, toPlatform.id, edgeType, startX, endX, cost);
            if (edgeType === EdgeType.HOOK) e.hookTarget = null;
            this.edges.push(e);
            this.adjacency.get(fromPlatform.id).push(e);

            // Reverse edge
            if (bidirectional) {
                let revType = edgeType;
                if (edgeType === EdgeType.FALL) revType = EdgeType.JUMP_UP;
                else if (edgeType === EdgeType.JUMP_UP) revType = EdgeType.FALL;

                const revCost = dist * (COST_MULT[revType] || 1.5);
                const eRev = new NavEdge(toPlatform.id, fromPlatform.id, revType, endX, startX, revCost);
                if (revType === EdgeType.HOOK) eRev.hookTarget = null;
                this.edges.push(eRev);
                this.adjacency.get(toPlatform.id).push(eRev);
            }
        }
    }

    // ==========================================
    // STEP 2 (legacy): Full auto navigation graph (unused, kept for reference)
    // ==========================================

    _buildNavGraph(platforms, T, platformLayer) {
        const edges = [];
        const JUMP_H = 2.5;   // max jump height in tiles
        const JUMP_D = 5;     // max jump distance in tiles (was 4, bot can do ~5 with momentum)
        const MAX_FALL = 20;  // max fall distance in tiles

        for (let i = 0; i < platforms.length; i++) {
            for (let j = 0; j < platforms.length; j++) {
                if (i === j) continue;

                const from = platforms[i];
                const to = platforms[j];

                // Vertical difference in tiles (positive = target is ABOVE, i.e. lower tileY)
                const dyTiles = from.tileY - to.tileY;
                const absDy = Math.abs(dyTiles);

                // Horizontal gap
                const gapRight = to.leftTileX - from.rightTileX - 1; // gap if target is to the right
                const gapLeft = from.leftTileX - to.rightTileX - 1;  // gap if target is to the left
                const gap = Math.max(gapRight, gapLeft);
                const hasOverlap = to.rightTileX >= from.leftTileX && to.leftTileX <= from.rightTileX;

                // Determine which side target is on
                const targetIsRight = to.centerX > from.centerX;

                // --- WALK: same height, gap <= 1 ---
                if (dyTiles === 0 && gap <= 1) {
                    const entryX = targetIsRight ? from.rightX - T * 0.5 : from.leftX + T * 0.5;
                    const exitX = targetIsRight ? to.leftX + T * 0.5 : to.rightX - T * 0.5;
                    const dist = Math.abs(from.centerX - to.centerX);
                    edges.push(new NavEdge(i, j, EdgeType.WALK, entryX, exitX, dist));
                    continue;
                }

                // --- JUMP_ACROSS: gap 1-5 tiles, height diff <= 2 tiles ---
                if (gap >= 1 && gap <= JUMP_D && absDy <= 2) {
                    const entryX = targetIsRight
                        ? from.rightX - T * 0.3
                        : from.leftX + T * 0.3;
                    const exitX = targetIsRight
                        ? to.leftX + T * 0.5
                        : to.rightX - T * 0.5;
                    const dist = Math.hypot(Math.abs(entryX - exitX), absDy * T);
                    const costMult = absDy <= 1 ? 1.5 : 2.5;
                    edges.push(new NavEdge(i, j, EdgeType.JUMP_ACROSS, entryX, exitX, dist * costMult));
                    // No continue — let HOOK also be evaluated as alternative
                }

                // --- JUMP_UP: target 1-2.5 tiles higher, overlap or small gap ---
                if (dyTiles > 0 && dyTiles <= JUMP_H && (hasOverlap || gap <= 3)) {
                    let entryX, exitX;
                    if (hasOverlap) {
                        // Jump straight up — pick overlapping X
                        const overlapLeft = Math.max(from.leftTileX, to.leftTileX);
                        const overlapRight = Math.min(from.rightTileX, to.rightTileX);
                        const midX = ((overlapLeft + overlapRight) / 2 + 0.5) * T;
                        entryX = midX;
                        exitX = midX;
                    } else {
                        entryX = targetIsRight ? from.rightX - T * 0.3 : from.leftX + T * 0.3;
                        exitX = targetIsRight ? to.leftX + T * 0.5 : to.rightX - T * 0.5;
                    }
                    const dist = Math.hypot(Math.abs(entryX - exitX), dyTiles * T);
                    edges.push(new NavEdge(i, j, EdgeType.JUMP_UP, entryX, exitX, dist * 2));
                    // No continue — let HOOK also be evaluated as alternative
                }

                // --- FALL: target is below, overlap or small gap ---
                if (dyTiles < 0 && absDy <= MAX_FALL && (hasOverlap || gap <= 2)) {
                    // Skip if target platform is at/below water level
                    if (this.waterY && to.surfaceY >= this.waterY - T) continue;
                    let entryX;
                    if (hasOverlap) {
                        // Walk to nearest edge of upper platform, then fall + air-control
                        const distToLeft = Math.abs(from.leftX - to.centerX);
                        const distToRight = Math.abs(from.rightX - to.centerX);
                        entryX = distToLeft < distToRight ? from.leftX + T * 0.3 : from.rightX - T * 0.3;
                    } else {
                        entryX = targetIsRight ? from.rightX : from.leftX;
                    }
                    const exitX = Math.max(to.leftX + T * 0.5, Math.min(to.rightX - T * 0.5, entryX));
                    // LOS check: no intermediate ceiling between platforms
                    if (!this._hasLineOfSight(platformLayer, entryX, from.surfaceY - T * 0.5, exitX, to.surfaceY - T * 0.5, T)) continue;
                    const dist = absDy * T;
                    edges.push(new NavEdge(i, j, EdgeType.FALL, entryX, exitX, dist * 1.2));
                    continue;
                }

                // --- HOOK: any pair within hook range (independent of JUMP edges) ---
                {
                    const worldGap = gap > 0 ? gap * T : 0;
                    const worldDy = Math.abs(dyTiles) * T;
                    const worldDist = Math.hypot(worldGap, worldDy);
                    const withinHook = worldDist < PHYS.HOOK_RANGE * 0.95;

                    if (withinHook) {
                        const entryX = targetIsRight ? from.rightX - T * 0.3 : from.leftX + T * 0.3;
                        const exitX = hasOverlap
                            ? Math.max(to.leftX + T * 0.5, Math.min(to.rightX - T * 0.5, entryX))
                            : (targetIsRight ? to.leftX + T * 0.5 : to.rightX - T * 0.5);

                        // LOS check: straight line at character height
                        let hasLOS = this._hasLineOfSight(platformLayer, entryX, from.surfaceY - T, exitX, to.surfaceY - T, T);

                        // If straight LOS fails and there's vertical difference — try arc path
                        if (!hasLOS && Math.abs(dyTiles) > 1) {
                            const midX = (entryX + exitX) / 2;
                            const topY = Math.min(from.surfaceY, to.surfaceY) - T * 2;
                            hasLOS = this._hasLineOfSight(platformLayer, entryX, from.surfaceY - T, midX, topY, T)
                                  && this._hasLineOfSight(platformLayer, midX, topY, exitX, to.surfaceY - T, T);
                        }

                        if (hasLOS) {
                            // Direction-based cost: A* prefers JUMP/FALL when available
                            let hookCost;
                            if (dyTiles > JUMP_H) hookCost = 2.5;    // high up — expensive
                            else if (dyTiles < -1) hookCost = 3.0;   // down+far — prefer FALL
                            else hookCost = 2.0;                       // horizontal or slightly up

                            const e = new NavEdge(i, j, EdgeType.HOOK, entryX, exitX, worldDist * hookCost);
                            e.hookTarget = null;
                            edges.push(e);
                        }
                    }
                }
            }
        }

        return edges;
    }

    // ==========================================
    // LOS check: raycast between two world points
    // ==========================================

    _hasLineOfSight(platformLayer, x1, y1, x2, y2, T) {
        if (!platformLayer) return true;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.hypot(dx, dy);
        const steps = Math.ceil(dist / (T * 0.5));
        for (let s = 1; s < steps; s++) {
            const t = s / steps;
            const cx = x1 + dx * t;
            const cy = y1 + dy * t;
            const tile = platformLayer.getTileAtWorldXY(cx, cy);
            if (tile && tile.index > 0) return false;
        }
        return true;
    }

    // ==========================================
    // STEP 3: Find which platform a point is on
    // ==========================================

    getPlatformAt(worldX, worldY) {
        const T = this.tileSize;
        const tileX = Math.floor(worldX / T);

        // First pass: find platforms where character is standing on (within 2 tiles above surface)
        let best = null;
        let bestDist = Infinity;

        for (const p of this.platforms) {
            // X must be within platform bounds (1 tile margin)
            if (tileX < p.leftTileX - 1 || tileX > p.rightTileX + 1) continue;

            // Character Y should be above the surface (standing on it)
            const charTileY = Math.floor(worldY / T);
            const tileDiff = p.tileY - charTileY; // positive = platform below character

            // Character stands on top of platform: charTileY should be tileY-1 (or close)
            if (tileDiff >= 0 && tileDiff <= 2) {
                if (tileDiff < bestDist) {
                    bestDist = tileDiff;
                    best = p;
                }
            }
        }

        if (best) return best;

        // Fallback: nearest platform by world distance
        bestDist = Infinity;
        for (const p of this.platforms) {
            const clampedX = Math.max(p.leftX, Math.min(p.rightX, worldX));
            const dist = Math.hypot(clampedX - worldX, p.surfaceY - worldY);
            if (dist < bestDist) {
                bestDist = dist;
                best = p;
            }
        }

        return best;
    }

    // ==========================================
    // STEP 4: A* pathfinding on platform graph
    // ==========================================

    findPath(fromX, fromY, toX, toY) {
        const startPlatform = this.getPlatformAt(fromX, fromY);
        const endPlatform = this.getPlatformAt(toX, toY);

        if (!startPlatform || !endPlatform) return null;

        if (startPlatform.id === endPlatform.id) {
            // Same platform — just walk
            return [{ edge: null, platform: endPlatform, targetX: toX }];
        }

        // A*
        const openSet = new Set([startPlatform.id]);
        const cameFrom = new Map();   // id -> { edge, fromId }
        const gScore = new Map();
        const fScore = new Map();

        gScore.set(startPlatform.id, 0);
        fScore.set(startPlatform.id, this._heuristic(startPlatform, endPlatform));

        while (openSet.size > 0) {
            // Find lowest fScore in open set
            let current = null;
            let currentF = Infinity;
            for (const id of openSet) {
                const f = fScore.get(id) ?? Infinity;
                if (f < currentF) {
                    currentF = f;
                    current = id;
                }
            }

            if (current === endPlatform.id) {
                return this._reconstructPath(cameFrom, current, toX);
            }

            openSet.delete(current);
            const neighbors = this.adjacency.get(current) || [];

            for (const edge of neighbors) {
                const tentativeG = (gScore.get(current) ?? Infinity) + edge.cost;
                const prevG = gScore.get(edge.to) ?? Infinity;

                if (tentativeG < prevG) {
                    cameFrom.set(edge.to, { edge, fromId: current });
                    gScore.set(edge.to, tentativeG);
                    fScore.set(edge.to, tentativeG + this._heuristic(this.platforms[edge.to], endPlatform));
                    openSet.add(edge.to);
                }
            }
        }

        return null; // No path found
    }

    _heuristic(from, to) {
        return Math.hypot(from.centerX - to.centerX, from.surfaceY - to.surfaceY);
    }

    _reconstructPath(cameFrom, currentId, finalTargetX) {
        const path = [];
        let id = currentId;

        while (cameFrom.has(id)) {
            const { edge } = cameFrom.get(id);
            path.unshift({
                edge: edge,
                platform: this.platforms[edge.to],
                targetX: edge.exitX
            });
            id = edge.from;
        }

        // Override last segment target to actual destination
        if (path.length > 0) {
            path[path.length - 1].targetX = finalTargetX;
        }

        return path;
    }
}
