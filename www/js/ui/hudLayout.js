// Pure HUD layout — no Phaser, no DOM. All sizes are base px × uiScale.
// Consumed by DungeonScene.repositionHUD()/setupTouchControls(); tested by tools/tests/hudLayout.test.mjs.
// Conventions: {x, y} = top-left (origin 0,0); {cx, cy} = centre (origin 0.5); text fields carry their own origin in DungeonScene.

export function uiScaleFor(W, H) {
    return Math.min(1.3, Math.max(0.8, Math.min(W, H) / 640));
}

const BASE = {
    margin: 12, heart: 26, heartGap: 4, keyW: 40, keyH: 21, keyGap: 10,
    rowGap: 8, statusH: 28, meterR: 14, eye: 16, bookIcon: 22, bookFont: 17, paw: 22, itemGap: 10,
    powerIcon: 22, powerFont: 18,
    cheeseW: 24, cheeseH: 20, cheeseGap: 6, cheeseFont: 22, cheeseTextW: 72, comboFont: 26, comboGap: 4, comboTextW: 110,
    exitR: 22, exitIcon: 44, compassLabel: 26, compassArrow: 18,
    joyR: 76, dashR: 52, touchPad: 18, touchOuter: 10, dashGap: 26, touchFont: 11,
};

export function computeHudLayout({ W, H, safe = { top: 0, right: 0, bottom: 0, left: 0 }, maxHp = 5, uiScale }) {
    const s = uiScale ?? uiScaleFor(W, H);
    const px = (v) => Math.round(v * s);
    const M = px(BASE.margin);
    const left = safe.left + M, top = safe.top + M, right = W - safe.right - M;
    const rects = [];
    const rect = (name, x, y, w, h) => rects.push({ name, x, y, w, h });

    // --- Top-left: hearts (rows of 5) + key beside the first row
    const heart = px(BASE.heart), heartGap = px(BASE.heartGap), perRow = 5;
    const rows = Math.max(1, Math.ceil(maxHp / perRow));
    const hearts = [];
    for (let i = 0; i < maxHp; i++) {
        hearts.push({ x: left + (i % perRow) * (heart + heartGap), y: top + Math.floor(i / perRow) * (heart + heartGap), size: heart });
    }
    const heartsRight = left + Math.min(maxHp, perRow) * (heart + heartGap) - heartGap;
    const heartsBottom = top + rows * (heart + heartGap) - heartGap;
    rect('hearts', left, top, heartsRight - left, heartsBottom - top);
    const key = { x: heartsRight + px(BASE.keyGap), y: top + Math.round((heart - px(BASE.keyH)) / 2), w: px(BASE.keyW), h: px(BASE.keyH) };
    rect('key', key.x, key.y, key.w, key.h);
    const leftClusterRight = key.x + key.w;

    // --- Status row under the hearts: suspicion meter, book counter, crouch paw
    const rowY = heartsBottom + px(BASE.rowGap);
    const statusH = px(BASE.statusH), itemGap = px(BASE.itemGap), rowCy = rowY + statusH / 2;
    let x = left;
    const meterR = px(BASE.meterR);
    const meter = { cx: x + meterR, cy: rowCy, r: meterR };
    const eye = { cx: meter.cx, cy: meter.cy, size: px(BASE.eye) };
    rect('meter', x, rowY, meterR * 2, statusH);
    x += meterR * 2 + itemGap;
    const bookIcon = px(BASE.bookIcon), bookFont = px(BASE.bookFont), bookTextW = Math.round(bookFont * 1.6);
    const book = { cx: x + bookIcon / 2, cy: rowCy, size: bookIcon };
    const bookText = { x: x + bookIcon + px(4), y: rowCy, fontSize: bookFont };
    rect('book', x, rowY, bookIcon + px(4) + bookTextW, statusH);
    x += bookIcon + px(4) + bookTextW + itemGap;
    const pawSize = px(BASE.paw);
    const paw = { cx: x + pawSize / 2, cy: rowCy, size: pawSize };
    rect('paw', x, rowY, pawSize, statusH);

    // --- Power-up timer row under the status row
    const powerY = rowY + statusH + px(BASE.rowGap);
    const powerIcon = px(BASE.powerIcon), powerFont = px(BASE.powerFont);
    const powerup = {
        iconCx: left + powerIcon / 2, iconCy: powerY + statusH / 2, size: powerIcon,
        textX: left + powerIcon + px(6), textY: powerY + statusH / 2, fontSize: powerFont,
    };
    rect('powerup', left, powerY, powerIcon + px(6) + Math.round(powerFont * 3), statusH);

    // --- Top-centre: cheese counter (+ combo under it); pushed right if it would touch the key
    const cheeseW = px(BASE.cheeseW), cheeseH = px(BASE.cheeseH);
    const groupW = cheeseW + px(BASE.cheeseGap) + px(BASE.cheeseTextW);
    const groupLeft = Math.max(Math.round(W / 2 - groupW / 2), leftClusterRight + px(8));
    const cheese = {
        iconX: groupLeft, iconY: top + Math.round((heart - cheeseH) / 2), iconW: cheeseW, iconH: cheeseH,
        textX: groupLeft + cheeseW + px(BASE.cheeseGap), textY: top + heart / 2, fontSize: px(BASE.cheeseFont),
    };
    rect('cheese', groupLeft, top, groupW, heart);
    const combo = { x: groupLeft + groupW / 2, y: top + heart + px(BASE.comboGap), fontSize: px(BASE.comboFont) };
    rect('combo', combo.x - px(BASE.comboTextW) / 2, combo.y, px(BASE.comboTextW), Math.round(px(BASE.comboFont) * 1.2));

    // --- Top-right: exit button
    const exitR = px(BASE.exitR);
    const exit = { cx: right - exitR, cy: top + exitR, r: exitR, iconSize: px(BASE.exitIcon) };
    rect('exit', exit.cx - exitR, exit.cy - exitR, exitR * 2, exitR * 2);

    // --- Compass ring around the screen centre (radius rule unchanged from before)
    const compass = { ringR: Math.min(W, H) * 0.40, labelSize: px(BASE.compassLabel), arrowSize: px(BASE.compassArrow) };

    // --- Touch controls (radii are applied once at setup; offsets every reposition)
    const joyR = px(BASE.joyR), dashR = px(BASE.dashR), pad = px(BASE.touchPad) + px(BASE.touchOuter);
    const touch = {
        joyR, dashR,
        bottomOff: joyR + pad + safe.bottom,
        sideOffLeft: joyR + pad + safe.left,
        sideOffRight: joyR + pad + safe.right,
        dashGap: px(BASE.dashGap),
        labelFont: Math.max(10, px(BASE.touchFont)),
    };

    return { s, safe, hearts, key, meter, eye, book, bookText, paw, powerup, cheese, combo, exit, compass, touch, rects };
}
