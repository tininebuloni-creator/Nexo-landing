const CACHE_NAME = 'pampaporcinos-1.1.1';
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './logo2.png', './pampaia-source.js', './pampa-licensing.js', './pampa-trial-links.js', './pampa-offline-core.js'];
self.addEventListener('install', (event) => { event.waitUntil(caches.open(CACHE_NAME).then((cache) => Promise.all(APP_SHELL.map((asset) => cache.add(asset).catch(() => null)))); self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))); self.clients.claim(); });
self.addEventListener('fetch', (event) => { if (event.request.method !== 'GET') return; event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).catch(() => caches.match('./index.html')))); });
