// ============================================
// CHARACTER CORE - Matter.js Physics Controller
// ============================================
// Teeworlds-style movement with Matter.js rope physics

import { PHYS } from '../config.js';

export class CharacterCore {
    constructor() {
        // References (set by GameScene)
        this.scene = null;
        this.body = null;  // Matter.js body

        // State
        this.grounded = false;
        this.groundContacts = 0;  // Counter for ground contacts (fixes flickering on slopes)
        this.facingRight = true;

        // Jump mechanics
        this.jumpBuffer = 0;
        this.coyoteTime = 0;
        this.jumpHeld = false;
        this.canJump = true;
        this.airJumpUsed = false;  // For double jump powerup

        // Hook state
        this.hookState = 'IDLE';  // IDLE, FLYING, ATTACHED
        this.hookPos = { x: 0, y: 0 };
        this.hookVel = { x: 0, y: 0 };
        this.hookAnchor = null;       // Matter.js static body for anchor
        this.ropeConstraint = null;   // Matter.js distance constraint
        this.ropeLength = 0;
        this.hookCooldown = 0;

        // Collision sensors
        this.groundSensor = null;
    }

    /**
     * Initialize with scene and Matter body
     */
    init(scene, matterBody) {
        this.scene = scene;
        this.body = matterBody;
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

        // Check if grounded
        this.updateGrounded();

        // Update coyote time
        if (this.grounded) {
            this.coyoteTime = PHYS.COYOTE_TIME;
            this.canJump = true;
            this.airJumpUsed = false;  // Reset double jump when landing
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
     * Check if character is on ground
     * Note: Grounded state is managed by collision events in GameScene
     */
    updateGrounded() {
        // Grounded state set by collision detection in GameScene.handleCollisionStart()
        // No backup check needed - let Matter.js collision system handle it
    }

    /**
     * Process jump input
     */
    processJump(input) {
        // Check for double jump powerup
        const hasDoubleJump = this.scene.canDoubleJump &&
                              this.scene.canDoubleJump(this.body.gameObject);

        // Can do air jump if: has powerup, in air, hasn't used air jump yet, and pressed jump
        const canAirJump = hasDoubleJump &&
                           !this.grounded &&
                           !this.airJumpUsed &&
                           this.jumpBuffer > 0;

        const canJumpNow = (this.grounded || this.coyoteTime > 0) &&
                           this.jumpBuffer > 0 &&
                           this.canJump;

        if (canJumpNow || canAirJump) {
            // Apply jump velocity directly
            this.scene.matter.body.setVelocity(this.body, {
                x: this.body.velocity.x,
                y: PHYS.JUMP_FORCE
            });

            this.jumpBuffer = 0;
            this.coyoteTime = 0;
            this.canJump = false;
            this.grounded = false;

            // Mark air jump as used if this was an air jump
            if (canAirJump) {
                this.airJumpUsed = true;
            }

            // Sound effect with spatial audio
            if (this.scene.playSpatialSound) {
                this.scene.playSpatialSound('sfx-jump', this.body.position.x, this.body.position.y, 0.3);
            }

            return true;
        }
        return false;
    }

    /**
     * Process horizontal movement
     */
    processMovement(input, delta, onRope) {
        const body = this.body;
        const velocity = body.velocity;

        // Get speed multiplier from powerup (if available)
        const speedMult = this.scene.getSpeedMultiplier ?
            this.scene.getSpeedMultiplier(body.gameObject) : 1;

        // Use different force based on state: ground, air, or rope
        let force;
        if (onRope) {
            force = PHYS.AIR_CONTROL * 1.5 * speedMult;  // На веревке (раскачивание)
        } else if (this.grounded) {
            force = PHYS.MOVE_FORCE * speedMult;          // На земле (полная сила)
        } else {
            force = PHYS.AIR_CONTROL * speedMult;         // В воздухе (уменьшенная)
        }

        if (input.direction !== 0) {
            // Apply force for movement
            this.scene.matter.body.applyForce(body, body.position, {
                x: input.direction * force,
                y: 0
            });

            this.facingRight = input.direction > 0;
        }
        // Natural friction handles deceleration (small sliding is intentional)
    }

    /**
     * Limit velocity to prevent infinite acceleration
     */
    limitVelocity() {
        const vx = this.body.velocity.x;
        const vy = this.body.velocity.y;

        // Get speed multiplier from powerup (if available)
        const speedMult = this.scene.getSpeedMultiplier ?
            this.scene.getSpeedMultiplier(this.body.gameObject) : 1;

        const maxSpeedX = PHYS.MAX_SPEED_X * speedMult;

        let clampedVx = vx;
        let clampedVy = vy;

        // Clamp horizontal speed (with powerup multiplier)
        if (Math.abs(vx) > maxSpeedX) {
            clampedVx = Math.sign(vx) * maxSpeedX;
        }

        // Clamp fall speed
        if (vy > PHYS.MAX_SPEED_Y) {
            clampedVy = PHYS.MAX_SPEED_Y;
        }

        if (clampedVx !== vx || clampedVy !== vy) {
            this.scene.matter.body.setVelocity(this.body, {
                x: clampedVx,
                y: clampedVy
            });
        }
    }

    // === HOOK / GRAPPLE (Matter.js constraints) ===

    /**
     * Launch hook toward target
     */
    launchHook(targetX, targetY) {
        if (this.hookState !== 'IDLE' || this.hookCooldown > 0) return false;
        if (!this.scene) return false;

        const dx = targetX - this.body.position.x;
        const dy = targetY - this.body.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 10) return false;
        if (dist > PHYS.HOOK_RANGE) return false;

        // Normalize direction
        const nx = dx / dist;
        const ny = dy / dist;

        // Start hook flying
        this.hookPos.x = this.body.position.x;
        this.hookPos.y = this.body.position.y;
        this.hookVel.x = nx * PHYS.HOOK_SPEED;
        this.hookVel.y = ny * PHYS.HOOK_SPEED;
        this.hookState = 'FLYING';
        this.hookCooldown = PHYS.HOOK_COOLDOWN;

        // Sound effect with spatial audio
        if (this.scene.playSpatialSound) {
            this.scene.playSpatialSound('sfx-hook-fired', this.body.position.x, this.body.position.y, 0.2);
        }

        return true;
    }

    /**
     * Process hook logic each frame
     */
    processHook(input, delta) {
        // Toggle: press to launch or release
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

        // Move hook
        this.hookPos.x += this.hookVel.x * frames;
        this.hookPos.y += this.hookVel.y * frames;

        // Apply gravity to hook
        this.hookVel.y += 0.3 * frames;

        // Check collision with tilemap
        if (this.scene.platformLayer) {
            const tile = this.scene.platformLayer.getTileAtWorldXY(this.hookPos.x, this.hookPos.y);
            if (tile && tile.index > 0) {
                // Hit a tile - attach!
                this.attachHook(tile.getCenterX(), tile.getCenterY());
                return true;
            }
        }

        // Check range
        const dist = Math.hypot(
            this.hookPos.x - this.body.position.x,
            this.hookPos.y - this.body.position.y
        );

        if (dist > PHYS.HOOK_RANGE) {
            this.releaseHook();
        }

        return false;
    }

    /**
     * Attach hook and create constraint
     */
    attachHook(anchorX, anchorY) {
        if (!this.scene) return;

        // Create static anchor body
        this.hookAnchor = this.scene.matter.add.circle(anchorX, anchorY, 5, {
            isStatic: true,
            isSensor: true,
            label: 'hookAnchor'
        });

        // Calculate initial rope length
        this.ropeLength = Math.hypot(
            anchorX - this.body.position.x,
            anchorY - this.body.position.y
        );

        // Create distance constraint (the rope!)
        this.ropeConstraint = this.scene.matter.add.constraint(
            this.body,
            this.hookAnchor,
            this.ropeLength,
            PHYS.HOOK_STIFFNESS,
            {
                damping: PHYS.HOOK_DAMPING,
                label: 'ropeConstraint'
            }
        );

        this.hookState = 'ATTACHED';

        // Sound effect with spatial audio
        if (this.scene.playSpatialSound) {
            this.scene.playSpatialSound('sfx-hook-attached', anchorX, anchorY, 0.3);
        }

        // Store anchor position for drawing
        this.hookPos.x = anchorX;
        this.hookPos.y = anchorY;
    }

    /**
     * Update while attached to rope
     */
    updateAttachedHook(input, delta) {
        if (!this.ropeConstraint) {
            this.releaseHook();
            return false;
        }

        // Jump pressed → release with velocity boost
        if (this.jumpBuffer > 0) {
            const currentVel = this.body.velocity;
            this.scene.matter.body.setVelocity(this.body, {
                x: currentVel.x * 1.1,
                y: Math.min(currentVel.y, PHYS.JUMP_FORCE * 0.7)
            });

            this.jumpBuffer = 0;
            this.coyoteTime = 0;
            this.canJump = false;
            this.releaseHook();
            this.hookCooldown = PHYS.HOOK_COOLDOWN * 0.5;
            return false;
        }

        // Auto-reel: always shorten rope when attached (Teeworlds-style)
        if (this.ropeLength > PHYS.HOOK_MIN_LENGTH) {
            this.ropeLength -= PHYS.HOOK_REEL_SPEED;
            this.ropeConstraint.length = this.ropeLength;
        }

        // Supplemental pull toward anchor
        const anchorPos = this.hookAnchor.position;
        const dx = anchorPos.x - this.body.position.x;
        const dy = anchorPos.y - this.body.position.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 0) {
            this.scene.matter.body.applyForce(this.body, this.body.position, {
                x: (dx / dist) * 0.008,
                y: (dy / dist) * 0.008
            });
        }

        return true;  // On rope
    }

    /**
     * Release hook and destroy constraint
     */
    releaseHook() {
        if (this.ropeConstraint && this.scene) {
            this.scene.matter.world.removeConstraint(this.ropeConstraint);
            this.ropeConstraint = null;
        }

        if (this.hookAnchor && this.scene) {
            this.scene.matter.world.remove(this.hookAnchor);
            this.hookAnchor = null;
        }

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
        if (!this.body || !this.scene) return;

        const dx = this.body.position.x - fromX;
        const dy = this.body.position.y - fromY;
        const dist = Math.hypot(dx, dy);

        if (dist > 0) {
            this.scene.matter.body.applyForce(this.body, this.body.position, {
                x: (dx / dist) * force,
                y: (dy / dist) * force * 0.5
            });
        }
    }

    /**
     * Add ground contact (called on collision start)
     */
    addGroundContact() {
        this.groundContacts++;
        this.grounded = true;
    }

    /**
     * Remove ground contact (called on collision end)
     */
    removeGroundContact() {
        this.groundContacts = Math.max(0, this.groundContacts - 1);
        if (this.groundContacts === 0) {
            this.grounded = false;
        }
    }

    /**
     * Get current hook attachment point for drawing
     */
    getHookAttachPoint() {
        if (this.hookState === 'ATTACHED' && this.hookAnchor) {
            return {
                x: this.hookAnchor.position.x,
                y: this.hookAnchor.position.y
            };
        }
        return null;
    }
}
