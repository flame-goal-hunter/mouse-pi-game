import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { monitor } from '@colyseus/monitor';
import express from 'express';
import { createServer } from 'node:http';
import { SnowballRoom } from './rooms/SnowballRoom.js';

const PORT = Number(process.env.PORT) || 2567;

const app = express();
app.use(express.json());

// CORS for browser clients
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    next();
});

app.get('/', (_req, res) => {
    res.send('Mousie Pi snowball server OK');
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
    console.log(`[server] Connect via ws://localhost:${PORT}`);
    console.log(`[server] Monitor: http://localhost:${PORT}/colyseus`);
});
