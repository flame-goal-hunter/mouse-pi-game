// ============================================
// HUMAN INPUT - Keyboard + Touch Controls
// All touch controls are DOM-based (no Phaser UI objects)
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
        this.touchFireAngle = null;
        this.touchFireJustPressed = false;
        this.touchHookJustPressed = false;

        // Joystick direction (from nipplejs)
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
            this.touchFireAngle = null;
            this.touchFireJustPressed = false;
            this.fireJustPressed = false;
            this.hookJustPressed = false;
            this.wasHookDown = false;

            if (!document.hidden) {
                // Recreate nipplejs — it loses touch state when DOM is hidden
                this.recreateJoystick();
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
        console.log('[TouchControls] Created (DOM-based)');
    }

    // ==========================================
    // JOYSTICK (nipplejs)
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

        // Clean up any leftover nipplejs DOM elements from previous instances
        zone.innerHTML = '';

        // Poll until zone has layout dimensions (up to 10 attempts, 100ms apart)
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
                console.warn(`[HumanInput] joystick zone not visible yet, retry ${this._joystickRetries}/10...`);
                this._joystickTimer = setTimeout(() => this._tryCreateJoystick(), 100);
            } else {
                console.error('[HumanInput] joystick zone never became visible after 10 retries');
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

        console.log('[HumanInput] nipplejs joystick created');
    }

    recreateJoystick() {
        if (this.nippleManager) {
            this.nippleManager.destroy();
            this.nippleManager = null;
        }
        this.createJoystick();
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

        bind(document.getElementById('btn-jump'),
            () => this.touchJump = true,
            () => this.touchJump = false
        );

        bind(document.getElementById('btn-hook'),
            () => { this.touchHook = true; this.touchHookJustPressed = true; },
            () => this.touchHook = false
        );

        // Fire button — circular aim pad (tap position → angle from center)
        const fireBtn = document.getElementById('btn-fire');
        if (fireBtn) {
            const onFireDown = (e) => {
                e.preventDefault();
                const touch = e.touches ? e.touches[0] : e;
                const rect = fireBtn.getBoundingClientRect();
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;
                const dx = touch.clientX - cx;
                const dy = touch.clientY - cy;
                this.touchFireAngle = Math.atan2(dy, dx);
                this.touchFireJustPressed = true;
            };
            fireBtn.addEventListener('touchstart', onFireDown, { passive: false });
            this._buttonListeners.push({
                el: fireBtn,
                down: onFireDown,
                up: () => {},
                cancel: () => {}
            });
        }
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

        const jump = this.keys.SPACE.isDown || this.keys.W.isDown || this.cursors.up.isDown || this.touchJump;

        let fire = false;
        let fireAngle = null;

        if (this.fireJustPressed) {
            fire = true;
            fireAngle = this.fireAngle;  // desktop: angle from player to cursor
            this.fireJustPressed = false;
            this.fireAngle = null;
        }

        if (this.touchFireJustPressed) {
            fire = true;
            fireAngle = this.touchFireAngle;  // mobile: angle from button center
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

        // Remove visibility handler
        if (this._onVisibilityChange) {
            document.removeEventListener('visibilitychange', this._onVisibilityChange);
            this._onVisibilityChange = null;
        }

        // Cancel pending joystick creation timer
        if (this._joystickTimer) {
            clearTimeout(this._joystickTimer);
            this._joystickTimer = null;
        }

        // Destroy nipplejs and clean up zone DOM
        if (this.nippleManager) {
            this.nippleManager.destroy();
            this.nippleManager = null;
        }
        const zone = document.getElementById('joystick-zone');
        if (zone) zone.innerHTML = '';

        // Remove button touch listeners
        this.removeButtonListeners();
    }
}
