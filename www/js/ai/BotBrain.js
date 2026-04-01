// ============================================================
// BotBrain — bMod-inspired AI (clean port)
// Navigation: safety grid, corner detection, Delaunay triangulation,
//   graph from triangle centroids, Floyd-Warshall, FarestPointOnEdge
// Bot logic: UpdateTarget, MakeChoice, HandleWeapon, HandleHook, Dodge
// ============================================================

import { PHYS, TILE_SIZE } from '../config.js';

const HOOK_DIRS = 32;
const STUCK_THRESHOLD = 1.5;
const TARGET_STICKY_MS = 30000;
const DEADZONE = 28;
const ATTACK_RANGE = 450;
const HOOK_TIMEOUT_MS = 4000; // bMod: 4 * SERVER_TICK_SPEED
const BODY_HALF = 20;

const PERSONALITIES = [
    { name: 'aggressive', scatter: 0.03, cdMin: 600,  cdMax: 1000, hookChance: 0.25, dodgeSkill: 0.5 },
    { name: 'defensive',  scatter: 0.07, cdMin: 1000, cdMax: 1800, hookChance: 0.08, dodgeSkill: 0.8 },
    { name: 'balanced',   scatter: 0.05, cdMin: 800,  cdMax: 1500, hookChance: 0.15, dodgeSkill: 0.65 },
];

// ============================================================
// TILE CLASSIFICATION
// ============================================================
const T_AIR = 0, T_SOLID = 1, T_SAFE = 2, T_HOLE = 3;

function buildSafetyGrid(platformLayer, mapW, mapH) {
    const grid = new Uint8Array(mapW * mapH);
    for (let y = 0; y < mapH; y++)
        for (let x = 0; x < mapW; x++) {
            const t = platformLayer.getTileAt(x, y);
            grid[y * mapW + x] = (t && t.index > 0) ? T_SOLID : T_AIR;
        }
    for (let y = mapH - 1; y >= 0; y--)
        for (let x = 0; x < mapW; x++) {
            const idx = y * mapW + x;
            if (grid[idx] !== T_AIR) continue;
            let safe = false;
            for (let dy = 1; dy <= 20; dy++) {
                const ny = y + dy;
                if (ny >= mapH) break;
                if (grid[ny * mapW + x] === T_SOLID) { safe = true; break; }
            }
            grid[idx] = safe ? T_SAFE : T_HOLE;
        }
    return grid;
}

function getTileType(grid, mapW, mapH, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= mapW || ty >= mapH) return T_SOLID;
    return grid[ty * mapW + tx];
}

// ============================================================
// CORNER DETECTION — bMod exact 8-neighbor lookup tables
// ============================================================
// Neighbor offsets: 0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW
const NEIGH = [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]];
const POW2 = [1, 2, 4, 8, 16, 32, 64, 128];

function buildCornerTables() {
    const outer = new Uint8Array(256);
    const inner = new Uint8Array(256);
    for (let n = 0; n < 256; n++) {
        const s = k => !!(n & POW2[k]);
        // Outer corner: air tile with exactly one diagonal solid neighbor
        // whose two adjacent cardinal neighbors are both air
        // (convex corner of solid geometry seen from air)
        if (s(1) && !s(0) && !s(2)) outer[n] = 1;
        if (s(3) && !s(2) && !s(4)) outer[n] = 1;
        if (s(5) && !s(4) && !s(6)) outer[n] = 1;
        if (s(7) && !s(6) && !s(0)) outer[n] = 1;
        // Inner corner: air tile with two adjacent cardinal solid neighbors
        // and the diagonal between them is air (concave corner)
        if (s(0) && s(2) && !s(1)) inner[n] = 1;
        if (s(2) && s(4) && !s(3)) inner[n] = 1;
        if (s(4) && s(6) && !s(5)) inner[n] = 1;
        if (s(6) && s(0) && !s(7)) inner[n] = 1;
    }
    return { outer, inner };
}

const CORNER_TABLES = buildCornerTables();

function findCorners(grid, mapW, mapH, includeInner) {
    const corners = [];
    for (let x = 1; x < mapW - 1; x++) {
        for (let y = 1; y < mapH - 1; y++) {
            if (grid[y * mapW + x] === T_SOLID) continue;
            let n = 0;
            for (let k = 0; k < 8; k++) {
                const nx = x + NEIGH[k][0], ny = y + NEIGH[k][1];
                if (grid[ny * mapW + nx] === T_SOLID) n += POW2[k];
            }
            if (CORNER_TABLES.outer[n] || (includeInner && CORNER_TABLES.inner[n]))
                corners.push({ x, y });
        }
    }
    return corners;
}

// ============================================================
// BRESENHAM GRID LOS
// ============================================================
function gridLOS(grid, mapW, mapH, x0, y0, x1, y1) {
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    let sx = x1 > x0 ? 1 : x1 < x0 ? -1 : 0;
    let sy = y1 > y0 ? 1 : y1 < y0 ? -1 : 0;
    let cx = x0, cy = y0;
    let i = 0, j = 0;
    while (i <= dx && j <= dy) {
        if (getTileType(grid, mapW, mapH, cx, cy) === T_SOLID) return false;
        if (Math.abs((j + 1) * dx - i * dy) < Math.abs(j * dx - (i + 1) * dy)) {
            cy += sy; j++;
        } else {
            cx += sx; i++;
        }
    }
    return true;
}

// ============================================================
// TRIANGLE UTILITIES
// ============================================================
function triArea2(a, b, c) {
    return (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
}

function triIsFlat(a, b, c) {
    return Math.abs(triArea2(a, b, c)) < 0.001;
}

function circumCenter(a, b, c) {
    const D = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(D) < 1e-10) return { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
    const ux = ((a.x * a.x + a.y * a.y) * (b.y - c.y) + (b.x * b.x + b.y * b.y) * (c.y - a.y) + (c.x * c.x + c.y * c.y) * (a.y - b.y)) / D;
    const uy = ((a.x * a.x + a.y * a.y) * (c.x - b.x) + (b.x * b.x + b.y * b.y) * (a.x - c.x) + (c.x * c.x + c.y * c.y) * (b.x - a.x)) / D;
    return { x: ux, y: uy };
}

function triInside(p, a, b, c) {
    const d1 = triArea2(p, a, b), d2 = triArea2(p, b, c), d3 = triArea2(p, c, a);
    const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
    const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
    return !(hasNeg && hasPos);
}

function segmentsIntersect(a1, a2, b1, b2) {
    const d1 = triArea2(b1, b2, a1), d2 = triArea2(b1, b2, a2);
    const d3 = triArea2(a1, a2, b1), d4 = triArea2(a1, a2, b2);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))
        return true;
    return false;
}

function trisIntersect(t1, t2) {
    for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++)
            if (segmentsIntersect(t1[i], t1[(i + 1) % 3], t2[j], t2[(j + 1) % 3]))
                return true;
    return false;
}

function centroid(a, b, c) {
    return { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
}

function dist(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

function dot(a, b) { return a.x * b.x + a.y * b.y; }
function len(v) { return Math.sqrt(v.x * v.x + v.y * v.y); }
function normalize(v) { const l = len(v); return l < 0.001 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l }; }

// ============================================================
// NAVIGATION MESH (from botengine.cpp)
// ============================================================
class NavMesh {
    constructor(platformLayer) {
        const map = platformLayer.layer;
        this.mapW = map.width;
        this.mapH = map.height;
        this.grid = buildSafetyGrid(platformLayer, this.mapW, this.mapH);
        this.triangles = [];  // [{a,b,c}] in tile coords
        this.vertices = [];   // [{x,y}] centroids in pixel coords
        this.closestPath = null;
        this.numVerts = 0;
        this._build();
    }

    _build() {
        const allCorners = findCorners(this.grid, this.mapW, this.mapH, true);
        const outerCorners = findCorners(this.grid, this.mapW, this.mapH, false);
        if (allCorners.length < 3) return;

        // Pass 1: Delaunay (circumcircle test)
        this._triangulate(allCorners, true);
        // Pass 2: gap fill (no circumcircle, just no-overlap + no-interior-point)
        this._triangulate(allCorners, false);

        this._buildGraph();
    }

    _triangulate(corners, useCircum) {
        const n = corners.length;
        for (let i = 0; i < n - 2; i++) {
            for (let j = i + 1; j < n - 1; j++) {
                if (!gridLOS(this.grid, this.mapW, this.mapH, corners[i].x, corners[i].y, corners[j].x, corners[j].y)) continue;
                for (let k = j + 1; k < n; k++) {
                    if (!gridLOS(this.grid, this.mapW, this.mapH, corners[i].x, corners[i].y, corners[k].x, corners[k].y)) continue;
                    if (!gridLOS(this.grid, this.mapW, this.mapH, corners[j].x, corners[j].y, corners[k].x, corners[k].y)) continue;
                    const a = corners[i], b = corners[j], c = corners[k];
                    if (triIsFlat(a, b, c)) continue;

                    const tri = [a, b, c];
                    let skip = false;
                    for (const existing of this.triangles) {
                        if (trisIntersect(tri, [existing.a, existing.b, existing.c])) { skip = true; break; }
                        if (!useCircum && existing.a.x === a.x && existing.a.y === a.y &&
                            existing.b.x === b.x && existing.b.y === b.y &&
                            existing.c.x === c.x && existing.c.y === c.y) { skip = true; break; }
                    }
                    if (skip) continue;

                    if (useCircum) {
                        const cc = circumCenter(a, b, c);
                        const radius = dist(a, cc);
                        let found = false;
                        for (let w = 0; w < n; w++) {
                            if (w === i || w === j || w === k) continue;
                            if (dist(cc, corners[w]) < radius) { found = true; break; }
                        }
                        if (found) continue;
                    } else {
                        let found = false;
                        for (let w = 0; w < n; w++) {
                            if (w === i || w === j || w === k) continue;
                            if (triInside(corners[w], a, b, c)) { found = true; break; }
                        }
                        if (found) continue;
                    }

                    this.triangles.push({ a, b, c });
                }
            }
        }
    }

    _buildGraph() {
        const tris = this.triangles;
        const nv = tris.length;
        this.numVerts = nv;
        if (nv === 0) return;

        this.vertices = tris.map(t => {
            const c = centroid(t.a, t.b, t.c);
            return { x: c.x * TILE_SIZE + TILE_SIZE / 2, y: c.y * TILE_SIZE + TILE_SIZE / 2 };
        });

        // Find edges: triangles sharing 2 corners
        const edges = [];
        for (let i = 0; i < nv - 1; i++) {
            const ti = [tris[i].a, tris[i].b, tris[i].c];
            for (let j = i + 1; j < nv; j++) {
                const tj = [tris[j].a, tris[j].b, tris[j].c];
                let shared = 0;
                for (const p of ti)
                    for (const q of tj)
                        if (p.x === q.x && p.y === q.y) shared++;
                if (shared === 2) {
                    const d = dist(this.vertices[i], this.vertices[j]);
                    edges.push({ s: i, e: j, w: d });
                    edges.push({ s: j, e: i, w: d });
                }
            }
        }

        // Floyd-Warshall
        const INF = 1e9;
        const dArr = new Float64Array(nv * nv).fill(INF);
        this.closestPath = new Int32Array(nv * nv).fill(-1);
        for (let i = 0; i < nv; i++) dArr[i * nv + i] = 0;
        for (const e of edges) {
            const idx = e.s * nv + e.e;
            if (e.w < dArr[idx]) {
                dArr[idx] = e.w;
                this.closestPath[idx] = e.e;
            }
        }
        for (let k = 0; k < nv; k++)
            for (let i = 0; i < nv; i++)
                for (let j = 0; j < nv; j++) {
                    const through = dArr[i * nv + k] + dArr[k * nv + j];
                    if (through < dArr[i * nv + j]) {
                        dArr[i * nv + j] = through;
                        this.closestPath[i * nv + j] = this.closestPath[i * nv + k];
                    }
                }
    }

    getClosestVertex(pos) {
        const px = pos.x / TILE_SIZE, py = pos.y / TILE_SIZE;
        let best = 0, bestD = 1e9;
        for (let k = 0; k < this.triangles.length; k++) {
            const t = this.triangles[k];
            if (triInside({ x: px, y: py }, t.a, t.b, t.c)) return k;
            const d = dist(this.vertices[k], pos);
            if (d < bestD) { bestD = d; best = k; }
        }
        return best;
    }

    getNavPath(startPos, endPos) {
        if (this.numVerts === 0) return this._astarFallback(startPos, endPos);
        const si = this.getClosestVertex(startPos);
        const ei = this.getClosestVertex(endPos);
        if (this.closestPath[si * this.numVerts + ei] < 0)
            return this._astarFallback(startPos, endPos);
        const path = [startPos];
        let cur = si;
        while (cur !== ei) {
            path.push(this.vertices[cur]);
            cur = this.closestPath[cur * this.numVerts + ei];
        }
        path.push(this.vertices[cur]);
        path.push(endPos);
        return path;
    }

    farestPointOnEdge(path, botPos, platformLayer) {
        for (let k = path.length - 1; k >= 0; k--) {
            const vp = path[k];
            const d = dist(botPos, vp);
            if (d > 1000) continue;
            const dir = normalize({ x: vp.x - botPos.x, y: vp.y - botPos.y });
            const perp = { x: -dir.y * BODY_HALF * 0.7, y: dir.x * BODY_HALF * 0.7 };
            const losA = this._pixelLOS(platformLayer, botPos.x - perp.x, botPos.y - perp.y, vp.x - perp.x, vp.y - perp.y);
            const losB = this._pixelLOS(platformLayer, botPos.x + perp.x, botPos.y + perp.y, vp.x + perp.x, vp.y + perp.y);
            if (losA && losB) return vp;
        }
        return null;
    }

    nextPoint(pos, target) {
        if (this.numVerts === 0) return target;
        const si = this.getClosestVertex(pos);
        const ei = this.getClosestVertex(target);
        const n = this.closestPath[si * this.numVerts + ei];
        if (n < 0) return target;
        return this.vertices[n];
    }

    _pixelLOS(platformLayer, x0, y0, x1, y1) {
        const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / (TILE_SIZE * 0.5);
        const st = Math.max(1, Math.ceil(steps));
        for (let i = 0; i <= st; i++) {
            const t = i / st;
            const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
            const tile = platformLayer.getTileAtWorldXY(x, y); if (tile && tile.index > 0) return false;
        }
        return true;
    }

    tileAt(tx, ty) {
        return getTileType(this.grid, this.mapW, this.mapH, tx, ty);
    }

    gridLOS(x0, y0, x1, y1) {
        return gridLOS(this.grid, this.mapW, this.mapH, x0, y0, x1, y1);
    }

    _astarFallback(startPos, endPos) {
        const sx = Math.floor(startPos.x / TILE_SIZE);
        const sy = Math.floor(startPos.y / TILE_SIZE);
        const ex = Math.floor(endPos.x / TILE_SIZE);
        const ey = Math.floor(endPos.y / TILE_SIZE);
        const path = tileAStar(this.grid, this.mapW, this.mapH, sx, sy, ex, ey);
        return path || [endPos];
    }
}

// ============================================================
// A* FALLBACK (tile-level, for narrow corridors — not in bMod)
// ============================================================
function tileAStar(grid, mapW, mapH, sx, sy, ex, ey) {
    if (sx === ex && sy === ey) return [{ x: ex, y: ey }];
    const key = (x, y) => y * mapW + x;
    const open = [{ x: sx, y: sy, g: 0, f: 0 }];
    const gMap = new Map(); gMap.set(key(sx, sy), 0);
    const parent = new Map();
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    while (open.length) {
        open.sort((a, b) => a.f - b.f);
        const cur = open.shift();
        if (cur.x === ex && cur.y === ey) {
            const path = [];
            let k = key(ex, ey);
            while (k !== undefined) {
                const px = k % mapW, py = (k / mapW) | 0;
                path.unshift({ x: px * TILE_SIZE + TILE_SIZE / 2, y: py * TILE_SIZE + TILE_SIZE / 2 });
                k = parent.get(k);
            }
            return path;
        }
        for (const [dx, dy] of dirs) {
            const nx = cur.x + dx, ny = cur.y + dy;
            if (nx < 0 || ny < 0 || nx >= mapW || ny >= mapH) continue;
            const tt = grid[ny * mapW + nx];
            if (tt === T_SOLID) continue;
            const ng = cur.g + 1;
            const nk = key(nx, ny);
            if (gMap.has(nk) && gMap.get(nk) <= ng) continue;
            gMap.set(nk, ng);
            parent.set(nk, key(cur.x, cur.y));
            const h = Math.abs(nx - ex) + Math.abs(ny - ey);
            open.push({ x: nx, y: ny, g: ng, f: ng + h });
        }
    }
    return null;
}

// ============================================================
// BOT BRAIN
// ============================================================
export class BotBrain {
    constructor(scene) {
        this.botNav = scene.botNav || null; // bMod navigation engine
        this.personality = PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)];

        // Target tracking (bMod UpdateTarget)
        this.target = null;           // current enemy object
        this.targetPos = null;        // last known position {x,y}
        this.targetStartTime = 0;
        this.targetType = 'empty';    // 'empty' | 'player' | 'pickup' | 'roam'
        this.path = [];
        this.needPathUpdate = true;

        // bMod m_LastData tracking
        this.lastHook = false;
        this.lastFire = false;
        this.lastFireTime = Date.now();
        this.fireCooldown = this._randRange(this.personality.cdMin, this.personality.cdMax);

        // Movement state (bMod)
        this.lastPos = null;
        this.stuckFrames = 0;
        this.triedJump = false; // bMod: static bool tried
        this.currentWaypoint = null; // current movement target (for hook scoring)

        // Hook state
        this.hookStartTime = 0;
        this.hookTime = 0;

        // Roaming
        this.roamTarget = null;
    }

    _randRange(min, max) { return min + Math.random() * (max - min); }

    update(bot, scene, delta) {
        const out = { direction: 0, jump: false, hook: false, hookTarget: null, fire: false, fireAngle: null };
        if (!bot.active) return out;

        const pos = { x: bot.x, y: bot.y };
        const vx = bot.simpleBody.vx, vy = bot.simpleBody.vy;
        const grounded = bot.simpleBody.grounded;
        const hookState = bot.core.hookState;

        // Track hook duration (for BUG 6 hole time limit)
        if (hookState === 'ATTACHED') this.hookTime += delta;
        else this.hookTime = 0;

        // Stuck escalation: track hook failures, give up after 3
        if (hookState === 'IDLE' && this._prevHookState === 'ATTACHED') {
            this._hookFailCount = (this._hookFailCount || 0) + 1;
            if (this._hookFailCount >= 3) {
                this.targetType = 'empty';
                this._hookFailCount = 0;
            }
        }
        this._prevHookState = hookState;

        // 1. UpdateTarget
        this._updateTarget(bot, scene);

        // 2. UpdateEdge (path)
        if (this.needPathUpdate && this.targetPos) {
            this.path = this._findPath(pos, this.targetPos) || [];
            this.needPathUpdate = false;
        }

        // Determine if we can see our target enemy
        let seeTarget = false;
        if (this.target && this.target.active && this.targetType === 'player') {
            seeTarget = this._canSee(scene.platformLayer, pos, { x: this.target.x, y: this.target.y });
            if (seeTarget) {
                this.targetPos = { x: this.target.x, y: this.target.y };
                if (!this._lastPathRefresh || Date.now() - this._lastPathRefresh > 500) {
                    this.needPathUpdate = true;
                    this._lastPathRefresh = Date.now();
                }
            }
        }
        this.seeTarget = seeTarget;
        this.enemyDist = (seeTarget && this.target)
            ? dist(pos, { x: this.target.x, y: this.target.y }) : Infinity;

        // 3. MakeChoice (movement)
        this._makeChoice(bot, scene, pos, vx, vy, grounded, out);

        // 4. HandleWeapon
        this._handleWeapon(bot, scene, seeTarget, pos, vx, vy, out);

        // 5. HandleHook
        this._handleHook(bot, scene, seeTarget, pos, vx, vy, grounded, hookState, out);

        // 6. Dodge (NOT bMod — our addition)
        this._dodge(bot, scene, pos, vx, vy, grounded, out);

        // Update tracking
        this.lastPos = { x: pos.x, y: pos.y };
        this.lastHook = out.hook;
        // lastFire is managed inside _handleWeapon (toggle), don't overwrite here

        return out;
    }

    // ========================================================
    // 1. UpdateTarget (bMod: omniscient, pick random enemy, sticky 30s)
    // ========================================================
    _updateTarget(bot, scene) {
        const now = Date.now();
        let findNew = this.targetType === 'empty';

        if (this.targetType === 'player' && (!this.target || !this.target.active || this.target.getData('health') <= 0))
            findNew = true;
        if (now - this.targetStartTime > TARGET_STICKY_MS)
            findNew = true;
        if (this.targetType === 'roam' && this.targetPos && dist({ x: bot.x, y: bot.y }, this.targetPos) < 60)
            findNew = true;
        if (this.targetType === 'pickup' && this.targetPos && dist({ x: bot.x, y: bot.y }, this.targetPos) < 28)
            findNew = true;

        if (!findNew) {
            // BUG 10 fix: recompute path when bot loses sight of target (bMod FastIntersectLine)
            if (this.targetType === 'player' && this.target && this.target.active && scene.platformLayer) {
                const botPos = { x: bot.x, y: bot.y };
                const newPos = { x: this.target.x, y: this.target.y };
                if (!this._canSee(scene.platformLayer, botPos, newPos)) {
                    this.targetPos = newPos;
                    this.needPathUpdate = true;
                }
            }
            return;
        }

        this.targetStartTime = now;
        this.needPathUpdate = true;

        // Collect alive enemies
        const enemies = this._getEnemies(bot, scene);

        // Try pickup if health low
        const health = bot.getData('health');
        if (health < 50 && scene.pickups) {
            let bestPick = null, bestDist = Infinity;
            for (const p of scene.pickups) {
                if (!p.active || !p.visible) continue;
                const d = dist({ x: bot.x, y: bot.y }, { x: p.x, y: p.y });
                if (d < bestDist) { bestDist = d; bestPick = p; }
            }
            if (bestPick && bestDist < 600) {
                this.target = bestPick;
                this.targetPos = { x: bestPick.x, y: bestPick.y };
                this.targetType = 'pickup';
                return;
            }
        }

        // Pick random enemy (bMod style)
        if (enemies.length > 0) {
            const e = enemies[Math.floor(Math.random() * enemies.length)];
            this.target = e;
            this.targetPos = { x: e.x, y: e.y };
            this.targetType = 'player';
            return;
        }

        // Roam: pick a random point on the map
        const mapW = scene.map ? scene.map.widthInPixels : 2000;
        const mapH = scene.map ? scene.map.heightInPixels : 1400;
        this.targetPos = { x: Math.random() * mapW, y: Math.random() * mapH };
        this.targetType = 'roam';
        this.target = null;
    }

    _getEnemies(bot, scene) {
        const enemies = [];
        const addIfAlive = (c) => {
            if (c && c !== bot && c.active && c.getData('health') > 0) enemies.push(c);
        };
        if (scene.player) addIfAlive(scene.player);
        if (scene.guestPlayer) addIfAlive(scene.guestPlayer);
        if (scene.bots) for (const b of scene.bots) addIfAlive(b);
        return enemies;
    }

    // ========================================================
    // 3. MakeChoice (bMod exact logic)
    // ========================================================
    _makeChoice(bot, scene, pos, vx, vy, grounded, out) {
        // bMod: ALWAYS follow path for movement, seeTarget only for weapon/hook
        let tgt;
        if (this.path && this.path.length > 0) {
            const wp = this._farestPointOnEdge(this.path, pos);
            if (wp) tgt = { x: wp.x - pos.x, y: wp.y - pos.y };
            else if (this.targetPos) tgt = { x: this.targetPos.x - pos.x, y: this.targetPos.y - pos.y };
            else tgt = { x: 0, y: 0 };
        } else if (this.targetPos) {
            tgt = { x: this.targetPos.x - pos.x, y: this.targetPos.y - pos.y };
        } else {
            tgt = { x: 0, y: 0 };
        }

        // Save current waypoint for hook scoring (BUG 5 fix)
        this.currentWaypoint = tgt;

        // Direction (bMod: 28px deadzone, always move toward target)
        // Only stop if grounded and very close (not on hook — need to swing)
        const tgtDist = Math.hypot(tgt.x, tgt.y);
        if (grounded && tgtDist < 80) {
            out.direction = 0; // hold position on ground, shoot
        } else if (tgt.x > DEADZONE) out.direction = 1;
        else if (tgt.x < -DEADZONE) out.direction = -1;
        else out.direction = 0;

        // Combat stance: hold position or retreat when enemy visible
        if (this.seeTarget && grounded && this.targetType === 'player' && this.enemyDist < ATTACK_RANGE) {
            if (this.enemyDist < 120) {
                out.direction = (this.target.x < pos.x) ? 1 : -1;
            } else {
                out.direction = 0;
            }
        }

        // Proactive wall detection: raycast 2 tiles ahead
        this.wallAhead = false;
        if (out.direction !== 0 && scene.platformLayer) {
            const lookX = pos.x + out.direction * TILE_SIZE * 2;
            if (!this._canSee(scene.platformLayer, pos, { x: lookX, y: pos.y })) {
                this.wallAhead = true;
                if (grounded) {
                    const jumpClearY = pos.y - TILE_SIZE * 2;
                    if (this._canSee(scene.platformLayer,
                        { x: pos.x, y: jumpClearY },
                        { x: lookX, y: jumpClearY })) {
                        out.jump = true;
                    }
                }
            }
        }

        const predX = pos.x + (out.direction || 0) * PHYS.MAX_SPEED_X * 0.016;
        const predY = pos.y + Math.max(vy, 0) * 0.016;
        const ptx = Math.floor(predX / TILE_SIZE);
        const pty = Math.floor(predY / TILE_SIZE);

        const tx = Math.floor(pos.x / TILE_SIZE);
        const ty = Math.floor(pos.y / TILE_SIZE);
        const curTile = this._tileAt(tx, ty, scene);
        const nextTile = this._tileAt(ptx, pty, scene);

        // Stuck detection
        if (this.lastPos) {
            const actualMoved = Math.abs(pos.x - this.lastPos.x);
            if (actualMoved < STUCK_THRESHOLD && out.direction !== 0) this.stuckFrames++;
            else { this.stuckFrames = 0; this.triedJump = false; this._hookFailCount = 0; }
        }

        // Gap crossing: SAFE→HOLE transition
        if (curTile === T_SAFE && nextTile === T_HOLE && (grounded || vy > 0))
            out.jump = true;

        // Stuck logic: jump/double-jump/reverse (bMod phases)
        if (curTile !== T_HOLE && nextTile !== T_HOLE) {
            if (this.stuckFrames > 2 && out.direction !== 0) {
                if (grounded) {
                    out.jump = true;
                    this.triedJump = true;
                } else if (this.triedJump && !bot.core.airJumpUsed && vy > 0) {
                    out.jump = true;
                } else if (this.triedJump && bot.core.airJumpUsed && vy > 0) {
                    out.direction = -out.direction;
                }
            } else if (this.stuckFrames === 0) {
                this.triedJump = false;
            }
        }

        // Trajectory prediction: proactive jump when walking into wall
        if (!bot.core.airJumpUsed) {
            const velY = Math.min(vy, 0);
            const fwdEnd = { x: pos.x + vx * 0.16, y: pos.y + velY * 0.16 };
            const jmpEnd = { x: pos.x + vx * 0.16, y: pos.y + (velY + PHYS.JUMP_FORCE * 0.016) * 10 * 0.016 };
            const hitsWall = !this._canSee(scene.platformLayer, pos, fwdEnd);
            const jumpClears = this._canSee(scene.platformLayer, pos, jmpEnd);
            if (hitsWall && jumpClears) out.jump = true;
        }

        // Directly below target: jump straight up (bMod line 713)
        if (tgt.y < 0 && Math.abs(tgt.x) < DEADZONE && vy > -1 && !bot.core.airJumpUsed)
            out.jump = true;
    }

    // ========================================================
    // 4. HandleWeapon (adapted for snowballs)
    // ========================================================
    _handleWeapon(bot, scene, seeTarget, pos, vx, vy, out) {
        // BUG 9 fix: check closest visible enemy, not just tracked target
        let fireTarget = null;
        if (this.target && this.target.active && seeTarget) {
            fireTarget = this.target;
        } else {
            // Check if any other enemy is visible and close
            const enemies = this._getEnemies(bot, scene);
            for (const e of enemies) {
                const d = dist(pos, { x: e.x, y: e.y });
                if (d < ATTACK_RANGE && this._canSee(scene.platformLayer, pos, { x: e.x, y: e.y })) {
                    fireTarget = e; break;
                }
            }
        }
        if (!fireTarget) return;

        const tPos = { x: fireTarget.x, y: fireTarget.y };
        const d = dist(pos, tPos);
        if (d > ATTACK_RANGE) return;

        // Fire when cooldown ready (our game: fire is single-shot, not edge-triggered like bMod)
        const now = Date.now();
        if (now - this.lastFireTime < this.fireCooldown) return;
        out.fire = true;
        this.lastFireTime = now;
        this.fireCooldown = this._randRange(this.personality.cdMin, this.personality.cdMax);

        // Aim with prediction (use fireTarget, not this.target)
        let aimX, aimY;
        if (d < 120) {
            const tVx = fireTarget.simpleBody ? fireTarget.simpleBody.vx : 0;
            const tVy = fireTarget.simpleBody ? fireTarget.simpleBody.vy : 0;
            const flightTime = d / PHYS.SNOWBALL_SPEED;
            aimX = tPos.x + tVx * flightTime * 0.5 - pos.x;
            aimY = tPos.y + tVy * flightTime * 0.5 - pos.y;
        } else {
            const tVx = fireTarget.simpleBody ? fireTarget.simpleBody.vx : 0;
            const tVy = fireTarget.simpleBody ? fireTarget.simpleBody.vy : 0;
            const flightTime = d / PHYS.SNOWBALL_SPEED;
            aimX = tPos.x + tVx * flightTime - pos.x;
            aimY = tPos.y + tVy * flightTime - pos.y;
            // Compensate gravity on snowball
            aimY -= 0.5 * PHYS.GRAVITY * PHYS.SNOWBALL_GRAVITY_SCALE * flightTime * flightTime;
        }

        // Scatter (bMod: (random(64)-32)*PI/1024 ≈ ±5.6°)
        let angle = Math.atan2(aimY, aimX);
        angle += (Math.random() * 64 - 32) * Math.PI / 1024;

        out.fireAngle = angle;
    }

    // ========================================================
    // 5. HandleHook (EXACT bMod port)
    // ========================================================
    _handleHook(bot, scene, seeTarget, pos, vx, vy, grounded, hookState, out) {
        const tx = Math.floor(pos.x / TILE_SIZE);
        const ty = Math.floor(pos.y / TILE_SIZE);
        const curTile = this._tileAt(tx, ty, scene);

        // FLYING → hold (bMod: HOOK_FLYING → hook=1, return)
        if (hookState === 'FLYING') {
            out.hook = true;
            out.hookTarget = bot.core.hookPos ? { x: bot.core.hookPos.x, y: bot.core.hookPos.y } : null;
            return;
        }

        // BUG 5 fix: use current waypoint (from MakeChoice), not final target
        const wp = this.currentWaypoint || (this.targetPos ? { x: this.targetPos.x - pos.x, y: this.targetPos.y - pos.y } : { x: 0, y: 0 });
        let tgt = wp;

        // bMod has player hook toggle here, but our game only hooks terrain.
        // Skip player hook entirely — go straight to terrain hook logic.
        {
            // ATTACHED to terrain (bMod: HOOK_GRABBED && HookedPlayer==-1)
            if (hookState === 'ATTACHED') {
                const anchorPos = bot.core.hookAnchorPos;
                if (!anchorPos) return;

                // Compute HookVel (bMod exact formula)
                const toAnchor = normalize({ x: anchorPos.x - pos.x, y: anchorPos.y - pos.y });
                let hvx = toAnchor.x * PHYS.HOOK_DRAG_ACCEL;
                let hvy = toAnchor.y * PHYS.HOOK_DRAG_ACCEL;

                // bMod: if HookVel.y > 0, dampen by 0.3
                if (hvy > 0) hvy *= 0.3;
                // bMod: same-dir x boost 0.95, else 0.75
                if ((hvx < 0 && out.direction < 0) || (hvx > 0 && out.direction > 0))
                    hvx *= 0.95;
                else
                    hvx *= 0.75;
                // Add gravity
                hvy += 1.0;

                const hookVel = { x: hvx, y: hvy };
                const ps = dot(tgt, hookVel);

                // Keep hook if pulling toward target, or over hole and need to hold
                if (ps > 0 || (curTile === T_HOLE && tgt.y < 0 && vy > 0 && this.hookTime < 1500)) {
                    out.hook = true;
                    out.hookTarget = { x: anchorPos.x, y: anchorPos.y };
                }

                // Timeout 4s or anchor too close (< 20px) → release
                const now = Date.now();
                if (!this.hookStartTime) this.hookStartTime = now;
                const anchorDist = dist(pos, anchorPos);
                if (now - this.hookStartTime > HOOK_TIMEOUT_MS || anchorDist < 20) {
                    out.hook = false;
                    out.hookTarget = null;
                    this.hookStartTime = 0;
                    this._hookCooldownUntil = now + 2000;
                }
                // Toggle-release: create false→true edge to release hook
                // (bMod uses m_Hook=0 which releases directly; our CharacterCore
                //  needs a false→true edge, so we build it over 2 frames)
                if (!out.hook && !this.lastHook) {
                    out.hook = true;
                    this.hookStartTime = 0;
                    this._hookCooldownUntil = Date.now() + 2000;
                }
            } else {
                this.hookStartTime = 0;
            }

            // IDLE → purposeful hook (bMod scan + condition triggers)
            if (hookState === 'IDLE' && !out.fire && !this.lastHook
                && (!this._hookCooldownUntil || Date.now() >= this._hookCooldownUntil)) {
                const overHole = curTile === T_HOLE;
                const isStuck = this.stuckFrames > 2;
                const needsUpward = tgt.y < -TILE_SIZE * 2 && !grounded;
                let blockedAbove = false;
                if (needsUpward && scene.platformLayer) {
                    const tile = scene.platformLayer.getTileAtWorldXY(pos.x, pos.y - TILE_SIZE);
                    if (tile && tile.index > 0) blockedAbove = true;
                }
                const shouldHook = overHole || isStuck || (needsUpward && !blockedAbove) || this.wallAhead;
                if (shouldHook) {
                    const numDir = HOOK_DIRS;
                    let bestDir = null;
                    let maxForce = (curTile === T_HOLE) ? -10000 : 0;

                    for (let i = 0; i < numDir; i++) {
                        const a = 2 * i * Math.PI / numDir;
                        const dx = Math.cos(a), dy = Math.sin(a);
                        const endX = pos.x + dx * PHYS.HOOK_RANGE;
                        const endY = pos.y + dy * PHYS.HOOK_RANGE;

                        // Check if hook would hit solid terrain
                        const hitPoint = this._hookRaycast(scene.platformLayer, pos.x, pos.y, endX, endY);
                        if (!hitPoint) continue;

                        // Compute HookVel for this direction
                        let hvx2 = dx * PHYS.HOOK_DRAG_ACCEL;
                        let hvy2 = dy * PHYS.HOOK_DRAG_ACCEL;
                        if (hvy2 > 0) hvy2 *= 0.3;
                        if ((hvx2 < 0 && out.direction < 0) || (hvx2 > 0 && out.direction > 0))
                            hvx2 *= 0.95;
                        else
                            hvx2 *= 0.75;
                        hvy2 += 1.0;

                        const ps = dot(tgt, { x: hvx2, y: hvy2 });
                        if (ps > maxForce) {
                            maxForce = ps;
                            bestDir = hitPoint;
                        }
                    }

                    if (bestDir && dist(pos, bestDir) > 32) {
                        out.hook = true;
                        out.hookTarget = bestDir;
                        this.hookStartTime = Date.now();
                    }
                }
            }
        }
    }

    _hookRaycast(platformLayer, x0, y0, x1, y1) {
        const d = dist({ x: x0, y: y0 }, { x: x1, y: y1 });
        const steps = Math.ceil(d / (TILE_SIZE * 0.5));
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
            const ht = platformLayer.getTileAtWorldXY(x, y);
            if (ht && ht.index > 0) {
                return { x, y };
            }
        }
        return null;
    }

    // ========================================================
    // 6. Dodge (NOT in bMod — our addition)
    // ========================================================
    _dodge(bot, scene, pos, vx, vy, grounded, out) {
        if (!scene.snowballs || !grounded) return;
        const skill = this.personality.dodgeSkill;
        if (Math.random() > skill) return;

        for (const sb of scene.snowballs) {
            if (!sb.active) continue;
            if (sb.getData && sb.getData('shooter') === bot) continue;

            const dx = sb.x - pos.x, dy = sb.y - pos.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d > 300) continue;

            // Predict if snowball heading toward us
            const svx = sb.vx || 0, svy = sb.vy || 0;
            const timeToHit = d / Math.max(1, Math.sqrt(svx * svx + svy * svy));
            const impactX = sb.x + svx * timeToHit;
            const impactY = sb.y + svy * timeToHit;
            const impactDist = dist({ x: impactX, y: impactY }, pos);

            if (impactDist < 50) {
                // Dodge: jump and move perpendicular
                out.jump = true;
                if (svx > 0) out.direction = -1;
                else if (svx < 0) out.direction = 1;
                else out.direction = Math.random() > 0.5 ? 1 : -1;
                return;
            }
        }
    }

    // ========================================================
    // Utility: line-of-sight between two world positions
    // ========================================================
    _canSee(platformLayer, from, to) {
        const d = dist(from, to);
        const steps = Math.ceil(d / (TILE_SIZE * 0.5));
        for (let i = 1; i < steps; i++) {
            const t = i / steps;
            const x = from.x + (to.x - from.x) * t;
            const y = from.y + (to.y - from.y) * t;
            const tile = platformLayer.getTileAtWorldXY(x, y); if (tile && tile.index > 0) return false;
        }
        return true;
    }

    _farestPointOnEdge(path, pos) {
        if (!path || path.length === 0) return null;
        if (this.botNav) return this.botNav.farestPointOnEdge(path, pos.x, pos.y);
        return path[0] || null;
    }

    _findPath(from, to) {
        if (this.botNav) {
            return this.botNav.getPath(from.x, from.y, to.x, to.y);
        }
        return null;
    }

    // Simple tile type check for jump logic
    _tileAt(tx, ty, scene) {
        if (!scene.platformLayer) return T_SAFE;
        const t = scene.platformLayer.getTileAt(tx, ty);
        if (t && t.index > 0) return T_SOLID;
        // Check if ground within 15 tiles below
        for (let dy = 1; dy <= 15; dy++) {
            const bt = scene.platformLayer.getTileAt(tx, ty + dy);
            if (bt && bt.index > 0) return T_SAFE;
        }
        return T_HOLE;
    }
}
