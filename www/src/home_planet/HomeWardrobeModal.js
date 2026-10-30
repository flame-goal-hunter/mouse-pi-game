// ============================================================================
// HomeWardrobeModal.js — Гардероб и Магазин Скинов на Домашней Планете
// Покупка скинов за сыр со Склада (storedCheese) и мгновенное переодевание Пи
// ============================================================================

import { PlayerProfile, SKIN_CATALOG, getPlayerSkinSprite } from '../core/PlayerProfile.js';

export class HomeWardrobeModal {
    constructor(parentEl, onSkinChanged) {
        this.parentEl = parentEl;
        this.onSkinChanged = onSkinChanged || (() => {});
        this._buildDOM();
    }

    _buildDOM() {
        const modal = document.createElement('div');
        modal.className = 'hp-wardrobe-modal';
        modal.innerHTML = `
            <style>
                .hp-wardrobe-modal {
                    position: fixed; inset: 0; z-index: 9998;
                    background: rgba(4, 7, 20, 0.84); backdrop-filter: blur(8px);
                    display: none; align-items: center; justify-content: center; padding: 14px;
                    font-family: 'Nunito', sans-serif;
                }
                .hp-wardrobe-modal.open { display: flex; }
                .hp-wardrobe-card {
                    width: min(680px, 95vw); max-height: 86vh;
                    background: linear-gradient(180deg, #1e1b4b, #0f172a);
                    border: 2.5px solid #a78bfa; border-radius: 24px;
                    box-shadow: 0 20px 50px rgba(0,0,0,0.75);
                    display: flex; flex-direction: column; overflow: hidden; color: #fff;
                }
                .hp-wardrobe-head {
                    padding: 14px 18px; display: flex; align-items: center; justify-content: space-between;
                    background: rgba(15, 23, 42, 0.75); border-bottom: 1.5px solid rgba(167, 139, 250, 0.35);
                }
                .hp-wardrobe-grid {
                    padding: 14px; overflow-y: auto;
                    display: grid; grid-template-columns: repeat(auto-fill, minmax(145px, 1fr)); gap: 12px;
                }
                .hp-skin-item {
                    background: rgba(30, 41, 59, 0.85); border: 2px solid rgba(148, 163, 184, 0.35);
                    border-radius: 18px; padding: 10px; display: flex; flex-direction: column;
                    align-items: center; text-align: center; gap: 5px; transition: transform 0.12s;
                }
                .hp-skin-item.equipped { border-color: #4ade80; box-shadow: 0 0 18px rgba(74, 222, 128, 0.35); }
                .hp-skin-item img { width: 58px; height: 58px; object-fit: contain; }
                .hp-skin-btn {
                    margin-top: auto; width: 100%; padding: 7px 10px; border-radius: 12px;
                    border: none; font-family: inherit; font-weight: 900; font-size: 12.5px; cursor: pointer;
                }
                .hp-skin-btn.equip { background: #38bdf8; color: #0f172a; }
                .hp-skin-btn.active { background: #4ade80; color: #052e16; }
                .hp-skin-btn.buy { background: linear-gradient(135deg, #facc15, #eab308); color: #1e1b4b; }
                .hp-skin-btn.locked { background: #334155; color: #94a3b8; cursor: not-allowed; }
            </style>
            <div class="hp-wardrobe-card">
                <div class="hp-wardrobe-head">
                    <div>
                        <div style="font-weight:900;font-size:18px;color:#f3e8ff;">👗 Космо-Гардероб Мышонка Пи</div>
                        <div style="font-size:12.5px;color:#cbd5e1;" id="hpWardrobeBalance">🧀 На складе: 0</div>
                    </div>
                    <button type="button" id="hpWardrobeClose" style="background:#ef4444;color:#fff;border:none;width:36px;height:36px;border-radius:50%;font-weight:900;font-size:16px;cursor:pointer;">✕</button>
                </div>
                <div class="hp-wardrobe-grid" id="hpWardrobeGrid"></div>
            </div>
        `;
        this.parentEl.appendChild(modal);
        this.modal = modal;
        this.grid = modal.querySelector('#hpWardrobeGrid');
        this.balanceEl = modal.querySelector('#hpWardrobeBalance');
        modal.querySelector('#hpWardrobeClose').addEventListener('click', () => this.close());
        modal.addEventListener('click', (e) => { if (e.target === modal) this.close(); });
    }

    open() {
        PlayerProfile._syncFromStorage();
        this._renderItems();
        this.modal.classList.add('open');
    }

    close() {
        this.modal.classList.remove('open');
    }

    _renderItems() {
        this.balanceEl.textContent = `🧀 Сыр на Складе: ${PlayerProfile.storedCheese} (В багажнике: ${PlayerProfile.pocketCheese})`;
        this.grid.innerHTML = '';

        for (const skin of SKIN_CATALOG) {
            const spr = getPlayerSkinSprite(skin.id);
            const unlocked = PlayerProfile.unlockedSkins.includes(skin.id);
            const equipped = PlayerProfile.equippedSkinId === skin.id;
            const canAfford = PlayerProfile.storedCheese >= skin.price;

            const card = document.createElement('div');
            card.className = `hp-skin-item${equipped ? ' equipped' : ''}`;

            let btnClass = 'buy', btnText = `Купить · ${skin.price} 🧀`;
            if (equipped) { btnClass = 'active'; btnText = '✓ Надет'; }
            else if (unlocked) { btnClass = 'equip'; btnText = 'Надеть'; }
            else if (!canAfford) { btnClass = 'locked'; btnText = `Нужно ${skin.price} 🧀`; }

            card.innerHTML = `
                <img src="${spr.svgUrl}" alt="${skin.name}">
                <div style="font-weight:900;font-size:13.5px;color:#f8fafc;">${skin.name}</div>
                <div style="font-size:11px;color:#94a3b8;line-height:1.25;">${skin.desc}</div>
                <button type="button" class="hp-skin-btn ${btnClass}">${btnText}</button>
            `;

            card.querySelector('button').addEventListener('click', () => {
                if (equipped) return;
                const res = PlayerProfile.buyAndEquipSkin(skin.id);
                if (res.ok) {
                    try { navigator.vibrate?.(18); } catch (_) {}
                    this.onSkinChanged(skin.id);
                    this._renderItems();
                }
            });
            this.grid.appendChild(card);
        }
    }
}
