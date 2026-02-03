// ============================================
// BOT BEHAVIOR - AI with Behavior3.js + PlatformNav
// ============================================

import { PHYS, TILE_SIZE } from '../config.js';
import { EdgeType } from './PlatformNav.js';
import { executeStrategy } from './ObstacleSolver.js';

// ============================================
// BALLISTIC AIM — gravity-compensated aiming
// ============================================

function aimAtTarget(botX, botY, targetX, targetY, botVx, botVy) {
    const dx = targetX - botX;
    const dy = targetY - botY;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return Math.atan2(dy, dx);

    const baseAngle = Math.atan2(dy, dx);
    const speed = PHYS.SNOWBALL_SPEED;
    const gravityPerFrame = PHYS.GRAVITY * PHYS.SNOWBALL_GRAVITY_SCALE * 0.15;

    // Effective snowball velocity (includes shooter momentum transfer)
    const effectiveVx = speed * Math.cos(baseAngle) + botVx * 0.5;
    const effectiveVy = speed * Math.sin(baseAngle) + botVy * 0.3;
    const effectiveSpeed = Math.hypot(effectiveVx, effectiveVy);

    // Flight time estimate (frames), accounting for 50px spawn offset
    const effectiveDist = Math.max(dist - 50, 1);
    const flightFrames = effectiveDist / effectiveSpeed;

    // Gravity drop: 0.5 * g * t^2
    const gravityDrop = 0.5 * gravityPerFrame * flightFrames * flightFrames;

    // Aim higher by gravity drop amount
    const compensatedAngle = Math.atan2(dy - gravityDrop, dx);

    // Slight random scatter for natural feel (±0.05 rad ≈ ±2.9°)
    const scatter = (Math.random() - 0.5) * 0.10;
    return compensatedAngle + scatter;
}

// ============================================
// REACTIVE HOOK SYSTEM (Teeworlds-style)
// Each tick: decide fire / hold / release based on current physics
// ============================================

/**
 * Find best hook direction (bMod-style: full 360° scan, dot-product scoring).
 * @param {boolean} overHole - true if bot is over a gap (lowers threshold)
 */
function findBestHookDirection(bot, targetX, targetY, platformLayer, overHole = false) {
    const NUM_DIRS = 16;
    const hookRange = PHYS.HOOK_RANGE;
    let bestDir = null;
    let bestScore = overHole ? -10000 : 0; // bMod: accept any direction over holes

    const toTargetX = targetX - bot.x;
    const toTargetY = targetY - bot.y;
    const toTargetDist = Math.hypot(toTargetX, toTargetY);
    if (toTargetDist < 1) return null;

    const inputDir = toTargetX > 0 ? 1 : -1;

    for (let i = 0; i < NUM_DIRS; i++) {
        // Full 360° scan (bMod scans all directions)
        const angle = (2 * Math.PI * i) / NUM_DIRS;

        const dx = Math.cos(angle);
        const dy = Math.sin(angle);

        // Raycast: find first solid tile along this direction
        let hitX = null, hitY = null;
        for (let d = TILE_SIZE * 0.5; d < hookRange; d += TILE_SIZE * 0.5) {
            const testX = bot.x + dx * d;
            const testY = bot.y + dy * d;
            const tile = platformLayer.getTileAtWorldXY(testX, testY);
            if (tile && tile.index > 0) {
                hitX = testX;
                hitY = testY;
                break;
            }
        }
        if (!hitX) continue;
        if (hitY >= bot.y) continue; // Don't hook below self — just fall down

        const pullX = hitX - bot.x;
        const pullY = hitY - bot.y;
        const pullDist = Math.hypot(pullX, pullY);
        if (pullDist < 32) continue; // bMod: 32px minimum (was 84px)

        // bMod drag physics scoring
        const pnx = pullX / pullDist;
        const pny = pullY / pullDist;
        let hookVelX = pnx * 5;
        let hookVelY = pny * 5;
        if (hookVelY > 0) hookVelY *= 0.3;
        if ((hookVelX < 0 && inputDir < 0) || (hookVelX > 0 && inputDir > 0))
            hookVelX *= 0.95;
        else
            hookVelX *= 0.75;
        hookVelY += 1.0; // gravity

        // Dot product with target direction
        const tnx = toTargetX / toTargetDist;
        const tny = toTargetY / toTargetDist;
        const score = tnx * hookVelX + tny * hookVelY;

        if (score > bestScore) {
            bestScore = score;
            bestDir = { x: hitX, y: hitY };
        }
    }
    return bestDir;
}

/**
 * shouldReleaseHook — bMod-style: dot product with target + timeout + distance.
 * Returns 'JUMP' (release + jump), 'RELEASE' (just release), or null (keep).
 */
function shouldReleaseHook(bot, targetX, targetY, core, hookTimer) {
    const anchorPos = core.hookAnchor?.position;
    if (!anchorPos) return hookTimer > 2000 ? 'RELEASE' : null;

    const ax = anchorPos.x - bot.x;
    const ay = anchorPos.y - bot.y;
    const anchorDist = Math.hypot(ax, ay);

    // bMod: too close to anchor → release
    if (anchorDist < 20) return 'JUMP';

    // bMod: timeout ~4 seconds → release
    if (hookTimer > 4000) return 'RELEASE';

    // Grounded after swinging → done
    if (core.grounded && hookTimer > 300) return 'RELEASE';

    // bMod: compute hook drag velocity and dot with target
    const toTargetX = targetX - bot.x;
    const toTargetY = targetY - bot.y;
    const tDist = Math.hypot(toTargetX, toTargetY);
    if (tDist < 1) return 'JUMP';

    if (anchorDist > 1) {
        let hookVelX = (ax / anchorDist) * 5;
        let hookVelY = (ay / anchorDist) * 5;
        if (hookVelY > 0) hookVelY *= 0.3;

        const inputDir = toTargetX > 0 ? 1 : -1;
        if ((hookVelX < 0 && inputDir < 0) || (hookVelX > 0 && inputDir > 0))
            hookVelX *= 0.95;
        else
            hookVelX *= 0.75;
        hookVelY += 1.0; // gravity

        const hookDot = (toTargetX / tDist) * hookVelX + (toTargetY / tDist) * hookVelY;

        // bMod: if hook is pulling toward target → keep
        if (hookDot > 0) return null;
    }

    // Hook not helping → release with jump for momentum
    if (hookTimer > 300) return 'JUMP';
    return null;
}

/**
 * Reactive hook tick — bMod-style: simple FLYING/ATTACHED/IDLE state machine.
 * Returns: 'FIRED' | 'SWINGING' | 'RELEASED' | 'IDLE'
 */
function reactiveHookTick(bot, targetX, targetY, input, tick) {
    const core = bot.core;
    if (!core) return 'IDLE';
    const { scene } = tick.blackboard.get('context');
    if (!scene.platformLayer) return 'IDLE';

    const hookTimer = tick.blackboard.get('reactiveHookTimer') || 0;
    const delta = tick.blackboard.get('delta') || 16;
    const dx = targetX - bot.x;

    // --- FLYING: maintain hook, move toward target ---
    if (core.hookState === 'FLYING') {
        input.hook = true;
        input.direction = dx > 0 ? 1 : -1;
        tick.blackboard.set('reactiveHookTimer', hookTimer + delta);
        return 'SWINGING';
    }

    // --- ATTACHED: bMod-style swing ---
    if (core.hookState === 'ATTACHED') {
        tick.blackboard.set('reactiveHookTimer', hookTimer + delta);

        // bMod: move left/right toward target while swinging
        input.direction = dx > 0 ? 1 : -1;

        // Apply swing force (helps pendulum motion)
        if (core.body) {
            core.scene.matter.body.applyForce(core.body, core.body.position, {
                x: input.direction * 0.015,
                y: 0
            });
        }

        // bMod reel gating: reel only if anchor is toward target
        const anchorPos = core.hookAnchor?.position;
        if (anchorPos && bot.setData) {
            const toTargetX = targetX - bot.x;
            const toTargetY = targetY - bot.y;
            const tDist = Math.hypot(toTargetX, toTargetY);
            const ax = anchorPos.x - bot.x;
            const ay = anchorPos.y - bot.y;
            const aDist = Math.hypot(ax, ay);
            let reelDot = 0;
            if (tDist > 1 && aDist > 1) {
                reelDot = (ax / aDist) * (toTargetX / tDist) +
                          (ay / aDist) * (toTargetY / tDist);
            }
            bot.setData('hookNoReel', reelDot <= 0.3);
        }

        // Check release conditions
        const release = shouldReleaseHook(bot, targetX, targetY, core, hookTimer);
        if (release === 'JUMP') {
            if (bot.setData) bot.setData('hookNoReel', false);
            input.jump = true;
            input.hookJustPressed = true;
            tick.blackboard.set('reactiveHookTimer', 0);
            tick.blackboard.set('reactiveHookCooldown', 500);
            return 'RELEASED';
        }
        if (release === 'RELEASE') {
            if (bot.setData) bot.setData('hookNoReel', false);
            input.hookJustPressed = true;
            tick.blackboard.set('reactiveHookTimer', 0);
            tick.blackboard.set('reactiveHookCooldown', 800);
            return 'RELEASED';
        }

        // bMod: keep hook
        input.hook = true;
        return 'SWINGING';
    }

    // --- IDLE: no hook active ---
    input.direction = dx > 0 ? 1 : -1;
    return 'IDLE';
}

// Get b3 from global scope (loaded via script tag)
const b3 = window.b3;

// ============================================
// AI CONSTANTS
// ============================================

const AI = {
    // Vision (fallback when camera not available)
    VISION_RANGE_DEFAULT: 1400,
    MEMORY_DURATION: 5000,

    // Attack
    ATTACK_RANGE_MIN: 0,
    ATTACK_RANGE_MAX: 400,
    SHOOT_COOLDOWN_MIN: 800,
    SHOOT_COOLDOWN_MAX: 1500,
    SHOOT_REACTION_DELAY: 200,

    // Movement
    CHASE_DEADZONE: 30,
    CHASE_SPEED_MIN: 0.7,
    CHASE_SPEED_MAX: 1.0,

    // Hook
    HOOK_COOLDOWN: 500,
    HOOK_MAX_SWING: 2000,

    // Wall detection
    WALL_SPEED_THRESHOLD: 0.5,

    // Navigation
    PATH_RECALC_MS: 1000,
    PATH_RECALC_DIST: 140,

    // Patrol
    PATROL_CHANGE_MS: 6000,
};

// ============================================
// CONDITION NODES (kept from original)
// ============================================

class CanSeeTarget extends b3.Condition {
    tick(tick) {
        const { bot, scene } = tick.blackboard.get('context');
        const target = tick.blackboard.get('target');

        if (!target || !target.active) return b3.FAILURE;

        const dist = Math.hypot(target.x - bot.x, target.y - bot.y);
        const visionRange = tick.blackboard.get('visionRange') || AI.VISION_RANGE_DEFAULT;
        if (dist > visionRange) return b3.FAILURE;

        if (scene.platformLayer) {
            const line = new Phaser.Geom.Line(bot.x, bot.y, target.x, target.y);
            const tiles = scene.platformLayer.getTilesWithinShape(line);
            for (const tile of tiles) {
                if (tile && tile.index > 0) return b3.FAILURE;
            }
        }

        tick.blackboard.set('lastTargetPos', { x: target.x, y: target.y });
        tick.blackboard.set('lastTargetSeen', Date.now());
        return b3.SUCCESS;
    }
}

class IsInAttackRange extends b3.Condition {
    constructor(range = AI.ATTACK_RANGE_MAX) {
        super();
        this.range = range;
    }
    tick(tick) {
        const { bot } = tick.blackboard.get('context');
        const target = tick.blackboard.get('target');
        if (!target || !target.active) return b3.FAILURE;
        const dist = Math.hypot(target.x - bot.x, target.y - bot.y);
        return dist < this.range && dist > AI.ATTACK_RANGE_MIN ? b3.SUCCESS : b3.FAILURE;
    }
}

class CanShoot extends b3.Condition {
    tick(tick) {
        return (tick.blackboard.get('shootCooldown') || 0) <= 0 ? b3.SUCCESS : b3.FAILURE;
    }
}

class HasTarget extends b3.Condition {
    tick(tick) {
        const target = tick.blackboard.get('target');
        return (target && target.active) ? b3.SUCCESS : b3.FAILURE;
    }
}

class HasMemoryOfTarget extends b3.Condition {
    tick(tick) {
        const lastPos = tick.blackboard.get('lastTargetPos');
        const lastSeen = tick.blackboard.get('lastTargetSeen') || 0;
        if (!lastPos) return b3.FAILURE;
        if (Date.now() - lastSeen > AI.MEMORY_DURATION) {
            tick.blackboard.set('lastTargetPos', null);
            return b3.FAILURE;
        }
        return b3.SUCCESS;
    }
}

class SnowballIncoming extends b3.Condition {
    tick(tick) {
        const { bot, scene } = tick.blackboard.get('context');
        if (!scene.snowballs || scene.snowballs.length === 0) return b3.FAILURE;

        for (const sb of scene.snowballs) {
            if (!sb.active) continue;
            if (sb.getData && sb.getData('shooter') === bot) continue;

            const dx = sb.x - bot.x;
            const dy = sb.y - bot.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 250) continue;

            const vx = sb.body ? sb.body.velocity.x : 0;
            const heading = vx > 0 ? 1 : -1;

            if ((heading > 0 && dx < 0) || (heading < 0 && dx > 0)) {
                if (Math.random() < 0.6) {
                    tick.blackboard.set('dodgeDir', dx > 0 ? -1 : 1);
                    return b3.SUCCESS;
                }
            }
        }
        return b3.FAILURE;
    }
}

class NearbyPickup extends b3.Condition {
    tick(tick) {
        const { bot, scene } = tick.blackboard.get('context');
        if (!scene.pickups || scene.pickups.length === 0) return b3.FAILURE;

        const health = bot.getData('health') || 0;
        const maxHealth = 100;
        let bestPickup = null;
        let bestPriority = -1;

        for (const pickup of scene.pickups) {
            if (!pickup.active || !pickup.visible) continue;
            const dist = Math.hypot(pickup.x - bot.x, pickup.y - bot.y);

            const type = pickup.getData('type');
            let priority = -1;
            let maxDist = 300;

            if (type === 'health' && health < maxHealth * 0.5) { priority = 5; maxDist = 400; }
            else if (type === 'fire') { priority = 4; }
            else if (type === 'speed') { priority = 3; }
            else if (type === 'shield') { priority = 2; }
            else if (type === 'doublejump') { priority = 1; }

            if (priority > bestPriority && dist < maxDist) {
                bestPriority = priority;
                bestPickup = pickup;
            }
        }

        if (bestPickup) {
            tick.blackboard.set('targetPickup', bestPickup);
            return b3.SUCCESS;
        }
        return b3.FAILURE;
    }
}

// ============================================
// ACTION NODES (combat - kept from original)
// ============================================

class DodgeSnowball extends b3.Action {
    tick(tick) {
        const input = tick.blackboard.get('input');
        const dodgeDir = tick.blackboard.get('dodgeDir') || 1;
        input.jump = true;
        input.direction = dodgeDir;
        return b3.SUCCESS;
    }
}

class Shoot extends b3.Action {
    tick(tick) {
        const { bot } = tick.blackboard.get('context');
        const target = tick.blackboard.get('target');
        const input = tick.blackboard.get('input');

        const reactionTimer = tick.blackboard.get('shootReaction') || 0;
        if (reactionTimer > 0) return b3.FAILURE;

        if (target) {
            const dx = target.x - bot.x;
            bot.setData('facingRight', dx > 0);
            const botVx = bot.body?.velocity?.x || 0;
            const botVy = bot.body?.velocity?.y || 0;
            input.fireAngle = aimAtTarget(bot.x, bot.y, target.x, target.y, botVx, botVy);
        } else {
            input.fireAngle = bot.getData('facingRight') ? 0 : Math.PI;
        }

        input.fire = true;
        tick.blackboard.set('shootCooldown', AI.SHOOT_COOLDOWN_MIN + Math.random() * (AI.SHOOT_COOLDOWN_MAX - AI.SHOOT_COOLDOWN_MIN));
        return b3.SUCCESS;
    }
}

class GoToPickup extends b3.Action {
    tick(tick) {
        const { bot } = tick.blackboard.get('context');
        const input = tick.blackboard.get('input');
        const pickup = tick.blackboard.get('targetPickup');

        if (!pickup || !pickup.active) return b3.FAILURE;

        const dx = pickup.x - bot.x;
        if (Math.abs(dx) < 30) {
            if (pickup.y < bot.y - 20) input.jump = true;
            return b3.SUCCESS;
        }

        const speedMult = tick.blackboard.get('speedMultiplier') || 1;
        input.direction = dx > 0 ? 1 * speedMult : -1 * speedMult;
        return b3.RUNNING;
    }
}

class SwingOnHook extends b3.Action {
    tick(tick) {
        const { bot } = tick.blackboard.get('context');
        const target = tick.blackboard.get('target');
        const input = tick.blackboard.get('input');

        const core = bot.core;
        if (!core || core.hookState === 'IDLE') return b3.FAILURE;

        // Don't interfere with TriNav's hook management (reactiveHookTick handles it)
        if (tick.blackboard.get('triWaypoints') || tick.blackboard.get('triMemWaypoints') || tick.blackboard.get('triPatrolWaypoints')) {
            return b3.FAILURE;
        }

        // UseHookToClimb or ObstacleSolver handles its own hook — don't interfere
        if (tick.blackboard.get('hookClimbPhase') && tick.blackboard.get('hookClimbPhase') !== 'SCAN') {
            return b3.FAILURE;
        }
        if (tick.blackboard.get('activeStrategy')) {
            return b3.FAILURE;
        }

        // Swing toward platform edge, not target
        const { scene } = tick.blackboard.get('context');
        const anchorPos = core.hookAnchor?.position;
        if (anchorPos && scene.platformLayer) {
            const checkDist = TILE_SIZE * 1.5;
            const tileLeft = scene.platformLayer.getTileAtWorldXY(anchorPos.x - checkDist, anchorPos.y);
            const tileRight = scene.platformLayer.getTileAtWorldXY(anchorPos.x + checkDist, anchorPos.y);
            const leftOpen = !tileLeft || tileLeft.index <= 0;
            const rightOpen = !tileRight || tileRight.index <= 0;
            if (leftOpen && !rightOpen) input.direction = -1;
            else if (rightOpen && !leftOpen) input.direction = 1;
            else input.direction = (bot.x < anchorPos.x) ? -1 : 1;
        } else {
            input.direction = tick.blackboard.get('swingDir') || 1;
        }

        const hookTime = tick.blackboard.get('hookTime') || 0;
        const vy = core.body ? core.body.velocity.y : 0;

        // 1. Landed — release hook
        if (core.grounded && hookTime > 600) {
            input.hookJustPressed = true;
            tick.blackboard.set('hookTime', 0);
            return b3.SUCCESS;
        }

        // 2. Moving upward strongly — jump-release for velocity boost
        if (hookTime > 600 && vy < -2) {
            if (!target || bot.y < target.y + TILE_SIZE) {
                input.jump = true;
                tick.blackboard.set('hookTime', 0);
                return b3.SUCCESS;
            }
        }

        // 3. Timeout
        if (hookTime > AI.HOOK_MAX_SWING) {
            input.jump = true;
            tick.blackboard.set('hookTime', 0);
            return b3.SUCCESS;
        }

        return b3.RUNNING;
    }
}

class FindClosestTarget extends b3.Action {
    tick(tick) {
        const { bot, scene } = tick.blackboard.get('context');
        let closest = null;
        let closestDist = Infinity;

        // Gather candidates
        const candidates = [];
        if (scene.player?.active && scene.player.getData('health') > 0) {
            candidates.push(scene.player);
        }
        for (const other of scene.bots || []) {
            if (other === bot || !other.active || other.getData('health') <= 0) continue;
            candidates.push(other);
        }

        // Find closest visible target (within vision range + line of sight)
        const visionRange = tick.blackboard.get('visionRange') || AI.VISION_RANGE_DEFAULT;
        let canSee = false;
        for (const c of candidates) {
            const dist = Math.hypot(c.x - bot.x, c.y - bot.y);
            if (dist > visionRange || dist >= closestDist) continue;

            // Line-of-sight check — walls block vision
            if (scene.platformLayer) {
                const line = new Phaser.Geom.Line(bot.x, bot.y, c.x, c.y);
                const tiles = scene.platformLayer.getTilesWithinShape(line);
                let blocked = false;
                for (const t of tiles) {
                    if (t && t.index > 0) { blocked = true; break; }
                }
                if (blocked) continue;
            }

            closestDist = dist;
            closest = c;
            canSee = true;
        }

        // Awareness fallback: if no visible target, find closest by distance only
        // Bot "senses" nearby enemies even without line of sight (for navigation)
        if (!closest) {
            for (const c of candidates) {
                const dist = Math.hypot(c.x - bot.x, c.y - bot.y);
                if (dist > visionRange || dist >= closestDist) continue;
                closestDist = dist;
                closest = c;
            }
        }

        tick.blackboard.set('target', closest);

        // Update memory ONLY when we actually see the target
        if (closest && canSee) {
            tick.blackboard.set('lastTargetPos', { x: closest.x, y: closest.y });
            tick.blackboard.set('lastTargetSeen', Date.now());

            const prevTarget = tick.blackboard.get('prevTarget');
            if (closest !== prevTarget) {
                tick.blackboard.set('shootReaction', AI.SHOOT_REACTION_DELAY);
                tick.blackboard.set('prevTarget', closest);
            }
        }

        return b3.SUCCESS;
    }
}

// ============================================
// NAVIGATION NODES (new — uses PlatformNav)
// ============================================

class NavigateToTarget extends b3.Action {
    tick(tick) {
        const { bot, scene } = tick.blackboard.get('context');
        const target = tick.blackboard.get('target');
        const input = tick.blackboard.get('input');
        const delta = tick.blackboard.get('delta') || 16;

        if (!target || !target.active) return b3.FAILURE;

        const nav = scene.platformNav;
        if (!nav) return b3.FAILURE;

        // Get or recalculate path
        let path = tick.blackboard.get('navPath');
        let pathAge = tick.blackboard.get('navPathAge') || 0;
        const lastTX = tick.blackboard.get('navLastTX') || 0;
        const lastTY = tick.blackboard.get('navLastTY') || 0;
        const targetMoved = Math.hypot(target.x - lastTX, target.y - lastTY) > AI.PATH_RECALC_DIST;

        pathAge += delta;

        // Don't recalc on timer if bot is making progress through path segments
        const currentSegIdx = tick.blackboard.get('navSegIndex') || 0;
        const shouldRecalc = !path || targetMoved
            || (pathAge > AI.PATH_RECALC_MS && currentSegIdx === 0)
            || pathAge > AI.PATH_RECALC_MS * 4; // Force recalc after 8s even mid-path
        if (shouldRecalc) {
            path = nav.findPath(bot.x, bot.y, target.x, target.y);
            tick.blackboard.set('navPath', path);
            tick.blackboard.set('navPathAge', 0);
            tick.blackboard.set('navSegIndex', 0);
            tick.blackboard.set('navLastTX', target.x);
            tick.blackboard.set('navLastTY', target.y);
            tick.blackboard.set('navSegPhase', 'APPROACH');
            tick.blackboard.set('pathFailCount', 0);
            tick.blackboard.set('fbStuckFrames', 0);
            tick.blackboard.set('fbStuckEscalation', 0);
            tick.blackboard.set('fbStuckTimer', 0);
        } else {
            tick.blackboard.set('navPathAge', pathAge);
        }

        if (!path || path.length === 0) {
            // A* can't find path — try ObstacleSolver (hook to reach target)
            const activeStrategy = tick.blackboard.get('activeStrategy');
            if (activeStrategy) {
                const result = executeStrategy(bot, activeStrategy, input, delta);
                if (result === 'DONE' || result === 'FAILED') {
                    tick.blackboard.set('activeStrategy', null);
                }
                return b3.RUNNING;
            }
            if (scene.obstacleSolver && bot.core?.grounded && bot.core?.hookState === 'IDLE') {
                const hookCooldown = tick.blackboard.get('hookCooldown') || 0;
                const lastStrategyType = tick.blackboard.get('lastStrategyType') || null;
                if (hookCooldown <= 0) {
                    const strategy = scene.obstacleSolver.solve(bot,
                        { fromX: bot.x, fromY: bot.y, toX: target.x, toY: target.y },
                        { hookCooldown, hookState: 'IDLE', lastStrategyType, waterY: scene.waterY });
                    if (strategy) {
                        tick.blackboard.set('activeStrategy', strategy);
                        tick.blackboard.set('lastStrategyType', strategy.type);
                        return b3.RUNNING;
                    }
                }
            }
            // Fallback: walk toward target with wall/stuck awareness
            const fbResult = fallbackWalk(tick, bot, target.x, input);
            if (fbResult === 'STUCK') return b3.FAILURE;
            return b3.RUNNING;
        }

        // Too many stuck failures — abandon this path, fall through to patrol
        if ((tick.blackboard.get('pathFailCount') || 0) >= 3) {
            tick.blackboard.set('pathFailCount', 0);
            tick.blackboard.set('navPath', null);
            return b3.FAILURE;
        }

        // Direct chase when on same platform — update target every tick
        if (path && path.length === 1 && !path[0].edge) {
            path[0].targetX = target.x;
        }

        let segIdx = tick.blackboard.get('navSegIndex') || 0;
        if (segIdx >= path.length) return b3.SUCCESS;

        const segment = path[segIdx];
        const result = executeSegment(tick, bot, segment, input);

        if (result === 'DONE') {
            tick.blackboard.set('navSegIndex', segIdx + 1);
            tick.blackboard.set('navSegPhase', 'APPROACH');
            tick.blackboard.set('lastStrategyType', null);
            if (segIdx + 1 >= path.length) return b3.SUCCESS;
        }

        return b3.RUNNING;
    }
}

class NavigateToMemory extends b3.Action {
    tick(tick) {
        const { bot, scene } = tick.blackboard.get('context');
        const input = tick.blackboard.get('input');
        const lastPos = tick.blackboard.get('lastTargetPos');
        const delta = tick.blackboard.get('delta') || 16;

        if (!lastPos) return b3.FAILURE;

        const nav = scene.platformNav;
        if (!nav) return b3.FAILURE;

        // Reuse same path logic but toward memory position
        let path = tick.blackboard.get('memNavPath');
        let pathAge = tick.blackboard.get('memNavPathAge') || 0;
        pathAge += delta;

        // Don't recalc on timer if bot is making progress through path segments
        const memSegIdx = tick.blackboard.get('memNavSegIndex') || 0;
        if (!path || (pathAge > AI.PATH_RECALC_MS && memSegIdx === 0) || pathAge > AI.PATH_RECALC_MS * 4) {
            path = nav.findPath(bot.x, bot.y, lastPos.x, lastPos.y);
            tick.blackboard.set('memNavPath', path);
            tick.blackboard.set('memNavPathAge', 0);
            tick.blackboard.set('memNavSegIndex', 0);
            tick.blackboard.set('memNavSegPhase', 'APPROACH');
            tick.blackboard.set('pathFailCount', 0);
            tick.blackboard.set('fbStuckFrames', 0);
            tick.blackboard.set('fbStuckEscalation', 0);
            tick.blackboard.set('fbStuckTimer', 0);
        } else {
            tick.blackboard.set('memNavPathAge', pathAge);
        }

        if (!path || path.length === 0) {
            // A* can't find path — try ObstacleSolver (hook to reach memory pos)
            const activeStrategy = tick.blackboard.get('activeStrategy');
            if (activeStrategy) {
                const result = executeStrategy(bot, activeStrategy, input, delta);
                if (result === 'DONE' || result === 'FAILED') {
                    tick.blackboard.set('activeStrategy', null);
                }
                return b3.RUNNING;
            }
            if (scene.obstacleSolver && bot.core?.grounded && bot.core?.hookState === 'IDLE') {
                const hookCooldown = tick.blackboard.get('hookCooldown') || 0;
                const lastStrategyType = tick.blackboard.get('lastStrategyType') || null;
                if (hookCooldown <= 0) {
                    const strategy = scene.obstacleSolver.solve(bot,
                        { fromX: bot.x, fromY: bot.y, toX: lastPos.x, toY: lastPos.y },
                        { hookCooldown, hookState: 'IDLE', lastStrategyType, waterY: scene.waterY });
                    if (strategy) {
                        tick.blackboard.set('activeStrategy', strategy);
                        tick.blackboard.set('lastStrategyType', strategy.type);
                        return b3.RUNNING;
                    }
                }
            }
            // Fallback: walk toward memory with wall/stuck awareness
            const fbResult = fallbackWalk(tick, bot, lastPos.x, input);
            if (fbResult === 'ARRIVED' || fbResult === 'STUCK') {
                tick.blackboard.set('lastTargetPos', null);
                return fbResult === 'ARRIVED' ? b3.SUCCESS : b3.FAILURE;
            }
            return b3.RUNNING;
        }

        let segIdx = tick.blackboard.get('memNavSegIndex') || 0;
        if (segIdx >= path.length) {
            tick.blackboard.set('lastTargetPos', null);
            return b3.SUCCESS;
        }

        const segment = path[segIdx];
        const result = executeSegment(tick, bot, segment, input);

        if (result === 'DONE') {
            tick.blackboard.set('memNavSegIndex', segIdx + 1);
            tick.blackboard.set('memNavSegPhase', 'APPROACH');
            tick.blackboard.set('lastStrategyType', null);
        }

        return b3.RUNNING;
    }
}

class PatrolPlatforms extends b3.Action {
    tick(tick) {
        const { bot, scene } = tick.blackboard.get('context');
        const input = tick.blackboard.get('input');
        const delta = tick.blackboard.get('delta') || 16;
        const nav = scene.platformNav;

        // Anti-freeze: forced random action after inactivity
        if (tick.blackboard.get('forceRandomAction')) {
            tick.blackboard.set('forceRandomAction', false);
            input.direction = Math.random() > 0.5 ? 1 : -1;
            input.jump = true;
            // No random hook here — it causes SwingOnHook hijack loops
            return b3.RUNNING;
        }

        if (!nav || nav.platforms.length === 0) {
            // Fallback: simple walk
            const dir = tick.blackboard.get('patrolDir') || 1;
            input.direction = dir;
            return b3.RUNNING;
        }

        // Pick or keep a patrol target platform
        let patrolTarget = tick.blackboard.get('patrolTarget');
        let patrolTimer = tick.blackboard.get('patrolTimer') || 0;
        patrolTimer += delta;

        if (!patrolTarget || patrolTimer > AI.PATROL_CHANGE_MS) {
            // Pick a random platform that isn't our current one (avoid water-level platforms)
            const currentPlatform = nav.getPlatformAt(bot.x, bot.y);
            const waterY = scene.waterY;
            const candidates = nav.platforms.filter(p => {
                if (currentPlatform && p.id === currentPlatform.id) return false;
                if (waterY && p.surfaceY >= waterY - TILE_SIZE * 2) return false;
                return true;
            });
            const target = tick.blackboard.get('target');
            if (target && candidates.length > 0) {
                // Bias toward platforms closer to target
                candidates.sort((a, b) => {
                    const distA = Math.hypot(a.centerX - target.x, a.surfaceY - target.y);
                    const distB = Math.hypot(b.centerX - target.x, b.surfaceY - target.y);
                    return distA - distB;
                });
                const topN = Math.min(3, candidates.length);
                patrolTarget = candidates[Math.floor(Math.random() * topN)];
            } else if (candidates.length > 0) {
                patrolTarget = candidates[Math.floor(Math.random() * candidates.length)];
            } else {
                patrolTarget = nav.platforms[Math.floor(Math.random() * nav.platforms.length)];
            }
            tick.blackboard.set('patrolTarget', patrolTarget);
            tick.blackboard.set('patrolTimer', 0);
            tick.blackboard.set('patrolPath', null);
            patrolTimer = 0;
        } else {
            tick.blackboard.set('patrolTimer', patrolTimer);
        }

        // Navigate to patrol target
        let path = tick.blackboard.get('patrolPath');
        if (!path) {
            path = nav.findPath(bot.x, bot.y, patrolTarget.centerX, patrolTarget.surfaceY - TILE_SIZE);
            tick.blackboard.set('patrolPath', path);
            tick.blackboard.set('patrolSegIndex', 0);
            tick.blackboard.set('patrolSegPhase', 'APPROACH');
            tick.blackboard.set('pathFailCount', 0);
            tick.blackboard.set('fbStuckFrames', 0);
            tick.blackboard.set('fbStuckEscalation', 0);
            tick.blackboard.set('fbStuckTimer', 0);
        }

        if (!path || path.length === 0) {
            // A* can't find path — try ObstacleSolver (hook to reach platform)
            const activeStrategy = tick.blackboard.get('activeStrategy');
            if (activeStrategy) {
                const result = executeStrategy(bot, activeStrategy, input, delta);
                if (result === 'DONE' || result === 'FAILED') {
                    tick.blackboard.set('activeStrategy', null);
                    tick.blackboard.set('patrolTarget', null);
                }
                return b3.RUNNING;
            }
            if (scene.obstacleSolver && bot.core?.grounded && bot.core?.hookState === 'IDLE') {
                const hookCooldown = tick.blackboard.get('hookCooldown') || 0;
                const lastStrategyType = tick.blackboard.get('lastStrategyType') || null;
                if (hookCooldown <= 0) {
                    const strategy = scene.obstacleSolver.solve(bot,
                        { fromX: bot.x, fromY: bot.y, toX: patrolTarget.centerX, toY: patrolTarget.surfaceY - TILE_SIZE },
                        { hookCooldown, hookState: 'IDLE', lastStrategyType, waterY: scene.waterY });
                    if (strategy) {
                        tick.blackboard.set('activeStrategy', strategy);
                        tick.blackboard.set('lastStrategyType', strategy.type);
                        return b3.RUNNING;
                    }
                }
            }
            // Can't reach — walk toward target with wall/stuck awareness
            const fbResult = fallbackWalk(tick, bot, patrolTarget.centerX, input);
            if (fbResult === 'STUCK' || fbResult === 'ARRIVED') {
                tick.blackboard.set('patrolTarget', null);
            }
            return b3.RUNNING;
        }

        let segIdx = tick.blackboard.get('patrolSegIndex') || 0;
        if (segIdx >= path.length) {
            // Reached destination — pick new one
            tick.blackboard.set('patrolTarget', null);
            return b3.RUNNING;
        }

        const segment = path[segIdx];
        const result = executeSegment(tick, bot, segment, input);

        if (result === 'DONE') {
            tick.blackboard.set('patrolSegIndex', segIdx + 1);
            tick.blackboard.set('patrolSegPhase', 'APPROACH');
            tick.blackboard.set('lastStrategyType', null);
        }

        // Random hook attempt during idle patrol (1% per tick, occasional exploration)
        if (bot.core?.hookState === 'IDLE' && bot.core?.grounded && Math.random() < 0.05) {
            if (scene.platformLayer) {
                const randomTargetX = bot.x + (Math.random() > 0.5 ? 400 : -400);
                const randomTargetY = bot.y - 300;
                const hookDir = findBestHookDirection(bot, randomTargetX, randomTargetY, scene.platformLayer);
                if (hookDir) {
                    input.hookJustPressed = true;
                    input.hookTarget = hookDir;
                }
            }
        }

        return b3.RUNNING;
    }
}

// ============================================
// TRINAV NAVIGATION — tile-grid free-space pathfinding (bMod-style)
// ============================================

/**
 * Reactive movement toward a waypoint.
 * Decides jump/hook based on current physics state, not edge types.
 */
/**
 * reactiveMove — bMod-style movement: walk + jump + random hook.
 * Much simpler than before: no hookAfterJumpTimer, no complex conditions.
 */
function reactiveMove(bot, targetX, targetY, input, tick) {
    const core = bot.core;
    const { scene } = tick.blackboard.get('context');
    const dx = targetX - bot.x;
    const dy = targetY - bot.y;
    const absDx = Math.abs(dx);

    // 1. Direction toward waypoint (bMod: 28px threshold)
    if (absDx > 28) {
        input.direction = dx > 0 ? 1 : -1;
    } else if (dy > TILE_SIZE && core?.grounded) {
        // Waypoint is below and close horizontally — keep moving to walk off edge
        input.direction = dx >= 0 ? 1 : -1;
    }

    // 2. If hook is active, delegate to hook tick
    if (core && core.hookState !== 'IDLE') {
        reactiveHookTick(bot, targetX, targetY, input, tick);
        return;
    }

    // Cooldown management
    const delta = tick.blackboard.get('delta') || 16;
    const hookCooldown = tick.blackboard.get('reactiveHookCooldown') || 0;
    if (hookCooldown > 0) {
        tick.blackboard.set('reactiveHookCooldown', hookCooldown - delta);
    }

    // Detect if over a hole
    let overHole = false;
    if (scene.platformLayer) {
        const below = scene.platformLayer.getTileAtWorldXY(bot.x, bot.y + TILE_SIZE);
        overHole = !below || below.index <= 0;
    }

    // 3. Jump conditions (bMod-style, simple)
    if (core?.grounded && scene.platformLayer && input.direction !== 0) {
        const moveDir = input.direction;

        // 3a. Wall ahead → jump (bMod: if position doesn't change, jump)
        const vxAbs = Math.abs(core.body?.velocity?.x || 0);
        const lookAhead = 25 + Math.max(vxAbs, 4) * 4;
        const wallTile = scene.platformLayer.getTileAtWorldXY(
            bot.x + moveDir * lookAhead, bot.y);
        if (wallTile && wallTile.index > 0) {
            // Don't jump if waypoint is far below (need to descend)
            if (dy < TILE_SIZE * 2) {
                input.jump = true;
            }
        }

        // 3b. Gap ahead → jump (bMod: safe tile + hole ahead → jump)
        const aheadX = bot.x + moveDir * TILE_SIZE * 1.5;
        const belowAhead = scene.platformLayer.getTileAtWorldXY(aheadX, bot.y + TILE_SIZE);
        if (!belowAhead || belowAhead.index <= 0) {
            // Only jump if waypoint is NOT far below (otherwise fall)
            if (dy < TILE_SIZE) {
                input.jump = true;
            }
        }
    }

    // 3c. Target above + close horizontally → jump (bMod: target.y < 0 && abs(x) < 28)
    if (dy < -TILE_SIZE * 0.3 && absDx < TILE_SIZE * 0.5 && core?.grounded) {
        input.jump = true;
    }

    // 3d. Target above → jump anyway (to get airborne for hook)
    if (dy < -TILE_SIZE * 1.0 && core?.grounded) {
        input.jump = true;
    }

    // 3e. Stuck detection (bMod: position not changing → jump, then double jump)
    // But NOT when target is below — bot needs to walk off edge, not jump
    const stuckFrames = tick.blackboard.get('triStuckFrames') || 0;
    if (stuckFrames > 20 && core?.grounded && dy < TILE_SIZE) {
        input.jump = true;
    }
    // Double jump if still stuck in air (only when target is above or same level)
    if (stuckFrames > 30 && !core?.grounded && dy < TILE_SIZE) {
        input.jump = true;
    }

    // 4. Hook — bMod random fire (10% per tick, 25% over hole)
    if (core?.hookState === 'IDLE' && (core?.hookCooldown || 0) <= 0 && scene.platformLayer) {
        const cd = tick.blackboard.get('reactiveHookCooldown') || 0;
        if (cd <= 0) {
            const hookChance = overHole ? 0.25 : 0.10;
            if (Math.random() < hookChance) {
                const hookDir = findBestHookDirection(
                    bot, targetX, targetY, scene.platformLayer, overHole);
                if (hookDir) {
                    input.hookJustPressed = true;
                    input.hookTarget = hookDir;
                    tick.blackboard.set('reactiveHookTimer', 0);
                }
            }
        }
    }

    // 5. Water avoidance (emergency)
    const waterY = scene.waterY;
    if (waterY && bot.y + TILE_SIZE * 2 > waterY) {
        input.jump = true;
        if (core?.hookState === 'IDLE' && (core?.hookCooldown || 0) <= 0 && scene.platformLayer) {
            const hookDir = findBestHookDirection(
                bot, bot.x, bot.y - 300, scene.platformLayer, true);
            if (hookDir) {
                input.hookJustPressed = true;
                input.hookTarget = hookDir;
            }
        }
    }
}

class NavigateWithTriNav extends b3.Action {
    tick(tick) {
        const { bot, scene } = tick.blackboard.get('context');
        const target = tick.blackboard.get('target');
        const input = tick.blackboard.get('input');
        const delta = tick.blackboard.get('delta') || 16;

        if (!target || !target.active) return b3.FAILURE;

        const triNav = scene.triNav;
        if (!triNav) return b3.FAILURE;

        // --- Path management ---
        let waypoints = tick.blackboard.get('triWaypoints');
        let wpAge = tick.blackboard.get('triWpAge') || 0;
        const lastTX = tick.blackboard.get('triLastTX') || 0;
        const lastTY = tick.blackboard.get('triLastTY') || 0;
        const targetMoved = Math.hypot(target.x - lastTX, target.y - lastTY) > AI.PATH_RECALC_DIST;

        wpAge += delta;

        if (!waypoints || targetMoved || wpAge > AI.PATH_RECALC_MS) {
            const oldIndex = tick.blackboard.get('triWpIndex') || 0;
            waypoints = triNav.findPath(bot.x, bot.y, target.x, target.y);
            tick.blackboard.set('triWaypoints', waypoints);
            tick.blackboard.set('triWpAge', 0);
            if (!waypoints || targetMoved) {
                tick.blackboard.set('triWpIndex', 0);
            } else {
                // Clamp preserved index to new waypoints length
                tick.blackboard.set('triWpIndex', Math.min(oldIndex, waypoints.length - 1));
            }
            tick.blackboard.set('triLastTX', target.x);
            tick.blackboard.set('triLastTY', target.y);
        } else {
            tick.blackboard.set('triWpAge', wpAge);
        }

        if (!waypoints || waypoints.length === 0) return b3.FAILURE;

        // --- LOS waypoint selection ---
        const wpIndex = tick.blackboard.get('triWpIndex') || 0;
        // LOS-skip limited by vertical distance (don't skip through air to distant platforms)
        let visible = null;
        for (let i = waypoints.length - 1; i >= wpIndex; i--) {
            const wpDy = Math.abs(waypoints[i].y - bot.y);
            if (wpDy > TILE_SIZE * 2 && i > wpIndex) continue; // too far vertically — follow path
            if (triNav.hasLOS(bot.x, bot.y, waypoints[i].x, waypoints[i].y)) {
                visible = { waypoint: waypoints[i], index: i };
                break;
            }
        }
        if (!visible && wpIndex < waypoints.length) {
            visible = { waypoint: waypoints[wpIndex], index: wpIndex };
        }
        if (!visible) return b3.FAILURE;

        const distToWp = Math.hypot(visible.waypoint.x - bot.x, visible.waypoint.y - bot.y);
        const wpDx = Math.abs(visible.waypoint.x - bot.x);

        // Advance past reached waypoints (X-proximity or distance — handles mid-air waypoints)
        if ((wpDx < TILE_SIZE * 0.7 || distToWp < 60) && visible.index < waypoints.length - 1) {
            tick.blackboard.set('triWpIndex', visible.index + 1);
        }

        // Arrived at final waypoint
        if (visible.index === waypoints.length - 1 && distToWp < AI.CHASE_DEADZONE) {
            return b3.SUCCESS;
        }

        // --- Move toward waypoint ---
        reactiveMove(bot, visible.waypoint.x, visible.waypoint.y, input, tick);

        // --- Stuck detection (skip while on hook — reactiveHookTick manages swing) ---
        const prevX = tick.blackboard.get('triPrevX') ?? bot.x;
        const prevY = tick.blackboard.get('triPrevY') ?? bot.y;
        const moved = Math.abs(bot.x - prevX) + Math.abs(bot.y - prevY);
        tick.blackboard.set('triPrevX', bot.x);
        tick.blackboard.set('triPrevY', bot.y);

        const onHook = bot.core?.hookState !== 'IDLE';
        // Don't count as stuck if waypoint is below — bot is trying to fall
        const wpBelow = visible.waypoint.y - bot.y > TILE_SIZE;
        if (moved < 2 && !onHook && !wpBelow) {
            const sf = (tick.blackboard.get('triStuckFrames') || 0) + 1;
            tick.blackboard.set('triStuckFrames', sf);
            if (sf > 90) { // ~1.5s without movement → fallback
                tick.blackboard.set('triStuckFrames', 0);
                tick.blackboard.set('triWaypoints', null);
                return b3.FAILURE;
            }
        } else {
            tick.blackboard.set('triStuckFrames', 0);
        }

        return b3.RUNNING;
    }
}

class TriNavToMemory extends b3.Action {
    tick(tick) {
        const { bot, scene } = tick.blackboard.get('context');
        const lastPos = tick.blackboard.get('lastTargetPos');
        const input = tick.blackboard.get('input');
        const delta = tick.blackboard.get('delta') || 16;

        if (!lastPos) return b3.FAILURE;

        const triNav = scene.triNav;
        if (!triNav) return b3.FAILURE;

        let waypoints = tick.blackboard.get('triMemWaypoints');
        let wpAge = tick.blackboard.get('triMemWpAge') || 0;
        wpAge += delta;

        if (!waypoints || wpAge > AI.PATH_RECALC_MS) {
            const oldMemIndex = tick.blackboard.get('triMemWpIndex') || 0;
            waypoints = triNav.findPath(bot.x, bot.y, lastPos.x, lastPos.y);
            tick.blackboard.set('triMemWaypoints', waypoints);
            tick.blackboard.set('triMemWpAge', 0);
            if (!waypoints) {
                tick.blackboard.set('triMemWpIndex', 0);
            } else {
                tick.blackboard.set('triMemWpIndex', Math.min(oldMemIndex, waypoints.length - 1));
            }
        } else {
            tick.blackboard.set('triMemWpAge', wpAge);
        }

        if (!waypoints || waypoints.length === 0) return b3.FAILURE;

        const wpIndex = tick.blackboard.get('triMemWpIndex') || 0;
        // LOS-skip limited by vertical distance (don't skip through air to distant platforms)
        let visible = null;
        for (let i = waypoints.length - 1; i >= wpIndex; i--) {
            const wpDy = Math.abs(waypoints[i].y - bot.y);
            if (wpDy > TILE_SIZE * 2 && i > wpIndex) continue; // too far vertically — follow path
            if (triNav.hasLOS(bot.x, bot.y, waypoints[i].x, waypoints[i].y)) {
                visible = { waypoint: waypoints[i], index: i };
                break;
            }
        }
        if (!visible && wpIndex < waypoints.length) {
            visible = { waypoint: waypoints[wpIndex], index: wpIndex };
        }
        if (!visible) return b3.FAILURE;

        const dist = Math.hypot(visible.waypoint.x - bot.x, visible.waypoint.y - bot.y);
        const memWpDx = Math.abs(visible.waypoint.x - bot.x);

        if ((memWpDx < TILE_SIZE * 0.7 || dist < 60) && visible.index < waypoints.length - 1) {
            tick.blackboard.set('triMemWpIndex', visible.index + 1);
        }

        if (visible.index === waypoints.length - 1 && dist < 60) {
            tick.blackboard.set('lastTargetPos', null);
            return b3.SUCCESS;
        }

        reactiveMove(bot, visible.waypoint.x, visible.waypoint.y, input, tick);

        // --- Stuck detection (skip while on hook) ---
        const memPrevX = tick.blackboard.get('triMemPrevX') ?? bot.x;
        const memPrevY = tick.blackboard.get('triMemPrevY') ?? bot.y;
        const memMoved = Math.abs(bot.x - memPrevX) + Math.abs(bot.y - memPrevY);
        tick.blackboard.set('triMemPrevX', bot.x);
        tick.blackboard.set('triMemPrevY', bot.y);

        const memOnHook = bot.core?.hookState !== 'IDLE';
        if (memMoved < 2 && !memOnHook) {
            const sf = (tick.blackboard.get('triMemStuckFrames') || 0) + 1;
            tick.blackboard.set('triMemStuckFrames', sf);
            if (sf > 90) {
                tick.blackboard.set('triMemStuckFrames', 0);
                tick.blackboard.set('triMemWaypoints', null);
                return b3.FAILURE;
            }
        } else {
            tick.blackboard.set('triMemStuckFrames', 0);
        }

        return b3.RUNNING;
    }
}

class TriNavPatrol extends b3.Action {
    tick(tick) {
        const { bot, scene } = tick.blackboard.get('context');
        const input = tick.blackboard.get('input');
        const delta = tick.blackboard.get('delta') || 16;

        const triNav = scene.triNav;
        if (!triNav) return b3.FAILURE;

        // Anti-freeze
        if (tick.blackboard.get('forceRandomAction')) {
            tick.blackboard.set('forceRandomAction', false);
            input.direction = Math.random() > 0.5 ? 1 : -1;
            input.jump = true;
            return b3.RUNNING;
        }

        // Pick or keep patrol target
        let patrolTarget = tick.blackboard.get('triPatrolTarget');
        let patrolTimer = tick.blackboard.get('triPatrolTimer') || 0;
        patrolTimer += delta;

        if (!patrolTarget || patrolTimer > 8000) {
            // Pick random point on the map (in walkable space)
            const waterY = scene.waterY;
            const maxAttempts = 20;
            for (let i = 0; i < maxAttempts; i++) {
                const rx = Math.random() * triNav.mapWidth * triNav.tileSize;
                const ry = Math.random() * triNav.mapHeight * triNav.tileSize;
                if (waterY && ry > waterY - TILE_SIZE * 2) continue;
                const t = triNav._worldToTile(rx, ry);
                if (t.tx >= 0 && t.tx < triNav.mapWidth && t.ty >= 0 && t.ty < triNav.mapHeight
                    && triNav.navGrid[t.ty][t.tx]) {
                    patrolTarget = { x: rx, y: ry };
                    break;
                }
            }
            if (!patrolTarget) {
                // Fallback: center of map
                patrolTarget = {
                    x: triNav.mapWidth * triNav.tileSize * 0.5,
                    y: triNav.mapHeight * triNav.tileSize * 0.5
                };
            }
            tick.blackboard.set('triPatrolTarget', patrolTarget);
            tick.blackboard.set('triPatrolTimer', 0);
            tick.blackboard.set('triPatrolWaypoints', null);
            patrolTimer = 0;
        } else {
            tick.blackboard.set('triPatrolTimer', patrolTimer);
        }

        let waypoints = tick.blackboard.get('triPatrolWaypoints');
        if (!waypoints) {
            waypoints = triNav.findPath(bot.x, bot.y, patrolTarget.x, patrolTarget.y);
            tick.blackboard.set('triPatrolWaypoints', waypoints);
            tick.blackboard.set('triPatrolWpIndex', 0);
        }

        if (!waypoints || waypoints.length === 0) {
            tick.blackboard.set('triPatrolTarget', null);
            return b3.RUNNING;
        }

        const wpIndex = tick.blackboard.get('triPatrolWpIndex') || 0;
        // LOS-skip limited by vertical distance (don't skip through air to distant platforms)
        let visible = null;
        for (let i = waypoints.length - 1; i >= wpIndex; i--) {
            const wpDy = Math.abs(waypoints[i].y - bot.y);
            if (wpDy > TILE_SIZE * 2 && i > wpIndex) continue; // too far vertically — follow path
            if (triNav.hasLOS(bot.x, bot.y, waypoints[i].x, waypoints[i].y)) {
                visible = { waypoint: waypoints[i], index: i };
                break;
            }
        }
        if (!visible && wpIndex < waypoints.length) {
            visible = { waypoint: waypoints[wpIndex], index: wpIndex };
        }
        if (!visible) {
            tick.blackboard.set('triPatrolTarget', null);
            return b3.RUNNING;
        }

        const dist = Math.hypot(visible.waypoint.x - bot.x, visible.waypoint.y - bot.y);
        const patWpDx = Math.abs(visible.waypoint.x - bot.x);
        if ((patWpDx < TILE_SIZE * 0.7 || dist < 60) && visible.index < waypoints.length - 1) {
            tick.blackboard.set('triPatrolWpIndex', visible.index + 1);
        }
        if (visible.index === waypoints.length - 1 && dist < 60) {
            tick.blackboard.set('triPatrolTarget', null);
            return b3.RUNNING;
        }

        reactiveMove(bot, visible.waypoint.x, visible.waypoint.y, input, tick);

        // --- Stuck detection (skip while on hook) ---
        const patPrevX = tick.blackboard.get('triPatPrevX') ?? bot.x;
        const patPrevY = tick.blackboard.get('triPatPrevY') ?? bot.y;
        const patMoved = Math.abs(bot.x - patPrevX) + Math.abs(bot.y - patPrevY);
        tick.blackboard.set('triPatPrevX', bot.x);
        tick.blackboard.set('triPatPrevY', bot.y);

        const patOnHook = bot.core?.hookState !== 'IDLE';
        if (patMoved < 2 && !patOnHook) {
            const sf = (tick.blackboard.get('triPatStuckFrames') || 0) + 1;
            tick.blackboard.set('triPatStuckFrames', sf);
            if (sf > 90) {
                tick.blackboard.set('triPatStuckFrames', 0);
                tick.blackboard.set('triPatrolTarget', null);
                tick.blackboard.set('triPatrolWaypoints', null);
                return b3.RUNNING; // pick new patrol target
            }
        } else {
            tick.blackboard.set('triPatStuckFrames', 0);
        }

        // Random hook attempt during patrol (1% per tick, occasional exploration)
        if (bot.core?.hookState === 'IDLE' && bot.core?.grounded && Math.random() < 0.05) {
            if (scene.platformLayer) {
                const randomTargetX = bot.x + (Math.random() > 0.5 ? 400 : -400);
                const randomTargetY = bot.y - 300;
                const hookDir = findBestHookDirection(bot, randomTargetX, randomTargetY, scene.platformLayer);
                if (hookDir) {
                    input.hookJustPressed = true;
                    input.hookTarget = hookDir;
                }
            }
        }

        return b3.RUNNING;
    }
}

// ============================================
// FALLBACK WALK — wall-aware walking when A* has no path
// ============================================

function fallbackWalk(tick, bot, targetX, input) {
    const dx = targetX - bot.x;
    if (Math.abs(dx) < AI.CHASE_DEADZONE) return 'ARRIVED';
    input.direction = dx > 0 ? 1 : -1;

    const { scene } = tick.blackboard.get('context');
    let forceStuck = false;

    // Wall lookahead
    if (bot.core?.grounded && scene.platformLayer) {
        const moveDir = input.direction;
        const vxAbs = Math.abs(bot.core.body?.velocity?.x || 0);
        const lookAhead = 25 + Math.max(vxAbs, 4) * 4;
        const checkX = bot.x + moveDir * lookAhead;
        const wallTile = scene.platformLayer.getTileAtWorldXY(checkX, bot.y);
        if (wallTile && wallTile.index > 0) {
            const aboveTile = scene.platformLayer.getTileAtWorldXY(checkX, bot.y - TILE_SIZE);
            if (!aboveTile || aboveTile.index <= 0) {
                input.jump = true;          // 1-tile wall: jump over
            } else {
                forceStuck = true;          // 2+ tile wall: can't pass
            }
        }
    }

    // Stuck detection (dedicated fb* blackboard keys)
    const prevX = tick.blackboard.get('fbPrevX') ?? bot.x;
    const moved = Math.abs(bot.x - prevX);
    tick.blackboard.set('fbPrevX', bot.x);
    const delta = tick.blackboard.get('delta') || 16;

    if ((input.direction !== 0 && moved < 1.0) || forceStuck) {
        const stuckFrames = (tick.blackboard.get('fbStuckFrames') || 0) + 1;
        tick.blackboard.set('fbStuckFrames', stuckFrames);
        const esc = tick.blackboard.get('fbStuckEscalation') || 0;

        if (stuckFrames >= 3 || forceStuck) {
            if (esc === 0 && bot.core?.grounded) {
                input.jump = true;
                tick.blackboard.set('fbStuckEscalation', 1);
            } else if (esc === 1 && !bot.core?.grounded) {
                input.jump = true;
                tick.blackboard.set('fbStuckEscalation', 2);
            } else if (esc === 2) {
                input.direction = -input.direction;
                tick.blackboard.set('fbStuckEscalation', 3);
            } else if (esc >= 3) {
                if (Math.random() < 0.10 && scene.platformLayer
                    && bot.core?.hookState === 'IDLE') {
                    const hookDir = findBestHookDirection(bot,
                        bot.x + (Math.random() > 0.5 ? 500 : -500),
                        bot.y - 300, scene.platformLayer);
                    if (hookDir) {
                        input.hookJustPressed = true;
                        input.hookTarget = hookDir;
                    }
                }
                if (stuckFrames > 60) return 'STUCK';
            }
        }
    } else {
        tick.blackboard.set('fbStuckFrames', 0);
        tick.blackboard.set('fbStuckEscalation', 0);
    }

    // Absolute timeout 1500ms
    let fbTimer = tick.blackboard.get('fbStuckTimer') || 0;
    if (moved < 5) fbTimer += delta; else fbTimer = 0;
    tick.blackboard.set('fbStuckTimer', fbTimer);
    if (fbTimer > 1500) {
        tick.blackboard.set('fbStuckTimer', 0);
        tick.blackboard.set('fbStuckFrames', 0);
        tick.blackboard.set('fbStuckEscalation', 0);
        return 'STUCK';
    }

    return 'MOVING';
}

// ============================================
// SEGMENT EXECUTION (shared by all nav nodes)
// ============================================

function executeSegment(tick, bot, segment, input) {
    const edge = segment.edge;
    const speedMult = tick.blackboard.get('speedMultiplier') || 1;

    // --- Active strategy execution ---
    {
        const activeStrategy = tick.blackboard.get('activeStrategy');
        if (activeStrategy) {
            const delta = tick.blackboard.get('delta') || 16;
            const result = executeStrategy(bot, activeStrategy, input, delta);
            if (result === 'DONE' || result === 'FAILED') {
                console.log(`[Strategy] ${activeStrategy.type} result=${result} bot=(${bot.x.toFixed(0)},${bot.y.toFixed(0)}) hookState=${bot.core?.hookState}`);
                tick.blackboard.set('activeStrategy', null);
                tick.blackboard.set('navStuckTimer', 0);
                if (result === 'FAILED') {
                    const failCount = (tick.blackboard.get('pathFailCount') || 0) + 1;
                    tick.blackboard.set('pathFailCount', failCount);
                }
                return result === 'DONE' ? 'DONE' : 'MOVING';
            }
            return 'MOVING';
        }
    }

    // --- Per-tick stuck detection with escalating recovery (Teeworlds bMod style) ---
    {
        const prevX = tick.blackboard.get('navPrevX') ?? bot.x;
        const moved = Math.abs(bot.x - prevX);
        tick.blackboard.set('navPrevX', bot.x);
        const delta = tick.blackboard.get('delta') || 16;

        if (input.direction !== 0 && moved < 1.0) {
            // Bot is commanding movement but position didn't change — stuck
            const stuckFrames = (tick.blackboard.get('stuckFrameCount') || 0) + 1;
            tick.blackboard.set('stuckFrameCount', stuckFrames);
            const stuckEscalation = tick.blackboard.get('stuckEscalation') || 0;

            // Escalate after 3+ consecutive stuck frames (avoid false positives)
            if (stuckFrames >= 3) {
                if (stuckEscalation === 0 && bot.core?.grounded) {
                    // Level 0: Jump
                    input.jump = true;
                    tick.blackboard.set('stuckEscalation', 1);
                } else if (stuckEscalation === 1 && !bot.core?.grounded) {
                    // Level 1: Double-jump (if available)
                    input.jump = true;
                    tick.blackboard.set('stuckEscalation', 2);
                } else if (stuckEscalation === 2) {
                    // Level 2: Flip horizontal direction
                    input.direction = -input.direction;
                    tick.blackboard.set('stuckEscalation', 3);
                } else if (stuckEscalation >= 3) {
                    // Level 3: Random hook rescue (10% chance per tick)
                    const { scene } = tick.blackboard.get('context');
                    if (Math.random() < 0.10 && scene.platformLayer && bot.core?.hookState === 'IDLE') {
                        const hookDir = findBestHookDirection(bot,
                            bot.x + (Math.random() > 0.5 ? 500 : -500),
                            bot.y - 300, scene.platformLayer);
                        if (hookDir) {
                            input.hookJustPressed = true;
                            input.hookTarget = hookDir;
                        }
                    }
                    // After level 3 persists for ~1.5s, give up on segment
                    if (stuckFrames > 90) {
                        tick.blackboard.set('stuckEscalation', 0);
                        tick.blackboard.set('stuckFrameCount', 0);
                        const failCount = (tick.blackboard.get('pathFailCount') || 0) + 1;
                        tick.blackboard.set('pathFailCount', failCount);
                        return 'DONE';
                    }
                }
            }
        } else {
            // Not stuck — reset counters
            tick.blackboard.set('stuckFrameCount', 0);
            tick.blackboard.set('stuckEscalation', 0);
        }

        // Backup: absolute 2500ms timeout
        const stuckTimer = tick.blackboard.get('navStuckTimer') || 0;
        if (moved < 5) {
            tick.blackboard.set('navStuckTimer', stuckTimer + delta);
        } else {
            tick.blackboard.set('navStuckTimer', 0);
        }
        if (stuckTimer > 2500) {
            tick.blackboard.set('navStuckTimer', 0);
            tick.blackboard.set('stuckEscalation', 0);
            tick.blackboard.set('stuckFrameCount', 0);
            const failCount = (tick.blackboard.get('pathFailCount') || 0) + 1;
            tick.blackboard.set('pathFailCount', failCount);
            return 'DONE';
        }
    }

    // --- Predictive jump: wall lookahead (Teeworlds-style) ---
    {
        const { scene } = tick.blackboard.get('context');
        if (bot.core?.grounded && input.direction !== 0 && scene.platformLayer) {
            const moveDir = input.direction > 0 ? 1 : -1;
            const vxAbs = Math.abs(bot.core.body?.velocity?.x || 0);
            const lookAhead = 25 + Math.max(vxAbs, 4) * 4;
            const checkX = bot.x + moveDir * lookAhead;

            const wallTile = scene.platformLayer.getTileAtWorldXY(checkX, bot.y);
            if (wallTile && wallTile.index > 0) {
                const aboveTile = scene.platformLayer.getTileAtWorldXY(checkX, bot.y - TILE_SIZE);
                if (!aboveTile || aboveTile.index <= 0) {
                    input.jump = true;
                }
            }
        }
    }

    // --- Water/cliff edge avoidance (only for WALK segments — don't block jumps/hooks/falls) ---
    if (!edge || edge.type === EdgeType.WALK) {
        const { scene } = tick.blackboard.get('context');
        const waterY = scene.waterY;
        if (waterY) {
            const dx = segment.targetX - bot.x;
            const moveDir = dx > 0 ? 1 : dx < 0 ? -1 : 0;
            if (moveDir !== 0) {
                // Check 3 tiles ahead for ground
                const checkX = bot.x + moveDir * TILE_SIZE * 3;
                const checkY = bot.y + TILE_SIZE;
                const tileAhead = scene.platformLayer?.getTileAtWorldXY(checkX, checkY);
                const tileAhead2 = scene.platformLayer?.getTileAtWorldXY(checkX, checkY + TILE_SIZE);
                const tileAhead3 = scene.platformLayer?.getTileAtWorldXY(checkX, checkY + TILE_SIZE * 2);
                const noGround = (!tileAhead || tileAhead.index <= 0) &&
                                 (!tileAhead2 || tileAhead2.index <= 0) &&
                                 (!tileAhead3 || tileAhead3.index <= 0);
                if (noGround && bot.y + TILE_SIZE * 4 > waterY) {
                    // Water/cliff ahead — reverse and jump away
                    input.direction = -moveDir;
                    if (bot.core?.grounded) input.jump = true;
                    return 'MOVING';
                }
            }
        }
    }

    // First segment or WALK — just walk to targetX
    if (!edge || edge.type === EdgeType.WALK) {
        const dx = segment.targetX - bot.x;
        if (Math.abs(dx) < 30) return 'DONE';
        input.direction = (dx > 0 ? 1 : -1) * speedMult;
        return 'MOVING';
    }

    const phase = tick.blackboard.get('navSegPhase') || 'APPROACH';

    if (edge.type === EdgeType.JUMP_ACROSS || edge.type === EdgeType.JUMP_UP) {
        return executeJump(tick, bot, edge, segment, input, phase, speedMult);
    }

    if (edge.type === EdgeType.FALL) {
        return executeFall(tick, bot, edge, segment, input, speedMult);
    }

    if (edge.type === EdgeType.HOOK) {
        return executeHookEdge(tick, bot, edge, segment, input, phase, speedMult);
    }

    // Unknown edge type — walk
    const dx = segment.targetX - bot.x;
    if (Math.abs(dx) < 30) return 'DONE';
    input.direction = (dx > 0 ? 1 : -1) * speedMult;
    return 'MOVING';
}

function executeJump(tick, bot, edge, segment, input, _phase, speedMult) {
    let phase = tick.blackboard.get('navSegPhase') || 'APPROACH';

    if (phase === 'APPROACH') {
        const dx = edge.entryX - bot.x;
        if (Math.abs(dx) > 40) {
            input.direction = (dx > 0 ? 1 : -1) * speedMult;
            return 'MOVING';
        }
        tick.blackboard.set('navSegPhase', 'JUMP');
        phase = 'JUMP';
    }

    if (phase === 'JUMP') {
        const dx = edge.exitX - bot.x;
        input.direction = (dx > 0 ? 1 : -1) * speedMult;
        input.jump = true;
        tick.blackboard.set('navSegPhase', 'AIRBORNE');
        return 'MOVING';
    }

    if (phase === 'AIRBORNE') {
        const dx = edge.exitX - bot.x;
        input.direction = (dx > 0 ? 1 : -1) * speedMult;
        if (bot.core && bot.core.grounded) {
            tick.blackboard.set('navSegPhase', 'APPROACH');
            return 'DONE';
        }
        return 'MOVING';
    }

    return 'MOVING';
}

function executeFall(tick, bot, edge, segment, input, speedMult) {
    const dx = edge.exitX - bot.x;
    input.direction = (dx > 0 ? 1 : -1) * speedMult;

    // Done when grounded and near target platform height
    if (bot.core && bot.core.grounded && bot.y >= segment.platform.surfaceY - TILE_SIZE * 2) {
        return 'DONE';
    }
    return 'MOVING';
}

function executeHookEdge(tick, bot, edge, segment, input, _phase, speedMult) {
    let phase = tick.blackboard.get('navSegPhase') || 'APPROACH';
    const targetX = edge.exitX;
    const targetY = segment.platform ? segment.platform.surfaceY - TILE_SIZE : bot.y - TILE_SIZE * 3;

    // APPROACH: walk to entry point (but don't wait if already hooking)
    if (phase === 'APPROACH' && bot.core?.hookState === 'IDLE') {
        const dx = edge.entryX - bot.x;
        if (Math.abs(dx) > 40) {
            input.direction = (dx > 0 ? 1 : -1) * speedMult;
            return 'MOVING';
        }
        tick.blackboard.set('navSegPhase', 'HOOK');
        phase = 'HOOK';
    }

    // Reactive hook: fire / swing / release each tick
    const result = reactiveHookTick(bot, targetX, targetY, input, tick);

    // Check if we've arrived (grounded near target)
    if (result === 'RELEASED' || result === 'IDLE') {
        if (bot.core?.grounded) {
            const dx = targetX - bot.x;
            const dy = targetY - bot.y;
            if (Math.abs(dx) < TILE_SIZE * 3 && (Math.abs(dy) < TILE_SIZE * 3 || dy > 0)) {
                tick.blackboard.set('reactiveHookTimer', 0);
                return 'DONE';
            }
        }
    }

    // Timeout: if hook hasn't helped after many attempts
    const hookAttempts = tick.blackboard.get('hookEdgeAttempts') || 0;
    if (result === 'RELEASED') {
        const attempts = hookAttempts + 1;
        tick.blackboard.set('hookEdgeAttempts', attempts);
        if (attempts >= 5) {
            tick.blackboard.set('hookEdgeAttempts', 0);
            const failCount = (tick.blackboard.get('pathFailCount') || 0) + 1;
            tick.blackboard.set('pathFailCount', failCount);
            if (failCount >= 3) {
                tick.blackboard.set('navPath', null);
                tick.blackboard.set('patrolTarget', null);
                tick.blackboard.set('patrolPath', null);
                tick.blackboard.set('pathFailCount', 0);
            }
            return 'DONE';
        }
    }

    return 'MOVING';
}

// ============================================
// BOT BEHAVIOR CLASS
// ============================================

export class BotBehavior {
    constructor(platformNav, tileWidth, tileHeight) {
        this.platformNav = platformNav;
        this.tileWidth = tileWidth;
        this.tileHeight = tileHeight;

        this.blackboard = new b3.Blackboard();

        this.blackboard.set('speedMultiplier',
            AI.CHASE_SPEED_MIN + Math.random() * (AI.CHASE_SPEED_MAX - AI.CHASE_SPEED_MIN)
        );

        this.tree = this.buildTree();
    }

    buildTree() {
        const tree = new b3.BehaviorTree();

        tree.root = new b3.Sequence({
            children: [
                new FindClosestTarget(),
                new b3.Priority({
                    children: [
                        // 1. Dodge incoming snowballs (highest priority)
                        new b3.Sequence({
                            children: [
                                new SnowballIncoming(),
                                new DodgeSnowball()
                            ]
                        }),

                        // 2. Continue swinging if on hook
                        new SwingOnHook(),

                        // 3. Attack: visible + in range + can shoot
                        new b3.Sequence({
                            children: [
                                new CanSeeTarget(),
                                new IsInAttackRange(AI.ATTACK_RANGE_MAX),
                                new CanShoot(),
                                new Shoot()
                            ]
                        }),

                        // 4. Seek pickup: health if low, powerups if nearby
                        new b3.Sequence({
                            children: [
                                new NearbyPickup(),
                                new GoToPickup()
                            ]
                        }),

                        // 5a. Navigate to target via TriNav (free-space, bMod-style)
                        new b3.Sequence({
                            children: [
                                new HasTarget(),
                                new NavigateWithTriNav()
                            ]
                        }),

                        // 5b. Navigate to target via PlatformNav (fallback)
                        new b3.Sequence({
                            children: [
                                new HasTarget(),
                                new NavigateToTarget()
                            ]
                        }),

                        // 6a. Investigate memory via TriNav
                        new b3.Sequence({
                            children: [
                                new HasMemoryOfTarget(),
                                new TriNavToMemory()
                            ]
                        }),

                        // 6b. Investigate memory via PlatformNav (fallback)
                        new b3.Sequence({
                            children: [
                                new HasMemoryOfTarget(),
                                new NavigateToMemory()
                            ]
                        }),

                        // 7a. Patrol via TriNav
                        new TriNavPatrol(),

                        // 7b. Patrol via PlatformNav (fallback)
                        new PatrolPlatforms()
                    ]
                })
            ]
        });

        return tree;
    }

    update(bot, scene, delta) {
        // Update cooldowns
        let hookCooldown = this.blackboard.get('hookCooldown') || 0;
        let shootCooldown = this.blackboard.get('shootCooldown') || 0;
        let hookTime = this.blackboard.get('hookTime') || 0;
        let shootReaction = this.blackboard.get('shootReaction') || 0;

        hookCooldown = Math.max(0, hookCooldown - delta);
        shootCooldown = Math.max(0, shootCooldown - delta);
        shootReaction = Math.max(0, shootReaction - delta);

        if (bot.core && bot.core.hookState === 'ATTACHED') {
            hookTime += delta;
        } else {
            hookTime = 0;
        }

        this.blackboard.set('hookCooldown', hookCooldown);
        this.blackboard.set('shootCooldown', shootCooldown);
        this.blackboard.set('hookTime', hookTime);
        this.blackboard.set('shootReaction', shootReaction);

        // Compute vision range from camera viewport
        const cam = scene.cameras?.main;
        if (cam) {
            const zoom = cam.zoom || 1;
            const worldW = cam.width / zoom;
            const worldH = cam.height / zoom;
            this.blackboard.set('visionRange', Math.hypot(worldW, worldH));
        } else {
            this.blackboard.set('visionRange', AI.VISION_RANGE_DEFAULT);
        }

        // Set context
        this.blackboard.set('context', { bot, scene });
        this.blackboard.set('delta', delta);

        // Prepare input
        const input = {
            direction: 0,
            jump: false,
            hookJustPressed: false,
            hookTarget: null,
            fire: false,
            fireAngle: null
        };
        this.blackboard.set('input', input);

        // --- Global inactivity watchdog (bMod-style anti-freeze) ---
        const prevPosX = this.blackboard.get('globalPrevX') ?? bot.x;
        const prevPosY = this.blackboard.get('globalPrevY') ?? bot.y;
        const globalMoved = Math.hypot(bot.x - prevPosX, bot.y - prevPosY);

        let inactivityTimer = this.blackboard.get('inactivityTimer') || 0;
        if (globalMoved < 5) {
            inactivityTimer += delta;
        } else {
            inactivityTimer = 0;
        }
        this.blackboard.set('globalPrevX', bot.x);
        this.blackboard.set('globalPrevY', bot.y);
        this.blackboard.set('inactivityTimer', inactivityTimer);

        // Oscillation detection: track direction flips in 2-second window
        const currentDir = Math.sign(bot.x - prevPosX);
        const prevDir = this.blackboard.get('globalPrevDir') || 0;
        let dirFlipCount = this.blackboard.get('dirFlipCount') || 0;
        let dirFlipTimer = this.blackboard.get('dirFlipTimer') || 0;

        if (currentDir !== 0 && prevDir !== 0 && currentDir !== prevDir) {
            dirFlipCount++;
        }
        this.blackboard.set('globalPrevDir', currentDir);
        dirFlipTimer += delta;

        let shouldForceReset = false;
        if (dirFlipTimer > 2000) {
            if (dirFlipCount >= 6) {
                // 6+ direction flips in 2s = oscillation
                shouldForceReset = true;
            }
            this.blackboard.set('dirFlipCount', 0);
            this.blackboard.set('dirFlipTimer', 0);
        } else {
            this.blackboard.set('dirFlipCount', dirFlipCount);
            this.blackboard.set('dirFlipTimer', dirFlipTimer);
        }

        if (inactivityTimer > 2000 || shouldForceReset) {
            // Force reset all navigation state (PlatformNav)
            this.blackboard.set('navPath', null);
            this.blackboard.set('memNavPath', null);
            this.blackboard.set('patrolTarget', null);
            this.blackboard.set('patrolPath', null);
            this.blackboard.set('activeStrategy', null);
            this.blackboard.set('pathFailCount', 0);
            this.blackboard.set('stuckEscalation', 0);
            this.blackboard.set('stuckFrameCount', 0);
            // TriNav state reset
            this.blackboard.set('triWaypoints', null);
            this.blackboard.set('triWpIndex', 0);
            this.blackboard.set('triStuckFrames', 0);
            this.blackboard.set('triMemWaypoints', null);
            this.blackboard.set('triMemWpIndex', 0);
            this.blackboard.set('triMemStuckFrames', 0);
            this.blackboard.set('triPatrolWaypoints', null);
            this.blackboard.set('triPatrolTarget', null);
            this.blackboard.set('triPatStuckFrames', 0);
            // Common
            this.blackboard.set('inactivityTimer', 0);
            this.blackboard.set('globalPrevX', bot.x);
            this.blackboard.set('globalPrevY', bot.y);
            this.blackboard.set('forceRandomAction', true);
        }

        // Execute behavior tree
        this.tree.tick(null, this.blackboard);

        // --- Opportunistic shooting (fire while navigating/patrolling) ---
        const target = this.blackboard.get('target');
        if (target && target.active && !input.fire) {
            const shootCD = this.blackboard.get('shootCooldown') || 0;
            if (shootCD <= 0) {
                const sdx = target.x - bot.x;
                const sdy = target.y - bot.y;
                const sDist = Math.hypot(sdx, sdy);
                if (sDist < AI.ATTACK_RANGE_MAX) {
                    let canSee = true;
                    if (scene.platformLayer) {
                        const line = new Phaser.Geom.Line(bot.x, bot.y, target.x, target.y);
                        const tiles = scene.platformLayer.getTilesWithinShape(line);
                        for (const t of tiles) {
                            if (t && t.index > 0) { canSee = false; break; }
                        }
                    }
                    if (canSee) {
                        bot.setData('facingRight', sdx > 0);
                        const botVx = bot.body?.velocity?.x || 0;
                        const botVy = bot.body?.velocity?.y || 0;
                        input.fireAngle = aimAtTarget(bot.x, bot.y, target.x, target.y, botVx, botVy);
                        input.fire = true;
                        this.blackboard.set('shootCooldown',
                            AI.SHOOT_COOLDOWN_MIN + Math.random() * (AI.SHOOT_COOLDOWN_MAX - AI.SHOOT_COOLDOWN_MIN));
                    }
                }
            }
        }

        return this.blackboard.get('input');
    }
}
