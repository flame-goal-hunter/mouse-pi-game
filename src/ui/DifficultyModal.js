// ============================================================================
// DifficultyModal.js — Единое модальное окно выбора сложности перед стартом планеты
// Поддерживает выбор при посадке из Космоса и смену сложности из Паузы мини-игры
// ============================================================================

import { DifficultyConfig } from '../config/DifficultyConfig.js';
import { PlayerProfile } from '../core/PlayerProfile.js';
import { SpaceAudio } from '../core/SpaceAudio.js';

export class DifficultyModal {
    constructor() {
        this.planetId = 'adventure';
        this.selectedLevel = PlayerProfile.difficulty || 'normal';
        this.onConfirm = null;
        this.onCancel = null;
        this._buildDOM();
    }

    _buildDOM() {
        const root = document.createElement('div');
        root.id = 'difficultyModalRoot';
        root.innerHTML = `
            <style>
                #difficultyModalRoot {
                    position: fixed; inset: 0; z-index: 10005;
                    background: rgba(6, 10, 26, 0.86); backdrop-filter: blur(10px);
                    display: none; align-items: center; justify-content: center; padding: 14px;
                    font-family: 'Nunito', sans-serif; user-select: none; -webkit-user-select: none;
                }
                #difficultyModalRoot.visible { display: flex; }
                .dm-card {
                    width: min(94vw, 560px); max-height: 92dvh; overflow-y: auto;
                    background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
                    border: 3px solid #38bdf8; border-radius: 28px;
                    padding: 18px 18px 16px; color: #f8fafc;
                    box-shadow: 0 22px 60px rgba(0,0,0,0.85); text-align: center;
                }
                .dm-title { font-size: clamp(17px, 3.6vw, 22px); font-weight: 900; color: #fef08a; margin-bottom: 4px; }
                .dm-sub { font-size: 13px; font-weight: 800; color: #93c5fd; margin-bottom: 12px; }
                .dm-list { display: flex; flex-direction: column; gap: 9px; margin-bottom: 14px; }
                .dm-opt {
                    display: flex; align-items: center; justify-content: space-between; gap: 10px;
                    padding: 12px 14px; border-radius: 18px; cursor: pointer;
                    background: rgba(15, 23, 42, 0.85); border: 2.5px solid rgba(148, 163, 184, 0.32);
                    text-align: left; color: #f8fafc; font-family: 'Nunito', sans-serif;
                    transition: transform 0.12s, border-color 0.15s, box-shadow 0.15s;
                }
                .dm-opt:active { transform: scale(0.98); }
                .dm-opt.active {
                    border-color: var(--dm-col, #fde047);
                    background: var(--dm-bg, rgba(250, 204, 21, 0.16));
                    box-shadow: 0 0 20px rgba(250, 204, 21, 0.25);
                }
                .dm-opt-name { font-size: 16px; font-weight: 900; display: flex; align-items: center; gap: 7px; }
                .dm-opt-desc { font-size: 12.5px; font-weight: 800; color: #cbd5e1; margin-top: 2px; }
                .dm-badge {
                    padding: 5px 10px; border-radius: 999px; font-size: 12px; font-weight: 900;
                    background: rgba(15, 23, 42, 0.9); border: 1.5px solid var(--dm-col, #fde047);
                    color: var(--dm-col, #fde047); white-space: nowrap;
                }
                .dm-actions { display: flex; gap: 10px; }
                .dm-btn {
                    flex: 1; min-height: 48px; border-radius: 16px; font-family: 'Nunito', sans-serif;
                    font-weight: 900; font-size: 15.5px; cursor: pointer; border: 2px solid rgba(255,255,255,0.28);
                    color: #fff; display: flex; align-items: center; justify-content: center; gap: 7px;
                    box-shadow: 0 6px 16px rgba(0,0,0,0.45);
                }
                .dm-btn:active { transform: scale(0.96); }
                .dm-btn-cancel { background: linear-gradient(180deg, #475569, #334155); border-color: #94a3b8; flex: 0.78; }
                .dm-btn-start { background: linear-gradient(180deg, #22c55e, #15803d); border-color: #86efac; flex: 1.22; font-size: 17px; }
            </style>
            <div class="dm-card">
                <div class="dm-title" id="dmTitle">🪐 Планета — Выбери сложность!</div>
                <div class="dm-sub">Чем выше сложность — тем больше сыра получит Мышонок Пи! 🧀</div>
                <div class="dm-list" id="dmList"></div>
                <div class="dm-actions">
                    <button type="button" class="dm-btn dm-btn-cancel" id="dmCancelBtn">✖ Назад в космос</button>
                    <button type="button" class="dm-btn dm-btn-start" id="dmStartBtn">🚀 Старт!</button>
                </div>
            </div>
        `;
        document.body.appendChild(root);
        this.root = root;
        this.titleEl = root.querySelector('#dmTitle');
        this.listEl = root.querySelector('#dmList');
        this.cancelBtn = root.querySelector('#dmCancelBtn');
        this.startBtn = root.querySelector('#dmStartBtn');

        this.cancelBtn.addEventListener('click', () => {
            SpaceAudio.playClick?.();
            this.close();
            if (this.onCancel) this.onCancel();
        });
        this.startBtn.addEventListener('click', () => this._confirm());
    }

    open(planetId, { onConfirm, onCancel, cancelLabel = '✖ Назад в космос' } = {}) {
        this.planetId = planetId || 'adventure';
        this.selectedLevel = DifficultyConfig.normalizeLevel(PlayerProfile.difficulty || 'normal');
        this.onConfirm = onConfirm || null;
        this.onCancel = onCancel || null;
        const pMeta = DifficultyConfig.getPlanetMeta(this.planetId);
        this.titleEl.textContent = `🪐 Планета: ${pMeta.icon} ${pMeta.name} — Выбери сложность!`;
        this.cancelBtn.textContent = cancelLabel;
        this._renderOptions();
        this.root.classList.add('visible');
    }

    close() {
        this.root.classList.remove('visible');
    }

    _renderOptions() {
        this.listEl.innerHTML = '';
        for (const lvl of ['easy', 'normal', 'hard']) {
            const cfg = DifficultyConfig.get(this.planetId, lvl);
            const active = this.selectedLevel === lvl;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `dm-opt${active ? ' active' : ''}`;
            btn.style.setProperty('--dm-col', cfg.color);
            btn.style.setProperty('--dm-bg', cfg.bg);
            btn.innerHTML = `
                <div>
                    <div class="dm-opt-name" style="color:${cfg.color};">${cfg.label}</div>
                    <div class="dm-opt-desc">${cfg.description}</div>
                </div>
                <div class="dm-badge">🧀 x${cfg.cheeseMultiplier}</div>
            `;
            btn.addEventListener('click', () => {
                this.selectedLevel = lvl;
                PlayerProfile.setDifficulty(lvl);
                SpaceAudio.playClick?.();
                this._renderOptions();
            });
            this.listEl.appendChild(btn);
        }
    }

    _confirm() {
        PlayerProfile.setDifficulty(this.selectedLevel);
        const diff = DifficultyConfig.get(this.planetId, this.selectedLevel);
        SpaceAudio.playClick?.();
        this.close();
        if (this.onConfirm) this.onConfirm(diff);
    }
}

export const difficultyModal = new DifficultyModal();
if (typeof window !== 'undefined') window.difficultyModal = difficultyModal;

