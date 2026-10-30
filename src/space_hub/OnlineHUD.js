// ============================================================================
// OnlineHUD.js — Полупрозрачная панель «Кто онлайн» сверху экрана Космоса:
// аватарка скина, ник, текущая локация и выбор путеводной стрелки на радаре
// ============================================================================

import { PlayerProfile, getPlayerSkinSprite } from '../core/PlayerProfile.js';
import { SpaceNetwork } from './SpaceNetwork.js';
import { SPACE_CONFIG } from './SpaceConfig.js';

const LOC_LABELS = {
    space: '🚀 В космосе',
    home: '🏠 Дома',
    transylvania: '🏰 Замок Теней',
    snowball: '❄️ Снежки',
    adventure: '🌋 3 Мира',
    newyear: '🎄 Лабиринт'
};

export class OnlineHUD {
    constructor(containerEl) {
        this.container = containerEl;
        this.trackedPlayerId = null;
        this.lastRenderAt = 0;
        this._buildDOM();
    }

    _buildDOM() {
        const bar = document.createElement('div');
        bar.className = 'sh-online-bar';
        bar.innerHTML = `
            <style>
                .sh-online-bar {
                    position: fixed; top: calc(max(12px, env(safe-area-inset-top, 12px)) + 44px);
                    left: max(16px, env(safe-area-inset-left, 16px)); right: max(16px, env(safe-area-inset-right, 16px));
                    display: flex; align-items: center; gap: 8px; overflow-x: auto;
                    padding: 4px 2px; z-index: 9994; pointer-events: auto;
                    scrollbar-width: none;
                }
                .sh-online-bar::-webkit-scrollbar { display: none; }
                .sh-peer-chip {
                    flex: 0 0 auto; display: flex; align-items: center; gap: 7px;
                    background: rgba(15, 23, 42, 0.82); backdrop-filter: blur(8px);
                    border: 1.8px solid rgba(148, 163, 184, 0.45); border-radius: 999px;
                    padding: 4px 11px 4px 6px; color: #f8fafc; font-size: 11.5px; font-weight: 800;
                    cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.4);
                    transition: transform 0.12s, border-color 0.15s, box-shadow 0.15s;
                }
                .sh-peer-chip:active { transform: scale(0.95); }
                .sh-peer-chip.tracked {
                    border-color: #22d3ee;
                    box-shadow: 0 0 16px rgba(34, 211, 238, 0.75);
                    background: rgba(8, 51, 68, 0.9);
                }
                .sh-peer-chip.self { border-color: #facc15; }
                .sh-peer-chip img {
                    width: 24px; height: 24px; border-radius: 50%;
                    background: rgba(30, 41, 59, 0.9); object-fit: contain;
                }
                .sh-peer-loc { color: #38bdf8; font-weight: 900; font-size: 10.5px; }
            </style>
        `;
        this.container.appendChild(bar);
        this.bar = bar;
    }

    _formatLoc(loc) {
        if (!loc) return LOC_LABELS.space;
        if (LOC_LABELS[loc]) return LOC_LABELS[loc];
        if (loc.startsWith('home:')) return '🛸 В гостях';
        return '🪐 ' + loc;
    }

    update() {
        const now = performance.now();
        if (now - this.lastRenderAt < 450) return;
        this.lastRenderAt = now;

        const peers = SpaceNetwork.getOnlinePeers();
        if (this.trackedPlayerId && !peers.some(p => p.playerId === this.trackedPlayerId)) {
            if (!SpaceNetwork.cachedHomes.has(this.trackedPlayerId)) this.trackedPlayerId = null;
        }

        const mySkin = getPlayerSkinSprite(PlayerProfile.equippedSkinId);
        const dot = SpaceNetwork.connected ? '🟢' : '🟡';
        let html = `
            <div class="sh-peer-chip self" id="shEditNickBtn" title="Нажми, чтобы изменить свой ник">
                <img src="${mySkin.svgUrl}" alt="">
                <span>${dot} ${PlayerProfile.nickname} ✏️</span>
                <span class="sh-peer-loc">Онлайн: ${peers.length + 1}</span>
            </div>
        `;

        for (const p of peers) {
            const spr = getPlayerSkinSprite(p.equippedSkinId);
            const isTracked = this.trackedPlayerId === p.playerId;
            html += `
                <div class="sh-peer-chip${isTracked ? ' tracked' : ''}" data-peer-id="${p.playerId}" title="Нажми, чтобы включить радар к игроку">
                    <img src="${spr.svgUrl}" alt="">
                    <span>${p.nickname || 'Пи'}</span>
                    <span class="sh-peer-loc">${this._formatLoc(p.currentLocation)}</span>
                    ${isTracked ? '<span style="color:#fde047;">🧭</span>' : ''}
                </div>
            `;
        }

        this.bar.innerHTML = this.bar.querySelector('style').outerHTML + html;

        this.bar.querySelector('#shEditNickBtn')?.addEventListener('click', () => {
            const next = prompt('Введи никнейм для своего Мышонка Пи:', PlayerProfile.nickname);
            if (next && next.trim()) {
                PlayerProfile.setNickname(next.trim());
                SpaceNetwork.broadcastNow();
                this.lastRenderAt = 0;
                this.update();
            }
        });

        this.bar.querySelectorAll('[data-peer-id]').forEach(el => {
            el.addEventListener('click', () => {
                const pid = el.getAttribute('data-peer-id');
                this.trackedPlayerId = (this.trackedPlayerId === pid) ? null : pid;
                try { navigator.vibrate?.(12); } catch (_) {}
                this.lastRenderAt = 0;
                this.update();
            });
        });
    }

    getTrackedTarget() {
        if (!this.trackedPlayerId) return null;
        const p = SpaceNetwork.peers.get(this.trackedPlayerId);
        if (p) {
            if (p.currentLocation === 'space') {
                return { x: p.rx, y: p.ry, label: p.nickname, color: '#22d3ee', badge: '🚀' };
            }
            if (p.currentLocation === 'home') {
                const pos = SpaceNetwork.getFriendPlanetPos(p.playerId);
                return { x: pos.x, y: pos.y, label: `Дом ${p.nickname}`, color: '#4ade80', badge: '🏠' };
            }
            const pl = SPACE_CONFIG.planets.find(x => x.id === p.currentLocation);
            if (pl) return { x: pl.x, y: pl.y, label: `${p.nickname} (${pl.name})`, color: '#facc15', badge: '🎮' };
        }
        const cached = SpaceNetwork.cachedHomes.get(this.trackedPlayerId);
        if (cached) return { x: cached.homeX, y: cached.homeY, label: `Дом ${cached.nickname}`, color: '#a78bfa', badge: '🏠' };
        return null;
    }
}
