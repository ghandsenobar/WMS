/* ============ Service Worker — انبار صنوبر ============ */
const CACHE_NAME = 'senobar-warehouse-v4';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

/* نصب: کش کردن فایل‌های پایه */
self.addEventListener('install', event => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Cache addAll failed:', err))
  );
});

/* فعال‌سازی: پاک کردن کش‌های قدیمی */
self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

/* دریافت: استراتژی Network-First برای GitHub API، Cache-First برای بقیه */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  /* درخواست‌های GitHub API → همیشه آنلاین */
  if (url.hostname === 'api.github.com') {
    return; // از کش استفاده نکن، مستقیم برو آنلاین
  }

  /* فایل‌های خود اپ → Cache-First با fallback */
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) {
          /* پس‌زمینه: آپدیت کش (Stale-While-Revalidate) */
          fetch(event.request).then(response => {
            if (response && response.status === 200) {
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, response.clone());
              });
            }
          }).catch(() => {});
          return cached;
        }
        /* اگه توی کش نبود، از شبکه بگیر */
        return fetch(event.request).then(response => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, clone);
            });
          }
          return response;
        }).catch(() => {
          /* آفلاین: اگه index.html خواست، بده از کش */
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
    );
  }
});

/* پیام‌ها از صفحه اصلی */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
