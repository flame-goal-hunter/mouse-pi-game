/**
 * SimplePhysicsWorld v34.4
 * Детерминированная физика для идеальной сетевой синхронизации
 * Sonic-inspired sensor system + pixel-stepping
 *
 * Архитектура (основана на Sonic the Hedgehog + Teeworlds):
 * - _testPoint(px,py): точка внутри solid? (Teeworlds CheckPoint + Sonic sensor)
 * - _findGroundAt(x,y,max): Sonic ground sensor с regress/extend
 * - _collidesWall(body): 2 wall sensors на уровне центра тела (Sonic push sensors)
 * - _testCeiling(body): 2 ceiling sensors на голове (только solid -1)
 * - Никаких fill tiles — сенсоры решают проблему архитектурно
 */
export class SimplePhysicsWorld {
    constructor(tileSize = 70) {
        this.tileSize = tileSize;
        this.tileGrid = null;   // number[][] (0=empty, -1=solid, >0=slope tileId)
        this.solidGrid = null;  // backward compat alias
        this.slopeHeights = new Map(); // tileId → Float32Array[tileSize]
        this.bodies = new Map();
        this.GRAVITY = 1200;    // px/s²
        this.SNAP_DOWN = 8;     // max pixels for ground-following per 1px horizontal step
        this.SLOPE_FACTOR = 0.5; // gravity projection onto slope (0=none, 1=full physics)
        this.gridWidth = 0;
        this.gridHeight = 0;
    }

    /**
     * Инициализация из Phaser tilemap
     */
    initFromTilemap(platformLayer, tileset) {
        const { width, height } = platformLayer.layer;
        this.gridWidth = width;
        this.gridHeight = height;
        this.tileGrid = [];

        if (!tileset) {
            tileset = platformLayer.tileset?.[0] ||
                      platformLayer.layer?.tilemapLayer?.tilemap?.tilesets?.[0];
        }
        const firstgid = tileset?.firstgid || 1;
        if (tileset) {
            this._parseSlopeData(tileset);
        }

        let solidCount = 0;
        let slopeCount = 0;
        let hasIndexCount = 0;

        for (let y = 0; y < height; y++) {
            this.tileGrid[y] = [];
            for (let x = 0; x < width; x++) {
                const tile = platformLayer.getTileAt(x, y);
                const isSolid = tile ? (tile.collides === true || (tile.index > 0 && tile.collides !== false)) : false;

                if (!isSolid) {
                    this.tileGrid[y][x] = 0;
                } else {
                    const localId = tile.index - firstgid;
                    if (this.slopeHeights.has(localId)) {
                        this.tileGrid[y][x] = localId;
                        slopeCount++;
                    } else if (localId === 6 || localId === 7 || localId === 8) {
                        // Bridge slab: only top 26px of the 70px tile is solid!
                        this.tileGrid[y][x] = -2;
                    } else {
                        this.tileGrid[y][x] = -1;
                    }
                    solidCount++;
                }

                if (tile && tile.index > 0) hasIndexCount++;
            }
        }

        // No fill tiles — sensor-based collision doesn't need them
        this.solidGrid = this.tileGrid;

        console.log(`[SimplePhysicsWorld] v34.4 Sonic sensors + slope gravity. ${width}x${height} grid, tileSize=${this.tileSize}`,
            `tiles=${hasIndexCount}, solid=${solidCount}, slopes=${slopeCount}, slopeTypes=${this.slopeHeights.size}`);
    }

    // ==========================================
    // SLOPE DATA PARSING
    // ==========================================

    _parseSlopeData(tileset) {
        const tileData = tileset.tileData;
        if (!tileData) return;

        for (const localIdStr of Object.keys(tileData)) {
            const data = tileData[localIdStr];
            const objects = data?.objectgroup?.objects;
            if (!objects || objects.length === 0) continue;

            const obj = objects[0];
            const polygon = obj.polygon;
            if (!polygon || polygon.length < 3) continue;

            const vertices = polygon.map(p => ({
                x: obj.x + p.x,
                y: obj.y + p.y
            }));

            const heights = new Float32Array(this.tileSize);
            for (let lx = 0; lx < this.tileSize; lx++) {
                heights[lx] = this._polygonGroundY(vertices, lx + 0.5);
            }

            // Clamp edge heights for seamless transitions
            if (heights[0] > this.tileSize - 1) heights[0] = this.tileSize;
            if (heights[this.tileSize - 1] < 1) heights[this.tileSize - 1] = 0;
            if (heights[0] < 1) heights[0] = 0;
            if (heights[this.tileSize - 1] > this.tileSize - 1) heights[this.tileSize - 1] = this.tileSize;

            const tileId = parseInt(localIdStr);
            this.slopeHeights.set(tileId, heights);

            console.log(`[SimplePhysicsWorld] Slope tileId=${tileId}: heights[0]=${heights[0].toFixed(1)}, heights[${this.tileSize - 1}]=${heights[this.tileSize - 1].toFixed(1)}`);
        }
    }

    _polygonGroundY(vertices, localX) {
        let minY = this.tileSize;

        for (let i = 0; i < vertices.length; i++) {
            const a = vertices[i];
            const b = vertices[(i + 1) % vertices.length];

            if ((a.x <= localX && b.x > localX) || (b.x <= localX && a.x > localX)) {
                const t = (localX - a.x) / (b.x - a.x);
                const y = a.y + t * (b.y - a.y);
                if (y < minY) minY = y;
            }
        }

        return Math.max(0, Math.min(this.tileSize, minY));
    }

    _sampleHeight(heights, localX) {
        const ix = Math.min(Math.floor(localX), this.tileSize - 2);
        const frac = localX - ix;
        return heights[ix] + (heights[ix + 1] - heights[ix]) * frac;
    }

    // ==========================================
    // BODY MANAGEMENT
    // ==========================================

    createBody(id, x, y, halfW, halfH, gravityScale = 1) {
        const body = {
            id,
            x,
            y,
            vx: 0,
            vy: 0,
            halfW,
            halfH,
            grounded: false,
            gravityScale,
            wasGrounded: false,
            onSlope: false,
            remainderX: 0,
            remainderY: 0
        };
        this.bodies.set(id, body);
        return body;
    }

    removeBody(id) {
        this.bodies.delete(id);
    }

    getBody(id) {
        return this.bodies.get(id);
    }

    // ==========================================
    // PHYSICS STEP
    // ==========================================

    /**
     * Push body out of solid geometry if it starts inside.
     * Handles cases from network bending, teleport, respawn.
     */
    _resolveOverlap(body) {
        // Delegate to hardDepenetrate — single source of truth
        this._hardDepenetrate(body);
    }

    step(dt) {
        if (!this._loggedStep && this.bodies.size > 0) {
            console.log('[SimplePhysicsWorld] v34.5 Hard depenetration. Bodies:', this.bodies.size, 'tileGrid:', !!this.tileGrid);
            this._loggedStep = true;
        }
        for (const body of this.bodies.values()) {
            body.wasGrounded = body.grounded;

            // 1. Gravity with Teeworlds-style Apex Hang-Time & crisp fall curve
            let gravMult = body.gravityScale;
            if (!body.grounded && body.gravityScale >= 0.9) {
                if (Math.abs(body.vy) < 135) {
                    gravMult *= 0.80; // Floaty hang-time at jump apex for aiming/hooking
                } else if (body.vy > 180) {
                    gravMult *= 1.08; // Crisp descent
                }
            }
            body.vy += this.GRAVITY * gravMult * dt;

            // 2. Slope gravity BEFORE movement so gentle downhill ice slide works smoothly
            if (body.grounded && body.onSlope) {
                const gradient = this._getSlopeGradient(body.x, body.y + body.halfH);
                if (gradient !== 0) {
                    const sinTheta = gradient / Math.sqrt(1 + gradient * gradient);
                    body.vx += this.GRAVITY * 0.28 * sinTheta * body.gravityScale * dt;
                }
            }

            // 3. Sub-pixel remainders
            body.remainderX += body.vx * dt;
            body.remainderY += body.vy * dt;

            const moveX = Math.round(body.remainderX);
            const moveY = Math.round(body.remainderY);
            body.remainderX -= moveX;
            body.remainderY -= moveY;

            // 4. Move each axis one pixel at a time
            this._pixelMoveX(body, moveX);
            if (body.grounded && body.vy === 0 && moveY > 0) {
                // _pixelMoveX already snapped body to ground/slope this tick
                body.remainderY = 0;
            } else {
                this._pixelMoveY(body, moveY);
            }

            // 5. Quantize for determinism
            body.vx = Math.round(body.vx * 100) / 100;
            body.vy = Math.round(body.vy * 100) / 100;

            // 6. Directional, bounded depenetration safety net
            this._hardDepenetrate(body);
        }
    }

    /**
     * Directional, bounded depenetration:
     * - Head hitting ceiling/bridge pushes DOWN only (never teleports up through bridges/platforms).
     * - Foot hitting floor/slope pushes UP only.
     * - Left/right center wall sensor pushes away from the hit wall only (never pushes the wrong way).
     * - Bounded to <= 32px so a body can never teleport across tiles.
     */
    _hardDepenetrate(body) {
        if (!this._bodyOverlapsSolid(body)) return;

        let ox = body.x;
        let oy = body.y;

        const headHit = this._testCeiling(body);
        const footHit = this._testPoint(ox, oy + body.halfH - 2);

        // 1. Head overlapping solid ceiling -> push DOWN at most 8px (never slam down across ledges)
        if (headHit && !footHit) {
            for (let dy = 1; dy <= 8; dy++) {
                body.y = oy + dy;
                if (!this._testCeiling(body) && !this._testPoint(body.x, body.y)) {
                    if (body.vy < 0) body.vy = 0;
                    oy = body.y;
                    break;
                }
            }
            if (!this._bodyOverlapsSolid(body)) return;
            body.y = oy;
        }

        // 2. Foot overlapping floor or slope -> push UP only
        if (footHit && !headHit) {
            for (let dy = 1; dy <= 28; dy++) {
                body.y = oy - dy;
                if (!this._bodyOverlapsSolid(body)) {
                    if (body.vy > 0) {
                        body.vy = 0;
                        body.grounded = true;
                    }
                    return;
                }
            }
            body.y = oy;
        }

        // 3. Side wall sensor overlap -> push away from the specific wall that was hit
        const upperY = oy - body.halfH + 4;
        const leftHit = this._testPoint(ox - body.halfW, oy) || this._testWallPoint(ox - body.halfW, upperY);
        const rightHit = this._testPoint(ox + body.halfW - 0.01, oy) || this._testWallPoint(ox + body.halfW - 0.01, upperY);

        if (leftHit && !rightHit) {
            for (let dx = 1; dx <= 28; dx++) {
                body.x = ox + dx;
                if (!this._collidesWall(body)) {
                    if (body.vx < 0) body.vx = 0;
                    if (!this._bodyOverlapsSolid(body)) return;
                    ox = body.x;
                    break;
                }
            }
            body.x = ox;
        } else if (rightHit && !leftHit) {
            for (let dx = 1; dx <= 28; dx++) {
                body.x = ox - dx;
                if (!this._collidesWall(body)) {
                    if (body.vx > 0) body.vx = 0;
                    if (!this._bodyOverlapsSolid(body)) return;
                    ox = body.x;
                    break;
                }
            }
            body.x = ox;
        }

        if (!this._bodyOverlapsSolid(body)) return;

        // 4. Fallback short-range search (prefer upward and horizontal before downward; max 16px)
        const dirs = [
            [0, -1], [-1, 0], [1, 0],
            [-0.707, -0.707], [0.707, -0.707],
            [0, 1], [-0.707, 0.707], [0.707, 0.707]
        ];

        for (let r = 1; r <= 16; r++) {
            for (const [dx, dy] of dirs) {
                body.x = Math.round(ox + dx * r);
                body.y = Math.round(oy + dy * r);
                if (!this._bodyOverlapsSolid(body)) {
                    if (dx !== 0 && dy === 0) body.vx = 0;
                    if (dy !== 0 && dx === 0) body.vy = 0;
                    return;
                }
            }
        }
        body.x = ox;
        body.y = oy;
    }

    /**
     * Check if body's core sensors overlap solid geometry.
     * Uses center + center foot (inset 2px) + Sonic center-height wall sensors + head ceiling sensors.
     */
    _bodyOverlapsSolid(body) {
        return this._testPoint(body.x, body.y) ||                        // center
               this._testPoint(body.x, body.y + body.halfH - 2) ||       // center foot (inset 2px)
               this._collidesWall(body) ||                               // left/right center & shoulder wall sensors
               this._testCeiling(body);                                  // head ceiling sensors
    }

    // ==========================================
    // SONIC-INSPIRED SENSOR SYSTEM
    // ==========================================

    /**
     * Test if a world-space point is inside solid geometry.
     * Solid = full solid tile (-1) OR below a slope surface.
     * Timber bridges (-2) are one-way top surfaces (only solid for raycasts/hooks when includeBridges=true).
     */
    _testPoint(px, py, includeBridges = false) {
        const ts = this.tileSize;
        const tx = Math.floor(px / ts);
        const ty = Math.floor(py / ts);
        const tile = this._getTile(tx, ty);
        if (tile === -1) return true;
        if (includeBridges && tile === -2) {
            const localY = py - ty * ts;
            return localY >= 0 && localY <= 26;
        }
        if (tile > 0) {
            const heights = this.slopeHeights.get(tile);
            if (heights) {
                const localX = Math.max(0, Math.min(ts - 1, px - tx * ts));
                const surfaceY = ty * ts + this._sampleHeight(heights, localX);
                return py >= surfaceY;
            }
        }
        return false;
    }

    /**
     * Sonic-style ground sensor: find the ground surface Y at (sensorX, sensorY).
     * Uses Sonic's regress/extend rules:
     * - Slope tile: read height array directly
     * - Solid tile (-1) or Bridge slab (-2): regress — check tile ABOVE for slope (more precise surface)
     * - Empty tile (0): extend — check tile BELOW for ground
     * Returns surfaceY or null if no ground within maxDist.
     */
    _findGroundAt(sensorX, sensorY, maxDist) {
        const ts = this.tileSize;
        const tx = Math.floor(sensorX / ts);
        const ty = Math.floor(sensorY / ts);
        const tile = this._getTile(tx, ty);
        const localX = Math.max(0, Math.min(ts - 1, sensorX - tx * ts));

        // Slope tile: read height array directly
        if (tile > 0) {
            const h = this.slopeHeights.get(tile);
            if (h) {
                const surfY = ty * ts + this._sampleHeight(h, localX);
                if (Math.abs(sensorY - surfY) <= maxDist) return surfY;
            }
        }

        // Regress: check slope in tile ABOVE first (within maxDist only!)
        const above = this._getTile(tx, ty - 1);
        if (above > 0) {
            const h = this.slopeHeights.get(above);
            if (h) {
                const surfY = (ty - 1) * ts + this._sampleHeight(h, localX);
                if (Math.abs(sensorY - surfY) <= maxDist) return surfY;
            }
        }

        // Solid tile (-1) or Bridge slab (-2) top surface (only if tile above is air or bridge)
        if (tile === -1 || tile === -2) {
            if (above === 0 || above === -2) {
                const surfY = ty * ts;
                if (Math.abs(sensorY - surfY) <= maxDist) return surfY;
            }
        }

        // Empty tile (or bottom air of a bridge tile): extend — check tile BELOW for ground (Sonic rule)
        if (tile === 0 || tile === -2) {
            const below = this._getTile(tx, ty + 1);
            if (below > 0) {
                const h = this.slopeHeights.get(below);
                if (h) {
                    const surfY = (ty + 1) * ts + this._sampleHeight(h, localX);
                    if (Math.abs(sensorY - surfY) <= maxDist) return surfY;
                }
            }
            if (below === -1 || below === -2) {
                const surfY = (ty + 1) * ts;
                if (Math.abs(sensorY - surfY) <= maxDist) return surfY;
            }
        }

        return null;
    }

    /**
     * Dual-foot + center ground sensor for a body:
     * 1. First checks the center sensor (body.x) which handles both flat tiles and 45° slopes seamlessly.
     * 2. If the center sensor is over empty air, checks the left foot and right foot
     *    against flat solid/bridge ledges so the character never drops off platform edges early!
     */
    _findBodyGround(body, footY, maxDist) {
        const centerGround = this._findGroundAt(body.x, footY, maxDist);
        if (centerGround !== null) return centerGround;

        // Always check full-width bridge ledges (-2) so standing/landing on bridge ends never drops through!
        const bridgeLeft = this._findBridgeLedgeAt(body.x - body.halfW + 3, footY, maxDist);
        const bridgeRight = this._findBridgeLedgeAt(body.x + body.halfW - 3, footY, maxDist);
        if (bridgeLeft !== null && bridgeRight !== null) return Math.min(bridgeLeft, bridgeRight);
        if (bridgeLeft !== null) return bridgeLeft;
        if (bridgeRight !== null) return bridgeRight;

        // If body is currently on or overlapping a slope tile at feet, let center sensor govern
        const ts = this.tileSize;
        const centerTx = Math.floor(body.x / ts);
        const footTy = Math.floor(footY / ts);
        if (this._getTile(centerTx, footTy) > 0 || this._getTile(centerTx, footTy - 1) > 0 || this._getTile(centerTx, footTy + 1) > 0) {
            return null;
        }

        const footInset = 4;
        const leftX = body.x - body.halfW + footInset;
        const rightX = body.x + body.halfW - footInset;

        const leftLedge = this._findFlatLedgeAt(leftX, footY, maxDist);
        const rightLedge = this._findFlatLedgeAt(rightX, footY, maxDist);

        if (leftLedge !== null && rightLedge !== null) {
            return Math.min(leftLedge, rightLedge);
        }
        return leftLedge !== null ? leftLedge : rightLedge;
    }

    /**
     * Checks if there is a bridge (-2) top surface at (sensorX, sensorY) within maxDist.
     */
    _findBridgeLedgeAt(sensorX, sensorY, maxDist) {
        const ts = this.tileSize;
        const tx = Math.floor(sensorX / ts);
        const ty = Math.floor(sensorY / ts);
        const tile = this._getTile(tx, ty);

        if (tile === -2 && this._getTile(tx, ty - 1) === 0) {
            const surfY = ty * ts;
            if (Math.abs(sensorY - surfY) <= maxDist) {
                return surfY;
            }
        }
        if (tile === 0 && this._getTile(tx, ty + 1) === -2) {
            const surfY = (ty + 1) * ts;
            if (Math.abs(sensorY - surfY) <= maxDist) return surfY;
        }
        return null;
    }

    /**
     * Checks if there is a flat solid (-1) or bridge (-2) top surface at (sensorX, sensorY)
     * that is NOT a foundation tile underneath a slope or vertical wall.
     */
    _findFlatLedgeAt(sensorX, sensorY, maxDist) {
        const ts = this.tileSize;
        const tx = Math.floor(sensorX / ts);
        const ty = Math.floor(sensorY / ts);
        const tile = this._getTile(tx, ty);

        if (tile === -1 || tile === -2) {
            // Only treat as a walkable ledge top if the tile above is empty air (0)
            if (this._getTile(tx, ty - 1) === 0) {
                const surfY = ty * ts;
                if (Math.abs(sensorY - surfY) <= maxDist) return surfY;
            }
        }
        if (tile === 0 || tile === -2) {
            const below = this._getTile(tx, ty + 1);
            if ((below === -1 || below === -2) && this._getTile(tx, ty) === 0) {
                const surfY = (ty + 1) * ts;
                if (Math.abs(sensorY - surfY) <= maxDist) return surfY;
            }
        }
        return null;
    }

    /**
     * Test if a point hits a solid rock wall/ceiling (-1).
     * Timber bridges (-2) are pass-through from below/sides so players never get slammed downward on bridges.
     */
    _testWallPoint(px, py) {
        const ts = this.tileSize;
        const tx = Math.floor(px / ts);
        const ty = Math.floor(py / ts);
        return this._getTile(tx, ty) === -1;
    }

    /**
     * Wall collision: sensors at body CENTER height AND upper shoulder height (halfH - 4).
     * Checking upper shoulder against solid rock (-1) prevents walking the head sideways into an
     * overhang and getting pushed downward by ceiling collision!
     */
    _collidesWall(body) {
        const cy = body.y;
        if (this._testPoint(body.x - body.halfW, cy)) return true;
        if (this._testPoint(body.x + body.halfW - 0.01, cy)) return true;

        const upperY = body.y - body.halfH + 4;
        if (this._testWallPoint(body.x - body.halfW, upperY)) return true;
        if (this._testWallPoint(body.x + body.halfW - 0.01, upperY)) return true;

        return false;
    }

    /**
     * Ceiling collision: bevelled sensors at head checking solid rock (-1).
     * Inset by 6px inside the upper wall sensors so grazing a vertical wall while jumping up
     * never triggers a false ceiling hit!
     */
    _testCeiling(body) {
        const headY = body.y - body.halfH;
        const inset = Math.max(10, body.halfW - 6);
        const sensorL = body.x - inset;
        const sensorR = body.x + inset;

        if (this._testWallPoint(body.x, headY)) return true;
        if (this._testWallPoint(sensorL, headY)) return true;
        if (this._testWallPoint(sensorR, headY)) return true;

        return false;
    }

    /**
     * Get slope gradient (dy/dx) at world position.
     * Returns: -1 for 45° ascending right, +1 for descending right, 0 for flat.
     */
    _getSlopeGradient(x, footY) {
        const ts = this.tileSize;
        const tx = Math.floor(x / ts);
        const ty = Math.floor(footY / ts);
        const lx = Math.floor(x - tx * ts);

        // Direct slope tile
        const tile = this._getTile(tx, ty);
        if (tile > 0) {
            const h = this.slopeHeights.get(tile);
            if (h) {
                const i = Math.max(1, Math.min(ts - 2, lx));
                return (h[i + 1] - h[i - 1]) / 2;
            }
        }
        // Regress: slope in tile above
        const above = this._getTile(tx, ty - 1);
        if (above > 0) {
            const h = this.slopeHeights.get(above);
            if (h) {
                const i = Math.max(1, Math.min(ts - 2, lx));
                return (h[i + 1] - h[i - 1]) / 2;
            }
        }
        return 0;
    }

    /**
     * Check if the ground surface at (x, surfaceY) belongs to a slope tile.
     */
    _isSlopeTileAt(x, surfaceY) {
        const ts = this.tileSize;
        const tx = Math.floor(x / ts);
        const ty = Math.floor(surfaceY / ts);
        // Check current row and row above (regress case)
        return this._getTile(tx, ty) > 0 || this._getTile(tx, ty - 1) > 0;
    }

    // ==========================================
    // PIXEL-STEPPING MOVEMENT
    // ==========================================

    /**
     * Move body horizontally one pixel at a time.
     * Wall: Sonic center push sensors.
     * Ground follow: dual-foot + center ground sensor with SNAP_DOWN tolerance.
     */
    _pixelMoveX(body, amount) {
        if (amount === 0) return;
        const sign = amount > 0 ? 1 : -1;
        const steps = Math.abs(amount);
        const wasGrounded = body.wasGrounded || body.grounded;

        for (let i = 0; i < steps; i++) {
            const oldY = body.y;
            body.x += sign;

            // Wall check: sensors at body center
            if (this._collidesWall(body)) {
                body.x -= sign;
                body.vx = 0;
                return;
            }

            // Ground follow: only when grounded and not jumping (vy >= 0)
            if (wasGrounded && body.vy >= 0) {
                const footY = body.y + body.halfH;
                const ground = this._findBodyGround(body, footY, this.SNAP_DOWN);
                if (ground !== null) {
                    body.y = ground - body.halfH;
                    body.grounded = true;
                    body.vy = 0;
                    body.onSlope = this._isSlopeTileAt(body.x, ground);

                    // Recheck wall after y changed (ground follow may push into wall)
                    if (this._collidesWall(body)) {
                        body.x -= sign;
                        body.y = oldY;
                        body.vx = 0;
                        return;
                    }
                } else {
                    body.grounded = false;
                    body.onSlope = false;
                }
            } else {
                // Airborne upward slope glide: ONLY if center foot is directly inside a slope tile at (tx, ty)
                const footY = body.y + body.halfH;
                const ts = this.tileSize;
                const tx = Math.floor(body.x / ts);
                const ty = Math.floor((footY - 1) / ts);
                const tile = this._getTile(tx, ty);
                if (tile > 0) {
                    const h = this.slopeHeights.get(tile);
                    if (h) {
                        const localX = Math.max(0, Math.min(ts - 1, body.x - tx * ts));
                        const slopeY = ty * ts + this._sampleHeight(h, localX);
                        if (footY > slopeY && footY - slopeY <= 12) {
                            body.y = slopeY - body.halfH;
                            if (this._collidesWall(body) || this._testCeiling(body)) {
                                body.x -= sign;
                                body.y = oldY;
                                body.vx = 0;
                                return;
                            }
                            if (body.vy > 0) {
                                body.grounded = true;
                                body.onSlope = true;
                                body.vy = 0;
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * Move body vertically one pixel at a time.
     * Falling (sign>0): ground sensor catches slopes, bridges, AND solid ledges.
     * Jumping (sign<0): ceiling sensor checks solid tiles and bridge beams.
     */
    _pixelMoveY(body, amount) {
        if (amount === 0) return;
        const sign = amount > 0 ? 1 : -1;
        const steps = Math.abs(amount);

        for (let i = 0; i < steps; i++) {
            body.y += sign;

            if (sign > 0) {
                const footY = body.y + body.halfH;
                const ground = this._findBodyGround(body, footY, 5);
                if (ground !== null && footY >= ground) {
                    body.y = ground - body.halfH;
                    body.grounded = true;
                    body.vy = 0;
                    body.onSlope = this._isSlopeTileAt(body.x, ground);
                    return;
                }
                if (this._testPoint(body.x, footY)) {
                    body.y -= sign;
                    body.grounded = true;
                    body.vy = 0;
                    body.onSlope = this._isSlopeTileAt(body.x, body.y + body.halfH);
                    return;
                }
            } else {
                if (this._testCeiling(body)) {
                    body.y -= sign;
                    body.vy = 0;
                    return;
                }
            }
        }

        if (sign > 0) {
            body.grounded = false;
            body.onSlope = false;
        }
    }

    // ==========================================
    // TILE QUERIES
    // ==========================================

    _getTile(tx, ty) {
        if (ty < 0 || ty >= this.gridHeight) return 0;
        if (tx < 0 || tx >= this.gridWidth) return 0;
        return this.tileGrid[ty]?.[tx] || 0;
    }

    /**
     * Tile-level solid check (backward compat for GameScene spawn logic).
     * Returns true if tile is solid (-1), bridge (-2), or slope (>0).
     */
    _isSolid(tx, ty) {
        const tile = this._getTile(tx, ty);
        return tile === -1 || tile === -2 || tile > 0;
    }

    _getSlopeHeights(tx, ty) {
        const tileId = this._getTile(tx, ty);
        if (tileId > 0) return this.slopeHeights.get(tileId) || null;
        return null;
    }

    // ==========================================
    // GROUNDED CHECK (Sonic-style foot sensor)
    // ==========================================

    isGrounded(body) {
        if (body.vy < -10) return false;
        const footY = body.y + body.halfH + 1;
        const ground = this._findBodyGround(body, footY, 5);
        return ground !== null && Math.abs(footY - ground) <= 5;
    }

    // ==========================================
    // RAYCAST (Sub-Tile Exact Surface Raymarch)
    // ==========================================

    /**
     * Exact sub-tile raycast using _testPoint (respects 45° slope diagonals
     * and 26px timber bridge slabs so hooks never attach to empty air!).
     */
    raycast(x1, y1, x2, y2) {
        const dirX = x2 - x1;
        const dirY = y2 - y1;
        const len = Math.hypot(dirX, dirY);
        if (len < 0.5) return null;

        const normX = dirX / len;
        const normY = dirY / len;
        const step = 4; // 4px step + 4-step binary refinement = 0.25px accuracy
        const numSteps = Math.ceil(len / step);

        // If the start point is already touching a slope/surface, wait until ray enters air
        let enteredAir = !this._testPoint(x1, y1, true);
        let prevX = x1;
        let prevY = y1;

        for (let i = 1; i <= numSteps; i++) {
            const d = Math.min(len, i * step);
            const rx = x1 + normX * d;
            const ry = y1 + normY * d;
            const hit = this._testPoint(rx, ry, true);

            if (!enteredAir) {
                if (!hit) {
                    enteredAir = true;
                }
                prevX = rx;
                prevY = ry;
                continue;
            }

            if (hit) {
                // Binary search between free (prevX, prevY) and solid (rx, ry) for exact surface hit
                let ax = prevX, ay = prevY;
                let bx = rx, by = ry;
                for (let b = 0; b < 4; b++) {
                    const mx = (ax + bx) * 0.5;
                    const my = (ay + by) * 0.5;
                    if (this._testPoint(mx, my, true)) {
                        bx = mx;
                        by = my;
                    } else {
                        ax = mx;
                        ay = my;
                    }
                }
                return {
                    hit: true,
                    x: Math.round(bx * 10) / 10,
                    y: Math.round(by * 10) / 10,
                    tileX: Math.floor(bx / this.tileSize),
                    tileY: Math.floor(by / this.tileSize)
                };
            }

            prevX = rx;
            prevY = ry;
        }

        return null;
    }

    // ==========================================
    // DEBUG
    // ==========================================

    debugDraw(graphics) {
        graphics.lineStyle(1, 0xff0000, 0.3);

        for (let ty = 0; ty < this.gridHeight; ty++) {
            for (let tx = 0; tx < this.gridWidth; tx++) {
                const val = this._getTile(tx, ty);
                if (val === -1) {
                    graphics.strokeRect(
                        tx * this.tileSize,
                        ty * this.tileSize,
                        this.tileSize,
                        this.tileSize
                    );
                } else if (val > 0) {
                    const heights = this.slopeHeights.get(val);
                    if (heights) {
                        graphics.lineStyle(2, 0x00ff00, 0.5);
                        const wx = tx * this.tileSize;
                        const wy = ty * this.tileSize;
                        for (let lx = 0; lx < this.tileSize - 1; lx++) {
                            graphics.lineBetween(
                                wx + lx, wy + heights[lx],
                                wx + lx + 1, wy + heights[lx + 1]
                            );
                        }
                        graphics.lineStyle(1, 0xff0000, 0.3);
                    }
                }
            }
        }
    }
}

/**
 * @typedef {Object} SimpleBody
 * @property {string} id
 * @property {number} x - позиция X (центр)
 * @property {number} y - позиция Y (центр)
 * @property {number} vx - скорость X (px/s)
 * @property {number} vy - скорость Y (px/s)
 * @property {number} halfW - половина ширины коллайдера
 * @property {number} halfH - половина высоты коллайдера
 * @property {boolean} grounded - на земле?
 * @property {boolean} wasGrounded - был на земле в прошлом кадре?
 * @property {boolean} onSlope - на наклонной поверхности?
 * @property {number} gravityScale - множитель гравитации
 * @property {number} remainderX - sub-pixel remainder X
 * @property {number} remainderY - sub-pixel remainder Y
 */
