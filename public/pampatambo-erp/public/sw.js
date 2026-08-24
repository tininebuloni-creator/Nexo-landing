const CACHE_NAME = 'pampatambo-pwa-v1';
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './logo.png', './pampaia-source.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  if (url.origin === self.location.origin && url.pathname.startsWith('/tambo/')) {
    event.respondWith(fetch(event.request).catch(() => new Response(JSON.stringify({ ok: false, offline: true, error: 'Sin conexión: operación pendiente.' }), { status: 503, headers: { 'Content-Type': 'application/json' } })));
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then((response) => {
      caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', response.clone()));
      return response;
    }).catch(() => caches.match('./index.html')));
    return;
  }

  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (url.origin === self.location.origin) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
    return response;
  })));
});