// ============================================================================
// AutoUpdater.js — Авто-детектор обновлений при входе и разворачивании PWA
// + ручная кнопка принудительного сброса кэша 🔄 рядом с номером версии
// ============================================================================

const VERSION_STORAGE_KEY = 'mousie_app_version';

class AutoUpdaterService {
    constructor() {
        this.currentLabel = 'v1.05';
        this.currentVersion = '';
        this.updating = false;
        this.badges = new Set();
        this._buildToast();
        this.checkForUpdates(true);

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') this.checkForUpdates(false);
        });
        window.addEventListener('focus', () => this.checkForUpdates(false));
    }

    _buildToast() {
        const el = document.createElement('div');
        el.id = 'mpiUpdateToast';
        el.innerHTML = `
            <style>
                #mpiUpdateToast {
                    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.9);
                    background: linear-gradient(135deg, #1e1b4b, #0f172a);
                    border: 2.5px solid #38bdf8; border-radius: 22px;
                    padding: 16px 26px; color: #f8fafc; font-family: 'Nunito', sans-serif;
                    font-weight: 900; font-size: 16px; text-align: center;
                    box-shadow: 0 20px 50px rgba(0,0,0,0.8), 0 0 30px rgba(56,189,248,0.45);
                    z-index: 99999; opacity: 0; pointer-events: none;
                    transition: opacity 0.2s ease, transform 0.2s ease;
                }
                #mpiUpdateToast.show { opacity: 1; transform: translate(-50%, -50%) scale(1); }
                .mpi-reload-chip {
                    pointer-events: auto; display: inline-flex; align-items: center; gap: 5px;
                    background: rgba(15, 23, 42, 0.72); backdrop-filter: blur(6px);
                    border: 1.5px solid rgba(148, 163, 184, 0.45); border-radius: 999px;
                    padding: 5px 11px; color: #cbd5e1; font-family: 'Nunito', sans-serif;
                    font-weight: 800; font-size: 11.5px; cursor: pointer;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.4); transition: transform 0.12s, border-color 0.15s;
                }
                .mpi-reload-chip:active { transform: scale(0.92); border-color: #38bdf8; color: #fff; }
            </style>
            <div id="mpiToastText">Прилетело обновление галактики! 🚀</div>
        `;
        document.body.appendChild(el);
        this.toast = el;
        this.toastText = el.querySelector('#mpiToastText');
    }

    createReloadButton() {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mpi-reload-chip';
        btn.title = 'Сбросить кэш и загрузить свежую версию с сервера';
        btn.textContent = `🔄 ${this.currentLabel}`;
        btn.addEventListener('click', () => this.forceHardReload('🔄 Сброс кэша и перезагрузка...', this.currentVersion || Date.now()));
        this.badges.add(btn);
        return btn;
    }

    _updateBadges() {
        for (const b of this.badges) {
            b.textContent = `🔄 ${this.currentLabel}`;
        }
    }

    async checkForUpdates(isInitialBoot = false) {
        if (this.updating) return;
        try {
            const res = await fetch(`version.json?nocache=${Date.now()}`, {
                cache: 'no-store',
                headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' }
            });
            if (!res.ok) return;
            const data = await res.json();
            if (!data || !data.version) return;

            this.currentVersion = String(data.version);
            this.currentLabel = data.label || data.shortLabel || 'v1.05';
            this._updateBadges();

            const saved = localStorage.getItem(VERSION_STORAGE_KEY);
            if (!saved) {
                localStorage.setItem(VERSION_STORAGE_KEY, this.currentVersion);
                return;
            }
            if (saved !== this.currentVersion) {
                localStorage.setItem(VERSION_STORAGE_KEY, this.currentVersion);
                await this.forceHardReload('Прилетело обновление галактики! 🚀', this.currentVersion);
            } else if (isInitialBoot && 'serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistration().then(r => r?.update()).catch(() => {});
            }
        } catch (_) {}
    }

    async forceHardReload(message = 'Прилетело обновление галактики! 🚀', newVer = Date.now()) {
        if (this.updating) return;
        this.updating = true;
        try { navigator.vibrate?.(20); } catch (_) {}
        if (this.toast && this.toastText) {
            this.toastText.textContent = message;
            this.toast.classList.add('show');
        }
        try {
            if (window.caches && caches.keys) {
                const keys = await caches.keys();
                await Promise.all(keys.map(k => caches.delete(k)));
            }
        } catch (_) {}
        try {
            if ('serviceWorker' in navigator) {
                const regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all(regs.map(r => r.unregister()));
            }
        } catch (_) {}
        setTimeout(() => {
            window.location.replace(`${window.location.pathname}?v=${encodeURIComponent(newVer)}`);
        }, 1000);
    }
}

export const AutoUpdater = new AutoUpdaterService();
if (typeof window !== 'undefined') window.AutoUpdater = AutoUpdater;

