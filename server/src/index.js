import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { monitor } from '@colyseus/monitor';
import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SnowballRoom } from './rooms/SnowballRoom.js';
import { getVapidPublicKey, savePushSubscription, getAllSavedPlayers, sendInvitePush } from '../pushService.js';
import { spaceWorld } from '../spaceWorldServer.js';

const PORT = Number(process.env.PORT) || 8080;
const HOST = '0.0.0.0';
const STARTED_AT = new Date().toISOString();

const app = express();
app.use(express.json());

// CORS for browser clients
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    next();
});

// The game itself is served from this same app: one origin for the PWA and the
// WebSocket, so there is no CORS and no second host to pay for.
const WWW = fileURLToPath(new URL('../../www', import.meta.url));
app.use(express.static(WWW, {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');
    },
}));

app.post('/api/client-log', (req, res) => {
    console.error('[CLIENT-LOG]', req.body);
    res.json({ ok: true });
});

app.get('/health', (_req, res) => {
    res.json({ ok: true, rooms: 'snowball' });
});

// Which build is actually live. Open <адрес>/version on the phone to tell a stale deploy
// from a real bug: the cache version changes with every content change, and the icon names
// say straight away whether the new artwork is being served.
app.get('/version', (_req, res) => {
    const read = (rel) => { try { return readFileSync(join(WWW, rel), 'utf8'); } catch (e) { return ''; } };
    const cache = (read('sw.js').match(/CACHE_VERSION\s*=\s*'([^']+)'/) || [])[1] || 'unknown';
    let icons = [];
    try { icons = (JSON.parse(read('manifest.webmanifest')).icons || []).map((i) => i.src.split('/').pop()); }
    catch (e) {}
    res.json({ ok: true, cacheVersion: cache, icons, startedAt: STARTED_AT });
});

// Colyseus dashboard for debugging (http://localhost:2567/colyseus)
app.use('/colyseus', monitor());

// ============================================================================
// Space Hub Authoritative World (/space-ws WebSocket + /api/space-sync fallback)
// ============================================================================
const pendingInvites = new Map();

app.get('/api/space-homes', (_req, res) => {
    res.json({ ok: true, homes: getAllSavedPlayers() });
});

app.get('/api/push/vapidPublicKey', (_req, res) => {
    res.json({ ok: true, publicKey: getVapidPublicKey() });
});

app.post('/api/push/subscribe', (req, res) => {
    const { playerId, nickname, skinId, subscription } = req.body || {};
    const ok = savePushSubscription(playerId, subscription, { nickname, skinId });
    res.json({ ok });
});

app.post('/api/invite', async (req, res) => {
    const { fromId, fromNickname, toId } = req.body || {};
    if (!toId) return res.status(400).json({ ok: false });
    const senderName = (fromNickname || 'Друг Пи').slice(0, 24);
    const ev = { fromId, fromNickname: senderName, toId, ts: Date.now() };
    pendingInvites.set(toId, [...(pendingInvites.get(toId) || []).slice(-4), ev]);
    spaceWorld.broadcast({ inviteEvent: ev });
    const pushRes = await sendInvitePush({ fromId, fromNickname: senderName, toId });
    res.json({ ok: true, ...pushRes });
});

app.post('/api/space-sync', (req, res) => {
    const pkt = req.body;
    const myId = pkt?.playerId;
    if (pkt) spaceWorld.handleMessage(pkt, null);
    const snap = spaceWorld.buildSnapshot();
    const inviteEvents = myId ? (pendingInvites.get(myId) || []) : [];
    if (myId && inviteEvents.length) pendingInvites.delete(myId);
    const imp = myId ? spaceWorld.pendingImpulses.get(myId) : null;
    if (myId && imp) spaceWorld.pendingImpulses.delete(myId);
    res.json({ ok: true, snapshot: snap, peers: snap.players.filter(p => p.playerId !== myId), savedHomes: getAllSavedPlayers(), inviteEvents, impulse: imp || null });
});

const httpServer = createServer(app);
const wsTransport = new WebSocketTransport({ server: httpServer });
const origOnConnection = wsTransport.onConnection.bind(wsTransport);
wsTransport.wss.removeListener('connection', wsTransport.onConnection);
wsTransport.wss.on('connection', (rawClient, req) => {
    const url = req?.url || rawClient?.upgradeReq?.url || '';
    if (url.startsWith('/space-ws')) {
        rawClient.pingCount = 0;
        rawClient.on('pong', () => { rawClient.pingCount = 0; });
        rawClient.on('error', () => {});
        spaceWorld.sockets.add(rawClient);
        if (rawClient.readyState === 1) {
            try {
                rawClient.send(JSON.stringify({ savedHomes: getAllSavedPlayers() }));
                rawClient.send(JSON.stringify(spaceWorld.buildSnapshot()));
            } catch (_) {}
        }
        rawClient.on('message', (data) => {
            try {
                const pkt = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'));
                spaceWorld.handleMessage(pkt, rawClient);
            } catch (_) {}
        });
        rawClient.on('close', () => spaceWorld.sockets.delete(rawClient));
        return;
    }
    return origOnConnection(rawClient, req);
});

const gameServer = new Server({
    transport: wsTransport
});

gameServer.define('snowball', SnowballRoom)
    .filterBy(['roomCode', 'isPrivate']);

gameServer.listen(PORT, HOST).then(() => {
    console.log(`[server] Mousie Pi snowball server listening on http://${HOST}:${PORT}`);
    console.log(`[server] Game + multiplayer on http://${HOST}:${PORT}`);
    console.log(`[server] Monitor: http://${HOST}:${PORT}/colyseus`);
});
