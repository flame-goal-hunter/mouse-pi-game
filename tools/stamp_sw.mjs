#!/usr/bin/env node
// Stamps the service worker's cache version and writes www/version.json (and public/version.json)
// so PWA clients immediately detect any new deployment.
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WWW = join(ROOT, 'www');
const PUBLIC = join(ROOT, 'public');
const SW = join(WWW, 'sw.js');
const VER_WWW = join(WWW, 'version.json');
const VER_PUB = join(PUBLIC, 'version.json');
const HASHED = /\.(js|mjs|css|html|webmanifest|svg)$/i;
const SKIP = new Set(['sw.js', 'version.json', 'node_modules']);

function walk(dir, out = []) {
    for (const name of readdirSync(dir).sort()) {
        if (SKIP.has(name)) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (HASHED.test(name)) out.push(full);
    }
    return out;
}

const h = createHash('sha256');
for (const f of walk(WWW)) {
    h.update(relative(WWW, f).split(sep).join('/'));
    h.update(readFileSync(f));
}
const stamp = h.digest('hex').slice(0, 10);
const versionPayload = JSON.stringify({
    version: `1.05-${stamp}`,
    label: `v1.05 · ${stamp.slice(0, 4)}`,
    shortLabel: 'v1.05',
    buildHash: stamp
}, null, 2) + '\n';

writeFileSync(VER_WWW, versionPayload);
mkdirSync(PUBLIC, { recursive: true });
writeFileSync(VER_PUB, versionPayload);

const src = readFileSync(SW, 'utf8');
const line = /const CACHE_VERSION = '[^']+';/;
if (!line.test(src)) { console.error('[stamp_sw] CACHE_VERSION line not found'); process.exit(1); }
const out = src.replace(line, `const CACHE_VERSION = 'mousiepi-${stamp}';`);
writeFileSync(SW, out);
console.log(`[stamp_sw] cache version -> mousiepi-${stamp} (version.json updated)`);
