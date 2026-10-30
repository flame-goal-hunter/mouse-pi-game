import { Room } from '@colyseus/core';
import { GameState, Player, Snowball, Pickup } from '../state/GameState.js';
import { SimplePhysicsWorld } from '../physics/SimplePhysicsWorld.js';
import { CharacterCore } from '../physics/CharacterCore.js';
import { loadMap } from '../physics/MapLoader.js';
import { PHYS, GAME, TILE_SIZE, PICKUPS, BOT_NAMES } from '../physics/config.js';
import { BotNav } from '../../../www/js/ai/BotNav.js';
import { BotBrain } from '../../../www/js/ai/BotBrain.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAP_PATH = join(__dirname, '../../../www/assets/maps/ice-arena.json');

const FIXED_DT = 1 / 60;
const FIXED_DT_MS = FIXED_DT * 1000;

export class SnowballRoom extends Room {
    onCreate(options) {
        this.maxClients = 4;
        this.setState(new GameState());
        // Match physics tick (60Hz)
        this.setPatchRate(1000 / 60);

        this.roomCode = String(options?.roomCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
        this.isPrivate = !!options?.isPrivate;
        this.state.roomCode = this.roomCode;
        this.setMetadata({
            roomCode: this.roomCode,
            isPrivate: this.isPrivate
        });

        // Bot configuration:
        // If options.botCount is explicitly provided (0..3), keep that many bots.
        // If not provided (-1 = auto mode for quick play), spawn 1 practice bot when only 1 human is in room,
        // and remove it automatically as soon as another human joins.
        this.explicitBotCount = (options?.botCount !== undefined && options?.botCount !== null && options?.botCount !== '')
            ? Math.max(0, Math.min(3, Number(options.botCount) || 0))
            : -1;

        this.world = new SimplePhysicsWorld(TILE_SIZE);
        const mapInfo = loadMap(MAP_PATH, this.world);
        this.spawnPoints = mapInfo.spawns;
        this.mapPickups = mapInfo.pickups;
        this.waterBounds = mapInfo.waterBounds;
        this.mapWidthPx = mapInfo.width * mapInfo.tileSize;
        this.mapHeightPx = mapInfo.height * mapInfo.tileSize;

        // Build BotNav for server-side bots
        this.botNav = new BotNav();
        this.fakeLayer = {
            getTileAt: (x, y) => {
                const tx = Math.floor(x);
                const ty = Math.floor(y);
                const v = this.world.tileGrid[ty]?.[tx];
                return v ? { index: 1, getCenterX: () => (tx + 0.5) * TILE_SIZE, getCenterY: () => (ty + 0.5) * TILE_SIZE } : null;
            },
            getTileAtWorldXY: (wx, wy) => {
                const tx = Math.floor(wx / TILE_SIZE);
                const ty = Math.floor(wy / TILE_SIZE);
                const v = this.world.tileGrid[ty]?.[tx];
                return v ? { index: 1, getCenterX: () => (tx + 0.5) * TILE_SIZE, getCenterY: () => (ty + 0.5) * TILE_SIZE } : null;
            }
        };
        this.botNav.build(this.fakeLayer, mapInfo.width, mapInfo.height, mapInfo.tileSize);

        // Per-player runtime data (humans + server bots)
        this.cores = new Map();               // id → CharacterCore
        this.bodies = new Map();              // id → SimpleBody
        this.inputs = new Map();              // id → latest input
        this.pendingOneShots = new Map();     // id → { fire, fireAngle, jump, seq }
        this.lastFireTime = new Map();        // id → timestamp
        this.lastDamageTime = new Map();      // id → timestamp of last snowball knockback
        this.deathTimes = new Map();          // id → respawn timestamp
        this.powerupEndTimes = new Map();     // id → expiration timestamp
        this.pickupRespawnTimes = new Map();  // pickup.id → respawn timestamp
        this.botStates = new Map();           // botId → AI state object

        this.nextSnowballId = 1;
        this.nextPickupId = 1;
        this.nextBotIndex = 1;
        this.serverTick = 0;
        this.roundResetTimer = null;

        // Center CTF Golden Cheese runtime state
        this.ctf = {
            homeX: 2520,
            homeY: 655,
            blueBase: { x: 385, y: 1500 },
            redBase: { x: 4655, y: 1500 },
            vx: 0,
            vy: 0,
            carrierHits: 0,
            dropIgnoreSid: '',
            dropIgnoreUntil: 0,
            droppedAt: 0
        };
        this.state.flagState = 'HOME';
        this.state.flagX = this.ctf.homeX;
        this.state.flagY = this.ctf.homeY;
        this.state.flagCarrierSid = '';

        // Initialize pickups in state
        for (const sp of this.mapPickups) {
            const p = new Pickup();
            p.id = this.nextPickupId++;
            p.x = sp.x;
            p.y = sp.y;
            p.type = sp.type;
            p.active = true;
            this.state.pickups.push(p);
        }

        // Scene stub for CharacterCore & BotBrain
        this.stubScene = {
            time: { now: 0 },
            botNav: this.botNav,
            platformLayer: this.fakeLayer,
            map: { widthInPixels: this.mapWidthPx, heightInPixels: this.mapHeightPx },
            getSpeedMultiplier: (sprite) => {
                const p = sprite?.playerRef;
                return (p && p.powerup === 'speed') ? PICKUPS.speed.speedMultiplier : 1;
            },
            playSpatialSound: (name, x, y, vol) => {
                this.broadcast('sound', { name, x, y, vol });
            }
        };

        // Client message handlers
        this.onMessage('input', (client, msg) => {
            if (!msg || typeof msg !== 'object') return;
            this.inputs.set(client.sessionId, msg);
            // Preserve one-shot actions (fire / jump / hook / seq) across sub-frame messages
            const prev = this.pendingOneShots.get(client.sessionId) || {
                fire: false,
                fireAngle: null,
                jump: false,
                hook: false,
                hookTarget: null,
                seq: 0
            };
            if (msg.fire) {
                prev.fire = true;
                prev.fireAngle = msg.fireAngle ?? prev.fireAngle;
            }
            if (msg.jump) {
                prev.jump = true;
            }
            if (msg.jumpJustPressed) {
                prev.jumpJustPressed = true;
            }
            if (msg.jumpType) {
                prev.jumpType = msg.jumpType;
            }
            if (msg.hookRelease) {
                prev.hookRelease = true;
                prev.hook = false;
            } else if (msg.hook) {
                prev.hook = true;
                if (msg.hookTarget) prev.hookTarget = msg.hookTarget;
            }
            if (typeof msg.seq === 'number' && msg.seq > prev.seq) {
                prev.seq = msg.seq;
            }
            this.pendingOneShots.set(client.sessionId, prev);
        });

        this.onMessage('hello', (client, msg) => {
            const player = this.state.players.get(client.sessionId);
            if (!player || !msg) return;
            if (msg.nickname) player.nickname = String(msg.nickname).slice(0, 16);
            if (msg.character) player.character = msg.character === 2 ? 2 : 1;
        });

        this.onMessage('setBots', (_client, msg) => {
            if (msg && typeof msg.botCount === 'number') {
                this.explicitBotCount = Math.max(0, Math.min(3, Math.floor(msg.botCount)));
                this._reconcileBots();
            }
        });

        // Echo ping (client uses for RTT measurement)
        this.onMessage('ping', (client, msg) => {
            client.send('pong', msg);
        });

        this.onMessage('*', () => {});

        // Fixed-timestep simulation @ 60Hz
        this.setSimulationInterval((dt) => this.update(dt), FIXED_DT_MS);

        console.log(`[SnowballRoom] created code="${this.roomCode}" private=${this.isPrivate} spawns=${this.spawnPoints.length} pickups=${this.mapPickups.length}`);
    }

    onJoin(client, options) {
        console.log('[SnowballRoom] join', client.sessionId, options?.nickname, 'code:', this.roomCode);

        if (options?.botCount !== undefined && options?.botCount !== null && options?.botCount !== '' && this.clients.length === 1) {
            this.explicitBotCount = Math.max(0, Math.min(3, Number(options.botCount) || 0));
        }

        this._createPlayerEntity(client.sessionId, {
            nickname: String(options?.nickname || 'Игрок').slice(0, 16),
            character: (options?.character === 2 ? 2 : 1),
            isBot: false
        });

        this._reconcileBots();
    }

    onLeave(client) {
        console.log('[SnowballRoom] leave', client.sessionId);
        this._removePlayerEntity(client.sessionId);
        this._reconcileBots();
    }

    onDispose() {
        if (this.roundResetTimer) {
            clearTimeout(this.roundResetTimer);
            this.roundResetTimer = null;
        }
        console.log('[SnowballRoom] disposed');
    }

    _createPlayerEntity(id, { nickname, character, isBot }) {
        const player = new Player();
        const usedColors = new Set();
        for (const [, p] of this.state.players) usedColors.add(p.colorIndex);
        let colorIdx = 0;
        while (usedColors.has(colorIdx) && colorIdx < 4) colorIdx++;

        const spawn = this._pickBestSpawn();
        player.x = spawn.x;
        player.y = spawn.y - 35;
        player.character = character;
        player.nickname = nickname;
        player.health = GAME.MAX_HEALTH;
        player.isBot = !!isBot;
        player.colorIndex = colorIdx % 4;
        this.state.players.set(id, player);

        const body = this.world.createBody(id, player.x, player.y, 25, 30, 1);
        this.bodies.set(id, body);

        const core = new CharacterCore();
        const stubSprite = {
            x: player.x,
            y: player.y,
            playerRef: player,
            getData: () => undefined,
            setData: () => {}
        };
        core.init(body, this.world, this.stubScene, stubSprite);
        // Server broadcasts spatial sounds via stubScene.playSpatialSound
        core.suppressSounds = false;
        this.cores.set(id, core);

        this.inputs.set(id, idleInput());
        this.pendingOneShots.set(id, { fire: false, fireAngle: null, jump: false, seq: 0 });
    }

    _removePlayerEntity(id) {
        this.state.players.delete(id);
        if (this.bodies.has(id)) {
            this.world.removeBody(id);
            this.bodies.delete(id);
        }
        this.cores.delete(id);
        this.inputs.delete(id);
        this.pendingOneShots.delete(id);
        this.lastFireTime.delete(id);
        this.deathTimes.delete(id);
        this.powerupEndTimes.delete(id);
        this.botStates.delete(id);
    }

    _reconcileBots() {
        let humanCount = 0;
        const botIds = [];
        for (const [sid, p] of this.state.players) {
            if (p.isBot) botIds.push(sid);
            else humanCount++;
        }

        if (humanCount === 0) {
            for (const bid of botIds) this._removePlayerEntity(bid);
            return;
        }

        let desiredBots = 0;
        if (this.explicitBotCount >= 0) {
            desiredBots = Math.min(this.explicitBotCount, Math.max(0, 4 - humanCount));
        } else {
            // Auto mode: 1 bot when solo in room so player has someone to fight while waiting
            desiredBots = (humanCount === 1) ? 1 : 0;
        }

        while (botIds.length > desiredBots) {
            const removeId = botIds.pop();
            this._removePlayerEntity(removeId);
        }

        const usedNames = new Set();
        for (const [, p] of this.state.players) usedNames.add(p.nickname);

        while (botIds.length < desiredBots) {
            const botId = `bot_${this.nextBotIndex++}`;
            const avail = BOT_NAMES.filter(n => !usedNames.has(n));
            const botName = avail.length > 0
                ? avail[Math.floor(Math.random() * avail.length)]
                : `Бот ${this.nextBotIndex}`;
            usedNames.add(botName);

            const botChar = ( (humanCount + botIds.length) % 2 === 0 ) ? 1 : 2;
            this._createPlayerEntity(botId, {
                nickname: botName,
                character: botChar,
                isBot: true
            });
            this.botStates.set(botId, {
                dir: Math.random() > 0.5 ? 1 : -1,
                nextDecisionAt: 0,
                jumpCooldownAt: 0,
                stuckTicks: 0,
                lastX: 0
            });
            botIds.push(botId);
        }
    }

    _pickBestSpawn() {
        if (!this.spawnPoints || this.spawnPoints.length === 0) {
            return { x: 455, y: 1540 };
        }
        let bestSpawn = this.spawnPoints[0];
        let bestMinDist = -1;
        for (const sp of this.spawnPoints) {
            let minDist = Infinity;
            for (const [, p] of this.state.players) {
                if (p.isDying) continue;
                const d = Math.hypot(p.x - sp.x, p.y - sp.y);
                if (d < minDist) minDist = d;
            }
            if (minDist > bestMinDist) {
                bestMinDist = minDist;
                bestSpawn = sp;
            }
        }
        return bestSpawn;
    }

    update(dtMs) {
        this.serverTick++;
        this.state.tick = this.serverTick;
        const now = Date.now();
        this.stubScene.time.now = now;

        // 0. Update powerup expirations & pickup respawns
        for (const [sid, expireAt] of this.powerupEndTimes) {
            if (now >= expireAt) {
                this.powerupEndTimes.delete(sid);
                const p = this.state.players.get(sid);
                if (p) p.powerup = '';
            }
        }
        for (const [pickupId, respawnAt] of this.pickupRespawnTimes) {
            if (now >= respawnAt) {
                this.pickupRespawnTimes.delete(pickupId);
                const pk = this.state.pickups.find(item => item.id === pickupId);
                if (pk) pk.active = true;
            }
        }

        // 1. Update AI bots & apply inputs to all characters
        for (const [sessionId, player] of this.state.players) {
            if (player.isDying) {
                const respawnAt = this.deathTimes.get(sessionId);
                if (respawnAt && now >= respawnAt) {
                    this.respawnPlayer(sessionId);
                }
                continue;
            }

            const core = this.cores.get(sessionId);
            const body = this.bodies.get(sessionId);
            if (!core || !body) continue;

            let input;
            let clientJumpType = null;
            if (player.isBot) {
                input = this._computeBotInput(sessionId, player, body, core, now);
            } else {
                const raw = this.inputs.get(sessionId) || idleInput();
                const oneshot = this.pendingOneShots.get(sessionId);
                clientJumpType = oneshot?.jumpType || raw.jumpType || null;
                // Do not let hookRelease cancel a rope-jump before processJump runs!
                const hookRel = clientJumpType === 'rope' ? false : !!(raw.hookRelease || oneshot?.hookRelease);
                input = {
                    direction: raw.direction || 0,
                    jump: !!(raw.jump || oneshot?.jump || clientJumpType),
                    jumpJustPressed: !!(raw.jumpJustPressed || oneshot?.jumpJustPressed || clientJumpType),
                    hook: hookRel ? false : !!(raw.hook || oneshot?.hook),
                    hookRelease: hookRel,
                    hookTarget: raw.hookTarget || oneshot?.hookTarget || null,
                    fire: !!(raw.fire || oneshot?.fire),
                    fireAngle: oneshot?.fire ? (oneshot.fireAngle ?? raw.fireAngle) : raw.fireAngle,
                    strength: raw.strength || 1
                };
                if (oneshot) {
                    if (oneshot.seq > player.lastSeq) {
                        player.lastSeq = oneshot.seq;
                    }
                    oneshot.fire = false;
                    oneshot.jump = false;
                    oneshot.jumpJustPressed = false;
                    oneshot.jumpType = null;
                    oneshot.hook = false;
                    oneshot.hookRelease = false;
                    oneshot.hookTarget = null;
                }
                if (raw) {
                    raw.jumpJustPressed = false;
                    raw.jumpType = null;
                    raw.hookRelease = false;
                }
            }

            // Extra air jump if player has doublejump powerup
            if (player.powerup === 'doublejump' && !core.grounded && core.airJumpUsed && input.jump && !core._extraJumpUsed) {
                core.airJumpUsed = false;
                core._extraJumpUsed = true;
            }
            if (core.grounded) {
                core._extraJumpUsed = false;
            }

            core.tick(input, FIXED_DT_MS);

            // Guarantee jump & double-jump state stays 100% synchronized with client prediction!
            if (clientJumpType) {
                if (!core.lastJumpType) {
                    body.vy = PHYS.JUMP_FORCE;
                    if (clientJumpType === 'rope') {
                        body.vx *= 1.06;
                        core.releaseHook();
                        core._hookHoldMs = 0;
                        core.hookCooldown = Math.max(core.hookCooldown, PHYS.HOOK_COOLDOWN * 0.5);
                    }
                    core.jumpBuffer = 0;
                    core.coyoteTime = 0;
                    core.canJump = false;
                    core.grounded = false;
                    body.grounded = false;
                    body.wasGrounded = false;
                    body.onSlope = false;
                }
                core.airJumpUsed = (clientJumpType === 'air');
            }

            // Fire snowball
            if (input.fire) {
                const last = this.lastFireTime.get(sessionId) || 0;
                if (now - last >= PHYS.SNOWBALL_FIRE_RATE) {
                    this.lastFireTime.set(sessionId, now);
                    this.fireSnowball(sessionId, player, input.fireAngle);
                }
                input.fire = false;
            }

            if (input.direction !== 0) {
                player.facingRight = input.direction > 0;
            }
        }

        // 2. Step physics world
        this.world.step(FIXED_DT);

        // 3. Sync body state -> Schema & check water/world bounds + pickups
        for (const [sessionId, player] of this.state.players) {
            if (player.isDying) continue;
            const body = this.bodies.get(sessionId);
            const core = this.cores.get(sessionId);
            if (!body || !core) continue;

            // Smoothly converge server physics body toward validated client-predicted ledge landings
            // so a 2-pixel timing offset never drops the player off an upper platform on the server!
            if (!player.isBot && (now - (this.lastDamageTime.get(sessionId) || 0) > 450)) {
                const raw = this.inputs.get(sessionId);
                if (raw && typeof raw.clientX === 'number' && typeof raw.clientY === 'number') {
                    const errDist = Math.hypot(raw.clientX - body.x, raw.clientY - body.y);
                    if (errDist > 0.5 && errDist < 135) {
                        const blend = (raw.clientGrounded && !body.grounded) ? 0.65 : 0.35;
                        const nextX = body.x + (raw.clientX - body.x) * blend;
                        const nextY = body.y + (raw.clientY - body.y) * blend;
                        const probe = { x: nextX, y: nextY, halfW: body.halfW, halfH: body.halfH };
                        if (!this.world._bodyOverlapsSolid(probe)) {
                            body.x = nextX;
                            body.y = nextY;
                            if (typeof raw.clientVx === 'number') {
                                body.vx = body.vx * (1 - blend) + raw.clientVx * blend;
                            }
                            if (typeof raw.clientVy === 'number') {
                                body.vy = body.vy * (1 - blend) + raw.clientVy * blend;
                            }
                            if (raw.clientGrounded && this.world.isGrounded(body)) {
                                body.grounded = true;
                                core.grounded = true;
                                core.canJump = true;
                                core.airJumpUsed = false;
                                if (body.vy > 0) body.vy = 0;
                            }
                        }
                    }
                }
            }

            // Clamp horizontal bounds
            if (body.x < 35) { body.x = 35; body.vx = 0; }
            if (body.x > this.mapWidthPx - 35) { body.x = this.mapWidthPx - 35; body.vx = 0; }

            player.x = body.x;
            player.y = body.y;
            player.vx = body.vx;
            player.vy = body.vy;
            player.grounded = body.grounded;

            // Animation
            if (!body.grounded) player.animation = 'jump';
            else if (Math.abs(body.vx) > 10) player.animation = 'walk';
            else player.animation = 'idle';

            // Hook state
            player.hookState = core.hookState || 'IDLE';
            if (core.hookPos) {
                player.hookX = core.hookPos.x;
                player.hookY = core.hookPos.y;
            }
            if (core.hookAnchorPos) {
                player.hookAnchorX = core.hookAnchorPos.x;
                player.hookAnchorY = core.hookAnchorPos.y;
            }

            // Check water pit & bottom bounds hazard
            const wb = this.waterBounds;
            const inWater = wb &&
                player.x >= wb.minX + 10 &&
                player.x <= wb.maxX - 10 &&
                player.y + 18 >= wb.minY;
            const fellOut = player.y > this.mapHeightPx - 40;
            if (inWater || fellOut) {
                this.killPlayer(sessionId, player, null);
                continue;
            }

            // Check pickup collection
            for (let i = 0; i < this.state.pickups.length; i++) {
                const pk = this.state.pickups[i];
                if (!pk.active) continue;
                const dx = player.x - pk.x;
                const dy = player.y - pk.y;
                if (dx * dx + dy * dy < 52 * 52) {
                    this.collectPickup(sessionId, player, pk, now);
                }
            }
        }

        // 4. Update snowballs & Center CTF Golden Cheese
        this.updateSnowballs(now);
        this.updateCTF(now);
    }

    _getTargetBaseForPlayer(player) {
        return ((player.colorIndex || 0) % 2 === 0) ? this.ctf.blueBase : this.ctf.redBase;
    }

    _dropServerCheese(carrierSid, hitVx = 0, now = Date.now()) {
        if (this.state.flagState !== 'CARRIED') return;
        const p = carrierSid ? this.state.players.get(carrierSid) : null;
        this.state.flagState = 'DROPPED';
        this.state.flagCarrierSid = '';
        this.state.flagX = p ? p.x : this.state.flagX;
        this.state.flagY = p ? p.y - 24 : this.state.flagY;
        const dir = hitVx !== 0 ? Math.sign(hitVx) : (Math.random() > 0.5 ? 1 : -1);
        this.ctf.vx = dir * 175;
        this.ctf.vy = -410;
        this.ctf.carrierHits = 0;
        this.ctf.dropIgnoreSid = carrierSid || '';
        this.ctf.dropIgnoreUntil = now + 1350;
        this.ctf.droppedAt = now;
        this.broadcast('flagEvent', { action: 'drop', carrierSid: carrierSid || '' });
    }

    _resetServerCheese(announce = false) {
        this.state.flagState = 'HOME';
        this.state.flagCarrierSid = '';
        this.state.flagX = this.ctf.homeX;
        this.state.flagY = this.ctf.homeY;
        this.ctf.vx = 0;
        this.ctf.vy = 0;
        this.ctf.carrierHits = 0;
        this.ctf.dropIgnoreSid = '';
        this.ctf.dropIgnoreUntil = 0;
        if (announce) {
            this.broadcast('flagEvent', { action: 'return' });
        }
    }

    updateCTF(now) {
        if (this.roundResetTimer) return;

        if (this.state.flagState === 'CARRIED') {
            const cSid = this.state.flagCarrierSid;
            const carrier = cSid ? this.state.players.get(cSid) : null;
            if (!carrier || carrier.isDying || carrier.health <= 0) {
                this._dropServerCheese(cSid, 0, now);
            } else {
                this.state.flagX = carrier.x;
                this.state.flagY = carrier.y - 60;
                const base = this._getTargetBaseForPlayer(carrier);
                if (Math.hypot(carrier.x - base.x, carrier.y - base.y) < 92) {
                    // Base Capture!
                    carrier.score++;
                    this._resetServerCheese(false);
                    this.broadcast('flagEvent', {
                        action: 'capture',
                        carrierSid: cSid,
                        carrierName: carrier.nickname
                    });
                    if (carrier.score >= GAME.WIN_SCORE && !this.roundResetTimer) {
                        this.state.winnerName = carrier.nickname;
                        this.broadcast('roundWin', {
                            winnerSid: cSid,
                            winnerName: carrier.nickname
                        });
                        this.roundResetTimer = setTimeout(() => {
                            this.roundResetTimer = null;
                            this._resetRound();
                        }, 3500);
                    }
                    return;
                }
            }
        } else if (this.state.flagState === 'DROPPED') {
            this.ctf.vy = Math.min(680, (this.ctf.vy || 0) + 920 * FIXED_DT);
            const nextX = this.state.flagX + (this.ctf.vx || 0) * FIXED_DT;
            if (this.world._testPoint(nextX, this.state.flagY)) {
                this.ctf.vx = -(this.ctf.vx || 0) * 0.6;
            } else {
                this.state.flagX = Math.max(60, Math.min(this.mapWidthPx - 60, nextX));
            }
            const nextY = this.state.flagY + this.ctf.vy * FIXED_DT;
            if (this.ctf.vy >= 0) {
                const gY = this.world._findGroundAt(this.state.flagX, nextY + 20, 26);
                if (gY !== null) {
                    this.state.flagY = gY - 22;
                    this.ctf.vy = 0;
                    this.ctf.vx *= 0.82;
                } else {
                    this.state.flagY = nextY;
                }
            } else {
                this.state.flagY = nextY;
            }

            const inWater = this.waterBounds && this.state.flagY >= this.waterBounds.minY - 10;
            const timedOut = (now - (this.ctf.droppedAt || 0)) > 12000;
            if (inWater || timedOut || this.state.flagY > this.mapHeightPx - 60) {
                this._resetServerCheese(true);
            }
        }

        if (this.state.flagState === 'HOME' || this.state.flagState === 'DROPPED') {
            for (const [sid, p] of this.state.players) {
                if (p.isDying || p.health <= 0) continue;
                if (sid === this.ctf.dropIgnoreSid && now < this.ctf.dropIgnoreUntil) continue;
                if (Math.hypot(p.x - this.state.flagX, p.y - this.state.flagY) < 62) {
                    this.state.flagState = 'CARRIED';
                    this.state.flagCarrierSid = sid;
                    this.state.flagX = p.x;
                    this.state.flagY = p.y - 60;
                    this.ctf.carrierHits = 0;
                    this.broadcast('flagEvent', {
                        action: 'grab',
                        carrierSid: sid,
                        carrierName: p.nickname
                    });
                    break;
                }
            }
        }
    }

    _getOrCreateEntityProxy(sid) {
        if (!this.entityProxies) this.entityProxies = new Map();
        let proxy = this.entityProxies.get(sid);
        if (!proxy) {
            const room = this;
            proxy = {
                sessionId: sid,
                get active() {
                    const p = room.state.players.get(sid);
                    return !!(p && !p.isDying && p.health > 0);
                },
                get isDying() {
                    const p = room.state.players.get(sid);
                    return !p || !!p.isDying;
                },
                get x() {
                    const b = room.bodies.get(sid);
                    const p = room.state.players.get(sid);
                    return b ? b.x : (p ? p.x : 0);
                },
                get y() {
                    const b = room.bodies.get(sid);
                    const p = room.state.players.get(sid);
                    return b ? b.y : (p ? p.y : 0);
                },
                get vx() {
                    const b = room.bodies.get(sid);
                    return b ? b.vx : 0;
                },
                get vy() {
                    const b = room.bodies.get(sid);
                    return b ? b.vy : 0;
                },
                get simpleBody() {
                    return room.bodies.get(sid);
                },
                get core() {
                    return room.cores.get(sid);
                },
                get health() {
                    const p = room.state.players.get(sid);
                    return p ? p.health : 0;
                },
                getData(k) {
                    if (k === 'health') {
                        const p = room.state.players.get(sid);
                        return p ? p.health : 0;
                    }
                    return undefined;
                }
            };
            this.entityProxies.set(sid, proxy);
        }
        return proxy;
    }

    _computeBotInput(botId, _botPlayer, _body, _core, _now) {
        let st = this.botStates.get(botId);
        if (!st || !st.brain) {
            st = {
                brain: new BotBrain(this.stubScene)
            };
            this.botStates.set(botId, st);
        }

        const botProxy = this._getOrCreateEntityProxy(botId);
        const botStatePlayer = this.state.players.get(botId);
        if (botStatePlayer) {
            botProxy.ctfTargetBase = this._getTargetBaseForPlayer(botStatePlayer);
        }

        // Collect persistent live proxies for all other alive players/bots
        const allEnemies = [];
        for (const [sid, other] of this.state.players) {
            if (sid === botId || other.isDying || other.health <= 0) continue;
            allEnemies.push(this._getOrCreateEntityProxy(sid));
        }

        const carrierSid = this.state.flagCarrierSid;
        const carrierProxy = (this.state.flagState === 'CARRIED' && carrierSid)
            ? this._getOrCreateEntityProxy(carrierSid)
            : null;

        const sceneAdapter = {
            botNav: this.botNav,
            platformLayer: this.fakeLayer,
            map: this.stubScene.map,
            player: null,
            guestPlayer: null,
            bots: allEnemies,
            pickups: this.state.pickups,
            snowballs: this.state.snowballs,
            ctf: {
                state: this.state.flagState,
                x: this.state.flagX,
                y: this.state.flagY,
                carrierSid,
                carrier: carrierProxy,
                blueBase: this.ctf.blueBase,
                redBase: this.ctf.redBase
            }
        };

        return st.brain.update(botProxy, sceneAdapter, FIXED_DT_MS);
    }

    collectPickup(sessionId, player, pk, now) {
        pk.active = false;
        this.pickupRespawnTimes.set(pk.id, now + PICKUPS.RESPAWN_TIME);

        if (pk.type === 'health') {
            player.health = Math.min(GAME.MAX_HEALTH, player.health + PICKUPS.health.heal);
        } else {
            player.powerup = pk.type;
            const dur = PICKUPS[pk.type]?.duration || 8000;
            this.powerupEndTimes.set(sessionId, now + dur);
        }

        this.broadcast('pickup', {
            id: pk.id,
            x: pk.x,
            y: pk.y,
            type: pk.type,
            sessionId
        });
    }

    fireSnowball(sessionId, player, angle) {
        if (angle === null || angle === undefined) {
            angle = this.autoAimAngle(player) ?? (player.facingRight ? 0 : Math.PI);
        }
        const speed = PHYS.SNOWBALL_SPEED;
        const sb = new Snowball();
        sb.id = this.nextSnowballId++;
        sb.x = player.x + Math.cos(angle) * 45;
        sb.y = player.y - 10 + Math.sin(angle) * 45;
        sb.vx = Math.cos(angle) * speed + player.vx * 0.4;
        sb.vy = Math.sin(angle) * speed + player.vy * 0.25;
        sb.hasFire = player.powerup === 'fire';
        sb._owner = sessionId;
        sb._spawnAt = Date.now();
        this.state.snowballs.push(sb);

        this.broadcast('sound', {
            name: 'sfx-snowball-shot',
            x: player.x,
            y: player.y,
            vol: 0.4
        });
    }

    autoAimAngle(shooter) {
        let bestAngle = null;
        let bestDist = Infinity;
        for (const [, target] of this.state.players) {
            if (target === shooter || target.isDying) continue;
            const dx = target.x - shooter.x;
            const dy = target.y - shooter.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < bestDist) {
                bestDist = d;
                bestAngle = Math.atan2(dy - Math.min(120, d * 0.12), dx);
            }
        }
        return bestAngle;
    }

    updateSnowballs(now) {
        const remove = [];
        for (let i = 0; i < this.state.snowballs.length; i++) {
            const sb = this.state.snowballs[i];
            if (now - (sb._spawnAt || now) > PHYS.SNOWBALL_LIFETIME) {
                remove.push(i);
                continue;
            }
            sb.vy += PHYS.GRAVITY * PHYS.SNOWBALL_GRAVITY_SCALE * FIXED_DT;
            sb.x += sb.vx * FIXED_DT;
            sb.y += sb.vy * FIXED_DT;

            if (sb.x < 0 || sb.x > this.mapWidthPx || sb.y > this.mapHeightPx) {
                remove.push(i);
                continue;
            }

            if (this.world._testPoint(sb.x, sb.y)) {
                this.broadcast('splat', { x: sb.x, y: sb.y });
                remove.push(i);
                continue;
            }

            for (const [sid, target] of this.state.players) {
                if (sid === sb._owner || target.isDying) continue;
                const dx = target.x - sb.x;
                const dy = target.y - sb.y;
                if (dx * dx + dy * dy < 38 * 38) {
                    this.applyDamage(sid, target, sb);
                    remove.push(i);
                    break;
                }
            }
        }
        for (let j = remove.length - 1; j >= 0; j--) {
            this.state.snowballs.splice(remove[j], 1);
        }
    }

    applyDamage(targetSid, target, snowball) {
        let dmg = PHYS.SNOWBALL_DAMAGE * (snowball.hasFire ? 2 : 1);
        if (target.powerup === 'shield') {
            dmg = Math.max(1, Math.round(dmg * PICKUPS.shield.damageReduction));
        }
        target.health = Math.max(0, target.health - dmg);

        // Apply knockback to target physics body
        this.lastDamageTime.set(targetSid, Date.now());
        const targetBody = this.bodies.get(targetSid);
        if (targetBody) {
            const dirX = Math.sign(snowball.vx || (target.x - snowball.x) || 1);
            targetBody.vx += dirX * 240;
            targetBody.vy = Math.min(targetBody.vy - 150, -120);
        }

        this.broadcast('sound', {
            name: 'sfx-snowball-hit',
            x: target.x,
            y: target.y,
            vol: 0.65
        });

        if (target.health <= 0 && !target.isDying) {
            this.killPlayer(targetSid, target, snowball._owner);
        } else {
            // Knock Golden Cheese out of carrier's hands after 2 hits (or 1 fire snowball)
            if (this.state.flagState === 'CARRIED' && this.state.flagCarrierSid === targetSid) {
                this.ctf.carrierHits = (this.ctf.carrierHits || 0) + (snowball.hasFire ? 2 : 1);
                if (this.ctf.carrierHits >= 2) {
                    this._dropServerCheese(targetSid, snowball.vx || 0);
                }
            }
            this.broadcast('hit', { x: target.x, y: target.y, hasFire: snowball.hasFire });
        }
    }

    killPlayer(targetSid, target, killerSid) {
        if (target.isDying) return;
        if (this.state.flagState === 'CARRIED' && this.state.flagCarrierSid === targetSid) {
            this._dropServerCheese(targetSid, 0);
        }
        target.isDying = true;
        target.health = 0;
        target.powerup = '';
        this.powerupEndTimes.delete(targetSid);

        const core = this.cores.get(targetSid);
        if (core) core.releaseHook?.();

        this.deathTimes.set(targetSid, Date.now() + GAME.RESPAWN_TIME);

        if (killerSid && killerSid !== targetSid) {
            const killer = this.state.players.get(killerSid);
            if (killer) {
                killer.score++;
                if (killer.score >= GAME.WIN_SCORE && !this.roundResetTimer) {
                    this.state.winnerName = killer.nickname;
                    this.broadcast('roundWin', {
                        winnerSid: killerSid,
                        winnerName: killer.nickname
                    });
                    this.roundResetTimer = setTimeout(() => {
                        this.roundResetTimer = null;
                        this._resetRound();
                    }, 3500);
                }
            }
        }

        this.broadcast('death', { x: target.x, y: target.y, victimSid: targetSid, killerSid });
    }

    _resetRound() {
        this.state.winnerName = '';
        this._resetServerCheese(false);
        for (const [sid, p] of this.state.players) {
            p.score = 0;
            this.respawnPlayer(sid);
        }
    }

    respawnPlayer(sessionId) {
        const player = this.state.players.get(sessionId);
        const body = this.bodies.get(sessionId);
        const core = this.cores.get(sessionId);
        if (!player || !body) return;

        const spawn = this._pickBestSpawn();
        body.x = spawn.x;
        body.y = spawn.y - 35;
        body.vx = 0;
        body.vy = 0;
        body.grounded = false;

        if (core) core.releaseHook?.();

        player.x = body.x;
        player.y = body.y;
        player.vx = 0;
        player.vy = 0;
        player.health = GAME.MAX_HEALTH;
        player.isDying = false;
        player.hookState = 'IDLE';
        player.powerup = '';

        this.deathTimes.delete(sessionId);
    }
}

function idleInput() {
    return {
        direction: 0,
        jump: false,
        hook: false,
        hookTarget: null,
        fire: false,
        fireAngle: null,
        strength: 1
    };
}
