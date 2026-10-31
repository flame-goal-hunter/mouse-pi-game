// ============================================================
// BotBrain — bMod-inspired AI (clean port)
// Navigation: safety grid, corner detection, Delaunay triangulation,
//   graph from triangle centroids, Floyd-Warshall, FarestPointOnEdge
// Bot logic: UpdateTarget, MakeChoice, HandleWeapon, HandleHook, Dodge
// ============================================================

import { PHYS, TILE_SIZE } from '../config.js';

const HOOK_DIRS = 32;
const STUCK_THRESHOLD = 1.5;
const TARGET_STICKY_MS = 18000;
const DEADZONE = 24;
const ATTACK_RANGE = 680;
const HOOK_TIMEOUT_MS = 1400;
const BODY_HALF = 20;

const PERSONALITIES = [
    { name: 'aggressive', scatter: 0.025, cdMin: 480, cdMax: 820,  hookChance: 0.35, dodgeSkill: 0.65 },
    { name: 'defensive',  scatter: 0.045, cdMin: 680, cdMax: 1150, hookChance: 0.20, dodgeSkill: 0.85 },
    { name: 'balanced',   scatter: 0.035, cdMin: 560, cdMax: 960,  hookChance: 0.28, dodgeSkill: 0.75 },
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
        const baseP = PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)];
        const diff = scene.diffConfig || window.gameConfig?.difficulty || window.parent?.__currentGameDifficulty;
        const cdScale = diff?.spawnRate || 1.0;
        this.personality = {
            ...baseP,
            scatter: diff?.scatter ?? baseP.scatter,
            cdMin: Math.round(baseP.cdMin * cdScale),
            cdMax: Math.round(baseP.cdMax * cdScale),
            dodgeSkill: Math.min(0.98, baseP.dodgeSkill * (diff?.aiAccuracy ? diff.aiAccuracy / 0.75 : 1))
        };

        // Target tracking
        this.target = null;           // current enemy object
        this.targetPos = null;        // last known position {x,y}
        this.targetStartTime = 0;
        this.targetType = 'empty';    // 'empty' | 'player' | 'pickup' | 'roam'
        this.path = [];
        this.needPathUpdate = true;
        this._lastPathRefresh = 0;

        // Edge-triggered input tracking for CharacterCore
        this._clock = 1000;
        this.lastHook = false;
        this.lastJump = false;
        this.lastFire = false;
        this.lastFireTime = 0;
        this.fireCooldown = this._randRange(this.personality.cdMin, this.personality.cdMax);

        // Movement & obstacle state
        this.lastPos = null;
        this.stuckFrames = 0;
        this.triedJump = false;
        this.currentWaypoint = null;
        this._unstickTicks = 0;
        this._unstickDir = 0;
        this._strafeDir = Math.random() > 0.5 ? 1 : -1;
        this._nextStrafeSwitchAt = 0;

        // Hook state
        this.hookStartTime = 0;
        this.hookTime = 0;
        this._hookCooldownUntil = 0;

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
        this._clock += (delta || 16.67);
        const now = this._clock;

        // Track hook duration
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

        // Prune waypoints we've already reached
        this._advancePath(pos);

        // Refresh path periodically when tracking a moving target or when path is exhausted
        if (this.targetPos && (this.needPathUpdate || this.path.length === 0 || now - this._lastPathRefresh > 420)) {
            this.path = this._findPath(pos, this.targetPos) || [this.targetPos];
            this._advancePath(pos);
            this.needPathUpdate = false;
            this._lastPathRefresh = now;
        }

        // Determine if we can see our target enemy
        let seeTarget = false;
        if (this.target && this.target.active && this.targetType === 'player') {
            seeTarget = this._canSee(scene.platformLayer, pos, { x: this.target.x, y: this.target.y });
            if (seeTarget) {
                this.targetPos = { x: this.target.x, y: this.target.y };
            }
        }
        this.seeTarget = seeTarget;
        this.enemyDist = (seeTarget && this.target)
            ? dist(pos, { x: this.target.x, y: this.target.y }) : Infinity;

        // 3. MakeChoice (movement + obstacle navigation)
        this._makeChoice(bot, scene, pos, vx, vy, grounded, out);

        // 4. HandleWeapon
        this._handleWeapon(bot, scene, seeTarget, pos, vx, vy, out);

        // 5. HandleHook
        this._handleHook(bot, scene, seeTarget, pos, vx, vy, grounded, hookState, out);

        // 6. Dodge incoming snowballs
        this._dodge(bot, scene, pos, vx, vy, grounded, out);

        // Enforce clean false->true jump edge for CharacterCore
        if (out.jump && this.lastJump) {
            out.jump = false;
        }

        // Update tracking
        this.lastPos = { x: pos.x, y: pos.y };
        this.lastHook = !!out.hook;
        this.lastJump = !!out.jump;

        return out;
    }

    _advancePath(pos) {
        if (!this.path || this.path.length <= 1) return;
        while (this.path.length > 1) {
            const wp = this.path[0];
            const d = dist(pos, wp);
            const sameTierClose = Math.abs(pos.y - wp.y) < 75 && Math.abs(pos.x - wp.x) < 55;
            if (d < 54 || sameTierClose) {
                this.path.shift();
            } else {
                break;
            }
        }
    }

    // ========================================================
    // 1. UpdateTarget (Center CTF Golden Cheese + Combat + Pickups)
    // ========================================================
    _updateTarget(bot, scene) {
        const now = this._clock;
        const ctf = scene.ctf;

        // === HIGHEST PRIORITY: CENTER CTF GOLDEN CHEESE ===
        if (ctf) {
            const isCarrying = (ctf.state === 'CARRIED') &&
                (ctf.carrier === bot || (bot.sessionId && ctf.carrierSid === bot.sessionId));

            // 1. If THIS bot is carrying the Golden Cheese -> rush straight to its Base Igloo!
            if (isCarrying) {
                const base = bot.ctfTargetBase || ctf.redBase || { x: 4655, y: 1500 };
                if (this.targetType !== 'ctf_base' || !this.targetPos || dist(this.targetPos, base) > 40) {
                    this.targetType = 'ctf_base';
                    this.targetPos = { x: base.x, y: base.y };
                    this.targetStartTime = now;
                    this.needPathUpdate = true;
                }
                return;
            }

            // 2. If an enemy is carrying the Golden Cheese -> intercept & shoot the carrier!
            if (ctf.state === 'CARRIED' && ctf.carrier && ctf.carrier !== bot && ctf.carrier.active) {
                if (this.target !== ctf.carrier || this.targetType !== 'player') {
                    this.target = ctf.carrier;
                    this.targetPos = { x: ctf.carrier.x, y: ctf.carrier.y };
                    this.targetType = 'player';
                    this.targetStartTime = now;
                    this.needPathUpdate = true;
                    return;
                }
            }
        }

        let findNew = this.targetType === 'empty';

        if (this.targetType === 'ctf_base') findNew = true; // no longer carrying
        if (this.targetType === 'ctf_cheese') {
            if (!ctf || (ctf.state !== 'HOME' && ctf.state !== 'DROPPED') || (now - this.targetStartTime > 7000)) {
                findNew = true;
            } else if (this.targetPos && dist(this.targetPos, { x: ctf.x, y: ctf.y }) > 45) {
                this.targetPos = { x: ctf.x, y: ctf.y };
                this.needPathUpdate = true;
            }
        }
        if (this.targetType === 'player' && (!this.target || !this.target.active || this._getHealth(this.target) <= 0))
            findNew = true;
        if (now - this.targetStartTime > TARGET_STICKY_MS)
            findNew = true;
        if (this.targetType === 'roam' && this.targetPos && dist({ x: bot.x, y: bot.y }, this.targetPos) < 75)
            findNew = true;
        if (this.targetType === 'pickup') {
            const pValid = this.target && !this.target.collected && this.target.active !== false && (!this.target.emoji || this.target.emoji.active);
            const reached = this.targetPos && dist({ x: bot.x, y: bot.y }, this.targetPos) < 46;
            const timedOut = now - this.targetStartTime > 4500;
            if (!pValid || reached || timedOut) {
                this._ignorePickupsUntil = now + 6000;
                findNew = true;
            }
        }

        if (!findNew) {
            if (this.targetType === 'player' && this.target && this.target.active) {
                const movedDist = this.targetPos ? dist(this.targetPos, { x: this.target.x, y: this.target.y }) : 999;
                if (movedDist > 90) {
                    this.targetPos = { x: this.target.x, y: this.target.y };
                    this.needPathUpdate = true;
                }
            }
            return;
        }

        this.targetStartTime = now;
        this.needPathUpdate = true;

        // Collect alive enemies
        const enemies = this._getEnemies(bot, scene);

        // Try pickup if health low or nearby powerup available (and not on pickup cooldown)
        const health = this._getHealth(bot);
        if (scene.pickups && now >= (this._ignorePickupsUntil || 0)) {
            let bestPick = null, bestPickPos = null, bestScore = Infinity;
            for (const p of scene.pickups) {
                if (p.collected || p.active === false) continue;
                if (p.emoji && (!p.emoji.active || !p.emoji.visible)) continue;
                const px = p.emoji ? p.emoji.x : p.x;
                const py = p.emoji ? p.emoji.y : p.y;
                if (typeof px !== 'number' || typeof py !== 'number') continue;

                const d = dist({ x: bot.x, y: bot.y }, { x: px, y: py });
                const isHealth = p.type === 'health';
                if (health < 55 && isHealth && d < 750 && d < bestScore) {
                    bestScore = d;
                    bestPick = p;
                    bestPickPos = { x: px, y: py };
                } else if (!isHealth && d < 240 && d < bestScore && Math.random() < 0.45) {
                    bestScore = d;
                    bestPick = p;
                    bestPickPos = { x: px, y: py };
                }
            }
            if (bestPick && bestPickPos) {
                this.target = bestPick;
                this.targetPos = bestPickPos;
                this.targetType = 'pickup';
                return;
            }
        }

        // 3. If Golden Cheese is available in Center / Dropped, race to grab it unless an enemy is right in our face!
        if (ctf && (ctf.state === 'HOME' || ctf.state === 'DROPPED')) {
            const closestEnemyDist = enemies.length > 0
                ? Math.min(...enemies.map(e => dist({ x: bot.x, y: bot.y }, e)))
                : Infinity;
            if (closestEnemyDist > 250 || Math.random() < 0.72) {
                this.target = null;
                this.targetPos = { x: ctf.x, y: ctf.y };
                this.targetType = 'ctf_cheese';
                return;
            }
        }

        // Pick closest enemy (with slight randomness so multiple bots don't always dogpile 1 target)
        if (enemies.length > 0) {
            enemies.sort((a, b) => dist({ x: bot.x, y: bot.y }, a) - dist({ x: bot.x, y: bot.y }, b));
            const e = (enemies.length > 1 && Math.random() < 0.25) ? enemies[1] : enemies[0];
            this.target = e;
            this.targetPos = { x: e.x, y: e.y };
            this.targetType = 'player';
            return;
        }

        // Roam: pick a random nav vertex on the map
        if (this.botNav && this.botNav.vertices && this.botNav.vertices.length > 0) {
            const v = this.botNav.vertices[Math.floor(Math.random() * this.botNav.vertices.length)];
            this.targetPos = { x: v.x, y: v.y };
        } else {
            const mapW = scene.map ? scene.map.widthInPixels : 5040;
            const mapH = scene.map ? scene.map.heightInPixels : 2520;
            this.targetPos = { x: 300 + Math.random() * (mapW - 600), y: 300 + Math.random() * (mapH - 700) };
        }
        this.targetType = 'roam';
        this.target = null;
    }

    _getHealth(entity) {
        if (!entity) return 0;
        if (typeof entity.getData === 'function') {
            const h = entity.getData('health');
            if (typeof h === 'number') return h;
        }
        if (typeof entity.health === 'number') return entity.health;
        return 100;
    }

    _getEnemies(bot, scene) {
        const enemies = [];
        const addIfAlive = (c) => {
            if (c && c !== bot && c.active && !c.isDying && this._getHealth(c) > 0) enemies.push(c);
        };
        if (scene.player) addIfAlive(scene.player);
        if (scene.guestPlayer) addIfAlive(scene.guestPlayer);
        if (scene.bots) for (const b of scene.bots) addIfAlive(b);
        return enemies;
    }

    // ========================================================
    // 3. MakeChoice (Smart Waypoint Following + Obstacle Clearing)
    // ========================================================
    _makeChoice(bot, scene, pos, vx, vy, grounded, out) {
        const now = this._clock;
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

        // Save current waypoint for hook scoring
        this.currentWaypoint = tgt;

        // 1. Base horizontal direction toward current waypoint
        let desiredDir = 0;
        if (tgt.x > DEADZONE) desiredDir = 1;
        else if (tgt.x < -DEADZONE) desiredDir = -1;
        else if (tgt.y < -45) desiredDir = this._committedDir || 1;

        // 2. Dynamic Combat Strafe (only when enemy is visible on roughly the same level)
        if (this.seeTarget && this.targetType === 'player' && this.enemyDist < 340 && Math.abs(this.target.y - pos.y) < 90) {
            if (this.enemyDist < 130) {
                this._combatRetreating = true;
            } else if (this.enemyDist > 210) {
                this._combatRetreating = false;
            }

            if (this._combatRetreating) {
                const retreatDir = (this.target.x < pos.x) ? 1 : -1;
                const behindTile = this._tileAt(Math.floor((pos.x + retreatDir * TILE_SIZE) / TILE_SIZE), Math.floor(pos.y / TILE_SIZE), scene);
                desiredDir = (behindTile !== T_HOLE) ? retreatDir : -retreatDir;
            } else if (this.enemyDist < 290) {
                if (now >= this._nextStrafeSwitchAt) {
                    this._strafeDir = (Math.random() < 0.55) ? -this._strafeDir : (this.target.x > pos.x ? 1 : -1);
                    this._nextStrafeSwitchAt = now + 1150 + Math.random() * 650;
                }
                const nextStrafeTile = this._tileAt(Math.floor((pos.x + this._strafeDir * TILE_SIZE) / TILE_SIZE), Math.floor(pos.y / TILE_SIZE), scene);
                if (nextStrafeTile === T_HOLE && now >= (this._lastHoleFlipAt || 0) + 600) {
                    this._strafeDir = -this._strafeDir;
                    this._lastHoleFlipAt = now;
                }
                desiredDir = this._strafeDir;
                if (grounded && Math.random() < 0.018) out.jump = true;
            }
        }

        // 3. Direction commitment hysteresis (prevents rapid left-right spinning in place!)
        if (this._unstickTicks > 0) {
            this._unstickTicks--;
            out.direction = this._unstickDir;
            this._committedDir = this._unstickDir;
        } else {
            if (desiredDir !== this._committedDir) {
                if (!this._dirCommitUntil || now >= this._dirCommitUntil) {
                    this._committedDir = desiredDir;
                    if (desiredDir !== 0) {
                        this._dirCommitUntil = now + 450;
                    }
                }
            }
            out.direction = (this._committedDir !== undefined) ? this._committedDir : desiredDir;
        }

        // 4. Multi-Level Forward Obstacle & Step Probe (foot, waist, head)
        this.wallAhead = false;
        this.highWallAhead = false;
        if (out.direction !== 0 && scene.platformLayer) {
            const dir = out.direction;
            const nearX = pos.x + dir * (TILE_SIZE * 0.85);
            const farX = pos.x + dir * (TILE_SIZE * 1.65);

            const footBlocked = this._isPointSolid(scene.platformLayer, nearX, pos.y + 18) ||
                                this._isPointSolid(scene.platformLayer, farX, pos.y + 18);
            const waistBlocked = this._isPointSolid(scene.platformLayer, nearX, pos.y - 2) ||
                                 this._isPointSolid(scene.platformLayer, farX, pos.y - 2);
            const headBlocked = this._isPointSolid(scene.platformLayer, nearX, pos.y - 24) ||
                                this._isPointSolid(scene.platformLayer, farX, pos.y - 24);

            if (footBlocked || waistBlocked || headBlocked) {
                this.wallAhead = true;
                const upperClear = !this._isPointSolid(scene.platformLayer, nearX, pos.y - TILE_SIZE * 1.4) &&
                                   !this._isPointSolid(scene.platformLayer, farX, pos.y - TILE_SIZE * 1.4);
                const highClear = !this._isPointSolid(scene.platformLayer, nearX, pos.y - TILE_SIZE * 2.6) &&
                                  !this._isPointSolid(scene.platformLayer, farX, pos.y - TILE_SIZE * 2.6);
                this.highWallAhead = !upperClear && highClear;

                if (grounded && (upperClear || highClear || !this._hasCeilingAbove(scene.platformLayer, pos.x, pos.y, 1.8))) {
                    out.jump = true;
                }
            }
        }

        // 5. Gap / Pit Crossing Detection (look 1 and 2 tiles ahead)
        const tx = Math.floor(pos.x / TILE_SIZE);
        const ty = Math.floor(pos.y / TILE_SIZE);
        const curTile = this._tileAt(tx, ty, scene);
        const predX = pos.x + (out.direction || 0) * (TILE_SIZE * 0.95);
        const ptx = Math.floor(predX / TILE_SIZE);
        const pty = Math.floor((pos.y + Math.max(vy, 0) * 0.08) / TILE_SIZE);
        const nextTile = this._tileAt(ptx, pty, scene);

        // Also check if there is an immediate drop-off gap in front of feet when target is not below us
        let gapAhead = (curTile === T_SAFE && nextTile === T_HOLE);
        if (!gapAhead && grounded && out.direction !== 0 && tgt.y <= 35 && scene.platformLayer) {
            const frontGround1 = this._isTileSolid(scene.platformLayer, tx + out.direction, ty + 1);
            const frontGround2 = this._isTileSolid(scene.platformLayer, tx + out.direction, ty + 2);
            if (!frontGround1 && !frontGround2) {
                gapAhead = true;
            }
        }

        if (gapAhead && (grounded || vy > -20)) {
            out.jump = true;
        }

        // 6. Smart Air-Jump (Double Jump) Timing:
        // Fire the second jump near the apex of the first jump (vy > -210) when climbing, clearing a wall, or crossing a pit!
        if (!grounded && !bot.core.airJumpUsed && !this.lastJump) {
            const needClimb = tgt.y < -50 && vy > -210;
            const needClearWall = this.wallAhead && vy > -240;
            const needSaveFromHole = (curTile === T_HOLE || nextTile === T_HOLE) && vy > -60;
            if (needClimb || needClearWall || needSaveFromHole) {
                out.jump = true;
            }
        }

        // 7. Stuck Detection & Escalation
        if (this.lastPos) {
            const actualMoved = Math.hypot(pos.x - this.lastPos.x, pos.y - this.lastPos.y);
            if (actualMoved < STUCK_THRESHOLD && (out.direction !== 0 || Math.abs(tgt.x) > DEADZONE || tgt.y < -40)) {
                this.stuckFrames++;
            } else if (actualMoved > STUCK_THRESHOLD * 2.2) {
                this.stuckFrames = 0;
                this.triedJump = false;
            }
        }

        if (this.stuckFrames > 4) {
            if (grounded) {
                out.jump = true;
                this.triedJump = true;
            } else if (!bot.core.airJumpUsed && vy > -180) {
                out.jump = true;
            }
            if (this.stuckFrames > 24) {
                // Reverse direction for ~0.45s to back out from under a lip or corner, and recompute path
                this._unstickDir = out.direction !== 0 ? -out.direction : (Math.random() > 0.5 ? 1 : -1);
                this._unstickTicks = 26;
                this._committedDir = this._unstickDir;
                this._dirCommitUntil = now + 450;
                this.stuckFrames = 0;
                this.needPathUpdate = true;
            }
        }

        // 8. Directly below waypoint with open sky above: jump up
        if (tgt.y < -45 && Math.abs(tgt.x) < DEADZONE * 1.8 && grounded) {
            out.jump = true;
        }
    }

    _isPointSolid(platformLayer, wx, wy) {
        if (!platformLayer) return false;
        const t = platformLayer.getTileAtWorldXY(wx, wy);
        return !!(t && t.index > 0);
    }

    _isTileSolid(platformLayer, tx, ty) {
        if (!platformLayer) return false;
        const t = platformLayer.getTileAt(tx, ty);
        return !!(t && t.index > 0);
    }

    _hasCeilingAbove(platformLayer, wx, wy, maxTilesUp = 2.5) {
        const tx = Math.floor(wx / TILE_SIZE);
        const ty = Math.floor(wy / TILE_SIZE);
        const steps = Math.ceil(maxTilesUp);
        for (let dy = 1; dy <= steps; dy++) {
            if (this._isTileSolid(platformLayer, tx, ty - dy)) return true;
        }
        return false;
    }

    _findOverhangEscapeDir(platformLayer, wx, wy, preferDx) {
        const tx = Math.floor(wx / TILE_SIZE);
        const ty = Math.floor(wy / TILE_SIZE);
        const pref = preferDx >= 0 ? 1 : -1;
        const dirs = [pref, -pref];

        for (let distTiles = 1; distTiles <= 6; distTiles++) {
            for (const d of dirs) {
                const checkTx = tx + d * distTiles;
                // Check if horizontal path to checkTx is not blocked by a wall
                if (this._isTileSolid(platformLayer, tx + d, ty)) continue;
                const ceiling1 = this._isTileSolid(platformLayer, checkTx, ty - 1);
                const ceiling2 = this._isTileSolid(platformLayer, checkTx, ty - 2);
                const ceiling3 = this._isTileSolid(platformLayer, checkTx, ty - 3);
                if (!ceiling1 && !ceiling2 && !ceiling3) {
                    return d;
                }
            }
        }
        return pref;
    }

    // ========================================================
    // 4. HandleWeapon (Ballistic Aiming with Line-of-Sight)
    // ========================================================
    _handleWeapon(bot, scene, seeTarget, pos, vx, vy, out) {
        let fireTarget = null;
        if (this.target && this.target.active && this.targetType === 'player' && seeTarget) {
            fireTarget = this.target;
        } else {
            const enemies = this._getEnemies(bot, scene);
            let bestD = ATTACK_RANGE;
            for (const e of enemies) {
                const d = dist(pos, { x: e.x, y: e.y });
                if (d < bestD && this._canSee(scene.platformLayer, pos, { x: e.x, y: e.y })) {
                    bestD = d;
                    fireTarget = e;
                }
            }
        }
        if (!fireTarget) return;

        const tPos = { x: fireTarget.x, y: fireTarget.y };
        const d = dist(pos, tPos);
        if (d > ATTACK_RANGE) return;

        const now = this._clock;
        if (now - this.lastFireTime < this.fireCooldown) return;
        out.fire = true;
        this.lastFireTime = now;
        this.fireCooldown = this._randRange(this.personality.cdMin, this.personality.cdMax);

        // Predict target movement + compensate for snowball gravity parabola
        const tVx = fireTarget.simpleBody ? fireTarget.simpleBody.vx : (fireTarget.vx || 0);
        const tVy = fireTarget.simpleBody ? fireTarget.simpleBody.vy : (fireTarget.vy || 0);
        const flightTime = d / PHYS.SNOWBALL_SPEED;
        const leadScale = d < 150 ? 0.55 : 0.85;

        const aimX = (tPos.x + tVx * flightTime * leadScale) - pos.x;
        let aimY = (tPos.y + tVy * flightTime * (leadScale * 0.6)) - pos.y;
        aimY -= 0.5 * PHYS.GRAVITY * PHYS.SNOWBALL_GRAVITY_SCALE * flightTime * flightTime;

        let angle = Math.atan2(aimY, aimX);
        angle += (Math.random() - 0.5) * 2 * this.personality.scatter * Math.PI;

        out.fireAngle = angle;
    }

    // ========================================================
    // 5. HandleHook (Matched to CharacterCore's edge-triggered hook)
    // ========================================================
    _handleHook(bot, scene, seeTarget, pos, vx, vy, grounded, hookState, out) {
        const tx = Math.floor(pos.x / TILE_SIZE);
        const ty = Math.floor(pos.y / TILE_SIZE);
        const curTile = this._tileAt(tx, ty, scene);
        const now = this._clock;

        // While FLYING: keep out.hook = false so CharacterCore._prevHookInput resets cleanly
        // (CharacterCore keeps flying hook active until it hits terrain or reaches max range)
        if (hookState === 'FLYING') {
            out.hook = false;
            return;
        }

        const tgt = this.currentWaypoint || (this.targetPos ? { x: this.targetPos.x - pos.x, y: this.targetPos.y - pos.y } : { x: 0, y: 0 });

        // While ATTACHED: CharacterCore keeps the hook attached as long as out.hook does NOT transition false->true!
        if (hookState === 'ATTACHED') {
            const anchorPos = bot.core.hookAnchorPos;
            if (!anchorPos) return;
            if (!this.hookStartTime) this.hookStartTime = now;

            const toAnchor = normalize({ x: anchorPos.x - pos.x, y: anchorPos.y - pos.y });
            let hvx = toAnchor.x * PHYS.HOOK_DRAG_ACCEL;
            let hvy = toAnchor.y * PHYS.HOOK_DRAG_ACCEL;
            if (hvy > 0) hvy *= 0.3;
            if ((hvx < 0 && out.direction < 0) || (hvx > 0 && out.direction > 0)) hvx *= 0.95;
            else hvx *= 0.75;

            const ps = dot(tgt, { x: hvx, y: hvy });
            const anchorDist = dist(pos, anchorPos);
            const finalTargetY = this.targetPos ? this.targetPos.y : pos.y;
            const reachedLedgeHeight = (pos.y <= anchorPos.y + 52 && tgt.y > -45) || (pos.y < finalTargetY - 40);
            const keepHook = (ps > 0 || (curTile === T_HOLE && pos.y > anchorPos.y + 40)) &&
                             !reachedLedgeHeight &&
                             anchorDist > 68 &&
                             (now - this.hookStartTime < HOOK_TIMEOUT_MS) &&
                             this.stuckFrames < 10;

            if (keepHook) {
                // Keep out.hook = false so CharacterCore does NOT toggle-release the hook!
                out.hook = false;
            } else {
                // Release the hook! Prefer releasing via swing-jump only when climbing toward a higher target
                if (tgt.y < -25 && pos.y > finalTargetY - 20 && !this.lastJump) {
                    out.jump = true;
                } else {
                    out.hook = !this.lastHook;
                }
                this.hookStartTime = 0;
                this._hookCooldownUntil = now + 550;
            }
            return;
        }

        this.hookStartTime = 0;

        // IDLE → Launch hook ONLY when climbing to a higher target or saving from a hole
        if (hookState === 'IDLE' && !this.lastHook && now >= (this._hookCooldownUntil || 0)) {
            const overHole = curTile === T_HOLE && vy > 20;
            const wantsClimb = tgt.y < -55;
            const needsUpward = tgt.y < -85 && (!grounded || Math.abs(tgt.x) < 260);
            const climbWall = wantsClimb && (this.wallAhead || this.stuckFrames > 5);
            const fastSwing = Math.hypot(tgt.x, tgt.y) > 320 && tgt.y < -45 && !grounded;
            const shouldHook = overHole || needsUpward || climbWall || fastSwing;

            if (shouldHook && scene.platformLayer) {
                const mapW = scene.map ? scene.map.widthInPixels : 5040;
                let bestHit = null;
                let bestScore = (curTile === T_HOLE) ? -1e6 : 0;

                for (let i = 0; i < HOOK_DIRS; i++) {
                    const a = (2 * i * Math.PI) / HOOK_DIRS;
                    const dx = Math.cos(a), dy = Math.sin(a);
                    // Only hook upward
                    if (dy > -0.18) continue;

                    const endX = pos.x + dx * PHYS.HOOK_RANGE;
                    const endY = pos.y + dy * PHYS.HOOK_RANGE;
                    const hitPoint = this._hookRaycast(scene.platformLayer, pos.x, pos.y, endX, endY);
                    if (!hitPoint) continue;

                    // Do not hook outer map boundary walls or above the top islands
                    if (hitPoint.x < 160 || hitPoint.x > mapW - 160 || hitPoint.y < 320) continue;

                    const hitDist = dist(pos, hitPoint);
                    if (hitDist < 90 || hitDist > PHYS.HOOK_RANGE) continue;

                    let hvx2 = dx * PHYS.HOOK_DRAG_ACCEL;
                    let hvy2 = dy * PHYS.HOOK_DRAG_ACCEL;
                    if ((hvx2 < 0 && out.direction < 0) || (hvx2 > 0 && out.direction > 0)) hvx2 *= 0.95;
                    else hvx2 *= 0.75;

                    let score = dot(tgt, { x: hvx2, y: hvy2 });
                    if (overHole && dy < -0.35) score += 120000;
                    if (needsUpward && hitPoint.y < pos.y - 90) score += 80000;

                    if (score > bestScore) {
                        bestScore = score;
                        bestHit = hitPoint;
                    }
                }

                if (bestHit) {
                    out.hook = true;
                    out.hookTarget = bestHit;
                    this.hookStartTime = now;
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
    // 6. Dodge incoming snowballs by jumping over them
    // ========================================================
    _dodge(bot, scene, pos, vx, vy, grounded, out) {
        if (!scene.snowballs || !grounded) return;
        const now = this._clock;
        if (now < (this._nextDodgeAt || 0)) return;

        for (const sb of scene.snowballs) {
            if (sb.active === false) continue;
            if (sb.getData && sb.getData('shooter') === bot) continue;
            if (bot.sessionId && sb._owner === bot.sessionId) continue;

            const dx = sb.x - pos.x, dy = sb.y - pos.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d > 280 || d < 20) continue;

            // Check if snowball is moving toward us
            const svx = sb.vx || 0, svy = sb.vy || 0;
            if (dx * svx >= 0) continue; // moving away horizontally

            const timeToHit = Math.abs(dx) / Math.max(60, Math.abs(svx));
            const impactY = sb.y + svy * timeToHit + 0.5 * PHYS.GRAVITY * PHYS.SNOWBALL_GRAVITY_SCALE * timeToHit * timeToHit;

            if (Math.abs(impactY - pos.y) < 65) {
                this._nextDodgeAt = now + 550;
                if (Math.random() <= this.personality.dodgeSkill) {
                    out.jump = true;
                }
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
