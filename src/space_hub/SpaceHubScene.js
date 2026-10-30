// ============================================================================
// SpaceHubScene.js — Главная сцена Космического Хаба, стыковка и тугл меню
// ============================================================================

import { SPACE_CONFIG } from './SpaceConfig.js';
import { TouchControls } from './TouchControls.js';
import { RocketController } from './RocketController.js';
import { SpaceBackground } from './SpaceBackground.js';
import { PlanetRenderer } from './PlanetRenderer.js';

export class SpaceHubScene {
    constructor(options = {}) {
        this.onSelectPlanet = options.onSelectPlanet || (() => {});
        this.onToggleMenu = options.onToggleMenu || (() => {});
        this.activePlanet = null;
        this.dockingPlanet = null;
        this.running = false;
        this.lastTime = 0;

        this._mountUi();
        this.bg = new SpaceBackground();
        this.planets = new PlanetRenderer();
        this.rocket = new RocketController();
        this.controls = new TouchControls(this.overlay, () => this._handleLandTap());
        this._resize();
        window.addEventListener('resize', () => this._resize());
    }

    _mountUi() {
        const el = document.createElement('div');
        el.id = 'spaceHubOverlay';
        el.innerHTML = `
            <style>
                #spaceHubOverlay {
                    position: fixed; inset: 0; width: 100vw; height: 100dvh;
                    background: #050614; z-index: 9985; overflow: hidden;
                    touch-action: none; user-select: none; -webkit-user-select: none;
                    font-family: 'Comfortaa', 'Nunito', sans-serif;
                }
                #spaceHubCanvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
                .sh-top-bar {
                    position: fixed; top: max(12px, env(safe-area-inset-top, 12px));
                    left: max(16px, env(safe-area-inset-left, 16px)); right: max(16px, env(safe-area-inset-right, 16px));
                    display: flex; align-items: center; justify-content: space-between; z-index: 9994; pointer-events: none;
                }
                .sh-title-pill, .sh-toggle-btn {
                    pointer-events: auto; background: rgba(15, 23, 42, 0.86);
                    border: 2px solid rgba(125, 211, 252, 0.55); border-radius: 999px;
                    padding: 7px 15px; color: #f8fafc; font-weight: 900; font-size: clamp(12px, 2.5vw, 14px);
                    display: flex; align-items: center; gap: 8px; box-shadow: 0 6px 18px rgba(0,0,0,0.5);
                }
                .sh-toggle-btn { border-color: #facc15; color: #fef08a; cursor: pointer; background: linear-gradient(180deg, #312e81, #1e1b4b); }
                .sh-toggle-btn:active { transform: scale(0.95); }
                .sh-planet-banner {
                    position: fixed; bottom: max(22px, env(safe-area-inset-bottom, 22px)); left: 50%; transform: translate(-50%, 130%);
                    background: rgba(15, 23, 42, 0.92); border: 2.5px solid #4ade80; border-radius: 20px; padding: 10px 20px;
                    text-align: center; color: #fff; min-width: 240px; max-width: min(420px, 52vw);
                    box-shadow: 0 10px 28px rgba(0,0,0,0.65); transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
                    z-index: 9993; pointer-events: none;
                }
                .sh-planet-banner.visible { transform: translate(-50%, 0%); }
            </style>
            <canvas id="spaceHubCanvas"></canvas>
            <div class="sh-top-bar">
                <div class="sh-title-pill">🚀 Космос Мышонка Пи</div>
                <button type="button" class="sh-toggle-btn" id="shMenuSwitchBtn">🏰 Классическое меню ⇄</button>
            </div>
            <div class="sh-planet-banner" id="shPlanetBanner">
                <div style="font-weight:900;font-size:16px;color:#fef08a;" id="shBannerTitle"></div>
                <div style="font-weight:700;font-size:12px;color:#cbd5e1;margin-top:3px;" id="shBannerSub"></div>
            </div>
        `;
        document.body.appendChild(el);
        this.overlay = el;
        this.canvas = el.querySelector('#spaceHubCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.banner = el.querySelector('#shPlanetBanner');
        this.bannerTitle = el.querySelector('#shBannerTitle');
        this.bannerSub = el.querySelector('#shBannerSub');
        el.querySelector('#shMenuSwitchBtn').addEventListener('click', () => this.onToggleMenu('classic'));
    }

    _resize() {
        this.dpr = Math.min(2, window.devicePixelRatio || 1);
        this.viewW = window.innerWidth;
        this.viewH = window.innerHeight;
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
        if (this.activePlanet.id === 'home_base') {
            this.planets.triggerSquash('home_base');
            this.bannerSub.textContent = '🧀 Лети по пунктирным линиям к любой планете-игре!';
            return;
        }
        this.dockingPlanet = this.activePlanet;
        try { navigator.vibrate?.(25); } catch (_) {}
        this.rocket.startPlanetZoom(this.dockingPlanet);
    }

    start() {
        if (this.running) return;
        document.getElementById('startScreen')?.classList.remove('visible');
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
        this.running = false;
        this.overlay.style.display = 'none';
    }

    _step(dt, timeSec) {
        const zoomDone = this.rocket.update(dt, this.controls.getInput());
        if (zoomDone && this.dockingPlanet) {
            const targetId = this.dockingPlanet.id;
            this.dockingPlanet = null;
            this.rocket.zoomTargetPlanet = null;
            this.rocket.camZoom = 1;
            this.onSelectPlanet(targetId);
            return;
        }

        const nearest = SPACE_CONFIG.planets.find(p => Math.hypot(this.rocket.x - p.x, this.rocket.y - p.y) <= p.dockRadius) || null;
        if (nearest !== this.activePlanet) {
            this.activePlanet = nearest;
            if (nearest) {
                this.planets.triggerSquash(nearest.id);
                try { navigator.vibrate?.(15); } catch (_) {}
                this.bannerTitle.textContent = `${nearest.badge} ${nearest.name}`;
                this.bannerSub.textContent = nearest.subtitle;
                this.banner.classList.add('visible');
                this.controls.setDockMode(!nearest.locked && nearest.id !== 'home_base');
            } else {
                this.banner.classList.remove('visible');
                this.controls.setDockMode(false);
            }
        }

        this.planets.update(dt, this.activePlanet?.id || null);
        const ctx = this.ctx;
        ctx.save();
        ctx.scale(this.dpr, this.dpr);
        this.bg.draw(ctx, this.rocket.camX, this.rocket.camY, this.viewW, this.viewH, timeSec);
        ctx.translate(this.viewW / 2, this.viewH / 2);
        ctx.scale(this.rocket.camZoom, this.rocket.camZoom);
        ctx.translate(-this.rocket.camX, -this.rocket.camY);
        this.planets.draw(ctx, timeSec);
        this.rocket.draw(ctx);
        ctx.restore();
    }
}
