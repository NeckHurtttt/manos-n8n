// Guarda la app y los modelos de MediaPipe para que funcione sin internet.
const CACHE = 'mqh-v4';
const APP = ['./', 'index.html', 'style.css', 'app.js', 'ml.js', 'store.js', 'config.js', 'idiomas.js', 'avatar.js', 'lsb.js', 'dactilologia.js', 'icono.svg', 'manifest.webmanifest', 'modelo/abecedario-formas.json', 'modelo/lsb-villca-v4.onnx'];
const EXTERNOS = ['cdn.jsdelivr.net', 'storage.googleapis.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(APP)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co')) return;                 // datos del equipo: siempre en vivo
  if (EXTERNOS.includes(url.hostname)) {                            // librerías y modelos: primero la copia guardada
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin === location.origin) {                             // la app: red primero, copia si no hay red
    e.respondWith(fetch(req).then(res => {
      if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
  }
});
