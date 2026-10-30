// ============================================================================
// SpaceNetwork.js — Изолированный сетевой модуль Космоса и Домашних планет
// Нативный MQTT v3.1.1 поверх стандартного WebSocket (wss://broker.emqx.io:8084/mqtt)
// Работает в Москве без VPN, без WebRTC/PeerJS и без внешних CDN
// ============================================================================

import { PlayerProfile } from '../core/PlayerProfile.js';
import { getPersonalPlanetCoords } from './PersonalPlanetSystem.js';

const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
const TOPIC = 'mousie_pi_space/v1/state';
const FRIENDS_CACHE_KEY = 'mousiePi.friendsHomes.v1';
const enc = new TextEncoder(), dec = new TextDecoder();

function _encodeLen(len) {
    const out = [];
    do { let b = len & 0x7f; len >>= 7; if (len > 0) b |= 0x80; out.push(b); } while (len > 0);
    return out;
}
function _mqttStr(str) { const b = enc.encode(str); return [b.length >> 8, b.length & 0xff, ...b]; }

class SpaceNetworkManager {
    constructor() {
        this.peers = new Map();
        this.cachedHomes = new Map();
        this.ws = null;
        this.connected = false;
        this.brokerIdx = 0;
        this.lastSendAt = 0;
        this.localMotion = { x: 0, y: 165, vx: 0, vy: 0, angle: -Math.PI / 2, homeAngle: 0, facing: 1, moving: false };
        this._loadCachedHomes();
        this._initLocalChannel();
        this._connect();
        setInterval(() => this._sendPing(), 22000);
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

    _connect() {
        if (typeof WebSocket === 'undefined') return;
        const url = BROKERS[this.brokerIdx % BROKERS.length];
        try {
            const ws = new WebSocket(url, 'mqtt');
            ws.binaryType = 'arraybuffer';
            this.ws = ws;
            ws.onopen = () => {
                const cid = 'mpi_' + PlayerProfile.playerId + '_' + Math.floor(Math.random() * 999);
                const vh = [0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, 0x02, 0x00, 0x3c];
                const body = [...vh, ..._mqttStr(cid)];
                ws.send(new Uint8Array([0x10, ..._encodeLen(body.length), ...body]));
            };
            ws.onmessage = (ev) => this._handleMqttBytes(new Uint8Array(ev.data));
            ws.onerror = () => {};
            ws.onclose = () => {
                this.connected = false;
                this.brokerIdx++;
                setTimeout(() => this._connect(), 3500);
            };
        } catch (_) { setTimeout(() => this._connect(), 4500); }
    }

    _handleMqttBytes(buf) {
        if (!buf || buf.length < 2) return;
        const type = buf[0] >> 4;
        if (type === 2) {
            this.connected = true;
            const subPl = [0x00, 0x01, ..._mqttStr(TOPIC), 0x00];
            this.ws?.send(new Uint8Array([0x82, ..._encodeLen(subPl.length), ...subPl]));
            this.broadcastNow();
        } else if (type === 3) {
            let i = 1, mult = 1, rem = 0;
            while (i < buf.length) {
                const b = buf[i++]; rem += (b & 0x7f) * mult; mult *= 128;
                if ((b & 0x80) === 0) break;
            }
            const tLen = (buf[i] << 8) | buf[i + 1];
            const jsonStr = dec.decode(buf.subarray(i + 2 + tLen, i + rem));
            try { this._onPacket(JSON.parse(jsonStr)); } catch (_) {}
        }
    }

    _sendPing() {
        if (this.connected && this.ws?.readyState === 1) {
            try { this.ws.send(new Uint8Array([0xc0, 0x00])); } catch (_) {}
        }
    }

    broadcastNow() {
        const m = this.localMotion;
        const pkt = {
            playerId: PlayerProfile.playerId, nickname: PlayerProfile.nickname,
            equippedSkinId: PlayerProfile.equippedSkinId, currentLocation: PlayerProfile.currentLocation,
            x: Math.round(m.x), y: Math.round(m.y), vx: Math.round(m.vx), vy: Math.round(m.vy),
            angle: Number(m.angle.toFixed(2)), homeAngle: Number((m.homeAngle || 0).toFixed(3)),
            facing: m.facing || 1, moving: Boolean(m.moving),
            homeSnapshot: PlayerProfile.getHomeSnapshot(), ts: Date.now()
        };
        try { this.bc?.postMessage(pkt); } catch (_) {}
        if (this.connected && this.ws?.readyState === 1) {
            const body = [..._mqttStr(TOPIC), ...enc.encode(JSON.stringify(pkt))];
            try { this.ws.send(new Uint8Array([0x30, ..._encodeLen(body.length), ...body])); } catch (_) {}
        }
    }

    _onPacket(pkt) {
        if (!pkt?.playerId || pkt.playerId === PlayerProfile.playerId) return;
        const peer = this.peers.get(pkt.playerId) || {
            playerId: pkt.playerId, rx: pkt.x || 0, ry: pkt.y || 0,
            rAngle: pkt.angle || 0, rHomeAngle: pkt.homeAngle || 0
        };
        Object.assign(peer, pkt, { lastSeen: Date.now() });
        this.peers.set(pkt.playerId, peer);
        this._saveCachedHome(pkt);
    }

    step(dt, motionPatch) {
        if (motionPatch) Object.assign(this.localMotion, motionPatch);
        const now = performance.now();
        if (now - this.lastSendAt > 125) { this.lastSendAt = now; this.broadcastNow(); }
        const nowWall = Date.now();
        for (const [id, p] of this.peers) {
            if (nowWall - p.lastSeen > 16000) { this.peers.delete(id); continue; }
            p.x += (p.vx || 0) * dt * 0.5; p.y += (p.vy || 0) * dt * 0.5;
            const k = Math.min(1, dt * 8.5);
            p.rx += (p.x - p.rx) * k; p.ry += (p.y - p.ry) * k;
            let da = (p.angle || 0) - p.rAngle;
            while (da > Math.PI) da -= Math.PI * 2;
            while (da < -Math.PI) da += Math.PI * 2;
            p.rAngle += da * Math.min(1, dt * 10);
            p.rHomeAngle += ((p.homeAngle || 0) - p.rHomeAngle) * k;
        }
    }

    getOnlinePeers() { return Array.from(this.peers.values()); }
}

export const SpaceNetwork = new SpaceNetworkManager();
if (typeof window !== 'undefined') window.SpaceNetwork = SpaceNetwork;
