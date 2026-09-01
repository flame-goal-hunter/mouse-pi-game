#!/usr/bin/env node
// Stamps the service worker's cache version with the deployed commit.
// Heroku sets SOURCE_VERSION during a build, so every deploy automatically
// invalidates the old cache and players get the new version — no manual bump.
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../www/sw.js', import.meta.url);
const sha = (process.env.SOURCE_VERSION || process.env.HEROKU_SLUG_COMMIT || '').slice(0, 8);
if (!sha) {
    console.log('[stamp_sw] no SOURCE_VERSION (local build) — cache version left as is');
    process.exit(0);
}
const src = readFileSync(file, 'utf8');
const out = src.replace(/const CACHE_VERSION = '[^']+';/, `const CACHE_VERSION = 'mousiepi-${sha}';`);
if (out === src) { console.error('[stamp_sw] CACHE_VERSION line not found'); process.exit(1); }
writeFileSync(file, out);
console.log(`[stamp_sw] cache version -> mousiepi-${sha}`);
