// ============================================
// Service worker — makes the game installable from Chrome and playable offline.
// Shell files are precached on install; heavy assets (art, audio) are cached the
// first time they are used, so the first load stays small.
// Bump CACHE_VERSION whenever shipping new files.
// ============================================
const CACHE_VERSION = 'mousiepi-bf71bbc247';
const SHELL = [
  './',
  './index.html',
  './game-phaser.html',
  './transylvania-menu.html',
  './transylvania-menu.css',
  './transylvania-menu.js',
  './manifest.webmanifest',
  './lib/phaser-3.70.0.min.js',
  './lib/nipplejs-0.10.2.min.js',
  './assets/fonts/nunito.css',
  './assets/icons/icon-256-v3.png',
  './assets/icons/icon-512-v3.png',
  './assets/icons/icon-maskable-512-v3.png',
  './assets/icons/apple-touch-icon-v3.png',
  './assets/icons/favicon-32-v3.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE_VERSION);
    // Never fail the install because one optional file is missing.
    await Promise.all(SHELL.map((u) => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Multiplayer and health endpoints always go to the network.
  if (url.pathname.startsWith('/colyseus') || url.pathname.startsWith('/health') ||
      url.pathname.startsWith('/matchmake')) return;
  // Same-origin only: any CDN stays on the network.
  if (url.origin !== self.location.origin) return;

  // Pages: network first (so a fresh deploy is picked up), falling back to cache offline.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const c = await caches.open(CACHE_VERSION);
        c.put(req, fresh.clone());
        return fresh;
      } catch (err) {
        return (await caches.match(req, { ignoreSearch: true })) || (await caches.match('./index.html'));
      }
    })());
    return;
  }

  // Network-first for all same-origin assets so updates are picked up immediately,
  // falling back to cache only when offline.
  e.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: 'no-store' });
      if (res && res.ok) {
        const c = await caches.open(CACHE_VERSION);
        c.put(req, res.clone());
      }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: true });
      return hit || Response.error();
    }
  })());
});
