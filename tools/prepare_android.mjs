// Runs after `cap sync`. The Android build is a native app, not a web page: it must never
// offer to "install" itself, and it has no use for a service worker — every file is local,
// and a worker left over from an earlier install keeps serving that older copy.
//
// Runtime detection (user agent, window.Capacitor, the serving origin) is a guess that can
// be wrong. This is not: the markup is removed from the copy that goes into the APK, and a
// flag is planted before any other script runs.
//
// Usage: node tools/prepare_android.mjs   (or `npm run sync`, which chains it after cap sync)
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pub = join(root, 'android', 'app', 'src', 'main', 'assets', 'public');
if (!existsSync(pub)) {
    console.error('[prepare_android] no ' + pub + ' — run `cap sync` first');
    process.exit(1);
}

const indexPath = join(pub, 'index.html');
let html = readFileSync(indexPath, 'utf8');
const before = html.length;

// 1) A flag that no timing, user agent or origin check can get wrong.
const FLAG = '<script>window.__NATIVE_SHELL__=true;</script>';
if (!html.includes(FLAG)) {          // the runtime check mentions the name too — match the tag
    if (!html.includes('<head>')) throw new Error('index.html has no <head>');
    html = html.replace('<head>', '<head>\n    ' + FLAG);
}

// 2) The install card itself — gone, not hidden. Matched by counting nested <div>,
//    so the block is cut exactly, however it is later edited.
const open = html.indexOf('<div id="installCard"');
if (open !== -1) {
    const tag = /<\/?div\b/gi;
    tag.lastIndex = open;
    let depth = 0, close = -1, m;
    while ((m = tag.exec(html)) !== null) {
        depth += m[0][1] === '/' ? -1 : 1;
        if (depth === 0) { close = html.indexOf('>', m.index) + 1; break; }
    }
    if (close === -1) throw new Error('install card markup is not balanced');
    html = html.slice(0, open) + '<!-- install card stripped for the native build -->' + html.slice(close);
}

writeFileSync(indexPath, html);

// 3) No service worker inside the app. A 404 on the script also makes any leftover
//    registration on an already-updated device unregister itself.
let swRemoved = false;
const sw = join(pub, 'sw.js');
if (existsSync(sw)) { rmSync(sw); swRemoved = true; }

const stillThere = html.includes('<div id="installCard"');
console.log(`[prepare_android] флаг __NATIVE_SHELL__ добавлен; разметка плашки ` +
            `${stillThere ? 'НА МЕСТЕ' : 'вырезана'}; sw.js ${swRemoved ? 'удалён' : 'уже отсутствовал'}; ` +
            `index.html ${before} -> ${html.length} байт`);
if (stillThere) { console.error('[prepare_android] плашка НЕ вырезана'); process.exit(1); }
