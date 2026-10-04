// v2: el index.html de v1 quedó cacheado con el guard de escritorio (bloqueaba el trial web)
const CACHE_NAME = 'pampatopografia-pwa-v6-sin-instalar';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './logo2.png',
  './topo.jfif',
  './Planilla_Relevamiento_Topografico.xlsx',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/layers-2x.png'
];

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
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key.startsWith('pampatopografia-') && key !== CACHE_NAME) return caches.delete(key);
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // La página siempre desde la red (así un index.html corregido llega apenas se publica);
  // la copia en caché solo se usa sin conexión.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      // cache: 'no-cache' obliga a revalidar con el servidor aunque la caché HTTP tenga una copia
      fetch(event.request.url, { cache: 'no-cache', credentials: 'same-origin' }).then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
        }
        return response;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request).then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        }).catch(() => cached)
      );
    })
  );
});
