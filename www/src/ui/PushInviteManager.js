// ============================================================================
// PushInviteManager.js — Вызов друга в игру в 1 клик («📲 ПОЗВАТЬ В ИГРУ!»),
// подписка на Web Push («🔔 Включить вызовы») и плашка рации (до 150 строк)
// ============================================================================

import { PlayerProfile } from '../core/PlayerProfile.js';
import { SpaceNetwork } from '../space_hub/SpaceNetwork.js';
import { SpaceAudio } from '../core/SpaceAudio.js';

function urlBase64ToUint8Array(base64String) {
    const pad = '='.repeat((4 - (base64String.length % 4)) % 4);
    const b64 = (base64String + pad).replace(/-/g, '+').replace(/_/g, '/');
    const raw = window.atob(b64), out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
}

class PushInviteService {
    constructor() {
        Object.assign(this, { cooldowns: new Map(), bellButtons: new Set(), settingsButtons: new Set() });
        this._injectUI();
        SpaceNetwork.onInviteEvent = (ev) => this.showIncomingBanner(ev.fromNickname || 'Друг Пи');
        if (this.isGranted()) setTimeout(() => this._syncSubscriptionQuietly(), 1200);
        setInterval(() => this._tickCooldowns(), 500);
    }

    _injectUI() {
        if (typeof document === 'undefined') return;
        const wrap = document.createElement('div');
        wrap.innerHTML = `
            <style>
                .pim-bell-btn { pointer-events: auto; background: linear-gradient(135deg, #f59e0b, #d97706); border: 2px solid #fef08a; border-radius: 999px; padding: 7px 13px; color: #fff; font-family: 'Nunito', sans-serif; font-weight: 900; font-size: clamp(11px, 2.2vw, 13px); cursor: pointer; box-shadow: 0 6px 16px rgba(245,158,11,0.45); display: inline-flex; align-items: center; gap: 5px; }
                .pim-invite-btn { pointer-events: auto; margin-top: 8px; background: linear-gradient(135deg, #ec4899, #8b5cf6); border: 2.5px solid #fbcfe8; border-radius: 999px; padding: 9px 18px; color: #fff; font-family: 'Nunito', sans-serif; font-weight: 900; font-size: 13.5px; cursor: pointer; box-shadow: 0 6px 18px rgba(236,72,153,0.5); display: inline-flex; align-items: center; gap: 6px; transition: transform 0.14s ease, opacity 0.2s; }
                .pim-invite-btn:active { transform: scale(0.95); }
                .pim-invite-btn:disabled { opacity: 0.65; cursor: not-allowed; background: #475569; border-color: #94a3b8; box-shadow: none; }
                .pim-toast { position: fixed; top: max(64px, env(safe-area-inset-top, 64px)); left: 50%; transform: translate(-50%, -160%); background: rgba(15, 23, 42, 0.95); border: 2.5px solid #38bdf8; border-radius: 999px; padding: 10px 22px; color: #fef08a; font-family: 'Nunito', sans-serif; font-weight: 900; font-size: 14.5px; z-index: 10020; pointer-events: none; box-shadow: 0 10px 28px rgba(0,0,0,0.65); transition: transform 0.26s cubic-bezier(0.22, 1, 0.36, 1); white-space: nowrap; }
                .pim-toast.visible { transform: translate(-50%, 0); }
                .pim-radio-banner { position: fixed; top: max(14px, env(safe-area-inset-top, 14px)); left: 50%; transform: translate(-50%, -180%); background: linear-gradient(135deg, #0284c7, #4f46e5); border: 3px solid #fde047; border-radius: 20px; padding: 12px 22px; color: #fff; font-family: 'Nunito', sans-serif; font-weight: 900; font-size: clamp(13.5px, 2.8vw, 16px); z-index: 10025; box-shadow: 0 14px 34px rgba(0,0,0,0.75); transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1); text-align: center; pointer-events: auto; cursor: pointer; }
                .pim-radio-banner.visible { transform: translate(-50%, 0); }
            </style>
            <div class="pim-toast" id="pimToast"></div>
            <div class="pim-radio-banner" id="pimRadioBanner"></div>`;
        document.body.appendChild(wrap);
        this.toastEl = wrap.querySelector('#pimToast');
        this.radioEl = wrap.querySelector('#pimRadioBanner');
        this.radioEl.addEventListener('click', () => this.radioEl.classList.remove('visible'));
    }

    showToast(text) {
        if (!this.toastEl) return;
        this.toastEl.textContent = text;
        this.toastEl.classList.add('visible');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => this.toastEl.classList.remove('visible'), 3200);
    }

    showIncomingBanner(fromNickname) {
        if (!this.radioEl) return;
        SpaceAudio.playRadioCall();
        try { navigator.vibrate?.([180, 80, 180]); } catch (_) {}
        this.radioEl.textContent = `🚀 ${fromNickname} ждет тебя у твоей планеты!`;
        this.radioEl.classList.add('visible');
        clearTimeout(this._radioTimer);
        this._radioTimer = setTimeout(() => this.radioEl.classList.remove('visible'), 6500);
    }

    isGranted() { return typeof Notification !== 'undefined' && Notification.permission === 'granted'; }

    createBellButton() {
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'pim-bell-btn'; btn.textContent = '🔔 Включить вызовы';
        btn.addEventListener('click', () => this.enablePush());
        this.bellButtons.add(btn); this._refreshButtons();
        return btn;
    }

    bindSettingsButton(btn) {
        if (!btn) return;
        this.settingsButtons.add(btn);
        btn.addEventListener('click', () => this.enablePush());
        this._refreshButtons();
    }

    _refreshButtons() {
        const granted = this.isGranted();
        for (const b of this.bellButtons) b.style.display = granted ? 'none' : 'inline-flex';
        for (const s of this.settingsButtons) {
            s.textContent = granted ? '🔔 Вызовы в игру: ВКЛЮЧЕНЫ ✅' : '🔔 Включить вызовы на телефон';
            s.style.borderColor = granted ? '#4ade80' : '#facc15';
        }
    }

    async enablePush() {
        if (typeof Notification === 'undefined' || !('serviceWorker' in navigator)) {
            this.showToast('На этом устройстве Web Push недоступен 📴'); return false;
        }
        try {
            const perm = await Notification.requestPermission();
            this._refreshButtons();
            if (perm !== 'granted') { this.showToast('Разреши уведомления в браузере 🔔'); return false; }
            const ok = await this._syncSubscriptionQuietly();
            this.showToast(ok ? 'Вызовы на телефон включены! 🔔✅' : 'Уведомления разрешены! 🔔');
            return ok;
        } catch (_) { this.showToast('Не удалось подключить пуши 🔔'); return false; }
    }

    async _syncSubscriptionQuietly() {
        try {
            const reg = await navigator.serviceWorker.ready;
            const { publicKey } = await (await fetch('/api/push/vapidPublicKey')).json();
            if (!publicKey) return false;
            const sub = (await reg.pushManager.getSubscription()) ||
                await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
            await fetch('/api/push/subscribe', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerId: PlayerProfile.playerId, nickname: PlayerProfile.nickname, skinId: PlayerProfile.equippedSkinId, subscription: sub })
            });
            return true;
        } catch (_) { return false; }
    }

    async sendInvite(toId, targetNick, btnEl = null) {
        if (!toId || Date.now() < (this.cooldowns.get(toId) || 0)) return;
        this.cooldowns.set(toId, Date.now() + 15000);
        if (btnEl) btnEl.dataset.inviteTargetId = toId;
        this._tickCooldowns();
        SpaceAudio.playHorn();
        try { navigator.vibrate?.(35); } catch (_) {}
        this.showToast(`Вызов отправлен ${targetNick || 'другу'}! 📡`);
        try {
            await fetch('/api/invite', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fromId: PlayerProfile.playerId, fromNickname: PlayerProfile.nickname, toId })
            });
        } catch (_) {}
    }

    _tickCooldowns() {
        if (typeof document === 'undefined') return;
        const now = Date.now();
        document.querySelectorAll('[data-invite-target-id]').forEach(btn => {
            const rem = Math.ceil(((this.cooldowns.get(btn.dataset.inviteTargetId) || 0) - now) / 1000);
            btn.disabled = rem > 0;
            btn.textContent = rem > 0 ? `📡 Отправлено (${rem}с)` : '📲 ПОЗВАТЬ В ИГРУ!';
        });
    }
}

export const PushInviteManager = new PushInviteService();
