// ============================================================================
// SpaceHubScene.js — Главная сцена Интерактивного Космоса Мышонка Пи:
// мультиплеер без VPN, панель Кто Онлайн, чужие ракеты/дома и индикация игр
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
import { HomePlanetScene } from '../home_planet/HomePlanetScene.js';
import { PlayerProfile, getPlayerSkinSprite } from '../core/PlayerProfile.js';
import { AutoUpdater } from '../core/AutoUpdater.js';

export class SpaceHubScene {
    constructor({ onSelectPlanet, onToggleMenu } = {}) {
        this.onSelectPlanet = onSelectPlanet || (() => {});
        this.onToggleMenu = onToggleMenu || (() => {});
        this.running = false;
        this.activePlanet = null;
        this.dockingPlanet = null;
        this.lastTime = 0;
        this._buildDOM();
        this.bg = new SpaceBackground();
        this.env = new SpaceEnvironment();
        this.planets = new PlanetRenderer();
        this.remoteRenderer = new RemoteSpaceRenderer();
        this.rocket = new RocketController();
        this.radar = new SpaceRadar();
        this.onlineHud = new OnlineHUD(this.overlay);
        this.controls = new TouchControls(this.overlay, () => this._handleLandTap());
        this.homeScene = new HomePlanetScene({
            onTakeOff: (visited) => {
                Object.assign(this.rocket, { x: visited ? visited.x : 0, y: visited ? visited.y - 140 : -155, vx: 0, vy: -140, angle: -Math.PI / 2 });
                this.start();
            }
        });
        this._resize();
        window.addEventListener('resize', () => this._resize());
    }

    _buildDOM() {
        const el = document.createElement('div');
        el.id = 'spaceHubOverlay';
        el.innerHTML = `
            <style>
                #spaceHubOverlay { position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 9990; overflow: hidden; display: none; touch-action: none; user-select: none; -webkit-user-select: none; font-family: 'Nunito', sans-serif; }
                #spaceHubCanvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
                .sh-top-bar { position: fixed; top: max(12px, env(safe-area-inset-top, 12px)); left: max(16px, env(safe-area-inset-left, 16px)); right: max(16px, env(safe-area-inset-right, 16px)); display: flex; align-items: center; justify-content: space-between; gap: 8px; z-index: 9994; pointer-events: none; flex-wrap: wrap; }
                .sh-title-pill, .sh-toggle-btn { pointer-events: auto; background: rgba(15, 23, 42, 0.86); border: 2px solid rgba(125, 211, 252, 0.55); border-radius: 999px; padding: 7px 14px; color: #f8fafc; font-weight: 900; font-size: clamp(11.5px, 2.4vw, 13.5px); display: flex; align-items: center; gap: 7px; box-shadow: 0 6px 18px rgba(0,0,0,0.5); }
                .sh-toggle-btn { border-color: #facc15; color: #fef08a; cursor: pointer; background: linear-gradient(180deg, #312e81, #1e1b4b); }
                .sh-planet-banner { position: fixed; bottom: max(22px, env(safe-area-inset-bottom, 22px)); left: 50%; transform: translate(-50%, 130%); background: rgba(15, 23, 42, 0.92); border: 2.5px solid #4ade80; border-radius: 20px; padding: 10px 20px; text-align: center; color: #fff; min-width: 250px; max-width: min(440px, 56vw); box-shadow: 0 10px 28px rgba(0,0,0,0.65); transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1); z-index: 9993; pointer-events: none; }
                .sh-planet-banner.visible { transform: translate(-50%, 0%); }
                .sh-now-playing { display: flex; align-items: center; justify-content: center; gap: 6px; flex-wrap: wrap; margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(148, 163, 184, 0.28); font-size: 11.5px; color: #4ade80; font-weight: 800; }
                .sh-np-badge { display: inline-flex; align-items: center; gap: 4px; background: rgba(30, 41, 59, 0.9); padding: 2px 8px 2px 4px; border-radius: 999px; color: #f8fafc; border: 1px solid #4ade80; }
                .sh-np-badge img { width: 18px; height: 18px; border-radius: 50%; object-fit: contain; }
            </style>
            <canvas id="spaceHubCanvas"></canvas>
            <div class="sh-top-bar">
                <div class="sh-title-pill">🚀 Космос Пи · <span id="shCheeseCounter" style="color:#fde047;">🧀 0</span></div>
                <button type="button" class="sh-toggle-btn" id="shMenuSwitchBtn">🏰 Классическое меню ⇄</button>
            </div>
            <div class="sh-planet-banner" id="shPlanetBanner">
                <div style="font-weight:900;font-size:16px;color:#fef08a;" id="shBannerTitle"></div>
                <div style="font-weight:700;font-size:12px;color:#cbd5e1;margin-top:3px;" id="shBannerSub"></div>
                <div id="shBannerPlayers"></div>
            </div>
        `;
        document.body.appendChild(el);
        this.overlay = el;
        this.canvas = el.querySelector('#spaceHubCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.banner = el.querySelector('#shPlanetBanner');
        this.bannerTitle = el.querySelector('#shBannerTitle');
        this.bannerSub = el.querySelector('#shBannerSub');
        this.bannerPlayers = el.querySelector('#shBannerPlayers');
        this.cheeseCounter = el.querySelector('#shCheeseCounter');
        el.querySelector('.sh-top-bar').appendChild(AutoUpdater.createReloadButton());
        el.querySelector('#shMenuSwitchBtn').addEventListener('click', () => this.onToggleMenu('classic'));
    }
    _updateCheeseHUD() {
        this.cheeseCounter.textContent = `🧀 Багажник: ${PlayerProfile.pocketCheese} (Склад: ${PlayerProfile.storedCheese})`;
    }
    _resize() {
        this.dpr = Math.min(2, window.devicePixelRatio || 1);
        this.viewW = window.innerWidth; this.viewH = window.innerHeight;
        this.canvas.width = Math.round(this.viewW * this.dpr);
        this.canvas.height = Math.round(this.viewH * this.dpr);
    }

    _handleLandTap() {
        if (!this.activePlanet || this.dockingPlanet) return;
        if (this.activePlanet.locked) {
            this.planets.triggerSquash(this.activePlanet.id);
            this.bannerSub.textContent = '🔒 Секретная планета откроется совсем скоро!';
            return;
        }
        this.dockingPlanet = this.activePlanet;
        try { navigator.vibrate?.(25); } catch (_) {}
        this.rocket.startPlanetZoom(this.dockingPlanet);
    }

    start() {
        if (this.running) return;
        PlayerProfile._syncFromStorage();
        PlayerProfile.setLocation('space');
        SpaceNetwork.broadcastNow();
        this._updateCheeseHUD();
        const ss = document.getElementById('startScreen');
        if (ss) { ss.classList.remove('visible'); ss.style.display = 'none'; }
        this.overlay.style.display = 'block';
        this.dockingPlanet = null;
        this.rocket.zoomTargetPlanet = null;
        this.rocket.camZoom = 1;
        this.running = true;
        this.lastTime = performance.now();
        const loop = (now) => {
            if (!this.running) return;
            const dt = Math.min(0.05, (now - this.lastTime) / 1000);
            this.lastTime = now;
            this._step(dt, now / 1000);
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    stop() {
        this.running = false; this.overlay.style.display = 'none';
        const ss = document.getElementById('startScreen'); if (ss) ss.style.display = '';
    }

    _renderBannerPlayers(planet) {
        if (!planet || planet.isHomePlanet || planet.isFriendHome) { this.bannerPlayers.innerHTML = ''; return; }
        const playing = SpaceNetwork.getOnlinePeers().filter(p => p.currentLocation === planet.id);
        if (!playing.length) { this.bannerPlayers.innerHTML = ''; return; }
        const chips = playing.map(p => `<span class="sh-np-badge"><img src="${getPlayerSkinSprite(p.equippedSkinId).svgUrl}" alt="">${p.nickname || 'Пи'}</span>`).join('');
        this.bannerPlayers.innerHTML = `<div class="sh-now-playing"><span>🎮 Сейчас тут играют:</span>${chips}</div>`;
    }

    _step(dt, timeSec) {
        const zoomDone = this.rocket.update(dt, this.controls.getInput());
        this.env.update(dt, this.rocket, () => this._updateCheeseHUD());
        SpaceNetwork.step(dt, { x: this.rocket.x, y: this.rocket.y, vx: this.rocket.vx, vy: this.rocket.vy, angle: this.rocket.angle });
        this.onlineHud.update();

        if (zoomDone && this.dockingPlanet) {
            const target = this.dockingPlanet;
            this.dockingPlanet = null;
            this.rocket.zoomTargetPlanet = null;
            this.rocket.camZoom = 1;
            if (target.isHomePlanet) { this.stop(); this.homeScene.start(null); }
            else if (target.isFriendHome) { this.stop(); this.homeScene.start(target); }
            else {
                PlayerProfile.setLocation(target.id);
                SpaceNetwork.broadcastNow();
                this.onSelectPlanet(target.id);
            }
            return;
        }

        const allPlanets = [...SPACE_CONFIG.planets, ...this.remoteRenderer.getFriendPlanets()];
        const nearest = allPlanets.find(p => Math.hypot(this.rocket.x - p.x, this.rocket.y - p.y) <= p.dockRadius) || null;
        if (nearest?.id !== this.activePlanet?.id) {
            this.activePlanet = nearest;
            if (nearest) {
                if (!nearest.isFriendHome) this.planets.triggerSquash(nearest.id);
                try { navigator.vibrate?.(15); } catch (_) {}
                this.bannerTitle.textContent = `${nearest.badge} ${nearest.name}`;
                this.bannerSub.textContent = nearest.subtitle;
                this._renderBannerPlayers(nearest);
                this.banner.classList.add('visible');
                const icon = nearest.isHomePlanet ? '🏠' : (nearest.isFriendHome ? '🛸' : '🪐');
                this.controls.setDockMode(!nearest.locked, nearest.actionLabel || 'СЕСТЬ!', icon);
            } else {
                this.banner.classList.remove('visible');
                this.controls.setDockMode(false);
            }
        } else if (nearest) this._renderBannerPlayers(nearest);

        this.planets.update(dt, this.activePlanet?.id || null);
        const ctx = this.ctx;
        ctx.save(); ctx.scale(this.dpr, this.dpr);
        this.bg.draw(ctx, this.rocket.camX, this.rocket.camY, this.viewW, this.viewH, timeSec);
        ctx.save();
        ctx.translate(this.viewW / 2, this.viewH / 2);
        ctx.scale(this.rocket.camZoom, this.rocket.camZoom);
        ctx.translate(-this.rocket.camX, -this.rocket.camY);
        this.env.draw(ctx, timeSec); this.planets.draw(ctx, timeSec);
        this.remoteRenderer.draw(ctx, timeSec, this.activePlanet?.id || null);
        this.rocket.draw(ctx);
        ctx.restore();
        this.radar.draw(ctx, this.rocket.camX, this.rocket.camY, this.viewW, this.viewH, timeSec, this.onlineHud.getTrackedTarget());
        ctx.restore();
    }
}
