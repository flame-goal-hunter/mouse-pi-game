// Reads CSS env(safe-area-inset-*) through a hidden probe element.
// Needs <meta name="viewport" … viewport-fit=cover> (already set in game-phaser.html).
let probe = null;

export function readSafeArea() {
    if (typeof document === 'undefined' || !document.body) return { top: 0, right: 0, bottom: 0, left: 0 };
    if (!probe) {
        probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
            'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);';
        document.body.appendChild(probe);
    }
    const cs = getComputedStyle(probe);
    const n = (v) => Math.max(0, parseFloat(v) || 0);
    return { top: n(cs.paddingTop), right: n(cs.paddingRight), bottom: n(cs.paddingBottom), left: n(cs.paddingLeft) };
}
