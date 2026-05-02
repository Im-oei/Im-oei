// Service Worker v21 - อิ่มเอ้ย PWA + Push Notifications
const CACHE_NAME = 'im-oei-v21';

// ไฟล์ HTML และ JS สำคัญ — ไม่ cache เลย ดึงจาก network เสมอ
const NO_CACHE = ['.html', 'admin', 'index', 'config.js', 'sw.js'];

self.addEventListener('install', e => { self.skipWaiting(); });

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => {
        console.log('[SW] Deleting old cache:', k);
        return caches.delete(k);
      }))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('firestore') || e.request.url.includes('firebase')) return;

  // HTML และไฟล์สำคัญ — network เสมอ ไม่ fallback cache
  const url = e.request.url;
  const skipCache = NO_CACHE.some(p => url.includes(p));
  if (skipCache) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }).catch(() =>
        new Response('Offline', { status: 503 })
      )
    );
    return;
  }

  // รูปภาพและ assets อื่น — network-first, fallback cache
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
// ====== PUSH: รับ push จาก server ======
self.addEventListener('push', e => {
  let data = {
    title: 'อิ่มเอ้ย 🍱',
    body: 'มีการอัพเดทออเดอร์ของคุณ',
    icon: '/logo.webp',
    tag: 'order-update',
    url: '/orders.html'
  };
  try { if (e.data) data = { ...data, ...e.data.json() }; } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/logo.webp',
      badge: '/logo.webp',
      tag: data.tag,
      data: { url: data.url },
      vibrate: [200, 100, 200, 100, 200],
      requireInteraction: false
    })
  );
});

// ====== LOCAL NOTIFY: รับข้อความจาก page ======
// Admin ส่ง postMessage มาเพื่อ show notification บน device อื่น
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SHOW_NOTIFICATION') {
    const d = e.data;
    self.registration.showNotification(d.title || 'อิ่มเอ้ย', {
      body: d.body || '',
      icon: '/logo.webp',
      badge: '/logo.webp',
      tag: d.tag || 'notify',
      data: { url: d.url || '/' },
      vibrate: [200, 100, 200],
      requireInteraction: d.requireInteraction || false
    });
  }
  // Broadcast ไปยัง client อื่นๆ (เช่น admin tab อื่น)
  if (e.data && e.data.type === 'BROADCAST') {
    self.clients.matchAll({ includeUncontrolled: true }).then(clients => {
      clients.forEach(c => { if (c !== e.source) c.postMessage(e.data); });
    });
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/orders.html';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // โฟกัสหน้าต่างที่มีอยู่แล้ว
      for (const c of list) {
        if (c.url.includes(url.split('?')[0]) && 'focus' in c) return c.focus();
      }
      // เปิดหน้าต่างใหม่
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
