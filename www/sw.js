// ============================================================================
// sw.js — Умный Service Worker: строгий Network First (cache: 'no-store'),
// мгновенный self.skipWaiting() + self.clients.claim() без удержания старого кэша
// ============================================================================
const CACHE_VERSION = 'mousiepi-ed88b25ae5';
const SHELL = [
  './',
  './index.html',
  './game-phaser.html',
  './transylvania-menu.html',
  './transylvania-menu.css',
  './transylvania-menu.js',
  './manifest.json',
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
  self.skipWaiting();
  e.waitUntil((async () => {
    const c = await caches.open(CACHE_VERSION);
    await Promise.all(SHELL.map(async (u) => {
      try {
        const res = await fetch(new Request(u, { cache: 'no-store' }));
        if (res && res.ok) await c.put(u, res);
      } catch (_) {}
    }));
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
  if (
    url.pathname.startsWith('/colyseus') ||
    url.pathname.startsWith('/health') ||
    url.pathname.startsWith('/matchmake') ||
    url.pathname.startsWith('/api/') ||
    url.pathname.endsWith('/version.json')
  ) {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Strict Network First with cache: 'no-store' for all HTML pages and assets
  e.respondWith((async () => {
    try {
      const fresh = await fetch(new Request(req.url, { cache: 'no-store' }));
      if (fresh && fresh.ok) {
        const c = await caches.open(CACHE_VERSION);
        c.put(req, fresh.clone());
      }
      return fresh;
    } catch (_) {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const fallback = await caches.match('./index.html', { ignoreSearch: true });
        if (fallback) return fallback;
      }
      return Response.error();
    }
  })());
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) {}
  const fromNick = data.fromNickname || 'Друг Пи';
  const title = data.title || '🐭 Мышонок Пи — Зовут в космос!';
  const body = data.body || `🚀 ${fromNick} прилетел к твоей планете и зовет тебя играть!`;
  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: './assets/icons/icon-256-v3.png',
      badge: './assets/icons/favicon-32-v3.png',
      tag: 'mousie-pi-invite-' + Date.now(),
      renotify: true,
      vibrate: [220, 100, 220, 100, 320],
      data: { url: data.url || './', fromId: data.fromId || '' }
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const targetUrl = e.notification?.data?.url || './';
  e.waitUntil((async () => {
    const winClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of winClients) {
      if (client.url.includes(self.location.origin) && 'focus' in client) {
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
  })());
});
