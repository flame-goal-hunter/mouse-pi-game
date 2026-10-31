// ============================================
// GAME SCENE - Main Gameplay with SimplePhysicsWorld (v28)
// ============================================

import { PHYS, TILE_SIZE, GAME, PLAYER_COLORS, PICKUPS, RAGDOLL, getRandomBotName } from '../config.js?v=20261030_5';
import { CharacterCore } from '../physics/CharacterCore.js?v=20261030_5';
import { SimplePhysicsWorld } from '../physics/SimplePhysicsWorld.js?v=20261030_5';
import { BotBrain } from '../ai/BotBrain.js?v=20261030_5';
import { BotNav } from '../ai/BotNav.js?v=20261030_5';
import { HumanInput } from '../input/HumanInput.js?v=20261030_5';
import { NetworkManager } from '../network/NetworkManager.js';
import { ColyseusNetwork } from '../network/ColyseusNetwork.js?v=20261030_5';
import { Pickup } from '../entities/Pickup.js?v=20261030_5';
import { ArenaRenderer } from './ArenaRenderer.js?v=20261030_5';

export class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
    }

    init(data) {
        // Get config from scene data or fallback to global config (for direct launch)
        const config = (data && Object.keys(data).length > 0) ? data : (window.gameConfig || {});
        this.diffConfig = config.difficulty || window.gameConfig?.difficulty || window.parent?.__currentGameDifficulty || null;

        this.gameMode = config.mode || 'single';
        this.botCount = (this.gameMode === 'solo' || this.gameMode === 'single') && this.diffConfig?.botCount
            ? this.diffConfig.botCount
            : (config.botCount !== undefined ? config.botCount : 2);
        this.playerCharacter = config.character || 1; // 1 = brown bunny, 2 = gray bunny
        this.isHost = config.isHost || false;
        this.peerId = config.peerId || null;
    }

    create() {
        // Show HUD and mobile controls
        document.body.classList.add('game-active');

        // === MAP SETUP ===
        this.createMap();

        // === PATHFINDING (only needed when local bots exist) ===
        if (this.gameMode !== 'online' && this.gameMode !== 'join') {
            this.setupPathfinding();
        } else {
            this.botNav = null;
        }

        // === COLLISION CATEGORIES ===
        this.setupCollisionCategories();

        // === CHARACTERS ===
        this.createPlayer();
        this.guestPlayer = null;   // Host's server-side guest character
        this.hostSprite = null;    // Guest's display-only host sprite
        this.remotePlayers = new Map(); // sessionId -> display sprite (online 2-4 players)

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
        } else if (this.gameMode === 'join' || this.gameMode === 'online') {
            this.bots = [];
            // Create display sprite for host (no physics, position from snapshots)
            // v17.1 FIX: Host spawns at index 0, guest at index 1
            const hostChar = this.playerCharacter === 1 ? 2 : 1;
            this.hostSprite = this.createDisplaySprite(0, hostChar);
            this.hostSprite.setData('playerId', 'host');
            // Hide until server sends real host data (prevents "ghost" sprite)
            if (this.gameMode === 'online') this.hostSprite.setVisible(false);
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
            if (this.gameMode === 'online') this.hostSprite.nameLabel.setVisible(false);

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

        // === CENTER CTF: ЗАХВАТ ЗОЛОТОГО СЫРА (Teeworlds / TF2 style) ===
        this.initCTF();

        // === COLLISION HANDLERS ===
        this.setupCollisions();

        // === CAMERA (roundPixels=false avoids integer-snap judder at zoom=0.58) ===
        this.cameras.main.roundPixels = false;
        this.cameras.main.setBounds(0, 0, this.map.widthInPixels, this.map.heightInPixels);
        this.cameras.main.startFollow(this.player, false, 0.16, 0.16);
        this.cameras.main.setZoom(0.58);

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

        // === UI (zoom уже 0.7 для Rex Anchor) ===
        this.createUI();

        // === NETWORK (for multiplayer modes) ===
        this.network = null;
        this._nextSnowballId = 0;  // Unique snowball IDs (host assigns)

        if (this.gameMode === 'online') {
            // Authoritative server (Colyseus)
            this.network = new ColyseusNetwork();
            const serverUrl = window.gameConfig?.serverUrl || 'ws://localhost:2567';
            const nickname = window.gameConfig?.nickname || 'Игрок';
            const roomOpts = {
                roomCode: window.gameConfig?.roomCode || '',
                isPrivate: !!window.gameConfig?.isPrivate,
                botCount: window.gameConfig?.onlineBots
            };
            this.network.connect(serverUrl, nickname, this.playerCharacter, roomOpts)
                .then(ok => {
                    if (ok) {
                        console.log('[GameScene] Connected to Colyseus server');
                        const codeTxt = this.network.roomCode ? ` (Код: ${this.network.roomCode})` : '';
                        this.showMessage('Подключено к серверу' + codeTxt);
                    } else {
                        console.error('[GameScene] Colyseus connect failed:', this.network.connectError);
                        this.showMessage('Ошибка подключения: ' + this.network.connectError);
                    }
                });
        } else if (this.gameMode === 'host' || this.gameMode === 'join') {
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

        // === PAUSE & ARCADE STREAK STATE ===
        this.isGamePaused = false;
        this.buttonLocked = false;
        this._playerHitCombo = 0;
        this._playerKillStreak = 0;
        this._lastHitTime = 0;
        this._soundMuted = localStorage.getItem('mousie_muted') === '1';
        this.sound.mute = this._soundMuted;

        // === START UPBEAT SNOWBALL ARENA MUSIC ===
        this.playBackgroundMusic();
        this.showArcadeBanner('🧀 ЗАХВАТ ЗОЛОТОГО СЫРА! ❄️', 'Неси Сыр из центра на свою базу или выбивай врагов!', '#facc15');

        // === CLEANUP on scene shutdown (restart, stop, etc.) ===
        this.events.on('shutdown', () => {
            if (this.humanInput) this.humanInput.destroy();
            document.body.classList.remove('game-active');
            this._stopArcadeBeatLoop();
            if (this.bgm) {
                try { this.bgm.stop(); } catch (_) {}
                this.bgm = null;
            }
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
        const tileset = this.map.addTilesetImage('snow', 'ice-tiles');
        this._tileset = tileset; // Store for prediction world

        // Background tilemap layer (hidden — replaced by ArenaRenderer vector/canvas terrain)
        this.bgLayer = this.map.createLayer('background', tileset, 0, 0);
        if (this.bgLayer) {
            this.bgLayer.setVisible(false);
        }

        // Platforms layer (used for deterministic SimplePhysicsWorld + BotNav collision, hidden visually)
        this.platformLayer = this.map.createLayer('platforms', tileset, 0, 0);
        if (this.platformLayer) {
            this.platformLayer.setCollisionByExclusion([-1, 0]);
            this.platformLayer.setVisible(false);
        }

        // v29: Create SimplePhysicsWorld and initialize from tilemap (with 45° slope support)
        this.physicsWorld = new SimplePhysicsWorld(TILE_SIZE);
        if (this.platformLayer) {
            this.physicsWorld.initFromTilemap(this.platformLayer, tileset);
        }

        // Physics time scale for slow-motion effects
        this._physicsTimeScale = 1;

        // Trees tilemap layer (hidden — replaced by high-res scenic props + ArenaRenderer)
        this.treesLayer = this.map.createLayer('trees', tileset, 0, 0);
        if (this.treesLayer) {
            this.treesLayer.setVisible(false);
        }

        // === TEEWORLDS-STYLE SEAMLESS VECTOR TERRAIN & ALPINE PANORAMA ===
        if (this.platformLayer) {
            try {
                ArenaRenderer.renderArena(this, this.map, this.platformLayer);
            } catch (err) {
                console.error('[ArenaRenderer] Failed to render vector arena, falling back to tilemap:', err);
                this.platformLayer.setVisible(true);
            }
        }

        // === SCENIC WINTER PROPS (Sprite batch only — zero BlendModes.ADD flushes) ===
        this._decorateArenaProps();

        // === SHIMMERING ICY WATER HAZARD PIT ===
        const waterLayer = this.map.createLayer('water', tileset, 0, 0);
        this.waterBounds = null;
        if (waterLayer) {
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
                waterLayer.setVisible(false);

                const width = maxX - minX;
                const height = maxY - minY;

                // Deep water body
                this.waterSprite = this.add.tileSprite(
                    minX + width / 2,
                    minY + height / 2 + 12,
                    width,
                    height - 12,
                    'water-tile'
                ).setOrigin(0.5).setDepth(-5).setAlpha(0.92);

                // Animated surface waves strip at the top of the water pit
                if (this.textures.exists('water-surface')) {
                    this.waterSurfaceSprite = this.add.tileSprite(
                        minX + width / 2,
                        minY + 35,
                        width,
                        70,
                        'water-surface'
                    ).setOrigin(0.5).setDepth(5).setAlpha(0.94);
                }

                // Store water bounds for accurate hazard detection
                this.waterY = minY;
                this.waterBounds = { minX, maxX, minY, maxY };
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
                { x: 735, y: 1635 },
                { x: 4305, y: 1635 },
                { x: 1785, y: 1495 },
                { x: 3255, y: 1495 }
            ];
        }

        // v28: Validate spawn points - ensure there's ground below each
        this._validateSpawnPoints();

        // Bright sunny daytime sky fallback color
        this.cameras.main.setBackgroundColor('#75c4ff');
    }

    /**
     * Place high-res winter sprite props across the labyrinth arena.
     * Automatically snaps each prop to the exact flat solid snow surface underneath
     * so no tree, igloo, snowman, or crystal can ever float in mid-air!
     */
    _decorateArenaProps() {
        const T = TILE_SIZE;
        const placeProp = (key, tileX, tileY, scale = 0.55, depth = 1, flipX = false, sinkPx = 8) => {
            if (!this.textures.exists(key)) return null;

            const tx = Math.floor(tileX);
            let groundedY = Math.round(tileY);

            // Auto-verify and snap to the flat solid surface at column tx
            if (this.physicsWorld?.tileGrid) {
                const isFlatTop = (r) =>
                    this.physicsWorld._getTile(tx, r) === -1 &&
                    this.physicsWorld._getTile(tx, r - 1) === 0;

                if (!isFlatTop(groundedY)) {
                    let found = -1;
                    for (let d = 1; d <= 5; d++) {
                        if (isFlatTop(groundedY + d)) { found = groundedY + d; break; }
                        if (isFlatTop(groundedY - d)) { found = groundedY - d; break; }
                    }
                    if (found < 0) return null; // Never spawn a prop in empty air or on a slope!
                    groundedY = found;
                }
            }

            return this.add.image(tileX * T, groundedY * T + sinkPx, key)
                .setOrigin(0.5, 1)
                .setScale(scale)
                .setDepth(depth)
                .setFlipX(flipX);
        };

        // Tall snow-covered pine trees on wide flat snow terraces & galleries (framed cleanly around bases)
        placeProp('prop-tree1', 16.5, 25, 0.60, 1, false, 10);
        placeProp('prop-tree1', 55.5, 25, 0.60, 1, true, 10);
        placeProp('prop-tree2', 8.2,  22, 0.54, 1, false, 9);
        placeProp('prop-tree2', 63.2, 22, 0.54, 1, true, 9);
        placeProp('prop-tree1', 13.5, 8,  0.52, 1, false, 9);
        placeProp('prop-tree2', 56.5, 8,  0.50, 1, true, 9);

        // Cheerful snowmen on the Watchtower (y=23) & Right Cliff (y=21)
        placeProp('prop-snowman', 27.2, 23, 0.50, 1, false, 9);
        placeProp('prop-snowman', 45.8, 21, 0.50, 1, true, 9);

        // Crates, direction signs & ice rocks inside cavern bunkers & ziggurat decks
        placeProp('prop-crate', 25.5, 13, 0.48, 1, false, 8);
        placeProp('prop-crate', 44.5, 12, 0.48, 1, false, 8);
        placeProp('prop-sign2', 28.4, 23, 0.52, 1, false, 8);
        placeProp('prop-sign1', 43.2, 21, 0.52, 1, true, 8);
        placeProp('prop-stone', 13.2, 18, 0.52, 1, false, 8);
        placeProp('prop-stone', 59.5, 17, 0.52, 1, true, 8);

        // Ice crystals on alcoves, central chasm pillar & upper galleries
        placeProp('prop-crystal', 3.2,  16, 0.50, 1, false, 8);
        placeProp('prop-crystal', 68.2, 14, 0.50, 1, true, 8);
        placeProp('prop-crystal', 35.5, 24, 0.52, 1, false, 8);
        placeProp('prop-crystal', 7.5,  10, 0.48, 1, false, 8);
        placeProp('prop-crystal', 59.0, 8,  0.48, 1, true, 8);
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
                    // Found ground - store ground surface Y (createCharacterSprite subtracts 35)
                    const newSpawnY = checkY * TILE_SIZE;
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
        if (!this.physicsWorld?.tileGrid) return null;

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
                            const newY = ty * TILE_SIZE; // Ground surface Y (createCharacterSprite subtracts 35)
                            return { x: newX, y: newY };
                        }
                    }
                }
            }
        }

        return null;
    }

    /**
     * Play upbeat Snowball Arena background music (TF2/Cartoon Brass-Funk Battle Track)
     * and guarantee menu music is completely stopped!
     */
    playBackgroundMusic() {
        // 1. Ensure parent iframe's #menuMusic and any Phaser bgm-menu are 100% stopped!
        try {
            if (window.parent && window.parent !== window) {
                window.parent.stopMenuMusic?.();
                const parentMenuAudio = window.parent.document?.getElementById('menuMusic');
                if (parentMenuAudio) {
                    parentMenuAudio.pause();
                    parentMenuAudio.currentTime = 0;
                }
            }
        } catch (_) {}
        try {
            this.sound.stopByKey('bgm-menu');
        } catch (_) {}

        if (this.bgm) {
            try { this.bgm.stop(); } catch (_) {}
        }
        const bgmKey = this.cache.audio.exists('bgm-snowball') ? 'bgm-snowball' : null;
        if (bgmKey) {
            this.bgm = this.sound.add(bgmKey, {
                loop: true,
                volume: 0.34,
                rate: 1.0
            });
            if (!this._soundMuted && !this._isHiddenOrBackgrounded()) {
                try { this.bgm.play(); } catch (_) {}
            }
        }
        this._startArcadeBeatLoop();
    }

    _isHiddenOrBackgrounded() {
        if (this._appBackgrounded) return true;
        try {
            if (document.hidden) return true;
            if (window.parent && window.parent !== window && window.parent.document?.hidden) return true;
        } catch (_) {}
        return false;
    }

    _getAudioCtx(allowResume = true) {
        if (this._soundMuted || this._isHiddenOrBackgrounded()) return null;
        const phaserCtx = this.sound?.context;
        if (phaserCtx) {
            if (allowResume && phaserCtx.state === 'suspended') {
                phaserCtx.resume().catch(() => {});
            }
            return phaserCtx;
        }
        return null;
    }

    /**
     * Upbeat procedural winter-arcade chiptune bass & crystal arpeggio groove
     * Keeps the arena feeling energetic and catchy!
     */
    _startArcadeBeatLoop() {
        this._stopArcadeBeatLoop();
        this._beatStep = 0;
        // Catchy minor-pentatonic arcade progression (Am -> F -> G -> Em)
        const bassNotes = [
            110.00, 220.00, 110.00, 220.00,
            87.31,  174.61, 87.31,  174.61,
            98.00,  196.00, 98.00,  196.00,
            82.41,  164.81, 98.00,  196.00
        ];
        const arpNotes = [
            440.00, 523.25, 659.25, 523.25,
            349.23, 440.00, 523.25, 659.25,
            392.00, 493.88, 587.33, 493.88,
            329.63, 392.00, 493.88, 659.25
        ];

        this._beatInterval = setInterval(() => {
            if (this._soundMuted || this.isGamePaused || this._isHiddenOrBackgrounded() || !this.scene?.isActive()) return;
            const ac = this._getAudioCtx(false);
            if (!ac || ac.state !== 'running') return;

            const step = this._beatStep % 16;
            this._beatStep++;
            const now = ac.currentTime;

            // Boost intensity when on a streak or match point!
            const isHype = (this._playerKillStreak >= 2) ||
                (this.matchData && (this.matchData.playerWins >= GAME.WINS_TO_WIN - 1 || this.matchData.opponentWins >= GAME.WINS_TO_WIN - 1));

            try {
                // 1. Punchy sub-bass pulse on every eighth note
                const bassFreq = bassNotes[step];
                const bassOsc = ac.createOscillator();
                const bassGain = ac.createGain();
                bassOsc.type = 'triangle';
                bassOsc.frequency.setValueAtTime(bassFreq, now);
                const bVol = (step % 2 === 0 ? 0.048 : 0.032) * (isHype ? 1.25 : 1.0);
                bassGain.gain.setValueAtTime(bVol, now);
                bassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
                bassOsc.connect(bassGain);
                bassGain.connect(ac.destination);
                bassOsc.start(now);
                bassOsc.stop(now + 0.15);

                // 2. Sparkling icy lead arpeggio
                if (step % 2 === 0 || isHype) {
                    const arpFreq = arpNotes[step] * (isHype && step % 4 === 2 ? 1.5 : 1);
                    const arpOsc = ac.createOscillator();
                    const arpGain = ac.createGain();
                    arpOsc.type = 'sine';
                    arpOsc.frequency.setValueAtTime(arpFreq, now);
                    arpGain.gain.setValueAtTime(0.025, now);
                    arpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
                    arpOsc.connect(arpGain);
                    arpGain.connect(ac.destination);
                    arpOsc.start(now);
                    arpOsc.stop(now + 0.12);
                }
            } catch (_) {}
        }, 175);
    }

    _stopArcadeBeatLoop() {
        if (this._beatInterval) {
            clearInterval(this._beatInterval);
            this._beatInterval = null;
        }
    }

    toggleSoundMute() {
        this._soundMuted = !this._soundMuted;
        localStorage.setItem('mousie_muted', this._soundMuted ? '1' : '0');
        this.sound.mute = this._soundMuted;
        if (this.hudMusic) {
            this.hudMusic.textContent = this._soundMuted ? '🔇' : '🔊';
        }
        if (this._soundMuted) {
            if (this.bgm && this.bgm.isPlaying) this.bgm.pause();
        } else {
            if (this.bgm) {
                if (this.bgm.isPaused) this.bgm.resume();
                else if (!this.bgm.isPlaying) this.bgm.play();
            }
            this._playSynthFX('hitConfirm', 2);
        }
    }

    /**
     * Procedural WebAudio dopamine chimes for hit-confirms, combos, trick shots & KOs
     */
    _playSynthFX(type, level = 1) {
        const ac = this._getAudioCtx();
        if (!ac) return;
        const now = ac.currentTime;
        try {
            if (type === 'hitConfirm') {
                // Escalating pitch ding for consecutive hits!
                const scale = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50, 1174.66, 1318.51];
                const idx = Math.min(scale.length - 1, Math.max(0, (level || 1) - 1));
                const freq = scale[idx];

                const osc = ac.createOscillator();
                const g = ac.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, now);
                osc.frequency.exponentialRampToValueAtTime(freq * 1.25, now + 0.08);
                g.gain.setValueAtTime(0.18, now);
                g.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
                osc.connect(g);
                g.connect(ac.destination);
                osc.start(now);
                osc.stop(now + 0.15);
            } else if (type === 'trickShot') {
                // Sparkling two-note bonus chime
                [783.99, 1174.66].forEach((freq, i) => {
                    const osc = ac.createOscillator();
                    const g = ac.createGain();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(freq, now + i * 0.055);
                    g.gain.setValueAtTime(0.16, now + i * 0.055);
                    g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.055 + 0.16);
                    osc.connect(g);
                    g.connect(ac.destination);
                    osc.start(now + i * 0.055);
                    osc.stop(now + i * 0.055 + 0.17);
                });
            } else if (type === 'koFanfare') {
                // Triumphant arcade KO chord
                const mult = Math.min(1.5, 1 + (level - 1) * 0.12);
                [523.25, 659.25, 783.99, 1046.50].forEach((baseFreq, i) => {
                    const osc = ac.createOscillator();
                    const g = ac.createGain();
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(baseFreq * mult, now + i * 0.045);
                    g.gain.setValueAtTime(0.16, now + i * 0.045);
                    g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.045 + 0.22);
                    osc.connect(g);
                    g.connect(ac.destination);
                    osc.start(now + i * 0.045);
                    osc.stop(now + i * 0.045 + 0.23);
                });
            } else if (type === 'hookFire') {
                // Pneumatic TF2-style grapple launcher spring + cable zip
                const osc = ac.createOscillator();
                const g = ac.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(340, now);
                osc.frequency.exponentialRampToValueAtTime(1180, now + 0.11);
                g.gain.setValueAtTime(0.10, now);
                g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
                osc.connect(g);
                g.connect(ac.destination);
                osc.start(now);
                osc.stop(now + 0.125);
            } else if (type === 'hookLatch') {
                // Crisp double metallic claw clink + taut rope twang when grapple attaches
                [1120, 1680].forEach((freq, i) => {
                    const osc = ac.createOscillator();
                    const g = ac.createGain();
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(freq, now + i * 0.028);
                    osc.frequency.exponentialRampToValueAtTime(freq * 1.25, now + i * 0.028 + 0.05);
                    g.gain.setValueAtTime(0.14, now + i * 0.028);
                    g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.028 + 0.075);
                    osc.connect(g);
                    g.connect(ac.destination);
                    osc.start(now + i * 0.028);
                    osc.stop(now + i * 0.028 + 0.08);
                });
            } else if (type === 'cheeseGrab') {
                // Bright heroic brass/synth fanfare when grabbing the Golden Cheese
                [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
                    const osc = ac.createOscillator();
                    const g = ac.createGain();
                    osc.type = 'triangle';
                    const t0 = now + i * 0.05;
                    osc.frequency.setValueAtTime(freq, t0);
                    g.gain.setValueAtTime(0.18, t0);
                    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
                    osc.connect(g);
                    g.connect(ac.destination);
                    osc.start(t0);
                    osc.stop(t0 + 0.19);
                });
            } else if (type === 'cheeseDrop') {
                // Alert descending notes when Golden Cheese is knocked loose
                [659.25, 493.88, 349.23].forEach((freq, i) => {
                    const osc = ac.createOscillator();
                    const g = ac.createGain();
                    osc.type = 'sawtooth';
                    const t0 = now + i * 0.06;
                    osc.frequency.setValueAtTime(freq, t0);
                    g.gain.setValueAtTime(0.12, t0);
                    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
                    osc.connect(g);
                    g.connect(ac.destination);
                    osc.start(t0);
                    osc.stop(t0 + 0.17);
                });
            } else if (type === 'cheeseScore') {
                // Grand TF2/Teeworlds flag capture fanfare!
                [523.25, 659.25, 783.99, 1046.50, 1318.51].forEach((freq, i) => {
                    const osc = ac.createOscillator();
                    const g = ac.createGain();
                    osc.type = 'triangle';
                    const t0 = now + i * 0.065;
                    osc.frequency.setValueAtTime(freq, t0);
                    g.gain.setValueAtTime(0.22, t0);
                    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);
                    osc.connect(g);
                    g.connect(ac.destination);
                    osc.start(t0);
                    osc.stop(t0 + 0.29);
                });
            }
        } catch (_) {}
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
        // BotNav — bMod Delaunay + Floyd-Warshall navigation
        this.botNav = new BotNav();
        if (this.platformLayer) {
            this.botNav.build(this.platformLayer, this.map.width, this.map.height, TILE_SIZE);
        }
    }

    // === CHARACTERS ===

    createCharacterSprite(spawnIndex, charNum, label) {
        const spawn = this.spawnPoints[spawnIndex % this.spawnPoints.length] || { x: 400, y: 400 };
        const spawnY = spawn.y - 35; // Offset up by halfH+5 so body doesn't overlap platform
        const spriteKey = `p${charNum}-stand`;

        const character = this.add.sprite(spawn.x, spawnY, spriteKey);
        character.setOrigin(0.5, 0.56);
        character.setDepth(10);
        character.setScale(0.50);

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
        character.animPrefix = `p${charNum}`;

        return character;
    }

    createDisplaySprite(spawnIndex, charNum) {
        const spawn = this.spawnPoints[spawnIndex % this.spawnPoints.length] || { x: 600, y: 400 };
        const spriteKey = `p${charNum}-stand`;

        // Display-only sprite (no physics body — position from server snapshots)
        const sprite = this.add.sprite(spawn.x, spawn.y, spriteKey);
        sprite.setOrigin(0.5, 0.56);
        sprite.setDepth(10);
        sprite.setScale(0.50);
        sprite.animPrefix = `p${charNum}`;
        sprite._physLabel = 'display';
        sprite.setData('health', GAME.MAX_HEALTH);
        sprite.setData('facingRight', true);

        return sprite;
    }

    createPlayer() {
        const spawnIndex = (this.gameMode === 'join' || this.gameMode === 'online') ? 1 : 0;
        const charNum = this.playerCharacter || 1;

        if (this.gameMode === 'join') {
            // Legacy P2P guest: create prediction world + physics body for local prediction
            this._createPredictionWorld(spawnIndex, charNum);
        } else {
            // Solo, Host, and Colyseus Online mode (uses local SimplePhysicsWorld + CharacterCore for client-side prediction & reconciliation)
            this.player = this.createCharacterSprite(spawnIndex, charNum, 'player');
            if ((this.gameMode === 'solo' || this.gameMode === 'single') && this.diffConfig?.maxHealth) {
                this.player.setData('maxHealth', this.diffConfig.maxHealth);
                this.player.setData('health', this.diffConfig.maxHealth);
            }
        }
        this.player.setData('colorIndex', 0);
        this.player.setData('playerId', (this.isHost || this.gameMode === 'host') ? 'host' : 'guest');
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

        // v29: Create separate SimplePhysicsWorld for prediction (same as host, with slopes)
        this.predictionWorld = new SimplePhysicsWorld(TILE_SIZE);
        if (this.platformLayer) {
            this.predictionWorld.initFromTilemap(this.platformLayer, this._tileset);
            const solidCount = this.predictionWorld.tileGrid.flat().filter(v => v !== 0).length;
            console.log('[Guest] predictionWorld tileGrid:', this.predictionWorld.gridWidth, 'x', this.predictionWorld.gridHeight,
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
        character.setOrigin(0.5, 0.56);
        character.setDepth(10);
        character.setScale(0.50);
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
            bot.brain = new BotBrain(this);

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

    onPickupCollected(character, type, config, x, y) {
        const labels = {
            health:     { text: '❤️ +ЗДОРОВЬЕ!', color: '#4ade80' },
            fire:       { text: '🔥 ОГНЕННЫЕ СНЕЖКИ!', color: '#fb923c' },
            speed:      { text: '⚡ СУПЕР-СКОРОСТЬ!', color: '#fde047' },
            shield:     { text: '🛡️ ЛЕДЯНОЙ ЩИТ!', color: '#60a5fa' },
            doublejump: { text: '🦘 ДВОЙНОЙ ПРЫЖОК!', color: '#a855f7' }
        };
        const info = labels[type] || { text: '✨ БОНУС!', color: '#ffffff' };
        this.showFloatingCallout(x, y - 20, info.text, info.color, 22);
        if (character === this.player) {
            this._playSynthFX('trickShot', 2);
            this.updateHUD();
        }
    }

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

    // === CENTER CTF: ЗАХВАТ ЗОЛОТОГО СЫРА (Teeworlds / TF2 style) ===

    _ensureGoldenCheeseTexture() {
        if (this.textures.exists('golden-cheese-flag')) return;
        const canvas = document.createElement('canvas');
        canvas.width = 96;
        canvas.height = 96;
        const ctx = canvas.getContext('2d');

        ctx.save();
        ctx.translate(48, 50);

        // Outer golden glow
        const glow = ctx.createRadialGradient(0, -4, 6, 0, -4, 44);
        glow.addColorStop(0, 'rgba(253, 224, 71, 0.75)');
        glow.addColorStop(0.6, 'rgba(250, 204, 21, 0.25)');
        glow.addColorStop(1, 'rgba(250, 204, 21, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, -4, 44, 0, Math.PI * 2);
        ctx.fill();

        // 3D Cheese Wedge Back Crust / Bottom Side
        ctx.fillStyle = '#d97706';
        ctx.strokeStyle = '#451a03';
        ctx.lineWidth = 4.5;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(-28, 6);
        ctx.lineTo(28, 12);
        ctx.lineTo(28, -8);
        ctx.lineTo(-8, -26);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Top Slanted Face of Swiss Cheese Wedge
        const topGrad = ctx.createLinearGradient(-24, -26, 24, 6);
        topGrad.addColorStop(0, '#fef08a');
        topGrad.addColorStop(0.5, '#facc15');
        topGrad.addColorStop(1, '#f59e0b');
        ctx.fillStyle = topGrad;
        ctx.beginPath();
        ctx.moveTo(-28, 6);
        ctx.lineTo(28, -8);
        ctx.lineTo(-6, -27);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Front Vertical Face of Cheese Wedge
        const frontGrad = ctx.createLinearGradient(-28, -8, 28, 16);
        frontGrad.addColorStop(0, '#fde047');
        frontGrad.addColorStop(1, '#eab308');
        ctx.fillStyle = frontGrad;
        ctx.beginPath();
        ctx.moveTo(-28, 6);
        ctx.lineTo(28, -8);
        ctx.lineTo(28, 15);
        ctx.lineTo(-28, 20);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Classic Swiss Cheese Holes
        const holes = [
            { x: -12, y: 11, rx: 5.5, ry: 4.2 },
            { x: 6, y: 8, rx: 6.5, ry: 4.8 },
            { x: 18, y: 2, rx: 4.0, ry: 3.2 },
            { x: -3, y: -11, rx: 5.2, ry: 3.4 },
            { x: -15, y: -2, rx: 3.8, ry: 2.8 }
        ];
        for (const h of holes) {
            ctx.fillStyle = '#b45309';
            ctx.beginPath();
            ctx.ellipse(h.x, h.y, h.rx, h.ry, -0.15, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#d97706';
            ctx.beginPath();
            ctx.ellipse(h.x + 1, h.y + 0.8, h.rx * 0.78, h.ry * 0.78, -0.15, 0, Math.PI * 2);
            ctx.fill();
        }

        // Specular Gloss Highlight
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-20, 4);
        ctx.lineTo(18, -5);
        ctx.stroke();

        ctx.restore();
        this.textures.addCanvas('golden-cheese-flag', canvas);
    }

    initCTF() {
        this._ensureGoldenCheeseTexture();

        this.ctf = {
            homeX: 2520,
            homeY: 655,
            groundY: 700,
            blueBase: { x: 385, y: 1500, groundY: 1540 },
            redBase: { x: 4655, y: 1500, groundY: 1540 },
            state: 'HOME',        // 'HOME' | 'CARRIED' | 'DROPPED'
            x: 2520,
            y: 655,
            vx: 0,
            vy: 0,
            carrier: null,
            carrierSid: '',
            carrierHits: 0,
            dropIgnoreWho: null,
            dropIgnoreUntil: 0,
            droppedAt: 0,
            scoringLock: false
        };

        this._drawCTFBasesAndPedestal();

        // Pulsing aura behind Golden Cheese
        this.ctfCheeseGlow = this.add.circle(this.ctf.x, this.ctf.y, 34, 0xfde047, 0.28).setDepth(14);
        this.tweens.add({
            targets: this.ctfCheeseGlow,
            scale: 1.28,
            alpha: 0.12,
            duration: 750,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });

        // Golden Cheese Sprite
        this.ctfCheeseSprite = this.add.sprite(this.ctf.x, this.ctf.y, 'golden-cheese-flag')
            .setDepth(15)
            .setScale(0.88);

        // World-space label above the Golden Cheese when on pedestal or dropped
        this.ctfCheeseLabel = this.add.text(this.ctf.x, this.ctf.y - 46, '🧀 ЗОЛОТОЙ СЫР', {
            fontFamily: "'Nunito', Arial Black, sans-serif",
            fontSize: '14px',
            fontStyle: 'bold',
            color: '#fef08a',
            stroke: '#451a03',
            strokeThickness: 4,
            backgroundColor: 'rgba(120, 53, 15, 0.78)',
            padding: { x: 8, y: 3 }
        }).setOrigin(0.5, 1).setDepth(155);

        // Orbiting directional compass arrow around player (world-space)
        this.ctfCompassGraphics = this.add.graphics().setDepth(160);
        this.ctfCompassText = this.add.text(0, 0, '', {
            fontFamily: "'Nunito', Arial Black, sans-serif",
            fontSize: '13px',
            fontStyle: 'bold',
            color: '#fef08a',
            stroke: '#0f172a',
            strokeThickness: 4
        }).setOrigin(0.5).setDepth(161);
    }

    _ensureCTFStructuresTextures() {
        // 1. Center Golden Cheese Altar Pedestal Texture
        if (!this.textures.exists('ctf-cheese-altar')) {
            const c = document.createElement('canvas');
            c.width = 220;
            c.height = 130;
            const ctx = c.getContext('2d');
            ctx.save();
            ctx.translate(110, 118);

            // Soft golden ground light pool
            const pool = ctx.createRadialGradient(0, -4, 6, 0, -4, 96);
            pool.addColorStop(0, 'rgba(250, 204, 21, 0.42)');
            pool.addColorStop(0.55, 'rgba(245, 158, 11, 0.14)');
            pool.addColorStop(1, 'rgba(245, 158, 11, 0)');
            ctx.fillStyle = pool;
            ctx.beginPath();
            ctx.ellipse(0, -2, 94, 16, 0, 0, Math.PI * 2);
            ctx.fill();

            // Lower Chiseled Glacier Stone Plinth
            const stoneGrad = ctx.createLinearGradient(0, -34, 0, 0);
            stoneGrad.addColorStop(0, '#475569');
            stoneGrad.addColorStop(0.5, '#334155');
            stoneGrad.addColorStop(1, '#1e293b');
            ctx.fillStyle = stoneGrad;
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 4;
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(-76, 0);
            ctx.lineTo(-68, -18);
            ctx.lineTo(68, -18);
            ctx.lineTo(76, 0);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Upper Stepped Stone Pedestal
            ctx.fillStyle = '#64748b';
            ctx.beginPath();
            ctx.moveTo(-56, -18);
            ctx.lineTo(-48, -34);
            ctx.lineTo(48, -34);
            ctx.lineTo(56, -18);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Glowing Golden Rune Trim & Cushion
            const goldGrad = ctx.createLinearGradient(-44, -44, 44, -32);
            goldGrad.addColorStop(0, '#fef08a');
            goldGrad.addColorStop(0.5, '#facc15');
            goldGrad.addColorStop(1, '#d97706');
            ctx.fillStyle = goldGrad;
            ctx.beginPath();
            ctx.roundRect(-44, -44, 88, 12, 6);
            ctx.fill();
            ctx.stroke();

            // Center Gem Emblem on Pedestal Front
            ctx.fillStyle = '#38bdf8';
            ctx.beginPath();
            ctx.moveTo(0, -31);
            ctx.lineTo(9, -22);
            ctx.lineTo(0, -13);
            ctx.lineTo(-9, -22);
            ctx.closePath();
            ctx.fill();
            ctx.lineWidth = 2.5;
            ctx.stroke();

            // Fluffy Snow Drifts on Pedestal Corners
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.ellipse(-58, -17, 16, 5.5, -0.1, 0, Math.PI * 2);
            ctx.ellipse(58, -17, 16, 5.5, 0.1, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
            this.textures.addCanvas('ctf-cheese-altar', c);
        }

        // 2. Team Base Igloo Fortress Textures (Blue & Red)
        const buildIglooTexture = (key, isBlue) => {
            if (this.textures.exists(key)) return;
            const c = document.createElement('canvas');
            c.width = 280;
            c.height = 220;
            const ctx = c.getContext('2d');
            ctx.save();
            ctx.translate(140, 204);

            const teamLight = isBlue ? '#7dd3fc' : '#fca5a5';
            const teamMain = isBlue ? '#0284c7' : '#dc2626';
            const teamDark = isBlue ? '#1e3a8a' : '#7f1d1d';
            const dir = isBlue ? 1 : -1; // Entrance tunnel faces inward toward arena center!

            // 1. Soft Ambient Ground Shadow & Glowing Capture Pad
            const padGlow = ctx.createRadialGradient(0, -4, 10, 0, -4, 122);
            padGlow.addColorStop(0, isBlue ? 'rgba(56, 189, 248, 0.42)' : 'rgba(248, 113, 113, 0.42)');
            padGlow.addColorStop(0.6, isBlue ? 'rgba(14, 165, 233, 0.14)' : 'rgba(220, 38, 38, 0.14)');
            padGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = padGlow;
            ctx.beginPath();
            ctx.ellipse(0, -2, 120, 18, 0, 0, Math.PI * 2);
            ctx.fill();

            // 2. Tall Carved Totem Flagpole behind/beside the Igloo
            const poleX = -dir * 78;
            ctx.save();
            // Wooden totem pole shaft
            const woodGrad = ctx.createLinearGradient(poleX - 6, 0, poleX + 6, 0);
            woodGrad.addColorStop(0, '#78350f');
            woodGrad.addColorStop(0.5, '#b45309');
            woodGrad.addColorStop(1, '#451a03');
            ctx.fillStyle = woodGrad;
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 4;
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.roundRect(poleX - 5, -168, 10, 166, 4);
            ctx.fill();
            ctx.stroke();

            // Waving Swallowtail Team Banner Flag
            const flagGrad = ctx.createLinearGradient(poleX, -162, poleX - dir * 68, -120);
            flagGrad.addColorStop(0, teamLight);
            flagGrad.addColorStop(0.35, teamMain);
            flagGrad.addColorStop(1, teamDark);
            ctx.fillStyle = flagGrad;
            ctx.beginPath();
            ctx.moveTo(poleX, -162);
            ctx.quadraticCurveTo(poleX + dir * 32, -170, poleX + dir * 66, -152);
            ctx.lineTo(poleX + dir * 50, -138);
            ctx.lineTo(poleX + dir * 64, -122);
            ctx.quadraticCurveTo(poleX + dir * 30, -116, poleX, -124);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Gold trim & Cheese/Star emblem on flag
            ctx.fillStyle = '#fde047';
            ctx.beginPath();
            ctx.arc(poleX + dir * 24, -142, 7.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.stroke();

            // Golden Finial Orb on top of flagpole
            ctx.fillStyle = '#facc15';
            ctx.lineWidth = 3.5;
            ctx.beginPath();
            ctx.arc(poleX, -172, 8.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 3. Cozy Stone Chimney on upper-back of Igloo Dome
            const chimX = -dir * 34;
            ctx.save();
            ctx.translate(chimX, -110);
            ctx.rotate(-dir * 0.18);
            ctx.fillStyle = '#475569';
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.roundRect(-11, -24, 22, 28, 4);
            ctx.fill();
            ctx.stroke();
            // Snow rim on chimney
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.roundRect(-14, -27, 28, 9, 4);
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 4. Main Sculpted 3D Snow-Brick Igloo Dome
            const domeX = -dir * 8;
            const domeRx = 78;
            const domeRy = 68;

            ctx.save();
            ctx.beginPath();
            ctx.ellipse(domeX, -6, domeRx, domeRy, 0, Math.PI, 0, false);
            ctx.lineTo(domeX + domeRx, -2);
            ctx.quadraticCurveTo(domeX, 6, domeX - domeRx, -2);
            ctx.closePath();

            // Rich 3D Spherical Ice-Snow Gradient
            const domeGrad = ctx.createRadialGradient(domeX - dir * 18, -52, 10, domeX, -20, domeRx * 1.15);
            domeGrad.addColorStop(0.00, '#ffffff');
            domeGrad.addColorStop(0.45, '#e0f2fe');
            domeGrad.addColorStop(0.82, '#bae6fd');
            domeGrad.addColorStop(1.00, '#7dd3fc');
            ctx.fillStyle = domeGrad;
            ctx.fill();

            // Clip inside dome to draw chiseled snow-brick courses & team stripe
            ctx.save();
            ctx.clip();

            // Curved horizontal snow-brick courses
            ctx.strokeStyle = 'rgba(2, 132, 199, 0.28)';
            ctx.lineWidth = 3;
            const brickRows = [-22, -42, -58];
            brickRows.forEach((ry, idx) => {
                ctx.beginPath();
                ctx.ellipse(domeX, ry + 14, domeRx + 8, 16, 0, Math.PI, 0, false);
                ctx.stroke();

                // Vertical staggered mortar joints
                const count = 5 - idx;
                for (let b = 0; b < count; b++) {
                    const bx = domeX - 58 + b * 30 + (idx % 2) * 14;
                    ctx.beginPath();
                    ctx.moveTo(bx, ry - 2);
                    ctx.lineTo(bx + (bx - domeX) * 0.08, ry + 16);
                    ctx.stroke();
                }
            });

            // Painted Team Fortress Stripe Band across the Igloo Dome
            ctx.fillStyle = teamMain;
            ctx.beginPath();
            ctx.ellipse(domeX, -18, domeRx + 6, 15, 0, Math.PI, 0, false);
            ctx.lineWidth = 10;
            ctx.strokeStyle = teamMain;
            ctx.stroke();
            ctx.lineWidth = 3;
            ctx.strokeStyle = teamLight;
            ctx.stroke();

            // Specular highlight on upper snow crown
            ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
            ctx.beginPath();
            ctx.ellipse(domeX - dir * 14, -56, 34, 12, -dir * 0.2, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();

            // Crisp Dark Ink Outline around Igloo Dome
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 5;
            ctx.lineJoin = 'round';
            ctx.stroke();
            ctx.restore();

            // 5. Arched Front Entrance Tunnel (offset toward arena center) with Warm Golden Hearth Glow
            const archX = domeX + dir * 42;
            const archW = 36;
            const archH = 42;

            ctx.save();
            // Outer snow-brick tunnel arch
            const archGrad = ctx.createLinearGradient(archX, -archH - 10, archX, 0);
            archGrad.addColorStop(0, '#ffffff');
            archGrad.addColorStop(0.6, '#dbeafe');
            archGrad.addColorStop(1, '#93c5fd');
            ctx.fillStyle = archGrad;
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 4.5;
            ctx.beginPath();
            ctx.ellipse(archX, -4, archW, archH, 0, Math.PI, 0, false);
            ctx.lineTo(archX + archW, -2);
            ctx.lineTo(archX - archW, -2);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Arch keystone mortar radial ticks
            ctx.strokeStyle = 'rgba(2, 132, 199, 0.35)';
            ctx.lineWidth = 2.5;
            for (let a = 0.22; a < Math.PI - 0.2; a += 0.45) {
                const ca = Math.cos(a);
                const sa = Math.sin(a);
                ctx.beginPath();
                ctx.moveTo(archX + ca * (archW - 11), -4 - sa * (archH - 11));
                ctx.lineTo(archX + ca * (archW - 2), -4 - sa * (archH - 2));
                ctx.stroke();
            }

            // Inner Tunnel Opening with Warm Cozy Golden Hearth Glow!
            const inW = archW - 12;
            const inH = archH - 12;
            const hearthGrad = ctx.createRadialGradient(archX, -8, 2, archX, -14, inH);
            hearthGrad.addColorStop(0.00, '#fef08a');
            hearthGrad.addColorStop(0.45, '#f59e0b');
            hearthGrad.addColorStop(0.85, '#7c2d12');
            hearthGrad.addColorStop(1.00, '#1e1b4b');
            ctx.fillStyle = hearthGrad;
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.ellipse(archX, -3, inW, inH, 0, Math.PI, 0, false);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Team Shield Crest above the Entrance Arch
            const crestY = -archH - 4;
            ctx.fillStyle = teamMain;
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 3.5;
            ctx.beginPath();
            ctx.moveTo(archX - 13, crestY - 10);
            ctx.lineTo(archX + 13, crestY - 10);
            ctx.lineTo(archX + 11, crestY + 4);
            ctx.lineTo(archX, crestY + 13);
            ctx.lineTo(archX - 11, crestY + 4);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#fde047';
            ctx.beginPath();
            ctx.arc(archX, crestY, 4.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            // 6. Ground Snowbank & Glowing Team Capture Pad Base
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.ellipse(-48, -3, 38, 8, 0, 0, Math.PI * 2);
            ctx.ellipse(46, -3, 38, 8, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            const padBarGrad = ctx.createLinearGradient(-84, -8, 84, 4);
            padBarGrad.addColorStop(0, teamDark);
            padBarGrad.addColorStop(0.5, teamMain);
            padBarGrad.addColorStop(1, teamDark);
            ctx.fillStyle = padBarGrad;
            ctx.beginPath();
            ctx.roundRect(-84, -7, 168, 10, 5);
            ctx.fill();
            ctx.stroke();

            ctx.restore();
            this.textures.addCanvas(key, c);
        };

        buildIglooTexture('ctf-igloo-blue', true);
        buildIglooTexture('ctf-igloo-red', false);
    }

    _drawCTFBasesAndPedestal() {
        this._ensureCTFStructuresTextures();

        // 1. Center Pedestal at (2520, 700)
        const cx = this.ctf.homeX;
        const cy = this.ctf.groundY;
        this.add.image(cx, cy + 8, 'ctf-cheese-altar')
            .setOrigin(0.5, 1)
            .setDepth(5);

        // 2. Team Base Igloo Fortresses (Blue Left & Red Right)
        const placeBase = (bx, by, isBlue, title) => {
            const texKey = isBlue ? 'ctf-igloo-blue' : 'ctf-igloo-red';
            this.add.image(bx, by + 10, texKey)
                .setOrigin(0.5, 1)
                .setDepth(5);

            // Subtle pulsing ground aura ring for the capture zone
            const ringColor = isBlue ? 0x38bdf8 : 0xf87171;
            const zoneGlow = this.add.ellipse(bx, by - 4, 156, 22, ringColor, 0.22).setDepth(4);
            this.tweens.add({
                targets: zoneGlow,
                scaleX: 1.12,
                scaleY: 1.18,
                alpha: 0.08,
                duration: 950,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });

            // Clean, compact studio badge above the Igloo
            this.add.text(bx, by - 178, title, {
                fontFamily: "'Nunito', Arial Black, sans-serif",
                fontSize: '13px',
                fontStyle: 'bold',
                color: isBlue ? '#e0f2fe' : '#fee2e2',
                stroke: '#0f172a',
                strokeThickness: 4,
                backgroundColor: isBlue ? 'rgba(3, 105, 161, 0.82)' : 'rgba(185, 28, 28, 0.82)',
                padding: { x: 10, y: 3 }
            }).setOrigin(0.5, 1).setDepth(15);
        };

        placeBase(this.ctf.blueBase.x, this.ctf.blueBase.groundY, true, '🏠 БАЗА ПИ · ДОСТАВЬ СЫР');
        placeBase(this.ctf.redBase.x, this.ctf.redBase.groundY, false, '🔥 БАЗА СОПЕРНИКОВ');
    }

    _getCharacterTargetBase(character) {
        if (!this.ctf) return { x: 385, y: 1500 };
        if (character === this.player) {
            // In online mode, check colorIndex if assigned
            if (this.gameMode === 'online') {
                const me = this.network?.lastSnapshot?.players?.find(p => p.isSelf);
                if (me && (me.colorIndex % 2 === 1)) return this.ctf.redBase;
            }
            return this.ctf.blueBase;
        }
        return this.ctf.redBase;
    }

    pickupCTFCheese(character) {
        if (!this.ctf || !character) return;
        this.ctf.state = 'CARRIED';
        this.ctf.carrier = character;
        this.ctf.carrierHits = 0;
        this.ctf.vx = 0;
        this.ctf.vy = 0;

        if (character === this.player) {
            this._playSynthFX('cheeseGrab', 1);
            this.showFloatingCallout(character.x, character.y - 70, '🧀 СЫР У ТЕБЯ!', '#fde047', 24);
            this.showArcadeBanner('🧀 ТЫ СХВАТИЛ ЗОЛОТОЙ СЫР!', 'Неси его на верёвке в Синий Иглу слева!', '#fde047');
        } else {
            this._playSynthFX('cheeseDrop', 1);
            const name = character.getData?.('botName') || character.nameLabel?.text || 'Соперник';
            this.showFloatingCallout(character.x, character.y - 70, '🚨 СХВАТИЛ СЫР!', '#f87171', 22);
            this.showArcadeBanner(`🚨 ${name} СХВАТИЛ СЫР!`, 'Попади в него 2 снежками, чтобы выбить Сыр!', '#f87171');
        }
    }

    dropCTFCheese(carrier, hitVx = 0) {
        if (!this.ctf || this.ctf.state !== 'CARRIED') return;
        const dropX = carrier ? carrier.x : this.ctf.x;
        const dropY = carrier ? carrier.y - 24 : this.ctf.y;

        this.ctf.state = 'DROPPED';
        this.ctf.carrier = null;
        this.ctf.carrierSid = '';
        this.ctf.carrierHits = 0;
        this.ctf.x = dropX;
        this.ctf.y = dropY;
        const dir = hitVx !== 0 ? Math.sign(hitVx) : (Math.random() > 0.5 ? 1 : -1);
        this.ctf.vx = dir * 175;
        this.ctf.vy = -410;
        this.ctf.dropIgnoreWho = carrier;
        this.ctf.dropIgnoreUntil = Date.now() + 1350;
        this.ctf.droppedAt = Date.now();

        this._playSynthFX('cheeseDrop', 1);
        this.showFloatingCallout(dropX, dropY - 40, '🧀 СЫР ВЫБИТ!', '#facc15', 24);
        this.showArcadeBanner('🧀 СЫР УПАЛ!', 'Скорее перехвати его!', '#facc15');
    }

    resetCTFCheese(announce = false) {
        if (!this.ctf) return;
        this.ctf.state = 'HOME';
        this.ctf.carrier = null;
        this.ctf.carrierSid = '';
        this.ctf.carrierHits = 0;
        this.ctf.x = this.ctf.homeX;
        this.ctf.y = this.ctf.homeY;
        this.ctf.vx = 0;
        this.ctf.vy = 0;
        this.ctf.dropIgnoreWho = null;
        this.ctf.dropIgnoreUntil = 0;
        if (announce) {
            this._playSynthFX('trickShot', 1);
            this.showArcadeBanner('🧀 СЫР ВЕРНУЛСЯ В ЦЕНТР!', 'Хватай его на центральном алтаре!', '#fde047');
        }
    }

    scoreCTFPoint(carrier, isPlayerTeam) {
        if (!this.ctf || this.ctf.scoringLock) return;
        this.ctf.scoringLock = true;

        const base = isPlayerTeam ? this.ctf.blueBase : this.ctf.redBase;
        this.showHitEffect(base.x, base.y - 30, true);
        this.cameras.main.shake(180, 0.006);

        if (isPlayerTeam) {
            this.matchData.playerWins++;
            this._playerKillStreak = (this._playerKillStreak || 0) + 1;
            this._playSynthFX('cheeseScore', 2);
            this.showFloatingCallout(base.x, base.y - 80, '🏆 СЫР ДОСТАВЛЕН! +1', '#fde047', 28);
            this.showArcadeBanner('🏆 СЫР НА БАЗЕ! ПОБЕДА В РАУНДЕ! 🧀', `Счёт матча: ${this.matchData.playerWins} : ${this.matchData.opponentWins}`, '#fde047');
        } else {
            this.matchData.opponentWins++;
            this._playSynthFX('cheeseDrop', 2);
            const name = carrier?.getData?.('botName') || carrier?.nameLabel?.text || 'Соперник';
            this.showFloatingCallout(base.x, base.y - 80, '🚨 СЫР УКРАДЕН!', '#f87171', 26);
            this.showArcadeBanner(`🚨 ${name} ПРИНЁС СЫР НА БАЗУ!`, `Счёт матча: ${this.matchData.playerWins} : ${this.matchData.opponentWins}`, '#f87171');
        }

        this.resetCTFCheese(false);
        this.updateHUD();

        if (!this.checkMatchEnd()) {
            this.time.delayedCall(1200, () => {
                if (!this.scene?.isActive()) return;
                this.ctf.scoringLock = false;
                if (this.gameMode === 'host') {
                    this.respawnCharacter(this.player);
                    if (this.guestPlayer) this.respawnCharacter(this.guestPlayer);
                } else {
                    this.startNewRound();
                }
            });
        }
    }

    updateCTF(delta) {
        if (!this.ctf || this.gameMode === 'join' || this.gameMode === 'online') return;
        if (this.ctf.scoringLock) {
            this.updateCTFVisuals(delta);
            return;
        }

        const now = Date.now();
        const dtS = Math.min(delta / 1000, 0.05);

        if (this.ctf.state === 'CARRIED') {
            const c = this.ctf.carrier;
            if (!c || !c.active || c.getData('isDying') || (c.getData('health') ?? 0) <= 0) {
                this.dropCTFCheese(c, 0);
            } else {
                this.ctf.x = c.x;
                this.ctf.y = c.y - 60;

                // Check Base Capture!
                if (c === this.player) {
                    const d = Math.hypot(c.x - this.ctf.blueBase.x, c.y - this.ctf.blueBase.y);
                    if (d < 92) {
                        this.scoreCTFPoint(c, true);
                        this.updateCTFVisuals(delta);
                        return;
                    }
                } else {
                    const d = Math.hypot(c.x - this.ctf.redBase.x, c.y - this.ctf.redBase.y);
                    if (d < 92) {
                        this.scoreCTFPoint(c, false);
                        this.updateCTFVisuals(delta);
                        return;
                    }
                }
            }
        } else if (this.ctf.state === 'DROPPED') {
            // Apply gravity & simple bounce physics to dropped Golden Cheese
            this.ctf.vy = Math.min(680, (this.ctf.vy || 0) + 920 * dtS);
            const nextX = this.ctf.x + (this.ctf.vx || 0) * dtS;
            if (this.physicsWorld && this.physicsWorld._testPoint(nextX, this.ctf.y)) {
                this.ctf.vx = -(this.ctf.vx || 0) * 0.6;
            } else {
                this.ctf.x = Phaser.Math.Clamp(nextX, 60, (this.map?.widthInPixels || 5040) - 60);
            }

            const nextY = this.ctf.y + this.ctf.vy * dtS;
            if (this.ctf.vy >= 0 && this.physicsWorld) {
                const gY = this.physicsWorld._findGroundAt(this.ctf.x, nextY + 20, 26);
                if (gY !== null) {
                    this.ctf.y = gY - 22;
                    this.ctf.vy = 0;
                    this.ctf.vx *= 0.82;
                } else {
                    this.ctf.y = nextY;
                }
            } else {
                this.ctf.y = nextY;
            }

            // Check water pit or 12-second timeout -> auto return to Center Altar
            const inWater = this.waterBounds && this.ctf.y >= this.waterBounds.minY - 10;
            const timedOut = (now - (this.ctf.droppedAt || 0)) > 12000;
            if (inWater || timedOut || this.ctf.y > (this.map?.heightInPixels || 2520) - 60) {
                this.resetCTFCheese(true);
            }
        }

        // Check Pickup by any living character when HOME or DROPPED
        if (this.ctf.state === 'HOME' || this.ctf.state === 'DROPPED') {
            const chars = [this.player, this.guestPlayer, ...(this.bots || [])].filter(
                ch => ch && ch.active && !ch.getData('isDying') && (ch.getData('health') ?? 0) > 0
            );
            for (const ch of chars) {
                if (ch === this.ctf.dropIgnoreWho && now < this.ctf.dropIgnoreUntil) continue;
                const d = Math.hypot(ch.x - this.ctf.x, ch.y - this.ctf.y);
                if (d < 62) {
                    this.pickupCTFCheese(ch);
                    break;
                }
            }
        }

        this.updateCTFVisuals(delta);
    }

    updateCTFVisuals(_delta) {
        if (!this.ctf || !this.ctfCheeseSprite) return;
        const t = this.time.now * 0.005;

        let drawX = this.ctf.x;
        let drawY = this.ctf.y;

        if (this.ctf.state === 'CARRIED' && this.ctf.carrier && this.ctf.carrier.active) {
            drawX = this.ctf.carrier.x;
            drawY = this.ctf.carrier.y - 68 + Math.sin(t * 2.2) * 4;
            this.ctfCheeseSprite.setScale(0.76);
            this.ctfCheeseGlow.setScale(0.95);
        } else {
            drawY = this.ctf.y + Math.sin(t * 1.5) * 6;
            this.ctfCheeseSprite.setScale(0.90);
        }

        this.ctfCheeseSprite.setPosition(drawX, drawY);
        this.ctfCheeseSprite.setRotation(Math.sin(t) * 0.10);
        this.ctfCheeseGlow.setPosition(drawX, drawY);

        if (this.ctfCheeseLabel) {
            if (this.ctf.state === 'CARRIED') {
                const isMe = this.ctf.carrier === this.player;
                this.ctfCheeseLabel.setText(isMe ? '🧀 НЕСИ НА БАЗУ!' : '🚨 НЕСЁТ СЫР!');
                this.ctfCheeseLabel.setColor(isMe ? '#fde047' : '#fca5a5');
                this.ctfCheeseLabel.setPosition(drawX, drawY - 34);
            } else if (this.ctf.state === 'DROPPED') {
                const leftSec = Math.max(1, Math.ceil((12000 - (Date.now() - (this.ctf.droppedAt || Date.now()))) / 1000));
                this.ctfCheeseLabel.setText(`🧀 СЫР УПАЛ (${leftSec}с)`);
                this.ctfCheeseLabel.setColor('#fde047');
                this.ctfCheeseLabel.setPosition(drawX, drawY - 40);
            } else {
                this.ctfCheeseLabel.setText('🧀 ЗОЛОТОЙ СЫР');
                this.ctfCheeseLabel.setColor('#fef08a');
                this.ctfCheeseLabel.setPosition(drawX, drawY - 40);
            }
        }

        // Draw directional compass indicator around player so objective is always crystal-clear
        if (this.ctfCompassGraphics && this.ctfCompassText && this.player?.active && !this.player.getData('isDying')) {
            this.ctfCompassGraphics.clear();
            const px = this.player.x;
            const py = this.player.y;

            let targetX = drawX;
            let targetY = drawY;
            let arrowColor = 0xfacc15;
            let textColor = '#fde047';
            let labelPrefix = '🧀 СЫР';

            if (this.ctf.state === 'CARRIED') {
                if (this.ctf.carrier === this.player) {
                    const myBase = this._getCharacterTargetBase(this.player);
                    targetX = myBase.x;
                    targetY = myBase.y;
                    arrowColor = 0x38bdf8;
                    textColor = '#7dd3fc';
                    labelPrefix = '🏠 БАЗА';
                } else {
                    arrowColor = 0xf87171;
                    textColor = '#fca5a5';
                    labelPrefix = '🚨 ПЕРЕХВАТИ';
                }
            }

            const dx = targetX - px;
            const dy = targetY - py;
            const distPx = Math.hypot(dx, dy);

            if (distPx > 140) {
                const angle = Math.atan2(dy, dx);
                const orbitR = 76;
                const ax = px + Math.cos(angle) * orbitR;
                const ay = py + Math.sin(angle) * orbitR;

                // Draw sleek directional pointer triangle
                const tipX = ax + Math.cos(angle) * 14;
                const tipY = ay + Math.sin(angle) * 14;
                const leftX = ax + Math.cos(angle + 2.4) * 11;
                const leftY = ay + Math.sin(angle + 2.4) * 11;
                const rightX = ax + Math.cos(angle - 2.4) * 11;
                const rightY = ay + Math.sin(angle - 2.4) * 11;

                this.ctfCompassGraphics.fillStyle(arrowColor, 0.92);
                this.ctfCompassGraphics.lineStyle(2.5, 0x0f172a, 0.95);
                this.ctfCompassGraphics.beginPath();
                this.ctfCompassGraphics.moveTo(tipX, tipY);
                this.ctfCompassGraphics.lineTo(leftX, leftY);
                this.ctfCompassGraphics.lineTo(rightX, rightY);
                this.ctfCompassGraphics.closePath();
                this.ctfCompassGraphics.fillPath();
                this.ctfCompassGraphics.strokePath();

                const meters = Math.max(1, Math.round(distPx / 70));
                this.ctfCompassText.setText(`${labelPrefix} ${meters}м`);
                this.ctfCompassText.setColor(textColor);
                this.ctfCompassText.setPosition(ax + Math.cos(angle) * 34, ay + Math.sin(angle) * 26);
                this.ctfCompassText.setVisible(true);
            } else {
                this.ctfCompassText.setVisible(false);
            }
        } else if (this.ctfCompassGraphics && this.ctfCompassText) {
            this.ctfCompassGraphics.clear();
            this.ctfCompassText.setVisible(false);
        }
    }

    // === COLLISIONS ===

    setupCollisions() {
        // Rapier2D collision events are drained in processRapierCollisions() each frame
    }

    /**
     * v28: Process collisions with simple AABB overlap checks
     */
    processCollisions() {
        if (this.gameMode === 'join' || this.gameMode === 'online') return; // Guest doesn't handle collisions

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
            if (snowball.active && (this.physicsWorld || this.platformLayer)) {
                const hitWall = this.physicsWorld
                    ? this.physicsWorld._testPoint(snowball.x, snowball.y)
                    : !!(this.platformLayer?.getTileAtWorldXY(snowball.x, snowball.y)?.collides);
                if (hitWall) {
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
        this.hudPowerup = document.getElementById('hud-powerup');
        this.hudScore = document.getElementById('hud-score');
        this.hudStreak = document.getElementById('hud-streak');
        this.hudPause = document.getElementById('hud-pause');
        this.hudMusic = document.getElementById('hud-music');
        this.hudOpponents = document.getElementById('hud-opponents');

        // Player name
        if (this.hudPlayerName) this.hudPlayerName.textContent = '🐭 ' + (window.gameConfig?.nickname || GAME.PLAYER_NAME);

        // Player hearts
        if (this.hudPlayerHearts) this.hudPlayerHearts.textContent = this.getHeartsString(GAME.MAX_HEALTH);

        // Music / Sound toggle button
        if (this.hudMusic) {
            this.hudMusic.textContent = this._soundMuted ? '🔇' : '🔊';
            if (!this.hudMusic._wired) {
                this.hudMusic._wired = true;
                this.hudMusic.addEventListener('click', () => {
                    if (this.scene?.isActive()) this.toggleSoundMute();
                });
            }
        }

        // Pause button
        if (this.hudPause && !this.hudPause._wired) {
            this.hudPause._wired = true;
            this.hudPause.addEventListener('click', () => {
                if (this.scene?.isActive()) this.showPauseMenu();
            });
        }

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

        if (this.gameMode === 'host' || this.gameMode === 'join' || this.gameMode === 'online') {
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
        const playerLeading = this.matchData && (this.matchData.playerWins > this.matchData.opponentWins);
        const oppLeading = this.matchData && (this.matchData.opponentWins > this.matchData.playerWins);
        const basePlayerName = window.gameConfig?.nickname || GAME.PLAYER_NAME;

        // Update bot name label positions
        this.bots.forEach((bot, idx) => {
            if (bot.nameLabel && bot.active) {
                bot.nameLabel.setPosition(bot.x, bot.y - 55);
                bot.nameLabel.setVisible(bot.getData('health') > 0);
                const rawName = bot.getData('botName') || 'Бот';
                const crown = (oppLeading && idx === 0) ? '👑 ' : '';
                if (bot.nameLabel.text !== crown + rawName) {
                    bot.nameLabel.setText(crown + rawName);
                }
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

        // Update all online remote players' name labels
        if (this.remotePlayers) {
            for (const [, rem] of this.remotePlayers) {
                if (rem?.nameLabel) {
                    rem.nameLabel.setPosition(rem.x, rem.y - 55);
                    rem.nameLabel.setVisible(rem.visible && !rem.getData('isDying') && (rem.getData('health') ?? 100) > 0);
                }
            }
        }

        // Update player name label position + leader crown / streak badge
        if (this.player.nameLabel && this.player.active) {
            this.player.nameLabel.setPosition(this.player.x, this.player.y - 55);
            this.player.nameLabel.setVisible(this.player.getData('health') > 0);
            const prefix = playerLeading ? '👑 ' : (this._playerKillStreak >= 2 ? '🔥 ' : '');
            const desired = prefix + basePlayerName;
            if (this.player.nameLabel.text !== desired) {
                this.player.nameLabel.setText(desired);
            }
        }
    }

    updateHUD() {
        // Player hearts
        const playerHealth = this.player.getData('health');
        if (this.hudPlayerHearts) this.hudPlayerHearts.textContent = this.getHeartsString(playerHealth);

        // Active powerup indicator in HUD
        if (this.hudPowerup) {
            const pType = this.getActivePowerupType(this.player);
            if (pType) {
                const key = `${this.player._physLabel || 'player'}-${pType}`;
                const pw = this.activePowerups.get(key);
                const secs = pw ? Math.max(1, Math.ceil(pw.remainingTime / 1000)) : '';
                const pNames = { fire: '🔥 ОГОНЬ', speed: '⚡ СКОРОСТЬ', shield: '🛡️ ЩИТ', doublejump: '🦘 ПРЫЖОК' };
                this.hudPowerup.textContent = `${pNames[pType] || pType} ${secs}с`;
                this.hudPowerup.style.display = 'inline-block';
            } else {
                this.hudPowerup.style.display = 'none';
            }
        }

        // Active hit combo / kill streak badge in HUD
        if (this.hudStreak) {
            if (this._playerHitCombo >= 2) {
                this.hudStreak.textContent = `🔥 КОМБО x${this._playerHitCombo}`;
                this.hudStreak.style.display = 'inline-block';
            } else if (this._playerKillStreak >= 2) {
                this.hudStreak.textContent = `👑 СЕРИЯ x${this._playerKillStreak}`;
                this.hudStreak.style.display = 'inline-block';
            } else {
                this.hudStreak.style.display = 'none';
            }
        }

        // Score (and room code in online private rooms)
        if (this.hudScore) {
            const codePrefix = (this.gameMode === 'online' && this.network?.roomCode)
                ? `[${this.network.roomCode}]  `
                : '';
            this.hudScore.textContent = `${codePrefix}${this.matchData.playerWins} : ${this.matchData.opponentWins}`;
        }

        // Network mode: update opponent hearts
        if (this.gameMode === 'host' && this.remotePlayerUI && this.guestPlayer) {
            const health = this.guestPlayer.getData('health') || GAME.MAX_HEALTH;
            this.remotePlayerUI.hearts.textContent = this.getHeartsString(health);
            return;
        }
        if (this.gameMode === 'online') {
            const snapshot = this.network?.lastSnapshot;
            const others = snapshot?.players?.filter(p => !p.isSelf) || [];
            if (this.hudOpponents) {
                const sig = others.map(o => `${o.sessionId}:${o.nickname}:${o.health}:${o.score || 0}`).join('|');
                if (this._lastOnlineHudSig !== sig) {
                    this._lastOnlineHudSig = sig;
                    this.hudOpponents.innerHTML = '';
                    if (others.length === 0) {
                        const nameEl = document.createElement('div');
                        nameEl.className = 'hud-name enemy';
                        nameEl.textContent = '🐭 Ожидание соперника...';
                        this.hudOpponents.appendChild(nameEl);
                    } else {
                        for (const o of others) {
                            const nameEl = document.createElement('div');
                            nameEl.className = 'hud-name enemy';
                            const tag = o.isBot ? '🤖' : '🐭';
                            nameEl.textContent = `${tag} ${o.nickname || 'Соперник'} (${o.score || 0})`;
                            const heartsEl = document.createElement('div');
                            heartsEl.className = 'hud-hearts';
                            heartsEl.textContent = this.getHeartsString(o.health ?? GAME.MAX_HEALTH);
                            this.hudOpponents.appendChild(nameEl);
                            this.hudOpponents.appendChild(heartsEl);
                        }
                    }
                }
            }
            const hudPing = document.getElementById('hud-ping');
            if (hudPing && this.network) {
                const p = this.network.ping;
                hudPing.textContent = p > 0 ? `${p}ms` : '';
                hudPing.style.color = p < 50 ? '#88ff88' : p < 100 ? '#ffff88' : '#ff8888';
            }
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

        // Drop Golden Cheese immediately if the victim was carrying it
        if (this.ctf && this.ctf.state === 'CARRIED' && this.ctf.carrier === victim && this.gameMode !== 'online' && this.gameMode !== 'join') {
            this.dropCTFCheese(victim, 0);
        }

        // Release hook immediately on death
        if (victim.core) {
            victim.core.releaseHook();
        }

        // Streak & KO announcer tracking
        if (victim === this.player) {
            this._playerHitCombo = 0;
            this._playerKillStreak = 0;
        } else if (killer === this.player) {
            this._playerKillStreak = (this._playerKillStreak || 0) + 1;
            const s = this._playerKillStreak;
            this._playSynthFX('koFanfare', s);
            const koTitles = [
                '',
                '❄️ НОКАУТ! ❄️',
                '🔥 ДВОЙНОЙ НОКАУТ! 🔥',
                '⚡ СНЕЖНЫЙ ШТОРМ x3! ⚡',
                '👑 НЕУДЕРЖИМЫЙ x4! 👑'
            ];
            const bannerTitle = koTitles[s] || `👑 ЛЕГЕНДА АРЕНЫ x${s}! 👑`;
            const bannerColor = s >= 3 ? '#facc15' : (s === 2 ? '#fb923c' : '#38bdf8');
            this.showArcadeBanner(bannerTitle, s >= 2 ? `Серия побед подряд: ${s}!` : 'Отличный бросок!', bannerColor);
        }

        // Guest: visual ragdoll effect, state management via snapshot
        if (this.gameMode === 'join' || this.gameMode === 'online') {
            this.showDeathEffect(victim.x, victim.y);
            this.playSpatialSound('sfx-snowball-hit', victim.x, victim.y, 0.7);
            this.playSpatialSound('sfx-ko', victim.x, victim.y, 0.6);
            if (victim.nameLabel) victim.nameLabel.setVisible(false);

            // Ragdoll spin (same as host)
            const spinDir = Math.random() > 0.5 ? 1 : -1;
            const spinTween = this.tweens.add({
                targets: victim,
                angle: spinDir * 360,
                duration: RAGDOLL.DURATION,
                ease: 'Linear'
            });
            victim._deathTweens = [spinTween];

            // Fade out after ragdoll — snapshot will restore when host respawns
            const fadeTimer = this.time.delayedCall(RAGDOLL.DURATION, () => {
                const fadeTween = this.tweens.add({
                    targets: victim,
                    alpha: 0,
                    duration: RAGDOLL.FADE_TIME
                });
                if (victim._deathTweens) victim._deathTweens.push(fadeTween);
            });
            victim._deathFadeTimer = fadeTimer;
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

        // 4. Play death & KO sounds
        this.playSpatialSound('sfx-snowball-hit', victim.x, victim.y, 0.7);
        this.playSpatialSound('sfx-ko', victim.x, victim.y, 0.65);

        // 5. Hide name label
        if (victim.nameLabel) victim.nameLabel.setVisible(false);

        // 6. Camera: zoom out to show ragdoll flight
        const cam = this.cameras.main;
        const normalZoom = 0.58;
        const deathZoom = 0.45;
        // Temporarily follow victim if it's not the player
        if (victim !== this.player) {
            cam.startFollow(victim, false, 0.12, 0.12);
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
            // Restore camera: follow player with roundPixels=false, zoom back
            cam.startFollow(this.player, false, 0.16, 0.16);
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
        if (this.gameMode === 'join' || this.gameMode === 'online') {
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
        this.resetCTFCheese(false);
        if (this.ctf) this.ctf.scoringLock = false;
        if (this.cache.audio.exists('sfx-sting-round') && !this._soundMuted) {
            this.sound.play('sfx-sting-round', { volume: 0.45 });
        }
        const isMatchPoint = (this.matchData.playerWins >= GAME.WINS_TO_WIN - 1) ||
                             (this.matchData.opponentWins >= GAME.WINS_TO_WIN - 1);
        if (isMatchPoint) {
            this.showArcadeBanner('🔥 РЕШАЮЩИЙ РАУНД! 🔥', `Счёт ${this.matchData.playerWins} : ${this.matchData.opponentWins}`, '#fb923c');
        } else {
            this.showArcadeBanner('🔔 НОВЫЙ РАУНД!', `Счёт ${this.matchData.playerWins} : ${this.matchData.opponentWins}`, '#38bdf8');
        }
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
        character.setAngle(0);
        character.setActive(true);
        character.setVisible(true);
        if (character.nameLabel) character.nameLabel.setVisible(true);
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
            if (this.cache.audio.exists('sfx-sting-win') && !this._soundMuted) {
                this.sound.play('sfx-sting-win', { volume: 0.6 });
            }
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
            if (this.cache.audio.exists('sfx-sting-lose') && !this._soundMuted) {
                this.sound.play('sfx-sting-lose', { volume: 0.55 });
            }
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
        if (window.parent && window.parent !== window) {
            window.parent.postMessage('toggleGameTopBarPause', '*');
            return;
        }
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
     * Play sound with distance-based volume attenuation + pitch variation & layered sweetening
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
        const refDistance = 220;   // Full volume up to 220px
        const maxDistance = 950;   // Silent after 950px

        // Calculate volume with linear falloff
        let volume = baseVolume;
        if (distance > refDistance) {
            const falloff = 1 - (distance - refDistance) / (maxDistance - refDistance);
            volume = baseVolume * Math.max(0, falloff);
        }

        // Only play if audible (minimum 5% volume), not muted, and not backgrounded
        if (volume > 0 && !this._soundMuted && !this._isHiddenOrBackgrounded()) {
            const vol = Math.max(0.05, volume);
            // Randomize pitch slightly so rapid throws/hits never sound robotic
            const detune = Math.round((Math.random() - 0.5) * 260);
            this.sound.play(key, { volume: vol, detune });

            // Layer extra Kenney arcade SFX for extra punch
            if (key === 'sfx-snowball-shot') {
                const throwKey = Math.random() < 0.5 ? 'sfx-throw-a' : 'sfx-throw-b';
                if (this.cache.audio.exists(throwKey)) {
                    this.sound.play(throwKey, { volume: vol * 0.45, detune: detune + 120 });
                }
            } else if (key === 'sfx-snowball-hit') {
                const hitVariants = ['sfx-hit-a', 'sfx-hit-b', 'sfx-hit-c'];
                const hitKey = hitVariants[Math.floor(Math.random() * hitVariants.length)];
                if (this.cache.audio.exists(hitKey)) {
                    this.sound.play(hitKey, { volume: vol * 0.48, detune });
                }
            } else if (key === 'sfx-hook-fired' && distance < 260) {
                this._playSynthFX('hookFire', 1);
            } else if (key === 'sfx-hook-attached' && distance < 260) {
                this._playSynthFX('hookLatch', 1);
            }
        }

        // Queue all sound events for guest (guest has no local physics, needs all sounds from host)
        if (this.isHost && this.network) {
            this.network.queueEvent({ type: 'sound', name: key, x, y, vol: baseVolume });
        }
    }

    /**
     * World-space floating arcade callout (damage numbers, trick shots, powerup pickups)
     */
    showFloatingCallout(x, y, text, color = '#fde047', fontSize = 22) {
        if (!this.scene?.isActive()) return;
        const callout = this.add.text(x, y, text, {
            fontFamily: "'Nunito', Arial Black, sans-serif",
            fontSize: `${fontSize}px`,
            fontStyle: 'bold',
            color,
            stroke: '#0f172a',
            strokeThickness: 6
        }).setOrigin(0.5).setDepth(190).setScale(0.4);

        this.tweens.add({
            targets: callout,
            scale: 1.08,
            y: y - 28,
            duration: 180,
            ease: 'Back.easeOut',
            onComplete: () => {
                this.tweens.add({
                    targets: callout,
                    y: y - 68,
                    alpha: 0,
                    scale: 0.85,
                    duration: 650,
                    ease: 'Sine.easeIn',
                    onComplete: () => callout.destroy()
                });
            }
        });
    }

    /**
     * Screen-space Brawl-style announcer banner at top center
     */
    showArcadeBanner(title, subtitle = '', accentColor = '#fde047') {
        if (!this.scene?.isActive()) return;
        if (this._activeBanner) {
            this._activeBanner.forEach(el => { try { el.destroy(); } catch (_) {} });
            this._activeBanner = null;
        }
        const w = this.cameras.main.width;
        const yBase = 88;
        const elements = [];

        const titleTxt = this.add.text(w / 2, yBase, title, {
            fontFamily: "'Nunito', Arial Black, sans-serif",
            fontSize: '28px',
            fontStyle: 'bold',
            color: accentColor,
            stroke: '#090d16',
            strokeThickness: 7
        }).setOrigin(0.5).setScrollFactor(0).setDepth(950).setScale(0.3);
        elements.push(titleTxt);

        if (subtitle) {
            const subTxt = this.add.text(w / 2, yBase + 28, subtitle, {
                fontFamily: "'Nunito', sans-serif",
                fontSize: '15px',
                fontStyle: 'bold',
                color: '#ffffff',
                stroke: '#090d16',
                strokeThickness: 4
            }).setOrigin(0.5).setScrollFactor(0).setDepth(950).setAlpha(0);
            elements.push(subTxt);
            this.tweens.add({ targets: subTxt, alpha: 1, duration: 200, delay: 80 });
        }

        this._activeBanner = elements;

        this.tweens.add({
            targets: titleTxt,
            scale: 1.0,
            duration: 240,
            ease: 'Back.easeOut'
        });

        this.time.delayedCall(2100, () => {
            if (this._activeBanner !== elements) return;
            this.tweens.add({
                targets: elements,
                alpha: 0,
                y: '-=18',
                duration: 280,
                onComplete: () => {
                    elements.forEach(el => { try { el.destroy(); } catch (_) {} });
                    if (this._activeBanner === elements) this._activeBanner = null;
                }
            });
        });
    }

    showMessage(text, duration = 3000) {
        const w = this.cameras.main.width;
        const message = this.add.text(w / 2, 145, text, {
            fontFamily: "'Nunito', Arial, sans-serif",
            fontSize: '20px',
            fontStyle: 'bold',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 4,
            backgroundColor: 'rgba(15, 23, 42, 0.78)',
            padding: { x: 18, y: 8 }
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
        if (this.waterSurfaceSprite) {
            this.waterSurfaceSprite.tilePositionX -= 0.85;
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

        if (this.gameMode === 'join' || this.gameMode === 'online') {
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
            guestInput.fire = false;
            if (this.network) {
                const remoteInput = this.network.remoteInputs.get('guest');
                if (remoteInput) remoteInput.fire = false;
            }
        }
        // 3. Fixed timestep physics loop (deterministic)
        // Latch jump/hook edges across sub-tick 120Hz frames and snap ~60Hz rAF jitter to exact FIXED_DT_S
        if (playerInput.jump) this._latchedHostJump = true;
        if (playerInput.jumpJustPressed) this._latchedHostJumpJust = true;
        if (playerInput.hook) {
            this._latchedHostHook = true;
            if (playerInput.hookTarget) this._latchedHostHookTarget = playerInput.hookTarget;
        }
        const timeScale = this._physicsTimeScale || 1;
        let stepDtS = (delta / 1000) * timeScale;
        if (timeScale === 1 && delta >= 13.8 && delta <= 19.8) {
            stepDtS = FIXED_DT_S;
            this._physicsAccumulator = FIXED_DT_S;
        } else {
            this._physicsAccumulator = (this._physicsAccumulator || 0) + stepDtS;
            this._physicsAccumulator = Math.min(this._physicsAccumulator, FIXED_DT_S * 3);
        }

        let firstTick = true;
        while (this._physicsAccumulator >= FIXED_DT_S) {
            if (this._latchedHostJump) {
                playerInput.jump = true;
                this._latchedHostJump = false;
            }
            if (this._latchedHostJumpJust) {
                playerInput.jumpJustPressed = true;
                this._latchedHostJumpJust = false;
            }
            if (this._latchedHostHook) {
                playerInput.hook = true;
                if (!playerInput.hookTarget) playerInput.hookTarget = this._latchedHostHookTarget;
                this._latchedHostHook = false;
            }
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
                playerInput.jumpJustPressed = false;
                if (tickGuestInput) tickGuestInput = { ...tickGuestInput, fire: false };
            }

            // Save previous physics positions for sub-frame visual interpolation on 120Hz displays
            if (this.player?.simpleBody) {
                this.player.simpleBody._prevX = this.player.simpleBody.x;
                this.player.simpleBody._prevY = this.player.simpleBody.y;
            }
            if (this.guestPlayer?.simpleBody) {
                this.guestPlayer.simpleBody._prevX = this.guestPlayer.simpleBody.x;
                this.guestPlayer.simpleBody._prevY = this.guestPlayer.simpleBody.y;
            }
            this.bots.forEach(bot => {
                if (bot.simpleBody) {
                    bot.simpleBody._prevX = bot.simpleBody.x;
                    bot.simpleBody._prevY = bot.simpleBody.y;
                }
            });

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

        // 5. Sync sprite positions from SimpleBody with sub-frame alpha interpolation
        const interpAlpha = Phaser.Math.Clamp(this._physicsAccumulator / FIXED_DT_S, 0, 1);
        this.syncSpriteFromBody(this.player, interpAlpha);
        if (this.guestPlayer?.simpleBody) this.syncSpriteFromBody(this.guestPlayer, interpAlpha);
        this.bots.forEach(bot => this.syncSpriteFromBody(bot, interpAlpha));
        this.updateSnowballPositions(delta);

        // 6. Process collision events (v28: simple overlap checks)
        this.processCollisions();

        // 7. Snowballs, pickups, powerups, Center CTF
        this.updateSnowballs();
        this.updatePowerups(delta);
        this.updateCTF(delta);

        // 8. Draw hooks
        this.drawHooks();

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
     * v28: Sync a sprite's position from its SimpleBody (with optional sub-frame interpolation)
     */
    syncSpriteFromBody(character, alpha = 1) {
        if (!character?.simpleBody || !character.active) return;
        const b = character.simpleBody;
        const px = typeof b._prevX === 'number' ? b._prevX : b.x;
        const py = typeof b._prevY === 'number' ? b._prevY : b.y;
        if (Math.hypot(b.x - px, b.y - py) > 120) {
            character.setPosition(b.x, b.y);
        } else {
            character.setPosition(px + (b.x - px) * alpha, py + (b.y - py) * alpha);
        }
    }

    /**
     * v28: Update snowball positions (frame-rate independent)
     */
    updateSnowballPositions(delta = 16.67) {
        const dtS = Math.min(delta / 1000, 0.05);
        for (const sb of this.snowballs) {
            if (!sb.active) continue;

            // Simple projectile physics
            sb.vy = (sb.vy || 0) + PHYS.GRAVITY * PHYS.SNOWBALL_GRAVITY_SCALE * dtS;
            sb.x += (sb.vx || 0) * dtS;
            sb.y += sb.vy * dtS;
        }
    }

    // === GUEST UPDATE (v19: fixed reconciliation) ===

    updateAsGuest(delta) {
        const network = this.network;

        // 1. Gather input
        const playerInput = this.humanInput.getInput();
        playerInput.hookTarget = this.findHookTarget(this.player);
        if (playerInput.fire && (playerInput.fireAngle === null || playerInput.fireAngle === undefined)) {
            playerInput.fireAngle = this._autoAimAngle(this.player);
        }

        const snapshot = network?.lastSnapshot;
        const interp = network?.getInterpolatedSnapshot();

        if (this.gameMode === 'online') {
            // 2a. Client-side prediction + smooth server reconciliation for own character (0ms input lag!)
            // Runs before network.sendInput so any local hook detach sets playerInput.hookRelease = true!
            this._predictAndReconcileOnlineSelf(playerInput, delta, snapshot);
            network?.sendInput(playerInput);
            // 2b. Sync & interpolate all remote players (up to 3 opponents: humans + server bots)
            this._syncAndInterpolateOnlinePlayers(snapshot, interp);
        } else {
            network?.sendInput(playerInput);
            // PeerJS guest mode fallback
            if (interp) {
                this._interpolateGuestSelf(interp);
                this._interpolateOtherPlayers(interp);
            }
        }

        // 3. Instant fire sound feedback
        if (playerInput.fire && !this.player.getData('isDying')) {
            const now = Date.now();
            if (now - (this._lastLocalSnowballTime || 0) >= 100) {
                this._lastLocalSnowballTime = now;
                this.playSpatialSound('sfx-snowball-shot', this.player.x, this.player.y, 0.4);
            }
        }

        // 5. Non-physics processing (health, death, events, sounds)
        if (snapshot) {
            this._processSnapshotNonPhysics(snapshot);
        }

        // 6. Hook visuals
        this.hookGraphics.clear();
        this._drawHookVisuals(snapshot);

        // 7. Animations & CTF Visuals
        this._updateGuestAnimations(playerInput, snapshot);
        this.updateCTFVisuals(delta);

        // 8. UI
        this.updateHUD();
        this.updateNameLabels();
        network?.update(delta);
    }

    /**
     * Client-Side Prediction + Smooth Reconciliation (Bending) for Colyseus online mode.
     * Steps local SimplePhysicsWorld + CharacterCore immediately on input, then softly
     * corrects drift against authoritative server state.
     */
    _predictAndReconcileOnlineSelf(playerInput, delta, snapshot) {
        if (!this.player || !this.player.simpleBody || !this.player.core) return;
        const body = this.player.simpleBody;
        const core = this.player.core;

        const me = snapshot?.players?.find(p => p.isSelf);

        if (this.player.getData('isDying')) {
            if (me) this.player.setPosition(me.x, me.y);
            return;
        }

        // Sync active powerup for local prediction & HUD using string keys ("player-<type>")
        const pLabel = this.player._physLabel || 'player';
        for (const t of ['fire', 'speed', 'shield', 'doublejump']) {
            const k = `${pLabel}-${t}`;
            if (me?.powerup === t) {
                const existing = this.activePowerups.get(k);
                this.activePowerups.set(k, {
                    character: this.player,
                    type: t,
                    config: PICKUPS[t.toUpperCase()] || {},
                    remainingTime: existing ? existing.remainingTime : 8000
                });
            } else if (this.activePowerups.has(k)) {
                this.activePowerups.delete(k);
            }
        }

        // Extra air jump when holding doublejump powerup
        if (me?.powerup === 'doublejump' && !core.grounded && core.airJumpUsed && playerInput.jump && !core._extraJumpUsed) {
            core.airJumpUsed = false;
            core._extraJumpUsed = true;
        }
        if (core.grounded) {
            core._extraJumpUsed = false;
        }

        // Latch jump & hook pulses across sub-tick 120Hz render frames so no input is lost
        if (playerInput.jump) {
            this._latchedOnlineJump = true;
        }
        if (playerInput.jumpJustPressed) {
            this._latchedOnlineJumpJust = true;
            this._lastLocalImpulseTime = Date.now();
        }
        if (playerInput.hook) {
            this._latchedOnlineHook = true;
            if (playerInput.hookTarget) this._latchedOnlineHookTarget = playerInput.hookTarget;
            this._lastLocalImpulseTime = Date.now();
        }

        const wasHookActive = core.hookState !== 'IDLE';

        // Step local physics at fixed 60Hz (snap ~60Hz rAF jitter to exact 1 tick/frame to prevent 0/2 tick beat judder)
        const FIXED_DT_S = 1 / 60;
        const FIXED_DT_MS = FIXED_DT_S * 1000;
        let dtS = Math.min(delta / 1000, 0.05);
        if (delta >= 13.8 && delta <= 19.8) {
            this._onlineAccum = FIXED_DT_S;
        } else {
            this._onlineAccum = (this._onlineAccum || 0) + dtS;
            this._onlineAccum = Math.min(this._onlineAccum, FIXED_DT_S * 3);
        }

        let ticks = 0;
        let jumpTypeThisFrame = null;
        while (this._onlineAccum >= FIXED_DT_S && ticks < 2) {
            body._prevX = body.x;
            body._prevY = body.y;
            const prevVy = body.vy;
            const tickInput = {
                ...playerInput,
                jump: !!(playerInput.jump || this._latchedOnlineJump),
                jumpJustPressed: !!this._latchedOnlineJumpJust,
                hook: !!(playerInput.hook || this._latchedOnlineHook),
                hookTarget: playerInput.hookTarget || this._latchedOnlineHookTarget || null
            };
            this._latchedOnlineJump = false;
            this._latchedOnlineJumpJust = false;
            this._latchedOnlineHook = false;
            this.updateCharacter(this.player, tickInput, FIXED_DT_MS);
            if (core.lastJumpType) {
                jumpTypeThisFrame = core.lastJumpType;
            }
            if (body.vy <= -600 && prevVy > -200) {
                // Any ground jump, double-jump, or rope-jump refreshes the local impulse window
                this._lastLocalImpulseTime = Date.now();
            }
            this.physicsWorld.step(FIXED_DT_S);
            this._onlineAccum -= FIXED_DT_S;
            ticks++;
        }

        if (jumpTypeThisFrame) {
            playerInput.jumpType = jumpTypeThisFrame;
            playerInput.jump = true;
            playerInput.jumpJustPressed = true;
        }

        // If local prediction just detached the hook (hold-release or toggle-off, NOT rope-jump),
        // explicitly notify the server via hookRelease = true so client and server never desync!
        if (wasHookActive && core.hookState === 'IDLE' && !playerInput.hook && jumpTypeThisFrame !== 'rope') {
            playerInput.hookRelease = true;
            this._lastLocalImpulseTime = Date.now();
        }

        // Clamp horizontal bounds matching server
        const mapW = this.map ? this.map.widthInPixels : GAME.WIDTH;
        if (body.x < 35) { body.x = 35; body.vx = 0; }
        if (body.x > mapW - 35) { body.x = mapW - 35; body.vx = 0; }

        // Attach local predicted state for server ledge-landing & jump synchronization
        playerInput.clientX = body.x;
        playerInput.clientY = body.y;
        playerInput.clientVx = body.vx;
        playerInput.clientVy = body.vy;
        playerInput.clientGrounded = !!body.grounded;

        // Reconcile against authoritative server state ONLY when a fresh server snapshot arrives
        if (me) {
            this._syncHookStateFromServer(me, me.lastSeq || 0);

            if (!this._guestSelfInit) {
                body.x = me.x;
                body.y = me.y;
                body._prevX = me.x;
                body._prevY = me.y;
                body.vx = me.rawVx || 0;
                body.vy = me.rawVy || 0;
                this._guestSelfInit = true;
                this._lastReconciledSnapTick = snapshot?.tick || 0;
            } else {
                const snapTick = snapshot?.tick || 0;
                const isNewSnapshot = snapTick !== this._lastReconciledSnapTick;
                if (isNewSnapshot) {
                    this._lastReconciledSnapTick = snapTick;

                    const rttHalfS = Math.min(0.025, ((this.network?.ping || 8) * 0.5) / 1000);
                    const targetX = me.x + (me.rawVx || 0) * rttHalfS;
                    let targetY = me.y + (me.rawVy || 0) * (me.grounded ? 0 : rttHalfS);
                    // Never pull a grounded player downward through an upper platform they just landed on!
                    if (body.grounded && targetY > body.y) {
                        targetY = body.y;
                    }

                    const dx = targetX - body.x;
                    const dy = targetY - body.y;
                    const errDist = Math.hypot(dx, dy);

                    const recentImpulse = (Date.now() - (this._lastLocalImpulseTime || 0) < 340);

                    if (errDist > 420) {
                        // Hard snap ONLY on respawn or death teleport
                        body.x = me.x;
                        body.y = me.y;
                        body._prevX = me.x;
                        body._prevY = me.y;
                        body.vx = me.rawVx || 0;
                        body.vy = me.rawVy || 0;
                        if (this.physicsWorld) this.physicsWorld._hardDepenetrate(body);
                    } else if (errDist > 16 && !recentImpulse) {
                        // Gentle, collision-safe drift reconciliation without sudden teleports
                        const blend = errDist > 110 ? 0.14 : 0.08;
                        const shiftX = dx * blend;
                        const shiftY = (body.grounded && dy > 0) ? 0 : dy * blend;

                        const savedX = body.x;
                        if (Math.abs(shiftX) > 0.1) {
                            body.x = savedX + shiftX;
                            if (this.physicsWorld && this.physicsWorld._bodyOverlapsSolid(body)) {
                                body.x = savedX;
                            } else {
                                body._prevX += shiftX;
                                if (typeof me.rawVx === 'number') {
                                    body.vx = body.vx * 0.85 + me.rawVx * 0.15;
                                }
                            }
                        }

                        if (Math.abs(shiftY) > 0.1) {
                            const curY = body.y;
                            body.y = curY + shiftY;
                            if (this.physicsWorld && this.physicsWorld._bodyOverlapsSolid(body)) {
                                body.y = curY;
                            } else {
                                body._prevY += shiftY;
                                if (typeof me.rawVy === 'number' && !body.grounded) {
                                    body.vy = body.vy * 0.85 + me.rawVy * 0.15;
                                }
                            }
                        }
                    }
                }
            }
        }

        const interpAlpha = Phaser.Math.Clamp(this._onlineAccum / FIXED_DT_S, 0, 1);
        this.syncSpriteFromBody(this.player, interpAlpha);
    }

    /**
     * Dynamically create, interpolate, and clean up all remote player sprites in online mode (2-4 players).
     */
    _syncAndInterpolateOnlinePlayers(snapshot, interp) {
        if (!snapshot || !snapshot.players) return;

        // Hide legacy single hostSprite in online mode
        if (this.hostSprite) {
            this.hostSprite.setVisible(false);
            if (this.hostSprite.nameLabel) this.hostSprite.nameLabel.setVisible(false);
        }

        const activeSids = new Set();
        const badgeColors = [
            'rgba(231, 76, 60, 0.85)',
            'rgba(155, 89, 182, 0.85)',
            'rgba(230, 126, 34, 0.85)',
            'rgba(46, 204, 113, 0.85)'
        ];

        for (const pData of snapshot.players) {
            if (pData.isSelf || !pData.sessionId) continue;
            const sid = pData.sessionId;
            activeSids.add(sid);

            let sprite = this.remotePlayers.get(sid);
            if (!sprite) {
                const charNum = pData.character === 2 ? 2 : 1;
                sprite = this.createDisplaySprite(0, charNum);
                sprite.setPosition(pData.x, pData.y);
                sprite.setData('playerId', sid);
                sprite.setData('health', pData.health ?? GAME.MAX_HEALTH);
                const bgCol = badgeColors[(pData.colorIndex || 0) % badgeColors.length];
                sprite.nameLabel = this.add.text(pData.x, pData.y - 55, pData.nickname || 'Соперник', {
                    fontFamily: 'Arial',
                    fontSize: '12px',
                    color: '#ffffff',
                    stroke: '#000000',
                    strokeThickness: 3,
                    backgroundColor: bgCol,
                    padding: { x: 6, y: 2 }
                }).setOrigin(0.5, 1).setDepth(150);
                this.remotePlayers.set(sid, sprite);
            }

            // Update nickname if changed
            const labelText = (pData.isBot ? '🤖 ' : '') + (pData.nickname || 'Соперник');
            if (sprite.nameLabel && sprite.nameLabel.text !== labelText) {
                sprite.nameLabel.setText(labelText);
            }

            // Interpolate position between prev and curr snapshots
            let rx = pData.x;
            let ry = pData.y;
            if (interp) {
                const prevP = interp.prev.players?.find(pl => pl.sessionId === sid);
                const currP = interp.curr.players?.find(pl => pl.sessionId === sid);
                if (prevP && currP) {
                    rx = prevP.x + (currP.x - prevP.x) * interp.t;
                    ry = prevP.y + (currP.y - prevP.y) * interp.t;
                }
            }
            if (!sprite.getData('isDying')) {
                sprite.setPosition(rx, ry);
            }

            if (pData.facingRight !== undefined && sprite.flipX !== !pData.facingRight) {
                sprite.setData('facingRight', pData.facingRight);
                sprite.setFlipX(!pData.facingRight);
            }
        }

        // Remove sprites of players who left
        for (const [sid, sprite] of this.remotePlayers) {
            if (!activeSids.has(sid)) {
                this._cancelDeathTweens(sprite);
                if (sprite.nameLabel) sprite.nameLabel.destroy();
                sprite.destroy();
                this.remotePlayers.delete(sid);
            }
        }
    }

    // === v28: LOCAL PHYSICS FOR OWN CHARACTER (SimplePhysicsWorld) ===

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
            if (this.hostSprite.x !== x || this.hostSprite.y !== y) {
                this.hostSprite.setPosition(x, y);
            }
            this.hostSprite.setVisible(true);
            if (this.hostSprite.nameLabel) this.hostSprite.nameLabel.setVisible(true);

            // Direction from current snapshot
            if (currHost.facingRight !== undefined && this.hostSprite.flipX !== !currHost.facingRight) {
                this.hostSprite.setData('facingRight', currHost.facingRight);
                this.hostSprite.setFlipX(!currHost.facingRight);
            }
        } else if (this.hostSprite && !currHost) {
            // No host in state — hide the placeholder sprite
            this.hostSprite.setVisible(false);
            if (this.hostSprite.nameLabel) this.hostSprite.nameLabel.setVisible(false);
        }
    }

    // Render OWN player by smoothly lerping the sprite toward the latest server position.
    // Avoids timestamp-buffer math entirely — just a per-frame visual smoothing toward target.
    _interpolateGuestSelf(interp) {
        if (!this.player || this.player.getData('isDying')) return;
        const latest = this.network?.lastSnapshot;
        if (!latest) return;
        const me = latest.players?.find(p => p.id === 'guest');
        if (!me) return;

        // First frame — snap to position
        if (!this._guestSelfInit) {
            this.player.setPosition(me.x, me.y);
            this._guestSelfInit = true;
        } else {
            const lerp = 0.35; // ~3 frame catchup → smooth without much input lag
            const dx = me.x - this.player.x;
            const dy = me.y - this.player.y;
            // Snap to target if very close to avoid jitter
            if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
                this.player.setPosition(me.x, me.y);
            } else {
                this.player.setPosition(this.player.x + dx * lerp, this.player.y + dy * lerp);
            }
        }

        if (me.facingRight !== undefined && this.player.flipX !== !me.facingRight) {
            this.player.setData('facingRight', me.facingRight);
            this.player.setFlipX(!me.facingRight);
        }
    }

    // === v19: SERVER RECONCILIATION (fixed comparison) ===

    /**
     * v21 BENDING: Smooth interpolation toward server state instead of instant reset.
     * Industry-standard approach used by Teeworlds, Source Engine, etc.
     */

    /**
     * v28: Sync hook state from server, respecting input acknowledgement
     * without overwriting local flying/attached hook prediction mid-swing.
     */
    _syncHookStateFromServer(serverData, lastAckedSeq) {
        const core = this.player?.core;
        if (!core || !serverData) return;

        const serverState = serverData.hookState || 'IDLE';
        const hookSeq = this.network?.lastHookInputSeq || 0;

        // Do not overwrite local hook prediction until the server has acknowledged our latest hook input
        if (hookSeq > 0 && lastAckedSeq < hookSeq) {
            return;
        }

        // If both client and server agree the hook is ATTACHED, make sure anchor coordinates match
        if (core.hookState === 'ATTACHED' && serverState === 'ATTACHED' && serverData.hookAnchorPos) {
            if (!core.hookAnchorPos ||
                Math.hypot(serverData.hookAnchorPos.x - core.hookAnchorPos.x, serverData.hookAnchorPos.y - core.hookAnchorPos.y) > 8) {
                core.hookAnchorPos = { ...serverData.hookAnchorPos };
                core.hookPos = { ...serverData.hookAnchorPos };
            }
            return;
        }

        // If client is still FLYING while server is FLYING, keep smooth local flying tip
        if (core.hookState === 'FLYING' && serverState === 'FLYING') {
            return;
        }

        // If state already matches (both IDLE), nothing to do
        if (core.hookState === serverState) {
            return;
        }

        // Play attach sound only on FLYING→ATTACHED transition (natural hook hit)
        const wasFlying = core.hookState === 'FLYING';
        core.hookState = serverState;

        if (serverState === 'ATTACHED' && serverData.hookAnchorPos) {
            if (wasFlying && core._canPlaySound('hookAttached') && this.playSpatialSound) {
                this.playSpatialSound('sfx-hook-attached', serverData.hookAnchorPos.x, serverData.hookAnchorPos.y, 0.3);
            }
            core.hookAnchorPos = { ...serverData.hookAnchorPos };
            core.hookPos = serverData.hookPos ? { ...serverData.hookPos } : { ...serverData.hookAnchorPos };
        } else if (serverState === 'FLYING' && serverData.hookPos) {
            core.hookPos = { ...serverData.hookPos };
            core.hookAnchorPos = null;
        } else {
            core.hookPos = { x: 0, y: 0 };
            core.hookAnchorPos = null;
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
            core.hookPos = serverData.hookPos
                ? { ...serverData.hookPos }
                : { ...serverData.hookAnchorPos };
        } else if (serverData.hookState === 'FLYING' && serverData.hookPos) {
            core.hookPos = { ...serverData.hookPos };
            core.hookAnchorPos = null;
        } else {
            core.hookPos = { x: 0, y: 0 };
            core.hookAnchorPos = null;
        }
    }

    // === v21.3: UNIFIED HOOK VISUALS ===

    _drawHookVisuals(snapshot) {
        if (!snapshot) return;

        if (this.gameMode === 'online') {
            // Own hook from predicted core (or aim crosshair when IDLE)
            const core = this.player?.core;
            if (this.player?.active && core) {
                if (core.hookState === 'IDLE') {
                    const target = this.findHookTarget(this.player);
                    if (target) {
                        this.hookGraphics.lineStyle(2, 0x80e5ff, 0.32);
                        this.hookGraphics.lineBetween(this.player.x, this.player.y, target.x, target.y);
                        this.hookGraphics.strokeCircle(target.x, target.y, 11);
                    }
                } else if (core.hookPos) {
                    this._drawHookLine(this.player.x, this.player.y, core.hookPos.x, core.hookPos.y);
                }
            }
            // Remote players' hooks
            for (const pData of (snapshot.players || [])) {
                if (pData.isSelf || !pData.sessionId) continue;
                const sprite = this.remotePlayers.get(pData.sessionId);
                if (sprite?.active && pData.hookState !== 'IDLE' && pData.hookPos) {
                    this._drawHookLine(sprite.x, sprite.y, pData.hookPos.x, pData.hookPos.y);
                }
            }
            return;
        }

        // Quake-1-style: both guest and host hooks drawn from snapshot data
        const myData = snapshot.players?.find(p => p.id === 'guest');
        if (myData && this.player?.active) {
            if (myData.hookState !== 'IDLE' && myData.hookPos) {
                this._drawHookLine(this.player.x, this.player.y, myData.hookPos.x, myData.hookPos.y);
            }
        }

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
        if (!snapshot) return;

        if (this.gameMode === 'online') {
            for (const pData of (snapshot.players || [])) {
                if (pData.isSelf || !pData.sessionId) continue;
                const sprite = this.remotePlayers.get(pData.sessionId);
                if (sprite && sprite.animPrefix && pData.animation) {
                    const fullKey = pData.animation.includes('-')
                        ? pData.animation
                        : `${sprite.animPrefix}-${pData.animation}`;
                    if (sprite.anims.currentAnim?.key !== fullKey) {
                        sprite.anims.play(fullKey);
                    }
                }
            }
            return;
        }

        // Own character animation — from server snapshot (Quake-1-style)
        // No forceRestart — Phaser skips if animation already playing → smooth playback
        const myData = snapshot.players?.find(p => p.id === 'guest');
        if (myData) {
            const prefix = this.player.animPrefix;
            if (prefix) {
                const vx = (myData.vx || 0) / 256;
                let key;
                if (myData.grounded === false) key = `${prefix}-jump`;
                else if (Math.abs(vx) > 10) key = `${prefix}-walk`;
                else key = `${prefix}-idle`;
                if (this.player.anims.currentAnim?.key !== key) {
                    this.player.anims.play(key);
                }
            }
        }

        // Host character animation (from snapshot)
        const hostData = snapshot.players?.find(p => p.id === 'host');
        if (hostData && this.hostSprite) {
            const hPrefix = this.hostSprite.animPrefix;
            if (hPrefix && hostData.animation) {
                // Server sends short keys ('idle','walk','jump') — prepend sprite prefix
                const fullKey = hostData.animation.includes('-')
                    ? hostData.animation
                    : `${hPrefix}-${hostData.animation}`;
                if (this.hostSprite.anims.currentAnim?.key !== fullKey) {
                    this.hostSprite.anims.play(fullKey);
                }
            }
        }
    }

    // Cancel any pending death tweens / fade timers on a sprite (used at respawn)
    _cancelDeathTweens(sprite) {
        if (!sprite) return;
        if (sprite._deathFadeTimer) {
            sprite._deathFadeTimer.remove(false);
            sprite._deathFadeTimer = null;
        }
        if (sprite._deathTweens) {
            for (const tw of sprite._deathTweens) {
                if (tw && tw.isPlaying && tw.isPlaying()) tw.stop();
            }
            sprite._deathTweens = null;
        }
        // Also kill any remaining tweens targeting this sprite
        this.tweens.killTweensOf(sprite);
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
                this._cancelDeathTweens(this.player);
                this.player.setData('isDying', false);
                this.player.setData('health', myData.health);
                this.player.setAlpha(1);
                this.player.setActive(true);
                this.player.setVisible(true);
                this.player.setAngle(0);
                if (this.player.nameLabel) this.player.nameLabel.setVisible(true);
                this.player.setPosition(myData.x, myData.y);
                this._guestSelfInit = false; // re-init lerp at fresh position
            }

            // Health & knockback sync when damaged on server
            const prevHealth = this.player.getData('health');
            this.player.setData('health', myData.health);
            if (myData.health < prevHealth && myData.health > 0) {
                if (this.gameMode === 'online' && this.player.simpleBody) {
                    this.player.simpleBody.vx = myData.rawVx ?? this.player.simpleBody.vx;
                    this.player.simpleBody.vy = myData.rawVy ?? this.player.simpleBody.vy;
                    this._lastLocalImpulseTime = Date.now();
                }
                this.cameras.main.shake(95, 0.004);
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

        // Remote players non-physics (online mode: all remotePlayers; join mode: hostSprite)
        const applyRemoteNonPhysics = (remSprite, pData) => {
            if (!remSprite || !pData) return;
            if (pData.isDying && !remSprite.getData('isDying')) {
                remSprite.setData('isDying', true);
                if (remSprite.nameLabel) remSprite.nameLabel.setVisible(false);

                const spinDir = Math.random() > 0.5 ? 1 : -1;
                const spinTween = this.tweens.add({
                    targets: remSprite,
                    angle: spinDir * 360,
                    duration: RAGDOLL.DURATION,
                    ease: 'Linear'
                });
                remSprite._deathTweens = [spinTween];

                const fadeTimer = this.time.delayedCall(RAGDOLL.DURATION, () => {
                    const fadeTween = this.tweens.add({
                        targets: remSprite,
                        alpha: 0,
                        duration: RAGDOLL.FADE_TIME
                    });
                    if (remSprite._deathTweens) remSprite._deathTweens.push(fadeTween);
                });
                remSprite._deathFadeTimer = fadeTimer;
            }
            if (!pData.isDying && remSprite.getData('isDying')) {
                this._cancelDeathTweens(remSprite);
                remSprite.setData('isDying', false);
                remSprite.setData('health', pData.health);
                remSprite.setAlpha(1);
                remSprite.setVisible(true);
                remSprite.setAngle(0);
                if (remSprite.nameLabel) remSprite.nameLabel.setVisible(true);
                remSprite.setPosition(pData.x, pData.y);
            }
            remSprite.setData('health', pData.health);
            if (pData.powerup) {
                const tints = { fire: 0xff8800, speed: 0xffff00, shield: 0x6666ff, doublejump: 0x66ff66 };
                remSprite.setTint(tints[pData.powerup] || 0xffffff);
            } else if (!pData.isDying) {
                remSprite.clearTint();
            }
            remSprite.setVisible(pData.isActive !== false);
        };

        if (this.gameMode === 'online') {
            for (const pData of (snapshot.players || [])) {
                if (pData.isSelf || !pData.sessionId) continue;
                const sprite = this.remotePlayers.get(pData.sessionId);
                applyRemoteNonPhysics(sprite, pData);
            }
        } else {
            const hostData = snapshot.players?.find(p => p.id === 'host');
            applyRemoteNonPhysics(this.hostSprite, hostData);
        }

        // Snowballs (interpolated visuals)
        this.syncSnowballVisuals(snapshot.snowballs || [], interp);

        // Pickups, score, CTF state
        this.syncPickupVisuals(snapshot.pickups || []);
        if (snapshot.score) {
            this.matchData.playerWins = snapshot.score.guestWins || 0;
            this.matchData.opponentWins = snapshot.score.hostWins || 0;
        }
        if (snapshot.ctf && this.ctf) {
            this.ctf.state = snapshot.ctf.state || 'HOME';
            this.ctf.x = snapshot.ctf.x ?? this.ctf.homeX;
            this.ctf.y = snapshot.ctf.y ?? this.ctf.homeY;
            this.ctf.carrierSid = snapshot.ctf.carrierSid || '';
            if (this.ctf.state === 'CARRIED' && this.ctf.carrierSid) {
                if (this.ctf.carrierSid === this.network?._sessionId) {
                    this.ctf.carrier = this.player;
                } else {
                    this.ctf.carrier = this.remotePlayers?.get(this.ctf.carrierSid) || this.hostSprite || null;
                }
            } else {
                this.ctf.carrier = null;
            }
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
                if (evt.type === 'hitEffect') {
                    this.showHitEffect(evt.x, evt.y, evt.hasFire);
                    // If the hit wasn't on our own player, we landed a hit in online/guest mode!
                    if (this.player && Math.hypot(evt.x - this.player.x, evt.y - this.player.y) > 45) {
                        const now = Date.now();
                        this._playerHitCombo = (now - (this._lastHitTime || 0) < 6500) ? (this._playerHitCombo || 0) + 1 : 1;
                        this._lastHitTime = now;
                        this._playSynthFX('hitConfirm', this._playerHitCombo);
                        const comboTag = this._playerHitCombo >= 2 ? ` · x${this._playerHitCombo}` : '';
                        const dmg = evt.hasFire ? 40 : 20;
                        this.showFloatingCallout(evt.x, evt.y - 45, `-${dmg}${evt.hasFire ? ' 🔥' : ''}${comboTag}`, evt.hasFire ? '#fb923c' : '#fde047', 21);
                        this.cameras.main.shake(55, 0.0022);
                        this.updateHUD();
                    }
                }
                if (evt.type === 'splatEffect') this.showSplatEffect(evt.x, evt.y);
                if (evt.type === 'flagEvent') {
                    const isMe = evt.carrierSid && evt.carrierSid === this.network?._sessionId;
                    if (evt.action === 'grab') {
                        this._playSynthFX(isMe ? 'cheeseGrab' : 'cheeseDrop', 1);
                        if (isMe) {
                            this.showArcadeBanner('🧀 ТЫ СХВАТИЛ ЗОЛОТОЙ СЫР!', 'Неси его на свою базу!', '#fde047');
                        } else {
                            this.showArcadeBanner(`🚨 ${evt.carrierName || 'Соперник'} СХВАТИЛ СЫР!`, 'Сбей его 2 снежками!', '#f87171');
                        }
                    } else if (evt.action === 'drop') {
                        this._playSynthFX('cheeseDrop', 1);
                        if (this.ctf) this.ctf.droppedAt = Date.now();
                        this.showArcadeBanner('🧀 СЫР УПАЛ!', 'Скорее перехвати его!', '#facc15');
                    } else if (evt.action === 'return') {
                        this._playSynthFX('trickShot', 1);
                        this.showArcadeBanner('🧀 СЫР ВЕРНУЛСЯ В ЦЕНТР!', 'Снова на центральном алтаре!', '#fde047');
                    } else if (evt.action === 'capture') {
                        this._playSynthFX(isMe ? 'cheeseScore' : 'cheeseDrop', 2);
                        this.cameras.main.shake(170, 0.005);
                        if (isMe) {
                            this.showArcadeBanner('🏆 СЫР ДОСТАВЛЕН НА БАЗУ! +1 🧀', 'Отличная работа!', '#fde047');
                        } else {
                            this.showArcadeBanner(`🚨 ${evt.carrierName || 'Соперник'} ДОСТАВИЛ СЫР!`, 'Защищай центральный алтарь!', '#f87171');
                        }
                    }
                }
                if (evt.type === 'roundWin') {
                    if (this.cache.audio.exists('sfx-sting-round') && !this._soundMuted) {
                        this.sound.play('sfx-sting-round', { volume: 0.5 });
                    }
                    this.showArcadeBanner(`🏆 ${evt.winnerName}!`, 'Выиграл этот раунд!', '#facc15');
                }
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
        const serverIds = new Set(serverSnowballs.map(s => String(s.id)));

        // Remove snowballs that no longer exist on server
        this.snowballs = this.snowballs.filter(sb => {
            if (!serverIds.has(String(sb.getData('netId')))) {
                this.destroySnowball(sb);
                return false;
            }
            return true;
        });

        // Update or create snowball visuals
        for (const ss of serverSnowballs) {
            let sb = this.snowballs.find(s => String(s.getData('netId')) === String(ss.id));
            if (!sb) {
                // Create visual-only snowball (no physics body needed on guest)
                sb = this.add.sprite(ss.x, ss.y, 'snowball');
                sb.setScale(ss.hasFire ? 0.7 : 0.55);
                if (ss.hasFire) {
                    sb.setTint(0xff4400);
                    // Fire trail particles (same as host)
                    const particles = this.add.particles(0, 0, 'snowball', {
                        follow: sb,
                        scale: { start: 0.3, end: 0 },
                        alpha: { start: 0.85, end: 0 },
                        tint: [0xff4400, 0xff8800, 0xffcc00],
                        lifespan: 200,
                        frequency: 28,
                        blendMode: 'ADD'
                    });
                    particles.setDepth(9);
                    sb.setData('particles', particles);
                } else {
                    sb.setTint(0xe8f4ff);
                    const trail = this.add.particles(0, 0, 'snowball', {
                        follow: sb,
                        scale: { start: 0.22, end: 0 },
                        alpha: { start: 0.65, end: 0 },
                        tint: [0xffffff, 0xbbe8ff, 0x7dd3fc],
                        lifespan: 150,
                        frequency: 34
                    });
                    trail.setDepth(9);
                    sb.setData('particles', trail);
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
        let bestScore = -999;

        const cCol = Math.floor(px / T);
        const cRow = Math.floor(py / T);
        const maxTileRadiusX = 9;
        const maxTileRadiusY = 9;

        // Fast integer-tile scan for hookable overhead & side ledges up to PHYS.HOOK_RANGE (660px)
        for (let r = cRow - maxTileRadiusY; r <= cRow; r++) {
            for (let c = cCol - maxTileRadiusX; c <= cCol + maxTileRadiusX; c++) {
                const tile = this.platformLayer.getTileAt(c, r);
                if (!tile || tile.index <= 0) continue;

                // Never target 45° slope tiles (gid 5, 6) as overhead hook anchors
                if (tile.index === 5 || tile.index === 6) continue;

                const isBridge = tile.index >= 7 && tile.index <= 9;
                const tileBelow = this.platformLayer.getTileAt(c, r + 1);
                const tileLeft = this.platformLayer.getTileAt(c - 1, r);
                const tileRight = this.platformLayer.getTileAt(c + 1, r);

                const isBottomEdge = !tileBelow || tileBelow.index <= 0;
                const isSideEdge = (cRow - r >= 1) && ((!tileLeft || tileLeft.index <= 0) || (!tileRight || tileRight.index <= 0));

                if (!isBottomEdge && !isSideEdge) continue;

                const targetX = (c + 0.5) * T;
                // Bridges have their solid plank+girder beam in the top 26px ((r + 0.25) * T)
                const targetY = isBridge
                    ? (r + 0.25) * T
                    : (isBottomEdge ? (r + 0.85) * T : (r + 0.5) * T);
                if (targetY > py + 12) continue;

                const dx = targetX - px;
                const dy = targetY - py;
                const dist = Math.hypot(dx, dy);

                if (dist > PHYS.HOOK_RANGE || dist < 48) continue;

                // Verify clear line of sight so the hook doesn't clip an earlier ledge/bridge in mid-flight
                if (this.physicsWorld) {
                    const hit = this.physicsWorld.raycast(px, py, targetX, targetY);
                    if (hit && hit.hit && (hit.tileX !== c || hit.tileY !== r)) continue;
                }

                // Teeworlds swing-arc scoring:
                // Strongly prefer anchors ahead in facing direction at a 30°..60° forward swing angle
                // (optimal distance ~180..420px) instead of straight above the head!
                const forwardX = dx * searchDir;
                const upY = Math.max(40, -dy);
                const swingRatio = forwardX / upY; // ~0.5..1.5 is a 27°..56° forward Teeworlds swing arc

                let score = 135 - Math.abs(dist - 290) * 0.14;

                if (forwardX > 45) {
                    score += 42;
                    // Extra bonus for ideal Teeworlds pendulum swing angle (25°..60° forward)
                    if (swingRatio >= 0.45 && swingRatio <= 1.65) {
                        score += 28;
                    }
                } else if (Math.abs(dx) <= 45) {
                    // Directly overhead: penalize so we don't pull straight into the ceiling when a forward swing exists
                    score -= 22;
                } else {
                    // Behind facing direction: fallback only if nothing ahead
                    score -= 35;
                }

                // Prefer targets cleanly above
                if (dy < -T * 1.4) score += 22;

                // Prefer bottom edges, bridges, and crystal grapple pods (localId 9, 10 -> gid 10, 11)
                if (isBottomEdge) score += 16;
                if (isBridge) score += 18;
                if (tile.index === 10 || tile.index === 11) score += 24;

                if (score > bestScore) {
                    bestScore = score;
                    bestTarget = { x: targetX, y: targetY };
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
            // Only compute and draw aim line for the local human player
            if (character === this.player) {
                const target = this.findHookTarget(character);
                if (target) {
                    this.hookGraphics.lineStyle(2, 0x80e5ff, 0.34);
                    this.hookGraphics.lineBetween(character.x, character.y, target.x, target.y);

                    // Draw crosshair
                    this.hookGraphics.strokeCircle(target.x, target.y, 11);
                }
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

    _autoAimAngle(shooter) {
        const sx = shooter.x, sy = shooter.y;
        const facingRight = shooter.getData('facingRight');
        const fallback = facingRight ? 0 : Math.PI;
        const range = 600;

        let bestTarget = null;
        let bestDist = Infinity;

        const checkTarget = (t) => {
            if (!t || t === shooter || !t.active || (t.getData('health') ?? 0) <= 0) return;
            const dx = t.x - sx, dy = t.y - sy;
            const d = Math.hypot(dx, dy);
            if (d > range || d < 10) return;
            // LOS check (exact point test against slopes/bridges)
            if (this.physicsWorld || this.platformLayer) {
                const steps = Math.ceil(d / (TILE_SIZE * 0.5));
                for (let i = 1; i < steps; i++) {
                    const frac = i / steps;
                    const px = sx + dx * frac;
                    const py = sy + dy * frac;
                    const blocked = this.physicsWorld
                        ? this.physicsWorld._testPoint(px, py)
                        : !!(this.platformLayer?.getTileAtWorldXY(px, py)?.index > 0);
                    if (blocked) return;
                }
            }
            if (d < bestDist) { bestDist = d; bestTarget = t; }
        };

        if (this.player) checkTarget(this.player);
        if (this.guestPlayer) checkTarget(this.guestPlayer);
        if (this.bots) this.bots.forEach(b => checkTarget(b));
        if (this.remotePlayers) {
            for (const [, rem] of this.remotePlayers) checkTarget(rem);
        }

        if (bestTarget) {
            const angle = Math.atan2(bestTarget.y - sy, bestTarget.x - sx);
            // Add slight scatter (±8°)
            return angle + (Math.random() - 0.5) * 0.28;
        }
        return fallback;
    }

    shootSnowball(shooter, angle = null) {
        const now = Date.now();

        // Fire rate cooldown
        const lastFireTime = shooter.getData('lastFireTime') || 0;
        if (now - lastFireTime < PHYS.SNOWBALL_FIRE_RATE) return;

        shooter.setData('lastFireTime', now);

        // Determine angle: auto-aim at nearest visible enemy, or facing direction
        if (angle === null || angle === undefined) {
            angle = this._autoAimAngle(shooter);
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

        // Fire & frosty wake trail visual effects
        snowball.setData('hasFire', hasFire);
        if (hasFire) {
            snowball.setTint(0xff4400);
            snowball.setScale(0.7);

            const particles = this.add.particles(0, 0, 'snowball', {
                follow: snowball,
                scale: { start: 0.3, end: 0 },
                alpha: { start: 0.85, end: 0 },
                tint: [0xff4400, 0xff8800, 0xffcc00],
                lifespan: 200,
                frequency: 28,
                blendMode: 'ADD'
            });
            particles.setDepth(9);
            snowball.setData('particles', particles);
        } else {
            snowball.setScale(0.55);
            snowball.setTint(0xe8f4ff);

            const trail = this.add.particles(0, 0, 'snowball', {
                follow: snowball,
                scale: { start: 0.22, end: 0 },
                alpha: { start: 0.65, end: 0 },
                tint: [0xffffff, 0xbbe8ff, 0x7dd3fc],
                lifespan: 150,
                frequency: 34
            });
            trail.setDepth(9);
            snowball.setData('particles', trail);
        }

        snowball.setDepth(10);
        snowball.setData('shooter', shooter);
        snowball.setData('damage', PHYS.SNOWBALL_DAMAGE);
        snowball.setData('spawnX', spawnX);
        snowball.setData('spawnY', spawnY);
        snowball.setData('shotFromRope', shooter.core?.hookState === 'ATTACHED');
        snowball.setData('shotMidAir', shooter.core ? !shooter.core.grounded : false);
        snowball.setData('ignoreShooterFrames', 5);
        snowball.setData('checkOverlap', 3);
        snowball.setData('netId', this._nextSnowballId++);

        this.snowballs.push(snowball);

        // Sound effect with spatial audio
        this.playSpatialSound('sfx-snowball-shot', shooter.x, shooter.y, 0.45);
        if (hasFire && shooter === this.player) {
            this.playSpatialSound('sfx-dash', shooter.x, shooter.y, 0.35);
        }

        // Auto-destroy after lifetime
        const destroyTimer = this.time.delayedCall(PHYS.SNOWBALL_LIFETIME, () => {
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
        const hasFire = !!snowball.getData('hasFire');
        this.playSpatialSound('sfx-snowball-hit', target.x, target.y, 1.0);
        this.showHitEffect(target.x, target.y, hasFire);

        // === HIGH-DOPAMINE HIT COMBO & TRICK SHOT FEEDBACK ===
        if (shooter === this.player) {
            const now = Date.now();
            if (now - (this._lastHitTime || 0) < 6500) {
                this._playerHitCombo = (this._playerHitCombo || 0) + 1;
            } else {
                this._playerHitCombo = 1;
            }
            this._lastHitTime = now;

            // Play escalating musical hit-confirm chime!
            this._playSynthFX('hitConfirm', this._playerHitCombo);

            // Detect Trick Shots!
            const sx = snowball.getData('spawnX') ?? shooter.x;
            const sy = snowball.getData('spawnY') ?? shooter.y;
            const shotDist = Math.hypot(target.x - sx, target.y - sy);
            const fromRope = snowball.getData('shotFromRope') || (shooter.core?.hookState === 'ATTACHED');
            const midAir = snowball.getData('shotMidAir') && (target.core ? !target.core.grounded : false);

            let trickTag = '';
            if (fromRope) {
                trickTag = ' 🪝 С ВЕРЁВКИ!';
                this._playSynthFX('trickShot', 2);
            } else if (shotDist >= 450) {
                trickTag = ' 🎯 СНАЙПЕР!';
                this._playSynthFX('trickShot', 2);
            } else if (midAir) {
                trickTag = ' ✈️ В ПРЫЖКЕ!';
                this._playSynthFX('trickShot', 1);
            }

            const comboTag = this._playerHitCombo >= 2 ? ` · x${this._playerHitCombo}` : '';
            const dmgText = hasFire
                ? `-${Math.round(finalDamage)} 🔥${comboTag}${trickTag}`
                : `-${Math.round(finalDamage)}${comboTag}${trickTag}`;
            const dmgColor = hasFire ? '#fb923c' : (trickTag ? '#38bdf8' : (this._playerHitCombo >= 3 ? '#facc15' : '#ffffff'));
            this.showFloatingCallout(target.x, target.y - 45, dmgText, dmgColor, trickTag || hasFire ? 23 : 20);

            // Announce big hit combos at top of screen
            if (this._playerHitCombo === 3) {
                this.showArcadeBanner('🔥 СЕРИЯ ПОПАДАНИЙ x3! 🔥', 'Точно в цель!', '#fb923c');
            } else if (this._playerHitCombo === 5) {
                this.showArcadeBanner('⚡ СНАЙПЕР-МАСТЕР x5! ⚡', 'Ни одного промаха!', '#facc15');
            }

            // Crisp micro-punch on camera when landing a hit
            this.cameras.main.shake(60, 0.0024);
            this.updateHUD();
        } else if (target === this.player) {
            // Reset hit combo when hit by enemy, and shake screen
            this.cameras.main.shake(110, 0.005);
            this.showFloatingCallout(target.x, target.y - 45, `-${Math.round(finalDamage)}`, '#f87171', 20);
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

        // === CENTER CTF: Knock Golden Cheese out of carrier's hands (2 hits or 1 fire hit) ===
        if (this.ctf && this.ctf.state === 'CARRIED' && this.ctf.carrier === target && newHealth > 0) {
            this.ctf.carrierHits = (this.ctf.carrierHits || 0) + (hasFire ? 2 : 1);
            if (this.ctf.carrierHits >= 2) {
                this.dropCTFCheese(target, snowball.vx || 0);
            } else {
                this.showFloatingCallout(target.x, target.y - 78, '🧀 ЕЩЁ 1 ПОПАДАНИЕ!', '#fde047', 19);
            }
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

        // === VERTICAL & WATER HAZARD BOUNDS (death zone) ===
        const mapHeight = this.map ? this.map.heightInPixels : GAME.HEIGHT;
        const wb = this.waterBounds;

        const checkFall = (character, killer) => {
            if (!character?.active || character.getData('isDying')) return;
            const inWaterPit = wb &&
                character.x >= wb.minX + 10 &&
                character.x <= wb.maxX - 10 &&
                character.y + 18 >= wb.minY;
            const fellOutOfWorld = character.y > mapHeight - 40;
            if (inWaterPit || fellOutOfWorld) {
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

        // Stop background music and procedural beat loop
        this._stopArcadeBeatLoop();
        if (this.bgm) {
            try { this.bgm.stop(); } catch (_) {}
            this.bgm = null;
        }
        try { this.sound.stopAll(); } catch (_) {}

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
