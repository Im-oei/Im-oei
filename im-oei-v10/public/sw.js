
// Service Worker v22 - อิ่มเอ้ย PWA + Push Notifications + pushJobs
const CACHE_NAME = 'im-oei-v22';

self.addEventListener('install', e => { self.skipWaiting(); });

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
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

// ====== PUSH: รับ push จาก server (Web Push Protocol) ======
self.addEventListener('push', e => {
  let data = {
    title: 'อิ่มเอ๋ย 🍱',
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
self.addEventListener('message', e => {
  // Admin / page ส่ง push ตรง
  if (e.data && e.data.type === 'SHOW_NOTIFICATION') {
    const d = e.data;
    self.registration.showNotification(d.title || 'อิ่มเอ๋ย', {
      body: d.body || '',
      icon: '/logo.webp',
      badge: '/logo.webp',
      tag: d.tag || 'notify',
      data: { url: d.url || '/orders.html' },
      vibrate: [200, 100, 200],
      requireInteraction: d.requireInteraction || false
    });
  }

  // Page บอก SW ว่า "ผู้ใช้กำลังเปิดหน้าอยู่" — SW จะไม่ต้อง showNotification ซ้ำ
  if (e.data && e.data.type === 'PAGE_VISIBLE') {
    self._pageVisible = true;
    // reset หลัง 30 วิ (กันกรณีหน้า close โดยไม่แจ้ง)
    clearTimeout(self._pageVisibleTimer);
    self._pageVisibleTimer = setTimeout(() => { self._pageVisible = false; }, 30000);
  }

  // ORDER_STATUS_UPDATE จาก Cloud Function / pushJob dispatcher → forward ไปยัง page ที่เปิดอยู่
  if (e.data && e.data.type === 'ORDER_STATUS_UPDATE') {
    self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(clients => {
      if (clients.length) {
        // มี page เปิดอยู่ → forward message ให้ page จัดการ (toast + sound)
        clients.forEach(c => c.postMessage(e.data));
      } else {
        // ไม่มี page → แสดง notification แทน
        self.registration.showNotification(e.data.title || 'อิ่มเอ๋ย 🍱', {
          body: e.data.body || 'สถานะออเดอร์เปลี่ยนแล้ว',
          icon: '/logo.webp',
          badge: '/logo.webp',
          tag: 'order-' + (e.data.orderId || 'update'),
          data: { url: e.data.url || '/orders.html' },
          vibrate: [200, 100, 200, 100, 200],
          requireInteraction: false
        });
      }
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
