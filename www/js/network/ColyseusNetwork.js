// ColyseusNetwork — adapter that mimics NetworkManager's interface (for guest only)
// Uses Colyseus client to talk to the authoritative server, exposes:
//   sendInput(input)
//   getInterpolatedSnapshot() → { t, prev, curr }
//   lastSnapshot → latest snapshot
//   update(delta)
//   ping (number)
//   connected (boolean)
//
// All game data lives in server-pushed Colyseus state. We poll state every frame
// into snapshot objects (to keep GameScene's existing rendering code unchanged).

export class ColyseusNetwork {
    constructor() {
        this.client = null;
        this.room = null;
        this.connected = false;
        this.connectionStatus = 'disconnected';
        this.connectError = null;

        this.lastSnapshot = null;
        this._snapBuffer = [];        // [{ time, data }]
        this.RENDER_DELAY = 50;       // ms — interpolation delay
        this.MAX_BUFFER = 12;

        this.ping = 0;
        this._pingSamples = [];
        this._lastPingSent = 0;

        this._lastInputSent = 0;
        this._inputThrottle = 16;     // 60Hz inputs to match server tick rate

        this._sessionId = null;
        this._serverEvents = [];      // queued events received from server (for snapshot.events)
    }

    async connect(url, nickname, character) {
        this.connectionStatus = 'connecting';
        // Wait until Colyseus client library is loaded (ESM module imports asynchronously)
        if (typeof window.Colyseus === 'undefined' || !window.Colyseus.Client) {
            await new Promise((resolve) => {
                if (typeof window.Colyseus !== 'undefined' && window.Colyseus.Client) return resolve();
                const onReady = () => { window.removeEventListener('colyseus-ready', onReady); resolve(); };
                window.addEventListener('colyseus-ready', onReady);
                // safety timeout
                setTimeout(resolve, 5000);
            });
        }
        if (!window.Colyseus || !window.Colyseus.Client) {
            this.connectError = 'Colyseus library not loaded';
            this.connectionStatus = 'error';
            return false;
        }
        this.client = new window.Colyseus.Client(url);
        try {
            this.room = await this.client.joinOrCreate('snowball', { nickname, character });
            this._sessionId = this.room.sessionId;
            this.connected = true;
            this.connectionStatus = 'connected';
            this._wireListeners();
            console.log('[ColyseusNetwork] connected, sessionId:', this._sessionId);
            return true;
        } catch (err) {
            this.connectError = err?.message || String(err);
            this.connectionStatus = 'error';
            console.error('[ColyseusNetwork] connect failed:', err);
            return false;
        }
    }

    _wireListeners() {
        // Rebuild snapshot ONLY when server state actually changes (not every frame)
        this.room.onStateChange(() => {
            const snap = this._buildSnapshotFromState();
            if (snap) {
                this.lastSnapshot = snap;
                this._snapBuffer.push({ time: snap.time, data: snap });
                if (this._snapBuffer.length > this.MAX_BUFFER) this._snapBuffer.shift();
            }
        });

        // Server events (hit, death, sound)
        this.room.onMessage('hit', (msg) => {
            this._serverEvents.push({ type: 'hitEffect', x: msg.x, y: msg.y, hasFire: msg.hasFire });
        });
        this.room.onMessage('death', (msg) => {
            this._serverEvents.push({ type: 'deathEffect', x: msg.x, y: msg.y });
        });
        this.room.onMessage('sound', (msg) => {
            this._serverEvents.push({ type: 'sound', name: msg.name, x: msg.x, y: msg.y, vol: msg.vol });
        });
        this.room.onMessage('pong', (msg) => {
            const rtt = Date.now() - msg.t;
            this._pingSamples.push(rtt);
            if (this._pingSamples.length > 10) this._pingSamples.shift();
            this.ping = Math.round(this._pingSamples.reduce((a, b) => a + b, 0) / this._pingSamples.length);
        });

        this.room.onLeave((code) => {
            console.log('[ColyseusNetwork] left room, code:', code);
            this.connected = false;
            this.connectionStatus = 'disconnected';
        });

        this.room.onError((code, msg) => {
            console.error('[ColyseusNetwork] room error', code, msg);
            this.connected = false;
            this.connectionStatus = 'error';
        });
    }

    /**
     * Read current room.state into a plain snapshot object compatible with
     * the format GameScene expects (mirrors host-mode buildSnapshot).
     */
    _buildSnapshotFromState() {
        if (!this.room) return null;
        const state = this.room.state;

        const players = [];
        state.players.forEach((p, sid) => {
            players.push({
                id: sid === this._sessionId ? 'guest' : 'host',
                sessionId: sid,
                x: p.x,
                y: p.y,
                vx: Math.round(p.vx * 256),     // matches host wire format
                vy: Math.round(p.vy * 256),
                facingRight: p.facingRight,
                grounded: p.grounded,
                health: p.health,
                animation: p.animation,
                hookState: p.hookState,
                hookPos: (p.hookState !== 'IDLE') ? { x: p.hookX, y: p.hookY } : null,
                hookAnchorPos: (p.hookState === 'ATTACHED') ? { x: p.hookAnchorX, y: p.hookAnchorY } : null,
                isDying: p.isDying,
                isActive: !p.isDying,
                powerup: p.powerup || null,
                nickname: p.nickname,
                character: p.character
            });
        });

        const snowballs = [];
        state.snowballs.forEach((sb) => {
            snowballs.push({
                id: String(sb.id),
                x: sb.x,
                y: sb.y,
                hasFire: sb.hasFire
            });
        });

        const pickups = [];
        state.pickups.forEach((pk) => {
            if (!pk.active) return;
            pickups.push({ id: String(pk.id), x: pk.x, y: pk.y, type: pk.type });
        });

        const events = this._serverEvents.splice(0);

        return {
            tick: state.tick,
            time: Date.now(),
            players,
            snowballs,
            pickups,
            score: { hostWins: state.scoreHost, guestWins: state.scoreGuest },
            events
        };
    }

    update(_delta) {
        if (!this.connected || !this.room) return;

        // Periodic ping (snapshot is rebuilt by onStateChange listener, not here)
        const now = Date.now();
        if (now - this._lastPingSent > 1000) {
            this._lastPingSent = now;
            try { this.room.send('ping', { t: now }); } catch (e) {}
        }
    }

    sendInput(input) {
        if (!this.connected || !this.room) return null;
        const now = Date.now();
        if (now - this._lastInputSent < this._inputThrottle) return null;
        this._lastInputSent = now;
        try {
            this.room.send('input', {
                direction: input.direction || 0,
                jump: !!input.jump,
                hook: !!input.hook,
                hookTarget: input.hookTarget || null,
                fire: !!input.fire,
                fireAngle: input.fireAngle ?? null,
                strength: input.strength || 1
            });
        } catch (e) {}
        return null;
    }

    getInterpolatedSnapshot() {
        if (this._snapBuffer.length < 2) return null;
        const renderTime = Date.now() - this.RENDER_DELAY;

        // Find pair of snapshots surrounding renderTime
        let prev = this._snapBuffer[0];
        let curr = this._snapBuffer[1];
        for (let i = 0; i < this._snapBuffer.length - 1; i++) {
            if (this._snapBuffer[i].time <= renderTime && this._snapBuffer[i + 1].time >= renderTime) {
                prev = this._snapBuffer[i];
                curr = this._snapBuffer[i + 1];
                break;
            }
        }
        if (curr === prev) {
            curr = this._snapBuffer[this._snapBuffer.length - 1];
            prev = this._snapBuffer[this._snapBuffer.length - 2];
        }

        const duration = Math.max(1, curr.time - prev.time);
        let t = (renderTime - prev.time) / duration;
        if (t < 0) t = 0;
        if (t > 1.2) t = 1.2;

        return { t, prev: prev.data, curr: curr.data };
    }

    queueEvent() { /* no-op on guest */ }

    setHostInput() { /* no-op */ }
    setOnPlayerJoin() {}
    setOnPlayerLeave() {}

    destroy() {
        try { this.room?.leave(); } catch (e) {}
        this.room = null;
        this.client = null;
        this.connected = false;
        this.connectionStatus = 'disconnected';
    }
}
