/* sw.js — Service Worker برای WMS v4.2.0 */
'use strict';

const CACHE_VERSION = 'wms-v4.2.0';
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

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_STATIC);
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

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter(k => k !== CACHE_STATIC && k !== CACHE_ICONS).map(k => caches.delete(k))
      );
      self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  if (url.hostname === 'api.github.com') return;
  if (url.pathname.endsWith('data-v7.json')) return;

  if (STATIC_FILES.some(f => url.pathname.endsWith(f.replace('./', '/')))) {
    event.respondWith(networkFirstStatic(req));
    return;
  }
  if (ICON_FILES.some(f => url.pathname.endsWith(f.replace('./', '/')))) {
    event.respondWith(cacheFirst(req, CACHE_ICONS));
    return;
  }
  if (req.mode === 'navigate') {
    event.respondWith(networkFirstStatic(req));
    return;
  }
  event.respondWith(networkFirst(req));
});

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

async function networkFirstStatic(req) {
  const cache = await caches.open(CACHE_STATIC);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req);
    if (hit) return hit;
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

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_CACHES') {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      if (event.source) event.source.postMessage('CACHES_CLEARED');
    })());
  }
});