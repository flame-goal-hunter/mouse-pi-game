import test from 'node:test';
import assert from 'node:assert/strict';
import { uiScaleFor, computeHudLayout } from '../../www/js/ui/hudLayout.js';

const VIEWPORTS = [[360, 640], [640, 360], [800, 360], [412, 915], [915, 412], [1400, 1050], [2400, 1080]];
const ZERO = { top: 0, right: 0, bottom: 0, left: 0 };
const PORTRAIT_NOTCH = { top: 24, right: 0, bottom: 34, left: 0 };
const LANDSCAPE_NOTCH = { top: 0, right: 44, bottom: 24, left: 44 };
const safesFor = (W, H) => (W >= H ? [ZERO, PORTRAIT_NOTCH, LANDSCAPE_NOTCH] : [ZERO, PORTRAIT_NOTCH]);

const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

test('uiScale is clamped to [0.8, 1.3]', () => {
    assert.equal(uiScaleFor(360, 640), 0.8);
    assert.equal(uiScaleFor(640, 360), 0.8);
    assert.equal(uiScaleFor(1400, 1050), 1.3);
    assert.ok(Math.abs(uiScaleFor(640, 640) - 1) < 1e-9);
});

for (const [W, H] of VIEWPORTS) for (const safe of safesFor(W, H)) {
    test(`no HUD overlaps and everything on-screen at ${W}x${H} safe=${JSON.stringify(safe)}`, () => {
        const L = computeHudLayout({ W, H, safe, maxHp: 5 });
        assert.ok(L.rects.length >= 8, 'rects listed');
        for (const r of L.rects) {
            assert.ok(r.x >= safe.left && r.y >= safe.top && r.x + r.w <= W - safe.right && r.y + r.h <= H - safe.bottom, `${r.name} inside safe area`);
        }
        for (let i = 0; i < L.rects.length; i++) for (let j = i + 1; j < L.rects.length; j++) {
            assert.ok(!overlaps(L.rects[i], L.rects[j]), `${L.rects[i].name} overlaps ${L.rects[j].name}`);
        }
        // touch: dash button (right column) never reaches the exit button, sticks stay inside the safe area
        const t = L.touch;
        const dashTop = H - t.bottomOff - t.joyR - t.dashGap - 2 * t.dashR;
        assert.ok(dashTop > L.exit.cy + L.exit.r, 'dash button below exit button');
        assert.ok(t.sideOffLeft - t.joyR >= safe.left && H - t.bottomOff + t.joyR <= H - safe.bottom, 'move stick inside safe area');
        assert.ok(W - t.sideOffRight + t.joyR <= W - safe.right, 'aim stick inside safe area');
    });
}

test('cheese group is pushed right of the key on narrow screens', () => {
    const L = computeHudLayout({ W: 360, H: 640, maxHp: 5 });
    assert.ok(L.cheese.iconX >= L.key.x + L.key.w + 6);
});

test('layout scales with uiScale', () => {
    const a = computeHudLayout({ W: 640, H: 360, maxHp: 5 });
    const b = computeHudLayout({ W: 1400, H: 1050, maxHp: 5 });
    assert.ok(b.hearts[0].size > a.hearts[0].size);
    assert.ok(b.touch.joyR > a.touch.joyR);
});

test('12 hearts wrap into rows and still fit on 360x640', () => {
    const L = computeHudLayout({ W: 360, H: 640, maxHp: 12 });
    assert.equal(L.hearts.length, 12);
    assert.ok(L.hearts[5].y > L.hearts[4].y && L.hearts[5].x === L.hearts[0].x, 'second row starts under the first');
    assert.ok(L.meter.cy - L.meter.r > L.hearts[11].y + L.hearts[11].size, 'status row below the last heart row');
    for (const r of L.rects) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 360 && r.y + r.h <= 640, `${r.name} on-screen`);
    for (let i = 0; i < L.rects.length; i++) for (let j = i + 1; j < L.rects.length; j++) assert.ok(!overlaps(L.rects[i], L.rects[j]), `${L.rects[i].name} overlaps ${L.rects[j].name}`);
});

for (const [W, H] of [[320, 568], [568, 320]]) for (const safe of safesFor(W, H)) {
    test(`floor viewport ${W}x${H} safe=${JSON.stringify(safe)} has no overlaps`, () => {
        const L = computeHudLayout({ W, H, safe, maxHp: 5 });
        for (const r of L.rects) assert.ok(r.x >= safe.left && r.y >= safe.top && r.x + r.w <= W - safe.right && r.y + r.h <= H - safe.bottom, `${r.name} inside safe area`);
        for (let i = 0; i < L.rects.length; i++) for (let j = i + 1; j < L.rects.length; j++) assert.ok(!overlaps(L.rects[i], L.rects[j]), `${L.rects[i].name} overlaps ${L.rects[j].name}`);
    });
}
