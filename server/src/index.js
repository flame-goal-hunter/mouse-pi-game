import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { monitor } from '@colyseus/monitor';
import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SnowballRoom } from './rooms/SnowballRoom.js';
import { SpaceRoom, activeSpaceRoom } from '../colyseus/SpaceRoom.js';
import { getVapidPublicKey, savePushSubscription, getAllSavedPlayers, sendInvitePush } from '../pushService.js';

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
// Space Hub & Web Push API + Colyseus Rooms ('snowball' & 'space_hub')
// ============================================================================
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
    if (activeSpaceRoom) {
        activeSpaceRoom.broadcast('fx_event', { type: 'invite', fromId, fromNickname: senderName, toId, ts: Date.now() });
    }
    const pushRes = await sendInvitePush({ fromId, fromNickname: senderName, toId });
    res.json({ ok: true, ...pushRes });
});

app.post('/api/space-sync', (req, res) => {
    if (activeSpaceRoom) {
        if (req.body?.player) activeSpaceRoom.syncExternalPlayer(req.body.player);
        if (Array.isArray(req.body?.peers)) req.body.peers.forEach(p => activeSpaceRoom.syncExternalPlayer(p));
        return res.json({ ok: true, players: activeSpaceRoom.getSyncSnapshot() });
    }
    res.json({ ok: true, players: [] });
});

const httpServer = createServer(app);
const wsTransport = new WebSocketTransport({ server: httpServer });
const origOnConn = wsTransport.onConnection.bind(wsTransport);
wsTransport.wss.removeAllListeners('connection');
wsTransport.wss.on('connection', async (rawClient, req) => {
    try {
        const upgradeReq = req || rawClient.upgradeReq;
        const parsedURL = new URL(`ws://server/${upgradeReq.url}`);
        const sessionId = parsedURL.searchParams.get('sessionId');
        const m = parsedURL.pathname.match(/\/([a-zA-Z0-9_\-]+)\/([a-zA-Z0-9_\-]+)$/);
        const roomId = m && m[2];
        const room = roomId && matchMaker.getRoomById(roomId);
        if ((!room || !room.hasReservedSeat(sessionId)) && sessionId && activeSpaceRoom) {
            await activeSpaceRoom._reserveSeat(sessionId, {});
            if (roomId && roomId !== activeSpaceRoom.roomId) {
                upgradeReq.url = upgradeReq.url.replace(`/${roomId}`, `/${activeSpaceRoom.roomId}`);
            }
        }
    } catch (_) {}
    return origOnConn(rawClient, req);
});

const gameServer = new Server({
    transport: wsTransport
});

gameServer.define('snowball', SnowballRoom)
    .filterBy(['roomCode', 'isPrivate']);

gameServer.define('space_hub', SpaceRoom);

gameServer.listen(PORT, HOST).then(async () => {
    try { await matchMaker.createRoom('space_hub', {}); } catch (_) {}
    console.log(`[server] Mousie Pi snowball server listening on http://${HOST}:${PORT}`);
    console.log(`[server] Game + multiplayer on http://${HOST}:${PORT}`);
    console.log(`[server] Monitor: http://${HOST}:${PORT}/colyseus`);
});
