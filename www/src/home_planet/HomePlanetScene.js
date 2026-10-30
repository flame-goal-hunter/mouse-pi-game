// ============================================================================
// HomePlanetScene.js — Сцена Домашней Планеты (своей и в гостях):
// Склад сыра, Гардероб, Редактор Биома/Колец планеты и совместный бег онлайн
// ============================================================================

import { TouchControls } from '../space_hub/TouchControls.js';
import { HomePlanetRenderer, HOME_ZONES } from './HomePlanetRenderer.js';
import { HomeWardrobeModal } from './HomeWardrobeModal.js';
import { PlayerProfile } from '../core/PlayerProfile.js';
import { SpaceNetwork } from '../space_hub/SpaceNetwork.js';
import { normalizeAppearance } from '../space_hub/PersonalPlanetSystem.js';
import { BIOME_CATALOG, RING_CATALOG } from '../space_hub/PlanetStyleRenderer.js';
import { AutoUpdater } from '../core/AutoUpdater.js';

export class HomePlanetScene {
    constructor({ onTakeOff } = {}) {
        this.onTakeOff = onTakeOff || (() => {});
        this.running = false;
        this.renderer = new HomePlanetRenderer();
        this.state = {
            isVisiting: false, visitData: null, playerAngle: -0.25, facing: 1, moving: false,
            activeZone: null, launchProgress: 0, launching: false, unloading: false, unloadCooldown: 0, flyingCheese: []
        };
        this._buildDOM();
        this.controls = new TouchControls(this.overlay, () => this._handleZoneAction());
        this.wardrobe = new HomeWardrobeModal(this.overlay, () => this._updateHUD());
        this._resize();
        window.addEventListener('resize', () => this._resize());
    }

    _buildDOM() {
        const el = document.createElement('div');
        el.id = 'homePlanetOverlay';
        el.innerHTML = `
            <style>
                #homePlanetOverlay { position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 9995; overflow: hidden; display: none; font-family: 'Nunito', sans-serif; touch-action: none; user-select: none; }
                #homePlanetCanvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
                .hp-hud-bar { position: fixed; top: max(12px, env(safe-area-inset-top, 12px)); left: max(16px, env(safe-area-inset-left, 16px)); right: max(16px, env(safe-area-inset-right, 16px)); display: flex; align-items: center; justify-content: space-between; gap: 8px; z-index: 9996; pointer-events: none; flex-wrap: wrap; }
                .hp-pill { pointer-events: auto; background: rgba(15, 23, 42, 0.88); border: 2px solid #facc15; border-radius: 999px; padding: 7px 14px; color: #fef08a; font-weight: 900; font-size: clamp(11.5px, 2.4vw, 13.5px); box-shadow: 0 6px 18px rgba(0,0,0,0.5); }
                .hp-paint-btn { cursor: pointer; border-color: #f472b6; color: #fbcfe8; background: linear-gradient(135deg, #4c1d95, #1e1b4b); }
                .hp-zone-banner { position: fixed; bottom: max(22px, env(safe-area-inset-bottom, 22px)); left: 50%; transform: translate(-50%, 140%); background: rgba(15, 23, 42, 0.92); border: 2.5px solid #4ade80; border-radius: 20px; padding: 10px 20px; text-align: center; color: #fff; min-width: 240px; transition: transform 0.22s ease; z-index: 9996; pointer-events: none; }
                .hp-zone-banner.visible { transform: translate(-50%, 0%); }
                .hp-style-modal { position: fixed; inset: 0; z-index: 9998; background: rgba(8, 12, 28, 0.78); backdrop-filter: blur(6px); display: none; align-items: center; justify-content: center; padding: 14px; pointer-events: auto; }
                .hp-style-modal.visible { display: flex; }
                .hp-style-card { width: min(94vw, 440px); background: linear-gradient(180deg, #1e293b, #0f172a); border: 2.5px solid #f472b6; border-radius: 24px; padding: 16px 18px; color: #f8fafc; box-shadow: 0 20px 50px rgba(0,0,0,0.85); }
                .hp-style-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 8px 0 12px; }
                .hp-ring-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 8px; }
                .hp-opt-btn { padding: 9px 8px; border-radius: 12px; border: 2px solid rgba(148,163,184,0.35); background: rgba(15,23,42,0.85); color: #e2e8f0; font-family: 'Nunito', sans-serif; font-weight: 900; font-size: 12.5px; cursor: pointer; }
                .hp-opt-btn.active { border-color: #fde047; background: rgba(250, 204, 21, 0.18); color: #fef08a; }
            </style>
            <canvas id="homePlanetCanvas"></canvas>
            <div class="hp-hud-bar">
                <div class="hp-pill" id="hpTitlePill">🏠 МОЙ ДОМ</div>
                <div class="hp-pill" id="hpCheeseHud">🎒 0 🧀 · 🏛 0 🧀</div>
                <button type="button" class="hp-pill hp-paint-btn" id="hpQuickPaintBtn">🎨 Красить планету</button>
            </div>
            <div class="hp-zone-banner" id="hpZoneBanner">
                <div style="font-weight:900;font-size:16px;color:#fef08a;" id="hpBannerTitle"></div>
                <div style="font-weight:700;font-size:12px;color:#cbd5e1;margin-top:2px;" id="hpBannerSub"></div>
            </div>
            <div class="hp-style-modal" id="hpStyleModal">
                <div class="hp-style-card">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <span style="font-weight:900;font-size:17px;color:#fbcfe8;">🎨 Редактор Домашней Планеты</span>
                        <button type="button" id="hpCloseStyleBtn" style="background:none;border:none;color:#cbd5e1;font-size:20px;font-weight:900;cursor:pointer;">✕</button>
                    </div>
                    <div style="font-size:12px;font-weight:800;color:#93c5fd;">🌍 Выбери Биом поверхности:</div>
                    <div class="hp-style-grid" id="hpBiomeGrid"></div>
                    <div style="font-size:12px;font-weight:800;color:#93c5fd;">🪐 Выбери 3D-кольца или спутник:</div>
                    <div class="hp-ring-grid" id="hpRingGrid"></div>
                </div>
            </div>
        `;
        document.body.appendChild(el);
        Object.assign(this, { overlay: el, canvas: el.querySelector('#homePlanetCanvas'), titlePill: el.querySelector('#hpTitlePill'), hudEl: el.querySelector('#hpCheeseHud'), paintBtn: el.querySelector('#hpQuickPaintBtn'), banner: el.querySelector('#hpZoneBanner'), bannerTitle: el.querySelector('#hpBannerTitle'), bannerSub: el.querySelector('#hpBannerSub'), styleModal: el.querySelector('#hpStyleModal') });
        this.ctx = this.canvas.getContext('2d');
        this.paintBtn.addEventListener('click', () => this._openStyleEditor());
        el.querySelector('#hpCloseStyleBtn').addEventListener('click', () => this.styleModal.classList.remove('visible'));
        el.querySelector('.hp-hud-bar').appendChild(AutoUpdater.createReloadButton());
    }

    _resize() {
        this.dpr = Math.min(2, window.devicePixelRatio || 1);
        this.viewW = window.innerWidth; this.viewH = window.innerHeight;
        this.canvas.width = Math.round(this.viewW * this.dpr); this.canvas.height = Math.round(this.viewH * this.dpr);
    }

    _openStyleEditor() {
        if (this.state.isVisiting) return;
        const renderOpts = () => {
            const cur = normalizeAppearance(PlayerProfile.planetAppearance);
            const bGrid = this.overlay.querySelector('#hpBiomeGrid'), rGrid = this.overlay.querySelector('#hpRingGrid');
            bGrid.innerHTML = BIOME_CATALOG.map(b => `<button type="button" class="hp-opt-btn ${cur.biome === b.id ? 'active' : ''}" data-biome="${b.id}">${b.name}</button>`).join('');
            rGrid.innerHTML = RING_CATALOG.map(r => `<button type="button" class="hp-opt-btn ${cur.ringType === r.id ? 'active' : ''}" data-ring="${r.id}">${r.name}</button>`).join('');
            bGrid.querySelectorAll('[data-biome]').forEach(btn => btn.addEventListener('click', () => {
                PlayerProfile.setPlanetAppearance(normalizeAppearance({ ...cur, biome: btn.dataset.biome }));
                SpaceNetwork.broadcastNow(); renderOpts();
            }));
            rGrid.querySelectorAll('[data-ring]').forEach(btn => btn.addEventListener('click', () => {
                PlayerProfile.setPlanetAppearance(normalizeAppearance({ ...cur, ringType: btn.dataset.ring }));
                SpaceNetwork.broadcastNow(); renderOpts();
            }));
        };
        renderOpts();
        this.styleModal.classList.add('visible');
    }

    _updateHUD() {
        if (this.state.isVisiting && this.state.visitData) {
            const snap = this.state.visitData.homeSnapshot || {};
            this.titlePill.textContent = `🛸 Планета ${this.state.visitData.ownerNick}`;
            this.hudEl.textContent = `🧀 Склад хозяина: ${snap.storedCheese || 0}  |  👗 Скинов: ${(snap.unlockedSkins || ['blue']).length}`;
            this.paintBtn.style.display = 'none';
        } else {
            this.titlePill.textContent = `🏠 МОЙ ДОМ · Планета ${PlayerProfile.nickname}`;
            this.hudEl.textContent = `🎒 В кармане: ${PlayerProfile.pocketCheese} 🧀  |  🏛 Склад: ${PlayerProfile.storedCheese} 🧀`;
            this.paintBtn.style.display = 'inline-flex';
        }
    }

    start(visitData = null) {
        if (this.running) return;
        PlayerProfile._syncFromStorage();
        this.state.isVisiting = Boolean(visitData); this.state.visitData = visitData || null;
        PlayerProfile.setLocation(visitData ? `home:${visitData.ownerId}` : 'home');
        SpaceNetwork.broadcastNow();
        Object.assign(this.state, { playerAngle: -0.25, launchProgress: 0, launching: false, unloading: false, activeZone: null, flyingCheese: [] });
        this._updateHUD();
        this.overlay.style.display = 'block';
        this.running = true; this.lastTime = performance.now();
        const loop = (now) => {
            if (!this.running) return;
            const dt = Math.min(0.05, (now - this.lastTime) / 1000);
            this.lastTime = now;
            this._step(dt, now / 1000);
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    stop() { this.running = false; this.wardrobe.close(); this.styleModal.classList.remove('visible'); this.overlay.style.display = 'none'; }

    _handleZoneAction() {
        const z = this.state.activeZone;
        if (!z || this.state.launching) return;
        try { navigator.vibrate?.(18); } catch (_) {}
        if (z.id === 'storage') {
            if (this.state.isVisiting) this.bannerSub.textContent = `🧀 Игрок ${this.state.visitData.ownerNick} накопил ${this.state.visitData?.homeSnapshot?.storedCheese || 0} сыра!`;
            else if (PlayerProfile.pocketCheese > 0) this.state.unloading = true;
            else this.bannerSub.textContent = 'Собери Дикий Звёздный Сыр в космосе или мини-играх!';
        } else if (z.id === 'paint') this._openStyleEditor();
        else if (z.id === 'wardrobe') this.wardrobe.open(this.state.isVisiting ? this.state.visitData : null);
        else if (z.id === 'cosmodrome') this.state.launching = true;
    }

    _step(dt, timeSec) {
        const st = this.state;
        if (st.launching) {
            if ((st.launchProgress += dt * 1.15) >= 1) { const back = st.visitData; this.stop(); this.onTakeOff(back); return; }
        } else {
            const inp = this.controls.getInput();
            const spd = inp.turboHeld ? 1.55 : 1.05;
            st.moving = Math.abs(inp.moveX) > 0.05;
            if (st.moving) { st.facing = inp.moveX >= 0 ? 1 : -1; st.playerAngle = Math.max(-1.35, Math.min(1.35, st.playerAngle + inp.moveX * spd * dt)); }
        }

        SpaceNetwork.step(dt, { homeAngle: st.playerAngle, facing: st.facing, moving: st.moving });
        const targetOwnerId = st.isVisiting ? st.visitData?.ownerId : PlayerProfile.playerId;
        const peersOnPlanet = SpaceNetwork.getOnlinePeers().filter(p => (p.playerId === targetOwnerId && p.currentLocation === 'home') || p.currentLocation === `home:${targetOwnerId}`);
        if (st.isVisiting && st.visitData) {
            const liveOwner = SpaceNetwork.peers.get(targetOwnerId);
            if (liveOwner?.homeSnapshot) { st.visitData.homeSnapshot = liveOwner.homeSnapshot; if (liveOwner.homeSnapshot.planetAppearance) st.visitData.planetAppearance = liveOwner.homeSnapshot.planetAppearance; }
        }

        const nearest = HOME_ZONES.find(z => (!st.isVisiting || z.id !== 'paint') && Math.abs(st.playerAngle - z.angle) < 0.24) || null;
        if (nearest !== st.activeZone) {
            st.activeZone = nearest; st.unloading = false;
            if (nearest) {
                this.bannerTitle.textContent = nearest.name;
                this.bannerSub.textContent = st.isVisiting && nearest.id === 'storage' ? `Посмотреть Сырную Гору игрока ${st.visitData.ownerNick}` : nearest.hint;
                this.banner.classList.add('visible');
                this.controls.setDockMode(true, st.isVisiting && nearest.id === 'storage' ? 'ОСМОТРЕТЬ' : nearest.actionLabel, nearest.icon);
            } else { this.banner.classList.remove('visible'); this.controls.setDockMode(false); }
        }

        if (st.unloading && st.activeZone?.id === 'storage' && !st.isVisiting && (st.unloadCooldown -= dt) <= 0) {
            st.unloadCooldown = 0.09;
            if (PlayerProfile.depositOnePocketCheese()) { st.flyingCheese.push({ startAngle: st.playerAngle, t: 0 }); this._updateHUD(); SpaceNetwork.broadcastNow(); }
            else { st.unloading = false; this.bannerSub.textContent = '✅ Весь сыр выгружен на Склад!'; }
        }
        for (let i = st.flyingCheese.length - 1; i >= 0; i--) if ((st.flyingCheese[i].t += dt * 2.4) >= 1) st.flyingCheese.splice(i, 1);

        const ctx = this.ctx;
        ctx.save(); ctx.scale(this.dpr, this.dpr);
        this.renderer.draw(ctx, this.viewW, this.viewH, st, timeSec, peersOnPlanet);
        ctx.restore();
    }
}
