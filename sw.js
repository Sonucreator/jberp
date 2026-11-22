const CACHE_PREFIX = 'jb-erp-static-';
const CACHE_NAME = `${CACHE_PREFIX}v3`;
const SHELL_FILES = ['./', './index.html', './manifest.json', './icon.svg'];
const STATIC_DESTINATIONS = new Set(['style', 'script', 'image', 'font', 'manifest']);
const STATIC_EXTENSIONS = /\.(?:css|js|mjs|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|otf)$/i;

function scopedUrl(path) {
  return new URL(path, self.registration.scope).href;
}

function isInScope(url, scope) {
  return url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
}

function cacheableStaticRequest(request, url) {
  if(request.headers.has('authorization') || /\/sw\.js$/i.test(url.pathname)) return false;
  return STATIC_DESTINATIONS.has(request.destination) || STATIC_EXTENSIONS.test(url.pathname);
}

async function putSafely(cache, key, response) {
  if(!response || !response.ok || response.type === 'opaque') return;
  try {
    await cache.put(key, response.clone());
  } catch(error) {
    // Quota and cache failures must not prevent the app from working online.
  }
}

async function offlineResponse() {
  return new Response('This resource is unavailable offline.', {
    status: 503,
    statusText: 'Offline',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      // Cache assets independently: a missing optional file must not abort installation.
      await Promise.all(SHELL_FILES.map(async path => {
        const url = scopedUrl(path);
        try {
          const response = await fetch(url, { cache: 'reload' });
          await putSafely(cache, url, response);
        } catch(error) {
          // Keep installing; navigation has an offline fallback when the shell is available.
        }
      }));
    } catch(error) {
      // Cache storage may be unavailable or full; do not break the online app install.
    }
    // Deliberately do not skipWaiting: open tabs/forms are never forcibly replaced.
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys
        .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map(key => caches.delete(key).catch(() => false)));
    } catch(error) {
      // Cleanup is best-effort; never touch caches outside this app's namespace.
    }
    try {
      await self.clients.claim();
    } catch(error) {
      // Claiming clients is also best-effort.
    }
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if(request.method !== 'GET') return;

  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if(!isInScope(url, scope)) return;

  if(request.mode === 'navigate') {
    event.respondWith((async () => {
      let cache;
      try {
        cache = await caches.open(CACHE_NAME);
      } catch(error) {
        try { return await fetch(request); } catch(networkError) { return offlineResponse(); }
      }

      try {
        const response = await fetch(request);
        if(response.ok && (response.headers.get('content-type') || '').includes('text/html')) {
          await putSafely(cache, scopedUrl('./index.html'), response);
        }
        return response;
      } catch(error) {
        try {
          const shell = await cache.match(scopedUrl('./index.html')) || await cache.match(scopedUrl('./'));
          return shell || offlineResponse();
        } catch(cacheError) {
          return offlineResponse();
        }
      }
    })());
    return;
  }

  if(!cacheableStaticRequest(request, url)) return;
  event.respondWith((async () => {
    let cache;
    try {
      cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if(cached) return cached;
    } catch(error) {
      // Fall through to network if Cache Storage cannot be read.
    }

    try {
      const response = await fetch(request);
      if(response.ok && cache) await putSafely(cache, request, response);
      return response;
    } catch(error) {
      if(cache) {
        try {
          const cached = await cache.match(request);
          if(cached) return cached;
        } catch(cacheError) {
          // Return a clear offline response below.
        }
      }
      return offlineResponse();
    }
  })());
});
