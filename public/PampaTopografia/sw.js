// v2: el index.html de v1 quedó cacheado con el guard de escritorio (bloqueaba el trial web)
const CACHE_NAME = 'pampatopografia-pwa-v3-separada';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './logo2.png',
  './topo.jfif',
  './Planilla_Relevamiento_Topografico.xlsx'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // cache: 'reload' evita copiar al precache una versión vieja que haya quedado en la caché HTTP
      Promise.all(APP_SHELL.map((asset) => cache.add(new Request(asset, { cache: 'reload' })).catch(() => null)))
    )
  );
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
