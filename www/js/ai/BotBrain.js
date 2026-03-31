// ============================================================
// BotBrain — Teeworlds bMod-inspired AI (complete rewrite)
// State machine + grid A* + bMod hook/aim algorithms
// ============================================================

import { PHYS, TILE_SIZE } from '../config.js';

// ============================================================
// CONSTANTS
// ============================================================
const DT = 1 / 60;                    // Fixed timestep (seconds)
const DEADZONE = 28;                   // px — don't change direction if within
const VISION_RANGE = 1400;             // px
const ATTACK_RANGE = 450;              // px — shoot if closer
const HOOK_DIRS = 32;                  // bMod: 32-direction hook scan
const HOOK_MIN_DIST = 40;             // px — minimum hook anchor distance
const STUCK_THRESHOLD = 1.5;          // px — movement below this = stuck
const PATH_RECALC_MS = 800;           // ms between path recalculations
const PATROL_CHANGE_MS = 5000;        // ms between patrol target changes
const MEMORY_DURATION = 4000;         // ms — remember last seen target position

// Personality presets
const PERSONALITIES = [
    { name: 'aggressive', aimScatter: 0.03, cdMin: 600, cdMax: 1000, reactMin: 150, reactMax: 350, hookChance: 0.25, dodgeSkill: 0.5 },
    { name: 'defensive',  aimScatter: 0.07, cdMin: 1000, cdMax: 1800, reactMin: 300, reactMax: 600, hookChance: 0.08, dodgeSkill: 0.8 },
    { name: 'balanced',   aimScatter: 0.05, cdMin: 800, cdMax: 1500, reactMin: 200, reactMax: 500, hookChance: 0.15, dodgeSkill: 0.65 },
];

// ============================================================
// SAFETY GRID (bMod-style tile classification)
// ============================================================
const TILE_AIR = 0, TILE_SOLID = 1, TILE_SAFE = 2, TILE_HOLE = 3;

function buildSafetyGrid(platformLayer, mapW, mapH) {
    const grid = [];
    // Pass 1: classify solid vs air
    for (let y = 0; y < mapH; y++) {
        grid[y] = new Uint8Array(mapW);
        for (let x = 0; x < mapW; x++) {
            const tile = platformLayer.getTileAt(x, y);
            grid[y][x] = (tile && tile.index > 0) ? TILE_SOLID : TILE_AIR;
        }
    }
    // Pass 2: bottom-up safety (air tile is SAFE if has ground within 20 tiles below)
    for (let x = 0; x < mapW; x++) {
        for (let y = mapH - 1; y >= 0; y--) {
            if (grid[y][x] !== TILE_AIR) continue;
            let safe = false;
            for (let dy = 1; dy <= 20; dy++) {
                if (y + dy >= mapH) break;
                if (grid[y + dy][x] === TILE_SOLID) { safe = true; break; }
            }
            grid[y][x] = safe ? TILE_SAFE : TILE_HOLE;
        }
    }
    return grid;
}

// ============================================================
// A* PATHFINDER (8-directional, tile grid)
// ============================================================
function findPath(grid, mapW, mapH, sx, sy, ex, ey) {
    if (sx === ex && sy === ey) return [{ tx: ex, ty: ey }];
    if (sx < 0 || sy < 0 || sx >= mapW || sy >= mapH) return null;
    if (ex < 0 || ey < 0 || ex >= mapW || ey >= mapH) return null;
    // Allow endpoints on any non-solid tile
    if (grid[sy][sx] === TILE_SOLID || grid[ey][ex] === TILE_SOLID) return null;

    const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
    const costs = [1,1,1,1,1.41,1.41,1.41,1.41];
    const key = (x, y) => y * mapW + x;

    const gScore = new Map();
    const cameFrom = new Map();
    const startKey = key(sx, sy);
    gScore.set(startKey, 0);

    // Binary heap (min-heap by fScore)
    const open = [{ x: sx, y: sy, f: Math.hypot(ex - sx, ey - sy) }];
    const inOpen = new Set([startKey]);
    const closed = new Set();

    let iterations = 0;
    const maxIter = mapW * mapH * 2;

    while (open.length > 0 && iterations++ < maxIter) {
        // Pop min fScore
        let minIdx = 0;
        for (let i = 1; i < open.length; i++) {
            if (open[i].f < open[minIdx].f) minIdx = i;
        }
        const cur = open[minIdx];
        open[minIdx] = open[open.length - 1];
        open.pop();

        const ck = key(cur.x, cur.y);
        if (closed.has(ck)) continue;
        closed.add(ck);
        inOpen.delete(ck);

        if (cur.x === ex && cur.y === ey) {
            // Reconstruct path
            const path = [];
            let k = ck;
            while (k !== undefined) {
                const py = Math.floor(k / mapW);
                const px = k % mapW;
                path.push({ tx: px, ty: py });
                k = cameFrom.get(k);
            }
            path.reverse();
            return path;
        }

        const cg = gScore.get(ck);

        for (let d = 0; d < 8; d++) {
            const nx = cur.x + dirs[d][0];
            const ny = cur.y + dirs[d][1];
            if (nx < 0 || ny < 0 || nx >= mapW || ny >= mapH) continue;
            const nk = key(nx, ny);
            if (closed.has(nk)) continue;

            const cell = grid[ny][nx];
            if (cell === TILE_SOLID) continue;

            // Penalize HOLE tiles heavily, prefer SAFE
            const penalty = cell === TILE_HOLE ? 8 : (cell === TILE_AIR ? 3 : 1);
            const ng = cg + costs[d] * penalty;

            const prev = gScore.get(nk);
            if (prev !== undefined && ng >= prev) continue;
            gScore.set(nk, ng);
            cameFrom.set(nk, ck);

            const h = Math.hypot(ex - nx, ey - ny);
            open.push({ x: nx, y: ny, f: ng + h });
            inOpen.add(nk);
        }
    }
    return null; // No path
}

// ============================================================
// LINE OF SIGHT (tile grid, Bresenham)
// ============================================================
function tileLOS(grid, mapW, mapH, x1, y1, x2, y2) {
    let dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
    let sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1;
    let err = dx - dy;
    let cx = x1, cy = y1;
    while (true) {
        if (cx < 0 || cy < 0 || cx >= mapW || cy >= mapH) return false;
        if (grid[cy][cx] === TILE_SOLID) return false;
        if (cx === x2 && cy === y2) return true;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; cx += sx; }
        if (e2 < dx) { err += dx; cy += sy; }
    }
}

// ============================================================
// FARTHEST VISIBLE WAYPOINT (bMod FarestPointOnEdge)
// ============================================================
function farthestVisible(grid, mapW, mapH, path, botTX, botTY) {
    for (let i = path.length - 1; i >= 1; i--) {
        if (tileLOS(grid, mapW, mapH, botTX, botTY, path[i].tx, path[i].ty)) {
            return path[i];
        }
    }
    return path[Math.min(1, path.length - 1)];
}

// ============================================================
// WORLD ↔ TILE CONVERSION
// ============================================================
function w2t(px) { return Math.floor(px / TILE_SIZE); }
function t2w(tx) { return tx * TILE_SIZE + TILE_SIZE * 0.5; }

// ============================================================
// BOT BRAIN
// ============================================================
export class BotBrain {
    constructor(scene) {
        // Build safety grid
        const layer = scene.platformLayer;
        if (layer) {
            this.mapW = layer.layer.width;
            this.mapH = layer.layer.height;
            this.grid = buildSafetyGrid(layer, this.mapW, this.mapH);
        } else {
            this.mapW = 0; this.mapH = 0; this.grid = [];
        }

        // Personality
        this.personality = PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)];

        // State
        this.target = null;
        this.lastTargetPos = null;
        this.lastTargetSeen = 0;
        this.lastTargetId = null;
        this.path = null;
        this.pathAge = 0;
        this.patrolTarget = null;
        this.patrolTimer = 0;
        this.shootCooldown = 0;
        this.reactionDelay = 0;
        this.hookCooldown = 0;
        this.hookTime = 0;
        this.prevX = 0;
        this.prevY = 0;
        this.stuckFrames = 0;
        this.stuckJumped = false;
        this.stuckReversed = false;
    }

    // ============================================================
    // MAIN UPDATE — called every tick (16.67ms)
    // ============================================================
    update(bot, scene, delta) {
        const input = { direction: 0, jump: false, hook: false, hookTarget: null, fire: false, fireAngle: null };
        const p = this.personality;

        // Update timers
        this.shootCooldown = Math.max(0, this.shootCooldown - delta);
        this.reactionDelay = Math.max(0, this.reactionDelay - delta);
        this.hookCooldown = Math.max(0, this.hookCooldown - delta);
        this.pathAge += delta;
        this.patrolTimer += delta;

        if (bot.core?.hookState === 'ATTACHED') {
            this.hookTime += delta;
        } else {
            this.hookTime = 0;
        }

        // ---- 1. TARGET SELECTION ----
        this.target = this._selectTarget(bot, scene);
        let targetX, targetY;

        if (this.target) {
            targetX = this.target.x;
            targetY = this.target.y;
            this.lastTargetPos = { x: targetX, y: targetY };
            this.lastTargetSeen = Date.now();

            // Reaction delay on new target
            const tid = this.target.getData?.('playerId') || 'unknown';
            if (tid !== this.lastTargetId) {
                this.reactionDelay = p.reactMin + Math.random() * (p.reactMax - p.reactMin);
                this.lastTargetId = tid;
            }
        } else if (this.lastTargetPos && Date.now() - this.lastTargetSeen < MEMORY_DURATION) {
            targetX = this.lastTargetPos.x;
            targetY = this.lastTargetPos.y;
        } else {
            targetX = null; targetY = null;
            this.lastTargetPos = null;
        }

        // ---- 2. DODGE CHECK (highest priority) ----
        const dodge = this._checkDodge(bot, scene);
        if (dodge) {
            input.direction = dodge.dir;
            if (dodge.jump) input.jump = true;
            return input;
        }

        // ---- 3. HOOK MANAGEMENT ----
        this._handleHook(bot, scene, input, targetX, targetY);

        // ---- 4. ATTACK / CHASE / NAVIGATE ----
        if (this.target && this.target.active) {
            const dx = this.target.x - bot.x;
            const dy = this.target.y - bot.y;
            const dist = Math.hypot(dx, dy);
            const canSee = this._worldLOS(bot.x, bot.y, this.target.x, this.target.y, scene);

            // Shoot if we have LOS and in range
            if (canSee && dist < ATTACK_RANGE && this.shootCooldown <= 0 && this.reactionDelay <= 0) {
                input.fire = true;
                input.fireAngle = this._aim(bot, this.target);
                this.shootCooldown = p.cdMin + Math.random() * (p.cdMax - p.cdMin);
                this.reactionDelay = 40;
            }

            if (canSee && dist < ATTACK_RANGE) {
                // ATTACK mode: strafe at medium range, face target at close range
                if (dist > 150) {
                    input.direction = (Math.sin(Date.now() * 0.003) > 0) ? 1 : -1;
                    if (Math.random() < 0.015) input.jump = true;
                } else {
                    bot.setData('facingRight', dx > 0);
                }
                return input;
            }

            // No LOS or far away: NAVIGATE to target (always chase, even through walls)
            this._navigateTo(bot, this.target.x, this.target.y, input, scene);

            // Opportunistic shot while navigating
            if (canSee && dist < ATTACK_RANGE * 1.5 && this.shootCooldown <= 0 && this.reactionDelay <= 0) {
                input.fire = true;
                input.fireAngle = this._aim(bot, this.target);
                this.shootCooldown = p.cdMin + Math.random() * (p.cdMax - p.cdMin);
                this.reactionDelay = 40;
            }
            return input;
        }

        // ---- 5. PICKUP ----
        const pickup = this._findPickup(bot, scene);
        if (pickup) {
            this._moveToward(bot, pickup.x, pickup.y, input, scene);
            return input;
        }

        // ---- 6. NAVIGATE to last remembered target pos ----
        if (targetX !== null) {
            this._navigateTo(bot, targetX, targetY, input, scene);
            return input;
        }

        // ---- 7. PATROL ----
        this._patrol(bot, input, scene);
        return input;
    }

    // ============================================================
    // TARGET SELECTION
    // ============================================================
    _selectTarget(bot, scene) {
        // bMod: bot always knows where enemies are (omniscient).
        // LOS is only needed for shooting, not for target selection.
        let closest = null, closestDist = Infinity;
        const candidates = [];
        if (scene.player?.active && scene.player.getData('health') > 0) candidates.push(scene.player);
        if (scene.guestPlayer?.active && scene.guestPlayer.getData('health') > 0) candidates.push(scene.guestPlayer);
        for (const b of scene.bots || []) {
            if (b === bot || !b.active || b.getData('health') <= 0) continue;
            candidates.push(b);
        }
        for (const c of candidates) {
            const dist = Math.hypot(c.x - bot.x, c.y - bot.y);
            if (dist > VISION_RANGE || dist >= closestDist) continue;
            closest = c; closestDist = dist;
        }
        return closest;
    }

    // ============================================================
    // WORLD LOS (pixel-level, via tilemap)
    // ============================================================
    _worldLOS(x1, y1, x2, y2, scene) {
        if (!scene.platformLayer) return true;
        const line = new Phaser.Geom.Line(x1, y1, x2, y2);
        const tiles = scene.platformLayer.getTilesWithinShape(line);
        for (const t of tiles) {
            if (t && t.index > 0) return false;
        }
        return true;
    }

    // ============================================================
    // AIMING (bMod-style: ballistic prediction)
    // ============================================================
    _aim(bot, target) {
        const dx = target.x - bot.x;
        const dy = target.y - bot.y;
        const dist = Math.hypot(dx, dy);
        const scatter = this.personality.aimScatter;

        // Close range: direct aim with light leading
        if (dist < 120) {
            const tvx = target.simpleBody?.vx || 0;
            const tvy = target.simpleBody?.vy || 0;
            const angle = Math.atan2(dy + tvy * DT * 3, dx + tvx * DT * 3);
            return angle + (Math.random() - 0.5) * scatter;
        }

        // Medium/long range: predict target position
        const speed = PHYS.SNOWBALL_SPEED;
        const gravity = PHYS.GRAVITY * PHYS.SNOWBALL_GRAVITY_SCALE * DT * DT;
        const flightTime = Math.max(dist - 40, 1) / speed * 60; // in frames

        const tvx = target.simpleBody?.vx || 0;
        const tvy = target.simpleBody?.vy || 0;
        const predX = target.x + tvx * DT * flightTime;
        const predY = target.y + tvy * DT * flightTime;

        const pdx = predX - bot.x;
        const pdy = predY - bot.y;
        const gravDrop = 0.5 * gravity * flightTime * flightTime;
        const angle = Math.atan2(pdy - gravDrop, pdx);

        return angle + (Math.random() - 0.5) * scatter * 2;
    }

    // ============================================================
    // DODGE (snowball trajectory prediction)
    // ============================================================
    _checkDodge(bot, scene) {
        if (!scene.snowballs) return null;
        const dodgeSkill = this.personality.dodgeSkill;

        for (const sb of scene.snowballs) {
            if (!sb.active) continue;
            if (sb.getData?.('shooter') === bot) continue;

            const dx = sb.x - bot.x, dy = sb.y - bot.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 350) continue;

            const vx = sb.vx || 0, vy = sb.vy || 0;
            const speed = Math.hypot(vx, vy);
            if (speed < 50) continue;

            const timeFrames = dist / speed;
            const gravity = PHYS.GRAVITY * PHYS.SNOWBALL_GRAVITY_SCALE * DT * DT;
            const impactX = sb.x + vx * timeFrames * DT;
            const impactY = sb.y + vy * timeFrames * DT + 0.5 * gravity * timeFrames * timeFrames;
            const impactDist = Math.hypot(impactX - bot.x, impactY - bot.y);

            if (impactDist < 80 && timeFrames < 25) {
                const chance = dodgeSkill * Math.min(1, Math.max(0.1, timeFrames / 20));
                if (Math.random() < chance) {
                    return { dir: dx > 0 ? -1 : 1, jump: timeFrames < 12 };
                }
            }
        }
        return null;
    }

    // ============================================================
    // HOOK (bMod 32-direction scan + release logic)
    // ============================================================
    _handleHook(bot, scene, input, targetX, targetY) {
        const core = bot.core;
        if (!core || !scene.platformLayer) return;

        // FLYING: hold hook
        if (core.hookState === 'FLYING') {
            input.hook = true;
            return;
        }

        // ATTACHED: check release
        if (core.hookState === 'ATTACHED') {
            input.hook = true; // hold by default

            if (targetX === null) {
                // No target — release after short swing
                if (this.hookTime > 600) { input.hook = false; input.jump = true; }
                return;
            }

            const anchor = core.hookAnchorPos || core.hookPos;
            if (!anchor) return;
            const anchorDist = Math.hypot(anchor.x - bot.x, anchor.y - bot.y);

            // Release conditions (bMod)
            if (anchorDist < 20) { input.hook = false; input.jump = true; return; }
            if (this.hookTime > 4000) { input.hook = false; return; }
            if (core.grounded && this.hookTime > 800) { input.hook = false; return; }

            // bMod: don't release over holes if still rising or hook is fresh
            const overHole = this._isOverHole(bot);
            const vy = bot.simpleBody?.vy || 0;
            if (overHole && vy > 0 && this.hookTime < 1500) {
                // Falling over hole with fresh hook — keep holding
                input.direction = (targetX > bot.x) ? 1 : -1;
                return;
            }

            // Dot product: is hook pulling toward target?
            const pullX = anchor.x - bot.x, pullY = anchor.y - bot.y;
            const pullDist = Math.hypot(pullX, pullY) || 1;
            const toDirX = targetX - bot.x, toDirY = targetY - bot.y;
            const toDist = Math.hypot(toDirX, toDirY) || 1;
            const dot = (pullX / pullDist) * (toDirX / toDist) + (pullY / pullDist) * (toDirY / toDist);

            if (dot < 0 && this.hookTime > 600) {
                input.hook = false; input.jump = true; return;
            }

            // Swing: move toward target
            input.direction = toDirX > 0 ? 1 : -1;
            return;
        }

        // IDLE: maybe fire new hook
        if (this.hookCooldown > 0) return;
        if (targetX === null) return;

        // bMod: 10% chance per tick, 25% if over hole
        const overHole = this._isOverHole(bot);
        const chance = overHole ? 0.25 : this.personality.hookChance;
        if (Math.random() > chance) return;

        const hookTarget = this._scanHook(bot, targetX, targetY, scene, overHole);
        if (hookTarget) {
            input.hook = true;
            input.hookTarget = hookTarget;
            this.hookCooldown = PHYS.HOOK_COOLDOWN;
        }
    }

    _isOverHole(bot) {
        const tx = w2t(bot.x), ty = w2t(bot.y);
        if (ty + 1 >= this.mapH) return true;
        return this.grid[ty + 1]?.[tx] !== TILE_SOLID;
    }

    _scanHook(bot, targetX, targetY, scene, overHole) {
        const layer = scene.platformLayer;
        let bestDir = null, bestScore = overHole ? -2 : 0;

        const toDirX = targetX - bot.x, toDirY = targetY - bot.y;
        const toDist = Math.hypot(toDirX, toDirY) || 1;
        const tnx = toDirX / toDist, tny = toDirY / toDist;
        const inputDir = toDirX > 0 ? 1 : -1;

        for (let i = 0; i < HOOK_DIRS; i++) {
            const angle = (2 * Math.PI * i) / HOOK_DIRS;
            const dx = Math.cos(angle), dy = Math.sin(angle);

            // Skip mostly downward hooks (> 72° below horizontal)
            if (dy > 0.7) continue;

            // Raycast
            let hitX = null, hitY = null;
            for (let d = TILE_SIZE * 0.5; d < PHYS.HOOK_RANGE; d += TILE_SIZE * 0.5) {
                const tx = bot.x + dx * d, ty = bot.y + dy * d;
                const tile = layer.getTileAtWorldXY(tx, ty);
                if (tile && tile.index > 0) { hitX = tx; hitY = ty; break; }
            }
            if (!hitX) continue;

            const pullX = hitX - bot.x, pullY = hitY - bot.y;
            const pullDist = Math.hypot(pullX, pullY);
            if (pullDist < HOOK_MIN_DIST) continue;

            // bMod scoring: simulate hook pull velocity
            const pnx = pullX / pullDist, pny = pullY / pullDist;
            let hvx = pnx * 5, hvy = pny * 5;
            if (hvy > 0) hvy *= 0.6;
            hvx *= (hvx * inputDir > 0) ? 0.95 : 0.75;
            hvy += 1.0; // gravity

            const score = tnx * hvx + tny * hvy;
            if (score > bestScore) {
                bestScore = score;
                bestDir = { x: hitX, y: hitY };
            }
        }
        return bestDir;
    }

    // ============================================================
    // MOVEMENT (bMod MakeChoice)
    // ============================================================
    _moveToward(bot, targetX, targetY, input, scene) {
        const dx = targetX - bot.x;
        const dy = targetY - bot.y;

        // Direction
        if (dx > DEADZONE) input.direction = 1;
        else if (dx < -DEADZONE) input.direction = -1;

        if (!bot.core) return;
        const grounded = bot.simpleBody?.grounded || bot.core.grounded;
        const moveDir = input.direction;

        // Stuck detection
        const moved = Math.hypot(bot.x - this.prevX, bot.y - this.prevY);
        this.prevX = bot.x; this.prevY = bot.y;

        if (moved < STUCK_THRESHOLD && moveDir !== 0) {
            this.stuckFrames++;
            if (this.stuckFrames > 3 && grounded && !this.stuckJumped) {
                input.jump = true;
                this.stuckJumped = true;
            } else if (this.stuckFrames > 10 && !grounded && !this.stuckReversed) {
                // Double jump attempt
                input.jump = true;
            } else if (this.stuckFrames > 20) {
                // Reverse direction
                input.direction = -moveDir;
                this.stuckReversed = true;
            }
            if (this.stuckFrames > 30 && bot.core?.hookState === 'IDLE' && this.hookCooldown <= 0 && scene.platformLayer) {
                // bMod: try hook when stuck
                const hookDir = this._scanHook(bot,
                    targetX || bot.x + input.direction * 300,
                    targetY || bot.y - 200, scene, true);
                if (hookDir) {
                    input.hook = true;
                    input.hookTarget = hookDir;
                    this.hookCooldown = PHYS.HOOK_COOLDOWN;
                }
            }
            if (this.stuckFrames > 50) {
                this.stuckFrames = 0;
                this.stuckJumped = false;
                this.stuckReversed = false;
            }
        } else {
            this.stuckFrames = 0;
            this.stuckJumped = false;
            this.stuckReversed = false;
        }

        if (!scene.platformLayer || moveDir === 0) return;

        // Jump conditions (bMod)
        if (grounded) {
            const lookAhead = bot.x + moveDir * TILE_SIZE * 1.2;
            const tileAhead = scene.platformLayer.getTileAtWorldXY(lookAhead, bot.y);

            // Wall ahead
            if (tileAhead && tileAhead.index > 0) {
                // Check wall height
                let wallH = 0;
                for (let wy = 0; wy < 5; wy++) {
                    const wt = scene.platformLayer.getTileAtWorldXY(lookAhead, bot.y - wy * TILE_SIZE);
                    if (!wt || wt.index <= 0) break;
                    wallH = wy + 1;
                }
                if (wallH <= 2) input.jump = true;
                else input.direction = -moveDir; // Too tall, reverse
            }

            // Hole ahead
            const belowAhead = scene.platformLayer.getTileAtWorldXY(
                bot.x + moveDir * TILE_SIZE * 1.5, bot.y + TILE_SIZE);
            if (!belowAhead || belowAhead.index <= 0) {
                if (dy < TILE_SIZE) input.jump = true; // Jump gap if target isn't below
            }

            // Target is above
            if (dy < -TILE_SIZE * 1.5 && Math.abs(dx) < TILE_SIZE * 3) {
                input.jump = true;
            }
        }
    }

    // ============================================================
    // NAVIGATION (A* path following)
    // ============================================================
    _navigateTo(bot, targetX, targetY, input, scene) {
        const btx = w2t(bot.x), bty = w2t(bot.y);
        const ttx = w2t(targetX), tty = w2t(targetY);

        // Recalculate path periodically
        if (!this.path || this.pathAge > PATH_RECALC_MS) {
            this.path = findPath(this.grid, this.mapW, this.mapH, btx, bty, ttx, tty);
            this.pathAge = 0;
        }

        if (!this.path || this.path.length < 2) {
            // No path: just walk toward target
            this._moveToward(bot, targetX, targetY, input, scene);
            return;
        }

        // Find farthest visible waypoint
        const wp = farthestVisible(this.grid, this.mapW, this.mapH, this.path, btx, bty);
        const wpX = t2w(wp.tx), wpY = t2w(wp.ty);

        this._moveToward(bot, wpX, wpY, input, scene);
    }

    // ============================================================
    // PATROL (random wandering)
    // ============================================================
    _patrol(bot, input, scene) {
        if (!this.patrolTarget || this.patrolTimer > PATROL_CHANGE_MS) {
            // Pick random SAFE tile
            const attempts = 30;
            for (let i = 0; i < attempts; i++) {
                const rx = Math.floor(Math.random() * this.mapW);
                const ry = Math.floor(Math.random() * this.mapH);
                if (this.grid[ry]?.[rx] === TILE_SAFE) {
                    this.patrolTarget = { x: t2w(rx), y: t2w(ry) };
                    break;
                }
            }
            this.patrolTimer = 0;
        }

        if (this.patrolTarget) {
            const dist = Math.hypot(this.patrolTarget.x - bot.x, this.patrolTarget.y - bot.y);
            if (dist < TILE_SIZE * 2) {
                this.patrolTarget = null; // Arrived
            } else {
                this._navigateTo(bot, this.patrolTarget.x, this.patrolTarget.y, input, scene);
            }
        }
    }

    // ============================================================
    // PICKUP SEARCH
    // ============================================================
    _findPickup(bot, scene) {
        if (!scene.pickups) return null;
        const health = bot.getData('health') || 0;
        let best = null, bestPri = -1;

        for (const p of scene.pickups) {
            if (!p.active || !p.visible) continue;
            const dist = Math.hypot(p.x - bot.x, p.y - bot.y);
            if (dist > 400) continue;

            const type = p.getData('type');
            let pri = -1;
            if (type === 'health' && health < 50) pri = 5;
            else if (type === 'fire') pri = 4;
            else if (type === 'speed') pri = 3;
            else if (type === 'shield') pri = 2;
            else if (type === 'doublejump') pri = 1;

            if (pri > bestPri) { bestPri = pri; best = p; }
        }
        return best;
    }
}
