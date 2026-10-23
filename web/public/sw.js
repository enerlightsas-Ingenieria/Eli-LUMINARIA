/* Service worker de ELI-LUMINARIA: la app queda lista para usarse SIN CONEXIÓN desde la primera visita.
 * - Al instalarse descarga TODOS los archivos de la app (lista en precache.json, generada en cada compilación).
 * - Páginas: red primero (máx. 3 s: con señal débil no hace esperar), si no, la versión guardada.
 * - Archivos propios (JS/CSS/íconos): caché primero.
 * - NO toca peticiones a otros orígenes (proxy de IA, hojas, mapas): las maneja la app con su propia lógica sin conexión.
 * La versión (?v=…) la pone el registro; al cambiar, se instala la nueva y se borran las cachés viejas. */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = 'eli-' + VERSION;
const ESPERA_RED_MS = 3000;
// Muchos servidores marcan las respuestas con "Vary: Origin"; los <script type=module> piden con cabecera Origin y la precarga no la llevó:
// sin ignoreVary el service worker no reconocería su propia copia y la app no abriría sin conexión.
const BUSCAR = { ignoreVary: true };

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    let archivos = ['./', './manifest.webmanifest'];
    try {
      const r = await fetch('./precache.json', { cache: 'no-store' });
      if (r.ok) archivos = (await r.json()).archivos || archivos;
    } catch (_) { /* sin lista: al menos la página */ }
    // 'reload': nunca guarda una copia vieja del caché HTTP del navegador
    await cache.addAll(archivos.map((a) => new Request(a, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith('eli-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const r = await Promise.race([
          fetch(req),
          new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('lenta')), ESPERA_RED_MS)),
        ]);
        if (r.ok) cache.put('./', r.clone());
        return r;
      } catch (_) {
        return (await cache.match('./', BUSCAR)) || (await cache.match('./index.html', BUSCAR)) || Response.error();
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const guardado = await cache.match(req, BUSCAR);
    if (guardado) return guardado;
    try {
      const r = await fetch(req);
      if (r.ok) cache.put(req, r.clone());
      return r;
    } catch (_) {
      return Response.error();
    }
  })());
});
