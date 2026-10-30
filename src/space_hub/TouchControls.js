// ============================================================================
// TouchControls.js — Виртуальный стик, кнопка «ТУРБО / СЕСТЬ!» и клавиатура
// ============================================================================

export class TouchControls {
    constructor(rootElement, onActionTap) {
        this.root = rootElement;
        this.onActionTap = onActionTap;
        this.joy = { x: 0, y: 0, active: false };
        this.keys = {};
        this.turboHeld = false;
        this.canDock = false;
        this._mountDom();
        this._bindEvents();
    }

    _mountDom() {
        const wrap = document.createElement('div');
        wrap.className = 'sh-controls-layer';
        wrap.innerHTML = `
            <style>
                .sh-controls-layer, .sh-controls-layer * {
                    touch-action: none !important;
                    user-select: none !important;
                    -webkit-user-select: none !important;
                    -webkit-touch-callout: none !important;
                    box-sizing: border-box;
                }
                .sh-joy-base {
                    position: fixed;
                    left: max(22px, env(safe-area-inset-left, 22px));
                    bottom: max(20px, env(safe-area-inset-bottom, 20px));
                    width: 132px; height: 132px; border-radius: 50%;
                    background: radial-gradient(circle, rgba(56,189,248,0.22) 0%, rgba(15,23,42,0.68) 78%);
                    border: 2.5px solid rgba(125,211,252,0.55);
                    box-shadow: 0 8px 24px rgba(0,0,0,0.5); z-index: 9992;
                }
                .sh-joy-knob {
                    position: absolute; left: 50%; top: 50%;
                    width: 56px; height: 56px; margin-left: -28px; margin-top: -28px;
                    border-radius: 50%;
                    background: radial-gradient(circle at 32% 30%, #bae6fd, #0284c7 65%, #0c4a6e 100%);
                    border: 2.5px solid #ffffff;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.55); pointer-events: none;
                }
                .sh-action-btn {
                    position: fixed;
                    right: max(24px, env(safe-area-inset-right, 24px));
                    bottom: max(22px, env(safe-area-inset-bottom, 22px));
                    width: 106px; height: 106px; border-radius: 50%;
                    border: 3.5px solid #ffffff;
                    background: radial-gradient(circle at 30% 25%, #fde047, #f97316 62%, #9a3412 100%);
                    color: #ffffff; font-family: 'Comfortaa', 'Nunito', sans-serif; font-weight: 900;
                    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
                    box-shadow: 0 8px 24px rgba(249,115,22,0.55), inset 0 3px 8px rgba(255,255,255,0.45);
                    cursor: pointer; z-index: 9992;
                    transition: transform 0.1s ease, background 0.2s ease, box-shadow 0.2s ease;
                }
                .sh-action-btn:active { transform: scale(0.92); }
                .sh-action-btn.dock-ready {
                    background: radial-gradient(circle at 30% 25%, #86efac, #10b981 60%, #047857 100%);
                    box-shadow: 0 0 30px rgba(16,185,129,0.85), inset 0 3px 8px rgba(255,255,255,0.55);
                    border-color: #fef08a;
                }
            </style>
            <div class="sh-joy-base" id="shJoyBase"><div class="sh-joy-knob" id="shJoyKnob"></div></div>
            <button type="button" class="sh-action-btn" id="shActionBtn">
                <span style="font-size:28px;line-height:1;" id="shActionIcon">🔥</span>
                <span style="font-size:13px;letter-spacing:0.03em;" id="shActionText">ТУРБО</span>
            </button>
        `;
        this.root.appendChild(wrap);
        this.wrap = wrap;
        this.joyBase = wrap.querySelector('#shJoyBase');
        this.joyKnob = wrap.querySelector('#shJoyKnob');
        this.actionBtn = wrap.querySelector('#shActionBtn');
        this.actionIcon = wrap.querySelector('#shActionIcon');
        this.actionText = wrap.querySelector('#shActionText');
    }

    _bindEvents() {
        let pointerId = null;
        const maxR = 42;
        const updateStick = (clientX, clientY) => {
            const r = this.joyBase.getBoundingClientRect();
            let dx = clientX - (r.left + r.width / 2);
            let dy = clientY - (r.top + r.height / 2);
            const d = Math.hypot(dx, dy);
            if (d > maxR) { dx = (dx / d) * maxR; dy = (dy / d) * maxR; }
            this.joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
            this.joy.x = dx / maxR; this.joy.y = dy / maxR; this.joy.active = d > 4;
        };
        const resetStick = () => {
            pointerId = null;
            this.joyKnob.style.transform = 'translate(0px, 0px)';
            this.joy.x = 0; this.joy.y = 0; this.joy.active = false;
        };

        this.joyBase.addEventListener('pointerdown', (e) => {
            e.preventDefault(); pointerId = e.pointerId;
            this.joyBase.setPointerCapture?.(e.pointerId);
            updateStick(e.clientX, e.clientY);
        });
        this.joyBase.addEventListener('pointermove', (e) => { if (e.pointerId === pointerId) updateStick(e.clientX, e.clientY); });
        this.joyBase.addEventListener('pointerup', (e) => { if (e.pointerId === pointerId) resetStick(); });
        this.joyBase.addEventListener('pointercancel', resetStick);

        this.actionBtn.addEventListener('pointerdown', (e) => {
            e.preventDefault(); this.turboHeld = true;
            if (this.canDock && this.onActionTap) this.onActionTap();
        });
        const stopTurbo = () => { this.turboHeld = false; };
        this.actionBtn.addEventListener('pointerup', stopTurbo);
        this.actionBtn.addEventListener('pointercancel', stopTurbo);

        this._onKeyDown = (e) => {
            this.keys[e.code] = true;
            if ((e.code === 'Space' || e.code === 'Enter') && this.canDock && this.onActionTap) {
                e.preventDefault(); this.onActionTap();
            }
        };
        this._onKeyUp = (e) => { this.keys[e.code] = false; };
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
    }

    setDockMode(canDock) {
        if (this.canDock === canDock) return;
        this.canDock = canDock;
        this.actionBtn.classList.toggle('dock-ready', canDock);
        this.actionIcon.textContent = canDock ? '🪐' : '🔥';
        this.actionText.textContent = canDock ? 'СЕСТЬ!' : 'ТУРБО';
    }

    getInput() {
        let x = this.joy.x, y = this.joy.y;
        if (this.keys.KeyA || this.keys.ArrowLeft) x -= 1;
        if (this.keys.KeyD || this.keys.ArrowRight) x += 1;
        if (this.keys.KeyW || this.keys.ArrowUp) y -= 1;
        if (this.keys.KeyS || this.keys.ArrowDown) y += 1;
        const mag = Math.min(1, Math.hypot(x, y));
        const angle = mag > 0.05 ? Math.atan2(y, x) : null;
        return { x, y, mag, angle, turbo: this.turboHeld || !!this.keys.Space };
    }

    destroy() {
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('keyup', this._onKeyUp);
        this.wrap?.remove();
    }
}
