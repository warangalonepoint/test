// public/service-worker.js
const CACHE_VER = 'clinic-pwa-v5'; // bump to invalidate
const CORE = [
  '/', '/index.html', '/dashboard.html',
  '/bookings.html', '/opd.html', '/patients.html', '/patients-history.html',
  '/pharmacy.html', '/pharmacy-sales.html', '/pharmacy-queue.html',
  '/pharmacy-inventory.html', '/inventory-barcodes.html',
  '/lab.html', '/lab-orders.html',
  '/pages/gst-report.html', '/pages/combined-invoice.html',
  '/backup.html',
  '/print/pharmacy-sale.html', '/print/pharmacy-return.html', '/print/lab-bill.html',
  '/styles/styles.css',
  '/vendor/dexie.min.js'
  // add more scripts if you’re not doing module lazy loads
];

self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(CACHE_VER).then(c=>c.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', (e)=>{
  e.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE_VER).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

// Strategy: HTML/JS - network first; assets - cache first.
self.addEventListener('fetch', (e)=>{
  const url = new URL(e.request.url);
  if(e.request.method!=='GET') return;

  const isHTML = e.request.headers.get('accept')?.includes('text/html') || url.pathname.endsWith('.html') || url.pathname==='/';
  const isAsset = url.pathname.match(/\.(css|js|png|jpg|jpeg|svg|webp|ico|json)$/);

  if(isHTML){
    e.respondWith((async ()=>{
      try{
        const net = await fetch(e.request);
        const cache = await caches.open(CACHE_VER);
        cache.put(e.request, net.clone());
        return net;
      }catch{
        const cache = await caches.match(e.request);
        return cache || caches.match('/index.html');
      }
    })());
    return;
  }

  if(isAsset){
    e.respondWith((async ()=>{
      const cacheHit = await caches.match(e.request);
      if(cacheHit) return cacheHit;
      const net = await fetch(e.request);
      const cache = await caches.open(CACHE_VER);
      cache.put(e.request, net.clone());
      return net;
    })());
    return;
  }

  // default pass-through
});
