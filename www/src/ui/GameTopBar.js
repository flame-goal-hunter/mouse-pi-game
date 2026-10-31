// ============================================================================
// GameTopBar.js — Единая верхняя панель управления и меню Паузы для всех мини-игр
// Кнопки «🚀 В КОСМОС», бейджик сложности (🟢/🟡/🔴), «🧀 +N» и «⏸ ПАУЗА»
// ============================================================================

import { PlayerProfile } from '../core/PlayerProfile.js';
import { DifficultyConfig } from '../config/DifficultyConfig.js';
import { difficultyModal } from './DifficultyModal.js';

export class GameTopBar {
    constructor({ onExitToSpace, onPauseChange, onRestart, getRoundCheese } = {}) {
        this.onExitToSpace = onExitToSpace || (() => {});
        this.onPauseChange = onPauseChange || (() => {});
        this.onRestart = onRestart || (() => {});
        this.getRoundCheese = getRoundCheese || (() => 0);
        Object.assign(this, {
            active: false, isPaused: false, planetId: null,
            currentDiff: DifficultyConfig.get('adventure', PlayerProfile.difficulty),
            roundCheese: 0, bankedCheese: 0, _lastRawCheese: 0
        });
        this._buildDOM();
        this._timer = setInterval(() => this._tick(), 120);
    }

    _buildDOM() {
        const root = document.createElement('div');
        root.id = 'gameTopBarRoot';
        root.innerHTML = `
            <style>
                #gameTopBarRoot { display: none; font-family: 'Nunito', sans-serif; user-select: none; -webkit-user-select: none; }
                .gtb-bar { position: fixed; top: max(8px, env(safe-area-inset-top, 8px)); left: max(12px, env(safe-area-inset-left, 12px)); right: max(12px, env(safe-area-inset-right, 12px)); display: flex; align-items: center; justify-content: space-between; z-index: 10000; pointer-events: none; gap: 6px; }
                .gtb-btn { pointer-events: auto; cursor: pointer; touch-action: manipulation; display: inline-flex; align-items: center; gap: 7px; min-height: 44px; padding: 8px 15px; border-radius: 999px; font-family: 'Nunito', sans-serif; font-weight: 900; font-size: clamp(12.5px, 2.6vw, 15px); color: #fff; box-shadow: 0 6px 18px rgba(0,0,0,0.55); transition: transform 0.1s; }
                .gtb-btn:active { transform: scale(0.94); }
                .gtb-space-btn { background: linear-gradient(180deg, #0ea5e9 0%, #0284c7 100%); border: 2.5px solid #bae6fd; text-shadow: 0 1px 2px rgba(0,0,0,0.5); }
                .gtb-right-grp { display: flex; align-items: center; gap: 7px; pointer-events: auto; flex-wrap: wrap; justify-content: flex-end; }
                .gtb-diff-pill { cursor: pointer; background: rgba(15, 23, 42, 0.92); border: 2px solid #facc15; border-radius: 999px; padding: 7px 12px; color: #fef08a; font-weight: 900; font-size: clamp(11.5px, 2.4vw, 14px); box-shadow: 0 4px 14px rgba(0,0,0,0.5); }
                .gtb-cheese-pill { background: rgba(15, 23, 42, 0.9); border: 2px solid #facc15; border-radius: 999px; padding: 7px 14px; color: #fde047; font-weight: 900; font-size: clamp(12.5px, 2.6vw, 15px); box-shadow: 0 4px 14px rgba(0,0,0,0.5); }
                .gtb-pause-btn { background: linear-gradient(180deg, #f59e0b 0%, #d97706 100%); border: 2.5px solid #fef08a; text-shadow: 0 1px 2px rgba(0,0,0,0.5); }
                .gtb-modal-backdrop { position: fixed; inset: 0; z-index: 10001; background: rgba(8, 12, 28, 0.84); backdrop-filter: blur(8px); display: none; align-items: center; justify-content: center; padding: 16px; }
                .gtb-modal-backdrop.visible { display: flex; }
                .gtb-modal-card { width: min(92vw, 390px); background: linear-gradient(180deg, #1e293b, #0f172a); border: 3px solid #38bdf8; border-radius: 26px; padding: 20px 18px; text-align: center; color: #f8fafc; box-shadow: 0 20px 55px rgba(0,0,0,0.8); }
                .gtb-modal-btn { width: 100%; min-height: 48px; border-radius: 16px; border: 2px solid rgba(255,255,255,0.25); font-family: 'Nunito', sans-serif; font-weight: 900; font-size: 16px; color: #fff; cursor: pointer; margin-top: 9px; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 6px 16px rgba(0,0,0,0.4); touch-action: manipulation; }
                .gtb-modal-btn:active { transform: scale(0.96); }
            </style>
            <div class="gtb-bar">
                <button type="button" class="gtb-btn gtb-space-btn" id="gtbToSpaceBtn">🚀 В КОСМОС</button>
                <div class="gtb-right-grp">
                    <div class="gtb-diff-pill" id="gtbDiffPill" title="Сменить сложность">🟡 Средний</div>
                    <div class="gtb-cheese-pill" id="gtbCheesePill">🧀 +0</div>
                    <button type="button" class="gtb-btn gtb-pause-btn" id="gtbPauseBtn">⏸ ПАУЗА</button>
                </div>
            </div>
            <div class="gtb-modal-backdrop" id="gtbPauseModal">
                <div class="gtb-modal-card">
                    <div style="font-size:23px;font-weight:900;color:#fef08a;margin-bottom:3px;">⏸ ПАУЗА</div>
                    <div id="gtbModalDiff" style="font-size:13px;font-weight:900;color:#cbd5e1;margin-bottom:4px;">Сложность: 🟡 Средний (x1.5 🧀)</div>
                    <div id="gtbModalLoot" style="font-size:14px;font-weight:800;color:#7dd3fc;margin-bottom:10px;">Добыто за вылет: 🧀 +0</div>
                    <button type="button" class="gtb-modal-btn" id="gtbResumeBtn" style="background:linear-gradient(180deg,#22c55e,#15803d);border-color:#86efac;">▶️ Продолжить</button>
                    <button type="button" class="gtb-modal-btn" id="gtbRestartBtn" style="background:linear-gradient(180deg,#f59e0b,#b45309);border-color:#fde047;">🔄 Заново</button>
                    <button type="button" class="gtb-modal-btn" id="gtbChangeDiffBtn" style="background:linear-gradient(180deg,#8b5cf6,#6d28d9);border-color:#c4b5fd;">🎚️ Сменить сложность</button>
                    <button type="button" class="gtb-modal-btn" id="gtbExitSpaceBtn" style="background:linear-gradient(180deg,#0ea5e9,#0369a1);border-color:#7dd3fc;">🚀 Выйти в Космос</button>
                </div>
            </div>
        `;
        document.body.appendChild(root);
        this.root = root;
        this.diffPill = root.querySelector('#gtbDiffPill');
        this.cheesePill = root.querySelector('#gtbCheesePill');
        this.modal = root.querySelector('#gtbPauseModal');
        this.modalDiff = root.querySelector('#gtbModalDiff');
        this.modalLoot = root.querySelector('#gtbModalLoot');
        root.querySelector('#gtbToSpaceBtn').addEventListener('click', () => this.exitToSpace());
        root.querySelector('#gtbPauseBtn').addEventListener('click', () => this.setPaused(!this.isPaused));
        this.diffPill.addEventListener('click', () => this.openDifficultySwitcher());
        root.querySelector('#gtbResumeBtn').addEventListener('click', () => this.setPaused(false));
        root.querySelector('#gtbRestartBtn').addEventListener('click', () => this.restartCurrentGame());
        root.querySelector('#gtbChangeDiffBtn').addEventListener('click', () => this.openDifficultySwitcher());
        root.querySelector('#gtbExitSpaceBtn').addEventListener('click', () => this.exitToSpace());
    }

    setDifficulty(diffOrLevel) {
        const lvl = typeof diffOrLevel === 'object' ? diffOrLevel?.level : diffOrLevel;
        this.currentDiff = DifficultyConfig.get(this.planetId || 'adventure', lvl || PlayerProfile.difficulty);
        if (typeof window !== 'undefined') window.__currentGameDifficulty = this.currentDiff;
        this.diffPill.textContent = `${this.currentDiff.shortLabel} · x${this.currentDiff.cheeseMultiplier}`;
        this.diffPill.style.borderColor = this.currentDiff.border;
        this.diffPill.style.color = this.currentDiff.color;
        this.modalDiff.textContent = `Сложность: ${this.currentDiff.shortLabel} (Сыр x${this.currentDiff.cheeseMultiplier} 🧀)`;
    }

    openDifficultySwitcher() {
        if (!this.active) return;
        const wasPaused = this.isPaused;
        if (!wasPaused) this.setPaused(true);
        difficultyModal.open(this.planetId, {
            cancelLabel: '✖ Оставить как есть',
            onConfirm: (newDiff) => {
                this.setDifficulty(newDiff);
                this.restartCurrentGame(newDiff);
            }
        });
    }

    show(planetId, diff = null) {
        this.planetId = planetId || this.planetId || 'adventure';
        Object.assign(this, { active: true, isPaused: false, roundCheese: 0, bankedCheese: 0, _lastRawCheese: 0 });
        this.setDifficulty(diff || PlayerProfile.difficulty);
        this.modal.classList.remove('visible');
        this.root.style.display = 'block';
        this._renderCheese();
    }

    hide() {
        this.active = false; this.isPaused = false;
        this.modal.classList.remove('visible');
        this.root.style.display = 'none';
    }

    setPaused(paused) {
        if (!this.active) return;
        this.isPaused = !!paused;
        this.modal.classList.toggle('visible', this.isPaused);
        this._renderCheese();
        this.onPauseChange(this.isPaused);
    }

    restartCurrentGame(newDiff = null) {
        this.bankedCheese += this._lastRawCheese; this._lastRawCheese = 0;
        this.setPaused(false);
        this.onRestart(this.planetId, newDiff || this.currentDiff);
    }

    exitToSpace() {
        if (!this.active) return;
        this._tick();
        const earned = Math.max(0, Math.round(this.roundCheese || 0));
        if (earned > 0) PlayerProfile.addPocketCheese(earned);
        const pid = this.planetId;
        Object.assign(this, { roundCheese: 0, bankedCheese: 0, _lastRawCheese: 0 });
        this.hide();
        this.onExitToSpace(pid, earned);
    }

    _tick() {
        if (!this.active) return;
        const baseRaw = Math.max(0, Number(this.getRoundCheese(this.planetId)) || 0);
        const mult = this.currentDiff?.cheeseMultiplier || 1;
        const scaled = Math.max(0, Math.round(baseRaw * mult));
        if (scaled < this._lastRawCheese) this.bankedCheese += this._lastRawCheese;
        this._lastRawCheese = scaled;
        this.roundCheese = this.bankedCheese + scaled;
        this._renderCheese();
    }

    _renderCheese() {
        this.cheesePill.textContent = `🧀 +${this.roundCheese}`;
        this.modalLoot.textContent = `Добыто в багажник ракеты: 🧀 +${this.roundCheese}`;
    }
}
