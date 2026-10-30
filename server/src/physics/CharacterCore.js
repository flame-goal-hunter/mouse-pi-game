// ============================================
// CHARACTER CORE - Simple Physics Controller (v28)
// ============================================
// Teeworlds-style movement with deterministic SimplePhysicsWorld.
// Hook uses manual distance constraint.

import { PHYS } from './config.js';

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
        this.hookCooldown = 0;
        this._prevHookInput = false;  // Teeworlds-style edge detection (replaces hookJustPressed)
        this._hookHoldMs = 0;         // Tracks how long hook key/button is held for Teeworlds hold-to-hook

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
     * @param {Object} input - { direction, jump, hook, hookTarget, fire }
     * @param {number} delta - Frame time in ms
     */
    tick(input, delta) {
        if (!this.body || !this.scene) return { grounded: false, onRope: false };

        // Update timers
        this.lastJumpType = null;
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

        // Buffer jump input (supports both continuous edge detection AND explicit jumpJustPressed pulse)
        if ((input.jump && !this.jumpHeld) || input.jumpJustPressed) {
            this.jumpBuffer = PHYS.JUMP_BUFFER;
        }
        // Keep jumpBuffer alive while hook is in flight so pressing jump slightly before hook attaches still jumps!
        if (this.hookState === 'FLYING' && this.jumpBuffer > 0 && input.jump) {
            this.jumpBuffer = Math.max(this.jumpBuffer, 60);
        }
        this._prevJumpHeld = this.jumpHeld;
        this.jumpHeld = input.jump;

        // Process hook (Teeworlds elastic drag model)
        const onRope = this.processHook(input, delta);

        // Process jump (always works on rope even if airJump was used prior to hooking!)
        this.processJump(input, onRope);

        // Process movement (Teeworlds runs normal air/ground movement alongside hook drag!)
        this.processMovement(input, delta, this.hookState === 'ATTACHED');

        // Limit velocity (preserving air/rope swing momentum)
        this.limitVelocity(this.hookState === 'ATTACHED');

        return { grounded: this.grounded, onRope: this.hookState === 'ATTACHED' };
    }

    /**
     * Process jump input (with variable jump height, rope launch jump & Teeworlds double-jump)
     */
    processJump(input, onRope = false) {
        // Variable jump cut: releasing jump early while rising fast gives a controlled hop
        if (!input.jump && this._prevJumpHeld && !this.grounded && !onRope && this.body.vy < -280) {
            this.body.vy *= 0.72;
        }

        // Rope jump: pressing jump while attached to a rope ALWAYS works (even if airJump was used before hooking!)
        const canRopeJump = onRope && this.jumpBuffer > 0;

        // First jump: from ground or within coyote time
        const canJumpNow = !canRopeJump &&
                           (this.grounded || this.coyoteTime > 0) &&
                           this.jumpBuffer > 0 &&
                           this.canJump;

        // Double jump in air (Teeworlds-style) — only when NOT doing a rope jump or ground/coyote jump!
        const canAirJump = !canRopeJump &&
                           !canJumpNow &&
                           !this.grounded &&
                           !onRope &&
                           !this.airJumpUsed &&
                           this.jumpBuffer > 0;

        if (canRopeJump || canJumpNow || canAirJump) {
            this.body.vy = PHYS.JUMP_FORCE;
            if (canRopeJump) {
                this.body.vx *= 1.06;
            }

            this.jumpBuffer = 0;
            this.coyoteTime = 0;
            this.canJump = false;
            this.grounded = false;
            this.body.grounded = false;
            this.body.wasGrounded = false;
            this.body.onSlope = false;

            if (canRopeJump) {
                // Always detach rope cleanly on rope-jump and refresh airJump for post-swing control!
                this.releaseHook();
                this._hookHoldMs = 0;
                this.hookCooldown = Math.max(this.hookCooldown, PHYS.HOOK_COOLDOWN * 0.5);
                this.airJumpUsed = false;
                this.lastJumpType = 'rope';
            } else if (canJumpNow) {
                this.airJumpUsed = false;
                this.lastJumpType = 'ground';
            } else if (canAirJump) {
                this.airJumpUsed = true;
                this.lastJumpType = 'air';
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
     * Process horizontal movement (Teeworlds momentum-preserving platformer physics)
     * Runs simultaneously with hook drag when onRope === true, just like Teeworlds gamecore.cpp!
     */
    processMovement(input, delta, onRope) {
        // Get speed multiplier from powerup
        const speedMult = this.scene.getSpeedMultiplier ?
            this.scene.getSpeedMultiplier(this.sprite) : 1;

        const maxSpeed = PHYS.MAX_SPEED_X * speedMult;

        if (input.direction !== 0) {
            this.facingRight = input.direction > 0;
            const targetVx = input.direction * maxSpeed;

            if (this.grounded && !onRope) {
                // Grounded: snappy acceleration toward targetVx
                this.body.vx = this.body.vx + (targetVx - this.body.vx) * PHYS.GROUND_ACCEL;
            } else {
                // Airborne or on rope: Teeworlds momentum rule!
                // If already flying faster than targetVx in the SAME direction (from hook pull or slope),
                // DO NOT brake down to targetVx — preserve high swing momentum!
                const sameDir = Math.sign(this.body.vx) === Math.sign(input.direction);
                if (sameDir && Math.abs(this.body.vx) > Math.abs(targetVx)) {
                    this.body.vx *= 0.994;
                } else {
                    const airAccel = sameDir ? PHYS.AIR_ACCEL : PHYS.AIR_ACCEL * 1.15;
                    this.body.vx = this.body.vx + (targetVx - this.body.vx) * airAccel;
                }
            }
        } else if (this.grounded && !onRope) {
            if (this.body.onSlope) {
                // Standing idle on an icy winter slope → allow a gentle downhill slide (~95 px/s max)
                this.body.vx *= 0.93;
                if (Math.abs(this.body.vx) > 105) {
                    this.body.vx = Math.sign(this.body.vx) * 105;
                }
            } else {
                // Flat snow ground → crisp stop
                const newVx = this.body.vx * PHYS.GROUND_FRICTION;
                this.body.vx = Math.abs(newVx) < 2 ? 0 : newVx;
            }
        } else {
            // Airborne / onRope with no input → preserve swing momentum with subtle Teeworlds air decay
            this.body.vx *= 0.994;
        }
    }

    /**
     * Limit velocity while preserving grapple swing & slope launch momentum in the air
     */
    limitVelocity(onRope = false) {
        const speedMult = this.scene.getSpeedMultiplier ?
            this.scene.getSpeedMultiplier(this.sprite) : 1;

        const maxSpeedX = PHYS.MAX_SPEED_X * speedMult;
        const maxAirSpeedX = Math.max(maxSpeedX * 1.65, PHYS.HOOK_DRAG_SPEED * 1.15) * speedMult;

        if (this.grounded && !onRope) {
            if (Math.abs(this.body.vx) > maxSpeedX) {
                // Smoothly slide-decay excess landing speed over a few frames instead of instant clamp
                this.body.vx = this.body.vx * 0.84 + Math.sign(this.body.vx) * maxSpeedX * 0.16;
            }
        } else {
            if (Math.abs(this.body.vx) > maxAirSpeedX) {
                this.body.vx = Math.sign(this.body.vx) * maxAirSpeedX;
            }
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
     * Process hook logic each frame.
     * Supports BOTH Teeworlds Hold-to-Hook (hold E or Right-Click -> release to let go)
     * AND Quick-Tap Toggle (<160ms tap -> stays attached until next press/jump).
     */
    processHook(input, delta) {
        if (input.hookRelease) {
            this._hookHoldMs = 0;
            this._prevHookInput = false;
            if (this.hookState !== 'IDLE') {
                this.releaseHook();
            }
            return false;
        }

        const hookDown = !!input.hook;
        const hookPressedEdge = hookDown && !this._prevHookInput;
        const hookReleasedEdge = !hookDown && this._prevHookInput;
        this._prevHookInput = hookDown;

        if (hookDown) {
            this._hookHoldMs = (this._hookHoldMs || 0) + (delta || 16.67);
        }

        if (hookPressedEdge) {
            this._hookHoldMs = 0;
            if (this.hookState === 'IDLE') {
                if (input.hookTarget) {
                    const launched = this.launchHook(input.hookTarget.x, input.hookTarget.y);
                    if (!launched) {
                        this._prevHookInput = false;
                    }
                } else {
                    this._prevHookInput = false;
                }
            } else if (this.hookState === 'ATTACHED' || this.hookState === 'FLYING') {
                this.releaseHook();
                return false;
            }
        } else if (hookReleasedEdge) {
            const holdMs = this._hookHoldMs || 0;
            this._hookHoldMs = 0;
            if ((this.hookState === 'ATTACHED' && holdMs >= 115) ||
                (this.hookState === 'FLYING' && holdMs >= 180)) {
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
     * Update hook while flying through air (Teeworlds straight-line tip raycast)
     */
    updateFlyingHook(delta) {
        const frames = delta / 16.67;
        const prevX = this.hookPos.x;
        const prevY = this.hookPos.y;

        this.hookPos.x += this.hookVel.x * frames;
        this.hookPos.y += this.hookVel.y * frames;

        // Check collision along the flying hook tip segment using exact sub-tile raycast
        if (this.physicsWorld) {
            const result = this.physicsWorld.raycast(
                prevX, prevY,
                this.hookPos.x, this.hookPos.y
            );
            if (result && result.hit) {
                this.attachHook(result.x, result.y);
                return true;
            }
        } else if (this.scene.platformLayer) {
            // Fallback ONLY when physicsWorld is not present
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
     * Attach hook — store anchor position and refresh air-jump
     */
    attachHook(anchorX, anchorY) {
        if (!this.scene) return;

        this.hookAnchorPos = { x: anchorX, y: anchorY };
        this.hookState = 'ATTACHED';
        this.hookPos.x = anchorX;
        this.hookPos.y = anchorY;
        this.airJumpUsed = false;

        if (!this.suppressSounds && this._canPlaySound('hookAttached') && this.scene.playSpatialSound) {
            this.scene.playSpatialSound('sfx-hook-attached', anchorX, anchorY, 0.3);
        }
    }

    /**
     * Update while attached — Authentic Teeworlds (src/game/gamecore.cpp) Elastic Hook Drag Model!
     * - Pulls player toward hookAnchorPos when dist > HOOK_DRAG_MIN_DIST (46px)
     * - Upward pull is 100%, downward pull (when player swings above anchor) is 30% so vaulting over ledges is effortless
     * - Horizontal pull gets a 0.95 boost when steering in the pull direction (0.75 otherwise)
     * - Applies acceleration only when newSpeed < HOOK_DRAG_SPEED or newSpeed < oldSpeed (elastic arc redirection!)
     */
    updateAttachedHook(input, delta) {
        if (!this.hookAnchorPos) {
            this.releaseHook();
            return false;
        }

        // Vector from player body TOWARD hook anchor (Teeworlds m_HookPos - m_Pos)
        const dx = this.hookAnchorPos.x - this.body.x;
        const dy = this.hookAnchorPos.y - this.body.y;
        const dist = Math.hypot(dx, dy);
        const dt = Math.min(0.05, delta / 1000);
        const minDist = PHYS.HOOK_DRAG_MIN_DIST || 46;

        if (dist > minDist) {
            const dirX = dx / dist;
            const dirY = dy / dist;

            // Smooth arrival ramp within 46..82px so hanging directly below an anchor settles without jitter
            const ramp = Math.min(1, (dist - minDist) / 36);
            const dragAccel = (PHYS.HOOK_DRAG_ACCEL || 6800) * dt * ramp;

            let hookVx = dirX * dragAccel;
            let hookVy = dirY * dragAccel;

            // Teeworlds gamecore.cpp rule 1:
            // "the hook as more power to drag you up then down. this makes it easier to get on top of an object"
            if (hookVy > 0) {
                hookVy *= 0.3;
            }

            // Teeworlds gamecore.cpp rule 2:
            // "the hook has more power if the player goes in the direction of the hook"
            if ((hookVx < 0 && input.direction < 0) || (hookVx > 0 && input.direction > 0)) {
                hookVx *= 0.95;
            } else {
                hookVx *= 0.75;
            }

            const newVx = this.body.vx + hookVx;
            const newVy = this.body.vy + hookVy;
            const newSpeed = Math.hypot(newVx, newVy);
            const oldSpeed = Math.hypot(this.body.vx, this.body.vy);
            const maxDragSpeed = PHYS.HOOK_DRAG_SPEED || 680;

            // Teeworlds gamecore.cpp rule 3:
            // Only apply if total speed is under HookDragSpeed, OR if the hook force reduces total speed
            // (which redirects outward/downward velocity into a smooth Teeworlds swing arc!)
            if (newSpeed < maxDragSpeed || newSpeed < oldSpeed) {
                this.body.vx = newVx;
                this.body.vy = newVy;
            }
        }

        // Gentle radial damping only when very close to the anchor (<88px) and idle so hanging doesn't yo-yo
        if (dist < 88 && input.direction === 0) {
            this.body.vx *= 0.95;
            if (this.body.vy > 0 && dy < 0) {
                this.body.vy *= 0.85;
            }
        }

        return true;
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
            this.hookAnchorPos.x = CharacterCore.roundToInt(this.hookAnchorPos.x);
            this.hookAnchorPos.y = CharacterCore.roundToInt(this.hookAnchorPos.y);
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
            hookCooldown: this.hookCooldown,
            _prevHookInput: this._prevHookInput,
            _hookHoldMs: this._hookHoldMs || 0
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
        this.hookCooldown = state.hookCooldown;
        if (state._prevHookInput !== undefined) this._prevHookInput = state._prevHookInput;
        if (state._hookHoldMs !== undefined) this._hookHoldMs = state._hookHoldMs;
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
