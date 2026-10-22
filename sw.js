/* sw.js — Service Worker برای WMS v4.0.0 */
'use strict';

const CACHE_VERSION = 'wms-v4.0.0.ver.0.8';
const CACHE_STATIC  = CACHE_VERSION + '-static';
const CACHE_ICONS   = CACHE_VERSION + '-icons';

const STATIC_FILES = [
  './',
  './index.html',
  './admin.html',
  './manifest.json',
  './css/main.css',
  './css/admin.css',
  './js/utils.js',
  './js/storage.js',
  './js/auth.js',
  './js/ui.js',
  './js/main.js',
  './js/admin.js'
];

const ICON_FILES = [
  './icon-192.png',
  './icon-512.png'
];

/* ─────────── Install ─────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_STATIC);
      // addAll اگه یکی خطا بده کل کش رو خراب می‌کنه، پس تکی تکی اضافه می‌کنیم
      for (const url of STATIC_FILES) {
        try { await cache.add(new Request(url, { cache: 'reload' })); }
        catch (e) { console.warn('[SW] skip:', url, e.message); }
      }
      const iconCache = await caches.open(CACHE_ICONS);
      for (const url of ICON_FILES) {
        try { await iconCache.add(new Request(url, { cache: 'reload' })); }
        catch (e) { console.warn('[SW] icon skip:', url); }
      }
      self.skipWaiting();
    })()
  );
});

/* ─────────── Activate ─────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(k => k !== CACHE_STATIC && k !== CACHE_ICONS)
          .map(k => caches.delete(k))
      );
      self.clients.claim();
    })()
  );
});

/* ─────────── Fetch ─────────── */
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  /* 1) درخواست‌های GitHub API → همیشه شبکه (هرگز کش نکن) */
  if (url.hostname === 'api.github.com') {
    return; // مرورگر خودش مدیریت می‌کند
  }

  /* 2) فایل داده (data-v7.json روی raw.githubusercontent) → شبکه */
  if (url.pathname.endsWith('data-v7.json')) {
    return;
  }

  /* 3) فایل‌های استاتیک → Cache First با fallback */
  if (STATIC_FILES.some(f => url.pathname.endsWith(f.replace('./', '/')))) {
    event.respondWith(cacheFirst(req));
    return;
  }

  /* 4) آیکون‌ها → Cache First */
  if (ICON_FILES.some(f => url.pathname.endsWith(f.replace('./', '/')))) {
    event.respondWith(cacheFirst(req, CACHE_ICONS));
    return;
  }

  /* 5) ناوبری (بازکردن آدرس) → Network با fallback به index.html */
  if (req.mode === 'navigate') {
    event.respondWith(networkWithFallback(req));
    return;
  }

  /* 6) بقیه → Network First */
  event.respondWith(networkFirst(req));
});

/* ─────────── Strategies ─────────── */
async function cacheFirst(req, cacheName = CACHE_STATIC) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return new Response('آفلاین — فایل در کش نیست', { status: 503 });
  }
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const cache = await caches.open(CACHE_STATIC);
      cache.put(req, res.clone());
    }
    return res;
  } catch (e) {
    const cache = await caches.open(CACHE_STATIC);
    const hit = await cache.match(req);
    return hit || new Response('آفلاین', { status: 503 });
  }
}

async function networkWithFallback(req) {
  try {
    const res = await fetch(req);
    return res;
  } catch (e) {
    const cache = await caches.open(CACHE_STATIC);
    const hit =
      (await cache.match(req)) ||
      (await cache.match('./index.html')) ||
      (await cache.match('./'));
    return hit || new Response(
      '<h1 style="font-family:Tahoma;text-align:center;padding:40px;">⚠️ آفلاین هستید و صفحهٔ درخواستی در کش نیست.</h1>',
      { status: 200, headers: { 'Content-Type': 'text/html;charset=utf-8' } }
    );
  }
}

/* ─────────── پیام از اپ (skipWaiting اجباری) ─────────── */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
