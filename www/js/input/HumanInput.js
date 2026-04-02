// ============================================
// HUMAN INPUT - Keyboard + Touch Controls
// v8: Left stick (move) + 3 buttons (jump, fire, hook)
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
        this.touchFireJustPressed = false;

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

        // Handle app minimize/restore
        this._onVisibilityChange = () => {
            if (!this.isMobile) return;
            this.joystickDir = 0;
            this.touchJump = false;
            this.touchHook = false;
            this.fireJustPressed = false;
            this.hookJustPressed = false;
            this.wasHookDown = false;
            this.touchFireJustPressed = false;

            if (!document.hidden) {
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
        this.createButtons();
        console.log('[TouchControls] v8: left stick + 3 buttons (jump, fire, hook)');
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
    // RECREATE JOYSTICKS (after visibility change)
    // ==========================================

    recreateJoysticks() {
        if (this.nippleManager) {
            this.nippleManager.destroy();
            this.nippleManager = null;
        }
        this.createJoystick();
    }

    // ==========================================
    // BUTTONS (DOM-based) — jump, fire, hook
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

        bind(document.getElementById('btn-jump'),
            () => { this.touchJump = true; },
            () => { this.touchJump = false; }
        );

        bind(document.getElementById('btn-fire'),
            () => { this.touchFireJustPressed = true; },
            () => {}
        );

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
            || this.touchJump;

        let fire = false;
        let fireAngle = null;

        // Desktop: click to fire toward cursor
        if (this.fireJustPressed) {
            fire = true;
            fireAngle = this.fireAngle;
            this.fireJustPressed = false;
            this.fireAngle = null;
        }

        // Mobile: fire with auto-aim (angle resolved in GameScene)
        if (this.touchFireJustPressed) {
            fire = true;
            fireAngle = null; // null = auto-aim at nearest visible enemy
            this.touchFireJustPressed = false;
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

        if (this._onVisibilityChange) {
            document.removeEventListener('visibilitychange', this._onVisibilityChange);
            this._onVisibilityChange = null;
        }

        if (this._joystickTimer) {
            clearTimeout(this._joystickTimer);
            this._joystickTimer = null;
        }

        if (this.nippleManager) {
            this.nippleManager.destroy();
            this.nippleManager = null;
        }
        const zone = document.getElementById('joystick-zone');
        if (zone) zone.innerHTML = '';

        this.removeButtonListeners();
    }
}
