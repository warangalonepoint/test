const CACHE = "clinic-pwa-v1";
const ASSETS = [
  "/", "/index.html", "/manifest.json",
  "/scripts/db.js",
  "/pages/bookings.html", "/pages/opd.html",
  "/pages/tokens.html", "/pages/display.html"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
  );
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);

  // HTML -> network first, fallback cache
  if (url.pathname.endsWith(".html")) {
    e.respondWith(
      fetch(e.request).then(r => {
        const copy = r.clone(); caches.open(CACHE).then(c=>c.put(e.request, copy));
        return r;
      }).catch(()=> caches.match(e.request))
    );
    return;
  }

  // Static -> cache first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(r=>{
      const copy = r.clone(); caches.open(CACHE).then(c=>c.put(e.request, copy));
      return r;
    }))
  );
});