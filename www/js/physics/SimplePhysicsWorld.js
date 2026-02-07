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
        // Center in solid: always resolve immediately
        if (this._testPoint(body.x, body.y)) {
            const footY = body.y + body.halfH;
            const ground = this._findGroundAt(body.x, footY, this.tileSize);
            if (ground !== null) {
                body.y = ground - body.halfH;
                body.vy = 0;
            }
            return;
        }

        // Feet check: only resolve if significantly embedded (>2px below surface)
        const footY = body.y + body.halfH;
        const ground = this._findGroundAt(body.x, footY, this.tileSize);
        if (ground !== null && footY - ground > 2) {
            body.y = ground - body.halfH;
            body.vy = 0;
        }
    }

    step(dt) {
        if (!this._loggedStep && this.bodies.size > 0) {
            console.log('[SimplePhysicsWorld] v34.4 First step with', this.bodies.size, 'bodies, tileGrid:', !!this.tileGrid);
            this._loggedStep = true;
        }
        for (const body of this.bodies.values()) {
            this._resolveOverlap(body);
            body.wasGrounded = body.grounded;

            // 1. Gravity
            body.vy += this.GRAVITY * body.gravityScale * dt;

            // 2. Sub-pixel remainder
            body.remainderX += body.vx * dt;
            body.remainderY += body.vy * dt;

            // 3. Whole pixel movement
            const moveX = Math.round(body.remainderX);
            const moveY = Math.round(body.remainderY);
            body.remainderX -= moveX;
            body.remainderY -= moveY;

            // 4. Move each axis, one pixel at a time
            this._pixelMoveX(body, moveX);
            this._pixelMoveY(body, moveY);

            // 5. Slope gravity: project gravity onto slope surface
            if (body.grounded && body.onSlope) {
                const gradient = this._getSlopeGradient(body.x, body.y + body.halfH);
                if (gradient !== 0) {
                    const sinTheta = gradient / Math.sqrt(1 + gradient * gradient);
                    body.vx += this.GRAVITY * this.SLOPE_FACTOR * sinTheta * body.gravityScale * dt;
                }
            }

            // 6. Quantize for determinism
            body.vx = Math.round(body.vx * 100) / 100;
            body.vy = Math.round(body.vy * 100) / 100;
        }
    }

    // ==========================================
    // SONIC-INSPIRED SENSOR SYSTEM
    // ==========================================

    /**
     * Test if a world-space point is inside solid geometry.
     * Solid = full solid tile (-1) OR below a slope surface.
     * Analog of Teeworlds CheckPoint + Sonic sensor.
     */
    _testPoint(px, py) {
        const ts = this.tileSize;
        const tx = Math.floor(px / ts);
        const ty = Math.floor(py / ts);
        const tile = this._getTile(tx, ty);
        if (tile === -1) return true;
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
     * - Solid tile (-1): regress — check tile ABOVE for slope (more precise surface)
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

        // Solid tile: regress — check slope in tile ABOVE first (Sonic rule)
        if (tile === -1) {
            const above = this._getTile(tx, ty - 1);
            if (above > 0) {
                const h = this.slopeHeights.get(above);
                if (h) {
                    const surfY = (ty - 1) * ts + this._sampleHeight(h, localX);
                    if (Math.abs(sensorY - surfY) <= maxDist) return surfY;
                }
            }
            // No slope above — surface is solid tile top
            const surfY = ty * ts;
            if (Math.abs(sensorY - surfY) <= maxDist) return surfY;
        }

        // Empty tile: extend — check tile BELOW for ground (Sonic rule)
        if (tile === 0) {
            const below = this._getTile(tx, ty + 1);
            if (below > 0) {
                const h = this.slopeHeights.get(below);
                if (h) {
                    const surfY = (ty + 1) * ts + this._sampleHeight(h, localX);
                    if (Math.abs(sensorY - surfY) <= maxDist) return surfY;
                }
            }
            if (below === -1) {
                const surfY = (ty + 1) * ts;
                if (Math.abs(sensorY - surfY) <= maxDist) return surfY;
            }
        }

        return null;
    }

    /**
     * Wall collision: 2 sensors at body CENTER height (Sonic push sensors).
     * Center-height sensors naturally avoid structural tiles next to slopes
     * because at center height, those tiles are slope tiles (not solid).
     */
    _collidesWall(body) {
        const cy = body.y;
        if (this._testPoint(body.x - body.halfW, cy)) return true;
        if (this._testPoint(body.x + body.halfW - 0.01, cy)) return true;
        return false;
    }

    /**
     * Ceiling collision: 2 sensors at head, ONLY solid tiles (-1).
     * Slopes are transparent to upward movement.
     */
    _testCeiling(body) {
        const ts = this.tileSize;
        const headY = body.y - body.halfH;
        const sensorL = body.x - body.halfW * 0.8;
        const sensorR = body.x + body.halfW * 0.8;

        const tyL = Math.floor(headY / ts);
        const txL = Math.floor(sensorL / ts);
        if (this._getTile(txL, tyL) === -1) return true;

        const txR = Math.floor(sensorR / ts);
        if (this._getTile(txR, tyL) === -1) return true;

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
     * Wall: sensor at body center (Sonic push sensors).
     * Ground follow: sensor at feet with SNAP_DOWN tolerance.
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
                const ground = this._findGroundAt(body.x, footY, this.SNAP_DOWN);
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
                    body.onSlope = false;
                }
            }
        }
    }

    /**
     * Move body vertically one pixel at a time.
     * Falling (sign>0): ground sensor catches slopes AND solids.
     * Jumping (sign<0): ceiling sensor checks ONLY solid tiles.
     */
    _pixelMoveY(body, amount) {
        if (amount === 0) return;
        const sign = amount > 0 ? 1 : -1;
        const steps = Math.abs(amount);

        for (let i = 0; i < steps; i++) {
            body.y += sign;

            if (sign > 0) {
                // Falling: ground sensor
                const footY = body.y + body.halfH;
                const ground = this._findGroundAt(body.x, footY, 3);
                if (ground !== null && footY >= ground) {
                    body.y = ground - body.halfH;
                    body.grounded = true;
                    body.vy = 0;
                    body.onSlope = this._isSlopeTileAt(body.x, ground);
                    return;
                }
                // Safety net: foot inside solid but _findGroundAt missed
                if (this._testPoint(body.x, footY)) {
                    body.y -= sign;
                    body.grounded = true;
                    body.vy = 0;
                    return;
                }
            } else {
                // Jumping: ceiling check (ONLY solid tiles at head)
                if (this._testCeiling(body)) {
                    body.y -= sign;
                    body.vy = 0;
                    return;
                }
            }
        }

        if (sign > 0) body.grounded = false;
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
     * Returns true if tile is solid (-1) or slope (>0).
     */
    _isSolid(tx, ty) {
        const tile = this._getTile(tx, ty);
        return tile === -1 || tile > 0;
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
        const footY = body.y + body.halfH + 1;
        const ground = this._findGroundAt(body.x, footY, 3);
        return ground !== null && Math.abs(footY - ground) < 3;
    }

    // ==========================================
    // RAYCAST
    // ==========================================

    raycast(x1, y1, x2, y2) {
        const startTX = Math.floor(x1 / this.tileSize);
        const startTY = Math.floor(y1 / this.tileSize);
        const endTX = Math.floor(x2 / this.tileSize);
        const endTY = Math.floor(y2 / this.tileSize);

        let tx = startTX;
        let ty = startTY;
        const dx = Math.abs(endTX - startTX);
        const dy = Math.abs(endTY - startTY);
        const sx = startTX < endTX ? 1 : -1;
        const sy = startTY < endTY ? 1 : -1;
        let err = dx - dy;

        const dirX = x2 - x1;
        const dirY = y2 - y1;
        const len = Math.sqrt(dirX * dirX + dirY * dirY);
        const normX = dirX / len;
        const normY = dirY / len;

        while (true) {
            if (this._testPoint(tx * this.tileSize + this.tileSize / 2, ty * this.tileSize + this.tileSize / 2)) {
                const tileL = tx * this.tileSize;
                const tileR = (tx + 1) * this.tileSize;
                const tileT = ty * this.tileSize;
                const tileB = (ty + 1) * this.tileSize;

                let hitX = tx * this.tileSize + this.tileSize / 2;
                let hitY = ty * this.tileSize + this.tileSize / 2;

                if (normX !== 0) {
                    const tEdge = normX > 0 ? tileL : tileR;
                    const t = (tEdge - x1) / normX;
                    if (t > 0) {
                        const testY = y1 + normY * t;
                        if (testY >= tileT && testY <= tileB) {
                            hitX = tEdge;
                            hitY = testY;
                        }
                    }
                }
                if (normY !== 0) {
                    const tEdge = normY > 0 ? tileT : tileB;
                    const t = (tEdge - y1) / normY;
                    if (t > 0) {
                        const testX = x1 + normX * t;
                        if (testX >= tileL && testX <= tileR) {
                            const distX = hitX - x1;
                            const distY = hitY - y1;
                            const distNew = Math.abs(t);
                            const distOld = Math.sqrt(distX * distX + distY * distY);
                            if (distNew < distOld) {
                                hitX = testX;
                                hitY = tEdge;
                            }
                        }
                    }
                }

                return {
                    hit: true,
                    x: hitX,
                    y: hitY,
                    tileX: tx,
                    tileY: ty
                };
            }

            if (tx === endTX && ty === endTY) break;

            const e2 = 2 * err;
            if (e2 > -dy) {
                err -= dy;
                tx += sx;
            }
            if (e2 < dx) {
                err += dx;
                ty += sy;
            }
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
