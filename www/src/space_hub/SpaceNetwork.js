// ============================================================================
// SpaceNetwork.js — Сетевой модуль Космоса и Домашних планет
// Работает через наш сервер Yandex Cloud (/space-ws WebSocket + /api/space-sync)
// ============================================================================

import { PlayerProfile } from '../core/PlayerProfile.js';
import { getPersonalPlanetCoords } from './PersonalPlanetSystem.js';

const FRIENDS_CACHE_KEY = 'mousiePi.friendsHomes.v1';

class SpaceNetworkManager {
    constructor() {
        this.peers = new Map();
        this.cachedHomes = new Map();
        this.ws = null;
        this.connected = false;
        this.lastSendAt = 0;
        this.lastHttpSyncAt = 0;
        this.httpSyncInFlight = false;
        this.localMotion = { x: 0, y: 165, vx: 0, vy: 0, angle: -Math.PI / 2, homeAngle: 0, facing: 1, moving: false };
        this._loadCachedHomes();
        this._initLocalChannel();
        this._connect();
    }

    _loadCachedHomes() {
        try {
            const raw = JSON.parse(localStorage.getItem(FRIENDS_CACHE_KEY) || '[]');
            raw.forEach(item => { if (item?.playerId && item.playerId !== PlayerProfile.playerId) this.cachedHomes.set(item.playerId, item); });
        } catch (_) {}
    }

    _saveCachedHome(pkt) {
        if (!pkt?.playerId || pkt.playerId === PlayerProfile.playerId || !pkt.homeSnapshot) return;
        const pos = this.getFriendPlanetPos(pkt.playerId);
        this.cachedHomes.set(pkt.playerId, {
            playerId: pkt.playerId, nickname: pkt.nickname || 'Друг Пи',
            equippedSkinId: pkt.equippedSkinId || 'blue', homeSnapshot: pkt.homeSnapshot,
            homeX: pos.x, homeY: pos.y, updatedAt: Date.now()
        });
        try {
            const list = Array.from(this.cachedHomes.values()).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 10);
            localStorage.setItem(FRIENDS_CACHE_KEY, JSON.stringify(list));
        } catch (_) {}
    }

    getFriendPlanetPos(playerId) {
        return getPersonalPlanetCoords(playerId);
    }

    _initLocalChannel() {
        try {
            this.bc = new BroadcastChannel('mousie_pi_space_v1');
            this.bc.onmessage = (e) => { if (e.data) this._onPacket(e.data); };
        } catch (_) {}
    }

    _getWsUrl() {
        if (typeof window === 'undefined' || !window.location?.host) return 'ws://localhost:8080/space-ws';
        const proto = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
        return `${proto}${window.location.host}/space-ws`;
    }

    _connect() {
        if (typeof WebSocket === 'undefined') return;
        try {
            const ws = new WebSocket(this._getWsUrl());
            this.ws = ws;
            ws.onopen = () => {
                this.connected = true;
                this.broadcastNow();
            };
            ws.onmessage = (ev) => {
                try {
                    const pkt = JSON.parse(ev.data);
                    this._onPacket(pkt);
                } catch (_) {}
            };
            ws.onerror = () => {};
            ws.onclose = () => {
                this.connected = false;
                setTimeout(() => this._connect(), 2500);
            };
        } catch (_) {
            setTimeout(() => this._connect(), 3500);
        }
    }

    _buildPacket() {
        const m = this.localMotion;
        return {
            playerId: PlayerProfile.playerId, nickname: PlayerProfile.nickname,
            equippedSkinId: PlayerProfile.equippedSkinId, currentLocation: PlayerProfile.currentLocation,
            x: Math.round(m.x), y: Math.round(m.y), vx: Math.round(m.vx), vy: Math.round(m.vy),
            angle: Number(m.angle.toFixed(2)), homeAngle: Number((m.homeAngle || 0).toFixed(3)),
            facing: m.facing || 1, moving: Boolean(m.moving),
            homeSnapshot: PlayerProfile.getHomeSnapshot(), ts: Date.now()
        };
    }

    broadcastNow() {
        const pkt = this._buildPacket();
        try { this.bc?.postMessage(pkt); } catch (_) {}
        if (this.connected && this.ws?.readyState === 1) {
            try { this.ws.send(JSON.stringify(pkt)); } catch (_) {}
        }
    }

    async _syncHttpFallback() {
        if (this.httpSyncInFlight || typeof fetch === 'undefined') return;
        this.httpSyncInFlight = true;
        try {
            const res = await fetch('/api/space-sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this._buildPacket())
            });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data?.peers)) data.peers.forEach(p => this._onPacket(p));
            }
        } catch (_) {} finally {
            this.httpSyncInFlight = false;
        }
    }

    _onPacket(pkt) {
        if (!pkt?.playerId || pkt.playerId === PlayerProfile.playerId) return;
        const peer = this.peers.get(pkt.playerId) || {
            playerId: pkt.playerId, rx: pkt.x || 0, ry: pkt.y || 0,
            rAngle: pkt.angle || 0, rHomeAngle: pkt.homeAngle || 0, lastPktTs: 0
        };
        if (peer.lastPktTs && pkt.ts && pkt.ts < peer.lastPktTs) return;
        peer.lastPktTs = pkt.ts || peer.lastPktTs;
        if (Math.hypot((pkt.x || 0) - peer.rx, (pkt.y || 0) - peer.ry) > 600) {
            peer.rx = pkt.x || 0; peer.ry = pkt.y || 0;
        }
        Object.assign(peer, pkt, { lastSeen: Date.now() });
        this.peers.set(pkt.playerId, peer);
        this._saveCachedHome(pkt);
    }

    step(dt, motionPatch) {
        if (motionPatch) Object.assign(this.localMotion, motionPatch);
        const now = performance.now();
        if (now - this.lastSendAt > 50) {
            this.lastSendAt = now;
            this.broadcastNow();
        }
        if (!this.connected && now - this.lastHttpSyncAt > 250) {
            this.lastHttpSyncAt = now;
            this._syncHttpFallback();
        }
        const nowWall = Date.now();
        for (const [id, p] of this.peers) {
            if (nowWall - p.lastSeen > 16000) { this.peers.delete(id); continue; }
            if (nowWall - p.lastSeen < 350) {
                p.x += (p.vx || 0) * dt; p.y += (p.vy || 0) * dt;
            }
            const k = Math.min(1, dt * 12);
            p.rx += (p.x - p.rx) * k; p.ry += (p.y - p.ry) * k;
            let da = (p.angle || 0) - p.rAngle;
            while (da > Math.PI) da -= Math.PI * 2;
            while (da < -Math.PI) da += Math.PI * 2;
            p.rAngle += da * Math.min(1, dt * 14);
            p.rHomeAngle += ((p.homeAngle || 0) - p.rHomeAngle) * k;
        }
    }

    getOnlinePeers() { return Array.from(this.peers.values()); }
}

export const SpaceNetwork = new SpaceNetworkManager();
if (typeof window !== 'undefined') window.SpaceNetwork = SpaceNetwork;
