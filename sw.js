const CACHE_PREFIX = 'jb-erp-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v3`;
const APP_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-192.svg',
  './icon-512.svg'
];
const STATIC_FILES = new Set([
  'index.html',
  'manifest.json',
  'icon.svg',
  'icon-192.svg',
  'icon-512.svg'
]);
const APP_SCOPE = new URL(self.registration.scope);
const APP_HOME = new URL('./', APP_SCOPE).href;
const APP_INDEX = new URL('index.html', APP_SCOPE).href;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('Authorization') || request.credentials === 'include') return;

  const url = new URL(request.url);
  if (url.origin !== APP_SCOPE.origin || !url.pathname.startsWith(APP_SCOPE.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        const isAppShell = !url.search && (url.href === APP_HOME || url.href === APP_INDEX);
        const cacheControl = response.headers.get('Cache-Control') || '';
        const cacheable = isAppShell && response.ok && response.type === 'basic' &&
          response.headers.get('Content-Type')?.toLowerCase().includes('text/html') &&
          !/private|no-store/i.test(cacheControl) &&
          !response.headers.has('Set-Cookie') && response.redirected === false;
        if (cacheable) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(APP_INDEX, response.clone());
        }
        return response;
      } catch (error) {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(APP_INDEX) || await cache.match(APP_HOME);
        if (cached) return cached;
        throw error;
      }
    })());
    return;
  }

  if (url.search || !STATIC_FILES.has(url.pathname.slice(APP_SCOPE.pathname.length))) return;
  const cacheKey = request;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request);
      const cacheControl = response.headers.get('Cache-Control') || '';
      if (response.ok && response.type === 'basic' && !/private|no-store/i.test(cacheControl) && !response.headers.has('Set-Cookie')) {
        await cache.put(cacheKey, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
      throw error;
    }
  })());
});
