// ============================================
// CHARACTER CORE - Rapier2D Physics Controller
// ============================================
// Teeworlds-style movement with Rapier2D physics.
// Hook uses manual distance constraint (Rapier rope joint
// doesn't support dynamic length changes).

import { PHYS } from '../config.js';

export class CharacterCore {
    constructor() {
        // References (set via init)
        this.scene = null;
        this.rapierBody = null;    // Rapier2D rigid body
        this.rapierWorld = null;   // RapierWorld wrapper (for ground detection)

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
    }

    /**
     * Initialize with Rapier body and scene
     */
    init(rapierBody, rapierWorld, scene) {
        this.rapierBody = rapierBody;
        this.rapierWorld = rapierWorld;
        this.scene = scene;
    }

    /**
     * Main physics tick - called each frame
     * @param {Object} input - { direction, jump, hookJustPressed, hookTarget, fire }
     * @param {number} delta - Frame time in ms
     */
    tick(input, delta) {
        if (!this.rapierBody || !this.scene) return { grounded: false, onRope: false };

        // Update timers
        this.hookCooldown = Math.max(0, this.hookCooldown - delta);
        this.jumpBuffer = Math.max(0, this.jumpBuffer - delta);
        this.coyoteTime = Math.max(0, this.coyoteTime - delta);

        // Check if grounded (ray cast)
        this.grounded = this.rapierWorld.isGrounded(this.rapierBody, 30); // halfH = 30

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
        const sprite = this.rapierBody.userData;
        const hasDoubleJump = this.scene.canDoubleJump &&
                              this.scene.canDoubleJump(sprite);

        const canAirJump = hasDoubleJump &&
                           !this.grounded &&
                           !this.airJumpUsed &&
                           this.jumpBuffer > 0;

        const canJumpNow = (this.grounded || this.coyoteTime > 0) &&
                           this.jumpBuffer > 0 &&
                           this.canJump;

        if (canJumpNow || canAirJump) {
            const vel = this.rapierBody.linvel();
            this.rapierBody.setLinvel({ x: vel.x, y: PHYS.JUMP_FORCE }, true);

            this.jumpBuffer = 0;
            this.coyoteTime = 0;
            this.canJump = false;
            this.grounded = false;

            if (canAirJump) {
                this.airJumpUsed = true;
            }

            // Sound
            if (!this.suppressSounds && this.scene.playSpatialSound) {
                const pos = this.rapierBody.translation();
                this.scene.playSpatialSound('sfx-jump', pos.x, pos.y, 0.3);
            }

            return true;
        }
        return false;
    }

    /**
     * Process horizontal movement (velocity-based for responsive platformer feel)
     */
    processMovement(input, delta, onRope) {
        const vel = this.rapierBody.linvel();
        const sprite = this.rapierBody.userData;

        // Get speed multiplier from powerup
        const speedMult = this.scene.getSpeedMultiplier ?
            this.scene.getSpeedMultiplier(sprite) : 1;

        const maxSpeed = PHYS.MAX_SPEED_X * speedMult;

        if (input.direction !== 0) {
            // Target velocity based on input
            const targetVx = onRope
                ? input.direction * maxSpeed * 0.9
                : input.direction * maxSpeed;

            // Acceleration rate: faster on ground, slower in air
            const accelRate = this.grounded ? PHYS.GROUND_ACCEL : PHYS.AIR_ACCEL;

            // Lerp toward target velocity
            const newVx = vel.x + (targetVx - vel.x) * accelRate;
            this.rapierBody.setLinvel({ x: newVx, y: vel.y }, true);
            this.facingRight = input.direction > 0;
        } else if (this.grounded) {
            // No input + grounded → apply friction
            const newVx = vel.x * PHYS.GROUND_FRICTION;
            if (Math.abs(newVx) < 1) {
                this.rapierBody.setLinvel({ x: 0, y: vel.y }, true);
            } else {
                this.rapierBody.setLinvel({ x: newVx, y: vel.y }, true);
            }
        }
        // In air with no input → keep momentum (no air friction)
    }

    /**
     * Limit velocity to prevent infinite acceleration
     */
    limitVelocity() {
        const vel = this.rapierBody.linvel();
        const sprite = this.rapierBody.userData;

        const speedMult = this.scene.getSpeedMultiplier ?
            this.scene.getSpeedMultiplier(sprite) : 1;

        const maxSpeedX = PHYS.MAX_SPEED_X * speedMult;

        let clampedVx = vel.x;
        let clampedVy = vel.y;

        if (Math.abs(vel.x) > maxSpeedX) {
            clampedVx = Math.sign(vel.x) * maxSpeedX;
        }
        if (vel.y > PHYS.MAX_SPEED_Y) {
            clampedVy = PHYS.MAX_SPEED_Y;
        }

        if (clampedVx !== vel.x || clampedVy !== vel.y) {
            this.rapierBody.setLinvel({ x: clampedVx, y: clampedVy }, true);
        }
    }

    // === HOOK / GRAPPLE (manual distance constraint) ===

    /**
     * Launch hook toward target
     */
    launchHook(targetX, targetY) {
        if (this.hookState !== 'IDLE' || this.hookCooldown > 0) return false;
        if (!this.scene) return false;

        const pos = this.rapierBody.translation();
        const dx = targetX - pos.x;
        const dy = targetY - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 10) return false;
        if (dist > PHYS.HOOK_RANGE) return false;

        const nx = dx / dist;
        const ny = dy / dist;

        this.hookPos.x = pos.x;
        this.hookPos.y = pos.y;
        this.hookVel.x = nx * PHYS.HOOK_SPEED;
        this.hookVel.y = ny * PHYS.HOOK_SPEED;
        this.hookState = 'FLYING';
        this.hookCooldown = PHYS.HOOK_COOLDOWN;

        if (!this.suppressSounds && this.scene.playSpatialSound) {
            this.scene.playSpatialSound('sfx-hook-fired', pos.x, pos.y, 0.2);
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

        // Check collision with tilemap
        if (this.scene.platformLayer) {
            const tile = this.scene.platformLayer.getTileAtWorldXY(this.hookPos.x, this.hookPos.y);
            if (tile && tile.index > 0) {
                this.attachHook(tile.getCenterX(), tile.getCenterY());
                return true;
            }
        }

        // Check range
        const pos = this.rapierBody.translation();
        const dist = Math.hypot(
            this.hookPos.x - pos.x,
            this.hookPos.y - pos.y
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
        const pos = this.rapierBody.translation();
        this.ropeLength = Math.hypot(anchorX - pos.x, anchorY - pos.y);
        this.hookState = 'ATTACHED';
        this.hookPos.x = anchorX;
        this.hookPos.y = anchorY;
        this._hookStuckTimer = 0;

        if (!this.suppressSounds && this.scene.playSpatialSound) {
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

        const pos = this.rapierBody.translation();
        const vel = this.rapierBody.linvel();

        // Vector to anchor
        const dx = this.hookAnchorPos.x - pos.x;
        const dy = this.hookAnchorPos.y - pos.y;
        const dist = Math.hypot(dx, dy);

        // Jump → release with swing momentum (original behavior)
        if (this.jumpBuffer > 0) {
            let swingVx = vel.x * 1.1;
            let swingVy = Math.min(vel.y, PHYS.JUMP_FORCE * 0.95);

            // Anti-tunneling: check tiles ahead (from original)
            // Convert px/s to per-frame distance for tile check (matching Matter.js original)
            if (this.scene.platformLayer) {
                const halfW = 25, halfH = 30;
                const dt = 1 / 60;
                const frameVx = swingVx * dt;
                const frameVy = swingVy * dt;

                const checkX = pos.x + Math.sign(swingVx) * (halfW + Math.abs(frameVx) * 2);
                const tileH = this.scene.platformLayer.getTileAtWorldXY(checkX, pos.y);
                if (tileH && tileH.index > 0) swingVx = 0;

                const checkY = pos.y + Math.sign(swingVy) * (halfH + Math.abs(frameVy) * 2);
                const tileV = this.scene.platformLayer.getTileAtWorldXY(pos.x, checkY);
                if (tileV && tileV.index > 0) {
                    const anchorTile = this.scene.platformLayer.getTileAtWorldXY(
                        this.hookAnchorPos.x, this.hookAnchorPos.y
                    );
                    if (!anchorTile || tileV !== anchorTile) {
                        swingVy = Math.max(swingVy, -180);
                    }
                }
            }

            this.rapierBody.setLinvel({ x: swingVx, y: swingVy }, true);
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
        const speed = Math.hypot(vel.x, vel.y);
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
        const sprite = this.rapierBody.userData;
        const noReel = sprite?.getData?.('hookNoReel');
        if (!noReel && this.ropeLength > PHYS.HOOK_MIN_LENGTH) {
            this.ropeLength -= PHYS.HOOK_REEL_SPEED;
        }

        // Distance constraint: enforce rope length
        if (dist > this.ropeLength && dist > 0) {
            const nx = dx / dist;
            const ny = dy / dist;

            // Radial velocity (positive = toward anchor)
            const radialVel = vel.x * nx + vel.y * ny;

            // If moving away from anchor, remove outward velocity (stiffness)
            if (radialVel < 0) {
                const correction = -radialVel * PHYS.HOOK_STIFFNESS;
                this.rapierBody.setLinvel({
                    x: vel.x + nx * correction,
                    y: vel.y + ny * correction
                }, true);
            }

            // Apply damping to radial velocity
            const currentVel = this.rapierBody.linvel();
            const currentRadial = currentVel.x * nx + currentVel.y * ny;
            if (Math.abs(currentRadial) > 0) {
                const dampForce = -currentRadial * PHYS.HOOK_DAMPING;
                this.rapierBody.setLinvel({
                    x: currentVel.x + nx * dampForce,
                    y: currentVel.y + ny * dampForce
                }, true);
            }

            // Pull back to rope length (spring correction)
            const overshoot = dist - this.ropeLength;
            const pullVel = this.rapierBody.linvel();
            this.rapierBody.setLinvel({
                x: pullVel.x + nx * overshoot * 3,
                y: pullVel.y + ny * overshoot * 3
            }, true);
        }

        // Supplemental pull toward anchor (original: applyForce 0.008, scaled ×60 for px/s)
        if (dist > 0) {
            this.rapierBody.applyImpulse({
                x: (dx / dist) * 0.48,
                y: (dy / dist) * 0.48
            }, true);
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
     * Apply knockback force
     */
    applyKnockback(fromX, fromY, force = PHYS.KNOCKBACK_FORCE) {
        if (!this.rapierBody) return;

        const pos = this.rapierBody.translation();
        const dx = pos.x - fromX;
        const dy = pos.y - fromY;
        const dist = Math.hypot(dx, dy);

        if (dist > 0) {
            this.rapierBody.applyImpulse({
                x: (dx / dist) * force,
                y: (dy / dist) * force * 0.5
            }, true);
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

    // === TEEWORLDS v15: QUANTIZE FOR NETWORK DETERMINISM ===

    /**
     * Teeworlds round_to_int: banker's rounding
     */
    static roundToInt(f) {
        return f > 0 ? Math.floor(f + 0.5) : Math.ceil(f - 0.5);
    }

    /**
     * Quantize velocity for network determinism (Teeworlds-style)
     * Called after each physics step to ensure client/server agreement
     *
     * NOTE: Position quantization removed — pixel coordinates don't work with
     * integer rounding (small movements get lost, causing jitter/stuck).
     * Velocity quantization (256 fixed-point) is sufficient for determinism.
     */
    quantize() {
        const body = this.rapierBody;
        if (!body) return;

        const vel = body.linvel();

        // Quantize velocity only (fixed-point 256 — 1/256 unit precision)
        const qvx = CharacterCore.roundToInt(vel.x * 256) / 256;
        const qvy = CharacterCore.roundToInt(vel.y * 256) / 256;

        body.setLinvel({ x: qvx, y: qvy }, true);

        // v18 FIX: Quantize hook position for ALL active states (not just FLYING)
        // ATTACHED anchor position may have floating-point drift
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
}
