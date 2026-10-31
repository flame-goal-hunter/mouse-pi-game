// ============================================================================
// SpaceHubScene.js — Единая точка входа Мышонка Пи (Космос):
// старт у своего Дома, Пояс Домашних Планет, кнопка настроек ⚙️ (никнейм и звук)
// ============================================================================

import { SPACE_CONFIG } from './SpaceConfig.js';
import { SpaceBackground } from './SpaceBackground.js';
import { PlanetRenderer } from './PlanetRenderer.js';
import { RocketController } from './RocketController.js';
import { TouchControls } from './TouchControls.js';
import { SpaceEnvironment } from './SpaceEnvironment.js';
import { SpaceRadar } from './SpaceRadar.js';
import { SpaceNetwork } from './SpaceNetwork.js';
import { OnlineHUD } from './OnlineHUD.js';
import { RemoteSpaceRenderer } from './RemoteSpaceRenderer.js';
import { SpaceFun } from './SpaceFun.js';
import { HomePlanetScene } from '../home_planet/HomePlanetScene.js';
import { PlayerProfile, getPlayerSkinSprite } from '../core/PlayerProfile.js';
import { SpaceAudio } from '../core/SpaceAudio.js';
import { AutoUpdater } from '../core/AutoUpdater.js';
import { PushInviteManager } from '../ui/PushInviteManager.js';
import { SpaceNetDebug } from './SpaceNetDebug.js';

export class SpaceHubScene {
    constructor({ onSelectPlanet } = {}) {
        this.onSelectPlanet = onSelectPlanet || (() => {});
        Object.assign(this, { running: false, activePlanet: null, dockingPlanet: null, lastOrbitPlanet: null, hasSpawnedOnce: false, lastTime: 0 });
        this._buildDOM();
        this.bg = new SpaceBackground();
        this.env = new SpaceEnvironment();
        this.planets = new PlanetRenderer();
        this.remoteRenderer = new RemoteSpaceRenderer();
        this.rocket = new RocketController();
        this.fun = new SpaceFun(this.rocket, this.env);
        this.radar = new SpaceRadar();
        this.onlineHud = new OnlineHUD(this.overlay);
        this.controls = new TouchControls(this.overlay, () => this._handleLandTap(), () => this.fun.firePaint());
        this.homeScene = new HomePlanetScene({
            onTakeOff: (visited) => { this._placeRocketOnOrbit(visited || this.remoteRenderer.getMyHomePlanet()); this.start(); }
        });
        this._resize();
        window.addEventListener('resize', () => this._resize());
    }

    _placeRocketOnOrbit(planet) {
        if (!planet) return;
        const sx = planet.x, sy = planet.y - ((planet.radius || 75) + 75);
        Object.assign(this.rocket, { x: sx, y: sy, vx: 0, vy: -90, angle: -Math.PI / 2, camX: sx, camY: sy, camZoom: 1 });
    }

    _buildDOM() {
        const el = document.createElement('div');
        el.id = 'spaceHubOverlay';
        el.innerHTML = `
            <style>
                #spaceHubOverlay { position: fixed; inset: 0; width: 100vw; height: 100vh; height: 100dvh; z-index: 9990; overflow: hidden; display: none; touch-action: none; user-select: none; -webkit-user-select: none; font-family: 'Nunito', sans-serif; }
                #spaceHubCanvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
                .sh-top-bar { position: fixed; top: max(10px, env(safe-area-inset-top, 10px)); left: max(14px, env(safe-area-inset-left, 14px)); right: max(14px, env(safe-area-inset-right, 14px)); display: flex; align-items: center; justify-content: space-between; gap: 8px; z-index: 9994; pointer-events: none; }
                .sh-title-pill, .sh-gear-btn { pointer-events: auto; background: rgba(15, 23, 42, 0.88); border: 2px solid rgba(125, 211, 252, 0.55); border-radius: 999px; padding: 7px 14px; color: #f8fafc; font-weight: 900; font-size: clamp(11.5px, 2.4vw, 13.5px); display: flex; align-items: center; gap: 7px; box-shadow: 0 6px 18px rgba(0,0,0,0.5); }
                .sh-gear-btn { border-color: #facc15; color: #fef08a; cursor: pointer; font-size: 18px; padding: 7px 13px; background: linear-gradient(180deg, #312e81, #1e1b4b); }
                .sh-right-tools { display: flex; align-items: center; gap: 8px; pointer-events: auto; }
                .sh-planet-banner { position: fixed; bottom: max(22px, env(safe-area-inset-bottom, 22px)); left: 50%; transform: translate(-50%, calc(100% + 48px)); opacity: 0; pointer-events: none; background: rgba(15, 23, 42, 0.92); border: 2.5px solid #4ade80; border-radius: 20px; padding: 10px 20px; text-align: center; color: #fff; min-width: 250px; max-width: min(440px, 56vw); box-shadow: 0 10px 28px rgba(0,0,0,0.65); transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease; z-index: 9993; }
                .sh-planet-banner.visible { transform: translate(-50%, 0%); opacity: 1; pointer-events: auto; }
                .sh-now-playing { display: flex; align-items: center; justify-content: center; gap: 6px; flex-wrap: wrap; margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(148, 163, 184, 0.28); font-size: 11.5px; color: #4ade80; font-weight: 800; }
                .sh-np-badge { display: inline-flex; align-items: center; gap: 4px; background: rgba(30, 41, 59, 0.9); padding: 2px 8px 2px 4px; border-radius: 999px; color: #f8fafc; border: 1px solid #4ade80; }
                .sh-np-badge img { width: 18px; height: 18px; border-radius: 50%; object-fit: contain; }
                .sh-settings-modal { position: fixed; inset: 0; z-index: 9998; background: rgba(8, 12, 28, 0.82); backdrop-filter: blur(8px); display: none; align-items: center; justify-content: center; padding: 14px; pointer-events: auto; }
                .sh-settings-modal.visible { display: flex; }
                .sh-settings-card { width: min(92vw, 370px); background: linear-gradient(180deg, #1e293b, #0f172a); border: 2.5px solid #38bdf8; border-radius: 24px; padding: 18px; color: #f8fafc; box-shadow: 0 20px 50px rgba(0,0,0,0.8); display: flex; flex-direction: column; gap: 12px; }
                .sh-set-btn { min-height: 44px; border-radius: 14px; border: 2px solid rgba(255,255,255,0.22); font-family: 'Nunito', sans-serif; font-weight: 900; font-size: 14.5px; color: #fff; cursor: pointer; padding: 8px 14px; }
            </style>
            <canvas id="spaceHubCanvas"></canvas>
            <div class="sh-top-bar">
                <div class="sh-title-pill">🚀 Космос Пи · <span id="shCheeseCounter" style="color:#fde047;">🧀 0</span></div>
                <div class="sh-right-tools" id="shRightTools"><button type="button" class="sh-gear-btn" id="shSettingsBtn" title="Настройки">⚙️</button></div>
            </div>
            <div class="sh-planet-banner" id="shPlanetBanner">
                <div style="font-weight:900;font-size:16px;color:#fef08a;" id="shBannerTitle"></div>
                <div style="font-weight:700;font-size:12px;color:#cbd5e1;margin-top:3px;" id="shBannerSub"></div>
                <div id="shBannerPlayers"></div>
            </div>
            <div class="sh-settings-modal" id="shSettingsModal">
                <div class="sh-settings-card">
                    <div style="display:flex;justify-content:space-between;align-items:center;"><span style="font-weight:900;font-size:18px;color:#fef08a;">⚙️ Настройки пилота</span><button type="button" id="shCloseSetBtn" style="background:none;border:none;color:#94a3b8;font-size:20px;font-weight:900;cursor:pointer;">✕</button></div>
                    <label style="font-size:12.5px;font-weight:800;color:#93c5fd;">👤 Твой космический никнейм:</label>
                    <input id="shNickInput" type="text" maxlength="16" style="padding:10px 12px;border-radius:12px;border:2px solid #38bdf8;background:#0f172a;color:#fff;font-family:'Nunito',sans-serif;font-weight:900;font-size:15px;">
                    <button type="button" class="sh-set-btn" id="shSoundToggleBtn" style="background:linear-gradient(180deg,#334155,#1e293b);">🔊 Звук и музыка: ВКЛ</button>
                    <button type="button" class="sh-set-btn" id="shPushToggleBtn" style="background:linear-gradient(180deg,#334155,#1e293b);">🔔 Включить вызовы на телефон</button>
                    <button type="button" class="sh-set-btn" id="shSaveSetBtn" style="background:linear-gradient(180deg,#22c55e,#15803d);border-color:#86efac;">✅ Сохранить</button>
                </div>
            </div>
        `;
        document.body.appendChild(el);
        Object.assign(this, { overlay: el, canvas: el.querySelector('#spaceHubCanvas'), banner: el.querySelector('#shPlanetBanner'), bannerTitle: el.querySelector('#shBannerTitle'), bannerSub: el.querySelector('#shBannerSub'), bannerPlayers: el.querySelector('#shBannerPlayers'), cheeseCounter: el.querySelector('#shCheeseCounter') });
        this.ctx = this.canvas.getContext('2d');
        const rightTools = el.querySelector('#shRightTools');
        rightTools.prepend(AutoUpdater.createReloadButton());
        rightTools.prepend(PushInviteManager.createBellButton());
        PushInviteManager.bindSettingsButton(el.querySelector('#shPushToggleBtn'));
        SpaceNetDebug.mountUI(el);
        this._wireSettings(el);
    }

    _wireSettings(el) {
        const modal = el.querySelector('#shSettingsModal'), nickIn = el.querySelector('#shNickInput'), sndBtn = el.querySelector('#shSoundToggleBtn');
        const syncSnd = () => { sndBtn.textContent = localStorage.getItem('mousie_muted') === '1' ? '🔇 Звук и музыка: ВЫКЛ' : '🔊 Звук и музыка: ВКЛ'; };
        el.querySelector('#shSettingsBtn').addEventListener('click', () => { nickIn.value = PlayerProfile.nickname; syncSnd(); modal.classList.add('visible'); });
        el.querySelector('#shCloseSetBtn').addEventListener('click', () => modal.classList.remove('visible'));
        sndBtn.addEventListener('click', () => { const next = localStorage.getItem('mousie_muted') === '1' ? '0' : '1'; SpaceAudio.setMuted(next === '1'); window.__applyGlobalMute?.(next === '1'); syncSnd(); });
        el.querySelector('#shSaveSetBtn').addEventListener('click', () => { if (nickIn.value.trim()) { PlayerProfile.setNickname(nickIn.value.trim()); SpaceNetwork.broadcastNow(); } modal.classList.remove('visible'); });
    }

    _updateCheeseHUD() { this.cheeseCounter.textContent = `🧀 Багажник: ${PlayerProfile.pocketCheese} (Склад: ${PlayerProfile.storedCheese})`; }
    _resize() {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const rect = this.canvas?.getBoundingClientRect?.();
        const w = Math.max(1, Math.round(rect?.width || window.innerWidth || 800));
        const h = Math.max(1, Math.round(rect?.height || window.innerHeight || 480));
        if (w !== this.viewW || h !== this.viewH || dpr !== this.dpr) {
            this.dpr = dpr; this.viewW = w; this.viewH = h;
            this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
        }
    }

    _handleLandTap() {
        if (!this.activePlanet || this.dockingPlanet) return;
        if (this.activePlanet.locked) { this.planets.triggerSquash(this.activePlanet.id); this.bannerSub.textContent = '🔒 Секретная планета откроется совсем скоро!'; return; }
        this.dockingPlanet = this.activePlanet;
        try { navigator.vibrate?.(25); } catch (_) {}
        this.rocket.startPlanetZoom(this.dockingPlanet);
    }

    start() {
        if (this.running) return;
        PlayerProfile._syncFromStorage();
        if (!this.hasSpawnedOnce) { this.hasSpawnedOnce = true; this._placeRocketOnOrbit(this.remoteRenderer.getMyHomePlanet()); }
        else if (this.lastOrbitPlanet) { this._placeRocketOnOrbit(this.lastOrbitPlanet); this.lastOrbitPlanet = null; }
        PlayerProfile.setLocation('space'); SpaceNetwork.broadcastNow(); this._updateCheeseHUD();
        const ss = document.getElementById('startScreen'); if (ss) { ss.classList.remove('visible'); ss.style.display = 'none'; }
        this.overlay.style.display = 'block';
        this._resize();
        this.dockingPlanet = null; this.rocket.zoomTargetPlanet = null; this.rocket.camZoom = 1;
        SpaceAudio.setMode('space');
        this.running = true; this.lastTime = performance.now();
        SpaceNetDebug.activeRAFLoopsCount++;
        const loop = (now) => {
            if (!this.running) { SpaceNetDebug.activeRAFLoopsCount = Math.max(0, SpaceNetDebug.activeRAFLoopsCount - 1); return; }
            const dt = Math.min(0.05, (now - this.lastTime) / 1000);
            this.lastTime = now;
            this._step(dt, now / 1000, now);
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    stop() { this.running = false; SpaceAudio.setMode('off'); this.overlay.style.display = 'none'; }

    _renderBannerExtras(planet) {
        if (!planet || planet.isMyHome) { this.bannerPlayers.dataset.friendId = ''; this.bannerPlayers.innerHTML = ''; return; }
        if (planet.isFriendHome) {
            if (this.bannerPlayers.dataset.friendId === planet.ownerId) return;
            this.bannerPlayers.dataset.friendId = planet.ownerId;
            const spr = getPlayerSkinSprite(planet.ownerSkinId);
            this.bannerPlayers.innerHTML = `
                <div class="sh-now-playing" style="color:#22d3ee;"><span>🛸 Владелец:</span><span class="sh-np-badge" style="border-color:#22d3ee;"><img src="${spr.svgUrl}" alt="">${planet.ownerNick}</span></div>
                <div style="display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;margin-top:6px;">
                    <button type="button" class="pim-invite-btn" id="shBannerVisitBtn" style="margin-top:0;background:linear-gradient(135deg,#06b6d4,#0284c7);border-color:#a5f3fc;">🏠 В ГОСТИ!</button>
                    <button type="button" class="pim-invite-btn" id="shBannerInviteBtn" data-invite-target-id="${planet.ownerId}" style="margin-top:0;">📲 ПОЗВАТЬ В ИГРУ!</button>
                </div>`;
            this.bannerPlayers.querySelector('#shBannerVisitBtn')?.addEventListener('click', () => this._handleLandTap());
            const invBtn = this.bannerPlayers.querySelector('#shBannerInviteBtn');
            invBtn?.addEventListener('click', () => PushInviteManager.sendInvite(planet.ownerId, planet.ownerNick, invBtn));
            PushInviteManager._tickCooldowns();
            return;
        }
        this.bannerPlayers.dataset.friendId = '';
        const playing = SpaceNetwork.getOnlinePeers().filter(p => p.currentLocation === planet.id);
        if (!playing.length) { this.bannerPlayers.innerHTML = ''; return; }
        const chips = playing.map(p => `<span class="sh-np-badge"><img src="${getPlayerSkinSprite(p.equippedSkinId).svgUrl}" alt="">${p.nickname || 'Пи'}</span>`).join('');
        this.bannerPlayers.innerHTML = `<div class="sh-now-playing"><span>🎮 Сейчас тут играют:</span>${chips}</div>`;
    }

    _step(dt, timeSec, rawNow = performance.now()) {
        SpaceNetDebug.onFrameStep(dt, rawNow);
        this._resize();
        const inp = this.controls.getInput();
        const zoomDone = this.rocket.update(dt, inp);
        SpaceAudio.updateEngine(Math.hypot(this.rocket.vx, this.rocket.vy), SPACE_CONFIG.rocket.maxSpeed, inp.turboHeld);
        this.env.update(dt, this.rocket, () => this._updateCheeseHUD());
        this.fun.update(dt, inp.turboHeld);
        const prevRx = this.rocket.x, prevRy = this.rocket.y;
        SpaceNetwork.step(dt, {
            x: this.rocket.x, y: this.rocket.y, vx: this.rocket.vx, vy: this.rocket.vy, angle: this.rocket.angle,
            isThrusting: this.rocket.isThrusting, isTurbo: this.rocket.isTurbo,
            trailStyle: this.rocket.trailStyle || 'stars', paintColor: this.rocket.paintColor, paintTimer: this.rocket.paintTimer
        });
        SpaceNetDebug.checkMyRocketOverride(prevRx, prevRy, this.rocket.x, this.rocket.y, 'SpaceNetwork.step');
        this.onlineHud.update();

        if (zoomDone && this.dockingPlanet) {
            const target = this.dockingPlanet;
            this.dockingPlanet = null; this.rocket.zoomTargetPlanet = null; this.rocket.camZoom = 1;
            if (target.isMyHome) { this.stop(); this.homeScene.start(null); }
            else if (target.isFriendHome) { this.stop(); this.homeScene.start(target); }
            else { this.lastOrbitPlanet = target; PlayerProfile.setLocation(target.id); SpaceNetwork.broadcastNow(); this.onSelectPlanet(target.id); }
            return;
        }

        const allPlanets = [...SPACE_CONFIG.planets, ...this.remoteRenderer.getPersonalPlanets()];
        const nearest = allPlanets.find(p => Math.hypot(this.rocket.x - p.x, this.rocket.y - p.y) <= p.dockRadius) || null;
        if (nearest?.id !== this.activePlanet?.id) {
            this.activePlanet = nearest;
            if (nearest) {
                if (!nearest.isFriendHome && !nearest.isMyHome) this.planets.triggerSquash(nearest.id);
                try { navigator.vibrate?.(15); } catch (_) {}
                this.bannerTitle.textContent = `${nearest.badge} · ${nearest.name}`;
                this.bannerSub.textContent = nearest.subtitle;
                this._renderBannerExtras(nearest);
                this.banner.style.borderColor = nearest.isFriendHome ? '#22d3ee' : '#4ade80';
                this.banner.classList.add('visible');
                const icon = nearest.isMyHome ? '🏠' : (nearest.isFriendHome ? '🛸' : '🪐');
                this.controls.setDockMode(!nearest.locked, nearest.actionLabel || 'СЕСТЬ!', icon, nearest.actionTheme || 'green');
            } else { this.banner.classList.remove('visible'); this.controls.setDockMode(false); }
        } else if (nearest) this._renderBannerExtras(nearest);

        this.planets.update(dt, this.activePlanet?.id || null);
        const ctx = this.ctx, shk = this.fun.shakeTime > 0 ? (Math.random() - 0.5) * 14 : 0;
        ctx.save(); ctx.scale(this.dpr, this.dpr);
        this.bg.draw(ctx, this.rocket.camX, this.rocket.camY, this.viewW, this.viewH, timeSec);
        ctx.save();
        ctx.translate(this.viewW / 2 + shk, this.viewH / 2 - shk);
        ctx.scale(this.rocket.camZoom, this.rocket.camZoom);
        ctx.translate(-this.rocket.camX, -this.rocket.camY);
        this.env.draw(ctx, timeSec); this.fun.drawWorld(ctx); this.planets.draw(ctx, timeSec);
        this.remoteRenderer.draw(ctx, timeSec, this.activePlanet?.id || null);
        this.rocket.draw(ctx);
        SpaceNetDebug.drawWorldOverlay(ctx, SpaceNetwork.getOnlinePeers(), this.fun.ball);
        ctx.restore();
        this.fun.drawScreenBanner(ctx, this.viewW, this.viewH);
        this.radar.draw(ctx, this.rocket.camX, this.rocket.camY, this.viewW, this.viewH, timeSec, this.onlineHud.getTrackedTarget());
        ctx.restore();
    }
}
