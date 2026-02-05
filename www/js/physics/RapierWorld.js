// ============================================
// RAPIER WORLD - Rapier2D Physics Wrapper
// ============================================
// Wraps Rapier2D WASM physics for the game.
// Handles body creation, tilemap collision, stepping.

import { PHYS, TILE_SIZE } from '../config.js';

export class RapierWorld {
    constructor(gravity) {
        const RAPIER = window.RAPIER;
        if (!RAPIER) throw new Error('RAPIER not initialized — call RAPIER.init() first');
        this.RAPIER = RAPIER;
        this.world = new RAPIER.World({ x: 0, y: gravity });
        this.eventQueue = new RAPIER.EventQueue(true);

        // Collision mapping: collider handle → { label, sprite, body }
        this.colliderData = new Map();
        // Body → collider handle (for reverse lookup)
        this.bodyToCollider = new Map();
    }

    // =============================================
    // TILEMAP CONVERSION
    // =============================================

    /**
     * Convert Phaser tilemap layer to Rapier static colliders.
     * Tiles with polygon collision (from Tiled) get convexHull colliders.
     * Regular solid tiles are merged into rectangles (cuboid) to reduce body count.
     */
    createTilemapColliders(platformLayer, tileSize) {
        if (!platformLayer) return;

        const width = platformLayer.layer.width;
        const height = platformLayer.layer.height;

        // 1. Extract per-tile polygon data from Tiled tileset
        const tilePolygons = new Map(); // gid → [{x,y}]
        const tilesets = platformLayer.layer.tilemapLayer.tilemap.tilesets;
        for (const ts of tilesets) {
            if (ts.tileData) {
                for (const [localIdStr, tileInfo] of Object.entries(ts.tileData)) {
                    const gid = ts.firstgid + parseInt(localIdStr);
                    if (tileInfo.objectgroup?.objects) {
                        for (const obj of tileInfo.objectgroup.objects) {
                            if (obj.polygon) {
                                tilePolygons.set(gid, obj.polygon.map(p => ({
                                    x: (obj.x || 0) + p.x,
                                    y: (obj.y || 0) + p.y
                                })));
                            }
                        }
                    }
                }
            }
        }

        // 2. Scan tiles: polygon tiles get individual colliders, regular tiles go to merge grid
        const solid = Array.from({ length: height }, () => new Uint8Array(width));
        let polyCount = 0;

        for (let ty = 0; ty < height; ty++) {
            for (let tx = 0; tx < width; tx++) {
                const tile = platformLayer.getTileAt(tx, ty);
                if (!tile || tile.index <= 0) continue;

                if (tilePolygons.has(tile.index)) {
                    // Create convexHull collider for this tile
                    const poly = tilePolygons.get(tile.index);
                    const worldX = tx * tileSize;
                    const worldY = ty * tileSize;

                    const points = new Float32Array(poly.length * 2);
                    for (let i = 0; i < poly.length; i++) {
                        points[i * 2] = worldX + poly[i].x;
                        points[i * 2 + 1] = worldY + poly[i].y;
                    }

                    const bodyDesc = this.RAPIER.RigidBodyDesc.fixed()
                        .setTranslation(0, 0);
                    const body = this.world.createRigidBody(bodyDesc);

                    const colliderDesc = this.RAPIER.ColliderDesc.convexHull(points);
                    if (colliderDesc) {
                        colliderDesc.setFriction(0.4).setRestitution(0.0);
                        const collider = this.world.createCollider(colliderDesc, body);
                        this.colliderData.set(collider.handle, { label: 'platform', sprite: null, body });
                        polyCount++;
                    }
                } else {
                    solid[ty][tx] = 1;
                }
            }
        }

        // 3. Greedy rectangle merge for regular tiles (row-major)
        const visited = Array.from({ length: height }, () => new Uint8Array(width));
        const rects = [];

        for (let ty = 0; ty < height; ty++) {
            for (let tx = 0; tx < width; tx++) {
                if (!solid[ty][tx] || visited[ty][tx]) continue;

                // Expand right
                let w = 1;
                while (tx + w < width && solid[ty][tx + w] && !visited[ty][tx + w]) w++;

                // Expand down
                let h = 1;
                outer: while (ty + h < height) {
                    for (let x = tx; x < tx + w; x++) {
                        if (!solid[ty + h][x] || visited[ty + h][x]) break outer;
                    }
                    h++;
                }

                // Mark visited
                for (let y = ty; y < ty + h; y++) {
                    for (let x = tx; x < tx + w; x++) {
                        visited[y][x] = 1;
                    }
                }

                rects.push({ tx, ty, w, h });
            }
        }

        // 4. Create Rapier bodies for merged rectangles
        for (const rect of rects) {
            const cx = (rect.tx + rect.w / 2) * tileSize;
            const cy = (rect.ty + rect.h / 2) * tileSize;
            const halfW = (rect.w * tileSize) / 2;
            const halfH = (rect.h * tileSize) / 2;

            const bodyDesc = this.RAPIER.RigidBodyDesc.fixed()
                .setTranslation(cx, cy);
            const body = this.world.createRigidBody(bodyDesc);

            const colliderDesc = this.RAPIER.ColliderDesc.cuboid(halfW, halfH)
                .setFriction(0.4)
                .setRestitution(0.0);
            const collider = this.world.createCollider(colliderDesc, body);

            this.colliderData.set(collider.handle, { label: 'platform', sprite: null, body });
        }

        console.log(`RapierWorld: created ${polyCount} polygon + ${rects.length} cuboid colliders from ${width}x${height} grid`);
    }

    // =============================================
    // BODY CREATION
    // =============================================

    /**
     * Create a character physics body (dynamic, locked rotation).
     * @returns {RigidBody} Rapier rigid body
     */
    createCharacterBody(x, y, width, height, label = 'character') {
        const bodyDesc = this.RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(x, y)
            .lockRotations()
            .setLinearDamping(0.0)
            .setCcdEnabled(true);
        const body = this.world.createRigidBody(bodyDesc);

        const colliderDesc = this.RAPIER.ColliderDesc.cuboid(width / 2, height / 2)
            .setDensity(0.001)   // Low density so mass ≈ width*height*0.001 ≈ 3.0
            .setFriction(0.01)
            .setRestitution(0.0)
            .setActiveEvents(this.RAPIER.ActiveEvents.COLLISION_EVENTS);
        const collider = this.world.createCollider(colliderDesc, body);

        this.colliderData.set(collider.handle, { label, sprite: null, body });
        this.bodyToCollider.set(body.handle, collider.handle);

        return body;
    }

    /**
     * Create a snowball (dynamic circle body).
     */
    createSnowball(x, y, vx, vy, radius = 10, label = 'snowball') {
        const bodyDesc = this.RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(x, y)
            .setLinvel(vx, vy)
            .setGravityScale(PHYS.SNOWBALL_GRAVITY_SCALE * 0.3)
            .setCcdEnabled(true);
        const body = this.world.createRigidBody(bodyDesc);

        const colliderDesc = this.RAPIER.ColliderDesc.ball(radius)
            .setDensity(0.001)
            .setFriction(0.0)
            .setRestitution(PHYS.SNOWBALL_BOUNCE)
            .setActiveEvents(this.RAPIER.ActiveEvents.COLLISION_EVENTS);
        const collider = this.world.createCollider(colliderDesc, body);

        this.colliderData.set(collider.handle, { label, sprite: null, body });
        this.bodyToCollider.set(body.handle, collider.handle);

        return body;
    }

    /**
     * Create a pickup sensor (fixed, circle, no collision response).
     */
    createPickupSensor(x, y, radius = 18, label = 'pickup') {
        const bodyDesc = this.RAPIER.RigidBodyDesc.fixed()
            .setTranslation(x, y);
        const body = this.world.createRigidBody(bodyDesc);

        const colliderDesc = this.RAPIER.ColliderDesc.ball(radius)
            .setSensor(true)
            .setActiveEvents(this.RAPIER.ActiveEvents.COLLISION_EVENTS);
        const collider = this.world.createCollider(colliderDesc, body);

        this.colliderData.set(collider.handle, { label, sprite: null, body });
        this.bodyToCollider.set(body.handle, collider.handle);

        return body;
    }

    // =============================================
    // COLLISION DATA
    // =============================================

    /**
     * Associate a sprite with a body's collider (for collision lookup).
     */
    setBodySprite(body, sprite) {
        const ch = this.bodyToCollider.get(body.handle);
        if (ch !== undefined) {
            const data = this.colliderData.get(ch);
            if (data) data.sprite = sprite;
        }
    }

    /**
     * Get collision data for a collider handle.
     */
    getColliderData(handle) {
        return this.colliderData.get(handle) || null;
    }

    // =============================================
    // GROUND DETECTION (ray cast)
    // =============================================

    /**
     * Check if a character body is grounded by casting 3 short rays downward
     * (left corner, center, right corner) for proper slope detection.
     * @param {RigidBody} body - Character body
     * @param {number} halfH - Half height of character collider
     * @returns {boolean}
     */
    isGrounded(body, halfH) {
        const pos = body.translation();
        const halfW = 20; // Slightly narrower than collider (25) for accuracy

        for (const offsetX of [-halfW, 0, halfW]) {
            const ray = new this.RAPIER.Ray(
                { x: pos.x + offsetX, y: pos.y + halfH },
                { x: 0, y: 1 }
            );
            const hit = this.world.castRay(
                ray, 8, true,
                undefined, undefined, undefined,
                body
            );
            if (hit) {
                const hitData = this.colliderData.get(hit.collider.handle);
                if (hitData && hitData.label === 'platform') return true;
            }
        }
        return false;
    }

    // =============================================
    // SAFE TELEPORT (prevents embedding in tiles)
    // =============================================

    /**
     * Check if a position is free of platform collisions for a character-sized shape.
     * Uses Rapier's intersectionsWithShape query (O(log n), instant).
     */
    isPositionFree(x, y, halfW, halfH, excludeBody = null) {
        const shape = new this.RAPIER.Cuboid(halfW, halfH);
        let blocked = false;

        this.world.intersectionsWithShape(
            { x, y }, 0, shape,
            (collider) => {
                if (excludeBody) {
                    const ch = this.bodyToCollider.get(excludeBody.handle);
                    if (ch === collider.handle) return true;
                }
                const data = this.colliderData.get(collider.handle);
                if (data && data.label === 'platform') {
                    blocked = true;
                    return false;
                }
                return true;
            }
        );

        return !blocked;
    }

    /**
     * Find nearest safe position by testing offsets (up, left, right, down).
     * @returns {{ x: number, y: number } | null}
     */
    findSafePosition(x, y, halfW, halfH, excludeBody = null) {
        if (this.isPositionFree(x, y, halfW, halfH, excludeBody)) {
            return { x, y };
        }

        const offsets = [
            { x: 0, y: -halfH },
            { x: -halfW, y: 0 },
            { x: halfW, y: 0 },
            { x: 0, y: halfH },
            { x: 0, y: -halfH * 2 },
            { x: -halfW * 2, y: 0 },
            { x: halfW * 2, y: 0 },
            { x: 0, y: -halfH * 3 },
        ];

        for (const off of offsets) {
            if (this.isPositionFree(x + off.x, y + off.y, halfW, halfH, excludeBody)) {
                return { x: x + off.x, y: y + off.y };
            }
        }

        return null;
    }

    /**
     * Safely teleport a body, checking for tile overlaps first.
     * If target overlaps a platform, finds nearest safe position.
     */
    safeTeleport(body, x, y, halfW, halfH) {
        const safe = this.findSafePosition(x, y, halfW, halfH, body);
        if (safe) {
            body.setTranslation({ x: safe.x, y: safe.y }, true);
            return true;
        }
        body.setTranslation({ x, y }, true);
        return false;
    }

    // =============================================
    // SIMULATION
    // =============================================

    /**
     * Step the physics world.
     * @param {number} dt - Timestep in seconds
     */
    step(dt) {
        if (dt <= 0) return;
        this.world.timestep = dt;
        this.world.step(this.eventQueue);
    }

    /**
     * Drain collision events.
     * @param {Function} callback - (handle1, handle2, started) => void
     */
    drainCollisions(callback) {
        this.eventQueue.drainCollisionEvents(callback);
    }

    // =============================================
    // BODY MANAGEMENT
    // =============================================

    /**
     * Remove a rigid body and its colliders from the world.
     */
    removeBody(body) {
        if (!body) return;
        // Clean up maps
        const ch = this.bodyToCollider.get(body.handle);
        if (ch !== undefined) {
            this.colliderData.delete(ch);
            this.bodyToCollider.delete(body.handle);
        }
        this.world.removeRigidBody(body);
    }

    // =============================================
    // SNAPSHOT (for client prediction)
    // =============================================

    takeSnapshot() {
        return this.world.takeSnapshot();
    }

    restoreSnapshot(bytes) {
        this.world.free();
        this.world = this.RAPIER.World.restoreSnapshot(bytes);
        this.eventQueue = new this.RAPIER.EventQueue(true);
    }

    // =============================================
    // CLEANUP
    // =============================================

    destroy() {
        this.colliderData.clear();
        this.bodyToCollider.clear();
        if (this.world) {
            this.world.free();
            this.world = null;
        }
    }
}
