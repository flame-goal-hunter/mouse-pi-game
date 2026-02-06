// ============================================
// HUMAN INPUT - Keyboard + Touch Controls
// v7: Left stick (move) + Right stick (jump+fire) + Hook button
// ============================================

export class HumanInput {
    constructor(scene) {
        this.scene = scene;

        // Keyboard
        this.cursors = scene.input.keyboard.createCursorKeys();
        this.keys = scene.input.keyboard.addKeys('W,A,S,D,SPACE,E,SHIFT');

        // Track hook press state
        this.wasHookDown = false;
        this.hookJustPressed = false;

        // Mouse for desktop
        this.pointer = scene.input.activePointer;
        this.fireJustPressed = false;

        // Touch state
        this.touchJump = false;
        this.touchHook = false;
        this.touchHookJustPressed = false;

        // Right joystick state (tap=jump, drag=fire)
        this._tapJumpPending = false;
        this._fireJoystickActive = false;
        this._fireJoystickAngle = 0;

        // Joystick direction (from left nipplejs)
        this.joystickDir = 0;

        // Button listener references (for cleanup)
        this._buttonListeners = [];
        this._destroyed = false;

        // Mobile detection
        this.isMobile = this.detectMobile();
        console.log('[HumanInput] isMobile =', this.isMobile);

        if (this.isMobile) {
            this.setupTouchControls();
        } else {
            // Hide mobile controls on desktop
            const zone = document.getElementById('joystick-zone');
            if (zone) zone.style.display = 'none';
        }

        // Desktop mouse — fire angle from player to cursor
        this.fireAngle = null;
        scene.input.on('pointerdown', (pointer) => {
            if (!this.isMobile && pointer.leftButtonDown()) {
                const player = this.scene.player;
                if (player && player.active) {
                    this.fireAngle = Math.atan2(
                        pointer.worldY - player.y,
                        pointer.worldX - player.x
                    );
                }
                this.fireJustPressed = true;
            }
        });

        // Handle app minimize/restore (Android background, tab switch)
        this._onVisibilityChange = () => {
            if (!this.isMobile) return;
            // Always reset touch state on visibility change (prevents stuck inputs)
            this.joystickDir = 0;
            this.touchJump = false;
            this.touchHook = false;
            this.fireJustPressed = false;
            this.hookJustPressed = false;
            this.wasHookDown = false;
            this._tapJumpPending = false;
            this._fireJoystickActive = false;

            if (!document.hidden) {
                // Recreate nipplejs — it loses touch state when DOM is hidden
                this.recreateJoysticks();
            }
        };
        document.addEventListener('visibilitychange', this._onVisibilityChange);
    }

    detectMobile() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
               (window.innerWidth <= 1024 && 'ontouchstart' in window);
    }

    // ==========================================
    // SETUP
    // ==========================================

    setupTouchControls() {
        this.createJoystick();
        this.createRightJoystick();
        this.createButtons();
        console.log('[TouchControls] v7: left stick + right stick + hook button');
    }

    // ==========================================
    // LEFT JOYSTICK (nipplejs) — movement
    // ==========================================

    createJoystick() {
        if (typeof nipplejs === 'undefined') {
            console.error('[HumanInput] nipplejs not loaded!');
            return;
        }

        const zone = document.getElementById('joystick-zone');
        if (!zone) {
            console.error('[HumanInput] #joystick-zone element not found!');
            return;
        }

        zone.innerHTML = '';

        this._joystickRetries = 0;
        this._joystickTimer = setTimeout(() => this._tryCreateJoystick(), 50);
    }

    _tryCreateJoystick() {
        this._joystickTimer = null;
        if (this._destroyed) return;

        const zone = document.getElementById('joystick-zone');
        if (!zone) return;

        if (zone.offsetWidth === 0 || zone.offsetHeight === 0) {
            this._joystickRetries++;
            if (this._joystickRetries < 10) {
                this._joystickTimer = setTimeout(() => this._tryCreateJoystick(), 100);
            }
            return;
        }

        this._initNipple(zone);
    }

    _initNipple(zone) {
        if (this._destroyed || this.nippleManager) return;

        this.nippleManager = nipplejs.create({
            zone: zone,
            mode: 'static',
            position: { left: '22%', bottom: '38%' },
            size: 120,
            color: '#5dade2',
            fadeTime: 0
        });

        this.nippleManager.on('move', (evt, data) => {
            if (data.force > 0.3) {
                const cosAngle = Math.cos(data.angle.radian);
                if (Math.abs(cosAngle) > 0.3) {
                    this.joystickDir = cosAngle > 0 ? 1 : -1;
                } else {
                    this.joystickDir = 0;
                }
            } else {
                this.joystickDir = 0;
            }
        });

        this.nippleManager.on('end', () => {
            this.joystickDir = 0;
        });

        console.log('[HumanInput] left joystick created (movement)');
    }

    // ==========================================
    // RIGHT JOYSTICK (nipplejs) — jump + fire
    // ==========================================

    createRightJoystick() {
        if (typeof nipplejs === 'undefined') return;

        const zone = document.getElementById('right-joystick-zone');
        if (!zone) {
            console.error('[HumanInput] #right-joystick-zone not found!');
            return;
        }

        zone.innerHTML = '';

        this._rightJoystickRetries = 0;
        this._rightJoystickTimer = setTimeout(() => this._tryCreateRightJoystick(), 50);
    }

    _tryCreateRightJoystick() {
        this._rightJoystickTimer = null;
        if (this._destroyed) return;

        const zone = document.getElementById('right-joystick-zone');
        if (!zone) return;

        if (zone.offsetWidth === 0 || zone.offsetHeight === 0) {
            this._rightJoystickRetries++;
            if (this._rightJoystickRetries < 10) {
                this._rightJoystickTimer = setTimeout(() => this._tryCreateRightJoystick(), 100);
            }
            return;
        }

        this._initRightNipple(zone);
    }

    _initRightNipple(zone) {
        if (this._destroyed || this.rightNipple) return;

        this._rightStart = 0;
        this._rightMaxForce = 0;

        this.rightNipple = nipplejs.create({
            zone: zone,
            mode: 'static',
            position: { right: '22%', bottom: '38%' },
            size: 120,
            color: '#42a5f5',
            fadeTime: 0
        });

        this.rightNipple.on('start', () => {
            this._rightStart = Date.now();
            this._rightMaxForce = 0;
        });

        this.rightNipple.on('move', (evt, data) => {
            this._rightMaxForce = Math.max(this._rightMaxForce, data.force);
            if (data.force > 0.5) {
                // Drag = continuous fire in drag direction
                this._fireJoystickActive = true;
                // nipplejs: 0=right, PI/2=up (math) → game: 0=right, -PI/2=up (screen)
                this._fireJoystickAngle = -data.angle.radian;
            } else {
                this._fireJoystickActive = false;
            }
        });

        this.rightNipple.on('end', () => {
            const duration = Date.now() - this._rightStart;
            // Tap (no significant drag) = jump
            if (this._rightMaxForce < 0.5 && duration < 350) {
                this._tapJumpPending = true;
            }
            this._fireJoystickActive = false;
        });

        console.log('[HumanInput] right joystick created (jump + fire)');
    }

    // ==========================================
    // RECREATE JOYSTICKS (after visibility change)
    // ==========================================

    recreateJoysticks() {
        if (this.nippleManager) {
            this.nippleManager.destroy();
            this.nippleManager = null;
        }
        this.createJoystick();

        if (this.rightNipple) {
            this.rightNipple.destroy();
            this.rightNipple = null;
        }
        this.createRightJoystick();
    }

    // ==========================================
    // BUTTONS (DOM-based)
    // ==========================================

    createButtons() {
        this._buttonListeners = [];

        const bind = (el, onDown, onUp) => {
            if (!el) return;
            const down = (e) => { e.preventDefault(); onDown(); };
            const up = (e) => { e.preventDefault(); onUp(); };
            const cancel = (e) => { e.preventDefault(); onUp(); };
            el.addEventListener('touchstart', down, { passive: false });
            el.addEventListener('touchend', up);
            el.addEventListener('touchcancel', cancel);
            this._buttonListeners.push({ el, down, up, cancel });
        };

        // Hook button
        bind(document.getElementById('btn-hook'),
            () => { this.touchHook = true; this.touchHookJustPressed = true; },
            () => this.touchHook = false
        );
    }

    removeButtonListeners() {
        if (!this._buttonListeners) return;
        this._buttonListeners.forEach(({ el, down, up, cancel }) => {
            el.removeEventListener('touchstart', down);
            el.removeEventListener('touchend', up);
            el.removeEventListener('touchcancel', cancel);
        });
        this._buttonListeners = [];
    }

    // ==========================================
    // INPUT
    // ==========================================

    getInput() {
        const hookDown = this.keys.E.isDown || this.touchHook;
        this.hookJustPressed = hookDown && !this.wasHookDown;
        this.wasHookDown = hookDown;

        let direction = 0;
        if (this.keys.A.isDown || this.cursors.left.isDown) direction -= 1;
        if (this.keys.D.isDown || this.cursors.right.isDown) direction += 1;

        if (this.isMobile && this.joystickDir !== 0) {
            direction = this.joystickDir;
        }

        const jump = this.keys.SPACE.isDown || this.keys.W.isDown || this.cursors.up.isDown
            || this.touchJump || this._tapJumpPending;
        this._tapJumpPending = false;

        let fire = false;
        let fireAngle = null;

        // Desktop: click to fire
        if (this.fireJustPressed) {
            fire = true;
            fireAngle = this.fireAngle;
            this.fireJustPressed = false;
            this.fireAngle = null;
        }

        // Mobile: continuous fire while dragging right joystick
        if (this._fireJoystickActive) {
            fire = true;
            fireAngle = this._fireJoystickAngle;
        }

        const hookJust = this.hookJustPressed || this.touchHookJustPressed;
        this.touchHookJustPressed = false;

        return {
            direction,
            jump,
            hook: hookDown,
            hookJustPressed: hookJust,
            hookTarget: null,
            fire,
            fireAngle,
            strength: this.keys.SHIFT.isDown ? 0.5 : 1
        };
    }

    // ==========================================
    // CLEANUP
    // ==========================================

    destroy() {
        this._destroyed = true;

        // Remove visibility handler
        if (this._onVisibilityChange) {
            document.removeEventListener('visibilitychange', this._onVisibilityChange);
            this._onVisibilityChange = null;
        }

        // Cancel pending joystick creation timers
        if (this._joystickTimer) {
            clearTimeout(this._joystickTimer);
            this._joystickTimer = null;
        }
        if (this._rightJoystickTimer) {
            clearTimeout(this._rightJoystickTimer);
            this._rightJoystickTimer = null;
        }

        // Destroy left nipplejs
        if (this.nippleManager) {
            this.nippleManager.destroy();
            this.nippleManager = null;
        }
        const zone = document.getElementById('joystick-zone');
        if (zone) zone.innerHTML = '';

        // Destroy right nipplejs
        if (this.rightNipple) {
            this.rightNipple.destroy();
            this.rightNipple = null;
        }
        const rightZone = document.getElementById('right-joystick-zone');
        if (rightZone) rightZone.innerHTML = '';

        // Remove button touch listeners
        this.removeButtonListeners();
    }
}
