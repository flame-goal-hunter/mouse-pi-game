// ============================================================================
// SpaceColyseusClient.js — Чистый клиент сети Космоса на официальном colyseus.js
// Подключение к комнате 'space_hub', живой activityStatus и троттлинг 20 Hz (50 мс)
// ============================================================================

import * as ColyseusMod from '../../lib/colyseus.esm.js';
import { PlayerProfile } from '../core/PlayerProfile.js';
import { getPersonalPlanetCoords } from './PersonalPlanetSystem.js';
import { SpaceSmoothRender } from './SpaceSmoothRender.js';

const Colyseus = ColyseusMod.default || ColyseusMod;
const FRIENDS_CACHE_KEY = 'mousiePi.friendsHomes.v1';

export class SpaceColyseusClient {
    constructor() {
        Object.assign(this, {
            peers: new Map(), cachedHomes: new Map(), smoother: new SpaceSmoothRender(),
            client: null, room: null, connected: false, connecting: false,
            lastSendAt: 0, lastStatusSent: '', onFunEvent: null, onFxEvent: null,
            onServerImpulse: null, onInviteEvent: null, pushSubscription: null,
            localMotion: { x: 0, y: 165, vx: 0, vy: 0, angle: -Math.PI / 2, isThrusting: false, isTurbo: false, homeAngle: 0, facing: 1, moving: false }
        });
        this._loadCachedHomes();
        this._fetchServerHomes();
        this._connect();
    }

    _loadCachedHomes() {
        try {
            const raw = JSON.parse(localStorage.getItem(FRIENDS_CACHE_KEY) || '[]');
            raw.forEach(item => { if (item?.playerId && item.playerId !== PlayerProfile.playerId) this.cachedHomes.set(item.playerId, item); });
        } catch (_) {}
    }

    async _fetchServerHomes() {
        if (typeof fetch === 'undefined') return;
        try {
            const res = await fetch('/api/space-homes');
            if (res.ok) { const data = await res.json(); if (Array.isArray(data?.homes)) data.homes.forEach(h => this._saveCachedHome(h)); }
        } catch (_) {}
    }

    _saveCachedHome(pkt) {
        if (!pkt?.playerId || pkt.playerId === PlayerProfile.playerId || !pkt.homeSnapshot) return;
        const pos = this.getFriendPlanetPos(pkt.playerId);
        this.cachedHomes.set(pkt.playerId, {
            playerId: pkt.playerId, nickname: pkt.nickname || 'Друг Пи',
            equippedSkinId: pkt.equippedSkinId || pkt.skinId || 'blue', homeSnapshot: pkt.homeSnapshot,
            homeX: pos.x, homeY: pos.y, updatedAt: Date.now()
        });
        try {
            const list = Array.from(this.cachedHomes.values()).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12);
            localStorage.setItem(FRIENDS_CACHE_KEY, JSON.stringify(list));
        } catch (_) {}
    }

    getFriendPlanetPos(playerId) { return getPersonalPlanetCoords(playerId); }

    _getEndpoint() {
        if (typeof window === 'undefined' || !window.location?.host) return 'ws://localhost:8080';
        const proto = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
        return `${proto}${window.location.host}`;
    }

    async _connect() {
        if (this.connecting || this.connected || !Colyseus?.Client) return;
        this.connecting = true;
        try {
            this.client = new Colyseus.Client(this._getEndpoint());
            const snap = PlayerProfile.getHomeSnapshot();
            this.room = await this.client.joinOrCreate('space_hub', {
                playerId: PlayerProfile.playerId, nickname: PlayerProfile.nickname,
                skinId: PlayerProfile.equippedSkinId, activityStatus: PlayerProfile.currentLocation || 'space',
                storedCheese: PlayerProfile.storedCheese,
                planetBiome: snap.planetAppearance?.biome || 'cheese', planetRing: snap.planetAppearance?.ringType || 'none',
                homeSnapshot: snap, x: Math.round(this.localMotion.x), y: Math.round(this.localMotion.y)
            });
            this.connected = true; this.connecting = false;
            this._wireRoom();
            this.broadcastNow();
        } catch (_) {
            this.connected = false; this.connecting = false;
            setTimeout(() => this._connect(), 2500);
        }
    }

    _wireRoom() {
        const room = this.room;
        if (!room) return;
        room.onStateChange((state) => {
            this.smoother.onColyseusState(state, room.sessionId, this.peers, (pkt) => this._saveCachedHome(pkt));
        });
        room.onMessage('saved_homes', (homes) => {
            if (Array.isArray(homes)) homes.forEach(h => this._saveCachedHome(h));
        });
        room.onMessage('bumper_impulse', (imp) => {
            if (imp && this.onServerImpulse) this.onServerImpulse(imp);
        });
        room.onMessage('fx_event', (ev) => {
            if (!ev) return;
            if (ev.type === 'invite') {
                if (ev.toId === PlayerProfile.playerId && this.onInviteEvent) this.onInviteEvent(ev);
                return;
            }
            if (ev.type === 'horn' && ev.playerId && ev.playerId !== PlayerProfile.playerId) {
                this.peers.get(ev.playerId)?.triggerHorn(ev.emoji);
            }
            if (this.onFxEvent) this.onFxEvent(ev);
        });
        room.onLeave(() => {
            this.connected = false; this.room = null;
            setTimeout(() => this._connect(), 2000);
        });
    }

    broadcastNow() {
        if (!this.connected || !this.room) return;
        const snap = PlayerProfile.getHomeSnapshot();
        try {
            this.room.send('status', {
                nickname: PlayerProfile.nickname, skinId: PlayerProfile.equippedSkinId,
                activityStatus: PlayerProfile.currentLocation || 'space', storedCheese: PlayerProfile.storedCheese,
                planetBiome: snap.planetAppearance?.biome || 'cheese', planetRing: snap.planetAppearance?.ringType || 'none',
                homeSnapshot: snap, pushSubscription: this.pushSubscription || null
            });
        } catch (_) {}
    }

    shootPaint(shot) {
        if (!this.connected || !this.room) return;
        try { this.room.send('shoot_paint', shot); } catch (_) {}
    }

    step(dt, motionPatch) {
        if (motionPatch) Object.assign(this.localMotion, motionPatch);
        const now = performance.now();
        // Строгий троттлинг отправки движения: ровно 20 раз в секунду (каждые 50 мс)
        if (this.connected && this.room && now - this.lastSendAt >= 50) {
            this.lastSendAt = now;
            const m = this.localMotion;
            try {
                this.room.send('move', {
                    x: Math.round(m.x), y: Math.round(m.y), vx: Math.round(m.vx), vy: Math.round(m.vy),
                    angle: Number(m.angle.toFixed(3)), isThrusting: Boolean(m.isThrusting), isTurbo: Boolean(m.isTurbo),
                    homeAngle: Number((m.homeAngle || 0).toFixed(3)), facing: m.facing || 1, moving: Boolean(m.moving)
                });
            } catch (_) {}
            const curStatus = `${PlayerProfile.currentLocation}|${PlayerProfile.equippedSkinId}|${PlayerProfile.nickname}|${PlayerProfile.storedCheese}`;
            if (curStatus !== this.lastStatusSent) { this.lastStatusSent = curStatus; this.broadcastNow(); }
        }
        this.smoother.update60Fps(dt, this.peers);
    }

    getOnlinePeers() { return Array.from(this.peers.values()); }
}

export const SpaceNetwork = new SpaceColyseusClient();
if (typeof window !== 'undefined') window.SpaceNetwork = SpaceNetwork;
