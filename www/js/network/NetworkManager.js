// ============================================
// NETWORK MANAGER - Host-Authoritative Client-Server (v17 Hybrid)
// Host = authoritative server (runs all physics with Rapier)
// Guest = client with simple local physics + snapshot interpolation
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

        // Pulse buffering (fire is one-frame, throttle can miss it)
        this._pendingFire = false;
        this._pendingFireAngle = null;

        // Hook edge tracking for seq-based prediction protection
        this._prevHookSent = false;

        // Host input buffering
        this._hostInputCurrent = null;

        // === HOST (server) state ===
        this.remoteInputs = new Map();      // peerId → latest input from client
        this.lastProcessedSeq = new Map();  // peerId → last processed input seq
        this.nextSnowballId = 0;            // Unique snowball IDs for sync
        this._pendingEvents = [];            // Events for next snapshot (sounds, effects)

        // v18: Input buffer for consistent timing (host)
        this.inputQueue = [];               // Queue of { seq, input, receivedTick }
        this.INPUT_DELAY_TICKS = 0;         // v20: Removed delay for sync with guest (was 2)
        this.appliedInputSeq = 0;           // v20: Actually applied input seq (for reconciliation)

        // Tick counter (host increments each update)
        this.serverTick = 0;

        // Delta compression state (host)
        this._lastSentSnapshot = null;      // Last full snapshot sent (for computing delta)
        this._keyframeInterval = 30;        // Full snapshot every 30 ticks (~0.5s at 60Hz)

        // === GUEST (client) state ===
        this._snapBuffer = [];              // Array of { time, data } for render-behind interpolation
        this.RENDER_DELAY = 50;             // v18: Start with 50ms (3 frames), adapt based on ping
        this.playerId = 'guest';            // Our player ID (guest in 1v1)
        this._lastFullSnapshot = null;      // Last reconstructed full snapshot (for delta merging)

        this.inputSeq = 0;                  // Sequence number for inputs
        this.lastInputTime = 0;            // Throttle input sending to SYNC_INTERVAL

        // === v18: INPUT HISTORY FOR SERVER RECONCILIATION ===
        this.inputHistory = [];             // Array of { seq, input, predictedPos, predictedVel }
        this.MAX_INPUT_HISTORY = 64;        // ~1 second at 60Hz

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

    // Send critical message with retry (for unreliable channels)
    broadcastReliable(data, retries = 3, interval = 100) {
        this.broadcast(data);
        if (retries > 0) {
            setTimeout(() => this.broadcast(data), interval);
            if (retries > 1) setTimeout(() => this.broadcast(data), interval * 2);
        }
    }

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

    // Send via unreliable channel (snapshots, ping/pong) — falls back to reliable
    broadcastUnreliable(data) {
        if (this._bridgeMode) {
            window.parent.postMessage({ type: 'networkSendUnreliable', payload: data }, '*');
            return;
        }
        this.broadcast(data);
    }

    // === SYNC UPDATE (called from GameScene.update) ===

    update(delta) {
        if (!this.connected) return;
        if (!this._bridgeMode && this.connections.length === 0) return;

        this.lastSyncTime += delta;
        if (this.lastSyncTime < this.SYNC_INTERVAL) return;
        this.lastSyncTime = 0;

        if (this.isHost) {
            // Note: serverTick is now incremented in GameScene.updateAsHost() inside physics loop

            // Send host input as separate packet (with pulse buffering)
            // Build and send snapshot (delta or keyframe)
            // Note: hostInput is now included IN the snapshot (Teeworlds-style)
            const isKeyframe = !this._lastSentSnapshot ||
                               (this.serverTick % this._keyframeInterval === 0);

            if (isKeyframe) {
                const snapshot = this.buildSnapshot();
                snapshot.type = 'full';
                this._lastSentSnapshot = snapshot;
                // Events must not be lost — use reliable if snapshot has events
                const hasEvents = snapshot.events && snapshot.events.length > 0;
                if (hasEvents) {
                    this.broadcast({ type: 'snapshot', data: snapshot });
                } else {
                    this.broadcastUnreliable({ type: 'snapshot', data: snapshot });
                }
            } else {
                const full = this.buildSnapshot();
                const delta = this._computeDelta(this._lastSentSnapshot, full);
                this._lastSentSnapshot = full;
                const hasEvents = delta.events && delta.events.length > 0;
                if (hasEvents) {
                    this.broadcast({ type: 'snapshot', data: delta });
                } else {
                    this.broadcastUnreliable({ type: 'snapshot', data: delta });
                }
            }
        } else {
            // Guest: send ping periodically (unreliable OK — samples replaceable)
            this._pingTimer += this.SYNC_INTERVAL;
            if (this._pingTimer >= this._pingInterval) {
                this._pingTimer = 0;
                this.broadcastUnreliable({ type: 'ping', t: Date.now() });
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

        // Teeworlds: include host input with tick it was applied at
        // hook is continuous state — CharacterCore does edge detection internally
        const hostInput = this._hostInputCurrent ? {
            direction: this._hostInputCurrent.direction || 0,
            jump: !!this._hostInputCurrent.jump,
            hook: !!this._hostInputCurrent.hook,
            hookTarget: this._hostInputCurrent.hookTarget || null,
            appliedAtTick: this.serverTick
        } : null;

        return {
            tick: this.serverTick,
            time: Date.now(),
            lastInputSeq: this.appliedInputSeq || 0,  // v20: Use actually applied seq, not received
            hostInput,  // Teeworlds: host input for guest simulation
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
        // v28: Get velocity from SimpleBody
        const vx = p.simpleBody?.vx || 0;
        const vy = p.simpleBody?.vy || 0;
        return {
            id,
            x: p.x,
            y: p.y,
            vx: Math.round(vx * 256),  // Fixed-point 256
            vy: Math.round(vy * 256),  // Fixed-point 256
            facingRight: p.getData('facingRight'),
            health: p.getData('health'),
            animation: p.anims?.currentAnim?.key || 'idle',
            hookState: p.core?.hookState || 'IDLE',
            hookPos: p.core?.hookPos ? { x: p.core.hookPos.x, y: p.core.hookPos.y } : null,
            hookAnchorPos: p.core?.hookAnchorPos ? { x: p.core.hookAnchorPos.x, y: p.core.hookAnchorPos.y } : null,
            grounded: p.core?.grounded || false,
            powerup: this.scene.getActivePowerupType?.(p) || null,
            isDying: p.getData('isDying') || false,
            isActive: p.active
        };
    }

    // === GUEST: SEND INPUT ===

    sendInput(input) {
        if (!this.connected) return null;  // v19: return null when not connected

        // Accumulate fire one-shot between sends (hook uses edge detection in CharacterCore)
        if (input.fire) {
            this._pendingFire = true;
            this._pendingFireAngle = input.fireAngle;
        }

        // Throttle to ~60Hz (match physics rate) to avoid flooding host
        const now = Date.now();
        if (now - this.lastInputTime < this.SYNC_INTERVAL) return null;  // v19: return null when throttled
        this.lastInputTime = now;

        const seq = this.inputSeq++;

        // v17: simplified input packet (no Teeworlds tick sync)
        const data = {
            seq,
            direction: input.direction || 0,
            jump: !!input.jump,
            hook: !!input.hook,
            hookTarget: input.hookTarget || null,
            fire: this._pendingFire || !!input.fire,
            fireAngle: this._pendingFire ? this._pendingFireAngle : (input.fireAngle ?? null),
            strength: input.strength || 1
        };

        // v18: Store input for server reconciliation (predicted state filled by GameScene)
        this.inputHistory.push({
            seq,
            input: { ...data },
            predictedPos: null,   // Filled after local physics tick
            predictedVel: null,   // Filled after local physics tick
            predictedGrounded: null
        });

        // Trim old inputs to prevent memory growth
        while (this.inputHistory.length > this.MAX_INPUT_HISTORY) {
            this.inputHistory.shift();
        }

        // v28: Track hook edge (false→true) seq for guest prediction protection
        if (data.hook && !this._prevHookSent) {
            this.lastHookInputSeq = seq;
        }
        this._prevHookSent = !!data.hook;

        // Reset pending pulses after sending
        this._pendingFire = false;
        this._pendingFireAngle = null;

        this.broadcast({ type: 'input', data });

        return seq;  // v19: Return seq for storePredictedState
    }

    // === HOST: GET REMOTE INPUT ===

    getRemoteInput() {
        // Return latest input from guest (or idle input if none received)
        const input = this.remoteInputs.get('guest') || this.remoteInputs.values().next().value;
        if (!input) {
            return { direction: 0, jump: false, hook: false, hookJustPressed: false, fire: false, fireAngle: null, strength: 1 };
        }
        return { ...input };
    }

    /**
     * v18: Get buffered input for a specific tick (host only).
     * Applies input delay for consistent timing and jitter absorption.
     * @param {string} playerId - Player ID (e.g., 'guest')
     * @param {number} targetTick - Current server tick
     * @returns {object} Input to apply
     */
    getInputForTick(playerId, targetTick) {
        // Apply inputs from INPUT_DELAY_TICKS ago
        const desiredTick = targetTick - this.INPUT_DELAY_TICKS;

        // Find best matching input (latest input received at or before desiredTick)
        let bestInput = null;
        let bestSeq = -1;

        for (const queuedInput of this.inputQueue) {
            if (queuedInput.receivedTick <= desiredTick && queuedInput.seq > bestSeq) {
                bestInput = queuedInput.input;
                bestSeq = queuedInput.seq;
            }
        }

        // v18 FIX: Clean up by seq, not receivedTick (jitter-safe)
        // Only remove inputs we've definitely processed (seq <= bestSeq - buffer)
        if (bestSeq > 0) {
            this.inputQueue = this.inputQueue.filter(i => i.seq > bestSeq - 5);
            // v20: Track which input seq is actually being applied (for reconciliation)
            this.appliedInputSeq = bestSeq;
        }

        // Fallback to last known input or idle state
        if (!bestInput) {
            const fallback = this.remoteInputs.get(playerId);
            if (fallback) {
                return { ...fallback, hookJustPressed: false, fire: false };  // Don't repeat one-shots
            }
            return { direction: 0, jump: false, hook: false, hookJustPressed: false, fire: false, fireAngle: null, strength: 1 };
        }

        const result = { ...bestInput };
        // v28: Only consume fire one-shot (hook uses edge detection in CharacterCore)
        bestInput.fire = false;
        return result;
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

    // === HOST: save host input with pulse buffering ===

    setHostInput(input) {
        this._hostInputCurrent = input;
    }

    // === HOST: queue event for next snapshot ===

    queueEvent(evt) {
        this._pendingEvents.push(evt);
    }

    // === v18: SERVER RECONCILIATION HELPERS ===

    /**
     * Get all inputs that haven't been acknowledged by the server yet.
     * @param {number} lastAckedSeq - The last input sequence number the server processed
     * @returns {Array} Array of unacknowledged inputs
     */
    getUnackedInputs(lastAckedSeq) {
        return this.inputHistory.filter(i => i.seq > lastAckedSeq);
    }

    /**
     * Remove inputs that have been acknowledged by the server.
     * v18 FIX: Simplified - just remove all acked inputs (no longer need for comparison)
     * @param {number} lastAckedSeq - The last input sequence number the server processed
     */
    clearAckedInputs(lastAckedSeq) {
        // v18 FIX: Simple filter - remove all acked, keep only unacked
        // Old logic had off-by-one bug when all inputs were acked (idx === -1)
        this.inputHistory = this.inputHistory.filter(i => i.seq > lastAckedSeq);
    }

    /**
     * v19: Store predicted state for a specific input sequence.
     * Called by GameScene after physics tick to record what we predicted.
     * @param {number} seq - Input sequence number
     * @param {number} x - Predicted X position
     * @param {number} y - Predicted Y position
     * @param {object} vel - Predicted velocity { x, y }
     * @param {boolean} grounded - Predicted grounded state
     */
    storePredictedState(seq, x, y, vel, grounded) {
        const entry = this.inputHistory.find(i => i.seq === seq);
        if (entry) {
            entry.predictedPos = { x, y };
            entry.predictedVel = { x: vel.x, y: vel.y };
            entry.predictedGrounded = grounded;
        }
    }

    /**
     * Find the predicted state for a specific acknowledged sequence.
     * Used for comparing server state with our prediction at that point.
     * @param {number} seq - Input sequence number
     * @returns {object|null} { pos, vel, grounded } or null if not found
     */
    getPredictedStateForSeq(seq) {
        const entry = this.inputHistory.find(i => i.seq === seq);
        if (entry && entry.predictedPos) {
            return {
                pos: entry.predictedPos,
                vel: entry.predictedVel,
                grounded: entry.predictedGrounded
            };
        }
        return null;
    }

    // === DELTA COMPRESSION (host) ===

    /**
     * Compute delta between previous and current full snapshots.
     * Always includes: tick, time, lastInputSeq, player positions, events.
     * Conditionally includes: player non-position fields, snowballs, pickups, score.
     */
    _computeDelta(prev, curr) {
        const delta = {
            type: 'delta',
            tick: curr.tick,
            time: curr.time,
            lastInputSeq: curr.lastInputSeq,
            hostInput: curr.hostInput,  // Teeworlds: always include host input
            events: curr.events  // Always include (one-shot)
        };

        // Players: always send x, y, vx, vy. Only send other fields if changed.
        delta.players = curr.players.map(cp => {
            const pp = prev.players?.find(p => p.id === cp.id);
            const slim = { id: cp.id, x: cp.x, y: cp.y, vx: cp.vx, vy: cp.vy };

            // Include changed fields
            if (!pp || pp.facingRight !== cp.facingRight) slim.facingRight = cp.facingRight;
            if (!pp || pp.health !== cp.health) slim.health = cp.health;
            if (!pp || pp.animation !== cp.animation) slim.animation = cp.animation;
            if (!pp || pp.hookState !== cp.hookState) slim.hookState = cp.hookState;
            if (!pp || pp.hookState !== 'IDLE' || cp.hookState !== 'IDLE') {
                slim.hookPos = cp.hookPos;
                slim.hookAnchorPos = cp.hookAnchorPos;
            }
            if (!pp || pp.grounded !== cp.grounded) slim.grounded = cp.grounded;
            if (!pp || pp.powerup !== cp.powerup) slim.powerup = cp.powerup;
            if (!pp || pp.isDying !== cp.isDying) slim.isDying = cp.isDying;
            if (!pp || pp.isActive !== cp.isActive) slim.isActive = cp.isActive;

            return slim;
        });

        // Snowballs: include only if count or IDs changed
        const prevIds = (prev.snowballs || []).map(s => s.id).join(',');
        const currIds = (curr.snowballs || []).map(s => s.id).join(',');
        if (prevIds !== currIds || curr.snowballs.length > 0) {
            delta.snowballs = curr.snowballs;
        }

        // Pickups: include only if changed
        const prevPickupIds = (prev.pickups || []).map(p => p.id).join(',');
        const currPickupIds = (curr.pickups || []).map(p => p.id).join(',');
        if (prevPickupIds !== currPickupIds) {
            delta.pickups = curr.pickups;
        }

        // Score: include only if changed
        if (prev.score?.hostWins !== curr.score?.hostWins ||
            prev.score?.guestWins !== curr.score?.guestWins) {
            delta.score = curr.score;
        }

        return delta;
    }

    /**
     * Guest: merge a delta snapshot into the last known full state.
     */
    _mergeDelta(base, delta) {
        const merged = { ...base, tick: delta.tick, time: delta.time, lastInputSeq: delta.lastInputSeq, hostInput: delta.hostInput || null };

        // Merge players
        if (delta.players) {
            merged.players = (base.players || []).map(bp => {
                const dp = delta.players.find(p => p.id === bp.id);
                if (!dp) return bp;
                return { ...bp, ...dp };
            });
            // Add any new players from delta
            for (const dp of delta.players) {
                if (!merged.players.find(p => p.id === dp.id)) {
                    merged.players.push(dp);
                }
            }
        }

        // Merge optional fields (only overwrite if present in delta)
        if (delta.snowballs !== undefined) merged.snowballs = delta.snowballs;
        if (delta.pickups !== undefined) merged.pickups = delta.pickups;
        if (delta.score !== undefined) merged.score = delta.score;

        // Events: always from delta
        merged.events = delta.events || [];

        return merged;
    }

    // === DATA RECEIVING ===

    receiveData(fromPeerId, message) {
        if (!message || !message.type) return;

        switch (message.type) {
            case 'input':
                // v18: Host queues inputs for consistent timing
                if (this.isHost && message.data) {
                    // Add to queue with current server tick
                    this.inputQueue.push({
                        seq: message.data.seq,
                        input: message.data,
                        receivedTick: this.serverTick
                    });

                    // Sort by sequence (in case of packet reordering)
                    this.inputQueue.sort((a, b) => a.seq - b.seq);

                    // v25: Aggressive cleanup by age (not just size)
                    // This prevents 56+ inputs accumulating due to network jitter
                    const MAX_INPUT_AGE_TICKS = 48; // ~800ms at 60Hz
                    const currentTick = this.serverTick;
                    this.inputQueue = this.inputQueue.filter(i =>
                        currentTick - i.receivedTick < MAX_INPUT_AGE_TICKS
                    );

                    // Also limit by size as fallback
                    while (this.inputQueue.length > 50) {
                        this.inputQueue.shift();
                    }

                    // Also update lastProcessedSeq for snapshot
                    this.lastProcessedSeq.set('guest', message.data.seq);
                    // Keep latest for fallback
                    this.remoteInputs.set('guest', message.data);
                }
                break;

            case 'snapshot':
                // v17: Guest stores snapshots for interpolation (no time sync complexity)
                if (!this.isHost && message.data) {
                    let fullSnap;
                    if (message.data.type === 'full') {
                        fullSnap = message.data;
                        this._lastFullSnapshot = fullSnap;
                    } else if (message.data.type === 'delta' && this._lastFullSnapshot) {
                        fullSnap = this._mergeDelta(this._lastFullSnapshot, message.data);
                        this._lastFullSnapshot = fullSnap;
                    } else {
                        // No base snapshot to merge with — skip delta
                        break;
                    }

                    this._snapBuffer.push({ time: Date.now(), data: fullSnap });
                    if (this._snapBuffer.length > 10) {
                        this._snapBuffer.shift();
                    }
                }
                break;

            case 'ping':
                // Host: echo back immediately (unreliable — ping samples are replaceable)
                if (this.isHost) {
                    this.broadcastUnreliable({ type: 'pong', t: message.t });
                }
                break;

            case 'pong':
                // Guest: calculate RTT with jitter measurement
                if (!this.isHost) {
                    const rtt = Date.now() - message.t;
                    this._recentPings.push(rtt);
                    if (this._recentPings.length > 10) this._recentPings.shift();  // v18: Keep more samples

                    // Calculate average ping
                    const avg = this._recentPings.reduce((a, b) => a + b, 0) / this._recentPings.length;
                    this.ping = Math.round(avg);

                    // v18: Calculate jitter (standard deviation)
                    const jitter = Math.sqrt(
                        this._recentPings.reduce((sum, p) => sum + Math.pow(p - avg, 2), 0) / this._recentPings.length
                    );

                    // Aggressive render delay — only for remote player interpolation
                    // Min 16ms, max 60ms
                    this.RENDER_DELAY = Math.max(16, Math.min(60,
                        Math.round(avg * 0.3 + jitter * 1.2 + 8)
                    ));
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
