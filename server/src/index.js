import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { monitor } from '@colyseus/monitor';
import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SnowballRoom } from './rooms/SnowballRoom.js';

const PORT = Number(process.env.PORT) || 2567;
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
    setHeaders: (res, filePath) => {
        // The shell must not be cached by the CDN/browser beyond the service worker's control
        if (filePath.endsWith('sw.js') || filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
        } else {
            res.setHeader('Cache-Control', 'public, max-age=604800');
        }
    },
}));

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

const httpServer = createServer(app);
const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer })
});

gameServer.define('snowball', SnowballRoom);

gameServer.listen(PORT).then(() => {
    console.log(`[server] Mousie Pi snowball server listening on port ${PORT}`);
    console.log(`[server] Game + multiplayer on http://localhost:${PORT}`);
    console.log(`[server] Monitor: http://localhost:${PORT}/colyseus`);
});
