import { Room } from '@colyseus/core';
import { GameState, Player, Snowball, Pickup } from '../state/GameState.js';
import { SimplePhysicsWorld } from '../physics/SimplePhysicsWorld.js';
import { CharacterCore } from '../physics/CharacterCore.js';
import { loadMap } from '../physics/MapLoader.js';
import { PHYS, GAME, TILE_SIZE } from '../physics/config.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAP_PATH = join(__dirname, '../../../www/assets/maps/ice-arena.json');

const FIXED_DT = 1 / 60;
const FIXED_DT_MS = FIXED_DT * 1000;

// Lightweight stub scene/sprite for CharacterCore (which expects Phaser-like context)
function makeStubScene() {
    return {
        playSpatialSound: () => {},          // server has no audio
        time: { now: 0 }
    };
}

export class SnowballRoom extends Room {
    onCreate(options) {
        this.maxClients = 4;
        this.setState(new GameState());
        // Match physics tick (60Hz) — default is 50ms (20Hz) which causes visible jitter
        this.setPatchRate(1000 / 60);

        this.world = new SimplePhysicsWorld(TILE_SIZE);
        const mapInfo = loadMap(MAP_PATH, this.world);
        this.spawnPoints = mapInfo.spawns;
        this.mapPickups = mapInfo.pickups;

        // Per-player runtime data (cores, inputs)
        this.cores = new Map();          // sessionId → CharacterCore
        this.bodies = new Map();         // sessionId → SimpleBody
        this.inputs = new Map();         // sessionId → latest input
        this.lastFireTime = new Map();   // sessionId → timestamp
        this.deathTimes = new Map();     // sessionId → respawn timestamp
        this.nextSnowballId = 1;
        this.nextPickupId = 1;
        this.serverTick = 0;

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

        this.stubScene = makeStubScene();

        // Client message handlers
        this.onMessage('input', (client, msg) => {
            this.inputs.set(client.sessionId, msg);
        });

        this.onMessage('hello', (client, msg) => {
            const player = this.state.players.get(client.sessionId);
            if (!player) return;
            if (msg.nickname) player.nickname = String(msg.nickname).slice(0, 16);
            if (msg.character) player.character = msg.character === 2 ? 2 : 1;
        });

        // Echo ping (client uses for RTT measurement)
        this.onMessage('ping', (client, msg) => {
            client.send('pong', msg);
        });

        // Catch-all to silence "onMessage for X not registered" warnings
        this.onMessage('*', () => {});

        // Fixed-timestep simulation @ 60Hz
        this.setSimulationInterval((dt) => this.update(dt), FIXED_DT_MS);

        console.log('[SnowballRoom] created. Spawns:', this.spawnPoints.length, 'Pickups:', this.mapPickups.length);
    }

    onJoin(client, options) {
        console.log('[SnowballRoom] join', client.sessionId, options?.nickname);

        const player = new Player();
        const idx = this.state.players.size;
        const spawn = this.spawnPoints[idx % this.spawnPoints.length] || { x: 400, y: 300 };
        player.x = spawn.x;
        player.y = spawn.y - 35;
        player.character = (options?.character === 2 ? 2 : 1);
        player.nickname = String(options?.nickname || 'Игрок').slice(0, 16);
        player.health = GAME.MAX_HEALTH;
        this.state.players.set(client.sessionId, player);

        // Create physics body
        const body = this.world.createBody(client.sessionId, player.x, player.y, 25, 30, 1);
        this.bodies.set(client.sessionId, body);

        // Create CharacterCore (server-side)
        const core = new CharacterCore();
        // CharacterCore expects (body, world, scene, sprite). We pass a stub sprite.
        const stubSprite = { x: player.x, y: player.y, getData: () => undefined, setData: () => {} };
        core.init(body, this.world, this.stubScene, stubSprite);
        core.suppressSounds = true;
        this.cores.set(client.sessionId, core);

        this.inputs.set(client.sessionId, idleInput());
    }

    onLeave(client) {
        console.log('[SnowballRoom] leave', client.sessionId);
        this.state.players.delete(client.sessionId);
        const body = this.bodies.get(client.sessionId);
        if (body) this.world.removeBody(client.sessionId);
        this.bodies.delete(client.sessionId);
        this.cores.delete(client.sessionId);
        this.inputs.delete(client.sessionId);
        this.lastFireTime.delete(client.sessionId);
        this.deathTimes.delete(client.sessionId);
    }

    onDispose() {
        console.log('[SnowballRoom] disposed');
    }

    update(dtMs) {
        this.serverTick++;
        this.state.tick = this.serverTick;
        const now = Date.now();

        // 1. Apply inputs to characters via CharacterCore + handle one-shot fire
        for (const [sessionId, player] of this.state.players) {
            if (player.isDying) {
                // Check respawn
                const respawnAt = this.deathTimes.get(sessionId);
                if (respawnAt && now >= respawnAt) {
                    this.respawnPlayer(sessionId);
                }
                continue;
            }
            const core = this.cores.get(sessionId);
            const body = this.bodies.get(sessionId);
            const input = this.inputs.get(sessionId) || idleInput();
            if (!core || !body) continue;

            core.tick(input, FIXED_DT_MS);

            // Fire one-shot
            if (input.fire) {
                const last = this.lastFireTime.get(sessionId) || 0;
                if (now - last >= PHYS.SNOWBALL_FIRE_RATE) {
                    this.lastFireTime.set(sessionId, now);
                    this.fireSnowball(sessionId, player, input.fireAngle);
                }
                input.fire = false;  // consume one-shot
            }

            if (input.direction !== 0) {
                player.facingRight = input.direction > 0;
            }
        }

        // 2. Step physics world
        this.world.step(FIXED_DT);

        // 3. Sync body state -> Schema
        for (const [sessionId, player] of this.state.players) {
            if (player.isDying) continue;
            const body = this.bodies.get(sessionId);
            const core = this.cores.get(sessionId);
            if (!body || !core) continue;

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
        }

        // 4. Update snowballs
        this.updateSnowballs(now);

        // 5. Update pickups (respawn check)
        // (basic — pickup respawn handled when player picks up)
    }

    fireSnowball(sessionId, player, angle) {
        if (angle === null || angle === undefined) {
            // auto-aim: fire toward nearest other player
            angle = this.autoAimAngle(player) ?? (player.facingRight ? 0 : Math.PI);
        }
        const speed = PHYS.SNOWBALL_SPEED;
        const sb = new Snowball();
        sb.id = this.nextSnowballId++;
        sb.x = player.x + Math.cos(angle) * 50;
        sb.y = player.y - 10 + Math.sin(angle) * 50;
        sb.vx = Math.cos(angle) * speed + player.vx * 0.5;
        sb.vy = Math.sin(angle) * speed + player.vy * 0.3;
        sb.hasFire = player.powerup === 'fire';
        // Store ownership outside Schema (private)
        sb._owner = sessionId;
        sb._spawnAt = Date.now();
        this.state.snowballs.push(sb);
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
                bestAngle = Math.atan2(dy, dx);
            }
        }
        return bestAngle;
    }

    updateSnowballs(now) {
        const remove = [];
        for (let i = 0; i < this.state.snowballs.length; i++) {
            const sb = this.state.snowballs[i];
            // Lifetime
            if (now - (sb._spawnAt || now) > PHYS.SNOWBALL_LIFETIME) {
                remove.push(i);
                continue;
            }
            // Physics
            sb.vy += PHYS.GRAVITY * PHYS.SNOWBALL_GRAVITY_SCALE * FIXED_DT;
            sb.x += sb.vx * FIXED_DT;
            sb.y += sb.vy * FIXED_DT;

            // World bounds
            if (sb.x < 0 || sb.x > this.world.gridWidth * this.world.tileSize ||
                sb.y > this.world.gridHeight * this.world.tileSize) {
                remove.push(i);
                continue;
            }

            // Tile collision
            const tileX = Math.floor(sb.x / this.world.tileSize);
            const tileY = Math.floor(sb.y / this.world.tileSize);
            if (tileY >= 0 && tileY < this.world.gridHeight &&
                tileX >= 0 && tileX < this.world.gridWidth) {
                const cell = this.world.tileGrid[tileY]?.[tileX];
                if (cell && cell !== 0) {
                    remove.push(i);
                    continue;
                }
            }

            // Hit detection vs players
            for (const [sid, target] of this.state.players) {
                if (sid === sb._owner || target.isDying) continue;
                const dx = target.x - sb.x;
                const dy = target.y - sb.y;
                if (dx * dx + dy * dy < 35 * 35) {
                    this.applyDamage(target, sb);
                    remove.push(i);
                    break;
                }
            }
        }
        // Remove in reverse order
        for (let j = remove.length - 1; j >= 0; j--) {
            this.state.snowballs.splice(remove[j], 1);
        }
    }

    applyDamage(target, snowball) {
        const dmg = PHYS.SNOWBALL_DAMAGE * (snowball.hasFire ? 2 : 1);
        target.health = Math.max(0, target.health - dmg);
        if (target.health <= 0 && !target.isDying) {
            target.isDying = true;
            // Find sessionId
            for (const [sid, p] of this.state.players) {
                if (p === target) {
                    this.deathTimes.set(sid, Date.now() + GAME.RESPAWN_TIME);
                    break;
                }
            }
            // Score
            const ownerPlayer = this.state.players.get(snowball._owner);
            if (ownerPlayer) ownerPlayer.score++;
            this.broadcast('death', { x: target.x, y: target.y });
        } else {
            this.broadcast('hit', { x: target.x, y: target.y, hasFire: snowball.hasFire });
        }
    }

    respawnPlayer(sessionId) {
        const player = this.state.players.get(sessionId);
        const body = this.bodies.get(sessionId);
        const core = this.cores.get(sessionId);
        if (!player || !body) return;

        // Pick least-occupied spawn
        const spawn = this.spawnPoints[Math.floor(Math.random() * this.spawnPoints.length)] || { x: 400, y: 300 };
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
