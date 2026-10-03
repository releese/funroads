const VERSION = __VERSION__;
const ENTRIES = __ENTRIES__;
const SCOPE = self.registration.scope;
const PREFIX = `funroads:${SCOPE}:`;
const CACHE = `${PREFIX}${VERSION}`;
const URLS = new Set(ENTRIES.map(({ file }) => new URL(file, SCOPE).href));

// Integrity binds every resource to this build, including mutable catalogue URLs.
// No skipWaiting: an update takes over only after the old app has closed.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      for (const { file, integrity } of ENTRIES) {
        const url = new URL(file, SCOPE).href;
        const response = await fetch(url, { cache: 'reload', integrity });
        if (!response.ok) throw new Error(`Offline install failed: ${file}`);
        await cache.put(url, response);
      }
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    }
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== new URL(SCOPE).origin) return;
  const navigation = request.mode === 'navigate' && url.pathname.startsWith(new URL(SCOPE).pathname);
  const target = navigation ? new URL('index.html', SCOPE).href : url.href;
  if (!URLS.has(target)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return await cache.match(target) || fetch(request);
  })());
});
