const CACHE_NAME = 'pampatambo-pwa-v20-roles';
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './logo2.png', './pampaia-source.js', './pampa-report-voice.js', './pampa-sync-envelope.js'];

// Guarda la lista básica y, leyendo index.html, todos los archivos propios que la página carga.
async function precacheCompleto(cache, basicos) {
  const guardar = (url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => null);
  await Promise.all(basicos.map(guardar));
  try {
    const html = await (await fetch('./index.html', { cache: 'reload' })).text();
    const locales = [...html.matchAll(/(?:src|href)=["']([^"'#]+)["']/g)]
      .map((m) => m[1])
      .filter((u) => !/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(u))
      .filter((u) => /\.(?:js|css|png|webp|jpe?g|jfif|svg|ico|json|webmanifest|woff2?|xlsx)(?:\?|$)/i.test(u));
    await Promise.all([...new Set(locales)].map(guardar));
  } catch {
    // Sin red al instalar: queda lo básico y el resto se guarda al usarse.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => precacheCompleto(cache, APP_SHELL)));
  self.skipWaiting();
});

// Las apps web comparten dominio (y las cachés son del dominio): cada una borra solo las suyas.
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('pampatambo-') && key !== CACHE_NAME).map((key) => caches.delete(key)))));
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