/* Service worker de ELI-LUMINARIA: la app abre sin conexión una vez cargada.
 * - Páginas (navegación): red primero; si no hay red, la versión guardada.
 * - Archivos estáticos propios (JS/CSS/íconos): caché primero, se actualizan en segundo plano.
 * - NO toca peticiones a otros orígenes (proxy de IA, hojas, mapas): esas las maneja la app con su propia lógica sin conexión.
 * La versión (?v=…) la pone el registro; al cambiar, se borran las cachés viejas. */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = 'eli-' + VERSION;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './manifest.webmanifest'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('eli-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((r) => { const copia = r.clone(); caches.open(CACHE).then((c) => c.put('./', copia)); return r; })
        .catch(() => caches.match('./').then((r) => r || caches.match(req))),
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => {
      const red = fetch(req).then((r) => {
        if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); }
        return r;
      }).catch(() => hit);
      return hit || red;
    }),
  );
});
