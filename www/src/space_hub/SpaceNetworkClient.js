// ============================================================================
// SpaceNetworkClient.js — Единый WebSocket-клиент Космоса (ws(s):// + host)
// Отправка input_state (25-30 Гц), прием world_snapshot, server_impulse и fx_event
// ============================================================================

import { PlayerProfile } from '../core/PlayerProfile.js';
import { getPersonalPlanetCoords } from './PersonalPlanetSystem.js';
import { RemotePlayerEntity } from './RemotePlayerEntity.js';
import { WorldInterpolator } from './WorldInterpolator.js';

const FRIENDS_CACHE_KEY = 'mousiePi.friendsHomes.v1';

export class SpaceNetworkClient {
    constructor() {
        Object.assign(this, {
            peers: new Map(), cachedHomes: new Map(), interpolator: new WorldInterpolator(),
            ws: null, connected: false, lastSendAt: 0, lastHttpSyncAt: 0, httpSyncInFlight: false,
            onFunEvent: null, onFxEvent: null, onServerImpulse: null, onInviteEvent: null,
            localServerState: null, pushSubscription: null,
            localMotion: { x: 0, y: 165, vx: 0, vy: 0, angle: -Math.PI / 2, isThrusting: false, isTurbo: false, trailStyle: 'stars', paintColor: null, paintTimer: 0, homeAngle: 0, facing: 1, moving: false }
        });
        this._loadCachedHomes();
        this._fetchServerHomes();
        this._initLocalChannel();
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

    _initLocalChannel() {
        try {
            this.bc = new BroadcastChannel('mousie_pi_space_v1');
            this.bc.onmessage = (e) => { if (e.data) this._onMessage(e.data); };
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
            ws.onopen = () => { this.connected = true; this.broadcastNow(); };
            ws.onmessage = (ev) => { try { this._onMessage(JSON.parse(ev.data)); } catch (_) {} };
            ws.onerror = () => {};
            ws.onclose = () => { this.connected = false; setTimeout(() => this._connect(), 2000); };
        } catch (_) { setTimeout(() => this._connect(), 3000); }
    }

    _buildPacket() {
        const m = this.localMotion;
        return {
            type: 'input_state', playerId: PlayerProfile.playerId, nickname: PlayerProfile.nickname,
            skinId: PlayerProfile.equippedSkinId, equippedSkinId: PlayerProfile.equippedSkinId, currentLocation: PlayerProfile.currentLocation,
            x: Math.round(m.x), y: Math.round(m.y), vx: Math.round(m.vx), vy: Math.round(m.vy),
            angle: Number(m.angle.toFixed(2)), isThrusting: Boolean(m.isThrusting), isTurbo: Boolean(m.isTurbo),
            trailStyle: m.trailStyle || 'stars', paintColor: m.paintColor || null, paintTimer: Number((m.paintTimer || 0).toFixed(2)),
            homeAngle: Number((m.homeAngle || 0).toFixed(3)), facing: m.facing || 1, moving: Boolean(m.moving),
            homeSnapshot: PlayerProfile.getHomeSnapshot(), pushSubscription: this.pushSubscription || null, ts: Date.now()
        };
    }

    _sendRaw(obj) {
        try { this.bc?.postMessage(obj); } catch (_) {}
        if (this.connected && this.ws?.readyState === 1) { try { this.ws.send(JSON.stringify(obj)); } catch (_) {} }
    }

    broadcastNow() { this._sendRaw(this._buildPacket()); }
    shootPaint(shot) { this._sendRaw({ type: 'shoot_paint', ownerId: PlayerProfile.playerId, ...shot, ts: Date.now() }); }
    sendFunEvent(ev) { this._sendRaw({ funEvent: { ...ev, senderId: PlayerProfile.playerId, ts: Date.now() } }); }

    async _syncHttpFallback() {
        if (this.httpSyncInFlight || typeof fetch === 'undefined') return;
        this.httpSyncInFlight = true;
        try {
            const res = await fetch('/api/space-sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this._buildPacket()) });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data?.savedHomes)) data.savedHomes.forEach(h => this._saveCachedHome(h));
                if (Array.isArray(data?.inviteEvents)) data.inviteEvents.forEach(ev => this.onInviteEvent?.(ev));
                if (data?.impulse?.playerId === PlayerProfile.playerId) this.onServerImpulse?.(data.impulse);
                if (data?.snapshot) this._onSnapshot(data.snapshot);
            }
        } catch (_) {} finally { this.httpSyncInFlight = false; }
    }

    _onSnapshot(snap) {
        this.interpolator.pushSnapshot(snap);
        if (!Array.isArray(snap.players)) return;
        for (const p of snap.players) {
            if (!p?.playerId) continue;
            if (p.playerId === PlayerProfile.playerId) { this.localServerState = p; continue; }
            let peer = this.peers.get(p.playerId);
            if (!peer) { peer = new RemotePlayerEntity(p); this.peers.set(p.playerId, peer); }
            else peer.applyPacket(p);
            this._saveCachedHome(p);
        }
    }

    _onMessage(pkt) {
        if (pkt?.type === 'world_snapshot') { this._onSnapshot(pkt); return; }
        if (pkt?.type === 'server_impulse' && pkt.impulse?.playerId === PlayerProfile.playerId) { this.onServerImpulse?.(pkt.impulse); return; }
        if (pkt?.type === 'fx_event' && pkt.event) {
            if (pkt.event.type === 'horn' && pkt.event.playerId && pkt.event.playerId !== PlayerProfile.playerId) {
                this.peers.get(pkt.event.playerId)?.triggerHorn(pkt.event.emoji);
            }
            this.onFxEvent?.(pkt.event); return;
        }
        if (pkt?.savedHomes && Array.isArray(pkt.savedHomes)) { pkt.savedHomes.forEach(h => this._saveCachedHome(h)); return; }
        if (pkt?.inviteEvent) { if (pkt.inviteEvent.toId === PlayerProfile.playerId) this.onInviteEvent?.(pkt.inviteEvent); return; }
        if (pkt?.funEvent) { if (pkt.funEvent.senderId !== PlayerProfile.playerId) this.onFunEvent?.(pkt.funEvent); return; }
        if (!pkt?.playerId || pkt.playerId === PlayerProfile.playerId) return;
        let peer = this.peers.get(pkt.playerId);
        if (!peer) { peer = new RemotePlayerEntity(pkt); this.peers.set(pkt.playerId, peer); }
        else peer.applyPacket(pkt);
        this._saveCachedHome(pkt);
    }

    step(dt, motionPatch) {
        const prevThrust = this.localMotion.isThrusting, prevTurbo = this.localMotion.isTurbo;
        if (motionPatch) Object.assign(this.localMotion, motionPatch);
        const stateChanged = (this.localMotion.isThrusting !== prevThrust) || (this.localMotion.isTurbo !== prevTurbo);
        const now = performance.now();
        if (stateChanged || now - this.lastSendAt > 36) { this.lastSendAt = now; this.broadcastNow(); }
        if (!this.connected && now - this.lastHttpSyncAt > 200) { this.lastHttpSyncAt = now; this._syncHttpFallback(); }
        const nowWall = Date.now();
        for (const [id, p] of this.peers) {
            if (nowWall - p.lastSeen > 16000) { this.peers.delete(id); continue; }
            p.update(dt, this.interpolator.getInterpolatedPlayer(id));
        }
    }

    getOnlinePeers() { return Array.from(this.peers.values()); }
}

export const SpaceNetwork = new SpaceNetworkClient();
if (typeof window !== 'undefined') window.SpaceNetwork = SpaceNetwork;
