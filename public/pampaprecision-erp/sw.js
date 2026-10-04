const CACHE_NAME = 'pampa-precision-v96-sync';
// Todo lo que la app necesita para abrir sin conexión desde la primera visita (mismas URLs que index.html).
const APP_SHELL = [
  './', './index.html', './manifest.webmanifest', './logo2.png', './logo-sm-esquina.png', './logo-sm-esquina.webp',
  './pampa-brand.css', './pampa-kpi.css?v=3', './shared/share-styles/global.css', './vendor/leaflet/leaflet.css',
  './vendor/pampa-licensing.js', './vendor/pampa-license-key.js', './vendor/pampa-license-verify.js', './vendor/dexie.min.js',
  './pampa-core-sync.js', './vendor/pampa-search.js?v=2', './shared/pampa-onpremise-disclaimer.js',
  './shared/core-fiscal-arca/normative-update.browser.js', './shared/core-offline/report-voice.js',
  './vendor/leaflet/leaflet.js', './offline-db.js?v=1', './agro-core.js?v=8', './agro-db.js?v=6', './agro-sync.js?v=1', './agro-ui.js?v=8',
  './sync-manager.js?v=2', './api-client.js?v=8', './sync-handlers.js?v=1', './pampaia-source.js?v=pampaia-published-6',
  './pampa-privacy-popup.js', './vendor/pampa-seat-control.js',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Uno por uno: si falta un archivo, se instala igual con el resto (y se cachea en el primer uso).
    await Promise.all(APP_SHELL.map(url => cache.add(url).catch(error => console.warn('[sw] No se pudo precachear', url, error))));
    await self.skipWaiting();
  })());
});

// Las apps web comparten dominio (y las cachés son del dominio): cada una borra solo las suyas.
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('pampa-precision-') && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

const sinConexion = () => new Response('', { status: 504, statusText: 'Sin conexión y sin copia guardada' });

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;
  // Página: primero la red (versión nueva); sin conexión, la última guardada.
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request);
        if (response.ok) (await caches.open(CACHE_NAME)).put('./index.html', response.clone());
        return response;
      } catch (error) {
        return (await caches.match('./index.html')) || sinConexion();
      }
    })());
    return;
  }
  // Datos (ejemplo, configuraciones): primero la red, así nunca quedan viejos.
  if (url.origin === self.location.origin && /\/data\//.test(url.pathname)) {
    event.respondWith(fetch(event.request).catch(async () => (await caches.match(event.request)) || sinConexion()));
    return;
  }
  // Archivos: desde la caché al instante y se actualizan en segundo plano. Si no hay copia ni red,
  // error (antes devolvía index.html y el navegador lo cargaba como si fuera un script).
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    const red = fetch(event.request).then(response => {
      const tipo = response.headers.get('content-type') || '';
      const esHtmlPorScript = /text\/html/.test(tipo) && /\.(js|css|json|png|webp|svg|woff2?)$/i.test(url.pathname);
      if (response.ok && url.origin === self.location.origin && !esHtmlPorScript) cache.put(event.request, response.clone());
      return response;
    }).catch(() => null);
    if (cached) { event.waitUntil(red); return cached; }
    return (await red) || sinConexion();
  })());
});
