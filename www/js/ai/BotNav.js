// ============================================================
// BotNav — bMod botengine.cpp port
// Delaunay triangulation + Floyd-Warshall graph pathfinding
// ============================================================

import { TILE_SIZE } from '../config.js';

const GTILE_AIR = 0;
const GTILE_SOLID = 1;
const BTILE_SAFE = 16;
const BTILE_HOLE = 32;
const BTILE_LHOLE = 64;
const BTILE_RHOLE = 128;
const GTILE_MASK = 15;

const NEIGHBOURS = [[-1,-1],[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0]];
const POW2 = [1,2,4,8,16,32,64,128];

// bMod lookup tables (256 entries each)
const IS_OUTER_CORNER = [0,1,0,0,1,1,0,0,0,1,0,0,0,1,0,0,1,1,1,1,1,1,1,1,0,1,0,0,0,1,0,0,0,1,0,0,1,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,1,1,0,0,0,1,0,0,0,1,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,0,0,1,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,1,1,0,0,0,1,0,0,0,1,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0];
const IS_INNER_CORNER = [0,0,0,0,0,0,0,0,0,0,1,1,0,0,1,1,0,0,0,0,0,0,0,0,0,0,1,1,0,0,1,1,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,1,1,0,0,1,1,0,0,0,0,0,0,0,0,0,0,1,1,0,0,1,1,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,0,0,1,1,0,0,1,1,0,0,1,1,0,0,1,1,0,0,1,1,0,0,1,1,0,0,1,1,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,1,1,0,0,1,1,0,0,1,1,0,0,1,1,0,0,1,1,0,0,1,1,0,0,1,1,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1];

// Triangle geometry
function triSign(p1, p2, p3) {
    return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
}

function triInside(pt, a, b, c) {
    const b1 = triSign(pt, a, b) < 0;
    const b2 = triSign(pt, b, c) < 0;
    const b3 = triSign(pt, c, a) < 0;
    return (b1 === b2) && (b2 === b3);
}

function triDet3(a11,a12,a13,a21,a22,a23,a31,a32,a33) {
    return a11*a22*a33 - a11*a23*a32 - a12*a21*a33 + a12*a23*a31 + a13*a21*a32 - a13*a22*a31;
}

function triIsFlat(a, b, c) {
    return Math.abs(triDet3(a.x,a.y,1, b.x,b.y,1, c.x,c.y,1)) < 0.0001;
}

function triCircumCenter(a, b, c) {
    const d = 2 * triDet3(a.x,a.y,1, b.x,b.y,1, c.x,c.y,1);
    if (Math.abs(d) < 0.0001) return { x: (a.x+b.x+c.x)/3, y: (a.y+b.y+c.y)/3 };
    const ax2 = a.x*a.x + a.y*a.y;
    const bx2 = b.x*b.x + b.y*b.y;
    const cx2 = c.x*c.x + c.y*c.y;
    return {
        x: triDet3(ax2,a.y,1, bx2,b.y,1, cx2,c.y,1) / d,
        y: triDet3(a.x,ax2,1, b.x,bx2,1, c.x,cx2,1) / d
    };
}

function segIntersect(a1, a2, b1, b2) {
    const v1 = (b2.x-b1.x)*(a1.y-b1.y) - (b2.y-b1.y)*(a1.x-b1.x);
    const v2 = (b2.x-b1.x)*(a2.y-b1.y) - (b2.y-b1.y)*(a2.x-b1.x);
    const v3 = (a2.x-a1.x)*(b1.y-a1.y) - (a2.y-a1.y)*(b1.x-a1.x);
    const v4 = (a2.x-a1.x)*(b2.y-a1.y) - (a2.y-a1.y)*(b2.x-a1.x);
    return (v1*v2 < 0) && (v3*v4 < 0);
}

function triIntersects(t1, t2) {
    for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++)
            if (segIntersect(t1[i], t1[(i+1)%3], t2[j], t2[(j+1)%3]))
                return true;
    return false;
}

function dist(a, b) { return Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2); }

export class BotNav {
    constructor() {
        this.grid = null;
        this.width = 0;
        this.height = 0;
        this.corners = [];
        this.triangles = [];  // [{points: [{x,y},{x,y},{x,y}]}]
        this.vertices = [];   // [{x,y}] — triangle centroids in world px
        this.edges = [];      // [{from, to, size}]
        this.closestPath = null; // Int32Array [numVerts * numVerts]
        this.numVerts = 0;
        this.diameter = 0;
    }

    build(platformLayer, mapWidth, mapHeight, tileSize) {
        this.width = mapWidth;
        this.height = mapHeight;
        this.ts = tileSize;

        this._buildGrid(platformLayer);
        this._generateCorners();
        this._generateTriangles();
        this._generateGraph();
        this._floydWarshall();

        console.log(`[BotNav] ${this.corners.length} corners, ${this.triangles.length} triangles, ${this.numVerts} vertices, ${this.edges.length} edges, diameter=${this.diameter}`);
    }

    // ========== Grid ==========

    _buildGrid(platformLayer) {
        const w = this.width, h = this.height;
        this.grid = new Int32Array(w * h);
        const MARGIN = 6;

        // Bottom row first (bMod: j = height-1)
        for (let j = h - 1; j >= 0; j--) {
            for (let i = 0; i < w; i++) {
                const tile = platformLayer.getTileAt(i, j);
                const isSolid = tile && tile.index > 0;
                this.grid[i + j * w] = isSolid ? GTILE_SOLID : GTILE_AIR;

                if (isSolid) {
                    this.grid[i + j * w] |= BTILE_SAFE;
                } else if (j === h - 1) {
                    this.grid[i + j * w] |= BTILE_HOLE;
                } else {
                    const below = this.grid[i + (j + 1) * w];
                    const leftBelow = i > 0 ? this.grid[(i-1) + (j+1) * w] : 0;
                    const rightBelow = i < w-1 ? this.grid[(i+1) + (j+1) * w] : 0;

                    const leftOk = (leftBelow & BTILE_SAFE) && !(below & BTILE_RHOLE) && (leftBelow & GTILE_MASK) <= GTILE_AIR;
                    const rightOk = (rightBelow & BTILE_SAFE) && !(below & BTILE_LHOLE) && (rightBelow & GTILE_MASK) <= GTILE_AIR;

                    if (leftOk || rightOk || (below & BTILE_SAFE))
                        this.grid[i + j * w] |= BTILE_SAFE;
                    else
                        this.grid[i + j * w] |= BTILE_HOLE;
                }
            }

            // Mark left/right edge holes
            for (let i = MARGIN; i < w; i++) {
                if ((this.grid[i + j * w] & GTILE_MASK) > GTILE_AIR) break;
                if (this.grid[i + j * w] & BTILE_SAFE) break;
                this.grid[(i - MARGIN) + j * w] |= BTILE_LHOLE;
            }
            for (let i = w - 1; i >= MARGIN; i--) {
                if ((this.grid[i + j * w] & GTILE_MASK) > GTILE_AIR) break;
                if (this.grid[(i - MARGIN) + j * w] & BTILE_SAFE) break;
                this.grid[i + j * w] |= BTILE_RHOLE;
            }
        }
    }

    getTile(x, y) {
        x = Math.max(0, Math.min(x, this.width - 1));
        y = Math.max(0, Math.min(y, this.height - 1));
        return this.grid[y * this.width + x];
    }

    getTileWorld(wx, wy) {
        return this.getTile(Math.floor(wx / this.ts), Math.floor(wy / this.ts));
    }

    _isSolid(x, y) {
        return (this.getTile(x, y) & GTILE_MASK) > GTILE_AIR;
    }

    // ========== FastIntersectLine (bMod exact) ==========

    fastIntersectLine(id1, id2) {
        const w = this.width;
        const i1 = id1 % w, j1 = Math.floor(id1 / w);
        const i2 = id2 % w, j2 = Math.floor(id2 / w);
        const di = Math.abs(i2 - i1), dj = Math.abs(j2 - j1);
        const si = i2 > i1 ? 1 : i2 < i1 ? -1 : 0;
        const sj = j2 > j1 ? 1 : j2 < j1 ? -1 : 0;

        const neigh = [id1 + si, id2 - si, id1 + sj * w, id2 - sj * w];
        for (let k = 0; k < 4; k++) {
            const n = neigh[k];
            if (n >= 0 && n < w * this.height && (this.grid[n] & GTILE_MASK) > GTILE_AIR)
                return this.grid[n];
        }

        let i = 0, j = 0;
        while (i <= di && j <= dj) {
            const tx = i * si + i1, ty = j * sj + j1;
            if (tx >= 0 && tx < w && ty >= 0 && ty < this.height) {
                if ((this.grid[ty * w + tx] & GTILE_MASK) > GTILE_AIR)
                    return this.grid[ty * w + tx];
            }
            if (Math.abs((j + 1) * di - i * dj) < Math.abs(j * di - (i + 1) * dj))
                j++;
            else
                i++;
        }
        return 0;
    }

    // World-space LOS check
    hasLOS(x1, y1, x2, y2) {
        const id1 = Math.floor(x1 / this.ts) + Math.floor(y1 / this.ts) * this.width;
        const id2 = Math.floor(x2 / this.ts) + Math.floor(y2 / this.ts) * this.width;
        return !this.fastIntersectLine(id1, id2);
    }

    // ========== Corners (bMod GenerateCorners) ==========

    _generateCorners() {
        this.corners = [];
        const w = this.width, h = this.height;

        for (let i = 1; i < w - 1; i++) {
            for (let j = 1; j < h - 1; j++) {
                if (this._isSolid(i, j)) continue;
                let n = 0;
                for (let k = 0; k < 8; k++) {
                    const ni = i + NEIGHBOURS[k][0], nj = j + NEIGHBOURS[k][1];
                    if (this._isSolid(ni, nj)) n += POW2[k];
                }
                if (IS_OUTER_CORNER[n] || IS_INNER_CORNER[n])
                    this.corners.push({ x: i, y: j });
            }
        }
    }

    _cornerToWorld(c) {
        return { x: c.x * this.ts + this.ts * 0.5, y: c.y * this.ts + this.ts * 0.5 };
    }

    // ========== Delaunay Triangulation (bMod GenerateTriangles) ==========

    _generateTriangles() {
        this.triangles = [];
        const corners = this.corners;
        const n = corners.length;
        const w = this.width;

        // Two-pass Delaunay (bMod exact)
        for (let pass = 0; pass < 2; pass++) {
            for (let i = 0; i < n - 2; i++) {
                for (let j = i + 1; j < n - 1; j++) {
                    const id_ij_1 = corners[i].x + corners[i].y * w;
                    const id_ij_2 = corners[j].x + corners[j].y * w;
                    if (this.fastIntersectLine(id_ij_1, id_ij_2)) continue;

                    for (let k = j + 1; k < n; k++) {
                        const id_ik = corners[i].x + corners[i].y * w;
                        const id_k = corners[k].x + corners[k].y * w;
                        const id_jk = corners[j].x + corners[j].y * w;
                        if (this.fastIntersectLine(id_ik, id_k) || this.fastIntersectLine(id_jk, id_k))
                            continue;

                        const a = corners[i], b = corners[j], c = corners[k];
                        if (triIsFlat(a, b, c)) continue;

                        const pts = [a, b, c];

                        // Check intersection with existing triangles
                        let found = false;
                        for (let t = 0; t < this.triangles.length; t++) {
                            const existing = this.triangles[t].points;
                            if (triIntersects(pts, existing)) { found = true; break; }
                            // Check duplicate
                            if (pass === 1 && pts[0] === existing[0] && pts[1] === existing[1] && pts[2] === existing[2])
                                { found = true; break; }
                        }
                        if (found) continue;

                        if (pass === 0) {
                            // Pass 1: Delaunay circumcircle check
                            const cc = triCircumCenter(a, b, c);
                            const radius = dist(a, cc);
                            let inside = false;
                            for (let w2 = 0; w2 < n; w2++) {
                                if (w2 === i || w2 === j || w2 === k) continue;
                                if (dist(cc, corners[w2]) < radius) { inside = true; break; }
                            }
                            if (inside) continue;
                        } else {
                            // Pass 2: No point inside triangle
                            let inside = false;
                            for (let w2 = 0; w2 < n; w2++) {
                                if (w2 === i || w2 === j || w2 === k) continue;
                                if (triInside(corners[w2], a, b, c)) { inside = true; break; }
                            }
                            if (inside) continue;
                        }

                        this.triangles.push({ points: pts });
                    }
                }
            }
        }
    }

    // ========== Graph from Triangles (bMod GenerateGraphFromTriangles) ==========

    _generateGraph() {
        const tris = this.triangles;
        const numTris = tris.length;

        // Vertices = triangle centroids in world coords
        this.vertices = [];
        for (let i = 0; i < numTris; i++) {
            const p = tris[i].points;
            const cx = (p[0].x + p[1].x + p[2].x) / 3;
            const cy = (p[0].y + p[1].y + p[2].y) / 3;
            this.vertices.push({
                x: cx * this.ts + this.ts * 0.5,
                y: cy * this.ts + this.ts * 0.5
            });
        }
        this.numVerts = numTris;

        // Edges: connect adjacent triangles (2 shared vertices)
        this.edges = [];
        for (let i = 0; i < numTris - 1; i++) {
            for (let j = i + 1; j < numTris; j++) {
                let shared = 0;
                for (let a = 0; a < 3; a++)
                    for (let b = 0; b < 3; b++)
                        if (tris[i].points[a] === tris[j].points[b]) shared++;
                if (shared === 2) {
                    const d = dist(this.vertices[i], this.vertices[j]);
                    this.edges.push({ from: i, to: j, size: d });
                    this.edges.push({ from: j, to: i, size: d });
                }
            }
        }
    }

    // ========== Floyd-Warshall (bMod ComputeClosestPath) ==========

    _floydWarshall() {
        const n = this.numVerts;
        if (n === 0) { this.closestPath = null; this.diameter = 0; return; }

        const INF = 1000000;
        const distArr = new Float64Array(n * n).fill(INF);
        this.closestPath = new Int32Array(n * n).fill(-1);

        for (let i = 0; i < n; i++) distArr[i * n + i] = 0;

        for (const e of this.edges) {
            if (e.size < distArr[e.from * n + e.to]) {
                distArr[e.from * n + e.to] = e.size;
                this.closestPath[e.from * n + e.to] = e.to;
            }
        }

        for (let k = 0; k < n; k++) {
            for (let i = 0; i < n; i++) {
                for (let j = 0; j < n; j++) {
                    const through = distArr[i * n + k] + distArr[k * n + j];
                    if (through < distArr[i * n + j]) {
                        distArr[i * n + j] = through;
                        this.closestPath[i * n + j] = this.closestPath[i * n + k];
                    }
                }
            }
        }

        this.diameter = 0;
        for (let i = 0; i < n * n; i++)
            if (distArr[i] < INF && distArr[i] > this.diameter)
                this.diameter = distArr[i];
    }

    // ========== Runtime Pathfinding ==========

    getClosestVertex(wx, wy) {
        const tx = wx / this.ts, ty = wy / this.ts;
        let best = 0, bestDist = Infinity;
        for (let k = 0; k < this.triangles.length; k++) {
            const p = this.triangles[k].points;
            if (triInside({ x: tx, y: ty }, p[0], p[1], p[2])) return k;
            const d = dist({ x: wx, y: wy }, this.vertices[k]);
            if (d < bestDist) { bestDist = d; best = k; }
        }
        return best;
    }

    getPath(fromX, fromY, toX, toY) {
        if (this.numVerts === 0) return null;
        const startV = this.getClosestVertex(fromX, fromY);
        const endV = this.getClosestVertex(toX, toY);
        const n = this.numVerts;

        if (this.closestPath[startV * n + endV] < 0) return null;

        const path = [{ x: fromX, y: fromY }];
        let cur = startV;
        while (cur !== endV) {
            path.push({ x: this.vertices[cur].x, y: this.vertices[cur].y });
            cur = this.closestPath[cur * n + endV];
        }
        path.push({ x: this.vertices[cur].x, y: this.vertices[cur].y });
        path.push({ x: toX, y: toY });
        return path;
    }

    nextPoint(wx, wy, targetX, targetY) {
        if (this.numVerts === 0) return { x: targetX, y: targetY };
        const startV = this.getClosestVertex(wx, wy);
        const endV = this.getClosestVertex(targetX, targetY);
        const n = this.numVerts;
        const next = this.closestPath[startV * n + endV];
        if (next < 0) return { x: targetX, y: targetY };
        return this.vertices[next];
    }

    farestPointOnEdge(path, wx, wy) {
        if (!path || path.length === 0) return null;
        for (let k = path.length - 1; k >= 0; k--) {
            const d = dist({ x: wx, y: wy }, path[k]);
            if (d < 1000) {
                const dx = path[k].x - wx, dy = path[k].y - wy;
                const l = Math.sqrt(dx * dx + dy * dy);
                if (l < 1) continue;
                // ±14px perpendicular offset (body width, bMod: 14.f)
                const perpX = (-dy / l) * 14, perpY = (dx / l) * 14;
                if (this.hasLOS(wx - perpX, wy - perpY, path[k].x - perpX, path[k].y - perpY) &&
                    this.hasLOS(wx + perpX, wy + perpY, path[k].x + perpX, path[k].y + perpY)) {
                    return path[k];
                }
            }
        }
        return path[0] || null;
    }
}
