// ============================================
// OBSTACLE SOLVER - Smart strategy selection for bot obstacles
// Evaluates jump strategies (simple, momentum) and retreat.
// Hook traversal is handled by reactive hook system in BotBehavior.
// ============================================

import { PHYS, TILE_SIZE } from '../config.js';

// Strategy types
const StrategyType = {
    SIMPLE_JUMP:   'SIMPLE_JUMP',
    MOMENTUM_JUMP: 'MOMENTUM_JUMP',
    RETREAT:       'RETREAT',
};

// Action types within a strategy
const ActionType = {
    WALK:              'WALK',
    JUMP:              'JUMP',
    AIR_CONTROL:       'AIR_CONTROL',
};

class StrategyAction {
    constructor(type, duration, params = {}) {
        this.type = type;
        this.duration = duration; // ms
        this.params = params;
    }
}

class Strategy {
    constructor(type, score, actions) {
        this.type = type;
        this.score = score;
        this.actions = actions;
        this.currentStep = 0;
        this.stepTimer = 0;
    }
}

// ============================================
// PHYSICS HELPERS
// ============================================

const T = TILE_SIZE;
const GRAVITY = PHYS.GRAVITY;
const JUMP_VY = PHYS.JUMP_FORCE;       // -15
const MAX_SPEED_X = PHYS.MAX_SPEED_X;  // 8

function maxJumpHeight() {
    // v^2 = u^2 + 2as -> 0 = JUMP_VY^2 - 2*GRAVITY*h -> h = JUMP_VY^2 / (2*GRAVITY)
    return (JUMP_VY * JUMP_VY) / (2 * GRAVITY);
}

function maxJumpDistance(vx = MAX_SPEED_X) {
    // Airtime: 2 * |JUMP_VY| / GRAVITY
    const airTime = 2 * Math.abs(JUMP_VY) / GRAVITY;
    return vx * airTime;
}

function simulateJump(startX, startY, vx, vy, platformLayer, maxFrames = 90) {
    let x = startX, y = startY;
    let curVy = vy;

    for (let f = 0; f < maxFrames; f++) {
        curVy += GRAVITY;
        x += vx;
        y += curVy;

        // Check landing (only on the way down)
        if (curVy > 0 && platformLayer) {
            const tile = platformLayer.getTileAtWorldXY(x, y);
            if (tile && tile.index > 0) {
                return { landed: true, x, y, frame: f };
            }
        }
    }
    return { landed: false, x, y, frame: maxFrames };
}

// ============================================
// OBSTACLE SOLVER CLASS
// ============================================

export class ObstacleSolver {
    constructor(platformNav, platformLayer) {
        this.nav = platformNav;
        this.platformLayer = platformLayer;
    }

    /**
     * Evaluate obstacle and return best strategy.
     * @param {Object} bot - Bot sprite with .x, .y, .core
     * @param {Object} obstacle - { fromX, fromY, toX, toY }
     * @param {Object} context - { hookCooldown, hookState }
     * @returns {Strategy|null}
     */
    solve(bot, obstacle, context) {
        this.waterY = context.waterY || null;
        console.log(`[ObstacleSolver] solve: bot=(${bot.x.toFixed(0)},${bot.y.toFixed(0)}) obstacle=(${obstacle.fromX.toFixed(0)},${obstacle.fromY.toFixed(0)})→(${obstacle.toX.toFixed(0)},${obstacle.toY.toFixed(0)}) last=${context.lastStrategyType}`);
        const candidates = [];

        candidates.push(this.evaluateSimpleJump(bot, obstacle));
        candidates.push(this.evaluateMomentumJump(bot, obstacle));
        // Anti-oscillation: skip RETREAT if last strategy was RETREAT
        if (context.lastStrategyType !== 'RETREAT') {
            candidates.push(this.evaluateRetreat(bot, obstacle));
        }

        const viable = candidates.filter(s => s !== null);
        viable.sort((a, b) => b.score - a.score);

        if (viable.length > 0) {
            console.log(`[ObstacleSolver] chose ${viable[0].type} (score: ${viable[0].score.toFixed(1)}) from ${viable.length} viable`);
        }

        return viable.length > 0 ? viable[0] : null;
    }

    // --- SIMPLE_JUMP ---
    evaluateSimpleJump(bot, obstacle) {
        const dx = obstacle.toX - obstacle.fromX;
        const dy = obstacle.fromY - obstacle.toY; // positive = target above

        const maxH = maxJumpHeight();
        const maxD = maxJumpDistance();

        // Can't reach with a single jump?
        if (dy > maxH * 1.1) return null;
        if (Math.abs(dx) > maxD * 0.9) return null;

        // Simulate to verify
        const jumpDir = dx > 0 ? 1 : -1;
        const simVx = jumpDir * MAX_SPEED_X * 0.7;
        const sim = simulateJump(
            obstacle.fromX, obstacle.fromY,
            simVx, JUMP_VY,
            this.platformLayer
        );

        if (!sim.landed) return null;
        if (this.waterY && sim.y > this.waterY - T) return null;

        const landDist = Math.hypot(sim.x - obstacle.toX, sim.y - obstacle.toY);
        if (landDist > T * 4) return null;

        let score = 80;
        score -= (Math.abs(dx) / maxD) * 20;
        score -= (dy / maxH) * 15;
        score += 10; // bonus: no resource cost

        return new Strategy(StrategyType.SIMPLE_JUMP, Math.max(0, score), [
            new StrategyAction(ActionType.WALK, 200, { direction: jumpDir }),
            new StrategyAction(ActionType.JUMP, 50, { direction: jumpDir }),
            new StrategyAction(ActionType.AIR_CONTROL, 800, { direction: jumpDir }),
        ]);
    }

    // --- MOMENTUM_JUMP ---
    evaluateMomentumJump(bot, obstacle) {
        const dx = obstacle.toX - obstacle.fromX;
        const absDx = Math.abs(dx);
        const dy = obstacle.fromY - obstacle.toY;

        const casualDist = maxJumpDistance(MAX_SPEED_X * 0.5);
        const fullDist = maxJumpDistance(MAX_SPEED_X);

        // Only useful for medium-long horizontal gaps
        if (absDx <= casualDist) return null;
        if (absDx > fullDist * 1.15) return null;
        if (dy > maxJumpHeight()) return null;

        const jumpDir = dx > 0 ? 1 : -1;

        // Simulate with full speed
        const sim = simulateJump(
            obstacle.fromX, obstacle.fromY,
            jumpDir * MAX_SPEED_X, JUMP_VY,
            this.platformLayer
        );

        if (!sim.landed) return null;
        if (this.waterY && sim.y > this.waterY - T) return null;
        const landDist = Math.hypot(sim.x - obstacle.toX, sim.y - obstacle.toY);
        if (landDist > T * 4) return null;

        let score = 70;
        score -= (absDx / fullDist) * 20;
        score += 5; // no hook needed

        return new Strategy(StrategyType.MOMENTUM_JUMP, Math.max(0, score), [
            new StrategyAction(ActionType.WALK, 300, { direction: -jumpDir }), // back up
            new StrategyAction(ActionType.WALK, 500, { direction: jumpDir }),   // sprint
            new StrategyAction(ActionType.JUMP, 50, { direction: jumpDir }),
            new StrategyAction(ActionType.AIR_CONTROL, 800, { direction: jumpDir }),
        ]);
    }

    // --- RETREAT ---
    evaluateRetreat(bot, obstacle) {
        const dx = obstacle.toX - bot.x;
        const retreatDir = dx > 0 ? -1 : 1;

        const currentPlatform = this.nav?.getPlatformAt(bot.x, bot.y);
        if (!currentPlatform) return null;

        // Retreat target: opposite edge of current platform
        const retreatX = retreatDir > 0 ? currentPlatform.rightX - T : currentPlatform.leftX + T;
        const retreatDist = Math.abs(retreatX - bot.x);
        if (retreatDist < T * 1.5) return null; // already at edge

        // Don't retreat toward water — check if platform edge has no ground beyond and water below
        if (this.waterY && currentPlatform.surfaceY + T * 3 > this.waterY) {
            // Platform is near water level — check if retreat edge has ground beyond
            const beyondX = retreatDir > 0 ? currentPlatform.rightX + T : currentPlatform.leftX - T;
            const tileBeyond = this.platformLayer?.getTileAtWorldXY(beyondX, currentPlatform.surfaceY);
            if (!tileBeyond || tileBeyond.index <= 0) return null; // no ground beyond retreat edge near water
        }

        let score = 30;

        // Bonus: navigable edges going backward from this platform
        const edges = this.nav?.adjacency?.get(currentPlatform.id) || [];
        const backEdges = edges.filter(e => {
            const toPlatform = this.nav.platforms[e.to];
            return (retreatDir > 0 && toPlatform.centerX > bot.x) ||
                   (retreatDir < 0 && toPlatform.centerX < bot.x);
        });
        if (backEdges.length > 0) score += 10;

        return new Strategy(StrategyType.RETREAT, Math.min(40, Math.max(0, score)), [
            new StrategyAction(ActionType.WALK, 800, { direction: retreatDir }),
        ]);
    }

}

// ============================================
// STRATEGY EXECUTOR (called from BotBehavior)
// ============================================

/**
 * Execute one tick of the active strategy.
 * @returns {'MOVING' | 'DONE' | 'FAILED'}
 */
export function executeStrategy(bot, strategy, input, delta) {
    if (strategy.currentStep >= strategy.actions.length) return 'DONE';

    const action = strategy.actions[strategy.currentStep];
    strategy.stepTimer += delta;

    switch (action.type) {
        case ActionType.WALK:
            input.direction = action.params.direction || 0;
            // Stop early if reached targetX
            if (action.params.targetX != null) {
                const dx = action.params.targetX - bot.x;
                if (Math.abs(dx) < T * 0.5) {
                    strategy.currentStep++;
                    strategy.stepTimer = 0;
                    return 'MOVING';
                }
            }
            break;

        case ActionType.JUMP:
            input.direction = action.params.direction || 0;
            input.jump = true;
            break;

        case ActionType.AIR_CONTROL:
            input.direction = action.params.direction || 0;
            // Done when landed (after a brief initial airborne period)
            if (bot.core?.grounded && strategy.stepTimer > 100) {
                strategy.currentStep++;
                strategy.stepTimer = 0;
                return 'MOVING';
            }
            break;

    }

    // Advance on duration timeout
    if (strategy.stepTimer >= action.duration) {
        console.log(`[Strategy] ${strategy.type} step ${strategy.currentStep}/${strategy.actions.length} TIMEOUT: ${action.type} after ${action.duration}ms | bot=(${bot.x.toFixed(0)},${bot.y.toFixed(0)}) hookState=${bot.core?.hookState}`);
        strategy.currentStep++;
        strategy.stepTimer = 0;
    }

    if (strategy.currentStep >= strategy.actions.length) return 'DONE';
    return 'MOVING';
}
