// ColyseusNetwork — authoritative server network adapter for Snowball Arena
// Supports:
//   - Quick Play & Room-Code matchmaking (filterBy roomCode / isPrivate)
//   - 2–4 players + server AI bots
//   - Input sequence numbers + pulse buffering for Client-Side Prediction & Reconciliation
//   - Snapshot interpolation buffer for remote entities

export class ColyseusNetwork {
    constructor() {
        this.client = null;
        this.room = null;
        this.connected = false;
        this.connectionStatus = 'disconnected';
        this.connectError = null;

        this.lastSnapshot = null;
        this._snapBuffer = [];        // [{ time, data }]
        this.RENDER_DELAY = 48;       // ms — interpolation delay for remote players
        this.MAX_BUFFER = 16;

        this.ping = 0;
        this._pingSamples = [];
        this._lastPingSent = 0;

        this.inputSeq = 0;
        this.lastHookInputSeq = 0;
        this._prevHookSent = false;
        this._lastInputSent = 0;
        this._inputThrottle = 0;      // Send input immediately every frame without dropping ~14ms rAF ticks
        this._pendingFire = false;
        this._pendingFireAngle = null;
        this._pendingJump = false;

        this._sessionId = null;
        this.roomCode = '';
        this._serverEvents = [];      // queued events received from server
    }

    async connect(url, nickname, character, roomOptions = {}) {
        this.connectionStatus = 'connecting';
        if (typeof window.Colyseus === 'undefined' || !window.Colyseus.Client) {
            await new Promise((resolve) => {
                if (typeof window.Colyseus !== 'undefined' && window.Colyseus.Client) return resolve();
                const onReady = () => { window.removeEventListener('colyseus-ready', onReady); resolve(); };
                window.addEventListener('colyseus-ready', onReady);
                setTimeout(resolve, 5000);
            });
        }
        if (!window.Colyseus || !window.Colyseus.Client) {
            this.connectError = 'Colyseus library not loaded';
            this.connectionStatus = 'error';
            return false;
        }

        const roomCode = String(roomOptions.roomCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
        const isPrivate = roomCode.length > 0 ? true : !!roomOptions.isPrivate;
        const joinOpts = {
            nickname,
            character,
            roomCode,
            isPrivate
        };
        if (roomOptions.botCount !== undefined && roomOptions.botCount !== null) {
            joinOpts.botCount = Number(roomOptions.botCount);
        }

        this.client = new window.Colyseus.Client(url);
        try {
            this.room = await this.client.joinOrCreate('snowball', joinOpts);
            this._sessionId = this.room.sessionId;
            this.roomCode = roomCode;
            this.connected = true;
            this.connectionStatus = 'connected';
            this._wireListeners();
            console.log('[ColyseusNetwork] connected, sessionId:', this._sessionId, 'roomCode:', this.roomCode || '(public)');
            return true;
        } catch (err) {
            this.connectError = err?.message || String(err);
            this.connectionStatus = 'error';
            console.error('[ColyseusNetwork] connect failed:', err);
            return false;
        }
    }

    _wireListeners() {
        this.room.onStateChange(() => {
            const snap = this._buildSnapshotFromState();
            if (snap) {
                this.lastSnapshot = snap;
                this._snapBuffer.push({ time: snap.time, data: snap });
                if (this._snapBuffer.length > this.MAX_BUFFER) this._snapBuffer.shift();
            }
        });

        this.room.onMessage('hit', (msg) => {
            this._serverEvents.push({ type: 'hitEffect', x: msg.x, y: msg.y, hasFire: msg.hasFire });
        });
        this.room.onMessage('splat', (msg) => {
            this._serverEvents.push({ type: 'splatEffect', x: msg.x, y: msg.y });
        });
        this.room.onMessage('death', (msg) => {
            this._serverEvents.push({ type: 'deathEffect', x: msg.x, y: msg.y, victimSid: msg.victimSid, killerSid: msg.killerSid });
        });
        this.room.onMessage('pickup', (msg) => {
            this._serverEvents.push({ type: 'pickupEffect', id: msg.id, x: msg.x, y: msg.y, pickupType: msg.type, sessionId: msg.sessionId });
        });
        this.room.onMessage('roundWin', (msg) => {
            this._serverEvents.push({ type: 'roundWin', winnerSid: msg.winnerSid, winnerName: msg.winnerName });
        });
        this.room.onMessage('flagEvent', (msg) => {
            this._serverEvents.push({
                type: 'flagEvent',
                action: msg.action,
                carrierSid: msg.carrierSid || '',
                carrierName: msg.carrierName || ''
            });
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

    _buildSnapshotFromState() {
        if (!this.room) return null;
        const state = this.room.state;

        if (state.roomCode) {
            this.roomCode = state.roomCode;
        }

        const players = [];
        let myScore = 0;
        let bestOpponentScore = 0;

        state.players.forEach((p, sid) => {
            const isSelf = (sid === this._sessionId);
            if (isSelf) myScore = p.score || 0;
            else if ((p.score || 0) > bestOpponentScore) bestOpponentScore = p.score || 0;

            players.push({
                id: isSelf ? 'guest' : 'host',
                isSelf,
                sessionId: sid,
                x: p.x,
                y: p.y,
                vx: Math.round(p.vx * 256),
                vy: Math.round(p.vy * 256),
                rawVx: p.vx,
                rawVy: p.vy,
                facingRight: p.facingRight,
                grounded: p.grounded,
                health: p.health,
                score: p.score || 0,
                animation: p.animation,
                hookState: p.hookState,
                hookPos: (p.hookState !== 'IDLE') ? { x: p.hookX, y: p.hookY } : null,
                hookAnchorPos: (p.hookState === 'ATTACHED') ? { x: p.hookAnchorX, y: p.hookAnchorY } : null,
                isDying: p.isDying,
                isActive: !p.isDying,
                powerup: p.powerup || null,
                nickname: p.nickname,
                character: p.character,
                lastSeq: p.lastSeq || 0,
                isBot: !!p.isBot,
                colorIndex: p.colorIndex || 0
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
            roomCode: state.roomCode || this.roomCode || '',
            winnerName: state.winnerName || '',
            players,
            snowballs,
            pickups,
            ctf: {
                state: state.flagState || 'HOME',
                x: typeof state.flagX === 'number' ? state.flagX : 2520,
                y: typeof state.flagY === 'number' ? state.flagY : 655,
                carrierSid: state.flagCarrierSid || ''
            },
            score: { hostWins: bestOpponentScore, guestWins: myScore },
            events
        };
    }

    update(_delta) {
        if (!this.connected || !this.room) return;

        const now = Date.now();
        if (now - this._lastPingSent > 1000) {
            this._lastPingSent = now;
            try { this.room.send('ping', { t: now }); } catch (e) {}
        }
    }

    sendInput(input) {
        if (!this.connected || !this.room) return null;

        // Buffer one-shot fire & jump pulses between throttled packets
        if (input.fire) {
            this._pendingFire = true;
            this._pendingFireAngle = input.fireAngle ?? null;
        }
        if (input.jump) {
            this._pendingJump = true;
        }
        if (input.jumpJustPressed) {
            this._pendingJumpJustPressed = true;
        }
        if (input.jumpType) {
            this._pendingJumpType = input.jumpType;
        }
        if (input.hookRelease) {
            this._pendingHookRelease = true;
        }

        const now = Date.now();
        if (now - this._lastInputSent < this._inputThrottle && !this._pendingFire && !this._pendingJump && !this._pendingJumpType && !this._pendingHookRelease) {
            return null;
        }
        this._lastInputSent = now;

        this.inputSeq++;
        const hookNow = !!input.hook;
        const hookReleaseToSend = !!(input.hookRelease || this._pendingHookRelease);
        if (hookNow !== this._prevHookSent || hookReleaseToSend) {
            this.lastHookInputSeq = this.inputSeq;
        }
        this._prevHookSent = hookNow;

        const fireToSend = !!(input.fire || this._pendingFire);
        const fireAngleToSend = fireToSend ? (input.fireAngle ?? this._pendingFireAngle ?? null) : null;
        const jumpToSend = !!(input.jump || this._pendingJump);
        const jumpJustToSend = !!(input.jumpJustPressed || this._pendingJumpJustPressed);
        const jumpTypeToSend = input.jumpType || this._pendingJumpType || null;
        this._pendingFire = false;
        this._pendingFireAngle = null;
        this._pendingJump = false;
        this._pendingJumpJustPressed = false;
        this._pendingJumpType = null;
        this._pendingHookRelease = false;

        try {
            this.room.send('input', {
                seq: this.inputSeq,
                direction: input.direction || 0,
                jump: jumpToSend,
                jumpJustPressed: jumpJustToSend,
                jumpType: jumpTypeToSend,
                hook: hookNow,
                hookRelease: hookReleaseToSend,
                hookTarget: input.hookTarget || null,
                fire: fireToSend,
                fireAngle: fireAngleToSend,
                strength: input.strength || 1,
                clientX: typeof input.clientX === 'number' ? Math.round(input.clientX * 10) / 10 : undefined,
                clientY: typeof input.clientY === 'number' ? Math.round(input.clientY * 10) / 10 : undefined,
                clientVx: typeof input.clientVx === 'number' ? Math.round(input.clientVx * 10) / 10 : undefined,
                clientVy: typeof input.clientVy === 'number' ? Math.round(input.clientVy * 10) / 10 : undefined,
                clientGrounded: typeof input.clientGrounded === 'boolean' ? input.clientGrounded : undefined
            });
        } catch (e) {}
        return this.inputSeq;
    }

    setBots(botCount) {
        if (!this.connected || !this.room) return;
        try { this.room.send('setBots', { botCount }); } catch (e) {}
    }

    getInterpolatedSnapshot() {
        if (this._snapBuffer.length < 2) return null;
        const renderTime = Date.now() - this.RENDER_DELAY;

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
