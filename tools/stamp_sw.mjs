#!/usr/bin/env node
// Stamps the service worker's cache version so shipped changes actually reach players.
//
// sw.js serves cache-first, and it only updates when the FILE ITSELF changes bytes.
// The version used to be stamped from Heroku's SOURCE_VERSION, which meant local
// builds and Android packages kept 'mousiepi-v1' forever: every fix stayed invisible
// to any browser that had opened the game once.
//
// The version is now a hash of the code that ships, so it changes exactly when the
// code changes — no manual bump, no needless re-download when nothing moved.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

const WWW = fileURLToPath(new URL('../www', import.meta.url));
const SW = join(WWW, 'sw.js');
const HASHED = /\.(js|mjs|css|html|webmanifest|json|svg)$/i;
const SKIP = new Set(['sw.js', 'node_modules']);

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

const src = readFileSync(SW, 'utf8');
const line = /const CACHE_VERSION = '[^']+';/;
if (!line.test(src)) { console.error('[stamp_sw] CACHE_VERSION line not found'); process.exit(1); }
const out = src.replace(line, `const CACHE_VERSION = 'mousiepi-${stamp}';`);
if (out === src) { console.log(`[stamp_sw] unchanged (mousiepi-${stamp})`); process.exit(0); }
writeFileSync(SW, out);
console.log(`[stamp_sw] cache version -> mousiepi-${stamp}`);
