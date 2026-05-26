// Service Worker v23 - อิ่มเอ้ย PWA + Push Notifications + pre-cache
const CACHE_NAME = 'im-oei-v26';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/orders.html',
  '/cart.html',
  '/style.css',
  '/css/index.css',
  '/css/orders.css',
  '/css/cart.css',
  '/css/global.css',
  '/logo.webp',
  '/hero.webp',
  '/icon-192.png',
  '/manifest.json',
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_ASSETS))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('firestore') || e.request.url.includes('firebase')) return;
  if (e.request.url.includes('fonts.googleapis') || e.request.url.includes('fonts.gstatic')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) {
        // Return cache ก่อน แล้ว update ในพื้นหลัง (stale-while-revalidate)
        fetch(e.request).then(res => {
          if (res && res.ok) {
            caches.open(CACHE_NAME).then(c => c.put(e.request, res.clone()));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(e.request).then(res => {
        if (res && res.ok && e.request.url.match(/\.(html|css|js|webp|png|json)$/)) {
          caches.open(CACHE_NAME).then(c => c.put(e.request, res.clone()));
        }
        return res;
      }).catch(() => caches.match('/index.html'));
    })
  );
});

// ====== PUSH: รับ push จาก server ======
self.addEventListener('push', e => {
  let data = {
    title: 'อิ่มเอ๋ย 🍱',
    body: 'มีการอัพเดทออเดอร์ของคุณ',
    icon: '/logo.webp',
    tag: 'order-update',
    url: '/orders.html'
  };
  try { if (e.data) Object.assign(data, e.data.json()); } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/logo.webp',
      badge: '/icon-192.png',
      tag: data.tag || 'order-update',
      data: { url: data.url || '/orders.html' },
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/orders.html';
  e.waitUntil(clients.openWindow(url));
});

// รับ message จาก page (heartbeat)
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'HEARTBEAT') {
    try {
      if (e.source) e.source.postMessage({ type: 'HEARTBEAT_ACK' });
    } catch(err) { /* channel closed — ปกติ */ }
  }
});
