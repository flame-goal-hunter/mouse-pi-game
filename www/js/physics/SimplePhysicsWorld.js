/**
 * SimplePhysicsWorld v28
 * Детерминированная физика для идеальной сетевой синхронизации
 * Заменяет Rapier2D на простую AABB collision vs tilemap
 */
export class SimplePhysicsWorld {
    constructor(tileSize = 70) {
        this.tileSize = tileSize;
        this.solidGrid = null;  // boolean[][]
        this.bodies = new Map();
        this.GRAVITY = 1200;    // px/s² (from config.js PHYS.GRAVITY)
        this.gridWidth = 0;
        this.gridHeight = 0;
    }

    /**
     * Инициализация из Phaser tilemap
     * @param {Phaser.Tilemaps.TilemapLayer} platformLayer
     */
    initFromTilemap(platformLayer) {
        const { width, height } = platformLayer.layer;
        this.gridWidth = width;
        this.gridHeight = height;
        this.solidGrid = [];

        let solidCount = 0;
        let collidesTrueCount = 0;
        let hasIndexCount = 0;

        for (let y = 0; y < height; y++) {
            this.solidGrid[y] = [];
            for (let x = 0; x < width; x++) {
                const tile = platformLayer.getTileAt(x, y);
                // Check both collides property AND tile index > 0
                // Some Phaser versions don't set collides correctly
                const isSolid = tile ? (tile.collides === true || (tile.index > 0 && tile.collides !== false)) : false;
                this.solidGrid[y][x] = isSolid;

                if (tile) {
                    hasIndexCount++;
                    if (tile.collides === true) collidesTrueCount++;
                    if (isSolid) solidCount++;
                }
            }
        }

        console.log(`[SimplePhysicsWorld] Initialized ${width}x${height} grid, tileSize=${this.tileSize}`,
            `tiles=${hasIndexCount}, collides=${collidesTrueCount}, solid=${solidCount}`);
    }

    /**
     * Создать тело
     * @param {string} id - уникальный идентификатор
     * @param {number} x - позиция X (центр)
     * @param {number} y - позиция Y (центр)
     * @param {number} halfW - половина ширины коллайдера
     * @param {number} halfH - половина высоты коллайдера
     * @param {number} gravityScale - множитель гравитации (1.0 по умолчанию)
     * @returns {SimpleBody}
     */
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
            // Для совместимости с CharacterCore
            wasGrounded: false
        };
        this.bodies.set(id, body);
        return body;
    }

    /**
     * Удалить тело
     * @param {string} id
     */
    removeBody(id) {
        this.bodies.delete(id);
    }

    /**
     * Получить тело по ID
     * @param {string} id
     * @returns {SimpleBody|undefined}
     */
    getBody(id) {
        return this.bodies.get(id);
    }

    /**
     * Один шаг физики
     * @param {number} dt - время в секундах (обычно 1/60)
     */
    step(dt) {
        if (!this._loggedStep && this.bodies.size > 0) {
            console.log('[SimplePhysicsWorld] First step with', this.bodies.size, 'bodies, solidGrid:', !!this.solidGrid);
            this._loggedStep = true;
        }
        for (const body of this.bodies.values()) {
            body.wasGrounded = body.grounded;

            // 1. Gravity
            body.vy += this.GRAVITY * body.gravityScale * dt;

            // 2. Integrate position
            body.x += body.vx * dt;
            body.y += body.vy * dt;

            // 3. Resolve collisions
            this._resolveCollisions(body);

            // 4. Quantize for determinism
            this._quantize(body);
        }
    }

    /**
     * Разрешение коллизий AABB vs tilemap
     * @param {SimpleBody} body
     */
    _resolveCollisions(body) {
        const { halfW, halfH } = body;

        // Tile coordinates covered by body
        const left = Math.floor((body.x - halfW) / this.tileSize);
        const right = Math.floor((body.x + halfW - 0.01) / this.tileSize);
        const top = Math.floor((body.y - halfH) / this.tileSize);
        const bottom = Math.floor((body.y + halfH - 0.01) / this.tileSize);

        body.grounded = false;

        // Iterate through potentially colliding tiles
        for (let ty = top; ty <= bottom; ty++) {
            for (let tx = left; tx <= right; tx++) {
                if (!this._isSolid(tx, ty)) continue;

                // Tile AABB (pixel coordinates)
                const tileL = tx * this.tileSize;
                const tileR = (tx + 1) * this.tileSize;
                const tileT = ty * this.tileSize;
                const tileB = (ty + 1) * this.tileSize;

                // Body AABB
                const bodyL = body.x - halfW;
                const bodyR = body.x + halfW;
                const bodyT = body.y - halfH;
                const bodyB = body.y + halfH;

                // Calculate overlap
                const overlapL = bodyR - tileL;
                const overlapR = tileR - bodyL;
                const overlapT = bodyB - tileT;
                const overlapB = tileB - bodyT;

                // Find minimum overlap (penetration depth)
                const overlapX = Math.min(overlapL, overlapR);
                const overlapY = Math.min(overlapT, overlapB);

                if (overlapX > 0 && overlapY > 0) {
                    // Push out along smallest axis
                    if (overlapX < overlapY) {
                        // Horizontal push
                        if (overlapL < overlapR) {
                            // Push left (body was moving right)
                            body.x -= overlapL;
                            if (body.vx > 0) body.vx = 0;
                        } else {
                            // Push right (body was moving left)
                            body.x += overlapR;
                            if (body.vx < 0) body.vx = 0;
                        }
                    } else {
                        // Vertical push
                        if (overlapT < overlapB) {
                            // Push up (body was moving down) - landing
                            body.y -= overlapT;
                            if (body.vy > 0) body.vy = 0;
                            body.grounded = true;
                        } else {
                            // Push down (body was moving up) - hit ceiling
                            body.y += overlapB;
                            if (body.vy < 0) body.vy = 0;
                        }
                    }
                }
            }
        }
    }

    /**
     * Проверка солидности тайла
     * @param {number} tx - тайловая координата X
     * @param {number} ty - тайловая координата Y
     * @returns {boolean}
     */
    _isSolid(tx, ty) {
        if (ty < 0 || ty >= this.gridHeight) return false;
        if (tx < 0 || tx >= this.gridWidth) return false;
        return this.solidGrid[ty][tx];
    }

    /**
     * Квантизация для детерминизма
     * @param {SimpleBody} body
     */
    _quantize(body) {
        // Квантизация до 0.01px для cross-platform determinism
        body.x = Math.round(body.x * 100) / 100;
        body.y = Math.round(body.y * 100) / 100;
        body.vx = Math.round(body.vx * 100) / 100;
        body.vy = Math.round(body.vy * 100) / 100;
    }

    /**
     * Проверка grounded (для прыжков)
     * Проверяет 1px ниже тела
     * @param {SimpleBody} body
     * @returns {boolean}
     */
    isGrounded(body) {
        // Проверить 1px ниже
        const testY = body.y + body.halfH + 1;
        const left = Math.floor((body.x - body.halfW * 0.9) / this.tileSize);
        const right = Math.floor((body.x + body.halfW * 0.9) / this.tileSize);
        const ty = Math.floor(testY / this.tileSize);

        for (let tx = left; tx <= right; tx++) {
            if (this._isSolid(tx, ty)) return true;
        }
        return false;
    }

    /**
     * Raycast для hook
     * Использует Bresenham line algorithm
     * @param {number} x1 - начало X
     * @param {number} y1 - начало Y
     * @param {number} x2 - конец X
     * @param {number} y2 - конец Y
     * @returns {{hit: boolean, x: number, y: number, tileX: number, tileY: number}|null}
     */
    raycast(x1, y1, x2, y2) {
        // Convert to tile coordinates
        const startTX = Math.floor(x1 / this.tileSize);
        const startTY = Math.floor(y1 / this.tileSize);
        const endTX = Math.floor(x2 / this.tileSize);
        const endTY = Math.floor(y2 / this.tileSize);

        // Bresenham's line algorithm
        let tx = startTX;
        let ty = startTY;
        const dx = Math.abs(endTX - startTX);
        const dy = Math.abs(endTY - startTY);
        const sx = startTX < endTX ? 1 : -1;
        const sy = startTY < endTY ? 1 : -1;
        let err = dx - dy;

        // Direction vector for sub-tile precision
        const dirX = x2 - x1;
        const dirY = y2 - y1;
        const len = Math.sqrt(dirX * dirX + dirY * dirY);
        const normX = dirX / len;
        const normY = dirY / len;

        while (true) {
            // Check current tile
            if (this._isSolid(tx, ty)) {
                // Find exact hit point on tile edge
                const tileL = tx * this.tileSize;
                const tileR = (tx + 1) * this.tileSize;
                const tileT = ty * this.tileSize;
                const tileB = (ty + 1) * this.tileSize;

                // Find intersection with tile AABB
                let hitX = tx * this.tileSize + this.tileSize / 2;
                let hitY = ty * this.tileSize + this.tileSize / 2;

                // Better hit point calculation - trace back to tile edge
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
                            // Check if this is closer
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

            // Reached end?
            if (tx === endTX && ty === endTY) break;

            // Step to next tile
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

        return null; // No hit
    }

    /**
     * Для отладки - визуализация grid
     * @param {Phaser.GameObjects.Graphics} graphics
     */
    debugDraw(graphics) {
        graphics.lineStyle(1, 0xff0000, 0.3);

        for (let ty = 0; ty < this.gridHeight; ty++) {
            for (let tx = 0; tx < this.gridWidth; tx++) {
                if (this.solidGrid[ty][tx]) {
                    graphics.strokeRect(
                        tx * this.tileSize,
                        ty * this.tileSize,
                        this.tileSize,
                        this.tileSize
                    );
                }
            }
        }
    }
}

/**
 * @typedef {Object} SimpleBody
 * @property {string} id - уникальный идентификатор
 * @property {number} x - позиция X (центр)
 * @property {number} y - позиция Y (центр)
 * @property {number} vx - скорость X (px/s)
 * @property {number} vy - скорость Y (px/s)
 * @property {number} halfW - половина ширины коллайдера
 * @property {number} halfH - половина высоты коллайдера
 * @property {boolean} grounded - на земле?
 * @property {boolean} wasGrounded - был на земле в прошлом кадре?
 * @property {number} gravityScale - множитель гравитации
 */
