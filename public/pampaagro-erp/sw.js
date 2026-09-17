const CACHE_NAME = 'pampaagro-erp-v2-mobile-nav';
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './logo2.png'];

// Caché aparte y ESTABLE para las imágenes del mapa (tiles). No se borra cuando
// se actualiza la versión de la app, así el mapa offline no se pierde en cada deploy.
const TILES_CACHE_NAME = 'pampaagro-erp-tiles-v1';
const TILE_HOSTS = [
  'tile.openstreetmap.org',
  'server.arcgisonline.com',
  'tile.opentopomap.org',
  'basemaps.cartocdn.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => Promise.all(APP_SHELL.map((asset) => cache.add(asset).catch(() => null)))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME && key !== TILES_CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request).catch(() => new Response(JSON.stringify({ ok: false, offline: true, message: 'Sin conexión: API no disponible.' }), { status: 503, headers: { 'Content-Type': 'application/json' } })));
    return;
  }

  // Tiles del mapa: "cache primero" — si ya se vio esa zona, se muestra al instante
  // aunque no haya señal; si es nueva, se pide por red y se guarda para la próxima vez.
  if (TILE_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith('.' + host))) {
    event.respondWith(
      caches.open(TILES_CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((response) => {
            try { cache.put(event.request, response.clone()); } catch (e) {}
            return response;
          }).catch(() => cached); // sin caché y sin red: no hay nada que mostrar para ese tile
        })
      )
    );
    return;
  }

  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok && response.type === 'basic') {
      try {
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache)).catch(() => {});
      } catch (err) {
        // La respuesta ya fue leída (o algo la invalidó): no bloquear la entrega al cliente por esto.
      }
    }
    return response;
  }).catch(() => caches.match('./index.html'))));
});
