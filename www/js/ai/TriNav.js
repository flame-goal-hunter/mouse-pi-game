// ============================================
// TRINAV — Tile-grid navigation (bMod-style)
// Free-space pathfinding with A* + string-pulling + LOS waypoints
// ============================================

import { TILE_SIZE } from '../config.js';

// Binary heap for A* open set
class MinHeap {
    constructor() { this.data = []; }
    push(node) {
        this.data.push(node);
        this._bubbleUp(this.data.length - 1);
    }
    pop() {
        const top = this.data[0];
        const last = this.data.pop();
        if (this.data.length > 0) {
            this.data[0] = last;
            this._sinkDown(0);
        }
        return top;
    }
    get size() { return this.data.length; }
    _bubbleUp(i) {
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (this.data[i].f < this.data[p].f) {
                [this.data[i], this.data[p]] = [this.data[p], this.data[i]];
                i = p;
            } else break;
        }
    }
    _sinkDown(i) {
        const n = this.data.length;
        while (true) {
            let smallest = i;
            const l = 2 * i + 1, r = 2 * i + 2;
            if (l < n && this.data[l].f < this.data[smallest].f) smallest = l;
            if (r < n && this.data[r].f < this.data[smallest].f) smallest = r;
            if (smallest === i) break;
            [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]];
            i = smallest;
        }
    }
}

export class TriNav {
    constructor() {
        this.grid = null;       // raw grid: true = empty tile
        this.navGrid = null;    // after Minkowski expansion: true = walkable
        this.groundGrid = null; // true = walkable + has solid ground within 3 tiles below
        this.mapWidth = 0;
        this.mapHeight = 0;
        this.tileSize = TILE_SIZE;
        this.waterY = null;
    }

    /**
     * Build navigation grid from tilemap.
     */
    build(platformLayer, mapWidth, mapHeight, tileSize, waterY = null) {
        this.mapWidth = mapWidth;
        this.mapHeight = mapHeight;
        this.tileSize = tileSize;
        this.waterY = waterY;

        this._buildGrid(platformLayer, mapWidth, mapHeight, tileSize, waterY);
        this._buildNavGrid();
        this._buildGroundGrid();

        let walkable = 0, grounded = 0;
        for (let y = 0; y < mapHeight; y++)
            for (let x = 0; x < mapWidth; x++) {
                if (this.navGrid[y][x]) walkable++;
                if (this.groundGrid[y][x]) grounded++;
            }

        console.log(`[TriNav] Grid ${mapWidth}x${mapHeight}, walkable: ${walkable}, grounded: ${grounded}/${mapWidth * mapHeight}`);
    }

    /**
     * Find path between two world positions.
     * Returns [{x, y}] waypoints after string-pulling, or null.
     */
    findPath(fromX, fromY, toX, toY) {
        const start = this._worldToTile(fromX, fromY);
        const end = this._worldToTile(toX, toY);

        // Snap to nearest walkable if inside a wall
        const sStart = this._nearestWalkable(start.tx, start.ty);
        const sEnd = this._nearestWalkable(end.tx, end.ty);
        if (!sStart || !sEnd) return null;

        // Direct LOS? Skip A* (but only if vertical distance is small,
        // otherwise we need intermediate waypoints for platform traversal)
        const dyTiles = Math.abs(sStart.ty - sEnd.ty);
        if (dyTiles <= 3 && this._tileLOS(sStart.tx, sStart.ty, sEnd.tx, sEnd.ty)) {
            return [{ x: toX, y: toY }];
        }

        // A* on tile grid
        const tilePath = this._astar(sStart.tx, sStart.ty, sEnd.tx, sEnd.ty);
        if (!tilePath) return null;

        // String-pull to minimal waypoints
        const waypoints = this._stringPull(tilePath);

        // Override last waypoint to exact destination
        if (waypoints.length > 0) {
            waypoints[waypoints.length - 1] = { x: toX, y: toY };
        }

        return waypoints;
    }

    /**
     * Get farthest visible waypoint from a position.
     * Scans backwards from end of waypoint list.
     */
    getFarthestVisibleWaypoint(fromX, fromY, waypoints, startIndex = 0) {
        for (let i = waypoints.length - 1; i >= startIndex; i--) {
            if (this.hasLOS(fromX, fromY, waypoints[i].x, waypoints[i].y)) {
                return { waypoint: waypoints[i], index: i };
            }
        }
        // Fallback: return next waypoint even without LOS
        if (startIndex < waypoints.length) {
            return { waypoint: waypoints[startIndex], index: startIndex };
        }
        return null;
    }

    /**
     * World-space line-of-sight check using Bresenham on tile grid.
     */
    hasLOS(x1, y1, x2, y2) {
        const t1 = this._worldToTile(x1, y1);
        const t2 = this._worldToTile(x2, y2);
        return this._tileLOS(t1.tx, t1.ty, t2.tx, t2.ty);
    }

    // ==========================================
    // INTERNAL: Grid Building
    // ==========================================

    _buildGrid(platformLayer, mapWidth, mapHeight, tileSize, waterY) {
        this.grid = [];
        for (let y = 0; y < mapHeight; y++) {
            this.grid[y] = [];
            for (let x = 0; x < mapWidth; x++) {
                const tile = platformLayer.getTileAt(x, y);
                const isSolid = tile && tile.index > 0;
                const worldY = y * tileSize;
                const isUnderwater = waterY && worldY > waterY;
                this.grid[y][x] = !isSolid && !isUnderwater;
            }
        }
    }

    /**
     * Minkowski expansion: shrink walkable space by checking cardinal neighbors.
     * A tile is nav-walkable only if it and its 4 cardinal neighbors are all empty.
     * This ensures the character (~50px wide in a 70px tile) fits through any path.
     */
    _buildNavGrid() {
        const w = this.mapWidth;
        const h = this.mapHeight;
        this.navGrid = [];

        for (let y = 0; y < h; y++) {
            this.navGrid[y] = [];
            for (let x = 0; x < w; x++) {
                if (!this.grid[y][x]) {
                    this.navGrid[y][x] = false;
                    continue;
                }
                // Check cardinal neighbors (not diagonals — less aggressive)
                const up    = y > 0     ? this.grid[y - 1][x] : false;
                const down  = y < h - 1 ? this.grid[y + 1][x] : false;
                const left  = x > 0     ? this.grid[y][x - 1] : false;
                const right = x < w - 1 ? this.grid[y][x + 1] : false;

                this.navGrid[y][x] = up && down && left && right;
            }
        }
    }

    /**
     * Ground grid: true if walkable tile has solid ground within 3 tiles below.
     * Used for A* cost weighting — mid-air tiles get 4x penalty.
     */
    _buildGroundGrid() {
        const w = this.mapWidth;
        const h = this.mapHeight;
        this.groundGrid = [];

        for (let y = 0; y < h; y++) {
            this.groundGrid[y] = [];
            for (let x = 0; x < w; x++) {
                if (!this.navGrid[y][x]) {
                    this.groundGrid[y][x] = false;
                    continue;
                }
                let hasGround = false;
                for (let dy = 1; dy <= 3; dy++) {
                    if (y + dy >= h) break;
                    if (!this.grid[y + dy][x]) { // solid tile below
                        hasGround = true;
                        break;
                    }
                }
                this.groundGrid[y][x] = hasGround;
            }
        }
    }

    // ==========================================
    // INTERNAL: A* Pathfinding
    // ==========================================

    _astar(startTX, startTY, endTX, endTY) {
        const w = this.mapWidth;
        const h = this.mapHeight;
        const key = (x, y) => y * w + x;

        const gScore = new Map();
        const cameFrom = new Map();
        const open = new MinHeap();

        const startKey = key(startTX, startTY);
        gScore.set(startKey, 0);

        // Octile distance heuristic
        const heuristic = (x, y) => {
            const dx = Math.abs(x - endTX);
            const dy = Math.abs(y - endTY);
            return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
        };

        open.push({ tx: startTX, ty: startTY, f: heuristic(startTX, startTY) });

        // 8-directional neighbors
        const dirs = [
            { dx: 1, dy: 0, cost: 1 },
            { dx: -1, dy: 0, cost: 1 },
            { dx: 0, dy: 1, cost: 1 },
            { dx: 0, dy: -1, cost: 1 },
            { dx: 1, dy: 1, cost: Math.SQRT2 },
            { dx: -1, dy: 1, cost: Math.SQRT2 },
            { dx: 1, dy: -1, cost: Math.SQRT2 },
            { dx: -1, dy: -1, cost: Math.SQRT2 },
        ];

        const closed = new Set();

        while (open.size > 0) {
            const current = open.pop();
            const { tx, ty } = current;
            const ck = key(tx, ty);

            if (tx === endTX && ty === endTY) {
                // Reconstruct path
                const path = [];
                let k = ck;
                while (k !== undefined) {
                    const py = Math.floor(k / w);
                    const px = k % w;
                    path.push({ tx: px, ty: py });
                    k = cameFrom.get(k);
                }
                path.reverse();
                return path;
            }

            if (closed.has(ck)) continue;
            closed.add(ck);

            for (const d of dirs) {
                const nx = tx + d.dx;
                const ny = ty + d.dy;

                if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
                if (!this.navGrid[ny][nx]) continue;

                // Diagonal: prevent cutting through wall corners
                if (d.dx !== 0 && d.dy !== 0) {
                    if (!this.navGrid[ty][tx + d.dx] || !this.navGrid[ty + d.dy][tx]) continue;
                }

                const nk = key(nx, ny);
                if (closed.has(nk)) continue;

                // Penalize mid-air tiles (4x cost) so A* prefers ground paths
                const airPenalty = this.groundGrid[ny][nx] ? 1.0 : 4.0;
                const tentativeG = gScore.get(ck) + d.cost * airPenalty;
                const prevG = gScore.get(nk);

                if (prevG === undefined || tentativeG < prevG) {
                    gScore.set(nk, tentativeG);
                    cameFrom.set(nk, ck);
                    open.push({ tx: nx, ty: ny, f: tentativeG + heuristic(nx, ny) });
                }
            }
        }

        return null; // No path
    }

    // ==========================================
    // INTERNAL: String-Pulling (LOS path smoothing)
    // ==========================================

    _stringPull(tilePath) {
        if (tilePath.length <= 2) {
            return tilePath.map(t => this._tileToWorld(t.tx, t.ty));
        }

        const result = [];
        let current = 0;

        result.push(this._tileToWorld(tilePath[0].tx, tilePath[0].ty));

        while (current < tilePath.length - 1) {
            // Find farthest tile with clear LOS from current
            let farthest = current + 1;
            for (let i = tilePath.length - 1; i > current + 1; i--) {
                // Don't collapse path segments with large vertical distance
                // (preserves intermediate waypoints for platform climbing)
                const spDy = Math.abs(tilePath[current].ty - tilePath[i].ty);
                if (spDy > 3) continue;
                if (this._tileLOS(
                    tilePath[current].tx, tilePath[current].ty,
                    tilePath[i].tx, tilePath[i].ty
                )) {
                    farthest = i;
                    break;
                }
            }
            current = farthest;
            result.push(this._tileToWorld(tilePath[current].tx, tilePath[current].ty));
        }

        return result;
    }

    // ==========================================
    // INTERNAL: Line-of-Sight (Bresenham)
    // ==========================================

    /**
     * Tile-based LOS using Bresenham's line algorithm.
     * Returns false if any tile on the line is not walkable in navGrid.
     */
    _tileLOS(tx1, ty1, tx2, ty2) {
        let x = tx1, y = ty1;
        const dx = Math.abs(tx2 - tx1);
        const dy = Math.abs(ty2 - ty1);
        const sx = tx1 < tx2 ? 1 : -1;
        const sy = ty1 < ty2 ? 1 : -1;
        let err = dx - dy;

        while (true) {
            // Check bounds and walkability
            if (x < 0 || x >= this.mapWidth || y < 0 || y >= this.mapHeight) return false;
            if (!this.navGrid[y][x]) return false;

            if (x === tx2 && y === ty2) break;

            const e2 = 2 * err;
            if (e2 > -dy) {
                err -= dy;
                x += sx;
            }
            if (e2 < dx) {
                err += dx;
                y += sy;
            }
        }

        return true;
    }

    // ==========================================
    // INTERNAL: Coordinate Conversion
    // ==========================================

    _tileToWorld(tx, ty) {
        return {
            x: (tx + 0.5) * this.tileSize,
            y: (ty + 0.5) * this.tileSize
        };
    }

    _worldToTile(wx, wy) {
        return {
            tx: Math.floor(wx / this.tileSize),
            ty: Math.floor(wy / this.tileSize)
        };
    }

    /**
     * Find nearest walkable tile to given position.
     * BFS spiral search up to 10 tiles away.
     */
    _nearestWalkable(tx, ty) {
        if (tx >= 0 && tx < this.mapWidth && ty >= 0 && ty < this.mapHeight
            && this.navGrid[ty][tx]) {
            return { tx, ty };
        }

        const maxRadius = 10;
        for (let r = 1; r <= maxRadius; r++) {
            for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                    if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // ring only
                    const nx = tx + dx;
                    const ny = ty + dy;
                    if (nx >= 0 && nx < this.mapWidth && ny >= 0 && ny < this.mapHeight
                        && this.navGrid[ny][nx]) {
                        return { tx: nx, ty: ny };
                    }
                }
            }
        }

        return null;
    }
}
