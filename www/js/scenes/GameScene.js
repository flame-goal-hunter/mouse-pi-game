// ============================================
// GAME SCENE - Main Gameplay with Matter.js
// ============================================

import { PHYS, TILE_SIZE, GAME, PLAYER_COLORS, PICKUPS, RAGDOLL, getRandomBotName } from '../config.js';
import { CharacterCore } from '../physics/CharacterCore.js';
import { BotBehavior } from '../ai/BotBehavior.js';
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
            const hostChar = this.playerCharacter === 1 ? 2 : 1;
            this.hostSprite = this.createDisplaySprite(1, hostChar);
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
        this.cameras.main.setZoom(0.7);

        // === INPUT (zoom уже 0.7, позиционирование учтёт его) ===
        this.humanInput = new HumanInput(this);

        // === GRAPHICS ===
        this.hookGraphics = this.add.graphics();
        this.hookGraphics.setDepth(100);

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

        // Platforms layer (with Matter.js collision)
        this.platformLayer = this.map.createLayer('platforms', tileset, 0, 0);
        if (this.platformLayer) {
            this.platformLayer.setCollisionByExclusion([-1, 0]);
            this.platformLayer.setDepth(0);

            // Convert tilemap to Matter.js collision bodies
            // Note: no chamfer - it breaks triangular slope collisions
            this.matter.world.convertTilemapLayer(this.platformLayer);
        }

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

        // Sky background
        this.cameras.main.setBackgroundColor('#87CEEB');
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
        // Matter.js collision categories
        this.CATEGORY = {
            PLAYER: 0x0001,
            BOT: 0x0002,
            PLATFORM: 0x0004,
            SNOWBALL: 0x0008
        };
    }

    // === PATHFINDING ===

    setupPathfinding() {
        // EasyStar setup
        if (typeof EasyStar !== 'undefined') {
            this.easystar = new EasyStar.js();

            // Build grid from tilemap
            const grid = [];
            for (let y = 0; y < this.map.height; y++) {
                grid[y] = [];
                for (let x = 0; x < this.map.width; x++) {
                    const tile = this.platformLayer ? this.platformLayer.getTileAt(x, y) : null;
                    // 0 = walkable, 1 = blocked
                    grid[y][x] = (tile && tile.index > 0) ? 1 : 0;
                }
            }

            this.easystar.setGrid(grid);
            this.easystar.setAcceptableTiles([0]);
            this.easystar.enableDiagonals();
            this.easystar.disableCornerCutting();
        }
    }

    // === CHARACTERS ===

    createCharacterSprite(spawnIndex, charNum, label) {
        const spawn = this.spawnPoints[spawnIndex % this.spawnPoints.length] || { x: 400, y: 400 };
        const spriteKey = `p${charNum}-stand`;

        const character = this.matter.add.sprite(spawn.x, spawn.y, spriteKey, null, {
            shape: { type: 'rectangle', width: 50, height: 60 },
            chamfer: { radius: 5 },
            friction: 0.01,
            frictionAir: 0.02,
            restitution: 0,
            label: label,
            render: { sprite: { xOffset: 0, yOffset: 0.15 } }
        });

        character.setFixedRotation();
        character.setDepth(10);
        character.setScale(0.45);

        character.core = new CharacterCore();
        character.core.init(this, character.body);

        character.setData('health', GAME.MAX_HEALTH);
        character.setData('score', 0);
        character.setData('facingRight', true);
        character.animPrefix = `p${charNum}`;

        return character;
    }

    createDisplaySprite(spawnIndex, charNum) {
        const spawn = this.spawnPoints[spawnIndex % this.spawnPoints.length] || { x: 600, y: 400 };
        const spriteKey = `p${charNum}-stand`;

        const sprite = this.matter.add.sprite(spawn.x, spawn.y, spriteKey, null, {
            shape: { type: 'rectangle', width: 50, height: 60 },
            isSensor: true,
            label: 'display'
        });

        sprite.setFixedRotation();
        sprite.setDepth(10);
        sprite.setScale(0.45);
        sprite.setIgnoreGravity(true);
        sprite.animPrefix = `p${charNum}`;
        sprite.setData('health', GAME.MAX_HEALTH);
        sprite.setData('facingRight', true);

        return sprite;
    }

    createPlayer() {
        const spawnIndex = (this.gameMode === 'join') ? 1 : 0;
        const charNum = this.playerCharacter || 1;

        if (this.gameMode === 'join') {
            // Guest: display-only sprite (no physics, no CharacterCore)
            // Position comes from server snapshots — no local physics needed
            this.player = this.createDisplaySprite(spawnIndex, charNum);
        } else {
            this.player = this.createCharacterSprite(spawnIndex, charNum, 'player');
        }
        this.player.setData('colorIndex', 0);
        this.player.setData('playerId', this.isHost ? 'host' : 'guest');
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
                this.easystar,
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
        const key = `${character.body.label}-${type}`;

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
        const key = `${character.body.label}-${type}`;
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
        // Matter.js collision events
        this.matter.world.on('collisionstart', (event) => {
            event.pairs.forEach(pair => {
                this.handleCollisionStart(pair.bodyA, pair.bodyB);
            });
        });

        this.matter.world.on('collisionend', (event) => {
            event.pairs.forEach(pair => {
                this.handleCollisionEnd(pair.bodyA, pair.bodyB);
            });
        });
    }

    handleCollisionStart(bodyA, bodyB) {
        // Ground detection is now handled by Matter.Query in updateGroundDetection()

        // Check for snowball hits
        this.checkSnowballCollision(bodyA, bodyB);

        // Check for pickup collection
        this.checkPickupCollision(bodyA, bodyB);
    }

    checkPickupCollision(bodyA, bodyB) {
        // Guest doesn't handle pickups — host is authoritative
        if (this.gameMode === 'join') return;

        const checkPickup = (pickupBody, characterBody) => {
            if (!pickupBody.label?.startsWith('pickup-')) return;

            const character = this.getSpriteFromBody(characterBody);
            if (!character) return;

            // Find the pickup object (stored directly on sensor body)
            const pickup = pickupBody.pickup;
            if (pickup && pickup.isActive()) {
                // Store position and type before collecting
                const x = pickup.emoji.x;
                const y = pickup.startY;  // Original Y position
                const type = pickup.type;
                const pickupId = pickup.id;

                pickup.collect(character);
                this.pickups = this.pickups.filter(p => p !== pickup);

                // Schedule respawn
                this.schedulePickupRespawn(x, y, type, pickupId);
            }
        };

        checkPickup(bodyA, bodyB);
        checkPickup(bodyB, bodyA);
    }

    handleCollisionEnd() {
        // Ground detection is now handled by Matter.Query in updateGroundDetection()
    }

    getSpriteFromBody(body) {
        if (body.label === 'player') return this.player;
        if (body.label === 'guest') return this.guestPlayer;
        if (body.label?.startsWith('bot')) {
            const index = parseInt(body.label.replace('bot', ''));
            return this.bots[index];
        }
        return null;
    }

    updateGroundDetection() {
        const Matter = Phaser.Physics.Matter.Matter;

        const checkGrounded = (character) => {
            if (!character || !character.active || !character.core) return;

            // Область под ногами персонажа (для height=60, т.е. 60/2=30 от центра)
            const sensorBounds = {
                min: { x: character.x - 20, y: character.y + 25 },
                max: { x: character.x + 20, y: character.y + 33 }
            };

            // Найти все тела в этой области
            const bodies = Matter.Query.region(
                this.matter.world.localWorld.bodies,
                sensorBounds
            );

            // Проверить есть ли статические тела (платформы)
            const isGrounded = bodies.some(body =>
                body.isStatic && body !== character.body
            );

            // Обновить состояние
            if (isGrounded && !character.core.grounded) {
                character.core.addGroundContact();
            } else if (!isGrounded && character.core.grounded) {
                character.core.removeGroundContact();
            }
        };

        checkGrounded(this.player);
        if (this.guestPlayer) checkGrounded(this.guestPlayer);
        this.bots.forEach(bot => checkGrounded(bot));
    }

    checkSnowballCollision(bodyA, bodyB) {
        // Guest doesn't handle snowball collisions — host is authoritative
        if (this.gameMode === 'join') return;

        let snowball = null;
        let target = null;

        // Find snowball and target
        for (const sb of this.snowballs) {
            if (!sb.active) continue;
            if (sb.body === bodyA) {
                snowball = sb;
                target = this.getSpriteFromBody(bodyB);
            } else if (sb.body === bodyB) {
                snowball = sb;
                target = this.getSpriteFromBody(bodyA);
            }
        }

        // Check for any collision where snowball hits something that's not a character
        // This includes tiles, boundaries, water edges, and any other solid objects
        if (snowball && !target) {
            const otherBody = snowball.body === bodyA ? bodyB : bodyA;
            // Don't play sound if hitting another snowball
            if (otherBody.label === 'snowball') return;
            // Don't play sound if hitting the shooter (shouldn't happen but safety check)
            const shooter = snowball.getData('shooter');
            if (shooter && otherBody === shooter.body) return;

            // Play hit sound at lower volume for wall/environment impact
            // Snowball bounces naturally via Matter.js restitution (0.5)
            this.playSpatialSound('sfx-snowball-hit', snowball.x, snowball.y, 0.25);
            return;
        }

        if (snowball && target) {
            this.snowballHit(snowball, target);
        }
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

        // Player name
        if (this.hudPlayerName) this.hudPlayerName.textContent = '🐭 ' + (window.gameConfig?.nickname || GAME.PLAYER_NAME);

        // Player hearts
        if (this.hudPlayerHearts) this.hudPlayerHearts.textContent = this.getHeartsString(GAME.MAX_HEALTH);

        // Pause button
        if (this.hudPause) this.hudPause.addEventListener('click', () => this.showPauseMenu());

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

        // Guest: only visual effect, no state management (snapshot drives respawn)
        if (this.gameMode === 'join') {
            this.showDeathEffect(victim.x, victim.y);
            this.playSpatialSound('sfx-snowball-hit', victim.x, victim.y, 0.7);
            if (victim.nameLabel) victim.nameLabel.setVisible(false);
            // Simple fade — snapshot will restore when host respawns
            this.tweens.add({
                targets: victim,
                alpha: 0.3,
                duration: 500
            });
            return;
        }

        // === RAGDOLL EFFECT (host + solo) ===

        // 1. Unlock rotation for tumbling
        victim.setFixedRotation(false);

        // 2. Add random spin
        const spinDirection = Math.random() > 0.5 ? 1 : -1;
        this.matter.body.setAngularVelocity(victim.body, RAGDOLL.TUMBLE_SPEED * spinDirection);

        // 3. Boost knockback from killer
        if (killer) {
            const dx = victim.x - killer.x;
            const dy = victim.y - killer.y;
            const dist = Math.hypot(dx, dy) || 1;
            this.matter.body.applyForce(victim.body, victim.body.position, {
                x: (dx / dist) * PHYS.KNOCKBACK_FORCE * RAGDOLL.KNOCKBACK_BOOST,
                y: -0.015
            });
        }

        // 4. Add bounce
        victim.body.restitution = RAGDOLL.BOUNCE;

        // 5. Show death effect
        this.showDeathEffect(victim.x, victim.y);

        // 6. Play death sound
        this.playSpatialSound('sfx-snowball-hit', victim.x, victim.y, 0.7);

        // 7. Hide name label
        if (victim.nameLabel) victim.nameLabel.setVisible(false);

        // 8. After DURATION - fade out and handle round logic
        this.time.delayedCall(RAGDOLL.DURATION, () => {
            this.tweens.add({
                targets: victim,
                alpha: 0,
                duration: RAGDOLL.FADE_TIME,
                onComplete: () => {
                    victim.setActive(false);
                    victim.setVisible(false);
                    victim.setAlpha(1);
                    victim.setFixedRotation(true);
                    victim.body.restitution = 0;
                    // isDying stays true until respawnCharacter() clears it
                    this.matter.body.setAngularVelocity(victim.body, 0);
                    this.matter.body.setAngle(victim.body, 0);

                    this.handleDeathLogic(victim);
                }
            });
        });

        this.updateHUD();
    }

    handleDeathLogic(victim) {
        // Network host: handle deaths for both players
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
            this.time.delayedCall(2000, () => {
                this.respawnCharacter(victim);
            });
            return;
        }

        // Guest: death is handled via snapshot (applySnapshotToOwnPlayer), no logic here
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

    showHitEffect(x, y) {
        // Emoji particles for snowball hit feedback
        const particles = ['❄️', '💥', '✨'];

        for (let i = 0; i < 3; i++) {
            const emoji = particles[i % particles.length];
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
        this.player.setPosition(playerSpawn.x, playerSpawn.y);
        this.matter.body.setVelocity(this.player.body, { x: 0, y: 0 });
        if (this.player.core) this.player.core.releaseHook();
        this.player.setData('health', GAME.MAX_HEALTH);
        this.player.setData('isDying', false);
        this.player.setFixedRotation(true);
        this.player.setAngle(0);
        this.player.setActive(true);
        this.player.setVisible(true);
        if (this.player.nameLabel) {
            this.player.nameLabel.setVisible(true);
        }

        // Respawn bots at other spawn points
        this.bots.forEach((bot, index) => {
            const spawnIndex = (index + 1) % this.spawnPoints.length;
            const spawn = this.spawnPoints[spawnIndex];
            bot.setPosition(spawn.x, spawn.y);
            this.matter.body.setVelocity(bot.body, { x: 0, y: 0 });
            bot.core.releaseHook();
            bot.setData('health', GAME.MAX_HEALTH);
            bot.setData('isDying', false);
            bot.setFixedRotation(true);
            bot.setAngle(0);
            bot.setActive(true);
            bot.setVisible(true);
            if (bot.nameLabel) bot.nameLabel.setVisible(true);
        });
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

        character.setPosition(spawn.x, spawn.y);
        this.matter.body.setVelocity(character.body, { x: 0, y: 0 });
        if (character.core) character.core.releaseHook();
        character.setData('health', GAME.MAX_HEALTH);
        character.setData('isDying', false);
        character.setFixedRotation(true);
        character.setAngle(0);
        character.setActive(true);
        character.setVisible(true);
        if (character.nameLabel) character.nameLabel.setVisible(true);

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
        // Process pathfinding
        if (this.easystar) {
            this.easystar.calculate();
        }

        // Update ground detection
        this.updateGroundDetection();

        // 1. Own character — human input
        const playerInput = this.humanInput.getInput();
        playerInput.hookTarget = this.findHookTarget(this.player);
        this.updateCharacter(this.player, playerInput, delta);

        if (playerInput.fire) {
            this.shootSnowball(this.player, playerInput.fireDirection);
        }

        // 2. Guest character — network input (like a bot, but from network)
        if (this.guestPlayer?.active && !this.guestPlayer.getData('isDying')) {
            const guestInput = this.network?.getRemoteInput() || { direction: 0, jump: false, hook: false, hookJustPressed: false, fire: false, fireDirection: 0, strength: 1 };
            guestInput.hookTarget = this.findHookTarget(this.guestPlayer);
            this.updateCharacter(this.guestPlayer, guestInput, delta);
            if (guestInput.fire) {
                this.shootSnowball(this.guestPlayer, guestInput.fireDirection);
                // Reset fire so we don't shoot every frame
                if (this.network) {
                    const remoteInput = this.network.remoteInputs.get('guest');
                    if (remoteInput) remoteInput.fire = false;
                }
            }
            // Reset hook pulse so we don't launch/release every frame
            if (guestInput.hookJustPressed && this.network) {
                const remoteInput = this.network.remoteInputs.get('guest');
                if (remoteInput) remoteInput.hookJustPressed = false;
            }
        }

        // 3. Bots (solo mode only)
        this.bots.forEach(bot => {
            if (bot.active && bot.getData('health') > 0) {
                const botInput = bot.brain.update(bot, this, delta);
                this.updateCharacter(bot, botInput, delta);
                if (botInput.fire) {
                    this.shootSnowball(bot);
                }
            }
        });

        // 4. Snowballs, pickups, powerups
        this.updateSnowballs();
        this.updatePowerups(delta);

        // 5. Draw hooks
        this.drawHooks();

        // 6. UI
        this.updateHUD();
        this.updateNameLabels();

        // 7. Network — send snapshot
        if (this.network) {
            this.network.update(delta);
        }

        // 8. Bounds check
        this.checkBounds();
    }

    // === GUEST UPDATE (pure render from server snapshots, no local physics) ===

    updateAsGuest(delta) {
        // 1. Send input to host (hookTarget not needed — host computes it)
        const playerInput = this.humanInput.getInput();
        if (this.network) {
            this.network.sendInput(playerInput);
        }

        // 2. Get snapshot
        const snapshot = this.network?.lastSnapshot;
        if (!snapshot) {
            this.updateHUD();
            this.updateNameLabels();
            if (this.network) this.network.update(delta);
            return;
        }
        const interp = this.network?.getInterpolatedSnapshot();

        // 4. Render own player from snapshot (interpolated)
        const myData = snapshot.players?.find(p => p.id === 'guest');
        if (myData) {
            this.applySnapshotToOwnPlayer(myData, interp);
        }

        // 5. Render opponent from snapshot
        const hostData = snapshot.players?.find(p => p.id === 'host');
        if (hostData && this.hostSprite) {
            this.applySnapshotToHostSprite(hostData, interp);
        }

        // 6. Draw hooks from snapshot (both players)
        this.drawHooksFromSnapshot(snapshot);

        // 7. Sync snowballs (interpolated)
        this.syncSnowballVisuals(snapshot.snowballs || [], interp);

        // 8. Pickups, score
        this.syncPickupVisuals(snapshot.pickups || []);
        if (snapshot.score) {
            this.matchData.playerWins = snapshot.score.guestWins || 0;
            this.matchData.opponentWins = snapshot.score.hostWins || 0;
        }

        // 9. Events (sounds, effects — process once, then clear)
        if (snapshot.events?.length > 0) {
            for (const evt of snapshot.events) {
                if (evt.type === 'sound') {
                    this.playSpatialSound?.(evt.name, evt.x, evt.y, evt.vol || 0.5);
                }
                if (evt.type === 'hitEffect') this.showHitEffect(evt.x, evt.y);
                if (evt.type === 'deathEffect') this.showDeathEffect(evt.x, evt.y);
            }
            snapshot.events = [];
        }

        // 10. UI
        this.updateHUD();
        this.updateNameLabels();

        if (this.network) this.network.update(delta);
    }

    // === GUEST: RENDER OWN PLAYER FROM SNAPSHOT (no local physics) ===

    applySnapshotToOwnPlayer(data, interp) {
        const player = this.player;

        // Interpolated position
        if (interp) {
            const prev = interp.prev.players?.find(p => p.id === 'guest');
            const curr = interp.curr.players?.find(p => p.id === 'guest');
            if (prev && curr) {
                const t = interp.t;
                player.setPosition(
                    prev.x + (curr.x - prev.x) * t,
                    prev.y + (curr.y - prev.y) * t
                );
            } else {
                player.setPosition(data.x, data.y);
            }
        } else {
            player.setPosition(data.x, data.y);
        }

        // Facing + animation
        player.setFlipX(!data.facingRight);
        player.setData('facingRight', data.facingRight);
        if (data.animation) {
            const currentAnim = player.anims?.currentAnim?.key;
            if (currentAnim !== data.animation) {
                player.play(data.animation, true);
            }
        }

        // Death from server
        if (data.isDying && !player.getData('isDying')) {
            this.onCharacterDeath(player, null);
        }

        // Respawn from server
        if (!data.isDying && player.getData('isDying')) {
            player.setData('isDying', false);
            player.setData('health', data.health);
            player.setAlpha(1);
            player.setActive(true);
            player.setVisible(true);
            player.setAngle(0);
            if (player.nameLabel) player.nameLabel.setVisible(true);
        }

        // Health
        const prevHealth = player.getData('health');
        player.setData('health', data.health);
        if (data.health < prevHealth && data.health > 0) {
            player.setTint(0xffffff);
            this.time.delayedCall(100, () => player.clearTint());
        }

        // Powerup tint
        if (data.powerup) {
            const tints = { fire: 0xff8800, speed: 0xffff00, shield: 0x6666ff, doublejump: 0x66ff66 };
            player.setTint(tints[data.powerup] || 0xffffff);
        } else if (!data.isDying) {
            player.clearTint();
        }

        player.setVisible(data.isActive !== false);
    }

    // === GUEST: APPLY SNAPSHOT TO HOST (OPPONENT) SPRITE ===

    applySnapshotToHostSprite(data, interp) {
        const sprite = this.hostSprite;

        // Two-snapshot linear interpolation
        if (interp) {
            const prev = interp.prev.players?.find(p => p.id === 'host');
            const curr = interp.curr.players?.find(p => p.id === 'host');
            if (prev && curr) {
                const t = interp.t;
                sprite.setPosition(
                    prev.x + (curr.x - prev.x) * t,
                    prev.y + (curr.y - prev.y) * t
                );
            } else {
                sprite.setPosition(data.x, data.y);
            }
        } else {
            sprite.setPosition(data.x, data.y);
        }
        sprite.setFlipX(!data.facingRight);
        sprite.setData('health', data.health);
        sprite.setData('facingRight', data.facingRight);
        sprite.setData('isDying', data.isDying);

        // Animation
        if (data.animation) {
            const currentAnim = sprite.anims?.currentAnim?.key;
            if (currentAnim !== data.animation) {
                sprite.play(data.animation, true);
            }
        }

        // Powerup tint
        if (data.powerup) {
            const tints = { fire: 0xff8800, speed: 0xffff00, shield: 0x6666ff, doublejump: 0x66ff66 };
            sprite.setTint(tints[data.powerup] || 0xffffff);
        } else {
            sprite.clearTint();
        }

        sprite.setVisible(data.isActive !== false);
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
        const dirX = fireDirection || (this.player.getData('facingRight') ? 1 : -1);
        const sb = this.add.sprite(
            this.player.x + dirX * 60,
            this.player.y - 10,
            'snowball'
        );
        sb.setScale(0.5).setDepth(10);
        // Animate flight and fade
        this.tweens.add({
            targets: sb,
            x: sb.x + dirX * 300,
            alpha: 0,
            duration: 400,
            onComplete: () => sb.destroy()
        });
        this.playSpatialSound('sfx-snowball-shot', this.player.x, this.player.y, 0.4);
    }

    // === GUEST: DRAW HOOKS (own hook from local physics, opponent from snapshot) ===

    drawHooksFromSnapshot(snapshot) {
        this.hookGraphics.clear();

        // Draw aim line for own player (local-only, computed from tilemap)
        const myData = snapshot.players?.find(p => p.id === 'guest');
        if (myData && (!myData.hookState || myData.hookState === 'IDLE')) {
            const target = this.findHookTarget(this.player);
            if (target) {
                this.hookGraphics.lineStyle(2, 0xffffff, 0.3);
                this.hookGraphics.lineBetween(this.player.x, this.player.y, target.x, target.y);
                this.hookGraphics.strokeCircle(target.x, target.y, 10);
            }
        }

        const drawHook = (sprite, data) => {
            if (!data?.hookState || data.hookState === 'IDLE' || !data.hookPos) return;
            const color = 0x654321;
            this.hookGraphics.lineStyle(4, color, 1);
            this.hookGraphics.lineBetween(sprite.x, sprite.y, data.hookPos.x, data.hookPos.y);
            if (data.hookState === 'FLYING') {
                this.hookGraphics.fillStyle(0x444444, 1);
                this.hookGraphics.fillCircle(data.hookPos.x, data.hookPos.y, 6);
            } else if (data.hookState === 'ATTACHED') {
                this.hookGraphics.fillStyle(0xffcc00, 1);
                this.hookGraphics.fillCircle(data.hookPos.x, data.hookPos.y, 8);
            }
        };

        // Own hook from snapshot
        if (myData) drawHook(this.player, myData);

        // Opponent hook from snapshot
        const hostData = snapshot.players?.find(p => p.id === 'host');
        if (hostData && this.hostSprite) drawHook(this.hostSprite, hostData);
    }

    // === CHARACTER UPDATE ===

    updateCharacter(character, input, delta) {
        if (!character.active) return;

        // Force upright position while alive (prevents tipping on corners)
        if (!character.getData('isDying')) {
            character.setAngle(0);
        }

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

    /**
     * Get all valid targets in a given direction, sorted by distance
     */
    getTargetsInDirection(shooter, dirX) {
        const targets = [];

        if (this.player && this.player !== shooter && this.player.active && this.player.getData('health') > 0) {
            targets.push(this.player);
        }

        if (this.guestPlayer && this.guestPlayer !== shooter && this.guestPlayer.active && this.guestPlayer.getData('health') > 0) {
            targets.push(this.guestPlayer);
        }

        for (const bot of this.bots || []) {
            if (bot !== shooter && bot.active && bot.getData('health') > 0) {
                targets.push(bot);
            }
        }

        // Sort by distance in shooting direction
        return targets.sort((a, b) => {
            const distA = (a.x - shooter.x) * dirX;
            const distB = (b.x - shooter.x) * dirX;
            return distA - distB;
        });
    }

    shootSnowball(shooter, forceDirection = 0) {
        // Use forced direction if provided (from mobile touch buttons), otherwise use facing
        let dirX;
        if (forceDirection !== 0) {
            dirX = forceDirection;
        } else {
            const facingRight = shooter.getData('facingRight');
            dirX = facingRight ? 1 : -1;
        }
        const hasFire = this.hasPowerup(shooter, 'fire');

        // Adaptive spawn distance - spawn closer if enemy is nearby
        const targets = this.getTargetsInDirection(shooter, dirX);
        let spawnDistance = 60;  // Default

        for (const target of targets) {
            const dx = (target.x - shooter.x) * dirX;  // Distance in shooting direction
            if (dx > 0 && dx < 80) {
                // Enemy is close - spawn snowball closer (but outside own hitbox)
                spawnDistance = Math.max(25, dx - 30);
                break;
            }
        }

        const snowball = this.matter.add.sprite(
            shooter.x + dirX * spawnDistance,
            shooter.y - 10,
            'snowball',
            0,
            {
                shape: { type: 'circle', radius: 10 },
                friction: 0,
                frictionAir: 0,
                restitution: 0.5,
                isSensor: false,
                label: 'snowball'
            }
        );

        // Fire visual effects
        if (hasFire) {
            snowball.setTint(0xff4400);  // Orange-red
            snowball.setScale(0.7);       // Larger

            // Fire trail particles
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
        snowball.setVelocity(dirX * PHYS.SNOWBALL_SPEED, 0);
        snowball.setIgnoreGravity(true);

        snowball.setData('shooter', shooter);
        snowball.setData('damage', PHYS.SNOWBALL_DAMAGE);
        snowball.setData('ignoreShooterFrames', 5);
        snowball.setData('checkOverlap', 3);
        snowball.setData('netId', this._nextSnowballId++);

        this.snowballs.push(snowball);

        // Sound effect with spatial audio
        this.playSpatialSound('sfx-snowball-shot', shooter.x, shooter.y, 0.4);

        // Auto-destroy after 2 seconds (store timer for cancellation on hit)
        const destroyTimer = this.time.delayedCall(2000, () => {
            this.destroySnowball(snowball);
        });
        snowball.setData('destroyTimer', destroyTimer);
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
        this.playSpatialSound('sfx-snowball-hit', target.x, target.y, 1.0);
        this.showHitEffect(target.x, target.y);

        // Queue visual effect for guest (sound is auto-queued by playSpatialSound)
        if (this.network) {
            this.network.queueEvent({ type: 'hitEffect', x: target.x, y: target.y });
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
            if (!character?.active || !character.body || character.body.isStatic) return;
            if (character.x < 10) {
                character.setX(10);
                this.matter.body.setVelocity(character.body, { x: 0, y: character.body.velocity.y });
            }
            if (character.x > mapWidth - 10) {
                character.setX(mapWidth - 10);
                this.matter.body.setVelocity(character.body, { x: 0, y: character.body.velocity.y });
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
