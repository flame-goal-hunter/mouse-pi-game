// ============================================
// HUMAN INPUT - Keyboard + Mobile Arcade Touch Controls
// v9: Custom zero-latency multi-touch Virtual Thumbstick + 3D Arcade Buttons
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
        this.touchJumpJustPressed = false;
        this.touchHook = false;
        this.touchHookJustPressed = false;
        this.touchFireJustPressed = false;

        // Virtual thumbstick state
        this.joystickDir = 0;
        this.joystickStrength = 1;
        this._joyTouchId = null;
        this._joyOriginX = 0;
        this._joyOriginY = 0;
        this._joyMouseDown = false;

        // Listener references (for cleanup)
        this._buttonListeners = [];
        this._joyListeners = [];
        this._destroyed = false;

        // Mobile / touch detection
        this.isMobile = this.detectMobile();
        console.log('[HumanInput] isMobile =', this.isMobile);

        // Always initialize DOM touch controls if mobile, OR lazily on first touchstart anywhere
        if (this.isMobile) {
            document.body.classList.add('touch-enabled');
            this.setupTouchControls();
        } else {
            this._firstTouchHandler = () => {
                if (this._destroyed) return;
                this.isMobile = true;
                document.body.classList.add('touch-enabled');
                this.setupTouchControls();
                if (this._firstTouchHandler) {
                    window.removeEventListener('touchstart', this._firstTouchHandler);
                    this._firstTouchHandler = null;
                }
            };
            window.addEventListener('touchstart', this._firstTouchHandler, { passive: true });
        }

        // Desktop mouse — fire angle from player to cursor + disable right-click context menu for Teeworlds hook
        this.fireAngle = null;
        if (scene.input.mouse) {
            scene.input.mouse.disableContextMenu();
        }
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

        // Handle app minimize/restore or iframe focus loss so keys never stick
        this._resetInputState = () => {
            if (this.scene?.input?.keyboard) {
                this.scene.input.keyboard.resetKeys();
            }
            this._resetJoystick();
            this.touchJump = false;
            this.touchJumpJustPressed = false;
            this.touchHook = false;
            this.touchHookJustPressed = false;
            this.fireJustPressed = false;
            this.hookJustPressed = false;
            this.wasHookDown = false;
            this.touchFireJustPressed = false;
            this._wasSpaceDown = false;
            this._wasWDown = false;
            this._wasUpDown = false;
            this._wasTouchJump = false;
            ['btn-jump', 'btn-fire', 'btn-hook'].forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.classList.remove('is-pressed');
            });
        };
        this._onVisibilityChange = () => {
            this._resetInputState();
        };
        document.addEventListener('visibilitychange', this._onVisibilityChange);
        window.addEventListener('blur', this._resetInputState);
    }

    detectMobile() {
        const ua = navigator.userAgent || '';
        const uaMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
        // iPadOS 13+ reports MacIntel with maxTouchPoints > 1
        const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
        const coarsePointer = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
        const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        const forceTouch = new URLSearchParams(window.location.search).get('touch') === '1';
        return !!(uaMobile || iPadOS || coarsePointer || (hasTouch && window.innerWidth <= 1366) || forceTouch);
    }

    _vibrate(ms = 10) {
        try {
            if (navigator.vibrate) navigator.vibrate(ms);
        } catch (e) {}
    }

    // ==========================================
    // SETUP
    // ==========================================

    setupTouchControls() {
        if (this._touchControlsSetup) return;
        this._touchControlsSetup = true;
        this.createJoystick();
        this.createButtons();
        console.log('[TouchControls] v9: custom multi-touch arcade thumbstick + 3D action buttons');
    }

    // ==========================================
    // LEFT VIRTUAL ARCADE THUMBSTICK — movement
    // ==========================================

    createJoystick() {
        const zone = document.getElementById('joystick-zone');
        if (!zone) {
            console.error('[HumanInput] #joystick-zone element not found!');
            return;
        }

        // Ensure #joy-base and #joy-stick exist inside #joystick-zone
        if (!document.getElementById('joy-base')) {
            zone.innerHTML = `
                <div id="joy-base">
                    <span class="joy-arrow left">◀</span>
                    <span class="joy-arrow right">▶</span>
                    <div id="joy-stick"></div>
                </div>
            `;
        }

        const baseEl = document.getElementById('joy-base');
        const stickEl = document.getElementById('joy-stick');
        if (!baseEl || !stickEl) return;

        const maxRadius = 40;
        const deadzone = 10; // responsive 10px deadzone

        const updateStickFromPoint = (clientX, clientY) => {
            const dx = clientX - this._joyOriginX;
            const dy = clientY - this._joyOriginY;
            const dist = Math.hypot(dx, dy);
            const clamped = Math.min(dist, maxRadius);
            const angle = dist > 0.001 ? Math.atan2(dy, dx) : 0;
            const offsetX = Math.cos(angle) * clamped;
            const offsetY = Math.sin(angle) * clamped;

            stickEl.style.transform = `translate3d(${offsetX.toFixed(1)}px, ${offsetY.toFixed(1)}px, 0)`;

            if (Math.abs(dx) > deadzone) {
                this.joystickDir = dx > 0 ? 1 : -1;
                this.joystickStrength = Math.min(1, Math.max(0.45, Math.abs(dx) / maxRadius));
            } else {
                this.joystickDir = 0;
                this.joystickStrength = 1;
            }

            baseEl.classList.toggle('dir-left', this.joystickDir < 0);
            baseEl.classList.toggle('dir-right', this.joystickDir > 0);
        };

        const startAtPoint = (clientX, clientY) => {
            const rect = baseEl.getBoundingClientRect();
            const baseCX = rect.left + rect.width / 2;
            const baseCY = rect.top + rect.height / 2;
            const distFromBase = Math.hypot(clientX - baseCX, clientY - baseCY);

            // If finger lands on or near the visual joystick pad, anchor to pad center
            // so tapping left/right side of the pad works immediately like a D-pad!
            // If finger lands farther away in #joystick-zone, anchor to finger position.
            if (rect.width > 0 && distFromBase <= rect.width * 0.78) {
                this._joyOriginX = baseCX;
                this._joyOriginY = baseCY;
            } else {
                this._joyOriginX = clientX;
                this._joyOriginY = clientY;
            }

            baseEl.classList.add('is-active');
            updateStickFromPoint(clientX, clientY);
        };

        const onTouchStart = (e) => {
            e.preventDefault();
            if (this._joyTouchId !== null) return;
            const touch = e.changedTouches[0];
            if (!touch) return;
            this._joyTouchId = touch.identifier;
            this._vibrate(8);
            startAtPoint(touch.clientX, touch.clientY);
        };

        const onTouchMove = (e) => {
            e.preventDefault();
            if (this._joyTouchId === null) return;
            for (let i = 0; i < e.touches.length; i++) {
                const t = e.touches[i];
                if (t.identifier === this._joyTouchId) {
                    updateStickFromPoint(t.clientX, t.clientY);
                    return;
                }
            }
        };

        const onTouchEnd = (e) => {
            e.preventDefault();
            if (this._joyTouchId === null) return;
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === this._joyTouchId) {
                    this._resetJoystick();
                    return;
                }
            }
        };

        // Mouse fallback for desktop testing of mobile UI
        const onMouseDown = (e) => {
            e.preventDefault();
            this._joyMouseDown = true;
            startAtPoint(e.clientX, e.clientY);
        };
        const onMouseMove = (e) => {
            if (!this._joyMouseDown) return;
            updateStickFromPoint(e.clientX, e.clientY);
        };
        const onMouseUp = () => {
            if (!this._joyMouseDown) return;
            this._joyMouseDown = false;
            this._resetJoystick();
        };

        zone.addEventListener('touchstart', onTouchStart, { passive: false });
        zone.addEventListener('touchmove', onTouchMove, { passive: false });
        zone.addEventListener('touchend', onTouchEnd, { passive: false });
        zone.addEventListener('touchcancel', onTouchEnd, { passive: false });
        zone.addEventListener('mousedown', onMouseDown);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);

        this._joyListeners.push(
            { el: zone, type: 'touchstart', fn: onTouchStart },
            { el: zone, type: 'touchmove', fn: onTouchMove },
            { el: zone, type: 'touchend', fn: onTouchEnd },
            { el: zone, type: 'touchcancel', fn: onTouchEnd },
            { el: zone, type: 'mousedown', fn: onMouseDown },
            { el: window, type: 'mousemove', fn: onMouseMove },
            { el: window, type: 'mouseup', fn: onMouseUp }
        );
    }

    _resetJoystick() {
        this._joyTouchId = null;
        this._joyMouseDown = false;
        this.joystickDir = 0;
        this.joystickStrength = 1;
        const baseEl = document.getElementById('joy-base');
        const stickEl = document.getElementById('joy-stick');
        if (baseEl) {
            baseEl.classList.remove('is-active', 'dir-left', 'dir-right');
        }
        if (stickEl) {
            stickEl.style.transform = 'translate3d(0px, 0px, 0)';
        }
    }

    recreateJoysticks() {
        this._resetJoystick();
    }

    // ==========================================
    // BUTTONS (DOM-based) — jump, fire, hook
    // ==========================================

    createButtons() {
        this._buttonListeners = [];

        const bind = (el, onDown, onUp) => {
            if (!el) return;
            const activeTouches = new Set();

            const down = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.changedTouches) {
                    for (let i = 0; i < e.changedTouches.length; i++) {
                        activeTouches.add(e.changedTouches[i].identifier);
                    }
                }
                el.classList.add('is-pressed');
                this._vibrate(10);
                onDown();
            };

            const up = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.changedTouches) {
                    for (let i = 0; i < e.changedTouches.length; i++) {
                        activeTouches.delete(e.changedTouches[i].identifier);
                    }
                } else {
                    activeTouches.clear();
                }
                if (activeTouches.size === 0) {
                    el.classList.remove('is-pressed');
                    onUp();
                }
            };

            const mouseDown = (e) => {
                e.preventDefault();
                el.classList.add('is-pressed');
                onDown();
            };
            const mouseUp = (e) => {
                e.preventDefault();
                el.classList.remove('is-pressed');
                onUp();
            };

            el.addEventListener('touchstart', down, { passive: false });
            el.addEventListener('touchend', up, { passive: false });
            el.addEventListener('touchcancel', up, { passive: false });
            el.addEventListener('mousedown', mouseDown);
            el.addEventListener('mouseup', mouseUp);
            el.addEventListener('mouseleave', mouseUp);

            this._buttonListeners.push({ el, down, up, mouseDown, mouseUp });
        };

        bind(document.getElementById('btn-jump'),
            () => {
                this.touchJump = true;
                this.touchJumpJustPressed = true;
            },
            () => {
                this.touchJump = false;
            }
        );

        bind(document.getElementById('btn-fire'),
            () => {
                this.touchFireJustPressed = true;
            },
            () => {}
        );

        bind(document.getElementById('btn-hook'),
            () => {
                this.touchHook = true;
                this.touchHookJustPressed = true;
            },
            () => {
                this.touchHook = false;
            }
        );
    }

    removeButtonListeners() {
        if (this._buttonListeners) {
            this._buttonListeners.forEach(({ el, down, up, mouseDown, mouseUp }) => {
                el.removeEventListener('touchstart', down);
                el.removeEventListener('touchend', up);
                el.removeEventListener('touchcancel', up);
                el.removeEventListener('mousedown', mouseDown);
                el.removeEventListener('mouseup', mouseUp);
                el.removeEventListener('mouseleave', mouseUp);
                el.classList.remove('is-pressed');
            });
            this._buttonListeners = [];
        }
        if (this._joyListeners) {
            this._joyListeners.forEach(({ el, type, fn }) => {
                el.removeEventListener(type, fn);
            });
            this._joyListeners = [];
        }
    }

    // ==========================================
    // INPUT
    // ==========================================

    getInput() {
        const rightMouseHook = !this.isMobile && this.pointer && this.pointer.rightButtonDown();
        const hookDown = this.keys.E.isDown || rightMouseHook || this.touchHook;
        this.hookJustPressed = hookDown && !this.wasHookDown;
        this.wasHookDown = hookDown;

        let direction = 0;
        if (this.keys.A.isDown || this.cursors.left.isDown) direction -= 1;
        if (this.keys.D.isDown || this.cursors.right.isDown) direction += 1;

        if (this.joystickDir !== 0) {
            direction = this.joystickDir;
        }

        const spaceDown = !!this.keys.SPACE.isDown;
        const wDown = !!this.keys.W.isDown;
        const upDown = !!this.cursors.up.isDown;
        const touchJ = !!this.touchJump;
        const jump = spaceDown || wDown || upDown || touchJ || this.touchJumpJustPressed;

        // Detect fresh press of ANY jump key or touch button
        const jumpJustPressed =
            (spaceDown && !this._wasSpaceDown) ||
            (wDown && !this._wasWDown) ||
            (upDown && !this._wasUpDown) ||
            (touchJ && !this._wasTouchJump) ||
            this.touchJumpJustPressed;

        this._wasSpaceDown = spaceDown;
        this._wasWDown = wDown;
        this._wasUpDown = upDown;
        this._wasTouchJump = touchJ;
        this.touchJumpJustPressed = false;

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
            jumpJustPressed,
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

        if (this._firstTouchHandler) {
            window.removeEventListener('touchstart', this._firstTouchHandler);
            this._firstTouchHandler = null;
        }
        if (this._onVisibilityChange) {
            document.removeEventListener('visibilitychange', this._onVisibilityChange);
            this._onVisibilityChange = null;
        }
        if (this._resetInputState) {
            window.removeEventListener('blur', this._resetInputState);
            this._resetInputState = null;
        }

        this._resetJoystick();
        this.removeButtonListeners();
        this._touchControlsSetup = false;
    }
}
