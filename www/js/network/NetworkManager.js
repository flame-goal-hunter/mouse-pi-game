// ============================================
// NETWORK MANAGER - Host-Authoritative Client-Server
// Host = authoritative server (runs all physics)
// Guest = client (sends inputs, receives snapshots + smooth correction)
// Uses postMessage bridge when running in iframe
// ============================================

export class NetworkManager {
    constructor(scene, isHost, peerId) {
        this.scene = scene;
        this.isHost = isHost;
        this.peerId = peerId;
        this.peer = null;
        this.connections = [];

        // State sync
        this.lastSyncTime = 0;
        this.SYNC_INTERVAL = 16; // ~60 Hz snapshot/input rate

        // Connection status
        this.connected = false;
        this.connectionStatus = 'disconnected';

        // Remote player character choice (received via hello message)
        this.remoteCharacter = null;
        this.remoteNickname = null;

        // Bridge mode flag (postMessage relay via parent window)
        this._bridgeMode = false;
        this._bridgeHandler = null;
        this._remoteHelloReceived = false;

        // Pulse buffering (fire/hookJustPressed are one-frame, throttle can miss them)
        this._pendingFire = false;
        this._pendingFireDir = 0;
        this._pendingHookJust = false;

        // === HOST (server) state ===
        this.remoteInputs = new Map();      // peerId → latest input from client
        this.lastProcessedSeq = new Map();  // peerId → last processed input seq
        this.nextSnowballId = 0;            // Unique snowball IDs for sync
        this._pendingEvents = [];            // Events for next snapshot (sounds, effects)

        // === GUEST (client) state ===
        this._snapBuffer = [];              // Array of { time, data } for render-behind interpolation
        this.RENDER_DELAY = 20;             // ms — render one interval behind (~16ms + jitter margin)
        this.playerId = 'guest';            // Our player ID (guest in 1v1)

        this.inputSeq = 0;                  // Sequence number for inputs
        this.lastInputTime = 0;            // Throttle input sending to SYNC_INTERVAL

        // Ping measurement (guest only)
        this._pingTimer = 0;
        this._pingInterval = 1000;          // Send ping every 1s
        this._recentPings = [];             // Last 5 RTTs for smoothing
        this.ping = 0;                      // Smoothed ping (ms)

        // Callbacks
        this.onPlayerJoin = null;
        this.onPlayerLeave = null;
    }

    connect() {
        // In iframe with multiplayer mode — use postMessage bridge
        if (window.parent && window.parent !== window &&
            (this.scene.gameMode === 'host' || this.scene.gameMode === 'join')) {
            this._setupBridge();
            return;
        }
        // Direct PeerJS mode (no iframe)
        this.init();
    }

    // === POSTMESSAGE BRIDGE MODE ===

    _setupBridge() {
        console.log('NetworkManager: using postMessage bridge to parent');
        this._bridgeMode = true;

        this._bridgeHandler = (event) => {
            if (!event.data || typeof event.data !== 'object') return;
            if (event.data.type === 'networkReceive') {
                const peerId = event.data.fromPeerId || 'remote';
                this.receiveData(peerId, event.data.payload);
            }
        };
        window.addEventListener('message', this._bridgeHandler);

        this.connected = true;
        this.connectionStatus = 'connected';

        // Send hello with character choice
        this.broadcast({
            type: 'hello',
            data: { character: this.scene.playerCharacter || 1, nickname: window.gameConfig?.nickname || 'Игрок' }
        });

        // Don't call onPlayerJoin here — wait for actual hello message
        // from remote player (via handleHello) so we have their nickname
        console.log('NetworkManager: bridge ready, hello sent, waiting for remote hello');
    }

    // === DIRECT PEERJS MODE (fallback, no iframe) ===

    init() {
        if (typeof Peer === 'undefined') {
            console.warn('PeerJS not loaded, multiplayer disabled');
            return;
        }
        if (this.isHost) {
            this.initAsHost();
        } else if (this.peerId) {
            this.initAsClient();
        }
    }

    getPeerConfig() {
        const parentConfig = window.parent?.peerConfig;
        if (parentConfig) {
            return { ...parentConfig, debug: 1 };
        }
        return {
            host: 'peerjs.92k.de',
            port: 443,
            secure: true,
            path: '/',
            debug: 1,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    {
                        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                        username: 'openrelayproject',
                        credential: 'openrelayproject'
                    }
                ]
            }
        };
    }

    initAsHost() {
        this.peer = new Peer(this.peerId, this.getPeerConfig());

        this.peer.on('open', (id) => {
            console.log('Host peer opened with ID:', id);
            this.connectionStatus = 'hosting';
            this.connected = true;
        });

        this.peer.on('connection', (conn) => {
            console.log('Client connected:', conn.peer);
            this.handleConnection(conn);
        });

        this.peer.on('error', (err) => {
            console.error('PeerJS error:', err);
            this.connectionStatus = 'error';
        });
    }

    initAsClient() {
        this.peer = new Peer(null, this.getPeerConfig());

        this.connectionTimeout = setTimeout(() => {
            if (!this.connected) {
                console.error('Connection timeout');
                this.connectionStatus = 'timeout';
            }
        }, 10000);

        this.peer.on('open', (id) => {
            console.log('Client peer opened with ID:', id);
            this.connectionStatus = 'connecting';
            const conn = this.peer.connect(this.peerId, { reliable: true });
            this.handleConnection(conn);
        });

        this.peer.on('error', (err) => {
            console.error('PeerJS error:', err);
            this.connectionStatus = 'error';
            this.clearConnectionTimeout();
        });
    }

    clearConnectionTimeout() {
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
        }
    }

    handleConnection(conn) {
        conn.on('open', () => {
            console.log('Connection opened with:', conn.peer);
            this.clearConnectionTimeout();
            this.connections.push(conn);
            this.connected = true;
            this.connectionStatus = 'connected';

            conn.send({
                type: 'hello',
                data: { character: this.scene.playerCharacter || 1, nickname: window.gameConfig?.nickname || 'Игрок' }
            });

            if (this.onPlayerJoin) {
                this.onPlayerJoin(conn.peer);
            }
        });

        conn.on('data', (data) => {
            this.receiveData(conn.peer, data);
        });

        conn.on('close', () => {
            console.log('Connection closed:', conn.peer);
            this.removeConnection(conn);
            if (this.onPlayerLeave) {
                this.onPlayerLeave(conn.peer);
            }
        });

        conn.on('error', (err) => {
            console.error('Connection error:', err);
        });
    }

    removeConnection(conn) {
        const index = this.connections.indexOf(conn);
        if (index > -1) {
            this.connections.splice(index, 1);
        }
        if (this.connections.length === 0 && !this.isHost) {
            this.connectionStatus = 'disconnected';
            this.connected = false;
        }
    }

    // === DATA SENDING ===

    broadcast(data) {
        if (this._bridgeMode) {
            window.parent.postMessage({ type: 'networkSend', payload: data }, '*');
            return;
        }
        for (const conn of this.connections) {
            if (conn.open) {
                conn.send(data);
            }
        }
    }

    // === SYNC UPDATE (called from GameScene.update) ===

    update(delta) {
        if (!this.connected) return;
        if (!this._bridgeMode && this.connections.length === 0) return;

        this.lastSyncTime += delta;
        if (this.lastSyncTime < this.SYNC_INTERVAL) return;
        this.lastSyncTime = 0;

        if (this.isHost) {
            // Server: send snapshot to clients
            const snapshot = this.buildSnapshot();
            this.broadcast({ type: 'snapshot', data: snapshot });
        } else {
            // Guest: send ping periodically
            this._pingTimer += this.SYNC_INTERVAL;
            if (this._pingTimer >= this._pingInterval) {
                this._pingTimer = 0;
                this.broadcast({ type: 'ping', t: Date.now() });
            }
        }
    }

    // === HOST: BUILD SNAPSHOT ===

    buildSnapshot() {
        const scene = this.scene;
        const players = [];

        // Host player
        if (scene.player?.active || scene.player?.getData('isDying')) {
            players.push(this._playerToSnap(scene.player, 'host'));
        }

        // Guest player (server-side character)
        if (scene.guestPlayer?.active || scene.guestPlayer?.getData('isDying')) {
            players.push(this._playerToSnap(scene.guestPlayer, 'guest'));
        }

        const snowballs = (scene.snowballs || []).filter(s => s?.active).map(s => ({
            id: String(s.getData('netId')),
            x: s.x,
            y: s.y,
            hasFire: !!s.getData('particles')
        }));

        return {
            tick: Date.now(),
            lastInputSeq: this.lastProcessedSeq.get('guest') || 0,
            players,
            snowballs,
            pickups: (scene.pickups || []).filter(p => p.isActive()).map(p => ({
                id: p.id,
                x: p.emoji.x,
                y: p.startY,
                type: p.type
            })),
            score: {
                hostWins: scene.matchData?.playerWins || 0,
                guestWins: scene.matchData?.opponentWins || 0
            },
            events: this._pendingEvents.splice(0)
        };
    }

    _playerToSnap(p, id) {
        return {
            id,
            x: p.x,
            y: p.y,
            vx: p.body?.velocity?.x || 0,
            vy: p.body?.velocity?.y || 0,
            facingRight: p.getData('facingRight'),
            health: p.getData('health'),
            animation: p.anims?.currentAnim?.key || 'idle',
            hookState: p.core?.hookState || 'IDLE',
            hookPos: p.core?.hookPos ? { x: p.core.hookPos.x, y: p.core.hookPos.y } : null,
            powerup: this.scene.getActivePowerupType?.(p) || null,
            isDying: p.getData('isDying') || false,
            isActive: p.active
        };
    }

    // === GUEST: SEND INPUT ===

    sendInput(input) {
        if (!this.connected) return;

        // Accumulate one-frame pulses between sends (they reset after one read)
        if (input.fire) {
            this._pendingFire = true;
            this._pendingFireDir = input.fireDirection || 0;
        }
        if (input.hookJustPressed) {
            this._pendingHookJust = true;
        }

        // Throttle to ~30Hz (match snapshot rate) to avoid flooding host
        const now = Date.now();
        if (now - this.lastInputTime < this.SYNC_INTERVAL) return;
        this.lastInputTime = now;

        const seq = this.inputSeq++;
        const data = {
            seq,
            direction: input.direction || 0,
            jump: !!input.jump,
            hook: !!input.hook,
            hookJustPressed: this._pendingHookJust || !!input.hookJustPressed,
            fire: this._pendingFire || !!input.fire,
            fireDirection: this._pendingFire ? this._pendingFireDir : (input.fireDirection || 0),
            strength: input.strength || 1
        };

        // Reset pending pulses after sending
        this._pendingFire = false;
        this._pendingFireDir = 0;
        this._pendingHookJust = false;

        this.broadcast({ type: 'input', data });
    }

    // === HOST: GET REMOTE INPUT ===

    getRemoteInput() {
        // Return latest input from guest (or idle input if none received)
        const input = this.remoteInputs.get('guest') || this.remoteInputs.values().next().value;
        if (!input) {
            return { direction: 0, jump: false, hook: false, hookJustPressed: false, fire: false, fireDirection: 0, strength: 1 };
        }
        return { ...input };
    }

    // === GUEST: RENDER-BEHIND INTERPOLATION ===

    get lastSnapshot() {
        if (this._snapBuffer.length === 0) return null;
        return this._snapBuffer[this._snapBuffer.length - 1].data;
    }

    getInterpolatedSnapshot() {
        if (this._snapBuffer.length < 2) return null;

        const renderTime = Date.now() - this.RENDER_DELAY;

        // Find the last snapshot with time <= renderTime
        let i = this._snapBuffer.length - 1;
        while (i > 0 && this._snapBuffer[i].time > renderTime) {
            i--;
        }

        // If renderTime is past all snapshots, use last two (slight extrapolation)
        if (i >= this._snapBuffer.length - 1) {
            i = this._snapBuffer.length - 2;
        }

        const prev = this._snapBuffer[i];
        const curr = this._snapBuffer[i + 1];
        const duration = curr.time - prev.time;
        if (duration <= 0) return null;

        const t = Math.max(0, Math.min((renderTime - prev.time) / duration, 1.2));
        return { t, prev: prev.data, curr: curr.data };
    }

    // === HOST: queue event for next snapshot ===

    queueEvent(evt) {
        this._pendingEvents.push(evt);
    }

    // === DATA RECEIVING ===

    receiveData(fromPeerId, message) {
        if (!message || !message.type) return;

        switch (message.type) {
            case 'input':
                // Host: store client input
                if (this.isHost && message.data) {
                    // Preserve fire pulse: if previous input had fire=true and host
                    // hasn't processed it yet, don't let new input overwrite it
                    const existing = this.remoteInputs.get('guest');
                    // Preserve fire pulse until host processes it
                    if (existing?.fire && !message.data.fire) {
                        message.data.fire = true;
                        message.data.fireDirection = existing.fireDirection;
                    }
                    // Preserve hook pulse until host processes it
                    if (existing?.hookJustPressed && !message.data.hookJustPressed) {
                        message.data.hookJustPressed = true;
                    }
                    this.remoteInputs.set('guest', message.data);
                    this.lastProcessedSeq.set('guest', message.data.seq);
                }
                break;

            case 'snapshot':
                // Guest: add to render-behind buffer
                if (!this.isHost && message.data) {
                    this._snapBuffer.push({ time: Date.now(), data: message.data });
                    // Keep max 10 snapshots (~330ms buffer)
                    if (this._snapBuffer.length > 10) {
                        this._snapBuffer.shift();
                    }
                }
                break;

            case 'ping':
                // Host: echo back immediately
                if (this.isHost) {
                    this.broadcast({ type: 'pong', t: message.t });
                }
                break;

            case 'pong':
                // Guest: calculate RTT
                if (!this.isHost) {
                    const rtt = Date.now() - message.t;
                    this._recentPings.push(rtt);
                    if (this._recentPings.length > 5) this._recentPings.shift();
                    this.ping = Math.round(
                        this._recentPings.reduce((a, b) => a + b, 0) / this._recentPings.length
                    );
                    // Adaptive render delay: half ping + jitter margin
                    this.RENDER_DELAY = Math.max(16, Math.min(100, Math.round(this.ping * 0.5) + 8));
                }
                break;

            case 'hello':
                this.handleHello(fromPeerId, message.data);
                break;
        }
    }

    handleHello(peerId, data) {
        if (data?.character) {
            this.remoteCharacter = data.character;
            console.log('Remote player chose character:', this.remoteCharacter);
        }
        if (data?.nickname) {
            this.remoteNickname = data.nickname;
            console.log('Remote player nickname:', this.remoteNickname);
            // Update global config so all subsequent reads find the correct nickname
            if (window.gameConfig) {
                window.gameConfig.remoteNickname = data.nickname;
            }
        }

        // Re-send our hello once to ensure the other side got it
        // (in bridge mode, our initial hello may have been lost if PeerJS wasn't ready)
        if (!this._remoteHelloReceived) {
            this._remoteHelloReceived = true;
            this.broadcast({
                type: 'hello',
                data: {
                    character: this.scene.playerCharacter || 1,
                    nickname: window.gameConfig?.nickname || 'Игрок'
                }
            });
        }

        // Notify scene (this is the proper time — we now have the remote player's data)
        if (this.onPlayerJoin) {
            this.onPlayerJoin(peerId);
        }
    }

    // === CLEANUP ===

    destroy() {
        if (this._bridgeMode) {
            if (this._bridgeHandler) {
                window.removeEventListener('message', this._bridgeHandler);
                this._bridgeHandler = null;
            }
        } else {
            this.clearConnectionTimeout();
            for (const conn of this.connections) {
                conn.close();
            }
            this.connections = [];
            if (this.peer) {
                this.peer.destroy();
                this.peer = null;
            }
        }

        this.connected = false;
        this.connectionStatus = 'disconnected';
    }

    // === STATUS ===

    getStatus() {
        return {
            connected: this.connected,
            status: this.connectionStatus,
            isHost: this.isHost,
            peerId: this.peerId,
            playerCount: this._bridgeMode ? 2 : (this.connections.length + 1)
        };
    }
}
