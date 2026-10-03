// La versión del caché la mantiene scripts/bump-release-version.js (igual a package.json).
const CACHE_NAME = 'pampaporcinos-1.1.2-gdf8b689a';
const APP_SHELL = ['./', './index.html', './pampa-trial-guard.js', './manifest.webmanifest', './logo2.png', './asistente-ia.js', './pampaia-source.js', './pampa-trial-links.js', './porcinos-modulos.js', './porcinos-residuos.js', './vendor/qrcode.js'];
self.addEventListener('install', (event) => { event.waitUntil(caches.open(CACHE_NAME).then((cache) => Promise.all(APP_SHELL.map((asset) => cache.add(asset).catch(() => null))))); self.skipWaiting(); });
// Las apps web comparten dominio (y las cachés son del dominio): cada una borra solo las suyas.
self.addEventListener('activate', (event) => { event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('pampaporcinos-') && key !== CACHE_NAME).map((key) => caches.delete(key))))); self.clients.claim(); });
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Solo recursos propios: el servidor de sincronización, mapas y CDNs van directo a la red
  // (antes, sin conexión, una consulta de sincronización recibía index.html en lugar de JSON).
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  // Red primero para todo lo propio (página y scripts): así una publicación nueva nunca mezcla
  // index.html nuevo con scripts viejos del caché. Sin conexión se usa la última copia guardada.
  event.respondWith(fetch(request)
    .then((response) => {
      if (response.ok) {
        const copy = response.clone();
        const key = request.mode === 'navigate' ? './index.html' : request;
        caches.open(CACHE_NAME).then((cache) => cache.put(key, copy)).catch(() => {});
      }
      return response;
    })
    .catch(() => caches.match(request.mode === 'navigate' ? './index.html' : request)));
});
