// ============================================
// PATROL CYCLE — детерминированное положение монстра на замкнутом маршруте.
// Маршрут задан клетками; движение равномерное, петля замыкается на первую точку.
// ============================================

const toPx = (wp, cell) => ({ x: (wp.x + 0.5) * cell, y: (wp.y + 0.5) * cell });

export function legLengths(waypoints, cell) {
    const pts = waypoints.map((w) => toPx(w, cell));
    const legs = [];
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        legs.push(Math.hypot(b.x - a.x, b.y - a.y));
    }
    return legs;
}

export function cycleMs(waypoints, speedPxS, cell) {
    const total = legLengths(waypoints, cell).reduce((s, n) => s + n, 0);
    return (total / speedPxS) * 1000;
}

export function positionAt(waypoints, speedPxS, cell, tMs) {
    const pts = waypoints.map((w) => toPx(w, cell));
    const legs = legLengths(waypoints, cell);
    const total = legs.reduce((s, n) => s + n, 0);
    if (total === 0) return { x: pts[0].x, y: pts[0].y, angle: 0 };

    let d = ((tMs / 1000) * speedPxS) % total;
    if (d < 0) d += total;

    for (let i = 0; i < legs.length; i++) {
        if (d <= legs[i] || i === legs.length - 1) {
            const a = pts[i];
            const b = pts[(i + 1) % pts.length];
            const t = legs[i] === 0 ? 0 : Math.min(1, d / legs[i]);
            return {
                x: a.x + (b.x - a.x) * t,
                y: a.y + (b.y - a.y) * t,
                angle: Math.atan2(b.y - a.y, b.x - a.x),
            };
        }
        d -= legs[i];
    }
    return { x: pts[0].x, y: pts[0].y, angle: 0 };
}
