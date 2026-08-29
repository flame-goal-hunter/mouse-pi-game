// ============================================
// Theme — single source of truth for visual identity
// All colors / sizes / curves used by UI MUST come from here.
// Phaser uses hex numbers (0x...), CSS uses strings ('#...'). Both exported.
// ============================================

// === PALETTE ===
// Base: deep gothic violet → midnight. Accent: candle gold. Danger: blood red.
// Limited intentionally — pick from these, don't invent new colors.
export const C = {
    // Backgrounds (darkest → lightest)
    bgVoid:     0x0a0410,  // page void, behind everything
    bgDeep:     0x140820,  // panel deep
    bgPanel:    0x1d0b2d,  // panel mid
    bgPanelHi:  0x2a1342,  // panel highlight / hover bg
    bgRaised:   0x3a1d54,  // raised surface (card hover)

    // Surface tints (semi-transparent over bg) — applied via alpha in code
    surfaceLightTint: 0xffffff,  // use at 0.04-0.08 alpha
    surfaceDarkTint:  0x000000,  // use at 0.35-0.55 alpha for shadows

    // Borders / dividers
    borderSoft: 0x4a2a6e,  // subtle outline
    borderHard: 0x6b3d92,  // active outline

    // Accent — primary gold (calls, ctas)
    accent:      0xe8b54a,  // candle gold (primary)
    accentSoft:  0xfff0a0,  // gold highlight (inner stroke)
    accentDeep:  0xa67520,  // gold pressed / shadow

    // Accent — secondary teal (highlights, info)
    teal:        0x4ad6c4,
    tealSoft:    0xa0fff0,

    // Danger / success / warn
    danger:      0xff4a5c,
    dangerDeep:  0x8a1a2a,
    success:     0x6ce06b,
    warn:        0xffaa2a,

    // Text
    textPrimary:  0xfff0d6,  // warm cream
    textSecond:   0xb9a2cf,  // muted lavender
    textMuted:    0x7a6a92,  // grey-purple
    textDanger:   0xff7a8a,
    textOnAccent: 0x140820,  // dark text on gold buttons

    // Player / element accents
    cheese:    0xffd24a,
    health:    0xff5c6b,
    stealth:   0x4ad6c4,
};

// CSS-string variants for tweens, DOM, gradients
export const CS = Object.fromEntries(Object.entries(C).map(([k, v]) =>
    [k, '#' + v.toString(16).padStart(6, '0')]
));

// === SPACING SCALE === (px)
// Use these and nothing else. 4-based rhythm.
export const S = {
    xxs: 2,
    xs:  4,
    sm:  8,
    md:  16,
    lg:  24,
    xl:  32,
    xxl: 48,
    xxxl: 64,
};

// === BORDER RADIUS ===
export const R = {
    sm:  8,
    md:  14,
    lg:  20,
    pill: 999,
};

// === STROKE WIDTHS ===
export const STROKE = {
    hairline: 1,
    thin:     1.5,
    base:     2,
    bold:     3,
    accent:   4,
};

// === TYPOGRAPHY ===
// System fonts only — Phaser Text creates canvas textures at scene-render time;
// web fonts (Google Fonts via <link>) often haven't loaded yet → text renders with
// fallback metrics and never re-renders. Use stacks that exist on every device.
// Nunito is bundled in the HTML and works at scene-create (close to system perf).
export const FONT = {
    display: '"Nunito", "Roboto", system-ui, -apple-system, "Segoe UI", sans-serif',
    body:    '"Nunito", "Roboto", system-ui, -apple-system, "Segoe UI", sans-serif',
    mono:    'ui-monospace, "SF Mono", Menlo, monospace',
};

// Phaser text style helpers — pass to add.text
export const TXT = {
    titleHero: (color = C.accent) => ({
        fontFamily: FONT.display,
        fontSize:   '52px',
        color:      '#' + color.toString(16).padStart(6, '0'),
        fontStyle:  'bold',
        stroke:     CS.bgVoid,
        strokeThickness: 6,
        shadow: { offsetX: 0, offsetY: 4, color: CS.bgVoid, blur: 12, fill: true },
    }),
    title: (color = C.textPrimary) => ({
        fontFamily: FONT.display,
        fontSize:   '32px',
        color:      '#' + color.toString(16).padStart(6, '0'),
        fontStyle:  'bold',
        stroke:     CS.bgVoid,
        strokeThickness: 4,
    }),
    h2: (color = C.textPrimary) => ({
        fontFamily: FONT.display,
        fontSize:   '24px',
        color:      '#' + color.toString(16).padStart(6, '0'),
        fontStyle:  'bold',
    }),
    body: (color = C.textPrimary) => ({
        fontFamily: FONT.body,
        fontSize:   '18px',
        color:      '#' + color.toString(16).padStart(6, '0'),
    }),
    small: (color = C.textSecond) => ({
        fontFamily: FONT.body,
        fontSize:   '14px',
        color:      '#' + color.toString(16).padStart(6, '0'),
    }),
    button: (color = C.textOnAccent) => ({
        fontFamily: FONT.body,
        fontSize:   '20px',
        color:      '#' + color.toString(16).padStart(6, '0'),
        fontStyle:  'bold',
    }),
    label: (color = C.textSecond) => ({
        fontFamily: FONT.body,
        fontSize:   '12px',
        color:      '#' + color.toString(16).padStart(6, '0'),
        fontStyle:  'italic',
    }),
};

// === EASING & DURATIONS ===
// Phaser ease strings — use these constants, not magic strings.
export const EASE = {
    out:    'Cubic.easeOut',
    inOut:  'Cubic.easeInOut',
    back:   'Back.easeOut',
    elastic:'Elastic.easeOut',
    bounce: 'Bounce.easeOut',
};

export const DUR = {
    instant: 100,
    fast:    180,
    base:    280,
    slow:    480,
    epic:    900,
};

// Stagger interval for entrance animations
export const STAGGER = 60;

// === SHADOW / GLOW PRESETS ===
// applyShadow(graphics, preset) draws shadow under graphics
export const SHADOW = {
    sm: { dx: 0, dy: 2,  blur: 6,  color: C.bgVoid, alpha: 0.45 },
    md: { dx: 0, dy: 6,  blur: 14, color: C.bgVoid, alpha: 0.55 },
    lg: { dx: 0, dy: 12, blur: 24, color: C.bgVoid, alpha: 0.65 },
};

// === HELPERS ===
export function hex(num) { return '#' + num.toString(16).padStart(6, '0'); }

/**
 * Draw a premium panel: layered shadow, gradient bg, inner highlight, accent border.
 * Returns the graphics object.
 */
export function drawPanel(scene, cx, cy, w, h, opts = {}) {
    const {
        bgTop = C.bgPanelHi,
        bgBot = C.bgDeep,
        radius = R.lg,
        depth = 500,
        accent = C.accent,
        accentAlpha = 1,
        innerHighlight = true,
        shadow = SHADOW.md,
    } = opts;

    const objs = [];

    // Shadow (offset under panel)
    if (shadow) {
        const sh = scene.add.graphics().setScrollFactor(0).setDepth(depth - 2);
        sh.fillStyle(shadow.color, shadow.alpha);
        sh.fillRoundedRect(cx - w/2 + shadow.dx, cy - h/2 + shadow.dy + shadow.blur*0.3, w, h, radius);
        objs.push(sh);
    }

    // Panel body
    const p = scene.add.graphics().setScrollFactor(0).setDepth(depth - 1);
    p.fillGradientStyle(bgTop, bgTop, bgBot, bgBot, 1);
    p.fillRoundedRect(cx - w/2, cy - h/2, w, h, radius);

    // Inner top highlight (glass effect)
    if (innerHighlight) {
        p.fillStyle(C.surfaceLightTint, 0.06);
        p.fillRoundedRect(cx - w/2 + 3, cy - h/2 + 3, w - 6, Math.min(h * 0.45, 80), radius - 2);
    }

    // Accent border
    p.lineStyle(STROKE.base, accent, accentAlpha);
    p.strokeRoundedRect(cx - w/2, cy - h/2, w, h, radius);

    // Inner border (subtle gold)
    p.lineStyle(STROKE.hairline, C.accentSoft, 0.35);
    p.strokeRoundedRect(cx - w/2 + 4, cy - h/2 + 4, w - 8, h - 8, radius - 4);

    objs.push(p);
    return objs;
}

/**
 * Premium button with hover/press states + sound bus integration.
 * Returns { container, setEnabled(bool), destroy() }
 */
export function makeButton(scene, x, y, w, h, label, opts = {}) {
    const {
        variant = 'primary',       // 'primary' | 'secondary' | 'ghost' | 'danger'
        depth = 600,
        onClick = () => {},
        clickEvent = null,         // EventBus event to emit on click (defaults sensible)
        icon = null,               // optional emoji or short string before label
        textSize = '20px',
    } = opts;

    const styles = {
        primary:   { bg: C.accent,     bgHi: C.accentSoft, text: C.textOnAccent, border: C.accentDeep },
        secondary: { bg: C.bgPanelHi,  bgHi: C.bgRaised,   text: C.textPrimary,  border: C.accent },
        ghost:     { bg: 0x000000,     bgHi: C.bgPanel,    text: C.textPrimary,  border: C.borderHard, bgAlpha: 0.3 },
        danger:    { bg: C.danger,     bgHi: 0xff7a8a,     text: 0xffffff,       border: C.dangerDeep },
    };
    const s = styles[variant] || styles.primary;
    const bgAlpha = s.bgAlpha != null ? s.bgAlpha : 1;

    const container = scene.add.container(x, y).setDepth(depth);

    const g = scene.add.graphics();
    const drawBg = (bgColor, alpha) => {
        g.clear();
        // Shadow
        g.fillStyle(C.bgVoid, 0.4);
        g.fillRoundedRect(-w/2 + 2, -h/2 + 4, w, h, R.md);
        // Body
        g.fillStyle(bgColor, alpha);
        g.fillRoundedRect(-w/2, -h/2, w, h, R.md);
        // Inner highlight
        g.fillStyle(C.surfaceLightTint, 0.10);
        g.fillRoundedRect(-w/2 + 2, -h/2 + 2, w - 4, h * 0.45, R.md - 2);
        // Border
        g.lineStyle(STROKE.base, s.border, 1);
        g.strokeRoundedRect(-w/2, -h/2, w, h, R.md);
    };
    drawBg(s.bg, bgAlpha);
    container.add(g);

    const labelText = (icon ? icon + '  ' : '') + label;
    const txt = scene.add.text(0, 0, labelText, {
        fontFamily: FONT.body,
        fontSize:   textSize,
        color:      hex(s.text),
        fontStyle:  'bold',
    }).setOrigin(0.5);
    container.add(txt);

    const hit = scene.add.zone(0, 0, w, h).setInteractive({ useHandCursor: true });
    container.add(hit);

    let enabled = true;
    let isDown = false;
    hit.on('pointerover', () => {
        if (!enabled) return;
        drawBg(s.bgHi, bgAlpha);
        scene.tweens.add({ targets: container, scale: 1.04, duration: DUR.fast, ease: EASE.out });
    });
    hit.on('pointerout', () => {
        if (!enabled) return;
        drawBg(s.bg, bgAlpha);
        isDown = false;
        scene.tweens.add({ targets: container, scale: 1, duration: DUR.fast, ease: EASE.out });
    });
    hit.on('pointerdown', () => {
        if (!enabled) return;
        isDown = true;
        scene.tweens.add({ targets: container, scale: 0.96, duration: DUR.instant, ease: EASE.out });
    });
    hit.on('pointerup', () => {
        if (!enabled || !isDown) return;
        isDown = false;
        scene.tweens.add({ targets: container, scale: 1.04, duration: DUR.fast, ease: EASE.back });
        // Emit click sound via global bus (lazy import to avoid cycle)
        try {
            const ev = clickEvent || (variant === 'danger' ? 'ui.shop.deny' : 'ui.button.click');
            window?.audio?.emit?.(ev);
        } catch (e) {}
        onClick();
    });

    return {
        container,
        setEnabled(b) {
            enabled = b;
            container.setAlpha(b ? 1 : 0.45);
            hit.input.enabled = b;
        },
        setLabel(newLabel) { txt.setText((icon ? icon + '  ' : '') + newLabel); },
        destroy() { container.destroy(); },
    };
}

/**
 * Staggered fade-in entrance for a list of display objects.
 * Each object slides up 16px and fades in, offset by STAGGER per index.
 */
export function staggerIn(scene, objects, opts = {}) {
    const {
        from = 'bottom',  // 'bottom' | 'top' | 'left' | 'right' | 'scale'
        distance = 16,
        duration = DUR.base,
        stagger = STAGGER,
        delay = 0,
    } = opts;
    objects.forEach((obj, i) => {
        const ox = obj.x, oy = obj.y;
        const offsets = {
            bottom: [0, distance], top: [0, -distance],
            left: [-distance, 0],  right: [distance, 0],
            scale: [0, 0],
        };
        const [dx, dy] = offsets[from] || [0, distance];
        if (from !== 'scale') { obj.x = ox + dx; obj.y = oy + dy; }
        else { obj.setScale(0.7); }
        obj.setAlpha(0);
        scene.tweens.add({
            targets: obj,
            x: ox, y: oy, alpha: 1, scale: 1,
            duration, ease: EASE.out,
            delay: delay + i * stagger,
        });
    });
}

/**
 * Draw an icon-bordered title bar at top of screen (back arrow + centered title).
 * Returns { back, title, line }.
 */
export function makeTitleBar(scene, title, onBack, opts = {}) {
    const w = scene.scale.width;
    const top = opts.top != null ? opts.top : S.lg;
    const depth = opts.depth || 1000;

    const back = makeButton(scene, S.xl + 24, top + 24, 48, 48, '‹', {
        variant: 'ghost', textSize: '32px', depth,
        onClick: onBack,
        clickEvent: 'ui.button.back',
    });
    const titleText = scene.add.text(w / 2, top + 28, title, TXT.title())
        .setOrigin(0.5)
        .setDepth(depth);
    const line = scene.add.graphics().setDepth(depth - 1);
    line.lineStyle(STROKE.hairline, C.borderSoft, 0.6);
    line.lineBetween(S.lg, top + 64, w - S.lg, top + 64);
    return { back, title: titleText, line };
}
