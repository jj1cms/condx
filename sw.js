// CondX service worker — offline app shell, always-fresh data.
const CACHE = 'condx-v2';
const SHELL = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './js/app.js', './js/config.js', './js/geo.js', './js/solar.js', './js/muf.js',
  './js/bands.js', './js/dx.js', './js/store.js', './js/notify.js', './js/mapview.js',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Same-origin app shell: network-first so updates apply immediately when
  // online; fall back to cache (or the cached shell) when offline.
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(e.request).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return resp;
      }).catch(() => caches.match(e.request).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  // Cross-origin (solar/MUF/DX APIs, tiles, CDN): network-first, cache fallback.
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
