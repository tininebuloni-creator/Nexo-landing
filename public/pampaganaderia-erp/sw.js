const CACHE_NAME = 'pampaganaderia-erp-v12-privacidad';
// Rutas relativas: la web se publica en /pampaganaderia-erp/ (con "/" se guardaba y se abría la
// página de la landing en vez de la app).
const STATIC_ASSETS = [
  './',
  './index.html',
  './logo2.png',
  './manifest.webmanifest'
];

// Nota de voz compartida desde WhatsApp ("Compartir → PampaGanaderia", share_target del manifest):
// se guarda un momento acá y la app la procesa al abrirse (recibirNotaCompartida en index.html).
const SHARE_CACHE_NAME = 'pampaganaderia-compartidos';
const SHARE_KEY = './__compartido/nota-de-voz';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => Promise.all(STATIC_ASSETS.map((asset) => cache.add(asset).catch(() => null))))
  );
  self.skipWaiting();
});

// Las apps web comparten dominio (y las cachés son del dominio): cada una borra solo las suyas.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys
      .filter((key) => key.startsWith('pampaganaderia-') && key !== CACHE_NAME && key !== SHARE_CACHE_NAME)
      .map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method === 'POST' && new URL(req.url).pathname.endsWith('/compartir-nota-de-voz')) {
    event.respondWith((async () => {
      try {
        const formulario = await req.formData();
        const audio = formulario.getAll('audio').find((archivo) => archivo && archivo.size > 0);
        if (audio) {
          const cache = await caches.open(SHARE_CACHE_NAME);
          await cache.put(SHARE_KEY, new Response(audio, { headers: { 'Content-Type': audio.type || 'audio/ogg' } }));
        }
      } catch (error) {
        // Si falla la lectura, la app avisa que no llegó el audio.
      }
      return Response.redirect('./?compartido=nota-de-voz', 303);
    })());
    return;
  }
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;

  if (isSameOrigin && url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(req).catch(() => new Response(JSON.stringify({
      success: false,
      offline: true,
      message: 'Sin conexión: API no disponible.'
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 503
    })));
    return;
  }
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(fetch(req, { cache: 'no-store' }).catch(() => caches.match('./index.html')));
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (isSameOrigin && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
