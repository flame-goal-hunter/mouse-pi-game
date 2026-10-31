// ============================================================================
// SpaceColyseusClient.js — Сетевой транспорт Космоса на официальном colyseus.js
// Комната 'space_hub' (20 Hz) + единая физика ClientWorldSync (Teeworlds-style)
// ============================================================================

import * as ColyseusMod from '../../lib/colyseus.esm.js';
import { PlayerProfile } from '../core/PlayerProfile.js';
import { getPersonalPlanetCoords } from './PersonalPlanetSystem.js';
import { ClientWorldSync } from './ClientWorldSync.js';
import { SpaceNetDebug } from './SpaceNetDebug.js';

const Colyseus = ColyseusMod.default || ColyseusMod;
const FRIENDS_CACHE_KEY = 'mousiePi.friendsHomes.v1';

export class SpaceColyseusClient {
    constructor() {
        let tabSid = 'tab_' + Math.random().toString(36).slice(2, 8);
        try { tabSid = sessionStorage.getItem('mpi_tab_sid') || tabSid; sessionStorage.setItem('mpi_tab_sid', tabSid); } catch (_) {}
        const worldSync = new ClientWorldSync();
        Object.assign(this, {
            peers: new Map(), cachedHomes: new Map(), worldSync, smoother: worldSync,
            client: null, room: null, connected: false, connecting: false, tabSid, reconnTimer: null,
            lastSendAt: 0, lastSyncAt: 0, syncBusy: false, lastFxSeq: 0, seenFx: new Set(), pendingActions: [],
            lastStatusSent: '', onFunEvent: null, onFxEvent: null,
            onServerImpulse: null, onInviteEvent: null, pushSubscription: null,
            localMotion: { x: 0, y: 165, vx: 0, vy: 0, angle: -Math.PI / 2, isThrusting: false, isTurbo: false, paintColor: '', paintTimer: 0, homeAngle: 0, facing: 1, moving: false }
        });
        this._loadCachedHomes();
        this._initLocalChannel();
        if (typeof window !== 'undefined') {
            window.addEventListener('pagehide', () => this._sendLeave());
            window.addEventListener('beforeunload', () => this._sendLeave());
            document.addEventListener?.('visibilitychange', () => {
                if (document.visibilityState === 'hidden') this._sendLeave();
                else { this._connect(); this._syncCrossContainer(); }
            });
        }
        setTimeout(() => { this._connect(); this._fetchServerHomes(); }, 50);
    }

    _mySid() { return this.room?.sessionId || this.tabSid; }

    _sendLeave() {
        const body = JSON.stringify({ leave: true, sessionId: this._mySid(), tabSid: this.tabSid, playerId: PlayerProfile.playerId });
        try { navigator.sendBeacon?.('/api/space-sync', new Blob([body], { type: 'application/json' })); } catch (_) {}
        if (this.reconnTimer) { clearTimeout(this.reconnTimer); this.reconnTimer = null; }
        if (this.room) { try { this.room.leave(); } catch (_) {} this.room = null; this.connected = false; }
    }

    _initLocalChannel() {
        try {
            this.bc = new BroadcastChannel('mousie_pi_space_v1');
            this.bc.onmessage = (e) => {
                if (e.data && e.data.sessionId !== this._mySid() && e.data.tabSid !== this.tabSid) {
                    this.worldSync._syncPeer(e.data, e.data.sessionId || e.data.playerId, this._mySid(), this.tabSid, this.peers, (h) => this._saveCachedHome(h));
                }
            };
        } catch (_) {}
    }

    _buildLocalPkt() {
        const m = this.localMotion, snap = PlayerProfile.getHomeSnapshot();
        return {
            sessionId: this._mySid(), tabSid: this.tabSid, playerId: PlayerProfile.playerId, nickname: PlayerProfile.nickname,
            skinId: PlayerProfile.equippedSkinId, activityStatus: PlayerProfile.currentLocation || 'space',
            storedCheese: PlayerProfile.storedCheese, planetBiome: snap.planetAppearance?.biome || 'cheese', planetRing: snap.planetAppearance?.ringType || 'none',
            x: Math.round(m.x), y: Math.round(m.y), vx: Math.round(m.vx), vy: Math.round(m.vy),
            angle: Number(m.angle.toFixed(3)), isThrusting: Boolean(m.isThrusting), isTurbo: Boolean(m.isTurbo),
            paintColor: m.paintColor || '', paintTimer: Number(m.paintTimer) || 0, homeSnapshot: snap
        };
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
        if (this.reconnTimer) { clearTimeout(this.reconnTimer); this.reconnTimer = null; }
        this.connecting = true;
        try {
            this.client = new Colyseus.Client(this._getEndpoint());
            const snap = PlayerProfile.getHomeSnapshot();
            this.room = await this.client.joinOrCreate('space_hub', {
                tabSid: this.tabSid, playerId: PlayerProfile.playerId, nickname: PlayerProfile.nickname,
                skinId: PlayerProfile.equippedSkinId, activityStatus: PlayerProfile.currentLocation || 'space',
                storedCheese: PlayerProfile.storedCheese,
                planetBiome: snap.planetAppearance?.biome || 'cheese', planetRing: snap.planetAppearance?.ringType || 'none',
                homeSnapshot: snap, x: Math.round(this.localMotion.x), y: Math.round(this.localMotion.y)
            });
            this.connected = true; this.connecting = false;
            this._wireRoom();
            this.broadcastNow();
        } catch (err) {
            this.connected = false; this.connecting = false;
            if (!this._wsErrLogged) {
                this._wsErrLogged = true;
                SpaceNetDebug._pushAnomaly('WS_FALLBACK', `Colyseus WS joinOrCreate failed (${err?.message || err || 'blocked'}), using fast HTTP sync`);
            }
            this.reconnTimer = setTimeout(() => this._connect(), 2500);
        }
    }

    _wireRoom() {
        const room = this.room;
        if (!room) return;
        const applyState = (state) => {
            if (state) {
                SpaceNetDebug.onPatch('colyseus');
                this.worldSync.onServerState(state, room.sessionId, this.peers, (pkt) => this._saveCachedHome(pkt), this.tabSid);
            }
        };
        if (room.state) applyState(room.state);
        room.onStateChange(applyState);
        room.onStateChange.once?.(applyState);
        room.onMessage('saved_homes', (homes) => {
            if (Array.isArray(homes)) homes.forEach(h => this._saveCachedHome(h));
        });
        room.onMessage('bumper_impulse', (imp) => {
            if (imp && this.onServerImpulse) this.onServerImpulse(imp);
        });
        room.onMessage('fx_event', (ev) => this._handleFxEvent(ev));
        room.onLeave(() => {
            this.connected = false; this.room = null;
            if (this.reconnTimer) clearTimeout(this.reconnTimer);
            this.reconnTimer = setTimeout(() => this._connect(), 2000);
        });
    }

    _handleFxEvent(ev) {
        if (!ev) return;
        const fxKey = ev.seq ? `${ev.type}_${ev.seq}_${ev.ts || 0}` : '';
        if (fxKey) {
            if (this.seenFx.has(fxKey)) return;
            this.seenFx.add(fxKey);
            if (this.seenFx.size > 80) this.seenFx.delete(this.seenFx.values().next().value);
        }
        if (ev.type === 'invite') {
            if (ev.toId === PlayerProfile.playerId && this.onInviteEvent) this.onInviteEvent(ev);
            return;
        }
        if (ev.type === 'horn' && ev.playerId && ev.playerId !== PlayerProfile.playerId) {
            const peer = this.peers.get(ev.playerId) || Array.from(this.peers.values()).find(p => p.sessionId === ev.sessionId || p.playerId === ev.playerId);
            peer?.triggerHorn(ev.emoji);
        }
        if (this.onFxEvent) this.onFxEvent(ev);
    }

    broadcastNow() {
        const pkt = this._buildLocalPkt();
        try { this.bc?.postMessage(pkt); } catch (_) {}
        if (!this.connected || !this.room) return;
        try {
            this.room.send('status', { ...pkt, pushSubscription: this.pushSubscription || null });
        } catch (_) {}
    }

    async _syncCrossContainer() {
        const now = performance.now();
        if ((this.syncBusy && now - (this.syncStartedAt || 0) < 450) || typeof fetch === 'undefined') return;
        this.syncBusy = true; this.syncStartedAt = now;
        try {
            if (!this.connected) SpaceNetDebug.onSend();
            const actions = this.pendingActions.splice(0, 12);
            const res = await fetch('/api/space-sync', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ player: this._buildLocalPkt(), actions, fxSeq: this.lastFxSeq })
            });
            if (res.ok) {
                const data = await res.json();
                if (!this.connected) SpaceNetDebug.onPatch('http_sync');
                if (Array.isArray(data?.fxEvents)) data.fxEvents.forEach(ev => this._handleFxEvent(ev));
                if (typeof data?.fxSeq === 'number') this.lastFxSeq = data.fxSeq;
                if (data?.impulse && this.onServerImpulse) this.onServerImpulse(data.impulse);
                if (Array.isArray(data?.players)) {
                    this.worldSync.onServerState(data, this._mySid(), this.peers, (h) => this._saveCachedHome(h), this.tabSid);
                }
            }
        } catch (_) {} finally { this.syncBusy = false; }
    }

    sendAction(type, data) {
        const payload = { ...data, actId: Math.random().toString(36).slice(2, 9) };
        if (this.connected && this.room) {
            try { this.room.send(type, payload); } catch (_) {}
        }
        this.pendingActions.push({ type, data: payload });
    }

    shootPaint(shot) {
        this.sendAction('shoot_paint', shot);
    }

    step(dt, motionPatch) {
        if (motionPatch) Object.assign(this.localMotion, motionPatch);
        this.worldSync.stepFrame(dt, this.peers);
        const mb = this.worldSync.myBody;
        if (mb && !mb.docking) {
            this.localMotion.x = mb.x; this.localMotion.y = mb.y;
            this.localMotion.vx = mb.vx; this.localMotion.vy = mb.vy;
            this.localMotion.angle = mb.angle;
        }
        const now = performance.now();
        if (now - this.lastSendAt >= 50) {
            this.lastSendAt = now;
            try { this.bc?.postMessage(this._buildLocalPkt()); } catch (_) {}
            if (this.connected && this.room) {
                const m = this.localMotion;
                try {
                    this.room.send('move', {
                        x: Math.round(m.x), y: Math.round(m.y), vx: Math.round(m.vx), vy: Math.round(m.vy),
                        angle: Number(m.angle.toFixed(3)), isThrusting: Boolean(m.isThrusting), isTurbo: Boolean(m.isTurbo),
                        paintColor: m.paintColor || '', paintTimer: Number(m.paintTimer) || 0,
                        homeAngle: Number((m.homeAngle || 0).toFixed(3)), facing: m.facing || 1, moving: Boolean(m.moving)
                    });
                    SpaceNetDebug.onSend();
                } catch (_) {}
                const curStatus = `${PlayerProfile.currentLocation}|${PlayerProfile.equippedSkinId}|${PlayerProfile.nickname}|${PlayerProfile.storedCheese}`;
                if (curStatus !== this.lastStatusSent) { this.lastStatusSent = curStatus; this.broadcastNow(); }
            }
        }
        const syncInterval = this.connected ? 280 : 65;
        if (now - this.lastSyncAt >= syncInterval) { this.lastSyncAt = now; this._syncCrossContainer(); }
    }

    getOnlinePeers() { return Array.from(this.peers.values()); }
}

export const SpaceNetwork = new SpaceColyseusClient();
if (typeof window !== 'undefined') window.SpaceNetwork = SpaceNetwork;
