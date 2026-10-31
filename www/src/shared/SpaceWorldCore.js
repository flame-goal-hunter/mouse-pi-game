// ============================================================================
// SpaceWorldCore.js — Единое универсальное физическое ядро Космоса (Teeworlds-style)
// Работает идентично на сервере (Node.js) и клиенте (браузер) с шагом 50 Hz
// ============================================================================

export const FIXED_DT = 1 / 50;
export const FIELD = { cx: 0, cy: 110, hw: 295, hh: 175, goalH: 72, ballR: 32 };
export const WORLD_BOUNDS = { hw: 2150, hh: 2050 };
export const ROCKET_PHYS = { accel: 680, turboAccel: 1220, maxSpeed: 390, turboMaxSpeed: 680, friction: 0.968, turnLerp: 10.5, radius: 24 };
export const CHEESE_CLUSTERS = [
    { x: 0, y: 0, count: 6, spread: 80 }, { x: -340, y: -170, count: 5, spread: 75 },
    { x: 370, y: -210, count: 5, spread: 75 }, { x: -520, y: 260, count: 6, spread: 85 },
    { x: 510, y: 310, count: 6, spread: 85 }, { x: -860, y: -40, count: 5, spread: 80 },
    { x: 880, y: 110, count: 5, spread: 80 }, { x: 40, y: 540, count: 5, spread: 75 }
];
const PLANET_ZONES = [
    { x: -520, y: -240, r: 86 }, { x: 540, y: -240, r: 84 },
    { x: -440, y: 440, r: 82 }, { x: 460, y: 440, r: 82 }, { x: 0, y: -590, r: 74 }
];

export function shortAngleDist(from, to) {
    return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export function createPhysicsBody(opts = {}) {
    const x = Number(opts.x) || 0, y = Number(opts.y) || 0, angle = Number(opts.angle) || 0;
    return {
        id: String(opts.id || ''), type: opts.type || 'generic',
        x, y, prevX: x, prevY: y, vx: Number(opts.vx) || 0, vy: Number(opts.vy) || 0,
        angle, prevAngle: angle, radius: Number(opts.radius) || 20,
        invMass: opts.invMass ?? 1, restitution: opts.restitution ?? 0.8, drag: opts.drag ?? 0.985,
        isThrusting: Boolean(opts.isThrusting), isTurbo: Boolean(opts.isTurbo),
        errorX: 0, errorY: 0, errorAngle: 0, renderX: x, renderY: y, renderAngle: angle, rawX: x, rawY: y, rawAngle: angle,
        ...opts
    };
}

export function resolveBodyCollision(bodyA, bodyB) {
    const dx = bodyB.x - bodyA.x, dy = bodyB.y - bodyA.y;
    const dist = Math.hypot(dx, dy), minDist = bodyA.radius + bodyB.radius;
    if (dist >= minDist) return null;
    const totalInvMass = bodyA.invMass + bodyB.invMass;
    if (totalInvMass <= 0) return null;
    const nx = dist > 0.0001 ? dx / dist : 1, ny = dist > 0.0001 ? dy / dist : 0;
    const pen = (minDist - dist) + 0.5;
    bodyA.x -= nx * pen * (bodyA.invMass / totalInvMass);
    bodyA.y -= ny * pen * (bodyA.invMass / totalInvMass);
    bodyB.x += nx * pen * (bodyB.invMass / totalInvMass);
    bodyB.y += ny * pen * (bodyB.invMass / totalInvMass);

    const rvx = bodyB.vx - bodyA.vx, rvy = bodyB.vy - bodyA.vy;
    const velAlongNormal = rvx * nx + rvy * ny;
    if (velAlongNormal > 0) return null;

    const e = Math.max(bodyA.restitution ?? 0.8, bodyB.restitution ?? 0.8);
    let j = -(1 + e) * velAlongNormal / totalInvMass;
    if (bodyA.type === 'rocket' && bodyB.type === 'rocket') j = Math.max(j, 280);
    else if ((bodyA.type === 'rocket' && bodyB.type === 'ball') || (bodyA.type === 'ball' && bodyB.type === 'rocket')) {
        const r = bodyA.type === 'rocket' ? bodyA : bodyB;
        j = Math.max(j, r.isTurbo ? 340 : 220);
    } else if (bodyA.type === 'rocket' || bodyB.type === 'rocket') j = Math.max(j, 210);

    bodyA.vx -= j * bodyA.invMass * nx; bodyA.vy -= j * bodyA.invMass * ny;
    bodyB.vx += j * bodyB.invMass * nx; bodyB.vy += j * bodyB.invMass * ny;
    return { bodyA, bodyB, hitX: (bodyA.x + bodyB.x) * 0.5, hitY: (bodyA.y + bodyB.y) * 0.5, impact: j, nx, ny };
}

export function createWorldCore() {
    const world = {
        rockets: new Map(), projectiles: new Map(), cheese: new Map(), asteroids: [],
        ball: createPhysicsBody({ id: 'ball', type: 'ball', x: FIELD.cx, y: FIELD.cy, radius: FIELD.ballR, invMass: 1.55, restitution: 0.85, drag: 0.985 }),
        score: { blue: 0, pink: 0 }
    };
    for (let i = 0; i < 54; i++) {
        let x = 0, y = 0;
        for (let t = 0; t < 15; t++) {
            const a = (i / 54) * Math.PI * 4 + t * 0.4, d = 280 + (i * 37) % 1180;
            x = Math.cos(a) * d; y = Math.sin(a) * d;
            if (!PLANET_ZONES.some(p => Math.hypot(x - p.x, y - p.y) < p.r + 165)) break;
        }
        const r = 18 + (i % 4) * 6, baseVx = (i % 2 === 0 ? 1 : -1) * (12 + (i % 5) * 4), baseVy = (i % 3 === 0 ? 1 : -1) * (10 + (i % 4) * 4);
        world.asteroids.push(createPhysicsBody({ id: `ast_${i}`, idx: i, type: 'asteroid', x, y, vx: baseVx, vy: baseVy, baseVx, baseVy, angle: i, rotSpd: (i % 2 === 0 ? 1 : -1) * 0.55, radius: r, invMass: 0.16, restitution: 0.82, drag: 0.996, hitFlash: 0 }));
    }
    let cid = 1;
    CHEESE_CLUSTERS.forEach((cl, ci) => {
        for (let i = 0; i < cl.count; i++) {
            const a = (i / cl.count) * Math.PI * 2 + ci, d = 18 + (i % 3) * (cl.spread * 0.38);
            const id = cid++, x = Math.round(cl.x + Math.cos(a) * d), y = Math.round(cl.y + Math.sin(a) * d);
            world.cheese.set(id, createPhysicsBody({ id: `ch_${id}`, cid: id, type: 'cheese', x, y, homeX: x, homeY: y, radius: 14, invMass: 1.2, restitution: 0.5, drag: 0.92, phase: ci + i * 0.7, respawn: 0 }));
        }
    });
    return world;
}

export function stepWorld(world, dt = FIXED_DT, opts = {}) {
    const events = [], activeRockets = [];
    const savePrev = (b) => { b.prevX = b.x; b.prevY = b.y; b.prevAngle = b.angle; };

    for (const r of world.rockets.values()) {
        savePrev(r);
        if (r.activityStatus && r.activityStatus !== 'space') continue;
        if (r.docking) continue;
        if (typeof r.inputX === 'number' && typeof r.inputY === 'number') {
            const mag = Math.hypot(r.inputX, r.inputY);
            r.isThrusting = mag > 0.01;
            if (r.isThrusting) {
                r.angle += shortAngleDist(r.angle, Math.atan2(r.inputY, r.inputX)) * Math.min(1, ROCKET_PHYS.turnLerp * dt);
                const thrust = Math.min(1, mag) * (r.isTurbo ? ROCKET_PHYS.turboAccel : ROCKET_PHYS.accel);
                r.vx += Math.cos(r.angle) * thrust * dt; r.vy += Math.sin(r.angle) * thrust * dt;
            }
        } else if (r.isThrusting) {
            const acc = (r.isTurbo ? ROCKET_PHYS.turboAccel : ROCKET_PHYS.accel) * 0.55;
            r.vx += Math.cos(r.angle) * acc * dt; r.vy += Math.sin(r.angle) * acc * dt;
        }
        const drag = Math.pow(r.drag ?? ROCKET_PHYS.friction, dt * 60);
        r.vx *= drag; r.vy *= drag;
        const maxSpd = r.isTurbo ? ROCKET_PHYS.turboMaxSpeed : ROCKET_PHYS.maxSpeed, spd = Math.hypot(r.vx, r.vy);
        if (spd > maxSpd) { r.vx = (r.vx / spd) * maxSpd; r.vy = (r.vy / spd) * maxSpd; }
        r.x = Math.max(-WORLD_BOUNDS.hw, Math.min(WORLD_BOUNDS.hw, r.x + r.vx * dt));
        r.y = Math.max(-WORLD_BOUNDS.hh, Math.min(WORLD_BOUNDS.hh, r.y + r.vy * dt));
        activeRockets.push(r);
    }

    const b = world.ball;
    if (b) {
        savePrev(b);
        const drag = Math.pow(b.drag ?? 0.985, dt * 60);
        b.vx *= drag; b.vy *= drag;
        b.x += b.vx * dt; b.y += b.vy * dt;
        b.angle += Math.hypot(b.vx, b.vy) * 0.012 * dt;
        const minX = FIELD.cx - FIELD.hw, maxX = FIELD.cx + FIELD.hw, minY = FIELD.cy - FIELD.hh, maxY = FIELD.cy + FIELD.hh;
        if (b.y - b.radius < minY) { b.y = minY + b.radius; if (b.vy < 0) b.vy = -b.vy * 0.85; }
        if (b.y + b.radius > maxY) { b.y = maxY - b.radius; if (b.vy > 0) b.vy = -b.vy * 0.85; }
        const inGoal = Math.abs(b.y - FIELD.cy) < FIELD.goalH;
        if (b.x - b.radius < minX) {
            if (inGoal && opts.authoritativeGoals) { world.score.pink++; b.x = b.prevX = FIELD.cx; b.y = b.prevY = FIELD.cy; b.vx = b.vy = 0; events.push({ type: 'goal', team: 'pink', score: { ...world.score }, hitX: FIELD.cx, hitY: FIELD.cy }); }
            else if (!inGoal) { b.x = minX + b.radius; if (b.vx < 0) b.vx = -b.vx * 0.85; }
        } else if (b.x + b.radius > maxX) {
            if (inGoal && opts.authoritativeGoals) { world.score.blue++; b.x = b.prevX = FIELD.cx; b.y = b.prevY = FIELD.cy; b.vx = b.vy = 0; events.push({ type: 'goal', team: 'blue', score: { ...world.score }, hitX: FIELD.cx, hitY: FIELD.cy }); }
            else if (!inGoal) { b.x = maxX - b.radius; if (b.vx > 0) b.vx = -b.vx * 0.85; }
        }
    }

    for (const a of world.asteroids) {
        savePrev(a);
        a.vx += (a.baseVx - a.vx) * 2 * dt; a.vy += (a.baseVy - a.vy) * 2 * dt;
        a.x += a.vx * dt; a.y += a.vy * dt; a.angle += a.rotSpd * dt;
        if (a.hitFlash > 0) a.hitFlash = Math.max(0, a.hitFlash - dt * 4);
        if (a.x < -WORLD_BOUNDS.hw) a.x = a.prevX = WORLD_BOUNDS.hw; else if (a.x > WORLD_BOUNDS.hw) a.x = a.prevX = -WORLD_BOUNDS.hw;
        if (a.y < -WORLD_BOUNDS.hh) a.y = a.prevY = WORLD_BOUNDS.hh; else if (a.y > WORLD_BOUNDS.hh) a.y = a.prevY = -WORLD_BOUNDS.hh;
    }

    for (let i = 0; i < activeRockets.length; i++) {
        const rA = activeRockets[i];
        for (let j = i + 1; j < activeRockets.length; j++) {
            const col = resolveBodyCollision(rA, activeRockets[j]);
            if (col) events.push({ type: 'bumper_hit', ...col });
        }
        if (b) {
            const colB = resolveBodyCollision(rA, b);
            if (colB) events.push({ type: 'ball_kick', ...colB });
        }
        for (const a of world.asteroids) {
            if (Math.abs(rA.x - a.x) > 65 || Math.abs(rA.y - a.y) > 65) continue;
            const colA = resolveBodyCollision(rA, a);
            if (colA) { a.hitFlash = 1; events.push({ type: 'asteroid_bump', ...colA }); }
        }
    }

    for (const [id, pr] of world.projectiles.entries()) {
        savePrev(pr);
        pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.ttl = (pr.ttl ?? 1.35) - dt;
        let hit = false;
        if (b && Math.hypot(pr.x - b.x, pr.y - b.y) < b.radius + pr.radius) {
            resolveBodyCollision(pr, b); hit = true;
            events.push({ type: 'paint_splat', hitX: pr.x, hitY: pr.y, color: pr.color });
        }
        for (const r of activeRockets) {
            if (!hit && r.id !== pr.ownerSid && r.playerId !== pr.ownerId && Math.hypot(pr.x - r.x, pr.y - r.y) < r.radius + pr.radius) {
                resolveBodyCollision(pr, r); hit = true;
                events.push({ type: 'paint_splat', hitX: r.x, hitY: r.y, color: pr.color, targetId: r.playerId || r.id, targetSid: r.sessionId || r.id });
            }
        }
        for (const a of world.asteroids) {
            if (!hit && Math.abs(pr.x - a.x) < 45 && Math.abs(pr.y - a.y) < 45 && Math.hypot(pr.x - a.x, pr.y - a.y) < a.radius + pr.radius) {
                resolveBodyCollision(pr, a); a.hitFlash = 1; hit = true;
                events.push({ type: 'paint_splat', hitX: pr.x, hitY: pr.y, color: pr.color });
            }
        }
        if (hit || pr.ttl <= 0) world.projectiles.delete(id);
    }

    for (const ch of world.cheese.values()) {
        savePrev(ch);
        if (ch.respawn > 0) {
            if ((ch.respawn -= dt) <= 0) { ch.x = ch.prevX = ch.homeX; ch.y = ch.prevY = ch.homeY; ch.vx = ch.vy = 0; }
            continue;
        }
        let pulled = false;
        for (const r of activeRockets) {
            const dx = r.x - ch.x, dy = r.y - ch.y, d = Math.hypot(dx, dy);
            if (d < 36) {
                const hitX = ch.x, hitY = ch.y;
                ch.respawn = 14; ch.vx = ch.vy = 0; ch.x = ch.prevX = ch.homeX; ch.y = ch.prevY = ch.homeY;
                events.push({ type: 'cheese_picked', id: ch.cid, byPlayerId: r.playerId || r.id, hitX, hitY });
                break;
            } else if (d < 155 && d > 0.1) {
                const pull = (1 - d / 155) * 520;
                ch.vx += (dx / d) * pull * dt * 5; ch.vy += (dy / d) * pull * dt * 5; pulled = true;
            }
        }
        if (!pulled) { ch.vx *= 0.92; ch.vy *= 0.92; }
        ch.x += ch.vx * dt; ch.y += ch.vy * dt;
    }
    return events;
}

