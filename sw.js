// Service worker: la app funciona sin conexión una vez abierta.
// Cambia VERSION cada vez que publiques cambios para que los móviles se actualicen.
const VERSION = 'quatri-v0.42';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'icon.svg', 'data/eseiaat-2026-27-q1.json', 'data/temarios-eseiaat.json', 'data/evaluacion-eseiaat.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Avisos: llegan del servidor aunque la app esté cerrada
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Quatri', body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Quatri', {
    body: d.body || '', icon: 'icon-192.png', badge: 'icon-192.png', data: { url: d.url || './' }, tag: d.tag
  }));
});
// Tocar un aviso abre Quatri (o la trae al frente si ya estaba abierta)
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    const w = ws.find(x => x.url.startsWith(self.registration.scope));
    if (w) { w.focus(); return w.navigate ? w.navigate(url) : null; }
    return clients.openWindow(url);
  }));
});

// Red primero (para tener siempre lo último) y caché si no hay conexión.
// cache: 'no-cache' obliga a preguntar al servidor, aunque GitHub Pages diga que guarde 10 minutos.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request.url, { cache: 'no-cache' }).then(r => {
      const copy = r.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request))
  );
});
