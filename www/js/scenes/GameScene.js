// ============================================
// GAME SCENE - Main Gameplay with SimplePhysicsWorld (v28)
// ============================================

import { PHYS, TILE_SIZE, GAME, PLAYER_COLORS, PICKUPS, RAGDOLL, getRandomBotName } from '../config.js';
import { CharacterCore } from '../physics/CharacterCore.js';
import { SimplePhysicsWorld } from '../physics/SimplePhysicsWorld.js';
import { BotBehavior } from '../ai/BotBehavior.js';
import { PlatformNav, EdgeType } from '../ai/PlatformNav.js';
import { ObstacleSolver } from '../ai/ObstacleSolver.js';
import { TriNav } from '../ai/TriNav.js';
import { HumanInput } from '../input/HumanInput.js';
import { NetworkManager } from '../network/NetworkManager.js';
import { Pickup } from '../entities/Pickup.js';

export class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
    }

    init(data) {
        // Get config from scene data or fallback to global config (for direct launch)
        const config = (data && Object.keys(data).length > 0) ? data : (window.gameConfig || {});

        this.gameMode = config.mode || 'single';
        this.botCount = config.botCount !== undefined ? config.botCount : 2;
        this.playerCharacter = config.character || 1; // 1 = brown bunny, 2 = gray bunny
        this.isHost = config.isHost || false;
        this.peerId = config.peerId || null;
    }

    create() {
        // Show HUD and mobile controls
        document.body.classList.add('game-active');

        // === MAP SETUP ===
        this.createMap();

        // === PATHFINDING ===
        this.setupPathfinding();

        // === COLLISION CATEGORIES ===
        this.setupCollisionCategories();

        // === CHARACTERS ===
        this.createPlayer();
        this.guestPlayer = null;   // Host's server-side guest character
        this.hostSprite = null;    // Guest's display-only host sprite

        if (this.gameMode === 'host') {
            this.bots = [];
            // Create guest character (server-side, full physics)
            const guestChar = this.playerCharacter === 1 ? 2 : 1;
            this.guestPlayer = this.createCharacterSprite(1, guestChar, 'guest');
            this.guestPlayer.setData('playerId', 'guest');
            const guestNick = window.gameConfig?.remoteNickname || 'Противник';
            this.guestPlayer.nameLabel = this.add.text(0, 0, guestNick, {
                fontFamily: 'Arial',
                fontSize: '12px',
                color: '#ffffff',
                stroke: '#000000',
                strokeThickness: 3,
                backgroundColor: 'rgba(231, 76, 60, 0.8)',
                padding: { x: 6, y: 2 }
            }).setOrigin(0.5, 1).setDepth(150);
        } else if (this.gameMode === 'join') {
            this.bots = [];
            // Create display sprite for host (no physics, position from snapshots)
            // v17.1 FIX: Host spawns at index 0, guest at index 1
            const hostChar = this.playerCharacter === 1 ? 2 : 1;
            this.hostSprite = this.createDisplaySprite(0, hostChar);
            this.hostSprite.setData('playerId', 'host');
            const hostNick = window.gameConfig?.remoteNickname || 'Противник';
            this.hostSprite.nameLabel = this.add.text(0, 0, hostNick, {
                fontFamily: 'Arial',
                fontSize: '12px',
                color: '#ffffff',
                stroke: '#000000',
                strokeThickness: 3,
                backgroundColor: 'rgba(231, 76, 60, 0.8)',
                padding: { x: 6, y: 2 }
            }).setOrigin(0.5, 1).setDepth(150);

            // v17: Host sprite has no physics on guest (purely visual)
        } else {
            this.createBots();
        }

        // === SNOWBALLS ===
        this.snowballs = [];

        // === PICKUPS ===
        this.pickups = [];
        this.activePowerups = new Map();
        this.createPickups();

        // === COLLISION HANDLERS ===
        this.setupCollisions();

        // === CAMERA (ДО Input и UI, чтобы zoom был доступен!) ===
        this.cameras.main.setBounds(0, 0, this.map.widthInPixels, this.map.heightInPixels);
        this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
        this.cameras.main.setZoom(0.6);

        // === SNOWFALL (world-space via custom emitZone) ===
        const cam = this.cameras.main;
        const viewW = cam.width / cam.zoom;

        // Custom zone source — spawns particles at camera position in world coords
        // Emitter stays at (0,0) so existing particles don't move with camera
        this._snowZone = {
            viewW,
            camScrollX: 0, camScrollY: 0,
            getRandomPoint: function(point) {
                point.x = this.camScrollX + Math.random() * this.viewW;
                point.y = this.camScrollY - 20;
                return point;
            }
        };

        this.snowEmitter = this.add.particles(0, 0, 'snowball', {
            emitZone: { type: 'random', source: this._snowZone },
            quantity: 1,
            frequency: 200,
            lifespan: { min: 3000, max: 6000 },
            speedY: { min: 30, max: 80 },
            speedX: { min: -10, max: 10 },
            scale: { min: 0.08, max: 0.2 },
            alpha: 0.7,
            tint: [0xffffff, 0xe8f0ff],
            gravityY: 30,
            maxAliveParticles: 25,
        });
        this.snowEmitter.setDepth(150);

        // === INPUT (zoom уже 0.7, позиционирование учтёт его) ===
        this.humanInput = new HumanInput(this);

        // === GRAPHICS ===
        this.hookGraphics = this.add.graphics();
        this.hookGraphics.setDepth(100);

        // === NAV GRAPH DEBUG ===
        this.navDebugMode = 0; // 0=off, 1=PlatformNav, 2=TriNav
        this.navGraphics = null;
        this.triNavGraphics = null;
        this.input.keyboard.on('keydown-G', () => {
            this.navDebugMode = (this.navDebugMode + 1) % 3;
            if (this.navGraphics) this.navGraphics.clear();
            if (this.triNavGraphics) this.triNavGraphics.clear();
            const labels = ['OFF', 'PlatformNav', 'TriNav'];
            console.log(`[Nav Debug] ${labels[this.navDebugMode]}`);
        });

        // === UI (zoom уже 0.7 для Rex Anchor) ===
        this.createUI();

        // === NETWORK (for multiplayer modes) ===
        this.network = null;
        this._nextSnowballId = 0;  // Unique snowball IDs (host assigns)
        if (this.gameMode === 'host' || this.gameMode === 'join') {
            this.network = new NetworkManager(this, this.isHost, this.peerId);

            this.network.onPlayerJoin = (peerId) => {
                console.log('Player joined:', peerId);
                const remoteName = window.gameConfig?.remoteNickname || this.network.remoteNickname || 'Противник';
                this.showMessage(`${remoteName} подключился!`);
                // Update opponent name in HUD
                if (this.remotePlayerUI) {
                    this.remotePlayerUI.name.textContent = '🐭 ' + remoteName;
                }
                // Update name label on the remote character
                if (this.isHost && this.guestPlayer?.nameLabel) {
                    this.guestPlayer.nameLabel.setText(remoteName);
                } else if (!this.isHost && this.hostSprite?.nameLabel) {
                    this.hostSprite.nameLabel.setText(remoteName);
                }
            };

            this.network.onPlayerLeave = (peerId) => {
                console.log('Player left:', peerId);
                this.showMessage(`Игрок отключился`);
                if (this.remotePlayerUI) {
                    this.remotePlayerUI.name.textContent = '🐭 Ожидание...';
                }
            };

            // Start connection AFTER all callbacks are set
            this.network.connect();
        }

        // === ESC to toggle pause ===
        this.input.keyboard.on('keydown-ESC', () => {
            if (this.isGamePaused) {
                this.hidePauseMenu();
            } else {
                this.showPauseMenu();
            }
        });

        // === PAUSE STATE ===
        this.isGamePaused = false;
        this.buttonLocked = false;

        // === CLEANUP on scene shutdown (restart, stop, etc.) ===
        this.events.on('shutdown', () => {
            if (this.humanInput) this.humanInput.destroy();
            document.body.classList.remove('game-active');
            // Reset slow-mo state
            if (this._slowmoTimer) {
                clearTimeout(this._slowmoTimer);
                this._slowmoTimer = null;
            }
            this._slowmoActive = false;
            this._physicsTimeScale = 1;
            this.time.timeScale = 1;
            // v28: Clear SimplePhysicsWorld references
            this.physicsWorld = null;
            this.predictionWorld = null;
        });
    }

    // === MAP ===

    createMap() {
        this.map = this.make.tilemap({ key: 'ice-map' });
        const tileset = this.map.addTilesetImage('ice', 'ice-tiles');

        // Background layer (decorations - no collision)
        this.bgLayer = this.map.createLayer('background', tileset, 0, 0);
        if (this.bgLayer) {
            this.bgLayer.setDepth(-10);
        }

        // Platforms layer (with SimplePhysicsWorld collision)
        this.platformLayer = this.map.createLayer('platforms', tileset, 0, 0);
        if (this.platformLayer) {
            this.platformLayer.setCollisionByExclusion([-1, 0]);
            this.platformLayer.setDepth(0);
        }

        // v28: Create SimplePhysicsWorld and initialize from tilemap
        this.physicsWorld = new SimplePhysicsWorld(TILE_SIZE);
        if (this.platformLayer) {
            this.physicsWorld.initFromTilemap(this.platformLayer);
        }

        // Physics time scale for slow-motion effects
        this._physicsTimeScale = 1;

        // Trees layer (decorative - no collision)
        this.treesLayer = this.map.createLayer('trees', tileset, 0, 0);
        if (this.treesLayer) {
            this.treesLayer.setDepth(5);  // Above platforms (0), below player (10)
        }

        // Water layer - use TileSprite for seamless scrolling
        const waterLayer = this.map.createLayer('water', tileset, 0, 0);
        if (waterLayer) {
            // Find actual bounds of water tiles (not the whole layer!)
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            let hasWater = false;

            waterLayer.forEachTile(tile => {
                if (tile && tile.index !== -1) {
                    hasWater = true;
                    const worldX = tile.pixelX;
                    const worldY = tile.pixelY;
                    minX = Math.min(minX, worldX);
                    minY = Math.min(minY, worldY);
                    maxX = Math.max(maxX, worldX + tile.width);
                    maxY = Math.max(maxY, worldY + tile.height);
                }
            });

            if (hasWater) {
                // Hide the tilemap layer
                waterLayer.setVisible(false);

                // Create TileSprite only in the water area
                const width = maxX - minX;
                const height = maxY - minY;

                this.waterSprite = this.add.tileSprite(
                    minX + width / 2,
                    minY + height / 2,
                    width,
                    height,
                    'water-tile'
                );
                this.waterSprite.setOrigin(0.5);
                this.waterSprite.setDepth(-5);  // Above background, below platforms

                // Store water Y position for death detection
                this.waterY = minY;
            }
        }

        // Get spawn points
        this.spawnPoints = [];
        const spawnsLayer = this.map.getObjectLayer('spawns');
        if (spawnsLayer) {
            spawnsLayer.objects.forEach(obj => {
                this.spawnPoints.push({ x: obj.x, y: obj.y });
            });
        }

        // Default spawn points if none defined
        if (this.spawnPoints.length === 0) {
            this.spawnPoints = [
                { x: 200, y: 4800 },
                { x: 6000, y: 4800 },
                { x: 2800, y: 3600 },
                { x: 4200, y: 3600 }
            ];
        }

        // v28: Validate spawn points - ensure there's ground below each
        this._validateSpawnPoints();

        // Sky background
        this.cameras.main.setBackgroundColor('#87CEEB');
    }

    /**
     * v28: Validate spawn points - ensure ground exists below each spawn
     * Falls back to finding valid positions if spawns are above empty space
     */
    _validateSpawnPoints() {
        if (!this.platformLayer || !this.physicsWorld) {
            console.warn('[Spawn] Validation skipped - missing platformLayer or physicsWorld');
            return;
        }

        console.log('[Spawn] Validating', this.spawnPoints.length, 'spawn points');

        const validated = [];
        for (let i = 0; i < this.spawnPoints.length; i++) {
            const spawn = this.spawnPoints[i];
            const spawnY = spawn.y - 35; // Body center

            // Check ground below spawn (body.y + halfH + 1)
            const groundY = spawnY + 30 + 1;
            const tileX = Math.floor(spawn.x / TILE_SIZE);
            const tileY = Math.floor(groundY / TILE_SIZE);

            console.log(`[Spawn] Point ${i}: (${spawn.x}, ${spawn.y}) -> tile (${tileX}, ${tileY})`);

            // Check a few tiles below for ground
            let foundGround = false;
            for (let checkY = tileY; checkY < tileY + 5 && checkY < this.physicsWorld.gridHeight; checkY++) {
                const isSolid = this.physicsWorld._isSolid(tileX, checkY);
                console.log(`[Spawn]   Checking tile (${tileX}, ${checkY}): ${isSolid ? 'SOLID' : 'empty'}`);
                if (isSolid) {
                    // Found ground - adjust spawn Y to be above it
                    const newSpawnY = checkY * TILE_SIZE - 35;
                    validated.push({ x: spawn.x, y: newSpawnY });
                    if (newSpawnY !== spawn.y) {
                        console.log(`[Spawn] Point ${i} adjusted: y ${spawn.y} -> ${newSpawnY} (ground at tile ${checkY})`);
                    }
                    foundGround = true;
                    break;
                }
            }

            if (!foundGround) {
                // No ground found - try to find ANY solid tile nearby
                const fallback = this._findNearestGroundedSpawn(spawn.x, spawn.y);
                if (fallback) {
                    validated.push(fallback);
                    console.log(`[Spawn] Point ${i} moved: (${spawn.x}, ${spawn.y}) -> (${fallback.x}, ${fallback.y})`);
                } else {
                    // Last resort - use original (will float but at least exists)
                    validated.push(spawn);
                    console.warn(`[Spawn] Point ${i} at (${spawn.x}, ${spawn.y}) has no ground below!`);
                }
            }
        }

        this.spawnPoints = validated;
    }

    /**
     * Find nearest position with solid ground below
     */
    _findNearestGroundedSpawn(x, y) {
        if (!this.physicsWorld?.solidGrid) return null;

        const tileX = Math.floor(x / TILE_SIZE);
        const startTileY = Math.floor(y / TILE_SIZE);

        // Search in expanding circles
        for (let radius = 1; radius < 20; radius++) {
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    const tx = tileX + dx;
                    const ty = startTileY + dy;

                    // Check if this tile is solid (potential ground)
                    if (this.physicsWorld._isSolid(tx, ty)) {
                        // Check if tile ABOVE is empty (can stand there)
                        if (!this.physicsWorld._isSolid(tx, ty - 1)) {
                            const newX = tx * TILE_SIZE + TILE_SIZE / 2;
                            const newY = ty * TILE_SIZE - 35; // Spawn above the ground tile
                            return { x: newX, y: newY };
                        }
                    }
                }
            }
        }

        return null;
    }

    /**
     * Play background music with loop
     */
    playBackgroundMusic() {
        // Use menu music for game too (same track)
        if (!this.cache.audio.exists('bgm-menu')) return;

        this.bgm = this.sound.add('bgm-menu', {
            loop: true,
            volume: 0.3
        });
        this.bgm.play();
    }

    // === COLLISION CATEGORIES ===

    setupCollisionCategories() {
        // Collision categories (not used by Rapier — labels in colliderData instead)
        this.CATEGORY = {
            PLAYER: 0x0001,
            BOT: 0x0002,
            PLATFORM: 0x0004,
            SNOWBALL: 0x0008
        };
    }

    // === PATHFINDING ===

    setupPathfinding() {
        this.platformNav = new PlatformNav();
        if (this.platformLayer) {
            this.platformNav.build(
                this.platformLayer,
                this.map.width,
                this.map.height,
                TILE_SIZE,
                this.waterY || null
            );
            // Load manual nav edges from Tiled (JUMP, FALL, HOOK)
            const navEdgesLayer = this.map.getObjectLayer('nav_edges');
            if (navEdgesLayer) {
                this.platformNav.loadManualEdges(navEdgesLayer.objects);
            }
            console.log(`[Nav] ${this.platformNav.platforms.length} platforms, ${this.platformNav.edges.length} edges`);
        }
        this.obstacleSolver = new ObstacleSolver(this.platformNav, this.platformLayer);

        // TriNav — tile-grid free-space navigation (bMod-style)
        this.triNav = new TriNav();
        if (this.platformLayer) {
            this.triNav.build(
                this.platformLayer,
                this.map.width,
                this.map.height,
                TILE_SIZE,
                this.waterY || null
            );
        }
    }

    // === CHARACTERS ===

    createCharacterSprite(spawnIndex, charNum, label) {
        const spawn = this.spawnPoints[spawnIndex % this.spawnPoints.length] || { x: 400, y: 400 };
        const spawnY = spawn.y - 35; // Offset up by halfH+5 so body doesn't overlap platform
        const spriteKey = `p${charNum}-stand`;

        const character = this.add.sprite(spawn.x, spawnY, spriteKey);
        character.setOrigin(0.5);
        character.setDepth(10);
        character.setScale(0.45);

        // v28: SimplePhysicsWorld body (25 = halfW, 30 = halfH)
        const body = this.physicsWorld.createBody(label, spawn.x, spawnY, 25, 30, 1);
        body.sprite = character;  // Back-reference for collision lookup
        character.simpleBody = body;
        character._physLabel = label;

        // CharacterCore (v28: uses SimpleBody)
        character.core = new CharacterCore();
        character.core.init(body, this.physicsWorld, this, character);

        character.setData('health', GAME.MAX_HEALTH);
        character.setData('score', 0);
        character.setData('facingRight', true);
        character.setData('ammo', PHYS.SNOWBALL_MAGAZINE);
        character.setData('reloading', false);
        character.animPrefix = `p${charNum}`;

        return character;
    }

    createDisplaySprite(spawnIndex, charNum) {
        const spawn = this.spawnPoints[spawnIndex % this.spawnPoints.length] || { x: 600, y: 400 };
        const spriteKey = `p${charNum}-stand`;

        // Display-only sprite (no physics body — position from server snapshots)
        const sprite = this.add.sprite(spawn.x, spawn.y, spriteKey);
        sprite.setOrigin(0.5);
        sprite.setDepth(10);
        sprite.setScale(0.45);
        sprite.animPrefix = `p${charNum}`;
        sprite._physLabel = 'display';
        sprite.setData('health', GAME.MAX_HEALTH);
        sprite.setData('facingRight', true);

        return sprite;
    }

    createPlayer() {
        const spawnIndex = (this.gameMode === 'join') ? 1 : 0;
        const charNum = this.playerCharacter || 1;

        if (this.gameMode === 'join') {
            // Guest: create prediction world + physics body for local prediction
            this._createPredictionWorld(spawnIndex, charNum);
        } else {
            this.player = this.createCharacterSprite(spawnIndex, charNum, 'player');
        }
        this.player.setData('colorIndex', 0);
        this.player.setData('playerId', this.isHost ? 'host' : 'guest');
    }

    /**
     * v28: Create a separate SimplePhysicsWorld for guest-side prediction.
     * Contains: tilemap colliders + own character body with CharacterCore.
     * This ensures physics match the host exactly for proper reconciliation.
     */
    _createPredictionWorld(spawnIndex, charNum) {
        const spawn = this.spawnPoints[spawnIndex % this.spawnPoints.length] || { x: 600, y: 400 };
        const spawnY = spawn.y - 35;
        const spriteKey = `p${charNum}-stand`;

        // v28: Create separate SimplePhysicsWorld for prediction (same as host)
        this.predictionWorld = new SimplePhysicsWorld(TILE_SIZE);
        if (this.platformLayer) {
            this.predictionWorld.initFromTilemap(this.platformLayer);
            const solidCount = this.predictionWorld.solidGrid.flat().filter(Boolean).length;
            console.log('[Guest] predictionWorld solidGrid:', this.predictionWorld.gridWidth, 'x', this.predictionWorld.gridHeight,
                'solidCount:', solidCount);

            // Debug: check if there's ground at spawn position
            const groundY = spawnY + 35; // Feet position (body.y + halfH + 1)
            const tileX = Math.floor(spawn.x / TILE_SIZE);
            const groundTileY = Math.floor(groundY / TILE_SIZE);
            const isSolid = this.predictionWorld._isSolid(tileX, groundTileY);
            console.log('[Guest] Ground check at spawn:',
                'feet Y:', groundY, '-> tileY:', groundTileY,
                'tileX:', tileX,
                'isSolid:', isSolid);

            // Also check the actual tile from Phaser
            const phaserTile = this.platformLayer.getTileAt(tileX, groundTileY);
            console.log('[Guest] Phaser tile at ground:', phaserTile?.index, 'collides:', phaserTile?.collides);
        } else {
            console.error('[Guest] platformLayer is null! predictionWorld will have no collisions!');
        }

        // Create sprite
        const character = this.add.sprite(spawn.x, spawnY, spriteKey);
        character.setOrigin(0.5);
        character.setDepth(10);
        character.setScale(0.45);
        character._physLabel = 'player';

        // v28: Create SimpleBody for own character (same as host)
        const body = this.predictionWorld.createBody('player', spawn.x, spawnY, 25, 30, 1);
        body.sprite = character;
        character.simpleBody = body;

        // v28: Create CharacterCore (same physics as host)
        character.core = new CharacterCore();
        character.core.init(body, this.predictionWorld, this, character);
        // v21.3: Guest plays OWN sounds locally for immediate feedback
        // Other players' sounds come from host events
        character.core.suppressSounds = false;

        character.setData('health', GAME.MAX_HEALTH);
        character.setData('score', 0);
        character.setData('facingRight', true);
        character.animPrefix = `p${charNum}`;

        this.player = character;

        // State for reconciliation
        this._localVel = { x: 0, y: 0 };
        this._localGrounded = false;
        this._localJumpHeld = false;
        this._localCoyoteTime = 0;
        this._lastCorrectedTick = -1;
        this._lastReconciledSeq = -1;
        this._lastConfirmedTick = -1;

        console.log('[GameScene] v28: Guest prediction world created with SimplePhysicsWorld',
            'spawnPos:', spawn.x, spawnY,
            'body:', !!body, 'simpleBody:', !!character.simpleBody,
            'core:', !!character.core);
    }

    /**
     * v17: Host sprite on guest side — just visual, no physics
     */
    _createHostPredictionBody() {
        // Host sprite has no physics on guest side — purely visual
    }

    createBots() {
        this.bots = [];
        const usedNames = [];

        const playerChar = this.playerCharacter || 1;
        const botChars = playerChar === 1 ? [2, 3, 1] : [1, 3, 2];

        for (let i = 0; i < this.botCount; i++) {
            const spawnIndex = (i + 1) % this.spawnPoints.length;
            const charNum = botChars[i % botChars.length];

            const bot = this.createCharacterSprite(spawnIndex, charNum, `bot${i}`);

            // Tint player 3 sprites
            if (charNum === 3) {
                bot.setTint(0x88ccff);
            }

            // AI brain
            bot.brain = new BotBehavior(
                this.platformNav,
                this.map ? this.map.width : 100,
                this.map ? this.map.height : 75
            );

            // Assign random unique name
            const botName = getRandomBotName(usedNames);
            usedNames.push(botName);

            bot.setData('colorIndex', i + 1);
            bot.setData('isBot', true);
            bot.setData('botName', botName);

            this.bots.push(bot);
        }
    }

    // === PICKUPS ===

    createPickups() {
        this.pickupSpawns = [];  // Store spawn points for respawning

        const pickupsLayer = this.map.getObjectLayer('pickups');
        if (!pickupsLayer) {
            console.log('[GameScene] No pickups layer found in tilemap');
            return;
        }

        pickupsLayer.objects.forEach(obj => {
            const type = obj.name || 'health';
            const spawnData = { x: obj.x, y: obj.y, type };
            this.pickupSpawns.push(spawnData);

            const pickup = new Pickup(this, obj.x, obj.y, type);
            this.pickups.push(pickup);
        });

        console.log(`[GameScene] Created ${this.pickups.length} pickups`);
    }

    /**
     * Schedule pickup respawn at given position
     */
    schedulePickupRespawn(x, y, type, pickupId) {
        this.time.delayedCall(PICKUPS.RESPAWN_TIME, () => {
            const pickup = new Pickup(this, x, y, type, pickupId);
            this.pickups.push(pickup);
        });
    }

    // === POWERUP SYSTEM ===

    addPowerup(character, type, config) {
        const key = `${character._physLabel || 'unknown'}-${type}`;

        this.activePowerups.set(key, {
            character,
            type,
            config,
            remainingTime: config.duration  // Track remaining time, not end time
        });

        // Visual effect on character
        character.setTint(config.tint);
    }

    updatePowerups(delta) {
        for (const [key, powerup] of this.activePowerups) {
            // Decrement remaining time (only called when not paused)
            powerup.remainingTime -= delta;

            if (powerup.remainingTime <= 0) {
                // Remove effect
                powerup.character.clearTint();
                this.activePowerups.delete(key);
            }
        }
    }

    hasPowerup(character, type) {
        const key = `${character._physLabel || 'unknown'}-${type}`;
        const powerup = this.activePowerups.get(key);
        if (!powerup) return false;

        // Check that powerup hasn't expired yet
        return powerup.remainingTime > 0;
    }

    getDamageMultiplier(character) {
        return this.hasPowerup(character, 'fire') ? 2 : 1;
    }

    getSpeedMultiplier(character) {
        return this.hasPowerup(character, 'speed') ? 1.5 : 1;
    }

    getDamageReduction(character) {
        return this.hasPowerup(character, 'shield') ? 0.5 : 1;
    }

    canDoubleJump(character) {
        return this.hasPowerup(character, 'doublejump');
    }

    getActivePowerupType(character) {
        const types = ['fire', 'speed', 'shield', 'doublejump'];
        for (const type of types) {
            if (this.hasPowerup(character, type)) return type;
        }
        return null;
    }

    // === COLLISIONS ===

    setupCollisions() {
        // Rapier2D collision events are drained in processRapierCollisions() each frame
    }

    /**
     * v28: Process collisions with simple AABB overlap checks
     */
    processCollisions() {
        if (this.gameMode === 'join') return; // Guest doesn't handle collisions

        // Get all characters
        const characters = [this.player, this.guestPlayer, ...this.bots].filter(c => c?.active);

        // Check snowball vs character collisions
        for (const snowball of this.snowballs) {
            if (!snowball.active) continue;

            const shooter = snowball.getData('shooter');
            const sbR = 10; // snowball radius

            // Check vs characters
            for (const character of characters) {
                if (character === shooter) continue;
                if (!character.active || character.getData('health') <= 0) continue;

                const body = character.simpleBody;
                if (!body) continue;

                // Simple circle vs AABB
                const dx = Math.abs(snowball.x - body.x);
                const dy = Math.abs(snowball.y - body.y);

                if (dx < body.halfW + sbR && dy < body.halfH + sbR) {
                    this.snowballHit(snowball, character);
                    break;
                }
            }

            // Check vs tilemap (if snowball still active)
            if (snowball.active && this.platformLayer) {
                const tile = this.platformLayer.getTileAtWorldXY(snowball.x, snowball.y);
                if (tile && tile.collides) {
                    this.showSplatEffect(snowball.x, snowball.y);
                    this.playSpatialSound('sfx-snowball-hit', snowball.x, snowball.y, 0.5);
                    if (this.network) {
                        this.network.queueEvent({
                            type: 'splatEffect',
                            x: snowball.x,
                            y: snowball.y
                        });
                    }
                    this.destroySnowball(snowball);
                }
            }
        }

        // Check pickup vs character collisions
        for (const pickup of this.pickups) {
            if (!pickup.isActive()) continue;

            const px = pickup.emoji.x;
            const py = pickup.emoji.y;
            const pR = 18; // pickup radius

            for (const character of characters) {
                if (!character.active || character.getData('health') <= 0) continue;

                const body = character.simpleBody;
                if (!body) continue;

                const dx = Math.abs(px - body.x);
                const dy = Math.abs(py - body.y);

                if (dx < body.halfW + pR && dy < body.halfH + pR) {
                    const x = pickup.emoji.x;
                    const y = pickup.startY;
                    const type = pickup.type;
                    const pickupId = pickup.id;

                    pickup.collect(character);
                    this.pickups = this.pickups.filter(p => p !== pickup);
                    this.schedulePickupRespawn(x, y, type, pickupId);
                    break;
                }
            }
        }
    }

    getSpriteFromLabel(label) {
        if (label === 'player') return this.player;
        if (label === 'guest') return this.guestPlayer;
        if (label?.startsWith('bot')) {
            const index = parseInt(label.replace('bot', ''));
            return this.bots[index];
        }
        return null;
    }

    // === UI ===

    // Convert health to hearts string (like Zelda)
    getHeartsString(health) {
        const maxHearts = GAME.MAX_HEARTS || 5;
        const hpPerHeart = GAME.HEALTH_PER_HEART || 20;

        let result = '';
        for (let i = 0; i < maxHearts; i++) {
            const heartHP = Math.max(0, Math.min(hpPerHeart, health - i * hpPerHeart));

            if (heartHP >= hpPerHeart) {
                result += '❤️';       // Full heart (red)
            } else if (heartHP >= hpPerHeart / 2) {
                result += '🩷';       // Half heart (pink, less bright)
            } else {
                result += '🖤';       // Empty heart (black)
            }
        }
        return result;
    }

    createUI() {
        // Initialize match data
        this.initMatchData();

        // === DOM HUD elements ===
        this.hudPlayerName = document.getElementById('hud-player-name');
        this.hudPlayerHearts = document.getElementById('hud-player-hearts');
        this.hudScore = document.getElementById('hud-score');
        this.hudPause = document.getElementById('hud-pause');
        this.hudOpponents = document.getElementById('hud-opponents');
        this.hudReloadFill = document.querySelector('#hud-player-reload .reload-fill');

        // Player name
        if (this.hudPlayerName) this.hudPlayerName.textContent = '🐭 ' + (window.gameConfig?.nickname || GAME.PLAYER_NAME);

        // Player hearts
        if (this.hudPlayerHearts) this.hudPlayerHearts.textContent = this.getHeartsString(GAME.MAX_HEALTH);

        // Pause button
        if (this.hudPause) this.hudPause.addEventListener('click', () => this.showPauseMenu());

        // Debug log button
        const hudDebug = document.getElementById('hud-debug');
        if (hudDebug) hudDebug.addEventListener('click', () => {
            if (window.DebugLog) window.DebugLog.showUI();
        });

        // === OPPONENTS (right side, stacked) ===
        this.createOpponentPanels();

        // === NAME LABELS above characters ===
        this.createNameLabels();
    }

    initMatchData() {
        this.matchData = {
            playerWins: 0,
            opponentWins: 0
        };
    }

    createOpponentPanels() {
        this.opponentUI = [];
        if (!this.hudOpponents) return;
        this.hudOpponents.innerHTML = '';

        if (this.gameMode === 'host' || this.gameMode === 'join') {
            // Network 1v1: show placeholder for remote player (updated when they connect)
            const nameEl = document.createElement('div');
            nameEl.className = 'hud-name enemy';
            nameEl.textContent = '🐭 ' + (window.gameConfig?.remoteNickname || 'Ожидание...');

            const heartsEl = document.createElement('div');
            heartsEl.className = 'hud-hearts';
            heartsEl.textContent = this.getHeartsString(GAME.MAX_HEALTH);

            this.hudOpponents.appendChild(nameEl);
            this.hudOpponents.appendChild(heartsEl);

            this.remotePlayerUI = { name: nameEl, hearts: heartsEl };
            return;
        }

        this.bots.forEach((bot) => {
            const botName = bot.getData('botName');
            const health = bot.getData('health');

            const nameEl = document.createElement('div');
            nameEl.className = 'hud-name enemy';
            nameEl.textContent = '🐭 ' + botName;

            const heartsEl = document.createElement('div');
            heartsEl.className = 'hud-hearts';
            heartsEl.textContent = this.getHeartsString(health);

            this.hudOpponents.appendChild(nameEl);
            this.hudOpponents.appendChild(heartsEl);

            bot.uiPanel = { name: nameEl, hearts: heartsEl };
            this.opponentUI.push({ bot, name: nameEl, hearts: heartsEl });
        });
    }

    createNameLabels() {
        // Name labels above bots
        this.bots.forEach((bot) => {
            const botName = bot.getData('botName');
            bot.nameLabel = this.add.text(0, 0, botName, {
                fontFamily: 'Arial',
                fontSize: '12px',
                color: '#ffffff',
                stroke: '#000000',
                strokeThickness: 3,
                backgroundColor: 'rgba(231, 76, 60, 0.8)',
                padding: { x: 6, y: 2 }
            }).setOrigin(0.5, 1).setDepth(150);
        });

        // Player name label
        this.player.nameLabel = this.add.text(0, 0, window.gameConfig?.nickname || GAME.PLAYER_NAME, {
            fontFamily: 'Arial',
            fontSize: '12px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 3,
            backgroundColor: 'rgba(52, 152, 219, 0.8)',
            padding: { x: 6, y: 2 }
        }).setOrigin(0.5, 1).setDepth(150);
    }

    updateNameLabels() {
        // Update bot name label positions
        this.bots.forEach(bot => {
            if (bot.nameLabel && bot.active) {
                bot.nameLabel.setPosition(bot.x, bot.y - 55);
                bot.nameLabel.setVisible(bot.getData('health') > 0);
            }
        });

        // Update guest player name label (host mode)
        if (this.guestPlayer?.nameLabel) {
            this.guestPlayer.nameLabel.setPosition(this.guestPlayer.x, this.guestPlayer.y - 55);
            this.guestPlayer.nameLabel.setVisible(this.guestPlayer.active && this.guestPlayer.getData('health') > 0);
        }

        // Update host sprite name label (guest mode)
        if (this.hostSprite?.nameLabel) {
            this.hostSprite.nameLabel.setPosition(this.hostSprite.x, this.hostSprite.y - 55);
            this.hostSprite.nameLabel.setVisible(this.hostSprite.visible && (this.hostSprite.getData('health') || 0) > 0);
        }

        // Update player name label position
        if (this.player.nameLabel && this.player.active) {
            this.player.nameLabel.setPosition(this.player.x, this.player.y - 55);
            this.player.nameLabel.setVisible(this.player.getData('health') > 0);
        }
    }

    updateHUD() {
        // Player hearts
        const playerHealth = this.player.getData('health');
        if (this.hudPlayerHearts) this.hudPlayerHearts.textContent = this.getHeartsString(playerHealth);

        // Score
        if (this.hudScore) this.hudScore.textContent = `${this.matchData.playerWins} : ${this.matchData.opponentWins}`;

        // Network mode: update opponent hearts
        if (this.gameMode === 'host' && this.remotePlayerUI && this.guestPlayer) {
            const health = this.guestPlayer.getData('health') || GAME.MAX_HEALTH;
            this.remotePlayerUI.hearts.textContent = this.getHeartsString(health);
            return;
        }
        if (this.gameMode === 'join' && this.remotePlayerUI) {
            // Get host health from snapshot
            const snapshot = this.network?.lastSnapshot;
            const hostData = snapshot?.players?.find(p => p.id === 'host');
            const health = hostData?.health ?? GAME.MAX_HEALTH;
            this.remotePlayerUI.hearts.textContent = this.getHeartsString(health);

            // Ping display
            const hudPing = document.getElementById('hud-ping');
            if (hudPing && this.network) {
                const p = this.network.ping;
                hudPing.textContent = p > 0 ? `${p}ms` : '';
                hudPing.style.color = p < 50 ? '#88ff88' : p < 100 ? '#ffff88' : '#ff8888';
            }
            return;
        }

        // Bot hearts
        this.bots.forEach(bot => {
            if (bot.uiPanel && bot.active) {
                const botHealth = bot.getData('health');
                bot.uiPanel.hearts.textContent = this.getHeartsString(botHealth);
            }
        });
    }

    // === DEATH & ROUND SYSTEM ===

    onCharacterDeath(victim, killer) {
        // Prevent double death
        if (victim.getData('isDying')) return;
        victim.setData('isDying', true);

        // Release hook immediately on death
        if (victim.core) {
            victim.core.releaseHook();
        }

        // Guest: visual ragdoll effect, state management via snapshot
        if (this.gameMode === 'join') {
            this.showDeathEffect(victim.x, victim.y);
            this.playSpatialSound('sfx-snowball-hit', victim.x, victim.y, 0.7);
            if (victim.nameLabel) victim.nameLabel.setVisible(false);

            // Ragdoll spin (same as host)
            const spinDir = Math.random() > 0.5 ? 1 : -1;
            this.tweens.add({
                targets: victim,
                angle: spinDir * 360,
                duration: RAGDOLL.DURATION,
                ease: 'Linear'
            });

            // Fade out after ragdoll — snapshot will restore when host respawns
            this.time.delayedCall(RAGDOLL.DURATION, () => {
                this.tweens.add({
                    targets: victim,
                    alpha: 0,
                    duration: RAGDOLL.FADE_TIME
                });
            });
            return;
        }

        // === RAGDOLL EFFECT (host + solo) ===

        // 1. Strong knockback + upward launch for dramatic ragdoll
        if (killer && victim.core && victim.core.body) {
            const body = victim.core.body;
            const dx = body.x - killer.x;
            const dy = body.y - killer.y;
            const dist = Math.hypot(dx, dy) || 1;
            // Horizontal: fly away from killer at ~400 px/s
            body.vx = (dx / dist) * 400;
            // Upward launch: ~600 px/s (close to jump force)
            body.vy = -600;
        }

        // 2. Visual tumbling via tween (Rapier body stays locked rotation)
        const spinDirection = Math.random() > 0.5 ? 1 : -1;
        this.tweens.add({
            targets: victim,
            angle: spinDirection * 360,
            duration: RAGDOLL.DURATION,
            ease: 'Linear'
        });

        // 3. Show death effect
        this.showDeathEffect(victim.x, victim.y);

        // 4. Play death sound
        this.playSpatialSound('sfx-snowball-hit', victim.x, victim.y, 0.7);

        // 5. Hide name label
        if (victim.nameLabel) victim.nameLabel.setVisible(false);

        // 6. Camera: zoom out to show ragdoll flight
        const cam = this.cameras.main;
        const normalZoom = 0.6;
        const deathZoom = 0.45;
        // Temporarily follow victim if it's not the player
        if (victim !== this.player) {
            cam.startFollow(victim, true, 0.1, 0.1);
        }
        this.tweens.add({
            targets: cam,
            zoom: deathZoom,
            duration: 400,
            ease: 'Sine.easeOut'
        });

        // 7. Slow-mo effect (local visual only, not affecting network tick rate)
        const isRelevant = (victim === this.player) || (killer === this.player);
        if (isRelevant && !this._slowmoActive) {
            this._slowmoActive = true;
            this.time.timeScale = 0.3;
            this._physicsTimeScale = 0.3;

            const restoreTimer = setTimeout(() => {
                if (!this.scene.isActive()) return;
                this.tweens.addCounter({
                    from: 0.3,
                    to: 1,
                    duration: 300,
                    onUpdate: (tween) => {
                        const val = tween.getValue();
                        this.time.timeScale = val;
                        this._physicsTimeScale = val;
                    },
                    onComplete: () => {
                        this._slowmoActive = false;
                    }
                });
            }, 500);
            this._slowmoTimer = restoreTimer;
        }

        // 8. After DURATION - fade out, restore camera, handle round logic
        this.time.delayedCall(RAGDOLL.DURATION, () => {
            // Restore camera: follow player, zoom back
            cam.startFollow(this.player, true, 0.1, 0.1);
            this.tweens.add({
                targets: cam,
                zoom: normalZoom,
                duration: 400,
                ease: 'Sine.easeIn'
            });

            this.tweens.add({
                targets: victim,
                alpha: 0,
                duration: RAGDOLL.FADE_TIME,
                onComplete: () => {
                    victim.setActive(false);
                    victim.setVisible(false);
                    victim.setAlpha(1);
                    victim.setAngle(0);

                    this.handleDeathLogic(victim);
                }
            });
        });

        this.updateHUD();
    }

    handleDeathLogic(victim) {
        // Network host: handle deaths, then restart round (respawn both)
        if (this.gameMode === 'host') {
            if (victim === this.player) {
                this.matchData.opponentWins++;
            } else if (victim === this.guestPlayer) {
                this.matchData.playerWins++;
            }
            // Queue death effect event for guest
            if (this.network) {
                this.network.queueEvent({ type: 'deathEffect', x: victim.x, y: victim.y });
            }
            this.updateHUD();
            // Respawn BOTH players (round restart)
            this.time.delayedCall(2000, () => {
                this.respawnCharacter(this.player);
                if (this.guestPlayer) {
                    this.respawnCharacter(this.guestPlayer);
                }
            });
            return;
        }

        // Guest: death is handled via snapshot (_processSnapshotNonPhysics), no logic here
        if (this.gameMode === 'join') {
            return;
        }

        // Solo mode: round-based
        if (victim === this.player) {
            // Player died - opponents win this round
            this.matchData.opponentWins++;
            if (!this.checkMatchEnd()) {
                this.startNewRound();
            }
        } else {
            // Check if all bots are eliminated
            const aliveBots = this.bots.filter(b => b.active && b.getData('health') > 0);
            if (aliveBots.length === 0) {
                // Player wins this round
                this.matchData.playerWins++;
                if (!this.checkMatchEnd()) {
                    this.startNewRound();
                }
            }
        }
        this.updateHUD();
    }

    showDeathEffect(x, y) {
        // Emoji particles around death location
        const emojis = ['⭐', '💫', '❄️', '✨'];

        for (let i = 0; i < 5; i++) {
            const emoji = emojis[Math.floor(Math.random() * emojis.length)];
            const offsetX = (Math.random() - 0.5) * 60;
            const offsetY = (Math.random() - 0.5) * 60;

            const star = this.add.text(x + offsetX, y + offsetY, emoji, {
                fontSize: '24px'
            }).setDepth(100);

            // Animate: fly outward and fade
            this.tweens.add({
                targets: star,
                x: x + offsetX * 2,
                y: y + offsetY * 2 - 30,
                alpha: 0,
                scale: 0.5,
                duration: 800,
                ease: 'Power2',
                onComplete: () => star.destroy()
            });
        }
    }

    showHitEffect(x, y, hasFire = false) {
        // Snow chunk particles
        const snowParticles = this.add.particles(x, y, 'snowball', {
            speed: { min: 50, max: 150 },
            angle: { min: 0, max: 360 },
            scale: { start: 0.2, end: 0 },
            alpha: { start: 1, end: 0 },
            tint: [0xffffff, 0xccddff],
            lifespan: 400,
            quantity: 8,
            gravityY: 200
        });
        snowParticles.setDepth(11);
        snowParticles.explode();
        this.time.delayedCall(500, () => snowParticles.destroy());

        // Fire explosion for fire snowballs
        if (hasFire) {
            const fireParticles = this.add.particles(x, y, 'snowball', {
                speed: { min: 80, max: 200 },
                scale: { start: 0.4, end: 0 },
                tint: [0xff4400, 0xff8800, 0xffcc00],
                lifespan: 500,
                quantity: 12,
                gravityY: 100,
                blendMode: 'ADD'
            });
            fireParticles.setDepth(11);
            fireParticles.explode();
            this.time.delayedCall(600, () => fireParticles.destroy());
        }

        // Emoji burst (kept for extra juice)
        const emojis = hasFire ? ['🔥', '💥', '✨'] : ['❄️', '💥', '✨'];
        for (let i = 0; i < 3; i++) {
            const emoji = emojis[i % emojis.length];
            const offsetX = (Math.random() - 0.5) * 40;
            const offsetY = (Math.random() - 0.5) * 40;

            const particle = this.add.text(x + offsetX, y + offsetY, emoji, {
                fontSize: '20px'
            }).setDepth(100);

            this.tweens.add({
                targets: particle,
                alpha: 0,
                scale: 0.3,
                y: y + offsetY - 20,
                duration: 400,
                onComplete: () => particle.destroy()
            });
        }
    }

    showSplatEffect(x, y) {
        const particles = this.add.particles(x, y, 'snowball', {
            speed: { min: 30, max: 100 },
            angle: { min: 0, max: 360 },
            scale: { start: 0.15, end: 0 },
            alpha: { start: 0.9, end: 0 },
            tint: [0xffffff, 0xe8f0ff, 0xccddff],
            lifespan: 300,
            quantity: 6,
            gravityY: 150,
        });
        particles.setDepth(11);
        particles.explode();
        this.time.delayedCall(400, () => particles.destroy());
    }

    checkMatchEnd() {
        if (this.matchData.playerWins >= GAME.WINS_TO_WIN) {
            this.showVictoryScreen(GAME.PLAYER_NAME, true);
            return true;
        }
        if (this.matchData.opponentWins >= GAME.WINS_TO_WIN) {
            this.showVictoryScreen('Противники', false);
            return true;
        }
        return false;
    }

    startNewRound() {
        // Reset all characters' health and respawn
        this.respawnAllCharacters();
        this.showMessage('🔔 Новый раунд!', 2000);
    }

    respawnAllCharacters() {
        // Respawn player at spawn point 0 (always)
        const playerSpawn = this.spawnPoints[0];
        this.respawnSingleCharacter(this.player, playerSpawn);

        // Respawn bots at other spawn points
        this.bots.forEach((bot, index) => {
            const spawnIndex = (index + 1) % this.spawnPoints.length;
            const spawn = this.spawnPoints[spawnIndex];
            this.respawnSingleCharacter(bot, spawn);
        });
    }

    respawnSingleCharacter(character, spawn) {
        const spawnY = spawn.y - 35; // Above platform surface

        // v28: Update SimpleBody position
        if (character.simpleBody) {
            character.simpleBody.x = spawn.x;
            character.simpleBody.y = spawnY;
            character.simpleBody.vx = 0;
            character.simpleBody.vy = 0;
        }
        character.setPosition(spawn.x, spawnY);

        if (character.core) character.core.releaseHook();
        character.setData('health', GAME.MAX_HEALTH);
        character.setData('isDying', false);
        character.setData('ammo', PHYS.SNOWBALL_MAGAZINE);
        character.setData('reloading', false);
        character.setAngle(0);
        character.setActive(true);
        character.setVisible(true);
        if (character.nameLabel) character.nameLabel.setVisible(true);
        if (character === this.player) this.updateReloadBar();
    }

    respawnCharacter(character) {
        let spawnIndex;
        if (this.gameMode === 'host' || this.gameMode === 'join') {
            // Network mode: fixed spawn points (host=0, guest=1)
            if (character === this.player) {
                spawnIndex = 0;
            } else if (character === this.guestPlayer) {
                spawnIndex = 1 % this.spawnPoints.length;
            } else {
                spawnIndex = Math.floor(Math.random() * this.spawnPoints.length);
            }
        } else {
            // Solo mode: pick farthest spawn from current position
            spawnIndex = 0;
            let maxDist = 0;
            for (let i = 0; i < this.spawnPoints.length; i++) {
                const sp = this.spawnPoints[i];
                const d = Math.hypot(sp.x - character.x, sp.y - character.y);
                if (d > maxDist) { maxDist = d; spawnIndex = i; }
            }
        }
        const spawn = this.spawnPoints[spawnIndex];
        const spawnY = spawn.y - 35; // Above platform surface

        // v28: Update SimpleBody position
        if (character.simpleBody) {
            character.simpleBody.x = spawn.x;
            character.simpleBody.y = spawnY;
            character.simpleBody.vx = 0;
            character.simpleBody.vy = 0;
        }
        character.setPosition(spawn.x, spawnY);

        if (character.core) character.core.releaseHook();
        character.setData('health', GAME.MAX_HEALTH);
        character.setData('isDying', false);
        character.setData('ammo', PHYS.SNOWBALL_MAGAZINE);
        character.setData('reloading', false);
        character.setAngle(0);
        character.setActive(true);
        character.setVisible(true);
        if (character.nameLabel) character.nameLabel.setVisible(true);
        if (character === this.player) this.updateReloadBar();

        this.updateHUD();
    }

    // === MODAL CLEANUP ===

    closeAllModals() {
        // Clean up pause menu
        if (this.pauseUI) {
            this.pauseUI.forEach(el => el.destroy());
            this.pauseUI = [];
        }
        // Clean up victory screen
        if (this.victoryUI) {
            this.victoryUI.forEach(el => el.destroy());
            this.victoryUI = [];
        }
    }

    // === VICTORY SCREEN ===

    showVictoryScreen(winnerName, isPlayerWin) {
        // Clean up any existing modals first
        this.closeAllModals();

        this.isGamePaused = true;
        this.buttonLocked = false;

        // Hide mobile controls so they don't intercept touches
        document.body.classList.remove('game-active');

        const w = this.cameras.main.width;
        const h = this.cameras.main.height;

        this.victoryUI = [];

        // Overlay with gradient feel
        const overlay = this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.75)
            .setScrollFactor(0).setDepth(300);
        this.victoryUI.push(overlay);

        // Decorative snowflakes
        const snowPositions = [
            { x: w * 0.15, y: h * 0.2 }, { x: w * 0.85, y: h * 0.25 },
            { x: w * 0.1, y: h * 0.7 }, { x: w * 0.9, y: h * 0.75 },
            { x: w * 0.25, y: h * 0.85 }, { x: w * 0.75, y: h * 0.15 },
            { x: w * 0.5, y: h * 0.1 }, { x: w * 0.5, y: h * 0.9 }
        ];
        snowPositions.forEach(pos => {
            const sf = this.add.text(pos.x, pos.y, '❄️', {
                fontSize: `${20 + Math.random() * 24}px`
            }).setOrigin(0.5).setScrollFactor(0).setDepth(301).setAlpha(0.3 + Math.random() * 0.3);
            this.victoryUI.push(sf);
            // Gentle floating animation
            this.tweens.add({
                targets: sf,
                y: pos.y - 10 - Math.random() * 15,
                alpha: sf.alpha * 0.6,
                duration: 2000 + Math.random() * 1500,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });
        });

        if (isPlayerWin) {
            // === WIN SCREEN ===
            const emoji = this.add.text(w / 2, h / 2 - 120, '🏆', {
                fontSize: '80px'
            }).setOrigin(0.5).setScrollFactor(0).setDepth(301);
            this.victoryUI.push(emoji);
            // Trophy bounce animation
            this.tweens.add({
                targets: emoji,
                scaleX: 1.15,
                scaleY: 1.15,
                duration: 600,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });

            const titleText = this.add.text(w / 2, h / 2 - 30, 'ПОБЕДА!', {
                fontFamily: "'Nunito', Arial Black",
                fontSize: '52px',
                color: '#ffd700',
                stroke: '#8B6914',
                strokeThickness: 8
            }).setOrigin(0.5).setScrollFactor(0).setDepth(301);
            this.victoryUI.push(titleText);

            const subText = this.add.text(w / 2, h / 2 + 25, '🐭 Мышонок Пи победил!', {
                fontFamily: "'Nunito', Arial",
                fontSize: '22px',
                color: '#fffde7',
                stroke: '#000000',
                strokeThickness: 3
            }).setOrigin(0.5).setScrollFactor(0).setDepth(301);
            this.victoryUI.push(subText);
        } else {
            // === DEFEAT SCREEN ===
            const emoji = this.add.text(w / 2, h / 2 - 120, '☃️', {
                fontSize: '80px'
            }).setOrigin(0.5).setScrollFactor(0).setDepth(301);
            this.victoryUI.push(emoji);

            const titleText = this.add.text(w / 2, h / 2 - 30, 'ПОРАЖЕНИЕ', {
                fontFamily: "'Nunito', Arial Black",
                fontSize: '48px',
                color: '#90caf9',
                stroke: '#1a237e',
                strokeThickness: 8
            }).setOrigin(0.5).setScrollFactor(0).setDepth(301);
            this.victoryUI.push(titleText);

            const subText = this.add.text(w / 2, h / 2 + 25, '❄️ Вас засыпали снежками!', {
                fontFamily: "'Nunito', Arial",
                fontSize: '22px',
                color: '#e3f2fd',
                stroke: '#000000',
                strokeThickness: 3
            }).setOrigin(0.5).setScrollFactor(0).setDepth(301);
            this.victoryUI.push(subText);
        }

        // Score
        const scoreText = this.add.text(w / 2, h / 2 + 70,
            `Счёт  ${this.matchData.playerWins} : ${this.matchData.opponentWins}`, {
                fontFamily: "'Nunito', Arial",
                fontSize: '28px',
                fontStyle: 'bold',
                color: '#ffffff',
                stroke: '#000000',
                strokeThickness: 4
            }).setOrigin(0.5).setScrollFactor(0).setDepth(301);
        this.victoryUI.push(scoreText);

        // Buttons with backgrounds
        const againBtn = this.createModalButton(
            w / 2 - 140, h / 2 + 140,
            '🔄 ЕЩЁ РАЗ',
            0x2196f3,
            () => this.scene.restart()
        );
        againBtn.forEach(el => this.victoryUI.push(el));

        const menuBtn = this.createModalButton(
            w / 2 + 140, h / 2 + 140,
            '🏠 МЕНЮ',
            0x607d8b,
            () => this.returnToMenu()
        );
        menuBtn.forEach(el => this.victoryUI.push(el));
    }

    // === PAUSE MENU ===

    showPauseMenu() {
        if (this.isGamePaused) return;

        this.closeAllModals();

        this.isGamePaused = true;
        this.buttonLocked = false;

        // Hide mobile controls
        document.body.classList.remove('game-active');

        const w = this.cameras.main.width;
        const h = this.cameras.main.height;

        this.pauseUI = [];

        // Overlay
        const overlay = this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.6)
            .setScrollFactor(0).setDepth(300);
        this.pauseUI.push(overlay);

        // Pause icon
        const icon = this.add.text(w / 2, h / 2 - 100, '⏸️', {
            fontSize: '64px'
        }).setOrigin(0.5).setScrollFactor(0).setDepth(301);
        this.pauseUI.push(icon);

        // Title
        const title = this.add.text(w / 2, h / 2 - 40, 'ПАУЗА', {
            fontFamily: "'Nunito', Arial Black",
            fontSize: '44px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 6
        }).setOrigin(0.5).setScrollFactor(0).setDepth(301);
        this.pauseUI.push(title);

        // Continue button
        const continueBtn = this.createModalButton(
            w / 2, h / 2 + 40,
            '▶️ ПРОДОЛЖИТЬ',
            0x4caf50,
            () => this.hidePauseMenu()
        );
        continueBtn.forEach(el => this.pauseUI.push(el));

        // Menu button
        const menuBtn = this.createModalButton(
            w / 2, h / 2 + 110,
            '🏠 В МЕНЮ',
            0x607d8b,
            () => this.returnToMenu()
        );
        menuBtn.forEach(el => this.pauseUI.push(el));
    }

    createModalButton(x, y, text, bgColor, callback) {
        const elements = [];

        // Button background (rounded rect)
        const bg = this.add.graphics().setScrollFactor(0).setDepth(302);
        const btnW = 240;
        const btnH = 48;
        bg.fillStyle(bgColor, 0.85);
        bg.fillRoundedRect(x - btnW / 2, y - btnH / 2, btnW, btnH, 12);
        bg.lineStyle(2, 0xffffff, 0.4);
        bg.strokeRoundedRect(x - btnW / 2, y - btnH / 2, btnW, btnH, 12);
        elements.push(bg);

        // Hit zone (invisible rectangle for interaction)
        const hitZone = this.add.rectangle(x, y, btnW, btnH, 0x000000, 0)
            .setScrollFactor(0).setDepth(303)
            .setInteractive({ useHandCursor: true })
            .on('pointerover', () => {
                label.setScale(1.05);
                bg.clear();
                bg.fillStyle(bgColor, 1);
                bg.fillRoundedRect(x - btnW / 2, y - btnH / 2, btnW, btnH, 12);
                bg.lineStyle(2, 0xffffff, 0.6);
                bg.strokeRoundedRect(x - btnW / 2, y - btnH / 2, btnW, btnH, 12);
            })
            .on('pointerout', () => {
                label.setScale(1);
                bg.clear();
                bg.fillStyle(bgColor, 0.85);
                bg.fillRoundedRect(x - btnW / 2, y - btnH / 2, btnW, btnH, 12);
                bg.lineStyle(2, 0xffffff, 0.4);
                bg.strokeRoundedRect(x - btnW / 2, y - btnH / 2, btnW, btnH, 12);
            })
            .on('pointerdown', () => {
                if (this.buttonLocked) return;
                this.buttonLocked = true;
                callback();
            });
        elements.push(hitZone);

        // Label text
        const label = this.add.text(x, y, text, {
            fontFamily: "'Nunito', Arial Black",
            fontSize: '24px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 3
        }).setOrigin(0.5).setScrollFactor(0).setDepth(304);
        elements.push(label);

        return elements;
    }

    // Legacy button creator (kept for compatibility)
    createGameButton(x, y, text, callback) {
        return this.createModalButton(x, y, text, 0x2196f3, callback);
    }

    hidePauseMenu() {
        this.closeAllModals();
        this.isGamePaused = false;
        // Restore mobile controls
        document.body.classList.add('game-active');
    }

    /**
     * Play sound with distance-based volume attenuation
     * Sounds further from the player are quieter
     */
    playSpatialSound(key, x, y, baseVolume = 0.5) {
        if (!this.cache.audio.exists(key)) return;
        if (!this.player) return;

        // Calculate distance from player
        const dx = x - this.player.x;
        const dy = y - this.player.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Distance attenuation parameters
        const refDistance = 200;   // Full volume up to 200px
        const maxDistance = 800;   // Silent after 800px

        // Calculate volume with linear falloff
        let volume = baseVolume;
        if (distance > refDistance) {
            const falloff = 1 - (distance - refDistance) / (maxDistance - refDistance);
            volume = baseVolume * Math.max(0, falloff);
        }

        // Only play if audible (minimum 5% volume)
        if (volume > 0) {
            this.sound.play(key, { volume: Math.max(0.05, volume) });
        }

        // Queue all sound events for guest (guest has no local physics, needs all sounds from host)
        if (this.isHost && this.network) {
            this.network.queueEvent({ type: 'sound', name: key, x, y, vol: baseVolume });
        }
    }

    showMessage(text, duration = 3000) {
        const w = this.cameras.main.width;
        const message = this.add.text(w / 2, 150, text, {
            fontFamily: 'Arial, sans-serif',
            fontSize: '24px',
            color: '#ffffff',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            padding: { x: 20, y: 10 }
        }).setOrigin(0.5).setScrollFactor(0).setDepth(1000);

        this.time.delayedCall(duration, () => {
            message.destroy();
        });
    }

    // === MAIN UPDATE LOOP ===

    update(time, delta) {
        // Animate water flow (always, even when paused)
        if (this.waterSprite) {
            this.waterSprite.tilePositionX -= 0.5;
        }

        // Update snow spawn zone to follow camera (emitter stays at 0,0)
        if (this._snowZone) {
            const cam = this.cameras.main;
            this._snowZone.camScrollX = cam.scrollX;
            this._snowZone.camScrollY = cam.scrollY;
        }

        // Skip game logic when paused
        if (this.isGamePaused) return;

        if (!this.player || !this.player.active) return;

        if (this.gameMode === 'join') {
            this.updateAsGuest(delta);
        } else {
            this.updateAsHost(delta);
        }
    }

    // === HOST UPDATE (also used for solo mode) ===

    updateAsHost(delta) {
        const FIXED_DT_S = 1 / 60;
        const FIXED_DT_MS = FIXED_DT_S * 1000; // 16.67ms

        // 1. Gather inputs (once per frame)
        const playerInput = this.humanInput.getInput();
        playerInput.hookTarget = this.findHookTarget(this.player);

        // Save host input for guest simulation (Teeworlds model)
        if (this.network) {
            this.network.setHostInput({
                direction: playerInput.direction || 0,
                jump: !!playerInput.jump,
                hook: !!playerInput.hook,
                hookTarget: playerInput.hookTarget,
                fire: false  // fire handled by events
            });
        }

        let guestInput = null;
        if (this.guestPlayer?.active && !this.guestPlayer.getData('isDying')) {
            // v18: Use buffered input for consistent timing
            const serverTick = this.network?.serverTick || 0;
            guestInput = this.network?.getInputForTick('guest', serverTick)
                || { direction: 0, jump: false, hook: false, hookJustPressed: false, fire: false, fireAngle: null, strength: 1 };
            // Use guest's transmitted hookTarget if available, fallback to local calculation
            if (!guestInput.hookTarget) {
                guestInput.hookTarget = this.findHookTarget(this.guestPlayer);
            }
        }

        // 2. Handle one-shot actions BEFORE physics loop (once per frame)
        if (playerInput.fire && !this.player.getData('isDying')) {
            this.shootSnowball(this.player, playerInput.fireAngle);
        }
        if (guestInput?.fire) {
            this.shootSnowball(this.guestPlayer, guestInput.fireAngle);
            if (this.network) {
                const remoteInput = this.network.remoteInputs.get('guest');
                if (remoteInput) remoteInput.fire = false;
            }
        }
        // 3. Fixed timestep physics loop (deterministic)
        this._physicsAccumulator = (this._physicsAccumulator || 0) + (delta / 1000) * (this._physicsTimeScale || 1);
        this._physicsAccumulator = Math.min(this._physicsAccumulator, FIXED_DT_S * 4); // prevent spiral of death

        let firstTick = true;
        while (this._physicsAccumulator >= FIXED_DT_S) {
            // Teeworlds v13: increment serverTick INSIDE loop
            if (this.network) {
                this.network.serverTick++;
                // Track accumulator for precise INPUTTIMING calculation
                this.network._tickAccumulator = this._physicsAccumulator - FIXED_DT_S;
            }

            // v17 simplified: just use latest guest input (no tick buffers)
            let tickGuestInput = guestInput;
            if (tickGuestInput && !tickGuestInput.hookTarget) {
                tickGuestInput.hookTarget = this.findHookTarget(this.guestPlayer);
            }

            // Clear fire one-shot on subsequent sub-ticks (hook uses edge detection in CharacterCore)
            if (!firstTick) {
                playerInput.fire = false;
                if (tickGuestInput) tickGuestInput = { ...tickGuestInput, fire: false };
            }

            this.updateCharacter(this.player, playerInput, FIXED_DT_MS);
            if (tickGuestInput) this.updateCharacter(this.guestPlayer, tickGuestInput, FIXED_DT_MS);

            // Bots
            this.bots.forEach(bot => {
                if (bot.active && bot.getData('health') > 0) {
                    const botInput = bot.brain.update(bot, this, FIXED_DT_MS);
                    this.updateCharacter(bot, botInput, FIXED_DT_MS);
                    if (firstTick && botInput.fire) {
                        this.shootSnowball(bot, botInput.fireAngle);
                    }
                }
            });

            // v28: SimplePhysicsWorld step
            this.physicsWorld.step(FIXED_DT_S);

            // Quantize all characters for network determinism
            if (this.player.core) this.player.core.quantize();
            if (this.guestPlayer?.core) this.guestPlayer.core.quantize();
            this.bots.forEach(bot => { if (bot.core) bot.core.quantize(); });

            this._physicsAccumulator -= FIXED_DT_S;
            firstTick = false;
        }

        // 5. Sync sprite positions from SimpleBody
        this.syncSpriteFromBody(this.player);
        if (this.guestPlayer?.simpleBody) this.syncSpriteFromBody(this.guestPlayer);
        this.bots.forEach(bot => this.syncSpriteFromBody(bot));
        this.updateSnowballPositions();

        // 6. Process collision events (v28: simple overlap checks)
        this.processCollisions();

        // 7. Snowballs, pickups, powerups
        this.updateSnowballs();
        this.updatePowerups(delta);
        this.updateAmmoRegen();

        // 8. Draw hooks
        this.drawHooks();
        if (this.navDebugMode === 1) this.drawNavGraph();
        else if (this.navDebugMode === 2) this.drawTriNavDebug();

        // 9. UI
        this.updateHUD();
        this.updateNameLabels();

        // 10. Network — send snapshot (INPUTTIMING теперь отправляется сразу в receiveData)
        if (this.network) {
            this.network.update(delta);
        }

        // 11. Bounds check
        this.checkBounds();
    }

    /**
     * v28: Sync a sprite's position from its SimpleBody
     */
    syncSpriteFromBody(character) {
        if (!character?.simpleBody || !character.active) return;
        character.setPosition(character.simpleBody.x, character.simpleBody.y);
    }

    /**
     * v28: Update snowball positions (simple physics)
     */
    updateSnowballPositions() {
        const FIXED_DT_S = 1 / 60;
        for (const sb of this.snowballs) {
            if (!sb.active) continue;

            // Simple projectile physics
            sb.vy = (sb.vy || 0) + PHYS.GRAVITY * PHYS.SNOWBALL_GRAVITY_SCALE * FIXED_DT_S;
            sb.x += (sb.vx || 0) * FIXED_DT_S;
            sb.y += sb.vy * FIXED_DT_S;
        }
    }

    // === GUEST UPDATE (v19: fixed reconciliation) ===

    updateAsGuest(delta) {
        if (!this._loggedGuestStart) {
            console.log('[Guest] updateAsGuest started, predictionWorld:', !!this.predictionWorld,
                'player:', !!this.player, 'simpleBody:', !!this.player?.simpleBody);
            this._loggedGuestStart = true;
        }
        const network = this.network;
        const FIXED_DT_S = 1 / 60;
        const FIXED_DT_MS = FIXED_DT_S * 1000;

        // 1. v23: SERVER RECONCILIATION with input replay (Teeworlds-style)
        // Only reconcile when we have a NEW snapshot (tick > last confirmed)
        const snapshot = network?.lastSnapshot;
        if (snapshot && snapshot.tick > this._lastConfirmedTick) {
            this._reconcileWithServer(snapshot);
        }

        // 2. Gather input
        const playerInput = this.humanInput.getInput();
        playerInput.hookTarget = this.findHookTarget(this.player);

        // 3. Send input to host
        network?.sendInput(playerInput);

        // v28: Local snowball visual removed — server snowball arrives via syncSnowballVisuals()
        // within 1-2 frames, no need for duplicate local preview.
        // Play shot sound locally (server event filtered by dist<50)
        if (playerInput.fire) {
            const now = Date.now();
            if (now - (this._lastLocalSnowballTime || 0) >= 100) {
                this._lastLocalSnowballTime = now;
                this.playSpatialSound('sfx-snowball-shot', this.player.x, this.player.y, 0.4);
            }
        }

        // 4. OWN character: FIXED TIMESTEP physics (local prediction)
        this._guestPhysicsAccum = (this._guestPhysicsAccum || 0) + (delta / 1000);
        this._guestPhysicsAccum = Math.min(this._guestPhysicsAccum, FIXED_DT_S * 4); // Cap at 4 frames

        let guestFirstTick = true;
        while (this._guestPhysicsAccum >= FIXED_DT_S) {
            // Clear fire one-shot on subsequent sub-ticks (hook uses edge detection in CharacterCore)
            const tickInput = guestFirstTick ? playerInput : { ...playerInput, fire: false };
            this._updateLocalPlayer(tickInput, FIXED_DT_MS);
            this._guestPhysicsAccum -= FIXED_DT_S;
            guestFirstTick = false;
        }

        // 5. OTHER players: interpolation from snapshots
        const interp = network?.getInterpolatedSnapshot();
        if (interp) {
            this._interpolateOtherPlayers(interp);
        }

        // 6. Non-physics snapshot processing (health, powerups, events)
        if (snapshot) {
            this._processSnapshotNonPhysics(snapshot);
        }

        // 7. Hook visuals (from snapshot — server is authoritative)
        this.hookGraphics.clear();
        this._drawHookVisuals(snapshot);

        // 8. Animations
        this._updateGuestAnimations(playerInput, snapshot);

        // 9. UI
        this.updateHUD();
        this.updateNameLabels();
        network?.update(delta);
    }

    // === v28: LOCAL PHYSICS FOR OWN CHARACTER (SimplePhysicsWorld) ===

    _updateLocalPlayer(input, delta) {
        if (!this.player?.active || this.player.getData('isDying')) {
            if (!this._loggedGuest1) { console.log('[Guest] _updateLocalPlayer: player not active or dying'); this._loggedGuest1 = true; }
            return;
        }
        if (!this.player.core || !this.predictionWorld) {
            if (!this._loggedGuest2) {
                console.log('[Guest] _updateLocalPlayer: missing core or predictionWorld',
                    'core:', !!this.player.core,
                    'predWorld:', !!this.predictionWorld,
                    'simpleBody:', !!this.player.simpleBody);
                this._loggedGuest2 = true;
            }
            return;
        }

        const FIXED_DT_S = 1 / 60;
        const FIXED_DT_MS = FIXED_DT_S * 1000;

        // Track local tick for debugging
        this._localTick = (this._localTick || 0) + 1;

        // Physics tick with FIXED delta
        const result = this.player.core.tick(input, FIXED_DT_MS);
        this._localGrounded = result.grounded;

        // Update facing direction
        if (input.direction !== 0) {
            this.player.setData('facingRight', input.direction > 0);
            this.player.setFlipX(input.direction < 0);
        }

        // v28: Step SimplePhysicsWorld
        this.predictionWorld.step(FIXED_DT_S);
        this.player.core.quantize();

        // v28: Direct sprite sync from SimpleBody
        if (this._localTick % 60 === 1) {
            const body = this.player.simpleBody;
            const groundY = body.y + body.halfH + 1;
            const ts = this.predictionWorld.tileSize;
            const tileY = Math.floor(groundY / ts);
            const tileX = Math.floor(body.x / ts);
            const isSolid = this.predictionWorld._isSolid(tileX, tileY);
            console.log('[Guest] tick', this._localTick,
                'y:', body.y.toFixed(1), 'halfH:', body.halfH, 'groundY:', groundY.toFixed(1),
                'ts:', ts, 'tile:', tileX, tileY, isSolid ? 'SOLID' : 'empty');
        }
        this.player.setPosition(this.player.simpleBody.x, this.player.simpleBody.y);
    }

    // === v17: LOCAL GROUND DETECTION (tilemap collision) ===

    _checkLocalGround() {
        if (!this.player || !this.platformLayer) return false;

        // Check tiles under feet (slightly below sprite center)
        const footY = this.player.y + 35;
        const leftX = this.player.x - 20;
        const rightX = this.player.x + 20;

        // Check 3 points under feet (center, left, right)
        const tileCenter = this.platformLayer.getTileAtWorldXY(this.player.x, footY);
        const tileLeft = this.platformLayer.getTileAtWorldXY(leftX, footY);
        const tileRight = this.platformLayer.getTileAtWorldXY(rightX, footY);

        // Return true if any tile has collision
        return (tileCenter?.collides) || (tileLeft?.collides) || (tileRight?.collides);
    }

    // === v17: INTERPOLATION FOR OTHER PLAYERS ===

    _interpolateOtherPlayers(interp) {
        const { t, prev, curr } = interp;

        // Host character
        const prevHost = prev.players?.find(p => p.id === 'host');
        const currHost = curr.players?.find(p => p.id === 'host');

        if (prevHost && currHost && this.hostSprite) {
            // Linear interpolation of position
            const x = prevHost.x + (currHost.x - prevHost.x) * t;
            const y = prevHost.y + (currHost.y - prevHost.y) * t;
            this.hostSprite.setPosition(x, y);

            // Direction from current snapshot
            if (currHost.facingRight !== undefined) {
                this.hostSprite.setData('facingRight', currHost.facingRight);
                this.hostSprite.setFlipX(!currHost.facingRight);
            }
        }
    }

    // === v19: SERVER RECONCILIATION (fixed comparison) ===

    /**
     * v21 BENDING: Smooth interpolation toward server state instead of instant reset.
     * Industry-standard approach used by Teeworlds, Source Engine, etc.
     */

    /**
     * v28: Apply server authoritative state to local player (SimpleBody)
     */
    _applyServerState(myData) {
        const serverVx = (myData.vx || 0) / 256;
        const serverVy = (myData.vy || 0) / 256;

        // Update sprite position
        this.player.setPosition(myData.x, myData.y);

        // v28: Update SimpleBody
        if (this.player.simpleBody) {
            this.player.simpleBody.x = myData.x;
            this.player.simpleBody.y = myData.y;
            this.player.simpleBody.vx = serverVx;
            this.player.simpleBody.vy = serverVy;

            // v28 FIX: Re-resolve collisions after teleport to update grounded state
            this.predictionWorld._resolveCollisions(this.player.simpleBody);
        }

        // Update local state
        this._localVel = { x: serverVx, y: serverVy };
        this._localGrounded = myData.grounded || this.player.simpleBody?.grounded || false;

        // Update CharacterCore state
        if (this.player.core) {
            this.player.core.grounded = this._localGrounded;
        }
    }

    // === v23: TEEWORLDS-STYLE INPUT REPLAY RECONCILIATION ===

    /**
     * v28: Adaptive bending with SimpleBody.
     * Since SimplePhysicsWorld is deterministic, we should have minimal drift.
     * Bending handles any remaining discrepancy smoothly.
     */
    _reconcileWithServer(snapshot) {
        const myData = snapshot.players?.find(p => p.id === 'guest');
        if (!myData || this.player.getData('isDying')) {
            if (!this._loggedReconcile1) {
                console.log('[Guest] _reconcileWithServer: no guest data or dying, players:', snapshot.players?.map(p => p.id));
                this._loggedReconcile1 = true;
            }
            return;
        }
        if (!this.predictionWorld || !this.player.simpleBody || !this.player.core) {
            if (!this._loggedReconcile2) {
                console.log('[Guest] _reconcileWithServer: missing predictionWorld/simpleBody/core');
                this._loggedReconcile2 = true;
            }
            return;
        }

        const serverTick = snapshot.tick;
        const lastAckedSeq = snapshot.lastInputSeq;

        // Skip if already processed this tick
        if (serverTick <= this._lastConfirmedTick) return;

        if (this._lastConfirmedTick < 0) {
            console.log('[Guest] First reconciliation tick', serverTick,
                'server pos:', myData.x.toFixed(1), myData.y.toFixed(1),
                'local pos:', this.player.simpleBody.x.toFixed(1), this.player.simpleBody.y.toFixed(1));
        }
        this._lastConfirmedTick = serverTick;

        // Always clear acknowledged inputs
        this.network.clearAckedInputs(lastAckedSeq);

        // Always sync hook state from server
        this._syncHookStateFromServer(myData, lastAckedSeq);

        // v28: Calculate error from SimpleBody
        const body = this.player.simpleBody;
        const errorX = myData.x - body.x;
        const errorY = myData.y - body.y;
        const errorDist = Math.sqrt(errorX * errorX + errorY * errorY);

        const serverVx = (myData.vx || 0) / 256;
        const serverVy = (myData.vy || 0) / 256;

        // v28: With deterministic physics, threshold can be lower
        const SKIP_THRESHOLD = 4;
        const TELEPORT_THRESHOLD = 150;

        if (errorDist < SKIP_THRESHOLD) {
            return;
        }

        if (errorDist > TELEPORT_THRESHOLD) {
            this._applyServerState(myData);
            if (window.DebugLog) window.DebugLog.log(`TELEPORT err=${errorDist.toFixed(0)}px`);
            return;
        }

        const BEND_FACTOR = Math.min(0.5, 0.15 + errorDist * 0.007);

        const newX = body.x + errorX * BEND_FACTOR;
        const newY = body.y + errorY * BEND_FACTOR;

        // v28: Direct body + sprite sync
        body.x = newX;
        body.y = newY;
        this.player.setPosition(newX, newY);

        // Velocity bending with same factor
        const newVx = body.vx + (serverVx - body.vx) * BEND_FACTOR;
        const newVy = body.vy + (serverVy - body.vy) * BEND_FACTOR;
        body.vx = newVx;
        body.vy = newVy;

        // v28 FIX: NaN guard — reset to server values if physics corrupted
        if (!isFinite(body.vx) || !isFinite(body.vy)) { body.vx = serverVx; body.vy = serverVy; }
        if (!isFinite(body.x) || !isFinite(body.y)) { body.x = myData.x; body.y = myData.y; this.player.setPosition(body.x, body.y); }

        // v28 FIX: Re-resolve collisions after position change to update grounded state
        this.predictionWorld._resolveCollisions(body);

        if (window.DebugLog) {
            window.DebugLog.log(`BEND err=${errorDist.toFixed(1)}px f=${(BEND_FACTOR * 100).toFixed(0)}%`);
        }
    }

    /**
     * v28: Sync hook state from server, respecting input acknowledgement
     */
    _syncHookStateFromServer(serverData, lastAckedSeq) {
        const core = this.player.core;
        const serverState = serverData.hookState || 'IDLE';

        // v28 FIX: Don't kill local hook prediction if server hasn't processed our hook input yet
        if (serverState === 'IDLE' && core.hookState !== 'IDLE') {
            const hookSeq = this.network?.lastHookInputSeq || 0;
            if (hookSeq > 0 && lastAckedSeq < hookSeq) return;
        }

        // Play attach sound only on FLYING→ATTACHED transition (natural hook hit)
        // Not IDLE→ATTACHED (stale server snapshot after local release)
        const wasFlying = core.hookState === 'FLYING';
        core.hookState = serverState;

        if (serverState === 'ATTACHED' && serverData.hookAnchorPos) {
            if (wasFlying && core._canPlaySound('hookAttached') && this.playSpatialSound) {
                this.playSpatialSound('sfx-hook-attached', serverData.hookAnchorPos.x, serverData.hookAnchorPos.y, 0.3);
            }
            core.hookAnchorPos = { ...serverData.hookAnchorPos };
            core.ropeLength = serverData.ropeLength || 0;
            core.hookPos = serverData.hookPos ? { ...serverData.hookPos } : { x: 0, y: 0 };
        } else if (serverState === 'FLYING' && serverData.hookPos) {
            core.hookPos = { ...serverData.hookPos };
            core.hookAnchorPos = null;
        } else {
            core.hookPos = { x: 0, y: 0 };
            core.hookAnchorPos = null;
            core.ropeLength = 0;
        }
    }

    /**
     * Apply server CharacterCore state (hook, grounded, etc.)
     * Used during input replay to reset core state before replaying.
     */
    _applyServerCoreState(serverData) {
        const core = this.player.core;
        core.grounded = serverData.grounded || false;
        core.hookState = serverData.hookState || 'IDLE';

        if (serverData.hookState === 'ATTACHED' && serverData.hookAnchorPos) {
            core.hookAnchorPos = { ...serverData.hookAnchorPos };
            core.ropeLength = serverData.ropeLength || 0;
            core.hookPos = serverData.hookPos
                ? { ...serverData.hookPos }
                : { ...serverData.hookAnchorPos };
        } else if (serverData.hookState === 'FLYING' && serverData.hookPos) {
            core.hookPos = { ...serverData.hookPos };
            core.hookAnchorPos = null;
        } else {
            core.hookPos = { x: 0, y: 0 };
            core.hookAnchorPos = null;
            core.ropeLength = 0;
        }
    }

    // === v21.3: UNIFIED HOOK VISUALS ===

    _drawHookVisuals(snapshot) {
        if (!snapshot) return;

        // v21.3: Own hook - use CharacterCore (now soft-synced with server)
        // This unifies rendering with host mode - same drawHookForCharacter()
        if (this.player?.active && this.player.core) {
            this.drawHookForCharacter(this.player);
        }

        // Host hook - must use snapshot (hostSprite has no CharacterCore)
        const hostData = snapshot.players?.find(p => p.id === 'host');
        if (hostData && this.hostSprite?.active) {
            if (hostData.hookState !== 'IDLE' && hostData.hookPos) {
                this._drawHookLine(this.hostSprite.x, this.hostSprite.y, hostData.hookPos.x, hostData.hookPos.y);
            }
        }
    }

    _drawHookLine(fromX, fromY, toX, toY) {
        this.hookGraphics.lineStyle(3, 0x888888, 1);
        this.hookGraphics.beginPath();
        this.hookGraphics.moveTo(fromX, fromY);
        this.hookGraphics.lineTo(toX, toY);
        this.hookGraphics.strokePath();

        // Hook head
        this.hookGraphics.fillStyle(0xaaaaaa, 1);
        this.hookGraphics.fillCircle(toX, toY, 6);
    }

    // === v17: GUEST ANIMATIONS ===

    _updateGuestAnimations(input, snapshot) {
        // Own character animation (from local state)
        const prefix = this.player.animPrefix;
        if (prefix) {
            if (!this._localGrounded) {
                this.player.anims.play(`${prefix}-jump`, true);
            } else if (input.direction !== 0) {
                this.player.anims.play(`${prefix}-walk`, true);
            } else {
                this.player.anims.play(`${prefix}-idle`, true);
            }
        }

        // Host character animation (from snapshot)
        if (this.hostSprite && snapshot) {
            const hostData = snapshot.players?.find(p => p.id === 'host');
            if (hostData) {
                const hPrefix = this.hostSprite.animPrefix;
                if (hPrefix && hostData.animation) {
                    this.hostSprite.anims.play(hostData.animation, true);
                }
            }
        }
    }

    /**
     * Process non-physics data from snapshot: health, death, powerups, snowballs, pickups, score, events
     */
    _processSnapshotNonPhysics(snapshot) {
        const interp = this.network?.getInterpolatedSnapshot();

        // Own player non-physics
        const myData = snapshot.players?.find(p => p.id === 'guest');
        if (myData) {
            // Death/respawn
            if (myData.isDying && !this.player.getData('isDying')) {
                this.onCharacterDeath(this.player, null);
            }
            if (!myData.isDying && this.player.getData('isDying')) {
                this.player.setData('isDying', false);
                this.player.setData('health', myData.health);
                this.player.setAlpha(1);
                this.player.setActive(true);
                this.player.setVisible(true);
                this.player.setAngle(0);
                if (this.player.nameLabel) this.player.nameLabel.setVisible(true);
                // v17: Direct position set (no Rapier on guest)
                this.player.setPosition(myData.x, myData.y);
                this._localVel = { x: 0, y: 0 };
            }

            // Health
            const prevHealth = this.player.getData('health');
            this.player.setData('health', myData.health);
            if (myData.health < prevHealth && myData.health > 0) {
                this.player.setTint(0xffffff);
                this.time.delayedCall(100, () => this.player.clearTint());
            }

            // Powerup tint
            if (myData.powerup) {
                const tints = { fire: 0xff8800, speed: 0xffff00, shield: 0x6666ff, doublejump: 0x66ff66 };
                this.player.setTint(tints[myData.powerup] || 0xffffff);
            } else if (!myData.isDying) {
                this.player.clearTint();
            }
            this.player.setVisible(myData.isActive !== false);
        }

        // Host player non-physics
        const hostData = snapshot.players?.find(p => p.id === 'host');
        if (hostData && this.hostSprite) {
            // Death: start ragdoll effect
            if (hostData.isDying && !this.hostSprite.getData('isDying')) {
                this.hostSprite.setData('isDying', true);
                if (this.hostSprite.nameLabel) this.hostSprite.nameLabel.setVisible(false);

                // Ragdoll spin
                const spinDir = Math.random() > 0.5 ? 1 : -1;
                this.tweens.add({
                    targets: this.hostSprite,
                    angle: spinDir * 360,
                    duration: RAGDOLL.DURATION,
                    ease: 'Linear'
                });

                // Fade out after ragdoll
                this.time.delayedCall(RAGDOLL.DURATION, () => {
                    this.tweens.add({
                        targets: this.hostSprite,
                        alpha: 0,
                        duration: RAGDOLL.FADE_TIME
                    });
                });
            }
            // Respawn: restore visuals
            if (!hostData.isDying && this.hostSprite.getData('isDying')) {
                this.hostSprite.setData('isDying', false);
                this.hostSprite.setData('health', hostData.health);
                this.hostSprite.setAlpha(1);
                this.hostSprite.setVisible(true);
                this.hostSprite.setAngle(0);
                if (this.hostSprite.nameLabel) this.hostSprite.nameLabel.setVisible(true);
                this.hostSprite.setPosition(hostData.x, hostData.y);
            }
            this.hostSprite.setData('health', hostData.health);
            // Powerup tint
            if (hostData.powerup) {
                const tints = { fire: 0xff8800, speed: 0xffff00, shield: 0x6666ff, doublejump: 0x66ff66 };
                this.hostSprite.setTint(tints[hostData.powerup] || 0xffffff);
            } else if (!hostData.isDying) {
                this.hostSprite.clearTint();
            }
            this.hostSprite.setVisible(hostData.isActive !== false);
        }

        // Snowballs (interpolated visuals)
        this.syncSnowballVisuals(snapshot.snowballs || [], interp);

        // Pickups, score
        this.syncPickupVisuals(snapshot.pickups || []);
        if (snapshot.score) {
            this.matchData.playerWins = snapshot.score.guestWins || 0;
            this.matchData.opponentWins = snapshot.score.hostWins || 0;
        }

        // Events (sounds, effects)
        if (snapshot.events?.length > 0) {
            for (const evt of snapshot.events) {
                if (evt.type === 'sound') {
                    // v21.3: Skip sounds from our own character (already played locally)
                    // Check if sound origin is very close to our player position
                    if (this.player?.active) {
                        const dx = evt.x - this.player.x;
                        const dy = evt.y - this.player.y;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist < 50) continue;  // Skip - this is our own sound

                        // v28 FIX: Hook sounds emit from anchor, not player — also check anchor distance
                        const core = this.player.core;
                        if (core?.hookAnchorPos) {
                            const hdx = evt.x - core.hookAnchorPos.x;
                            const hdy = evt.y - core.hookAnchorPos.y;
                            if (Math.sqrt(hdx * hdx + hdy * hdy) < 50) continue;
                        }
                    }
                    this.playSpatialSound?.(evt.name, evt.x, evt.y, evt.vol || 0.5);
                }
                if (evt.type === 'hitEffect') this.showHitEffect(evt.x, evt.y, evt.hasFire);
                if (evt.type === 'splatEffect') this.showSplatEffect(evt.x, evt.y);
                if (evt.type === 'deathEffect') {
                    this.showDeathEffect(evt.x, evt.y);
                    if (!this._slowmoActive) {
                        this._slowmoActive = true;
                        this.time.timeScale = 0.3;
                        const restoreTimer = setTimeout(() => {
                            if (!this.scene.isActive()) return;
                            this.tweens.addCounter({
                                from: 0.3, to: 1, duration: 300,
                                onUpdate: (tween) => { this.time.timeScale = tween.getValue(); },
                                onComplete: () => { this._slowmoActive = false; }
                            });
                        }, 500);
                        this._slowmoTimer = restoreTimer;
                    }
                }
            }
            snapshot.events = [];
        }
    }

    // === GUEST: SYNC SNOWBALL VISUALS ===

    syncSnowballVisuals(serverSnowballs, interp) {
        const serverIds = new Set(serverSnowballs.map(s => s.id));

        // Remove snowballs that no longer exist on server
        this.snowballs = this.snowballs.filter(sb => {
            if (!serverIds.has(sb.getData('netId'))) {
                this.destroySnowball(sb);
                return false;
            }
            return true;
        });

        // Update or create snowball visuals
        for (const ss of serverSnowballs) {
            let sb = this.snowballs.find(s => s.getData('netId') === ss.id);
            if (!sb) {
                // v28 FIX: Destroy local visual when server snowball arrives (prevents duplication)
                if (this._localSnowballVisual?.active) {
                    this._localSnowballVisual.destroy();
                    this._localSnowballVisual = null;
                }
                // Create visual-only snowball (no physics body needed on guest)
                sb = this.add.sprite(ss.x, ss.y, 'snowball');
                sb.setScale(ss.hasFire ? 0.7 : 0.5);
                if (ss.hasFire) {
                    sb.setTint(0xff4400);
                    // Fire trail particles (same as host)
                    const particles = this.add.particles(0, 0, 'snowball', {
                        follow: sb,
                        scale: { start: 0.3, end: 0 },
                        alpha: { start: 0.8, end: 0 },
                        tint: [0xff4400, 0xff8800, 0xffcc00],
                        lifespan: 200,
                        frequency: 30,
                        blendMode: 'ADD'
                    });
                    particles.setDepth(9);
                    sb.setData('particles', particles);
                }
                sb.setData('netId', ss.id);
                sb.setDepth(10);
                this.snowballs.push(sb);
            } else if (interp) {
                // Two-snapshot interpolation for snowball position
                const prevSb = interp.prev.snowballs?.find(s => s.id === ss.id);
                const currSb = interp.curr.snowballs?.find(s => s.id === ss.id);
                if (prevSb && currSb) {
                    const t = interp.t;
                    sb.setPosition(
                        prevSb.x + (currSb.x - prevSb.x) * t,
                        prevSb.y + (currSb.y - prevSb.y) * t
                    );
                } else {
                    sb.setPosition(ss.x, ss.y);
                }
            } else {
                sb.setPosition(ss.x, ss.y);
            }
        }
    }

    // === GUEST: SYNC PICKUP VISUALS ===

    syncPickupVisuals(serverPickups) {
        const serverIds = new Set(serverPickups.map(p => p.id));

        // Remove pickups that no longer exist on server
        for (let i = this.pickups.length - 1; i >= 0; i--) {
            const pickup = this.pickups[i];
            if (!serverIds.has(pickup.id)) {
                pickup.collect(null); // visual removal
                this.pickups.splice(i, 1);
            }
        }

        // Create pickups that exist on server but not locally
        const localIds = new Set(this.pickups.map(p => p.id));
        for (const sp of serverPickups) {
            if (!localIds.has(sp.id)) {
                const pickup = new Pickup(this, sp.x, sp.y, sp.type, sp.id);
                this.pickups.push(pickup);
            }
        }
    }

    // === GUEST: LOCAL SNOWBALL VISUAL (instant feedback) ===

    createLocalSnowballVisual(fireDirection) {
        // v24: Cooldown to prevent double visuals/sounds
        const now = Date.now();
        if (now - (this._lastLocalSnowballTime || 0) < 100) return;
        this._lastLocalSnowballTime = now;

        // v28 FIX: Destroy previous local visual if still alive
        if (this._localSnowballVisual?.active) {
            this._localSnowballVisual.destroy();
        }

        const dirX = fireDirection || (this.player.getData('facingRight') ? 1 : -1);
        const sb = this.add.sprite(
            this.player.x + dirX * 60,
            this.player.y - 10,
            'snowball'
        );
        sb.setScale(0.5).setDepth(10);
        this._localSnowballVisual = sb;
        // Animate flight and fade
        this.tweens.add({
            targets: sb,
            x: sb.x + dirX * 300,
            alpha: 0,
            duration: 400,
            onComplete: () => {
                sb.destroy();
                if (this._localSnowballVisual === sb) this._localSnowballVisual = null;
            }
        });
        this.playSpatialSound('sfx-snowball-shot', this.player.x, this.player.y, 0.4);
    }


    // === CHARACTER UPDATE ===

    updateCharacter(character, input, delta) {
        if (!character.active) return;

        // During ragdoll: physics runs (for knockback flight) but with no input
        if (character.getData('isDying')) {
            if (character.core) {
                const noInput = { direction: 0, jump: false, hook: false, hookJustPressed: false, fire: false, fireAngle: null, strength: 1 };
                character.core.tick(noInput, delta);
            }
            return;
        }

        character.setAngle(0);

        const core = character.core;

        // Physics tick
        const result = core.tick(input, delta);

        // Update facing direction
        if (input.direction !== 0) {
            character.setData('facingRight', input.direction > 0);
            character.setFlipX(input.direction < 0);
        }

        // Animations
        this.updateAnimation(character, result, input);
    }

    updateAnimation(character, physicsResult, input) {
        const prefix = character.animPrefix;
        const grounded = character.core ? character.core.grounded : character.getData('grounded');
        const isMoving = input && input.direction !== 0;

        if (!grounded) {
            character.anims.play(`${prefix}-jump`, true);
        } else if (isMoving) {
            character.anims.play(`${prefix}-walk`, true);
        } else {
            character.anims.play(`${prefix}-idle`, true);
        }
    }

    // === HOOK TARGETING ===

    findHookTarget(character) {
        if (!this.platformLayer) return null;

        const T = TILE_SIZE;
        const px = character.x;
        const py = character.y;
        const facingRight = character.getData('facingRight');
        const searchDir = facingRight ? 1 : -1;

        let bestTarget = null;
        let bestScore = 0;

        // Search for hookable surfaces above
        for (let dy = -T; dy > -T * 7; dy -= T * 0.5) {
            for (let dx = -T * 5; dx <= T * 5; dx += T * 0.5) {
                const testX = px + dx;
                const testY = py + dy;

                const tile = this.platformLayer.getTileAtWorldXY(testX, testY);
                if (!tile || tile.index <= 0) continue;

                // Check if it's an edge (hookable point)
                const tileBelow = this.platformLayer.getTileAtWorldXY(testX, testY + T);
                const isBottomEdge = !tileBelow || tileBelow.index <= 0;

                if (!isBottomEdge) continue;

                // Calculate score
                const dist = Math.hypot(dx, dy);
                if (dist > PHYS.HOOK_RANGE) continue;
                if (dist < T) continue;

                let score = 100 - dist * 0.1;

                // Prefer direction we're facing
                if (Math.sign(dx) === searchDir) score += 20;

                // Prefer targets above
                if (dy < -T * 2) score += 30;

                if (score > bestScore) {
                    bestScore = score;
                    bestTarget = {
                        x: testX,
                        y: testY + T * 0.3
                    };
                }
            }
        }

        return bestTarget;
    }

    // === HOOK DRAWING ===

    drawHooks() {
        this.hookGraphics.clear();

        // Draw player hook
        this.drawHookForCharacter(this.player);

        // Draw guest player hook (host mode — has CharacterCore)
        if (this.guestPlayer?.active) {
            this.drawHookForCharacter(this.guestPlayer);
        }

        // Draw bot hooks
        this.bots.forEach(bot => {
            if (bot.active) {
                this.drawHookForCharacter(bot);
            }
        });
    }

    drawNavGraph() {
        const nav = this.platformNav;
        if (!nav) return;
        if (!this.navGraphics) {
            this.navGraphics = this.add.graphics();
            this.navGraphics.setDepth(150);
        }
        this.navGraphics.clear();

        // Platforms — green bars
        this.navGraphics.fillStyle(0x00ff00, 0.25);
        for (const p of nav.platforms) {
            this.navGraphics.fillRect(p.leftX, p.surfaceY - 4, p.width, 8);
        }

        // Edges — color by type
        const colors = {
            WALK: 0x00ff00,
            JUMP_ACROSS: 0x3399ff,
            JUMP_UP: 0x00ffff,
            FALL: 0xffff00,
            HOOK: 0xff3333,
        };

        for (const edge of nav.edges) {
            const from = nav.platforms[edge.from];
            const to = nav.platforms[edge.to];
            const color = colors[edge.type] || 0xffffff;
            const fromY = from.surfaceY - 10;
            const toY = to.surfaceY - 10;

            this.navGraphics.lineStyle(2, color, 0.6);
            this.navGraphics.lineBetween(edge.entryX, fromY, edge.exitX, toY);

            // Entry/exit dots
            this.navGraphics.fillStyle(color, 0.8);
            this.navGraphics.fillCircle(edge.entryX, fromY, 4);
            this.navGraphics.fillCircle(edge.exitX, toY, 4);
        }
    }

    drawTriNavDebug() {
        const triNav = this.triNav;
        if (!triNav || !triNav.navGrid) return;

        if (!this.triNavGraphics) {
            this.triNavGraphics = this.add.graphics();
            this.triNavGraphics.setDepth(150);
        }
        this.triNavGraphics.clear();

        const T = this.tileSize || TILE_SIZE;

        // Walkable tiles — semi-transparent green
        this.triNavGraphics.fillStyle(0x00ff00, 0.08);
        for (let y = 0; y < triNav.mapHeight; y++) {
            for (let x = 0; x < triNav.mapWidth; x++) {
                if (triNav.navGrid[y][x]) {
                    this.triNavGraphics.fillRect(x * T, y * T, T, T);
                }
            }
        }

        // Bot paths — magenta lines + waypoint dots
        if (this.bots) {
            for (const bot of this.bots) {
                if (!bot.active || !bot.brain) continue;
                const waypoints = bot.brain.blackboard.get('triWaypoints');
                if (!waypoints || waypoints.length < 1) continue;

                // Path lines
                this.triNavGraphics.lineStyle(2, 0xff00ff, 0.7);
                const startX = bot.x, startY = bot.y;
                this.triNavGraphics.lineBetween(startX, startY, waypoints[0].x, waypoints[0].y);
                for (let i = 0; i < waypoints.length - 1; i++) {
                    this.triNavGraphics.lineBetween(
                        waypoints[i].x, waypoints[i].y,
                        waypoints[i + 1].x, waypoints[i + 1].y);
                }

                // Waypoint dots
                this.triNavGraphics.fillStyle(0xff00ff, 0.9);
                for (const wp of waypoints) {
                    this.triNavGraphics.fillCircle(wp.x, wp.y, 5);
                }

                // Current target waypoint — larger, yellow
                const wpIdx = bot.brain.blackboard.get('triWpIndex') || 0;
                if (wpIdx < waypoints.length) {
                    this.triNavGraphics.fillStyle(0xffff00, 1.0);
                    this.triNavGraphics.fillCircle(waypoints[wpIdx].x, waypoints[wpIdx].y, 8);
                }
            }
        }
    }

    drawHookForCharacter(character) {
        const core = character.core;

        if (core.hookState === 'IDLE') {
            // Draw aim line if we have a target
            const target = this.findHookTarget(character);
            if (target && character === this.player) {
                this.hookGraphics.lineStyle(2, 0xffffff, 0.3);
                this.hookGraphics.lineBetween(character.x, character.y, target.x, target.y);

                // Draw crosshair
                this.hookGraphics.strokeCircle(target.x, target.y, 10);
            }
            return;
        }

        // Draw rope
        const color = character === this.player ? 0x8B4513 : 0x654321;
        this.hookGraphics.lineStyle(4, color, 1);

        if (core.hookState === 'FLYING') {
            // Don't draw if hookPos is at origin (state transition artifact)
            if (core.hookPos.x === 0 && core.hookPos.y === 0) return;

            this.hookGraphics.lineBetween(character.x, character.y, core.hookPos.x, core.hookPos.y);

            // Hook head
            this.hookGraphics.fillStyle(0x444444, 1);
            this.hookGraphics.fillCircle(core.hookPos.x, core.hookPos.y, 6);
        } else if (core.hookState === 'ATTACHED') {
            const attachPoint = core.getHookAttachPoint();
            if (attachPoint) {
                this.hookGraphics.lineBetween(character.x, character.y, attachPoint.x, attachPoint.y);

                // Anchor point
                this.hookGraphics.fillStyle(0xffcc00, 1);
                this.hookGraphics.fillCircle(attachPoint.x, attachPoint.y, 8);
            }
        }
    }

    // === SNOWBALLS ===

    shootSnowball(shooter, angle = null) {
        const now = Date.now();

        // Reloading — can't fire
        if (shooter.getData('reloading')) return;

        // Fire rate (between individual shots)
        const lastFireTime = shooter.getData('lastFireTime') || 0;
        if (now - lastFireTime < PHYS.SNOWBALL_FIRE_RATE) return;

        // Ammo check
        let ammo = shooter.getData('ammo');
        if (ammo === undefined || ammo === null) ammo = PHYS.SNOWBALL_MAGAZINE;
        if (ammo <= 0) return;

        // Fire!
        ammo--;
        shooter.setData('ammo', ammo);
        shooter.setData('lastFireTime', now);

        // Update reload bar (local player only)
        if (shooter === this.player) {
            this.updateReloadBar();
        }

        // Magazine empty — start reload
        if (ammo <= 0) {
            this.startReload(shooter);
        }

        // Determine angle: use provided angle, or default to facing direction (horizontal)
        if (angle === null || angle === undefined) {
            const facingRight = shooter.getData('facingRight');
            angle = facingRight ? 0 : Math.PI;
        }

        const hasFire = this.hasPowerup(shooter, 'fire');
        const speed = PHYS.SNOWBALL_SPEED;

        // v28: Get shooter velocity from SimpleBody
        const shooterVx = shooter.simpleBody?.vx || 0;
        const shooterVy = shooter.simpleBody?.vy || 0;
        const vx = Math.cos(angle) * speed + shooterVx * 0.5;
        const vy = Math.sin(angle) * speed + shooterVy * 0.3;

        // Spawn offset in the direction of the shot
        const spawnDist = 50;
        const spawnX = shooter.x + Math.cos(angle) * spawnDist;
        const spawnY = shooter.y - 10 + Math.sin(angle) * spawnDist;

        // v28: Create visual sprite with velocity stored directly
        const snowball = this.add.sprite(spawnX, spawnY, 'snowball');
        snowball.vx = vx;
        snowball.vy = vy;

        // Fire visual effects
        if (hasFire) {
            snowball.setTint(0xff4400);
            snowball.setScale(0.7);

            const particles = this.add.particles(0, 0, 'snowball', {
                follow: snowball,
                scale: { start: 0.3, end: 0 },
                alpha: { start: 0.8, end: 0 },
                tint: [0xff4400, 0xff8800, 0xffcc00],
                lifespan: 200,
                frequency: 30,
                blendMode: 'ADD'
            });
            particles.setDepth(9);
            snowball.setData('particles', particles);
        } else {
            snowball.setScale(0.5);
        }

        snowball.setDepth(10);
        snowball.setData('shooter', shooter);
        snowball.setData('damage', PHYS.SNOWBALL_DAMAGE);
        snowball.setData('ignoreShooterFrames', 5);
        snowball.setData('checkOverlap', 3);
        snowball.setData('netId', this._nextSnowballId++);

        this.snowballs.push(snowball);

        // Sound effect with spatial audio
        this.playSpatialSound('sfx-snowball-shot', shooter.x, shooter.y, 0.4);

        // Auto-destroy after lifetime
        const destroyTimer = this.time.delayedCall(PHYS.SNOWBALL_LIFETIME, () => {
            this.destroySnowball(snowball);
        });
        snowball.setData('destroyTimer', destroyTimer);
    }

    startReload(character) {
        character.setData('reloading', true);

        // Reload bar animation (local player only)
        if (character === this.player && this.hudReloadFill) {
            this.hudReloadFill.style.transition = 'none';
            this.hudReloadFill.style.width = '0%';
            this.hudReloadFill.offsetWidth; // force reflow
            this.hudReloadFill.style.transition = `width ${PHYS.SNOWBALL_RELOAD_TIME}ms linear`;
            this.hudReloadFill.style.width = '100%';
        }

        this.time.delayedCall(PHYS.SNOWBALL_RELOAD_TIME, () => {
            if (character.active) {
                character.setData('ammo', PHYS.SNOWBALL_MAGAZINE);
                character.setData('reloading', false);
            }
        });
    }

    updateReloadBar() {
        if (!this.hudReloadFill) return;
        const ammo = this.player.getData('ammo') ?? PHYS.SNOWBALL_MAGAZINE;
        const pct = (ammo / PHYS.SNOWBALL_MAGAZINE) * 100;
        this.hudReloadFill.style.transition = 'none';
        this.hudReloadFill.style.width = pct + '%';
    }

    _regenAmmoFor(character) {
        if (!character || !character.active) return;
        if (character.getData('reloading')) return;
        const ammo = character.getData('ammo') ?? PHYS.SNOWBALL_MAGAZINE;
        if (ammo >= PHYS.SNOWBALL_MAGAZINE) return;

        const now = Date.now();
        const lastFire = character.getData('lastFireTime') || 0;
        if (now - lastFire < PHYS.SNOWBALL_REGEN_DELAY) return;

        const lastRegen = character.getData('lastRegenTime') || 0;
        if (now - lastRegen < PHYS.SNOWBALL_REGEN_RATE) return;

        character.setData('ammo', ammo + 1);
        character.setData('lastRegenTime', now);

        if (character === this.player) this.updateReloadBar();
    }

    updateAmmoRegen() {
        this._regenAmmoFor(this.player);
        if (this.guestPlayer) this._regenAmmoFor(this.guestPlayer);
        if (this.bots) {
            this.bots.forEach(bot => this._regenAmmoFor(bot));
        }
    }

    updateSnowballs() {
        // Update immunity timers and clean up destroyed snowballs
        this.snowballs = this.snowballs.filter(sb => {
            if (!sb || !sb.active) return false;

            // Manual overlap check for first few frames (fixes close-range hits)
            const checkFrames = sb.getData('checkOverlap') || 0;
            if (checkFrames > 0) {
                sb.setData('checkOverlap', checkFrames - 1);

                const shooter = sb.getData('shooter');
                const hitRadius = 35;  // Hit detection radius

                // Check player
                if (this.player && this.player !== shooter && this.player.active && this.player.getData('health') > 0) {
                    const dist = Phaser.Math.Distance.Between(sb.x, sb.y, this.player.x, this.player.y);
                    if (dist < hitRadius) {
                        this.snowballHit(sb, this.player);
                        return false;  // Remove from array
                    }
                }

                // Check guest player (host mode)
                if (this.guestPlayer && this.guestPlayer !== shooter && this.guestPlayer.active && this.guestPlayer.getData('health') > 0) {
                    const dist = Phaser.Math.Distance.Between(sb.x, sb.y, this.guestPlayer.x, this.guestPlayer.y);
                    if (dist < hitRadius) {
                        this.snowballHit(sb, this.guestPlayer);
                        return false;
                    }
                }

                // Check bots
                for (const bot of this.bots || []) {
                    if (bot !== shooter && bot.active && bot.getData('health') > 0) {
                        const dist = Phaser.Math.Distance.Between(sb.x, sb.y, bot.x, bot.y);
                        if (dist < hitRadius) {
                            this.snowballHit(sb, bot);
                            return false;
                        }
                    }
                }
            }

            // Decrement shooter immunity frames
            const frames = sb.getData('ignoreShooterFrames');
            if (frames > 0) {
                sb.setData('ignoreShooterFrames', frames - 1);
            }

            // v28: Snowball physics handled in updateSnowballPositions()

            return true;
        });
    }

    destroySnowball(snowball) {
        if (snowball && snowball.active) {
            // Cancel auto-destroy timer if still pending
            const destroyTimer = snowball.getData('destroyTimer');
            if (destroyTimer) {
                destroyTimer.remove();
            }

            // Cleanup fire particles if present
            const particles = snowball.getData('particles');
            if (particles) {
                particles.destroy();
            }

            // v28: No Rapier body to remove
            snowball.destroy();
        }
    }

    snowballHit(snowball, target) {
        const shooter = snowball.getData('shooter');

        // Don't hit self
        if (shooter === target) return;

        // Don't hit dead/dying characters
        if (target.getData('health') <= 0) return;

        // Calculate damage with powerup modifiers
        const baseDamage = snowball.getData('damage');
        const damageMultiplier = this.getDamageMultiplier(shooter);
        const damageReduction = this.getDamageReduction(target);
        const finalDamage = baseDamage * damageMultiplier * damageReduction;

        const currentHealth = target.getData('health');
        const newHealth = Math.max(0, currentHealth - finalDamage);

        target.setData('health', newHealth);

        // Sound + visual
        const hasFire = !!snowball.getData('particles');
        this.playSpatialSound('sfx-snowball-hit', target.x, target.y, 1.0);
        this.showHitEffect(target.x, target.y, hasFire);

        // Screen shake when our player is hit
        if (target === this.player) {
            this.cameras.main.shake(100, 0.005);
        }

        // Queue visual effect for guest (sound is auto-queued by playSpatialSound)
        if (this.network) {
            this.network.queueEvent({ type: 'hitEffect', x: target.x, y: target.y, hasFire });
        }

        // Flash white
        target.setTint(0xffffff);
        this.time.delayedCall(100, () => {
            target.clearTint();
        });

        // Apply knockback
        if (target.core) {
            target.core.applyKnockback(snowball.x, snowball.y, PHYS.KNOCKBACK_FORCE);
        }

        // Check for kill
        if (newHealth <= 0) {
            const shooterScore = shooter.getData('score') + 1;
            shooter.setData('score', shooterScore);
            this.onCharacterDeath(target, shooter);
        }

        this.destroySnowball(snowball);
    }

    // === BOUNDS CHECK ===

    clampHorizontalBounds() {
        const mapWidth = this.map ? this.map.widthInPixels : GAME.WIDTH;

        const clamp = (character) => {
            if (!character?.active || !character.simpleBody) return;

            // v28: Clamp SimpleBody position
            if (character.simpleBody.x < 10) {
                character.simpleBody.x = 10;
                character.simpleBody.vx = 0;
                character.setX(10);
            }
            if (character.simpleBody.x > mapWidth - 10) {
                character.simpleBody.x = mapWidth - 10;
                character.simpleBody.vx = 0;
                character.setX(mapWidth - 10);
            }
        };

        clamp(this.player);
        if (this.guestPlayer) clamp(this.guestPlayer);
        this.bots.forEach(bot => clamp(bot));
    }

    checkBounds() {
        this.clampHorizontalBounds();

        // === VERTICAL BOUNDS (death zone) ===
        const mapHeight = this.map ? this.map.heightInPixels : GAME.HEIGHT;
        const deathY = this.waterY || (mapHeight - 50);

        const checkFall = (character, killer) => {
            if (character?.active && !character.getData('isDying') && character.y > deathY) {
                character.setData('health', 0);
                this.onCharacterDeath(character, killer);
            }
        };

        checkFall(this.player, null);
        if (this.guestPlayer) checkFall(this.guestPlayer, null);
        this.bots.forEach(bot => checkFall(bot, this.player));
    }

    // === MENU ===

    returnToMenu() {
        // Hide HUD and mobile controls
        document.body.classList.remove('game-active');

        // Clean up hooks before leaving
        if (this.player?.core) this.player.core.releaseHook();
        if (this.guestPlayer?.core) this.guestPlayer.core.releaseHook();
        this.bots.forEach(bot => bot.core?.releaseHook());

        // Clean up input
        this.humanInput.destroy();

        // Clean up network
        if (this.network) {
            this.network.destroy();
            this.network = null;
        }

        // Stop background music
        if (this.bgm) {
            this.bgm.stop();
        }

        // Send message to parent window to close iframe and show HTML menu
        // This triggers stopPhaserSnowball() which shows the menu and plays music
        if (window.parent && window.parent !== window) {
            window.parent.postMessage('closePhaserSnowball', '*');
        } else {
            // Fallback for direct access (not in iframe)
            this.scene.start('MenuScene');
        }
    }
}
