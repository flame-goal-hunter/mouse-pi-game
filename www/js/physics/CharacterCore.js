// ============================================
// CHARACTER CORE - Simple Physics Controller (v28)
// ============================================
// Teeworlds-style movement with deterministic SimplePhysicsWorld.
// Hook uses manual distance constraint.

import { PHYS } from '../config.js';

export class CharacterCore {
    constructor() {
        // References (set via init)
        this.scene = null;
        this.body = null;           // SimpleBody from SimplePhysicsWorld
        this.physicsWorld = null;   // SimplePhysicsWorld reference
        this.sprite = null;         // Phaser sprite for userData access

        // State
        this.grounded = false;
        this.facingRight = true;

        // Jump mechanics
        this.jumpBuffer = 0;
        this.coyoteTime = 0;
        this.jumpHeld = false;
        this.canJump = true;
        this.airJumpUsed = false;

        // Hook state
        this.hookState = 'IDLE';  // IDLE, FLYING, ATTACHED
        this.hookPos = { x: 0, y: 0 };
        this.hookVel = { x: 0, y: 0 };
        this.hookAnchorPos = null;  // { x, y } — anchor coordinates
        this.ropeLength = 0;
        this.hookCooldown = 0;

        // Sound suppression (true for guest prediction — sounds come from host events)
        this.suppressSounds = false;

        // v24: Sound cooldowns (real time ms) - prevents double sounds during reconciliation
        this._soundLastPlayed = {
            jump: 0,
            hookFired: 0,
            hookAttached: 0
        };
    }

    /**
     * Check if sound can play (cooldown elapsed)
     */
    _canPlaySound(soundName, cooldownMs = 100) {
        const now = Date.now();
        if (now - this._soundLastPlayed[soundName] > cooldownMs) {
            this._soundLastPlayed[soundName] = now;
            return true;
        }
        return false;
    }

    /**
     * Initialize with SimpleBody and scene
     * @param {SimpleBody} body - Body from SimplePhysicsWorld
     * @param {SimplePhysicsWorld} physicsWorld - Physics world reference
     * @param {Phaser.Scene} scene - Game scene
     * @param {Phaser.GameObjects.Sprite} sprite - Character sprite
     */
    init(body, physicsWorld, scene, sprite = null) {
        this.body = body;
        this.physicsWorld = physicsWorld;
        this.scene = scene;
        this.sprite = sprite;
    }

    /**
     * Main physics tick - called each frame
     * @param {Object} input - { direction, jump, hookJustPressed, hookTarget, fire }
     * @param {number} delta - Frame time in ms
     */
    tick(input, delta) {
        if (!this.body || !this.scene) return { grounded: false, onRope: false };

        // Update timers
        this.hookCooldown = Math.max(0, this.hookCooldown - delta);
        this.jumpBuffer = Math.max(0, this.jumpBuffer - delta);
        this.coyoteTime = Math.max(0, this.coyoteTime - delta);

        // Check if grounded (from physics world)
        this.grounded = this.physicsWorld.isGrounded(this.body);

        // Update coyote time
        if (this.grounded) {
            this.coyoteTime = PHYS.COYOTE_TIME;
            this.canJump = true;
            this.airJumpUsed = false;
        }

        // Buffer jump input
        if (input.jump && !this.jumpHeld) {
            this.jumpBuffer = PHYS.JUMP_BUFFER;
        }
        this._prevJumpHeld = this.jumpHeld;
        this.jumpHeld = input.jump;

        // Process hook
        const onRope = this.processHook(input, delta);

        // Process jump (only if not on rope)
        if (!onRope) {
            this.processJump(input);
        }

        // Process movement
        this.processMovement(input, delta, onRope);

        // Limit velocity
        this.limitVelocity();

        return { grounded: this.grounded, onRope };
    }

    /**
     * Process jump input
     */
    processJump(input) {
        const hasDoubleJump = this.scene.canDoubleJump &&
                              this.scene.canDoubleJump(this.sprite);

        const canAirJump = hasDoubleJump &&
                           !this.grounded &&
                           !this.airJumpUsed &&
                           this.jumpBuffer > 0;

        const canJumpNow = (this.grounded || this.coyoteTime > 0) &&
                           this.jumpBuffer > 0 &&
                           this.canJump;

        if (canJumpNow || canAirJump) {
            this.body.vy = PHYS.JUMP_FORCE;

            this.jumpBuffer = 0;
            this.coyoteTime = 0;
            this.canJump = false;
            this.grounded = false;

            if (canAirJump) {
                this.airJumpUsed = true;
            }

            // Sound (with cooldown to prevent doubles during reconciliation)
            if (!this.suppressSounds && this._canPlaySound('jump') && this.scene.playSpatialSound) {
                this.scene.playSpatialSound('sfx-jump', this.body.x, this.body.y, 0.3);
            }

            return true;
        }
        return false;
    }

    /**
     * Process horizontal movement (velocity-based for responsive platformer feel)
     */
    processMovement(input, delta, onRope) {
        // Get speed multiplier from powerup
        const speedMult = this.scene.getSpeedMultiplier ?
            this.scene.getSpeedMultiplier(this.sprite) : 1;

        const maxSpeed = PHYS.MAX_SPEED_X * speedMult;

        if (input.direction !== 0) {
            // Target velocity based on input
            const targetVx = onRope
                ? input.direction * maxSpeed * 0.9
                : input.direction * maxSpeed;

            // Acceleration rate: faster on ground, slower in air
            const accelRate = this.grounded ? PHYS.GROUND_ACCEL : PHYS.AIR_ACCEL;

            // Lerp toward target velocity
            this.body.vx = this.body.vx + (targetVx - this.body.vx) * accelRate;
            this.facingRight = input.direction > 0;
        } else if (this.grounded) {
            // No input + grounded → apply friction
            const newVx = this.body.vx * PHYS.GROUND_FRICTION;
            if (Math.abs(newVx) < 1) {
                this.body.vx = 0;
            } else {
                this.body.vx = newVx;
            }
        }
        // In air with no input → keep momentum (no air friction)
    }

    /**
     * Limit velocity to prevent infinite acceleration
     */
    limitVelocity() {
        const speedMult = this.scene.getSpeedMultiplier ?
            this.scene.getSpeedMultiplier(this.sprite) : 1;

        const maxSpeedX = PHYS.MAX_SPEED_X * speedMult;

        if (Math.abs(this.body.vx) > maxSpeedX) {
            this.body.vx = Math.sign(this.body.vx) * maxSpeedX;
        }
        if (this.body.vy > PHYS.MAX_SPEED_Y) {
            this.body.vy = PHYS.MAX_SPEED_Y;
        }
    }

    // === HOOK / GRAPPLE (manual distance constraint) ===

    /**
     * Launch hook toward target
     */
    launchHook(targetX, targetY) {
        if (this.hookState !== 'IDLE' || this.hookCooldown > 0) return false;
        if (!this.scene) return false;

        const dx = targetX - this.body.x;
        const dy = targetY - this.body.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 10) return false;
        if (dist > PHYS.HOOK_RANGE) return false;

        const nx = dx / dist;
        const ny = dy / dist;

        this.hookPos.x = this.body.x;
        this.hookPos.y = this.body.y;
        this.hookVel.x = nx * PHYS.HOOK_SPEED;
        this.hookVel.y = ny * PHYS.HOOK_SPEED;
        this.hookState = 'FLYING';
        this.hookCooldown = PHYS.HOOK_COOLDOWN;

        if (!this.suppressSounds && this._canPlaySound('hookFired') && this.scene.playSpatialSound) {
            this.scene.playSpatialSound('sfx-hook-fired', this.body.x, this.body.y, 0.2);
        }

        return true;
    }

    /**
     * Process hook logic each frame
     */
    processHook(input, delta) {
        if (input.hookJustPressed) {
            if (this.hookState === 'IDLE' && input.hookTarget) {
                this.launchHook(input.hookTarget.x, input.hookTarget.y);
            } else if (this.hookState === 'ATTACHED') {
                this.releaseHook();
                return false;
            }
        }

        if (this.hookState === 'IDLE') return false;

        if (this.hookState === 'FLYING') {
            return this.updateFlyingHook(delta);
        }

        if (this.hookState === 'ATTACHED') {
            return this.updateAttachedHook(input, delta);
        }

        return false;
    }

    /**
     * Update hook while flying through air
     */
    updateFlyingHook(delta) {
        const frames = delta / 16.67;

        this.hookPos.x += this.hookVel.x * frames;
        this.hookPos.y += this.hookVel.y * frames;

        // Gravity on hook projectile
        this.hookVel.y += 0.3 * frames;

        // Check collision with tilemap using raycast
        if (this.physicsWorld) {
            const result = this.physicsWorld.raycast(
                this.body.x, this.body.y,
                this.hookPos.x, this.hookPos.y
            );
            if (result && result.hit) {
                this.attachHook(result.x, result.y);
                return true;
            }
        }

        // Fallback: check with Phaser tilemap if physicsWorld raycast not available
        if (this.scene.platformLayer) {
            const tile = this.scene.platformLayer.getTileAtWorldXY(this.hookPos.x, this.hookPos.y);
            if (tile && tile.index > 0) {
                this.attachHook(tile.getCenterX(), tile.getCenterY());
                return true;
            }
        }

        // Check range
        const dist = Math.hypot(
            this.hookPos.x - this.body.x,
            this.hookPos.y - this.body.y
        );

        if (dist > PHYS.HOOK_RANGE) {
            this.releaseHook();
        }

        return false;
    }

    /**
     * Attach hook — store anchor position and calculate rope length
     */
    attachHook(anchorX, anchorY) {
        if (!this.scene) return;

        this.hookAnchorPos = { x: anchorX, y: anchorY };
        this.ropeLength = Math.hypot(anchorX - this.body.x, anchorY - this.body.y);
        this.hookState = 'ATTACHED';
        this.hookPos.x = anchorX;
        this.hookPos.y = anchorY;
        this._hookStuckTimer = 0;

        if (!this.suppressSounds && this._canPlaySound('hookAttached') && this.scene.playSpatialSound) {
            this.scene.playSpatialSound('sfx-hook-attached', anchorX, anchorY, 0.3);
        }
    }

    /**
     * Update while attached — distance constraint (replicates original Matter.js rope).
     * Rope has stiffness, damping, auto-reel, and supplemental pull.
     */
    updateAttachedHook(input, delta) {
        if (!this.hookAnchorPos) {
            this.releaseHook();
            return false;
        }

        // Vector to anchor
        const dx = this.hookAnchorPos.x - this.body.x;
        const dy = this.hookAnchorPos.y - this.body.y;
        const dist = Math.hypot(dx, dy);

        // Jump → release with swing momentum (original behavior)
        if (this.jumpBuffer > 0) {
            let swingVx = this.body.vx * 1.1;
            let swingVy = Math.min(this.body.vy, PHYS.JUMP_FORCE * 0.95);

            // Anti-tunneling: check tiles ahead (from original)
            if (this.scene.platformLayer) {
                const halfW = 25, halfH = 30;
                const dt = 1 / 60;
                const frameVx = swingVx * dt;
                const frameVy = swingVy * dt;

                const checkX = this.body.x + Math.sign(swingVx) * (halfW + Math.abs(frameVx) * 2);
                const tileH = this.scene.platformLayer.getTileAtWorldXY(checkX, this.body.y);
                if (tileH && tileH.index > 0) swingVx = 0;

                const checkY = this.body.y + Math.sign(swingVy) * (halfH + Math.abs(frameVy) * 2);
                const tileV = this.scene.platformLayer.getTileAtWorldXY(this.body.x, checkY);
                if (tileV && tileV.index > 0) {
                    const anchorTile = this.scene.platformLayer.getTileAtWorldXY(
                        this.hookAnchorPos.x, this.hookAnchorPos.y
                    );
                    if (!anchorTile || tileV !== anchorTile) {
                        swingVy = Math.max(swingVy, -180);
                    }
                }
            }

            this.body.vx = swingVx;
            this.body.vy = swingVy;
            this.jumpBuffer = 0;
            this.coyoteTime = 0;
            this.canJump = false;
            this._hookStuckTimer = 0;
            this.releaseHook();
            this.hookCooldown = PHYS.HOOK_COOLDOWN * 0.5;
            return false;
        }

        // Auto-release: stuck near anchor with low speed for 500ms
        if (!this._hookStuckTimer) this._hookStuckTimer = 0;
        const speed = Math.hypot(this.body.vx, this.body.vy);
        if (speed < 80 && dist < 80) {
            this._hookStuckTimer += delta;
            if (this._hookStuckTimer > 500) {
                this._hookStuckTimer = 0;
                this.releaseHook();
                return false;
            }
        } else {
            this._hookStuckTimer = 0;
        }

        // Auto-reel: shorten rope (bots can disable via hookNoReel)
        const noReel = this.sprite?.getData?.('hookNoReel');
        if (!noReel && this.ropeLength > PHYS.HOOK_MIN_LENGTH) {
            this.ropeLength -= PHYS.HOOK_REEL_SPEED;
        }

        // Distance constraint: enforce rope length
        if (dist > this.ropeLength && dist > 0) {
            const nx = dx / dist;
            const ny = dy / dist;

            // Radial velocity (positive = toward anchor)
            const radialVel = this.body.vx * nx + this.body.vy * ny;

            // If moving away from anchor, remove outward velocity (stiffness)
            if (radialVel < 0) {
                const correction = -radialVel * PHYS.HOOK_STIFFNESS;
                this.body.vx += nx * correction;
                this.body.vy += ny * correction;
            }

            // Apply damping to radial velocity
            const currentRadial = this.body.vx * nx + this.body.vy * ny;
            if (Math.abs(currentRadial) > 0) {
                const dampForce = -currentRadial * PHYS.HOOK_DAMPING;
                this.body.vx += nx * dampForce;
                this.body.vy += ny * dampForce;
            }

            // Pull back to rope length (spring correction)
            const overshoot = dist - this.ropeLength;
            this.body.vx += nx * overshoot * 3;
            this.body.vy += ny * overshoot * 3;
        }

        // Supplemental pull toward anchor (impulse effect - v28: direct velocity add)
        if (dist > 0) {
            // Original was applyImpulse with 0.48, which adds directly to velocity
            // For mass ~1, impulse ≈ velocity change
            this.body.vx += (dx / dist) * 0.48;
            this.body.vy += (dy / dist) * 0.48;
        }

        return true; // On rope
    }

    /**
     * Release hook — just clear anchor
     */
    releaseHook() {
        this.hookAnchorPos = null;
        this.hookState = 'IDLE';
        this.hookPos.x = 0;
        this.hookPos.y = 0;
        this.hookVel.x = 0;
        this.hookVel.y = 0;
    }

    /**
     * Apply knockback force (impulse → velocity change)
     */
    applyKnockback(fromX, fromY, force = PHYS.KNOCKBACK_FORCE) {
        if (!this.body) return;

        const dx = this.body.x - fromX;
        const dy = this.body.y - fromY;
        const dist = Math.hypot(dx, dy);

        if (dist > 0) {
            // v28: Direct velocity change (impulse with mass ~1)
            this.body.vx += (dx / dist) * force;
            this.body.vy += (dy / dist) * force * 0.5;
        }
    }

    /**
     * Get current hook attachment point for drawing
     */
    getHookAttachPoint() {
        if (this.hookState === 'ATTACHED' && this.hookAnchorPos) {
            return { x: this.hookAnchorPos.x, y: this.hookAnchorPos.y };
        }
        return null;
    }

    // === v28: QUANTIZE FOR NETWORK DETERMINISM ===

    /**
     * Teeworlds round_to_int: banker's rounding
     */
    static roundToInt(f) {
        return f > 0 ? Math.floor(f + 0.5) : Math.ceil(f - 0.5);
    }

    /**
     * Quantize position and velocity for network determinism.
     * Called after each physics step.
     */
    quantize() {
        if (!this.body) return;

        // Quantize position to 0.01px for cross-platform determinism
        this.body.x = Math.round(this.body.x * 100) / 100;
        this.body.y = Math.round(this.body.y * 100) / 100;

        // Quantize velocity (fixed-point 256 — 1/256 unit precision)
        this.body.vx = CharacterCore.roundToInt(this.body.vx * 256) / 256;
        this.body.vy = CharacterCore.roundToInt(this.body.vy * 256) / 256;

        // Quantize hook position for ALL active states
        if (this.hookState === 'FLYING') {
            this.hookPos.x = CharacterCore.roundToInt(this.hookPos.x);
            this.hookPos.y = CharacterCore.roundToInt(this.hookPos.y);
        } else if (this.hookState === 'ATTACHED' && this.hookAnchorPos) {
            // Quantize anchor position to prevent drift
            this.hookAnchorPos.x = CharacterCore.roundToInt(this.hookAnchorPos.x);
            this.hookAnchorPos.y = CharacterCore.roundToInt(this.hookAnchorPos.y);
            // Quantize rope length to 1/16 precision
            this.ropeLength = CharacterCore.roundToInt(this.ropeLength * 16) / 16;
        }
    }

    /**
     * Save full CharacterCore state for input replay.
     * Used by Teeworlds-style server reconciliation.
     * @returns {Object} State snapshot
     */
    saveState() {
        return {
            grounded: this.grounded,
            facingRight: this.facingRight,
            jumpBuffer: this.jumpBuffer,
            coyoteTime: this.coyoteTime,
            jumpHeld: this.jumpHeld,
            canJump: this.canJump,
            airJumpUsed: this.airJumpUsed,
            hookState: this.hookState,
            hookPos: { x: this.hookPos.x, y: this.hookPos.y },
            hookVel: { x: this.hookVel.x, y: this.hookVel.y },
            hookAnchorPos: this.hookAnchorPos
                ? { x: this.hookAnchorPos.x, y: this.hookAnchorPos.y }
                : null,
            ropeLength: this.ropeLength,
            hookCooldown: this.hookCooldown,
            _hookStuckTimer: this._hookStuckTimer || 0
        };
    }

    /**
     * Restore CharacterCore state from snapshot.
     * Used by Teeworlds-style server reconciliation.
     * @param {Object} state - State snapshot from saveState()
     */
    restoreState(state) {
        this.grounded = state.grounded;
        this.facingRight = state.facingRight;
        this.jumpBuffer = state.jumpBuffer;
        this.coyoteTime = state.coyoteTime;
        this.jumpHeld = state.jumpHeld;
        this.canJump = state.canJump;
        this.airJumpUsed = state.airJumpUsed;
        this.hookState = state.hookState;
        this.hookPos.x = state.hookPos.x;
        this.hookPos.y = state.hookPos.y;
        this.hookVel.x = state.hookVel.x;
        this.hookVel.y = state.hookVel.y;
        this.hookAnchorPos = state.hookAnchorPos
            ? { x: state.hookAnchorPos.x, y: state.hookAnchorPos.y }
            : null;
        this.ropeLength = state.ropeLength;
        this.hookCooldown = state.hookCooldown;
        this._hookStuckTimer = state._hookStuckTimer;
    }

    // === COMPATIBILITY GETTERS (for code expecting Rapier-style API) ===

    /**
     * Get position in Rapier-style format
     */
    getPosition() {
        return { x: this.body?.x || 0, y: this.body?.y || 0 };
    }

    /**
     * Get velocity in Rapier-style format
     */
    getVelocity() {
        return { x: this.body?.vx || 0, y: this.body?.vy || 0 };
    }

    /**
     * Set position
     */
    setPosition(x, y) {
        if (this.body) {
            this.body.x = x;
            this.body.y = y;
        }
    }

    /**
     * Set velocity
     */
    setVelocity(vx, vy) {
        if (this.body) {
            this.body.vx = vx;
            this.body.vy = vy;
        }
    }
}
