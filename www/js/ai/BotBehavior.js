// ============================================
// BOT BEHAVIOR - AI with Behavior3.js + EasyStar.js
// ============================================

import { TILE_SIZE } from '../config.js';

// Get b3 from global scope (loaded via script tag)
const b3 = window.b3;

// ============================================
// AI CONSTANTS
// ============================================

const AI = {
    // Vision
    VISION_RANGE: 600,           // Max distance to "see" a target (raycast)
    AWARENESS_RANGE: 800,        // Max distance to detect a target at all
    MEMORY_DURATION: 5000,       // How long to remember last known position (ms)

    // Attack
    ATTACK_RANGE_MIN: 50,        // Don't shoot if closer than this
    ATTACK_RANGE_MAX: 400,       // Don't shoot if farther than this
    SHOOT_COOLDOWN_MIN: 800,     // Min time between shots (ms)
    SHOOT_COOLDOWN_MAX: 1500,    // Max time between shots (ms)
    SHOOT_REACTION_DELAY: 200,   // Delay before first shot after seeing target (ms)

    // Movement
    CHASE_DEADZONE: 30,          // Stop moving if closer than this horizontally
    CHASE_PAUSE_INTERVAL: 3000,  // Pause every N ms while chasing
    CHASE_PAUSE_DURATION: 300,   // How long to pause (ms)
    CHASE_SPEED_MIN: 0.7,        // Min speed multiplier (varies per bot)
    CHASE_SPEED_MAX: 1.0,        // Max speed multiplier

    // Patrol / Explore
    PATROL_CHANGE_DIR: 4000,     // Change patrol direction every N ms
    PATROL_PAUSE_CHANCE: 0.3,    // Chance to pause when changing direction
    PATROL_PAUSE_DURATION: 1500, // How long to pause while patrolling (ms)
    EXPLORE_WAYPOINT_RADIUS: 40, // How close to get to waypoint before picking next

    // Hook
    HOOK_COOLDOWN: 500,
    HOOK_MAX_SWING: 2000,

    // Wall detection
    WALL_SPEED_THRESHOLD: 0.5,   // Consider "blocked" if velocity.x < this while moving

    // Explore hook
    EXPLORE_HOOK_INTERVAL: 10000, // Interval between explore hook attempts (ms)
};

// ============================================
// CUSTOM CONDITION NODES
// ============================================

class CanSeeTarget extends b3.Condition {
    tick(tick) {
        const { bot, scene } = tick.blackboard.get('context');
        const target = tick.blackboard.get('target');

        if (!target || !target.active) {
            return b3.FAILURE;
        }

        const dist = Math.hypot(target.x - bot.x, target.y - bot.y);
        if (dist > AI.VISION_RANGE) {
            return b3.FAILURE;
        }

        // Raycast check using tilemap
        if (scene.platformLayer) {
            const line = new Phaser.Geom.Line(bot.x, bot.y, target.x, target.y);
            const tiles = scene.platformLayer.getTilesWithinShape(line);
            for (const tile of tiles) {
                if (tile && tile.index > 0) {
                    return b3.FAILURE;
                }
            }
        }

        // Update last known position with timestamp
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

        if (!target || !target.active) {
            return b3.FAILURE;
        }

        const dist = Math.hypot(target.x - bot.x, target.y - bot.y);
        return dist < this.range && dist > AI.ATTACK_RANGE_MIN ? b3.SUCCESS : b3.FAILURE;
    }
}

class CanShoot extends b3.Condition {
    tick(tick) {
        const shootCooldown = tick.blackboard.get('shootCooldown') || 0;
        return shootCooldown <= 0 ? b3.SUCCESS : b3.FAILURE;
    }
}

class TargetIsAbove extends b3.Condition {
    tick(tick) {
        const { bot } = tick.blackboard.get('context');
        const target = tick.blackboard.get('target');

        if (!target) return b3.FAILURE;

        const dy = target.y - bot.y;
        return dy < -TILE_SIZE ? b3.SUCCESS : b3.FAILURE;
    }
}

class CanUseHook extends b3.Condition {
    tick(tick) {
        const hookCooldown = tick.blackboard.get('hookCooldown') || 0;
        return hookCooldown <= 0 ? b3.SUCCESS : b3.FAILURE;
    }
}

class HasHookTarget extends b3.Condition {
    tick(tick) {
        const { bot, scene } = tick.blackboard.get('context');
        const hookTarget = findHookTarget(bot, scene);

        if (hookTarget) {
            tick.blackboard.set('hookTarget', hookTarget);
            return b3.SUCCESS;
        }
        return b3.FAILURE;
    }
}

class IsBlocked extends b3.Condition {
    tick(tick) {
        const { bot } = tick.blackboard.get('context');
        const input = tick.blackboard.get('input');

        // Matter.js doesn't have body.blocked — detect wall by checking
        // if we're trying to move but velocity is near zero
        if (input.direction === 0) return b3.FAILURE;

        const vx = bot.body.velocity.x;
        return Math.abs(vx) < AI.WALL_SPEED_THRESHOLD ? b3.SUCCESS : b3.FAILURE;
    }
}

class IsOnGround extends b3.Condition {
    tick(tick) {
        const { bot } = tick.blackboard.get('context');
        // Use CharacterCore.grounded (managed by collision events, works with Matter.js)
        return bot.core && bot.core.grounded ? b3.SUCCESS : b3.FAILURE;
    }
}

class HasMemoryOfTarget extends b3.Condition {
    tick(tick) {
        const lastPos = tick.blackboard.get('lastTargetPos');
        const lastSeen = tick.blackboard.get('lastTargetSeen') || 0;

        if (!lastPos) return b3.FAILURE;

        // Memory fades after MEMORY_DURATION
        if (Date.now() - lastSeen > AI.MEMORY_DURATION) {
            tick.blackboard.set('lastTargetPos', null);
            return b3.FAILURE;
        }

        return b3.SUCCESS;
    }
}

class ShouldExploreUp extends b3.Condition {
    tick(tick) {
        const { bot } = tick.blackboard.get('context');
        const target = tick.blackboard.get('target');

        // Don't explore while chasing
        if (target && target.active) return b3.FAILURE;
        // Must be on ground
        if (!bot.core || !bot.core.grounded) return b3.FAILURE;
        // Timer — no more often than EXPLORE_HOOK_INTERVAL
        const last = tick.blackboard.get('lastExploreHook') || 0;
        if (Date.now() - last < AI.EXPLORE_HOOK_INTERVAL) return b3.FAILURE;

        tick.blackboard.set('lastExploreHook', Date.now());
        return b3.SUCCESS;
    }
}

class TargetIsHigher extends b3.Condition {
    tick(tick) {
        const { bot } = tick.blackboard.get('context');
        const target = tick.blackboard.get('target');
        if (!target) return b3.FAILURE;

        // Target is 1-2 tiles above
        const dy = target.y - bot.y;
        return dy < -TILE_SIZE * 0.5 && dy > -TILE_SIZE * 3 ? b3.SUCCESS : b3.FAILURE;
    }
}

// ============================================
// CUSTOM ACTION NODES
// ============================================

class Shoot extends b3.Action {
    tick(tick) {
        const { bot } = tick.blackboard.get('context');
        const target = tick.blackboard.get('target');
        const input = tick.blackboard.get('input');

        // Check reaction delay — don't shoot instantly when first seeing target
        const reactionTimer = tick.blackboard.get('shootReaction') || 0;
        if (reactionTimer > 0) {
            return b3.FAILURE;
        }

        // Face the target before shooting
        if (target) {
            const dx = target.x - bot.x;
            if (dx > 0) {
                bot.setData('facingRight', true);
            } else {
                bot.setData('facingRight', false);
            }
        }

        input.fire = true;
        // Varied cooldown — less aggressive shooting
        tick.blackboard.set('shootCooldown', AI.SHOOT_COOLDOWN_MIN + Math.random() * (AI.SHOOT_COOLDOWN_MAX - AI.SHOOT_COOLDOWN_MIN));
        return b3.SUCCESS;
    }
}

class ChaseTarget extends b3.Action {
    tick(tick) {
        const { bot } = tick.blackboard.get('context');
        const target = tick.blackboard.get('target');
        const input = tick.blackboard.get('input');
        const delta = tick.blackboard.get('delta') || 16;

        if (!target) return b3.FAILURE;

        // Chase pauses — stop briefly every few seconds for natural movement
        let chaseTimer = tick.blackboard.get('chaseTimer') || 0;
        let chasePaused = tick.blackboard.get('chasePaused') || false;
        let chasePauseTimer = tick.blackboard.get('chasePauseTimer') || 0;

        if (chasePaused) {
            chasePauseTimer -= delta;
            if (chasePauseTimer <= 0) {
                chasePaused = false;
                chaseTimer = 0;
            } else {
                tick.blackboard.set('chasePauseTimer', chasePauseTimer);
                tick.blackboard.set('chasePaused', true);
                input.direction = 0; // Stand still during pause
                return b3.RUNNING;
            }
        }

        chaseTimer += delta;
        if (chaseTimer > AI.CHASE_PAUSE_INTERVAL) {
            chasePaused = true;
            chasePauseTimer = AI.CHASE_PAUSE_DURATION * (0.5 + Math.random());
            tick.blackboard.set('chasePaused', true);
            tick.blackboard.set('chasePauseTimer', chasePauseTimer);
            tick.blackboard.set('chaseTimer', 0);
            input.direction = 0;
            return b3.RUNNING;
        }
        tick.blackboard.set('chaseTimer', chaseTimer);
        tick.blackboard.set('chasePaused', false);

        const dx = target.x - bot.x;
        const speedMult = tick.blackboard.get('speedMultiplier') || 1;

        if (dx > AI.CHASE_DEADZONE) {
            input.direction = 1 * speedMult;
        } else if (dx < -AI.CHASE_DEADZONE) {
            input.direction = -1 * speedMult;
        } else {
            input.direction = 0;
        }

        // Request path update
        const easystar = tick.blackboard.get('easystar');
        if (easystar) {
            requestPath(tick, bot, target.x, target.y);
        }

        return b3.RUNNING;
    }
}

class GoToLastKnownPosition extends b3.Action {
    tick(tick) {
        const { bot } = tick.blackboard.get('context');
        const input = tick.blackboard.get('input');
        const lastPos = tick.blackboard.get('lastTargetPos');

        if (!lastPos) return b3.FAILURE;

        const dx = lastPos.x - bot.x;
        const speedMult = tick.blackboard.get('speedMultiplier') || 1;

        if (Math.abs(dx) < AI.EXPLORE_WAYPOINT_RADIUS) {
            // Reached last known position — clear memory
            tick.blackboard.set('lastTargetPos', null);
            return b3.SUCCESS;
        }

        input.direction = dx > 0 ? 1 * speedMult : -1 * speedMult;

        // Also request pathfinding
        const easystar = tick.blackboard.get('easystar');
        if (easystar) {
            requestPath(tick, bot, lastPos.x, lastPos.y);
        }

        return b3.RUNNING;
    }
}

class FollowPath extends b3.Action {
    tick(tick) {
        const { bot } = tick.blackboard.get('context');
        const input = tick.blackboard.get('input');
        const path = tick.blackboard.get('path');
        let pathIndex = tick.blackboard.get('pathIndex') || 0;

        if (!path || pathIndex >= path.length) {
            return b3.FAILURE;
        }

        const nextTile = path[pathIndex];
        const tileX = nextTile.x * TILE_SIZE + TILE_SIZE / 2;

        // Move towards next waypoint
        const dx = tileX - bot.x;
        const speedMult = tick.blackboard.get('speedMultiplier') || 1;
        input.direction = dx > 15 ? 1 * speedMult : dx < -15 ? -1 * speedMult : 0;

        // Advance to next waypoint if close
        if (Math.abs(dx) < TILE_SIZE / 2) {
            tick.blackboard.set('pathIndex', pathIndex + 1);
        }

        return b3.RUNNING;
    }
}

class UseHook extends b3.Action {
    tick(tick) {
        const input = tick.blackboard.get('input');
        const hookTarget = tick.blackboard.get('hookTarget');

        if (!hookTarget) return b3.FAILURE;

        input.hookJustPressed = true;
        input.hookTarget = hookTarget;
        // Save swing direction for SwingOnHook
        tick.blackboard.set('swingDir', hookTarget.landDir || 1);
        tick.blackboard.set('hookCooldown', AI.HOOK_COOLDOWN);
        tick.blackboard.set('hookTarget', null);

        return b3.SUCCESS;
    }
}

class SwingOnHook extends b3.Action {
    tick(tick) {
        const { bot } = tick.blackboard.get('context');
        const target = tick.blackboard.get('target');
        const input = tick.blackboard.get('input');

        const core = bot.core;
        if (!core || core.hookState === 'IDLE') {
            return b3.FAILURE;
        }

        // Swing direction:
        if (target && target.active) {
            // Toward enemy
            input.direction = target.x > bot.x ? 1 : -1;
        } else {
            // Use saved landing direction from findHookTarget
            input.direction = tick.blackboard.get('swingDir') || 1;
        }

        const hookTime = tick.blackboard.get('hookTime') || 0;
        const onGround = core.grounded;
        const vy = bot.body.velocity.y;

        // Smart release:
        // 1. Landed on platform — release
        if (onGround && hookTime > 300) {
            input.hookJustPressed = true;
            tick.blackboard.set('hookTime', 0);
            return b3.SUCCESS;
        }

        // 2. Moving upward + enough swing time — jump-release for max boost
        if (hookTime > 800 && vy < -1) {
            input.jump = true;
            input.hookJustPressed = true;
            tick.blackboard.set('hookTime', 0);
            return b3.SUCCESS;
        }

        // 3. Timeout — forced release
        if (hookTime > AI.HOOK_MAX_SWING) {
            input.jump = true;
            input.hookJustPressed = true;
            tick.blackboard.set('hookTime', 0);
            return b3.SUCCESS;
        }

        return b3.RUNNING;
    }
}

class Jump extends b3.Action {
    tick(tick) {
        const input = tick.blackboard.get('input');
        input.jump = true;
        return b3.SUCCESS;
    }
}

class Patrol extends b3.Action {
    tick(tick) {
        const input = tick.blackboard.get('input');
        const { bot, scene } = tick.blackboard.get('context');
        const delta = tick.blackboard.get('delta') || 16;

        let patrolDir = tick.blackboard.get('patrolDir') || 1;
        let patrolTimer = tick.blackboard.get('patrolTimer') || 0;
        let patrolPaused = tick.blackboard.get('patrolPaused') || false;
        let patrolPauseTimer = tick.blackboard.get('patrolPauseTimer') || 0;

        // Handle pause
        if (patrolPaused) {
            patrolPauseTimer -= delta;
            if (patrolPauseTimer <= 0) {
                patrolPaused = false;
                // Pick new direction after pause
                patrolDir = Math.random() > 0.5 ? 1 : -1;
            } else {
                tick.blackboard.set('patrolPauseTimer', patrolPauseTimer);
                tick.blackboard.set('patrolPaused', true);
                input.direction = 0;
                return b3.RUNNING;
            }
        }

        patrolTimer += delta;
        if (patrolTimer > AI.PATROL_CHANGE_DIR) {
            patrolTimer = 0;
            // Sometimes pause, sometimes just change direction
            if (Math.random() < AI.PATROL_PAUSE_CHANCE) {
                patrolPaused = true;
                patrolPauseTimer = AI.PATROL_PAUSE_DURATION * (0.5 + Math.random());
                tick.blackboard.set('patrolPaused', true);
                tick.blackboard.set('patrolPauseTimer', patrolPauseTimer);
                tick.blackboard.set('patrolTimer', 0);
                input.direction = 0;
                return b3.RUNNING;
            } else {
                patrolDir *= -1;
            }
        }

        // Turn at walls (using velocity check for Matter.js)
        const vx = bot.body.velocity.x;
        if (patrolDir !== 0 && Math.abs(vx) < AI.WALL_SPEED_THRESHOLD) {
            patrolDir *= -1;
            patrolTimer = 0;
        }

        tick.blackboard.set('patrolDir', patrolDir);
        tick.blackboard.set('patrolTimer', patrolTimer);
        tick.blackboard.set('patrolPaused', false);

        const speedMult = tick.blackboard.get('speedMultiplier') || 1;
        input.direction = patrolDir * speedMult;
        return b3.RUNNING;
    }
}

class FindClosestTarget extends b3.Action {
    tick(tick) {
        const { bot, scene } = tick.blackboard.get('context');
        let closest = null;
        let closestDist = Infinity;

        // Check player — only within awareness range
        if (scene.player?.active && scene.player.getData('health') > 0) {
            const d = Math.hypot(scene.player.x - bot.x, scene.player.y - bot.y);
            if (d < AI.AWARENESS_RANGE && d < closestDist) {
                closestDist = d;
                closest = scene.player;
            }
        }

        // Check other bots — FFA, everyone fights everyone
        for (const other of scene.bots || []) {
            if (other === bot || !other.active || other.getData('health') <= 0) continue;
            const d = Math.hypot(other.x - bot.x, other.y - bot.y);
            if (d < AI.AWARENESS_RANGE && d < closestDist) {
                closestDist = d;
                closest = other;
            }
        }

        tick.blackboard.set('target', closest);

        // Set reaction timer when acquiring a NEW target
        const prevTarget = tick.blackboard.get('prevTarget');
        if (closest && closest !== prevTarget) {
            tick.blackboard.set('shootReaction', AI.SHOOT_REACTION_DELAY);
            tick.blackboard.set('prevTarget', closest);
        }

        return b3.SUCCESS;
    }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function findHookTarget(bot, scene) {
    const T = TILE_SIZE;
    let bestTarget = null;
    let bestScore = -Infinity;

    for (let searchY = bot.y - T * 2; searchY > bot.y - T * 8; searchY -= T) {
        for (let searchX = bot.x - T * 5; searchX < bot.x + T * 5; searchX += T) {
            const tile = scene.platformLayer?.getTileAtWorldXY(searchX, searchY);
            if (!tile || tile.index <= 0) continue;

            const dx = searchX - bot.x;
            const dy = searchY - bot.y;
            if (dy > -T * 1.5) continue; // At least 1.5 tiles up

            const dist = Math.hypot(dx, dy);
            if (dist > T * 8) continue;

            // Platform edge: tile with empty space below
            const tileBelow = scene.platformLayer?.getTileAtWorldXY(searchX, searchY + T);
            if (tileBelow && tileBelow.index > 0) continue;

            // Score: prefer horizontal offset for swing arc, closer is better
            const horizOffset = Math.abs(dx);
            const score = horizOffset * 2 - dist;

            if (score > bestScore) {
                bestScore = score;
                bestTarget = {
                    x: searchX,
                    y: searchY + T * 0.3,
                    landDir: dx > 0 ? 1 : dx < 0 ? -1 : (Math.random() > 0.5 ? 1 : -1)
                };
            }
        }
    }

    return bestTarget;
}

function requestPath(tick, bot, targetX, targetY) {
    const easystar = tick.blackboard.get('easystar');
    const pathPending = tick.blackboard.get('pathPending');
    const lastPathRequest = tick.blackboard.get('lastPathRequest') || 0;
    const now = Date.now();

    if (pathPending || now - lastPathRequest < 300) return;

    const startTileX = Math.floor(bot.x / TILE_SIZE);
    const startTileY = Math.floor(bot.y / TILE_SIZE);
    const endTileX = Math.floor(targetX / TILE_SIZE);
    const endTileY = Math.floor(targetY / TILE_SIZE);

    if (startTileX === endTileX && startTileY === endTileY) return;

    // Get map bounds from blackboard
    const mapWidth = tick.blackboard.get('mapTileWidth') || 100;
    const mapHeight = tick.blackboard.get('mapTileHeight') || 75;

    // CLAMP coordinates to valid grid range [0, size-1]
    const clampedStartX = Math.max(0, Math.min(mapWidth - 1, startTileX));
    const clampedStartY = Math.max(0, Math.min(mapHeight - 1, startTileY));
    const clampedEndX = Math.max(0, Math.min(mapWidth - 1, endTileX));
    const clampedEndY = Math.max(0, Math.min(mapHeight - 1, endTileY));

    // Skip if start equals end after clamping
    if (clampedStartX === clampedEndX && clampedStartY === clampedEndY) return;

    tick.blackboard.set('pathPending', true);
    tick.blackboard.set('lastPathRequest', now);

    // Wrap in try-catch for safety
    try {
        easystar.findPath(clampedStartX, clampedStartY, clampedEndX, clampedEndY, (path) => {
            tick.blackboard.set('pathPending', false);
            if (path && path.length > 1) {
                tick.blackboard.set('path', path);
                tick.blackboard.set('pathIndex', 1);
            }
        });
    } catch (e) {
        // Silently ignore - bot will use fallback behavior
        tick.blackboard.set('pathPending', false);
    }
}

// ============================================
// BOT BEHAVIOR CLASS
// ============================================

export class BotBehavior {
    constructor(easystar, tileWidth, tileHeight) {
        this.easystar = easystar;
        this.tileWidth = tileWidth;
        this.tileHeight = tileHeight;

        // Create blackboard for persistent data
        this.blackboard = new b3.Blackboard();

        // Each bot gets a random speed multiplier for variety
        this.blackboard.set('speedMultiplier',
            AI.CHASE_SPEED_MIN + Math.random() * (AI.CHASE_SPEED_MAX - AI.CHASE_SPEED_MIN)
        );

        // Build the behavior tree
        this.tree = this.buildTree();
    }

    buildTree() {
        const tree = new b3.BehaviorTree();

        // Main behavior tree structure:
        // 1. Find target (within awareness range only)
        // 2. Priority selector:
        //    a. Attack: can see + in range + can shoot → shoot
        //    b. Hook: target above + can hook → use hook
        //    c. Swing: if on hook → swing toward target/anchor + jump-release
        //    d. Chase: can see → jump/hook if blocked, jump if higher, chase
        //    e. Investigate: has memory → jump/hook if blocked, go to last known
        //    f. Follow path
        //    g. Explore hook: periodically hook upward while patrolling
        //    h. Patrol

        tree.root = new b3.Sequence({
            children: [
                new FindClosestTarget(),
                new b3.Priority({
                    children: [
                        // Attack: if visible, in range, and can shoot
                        new b3.Sequence({
                            children: [
                                new CanSeeTarget(),
                                new IsInAttackRange(AI.ATTACK_RANGE_MAX),
                                new CanShoot(),
                                new Shoot()
                            ]
                        }),

                        // Hook: if target is above and we can hook
                        new b3.Sequence({
                            children: [
                                new TargetIsAbove(),
                                new CanUseHook(),
                                new HasHookTarget(),
                                new UseHook()
                            ]
                        }),

                        // Swing on hook if attached
                        new SwingOnHook(),

                        // Chase: if we can see target
                        new b3.Sequence({
                            children: [
                                new CanSeeTarget(),
                                new b3.Priority({
                                    children: [
                                        // Jump if blocked by wall and on ground
                                        new b3.Sequence({
                                            children: [
                                                new IsBlocked(),
                                                new IsOnGround(),
                                                new Jump()
                                            ]
                                        }),
                                        // Hook if blocked (wall too high for jump)
                                        new b3.Sequence({
                                            children: [
                                                new IsBlocked(),
                                                new CanUseHook(),
                                                new HasHookTarget(),
                                                new UseHook()
                                            ]
                                        }),
                                        // Jump if target is higher and we're on ground
                                        new b3.Sequence({
                                            children: [
                                                new TargetIsHigher(),
                                                new IsOnGround(),
                                                new Jump()
                                            ]
                                        }),
                                        new ChaseTarget()
                                    ]
                                })
                            ]
                        }),

                        // Investigate: go to last known target position
                        new b3.Sequence({
                            children: [
                                new HasMemoryOfTarget(),
                                new b3.Priority({
                                    children: [
                                        new b3.Sequence({
                                            children: [
                                                new IsBlocked(),
                                                new IsOnGround(),
                                                new Jump()
                                            ]
                                        }),
                                        // Hook if blocked during investigation
                                        new b3.Sequence({
                                            children: [
                                                new IsBlocked(),
                                                new CanUseHook(),
                                                new HasHookTarget(),
                                                new UseHook()
                                            ]
                                        }),
                                        new GoToLastKnownPosition()
                                    ]
                                })
                            ]
                        }),

                        // Follow path if we have one
                        new FollowPath(),

                        // Explore hook: periodically try to climb up while patrolling
                        new b3.Sequence({
                            children: [
                                new ShouldExploreUp(),
                                new CanUseHook(),
                                new HasHookTarget(),
                                new UseHook()
                            ]
                        }),

                        // Default: patrol
                        new Patrol()
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

        // Track hook time if on hook
        if (bot.core && bot.core.hookState === 'ATTACHED') {
            hookTime += delta;
        } else {
            hookTime = 0;
        }

        this.blackboard.set('hookCooldown', hookCooldown);
        this.blackboard.set('shootCooldown', shootCooldown);
        this.blackboard.set('hookTime', hookTime);
        this.blackboard.set('shootReaction', shootReaction);

        // Set context for this tick
        this.blackboard.set('context', { bot, scene });
        this.blackboard.set('delta', delta);
        this.blackboard.set('easystar', this.easystar);
        this.blackboard.set('mapTileWidth', this.tileWidth);
        this.blackboard.set('mapTileHeight', this.tileHeight);

        // Prepare input object
        const input = {
            direction: 0,
            jump: false,
            hookJustPressed: false,
            hookTarget: null,
            fire: false
        };
        this.blackboard.set('input', input);

        // Calculate EasyStar paths
        if (this.easystar) {
            this.easystar.calculate();
        }

        // Execute behavior tree
        this.tree.tick(null, this.blackboard);

        return this.blackboard.get('input');
    }
}
