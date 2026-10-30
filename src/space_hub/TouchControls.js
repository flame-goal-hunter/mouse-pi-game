// ============================================================================
// TouchControls.js — Полупрозрачный виртуальный джойстик (слева внизу),
// круглая кнопка «ТУРБО / ДЕЙСТВИЕ» (справа внизу) + дублирование клавиатуры
// ============================================================================

import { SPACE_CONFIG } from './SpaceConfig.js';

export class TouchControls {
    constructor(containerEl, onActionTap) {
        this.container = containerEl;
        this.onActionTap = onActionTap;
        this.joyVec = { x: 0, y: 0 };
        this.turboHeld = false;
        this.canDock = false;
        this.keys = new Set();
        this.joyPointerId = null;
        this.joyOrigin = { x: 0, y: 0 };
        this._buildDOM();
        this._bindEvents();
    }

    _buildDOM() {
        const { joyBaseRadius: R, joyKnobRadius: r, actionBtnRadius: bR } = SPACE_CONFIG.controls;
        const wrap = document.createElement('div');
        wrap.className = 'sh-controls-layer';
        wrap.innerHTML = `
            <style>
                .sh-controls-layer, .sh-controls-layer * {
                    touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
                }
                .sh-joy-zone {
                    position: fixed; left: max(22px, env(safe-area-inset-left, 22px));
                    bottom: max(24px, env(safe-area-inset-bottom, 24px));
                    width: ${R * 2}px; height: ${R * 2}px; border-radius: 50%;
                    background: rgba(15, 23, 42, 0.48); border: 2.5px solid rgba(148, 163, 184, 0.45);
                    box-shadow: 0 8px 24px rgba(0,0,0,0.45), inset 0 0 18px rgba(56,189,248,0.18);
                    display: flex; align-items: center; justify-content: center; z-index: 9992;
                }
                .sh-joy-knob {
                    width: ${r * 2}px; height: ${r * 2}px; border-radius: 50%;
                    background: radial-gradient(circle at 32% 30%, #f8fafc, #38bdf8 65%, #0284c7);
                    box-shadow: 0 4px 14px rgba(56, 189, 248, 0.65); pointer-events: none;
                }
                .sh-action-btn {
                    position: fixed; right: max(24px, env(safe-area-inset-right, 24px));
                    bottom: max(26px, env(safe-area-inset-bottom, 26px));
                    width: ${bR * 2}px; height: ${bR * 2}px; border-radius: 50%;
                    border: 3px solid rgba(254, 240, 138, 0.85);
                    background: radial-gradient(circle at 30% 25%, #fb923c, #ea580c 70%, #9a3412);
                    color: #fff; font-family: 'Nunito', sans-serif; font-weight: 900; font-size: 14px;
                    letter-spacing: 0.5px; text-shadow: 0 2px 4px rgba(0,0,0,0.5);
                    box-shadow: 0 8px 24px rgba(234, 88, 12, 0.55);
                    display: flex; flex-direction: column; align-items: center; justify-content: center;
                    cursor: pointer; z-index: 9992; transition: transform 0.1s, background 0.2s, box-shadow 0.2s;
                }
                .sh-action-btn.dock-ready {
                    border-color: #bbf7d0;
                    background: radial-gradient(circle at 30% 25%, #4ade80, #16a34a 70%, #14532d);
                    box-shadow: 0 0 28px rgba(74, 222, 128, 0.85);
                    animation: shPulseDock 0.9s infinite alternate ease-in-out;
                }
                .sh-action-btn.dock-cyan {
                    border-color: #a5f3fc;
                    background: radial-gradient(circle at 30% 25%, #22d3ee, #0284c7 70%, #0c4a6e);
                    box-shadow: 0 0 28px rgba(34, 211, 238, 0.85);
                    animation: shPulseDock 0.9s infinite alternate ease-in-out;
                }
                @keyframes shPulseDock { from { transform: scale(1); } to { transform: scale(1.08); } }
            </style>
            <div class="sh-joy-zone"><div class="sh-joy-knob"></div></div>
            <button type="button" class="sh-action-btn">
                <span style="font-size:22px;line-height:1">🔥</span>
                <span class="sh-btn-lbl">ТУРБО</span>
            </button>
        `;
        this.container.appendChild(wrap);
        this.root = wrap;
        this.joyZone = wrap.querySelector('.sh-joy-zone');
        this.joyKnob = wrap.querySelector('.sh-joy-knob');
        this.actionBtn = wrap.querySelector('.sh-action-btn');
        this.btnLabel = wrap.querySelector('.sh-btn-lbl');
        this.btnIcon = this.actionBtn.querySelector('span');
    }

    setDockMode(canDock, label = 'СЕСТЬ!', icon = '🪐', theme = 'green') {
        this.canDock = Boolean(canDock);
        this.actionBtn.classList.toggle('dock-ready', this.canDock && theme !== 'cyan');
        this.actionBtn.classList.toggle('dock-cyan', this.canDock && theme === 'cyan');
        this.btnLabel.textContent = this.canDock ? label : 'ТУРБО';
        this.btnIcon.textContent = this.canDock ? icon : '🔥';
    }

    _bindEvents() {
        const R = SPACE_CONFIG.controls.joyBaseRadius;
        this.joyZone.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            this.joyPointerId = e.pointerId;
            this.joyZone.setPointerCapture?.(e.pointerId);
            const rect = this.joyZone.getBoundingClientRect();
            this.joyOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            this._moveStick(e.clientX, e.clientY, R);
        });
        this.joyZone.addEventListener('pointermove', (e) => {
            if (e.pointerId === this.joyPointerId) this._moveStick(e.clientX, e.clientY, R);
        });
        const releaseStick = (e) => {
            if (e.pointerId !== this.joyPointerId) return;
            this.joyPointerId = null;
            this.joyVec = { x: 0, y: 0 };
            this.joyKnob.style.transform = 'translate(0px, 0px)';
        };
        this.joyZone.addEventListener('pointerup', releaseStick);
        this.joyZone.addEventListener('pointercancel', releaseStick);

        this.actionBtn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            if (this.canDock) this.onActionTap();
            else this.turboHeld = true;
        });
        const endTurbo = () => { this.turboHeld = false; };
        this.actionBtn.addEventListener('pointerup', endTurbo);
        this.actionBtn.addEventListener('pointercancel', endTurbo);
        this.actionBtn.addEventListener('pointerleave', endTurbo);

        this._onKeyDown = (e) => {
            if (!this.container.offsetParent) return;
            this.keys.add(e.code);
            if ((e.code === 'Space' || e.code === 'Enter') && this.canDock) {
                e.preventDefault();
                this.onActionTap();
            }
        };
        this._onKeyUp = (e) => this.keys.delete(e.code);
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
    }

    _moveStick(cx, cy, maxR) {
        const dx = cx - this.joyOrigin.x, dy = cy - this.joyOrigin.y;
        const dist = Math.hypot(dx, dy);
        const clamped = Math.min(dist, maxR);
        const angle = Math.atan2(dy, dx);
        const kx = Math.cos(angle) * clamped, ky = Math.sin(angle) * clamped;
        this.joyKnob.style.transform = `translate(${kx.toFixed(1)}px, ${ky.toFixed(1)}px)`;
        const norm = clamped / maxR;
        this.joyVec = norm < SPACE_CONFIG.controls.deadzone
            ? { x: 0, y: 0 }
            : { x: (kx / maxR), y: (ky / maxR) };
    }

    getInput() {
        let kx = 0, ky = 0;
        if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) kx -= 1;
        if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) kx += 1;
        if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) ky -= 1;
        if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) ky += 1;
        if (kx !== 0 && ky !== 0) { kx *= 0.7071; ky *= 0.7071; }
        return {
            moveX: Math.abs(this.joyVec.x) > 0.01 ? this.joyVec.x : kx,
            moveY: Math.abs(this.joyVec.y) > 0.01 ? this.joyVec.y : ky,
            turboHeld: this.turboHeld || (this.keys.has('Space') && !this.canDock) || this.keys.has('ShiftLeft')
        };
    }
}
