const VERSION = __VERSION__;
const BUILD_ID = __BUILD_ID__;
const ENTRIES = __ENTRIES__;
const SCOPE = self.registration.scope;
const PREFIX = `funroads:${SCOPE}:`;
const CACHE = `${PREFIX}${VERSION}`;
const URLS = new Set(ENTRIES.map(({ file }) => new URL(file, SCOPE).href));
const CLIENT_BUILDS = new Map();
const RETIRED_RECORD = new URL('.retired-caches', SCOPE).href;
const immutableFile = (file) => /^assets\//.test(file)
  || /^data\/[^/]+\/(?:routes|linked)\.[a-f0-9]{64}\.json$/.test(file);

// Integrity binds every resource to this build, including catalogue files.
// Only a verified, explicit ACTIVATE_UPDATE message can replace an open app.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      for (const { file, integrity } of ENTRIES) {
        const url = new URL(file, SCOPE).href;
        let response;
        // Content-addressed URLs were already verified at their installation.
        // Reuse unchanged data/fonts/assets instead of downloading them again.
        if (immutableFile(file)) {
          for (const key of await caches.keys()) {
            if (!key.startsWith(PREFIX) || key === CACHE) continue;
            const cached = await (await caches.open(key)).match(url);
            if (cached?.ok) { response = cached; break; }
          }
        }
        response ??= await fetch(url, { cache: 'reload', integrity });
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
    const retired = [];
    if (!self.registration.installing && !self.registration.waiting) {
      for (const key of await caches.keys()) {
        if (key.startsWith(PREFIX) && key !== CACHE) retired.push(key);
      }
    }
    await (await caches.open(CACHE)).put(RETIRED_RECORD, new Response(JSON.stringify(retired)));
    await self.clients.claim();
    await cleanUnusedCaches();
  })());
});

async function complete() {
  if (!(await caches.keys()).includes(CACHE)) return false;
  const cache = await caches.open(CACHE);
  const responses = await Promise.all([...URLS].map((url) => cache.match(url)));
  return responses.every((response) => response?.ok);
}

async function cleanUnusedCaches() {
  // A waiting/installing release owns another cache too; never remove it.
  if (self.registration.installing || self.registration.waiting) return;
  const clients = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
    .filter((client) => client.url.startsWith(SCOPE));
  // Keep older immutable assets for sleeping tabs until every live app reports
  // this build. Unknown clients (including legacy apps) prevent cleanup.
  if (clients.some((client) => CLIENT_BUILDS.get(client.id) !== BUILD_ID)) return;
  // Only retire caches captured at this worker's activation. A late task in a
  // replaced worker must never delete a newer release's cache.
  // Persist the fixed retirement list in our own cache: worker globals can be
  // discarded between messages, but that must not strand retired versions.
  const cache = await caches.open(CACHE);
  const record = await cache.match(RETIRED_RECORD);
  const retired = record ? await record.json() : [];
  for (const key of retired) {
    if (typeof key === 'string' && key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
  }
  if (retired.length) await cache.put(RETIRED_RECORD, new Response('[]'));
}

// Readiness is verified against the complete version, not navigator.onLine.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'ACTIVATE_UPDATE') {
    event.waitUntil((async () => {
      if (event.data.version === VERSION && await complete()) await self.skipWaiting();
    })());
    return;
  }
  if (event.data?.type === 'CLIENT_BUILD' && event.source?.id) {
    CLIENT_BUILDS.set(event.source.id, event.data.build);
    event.waitUntil(cleanUnusedCaches());
    return;
  }
  if (event.data?.type !== 'OFFLINE_STATUS' || !event.ports?.[0]) return;
  event.waitUntil((async () => {
    let ready = false;
    const country = event.data.country ?? 'nl';
    try {
      const countryFiles = ENTRIES.filter(({ file }) => file.startsWith(`data/${country}/`));
      ready = ['routes', 'linked'].every((name) => countryFiles.some(({ file }) =>
        new RegExp(`/${name}(?:\\.[a-f0-9]{64})?\\.json$`).test(file))) && await complete();
    } catch { /* Storage can be disabled or evicted. */ }
    event.ports[0].postMessage({ type: 'OFFLINE_STATUS', country, ready, version: VERSION, build: BUILD_ID });
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== new URL(SCOPE).origin) return;
  const navigation = request.mode === 'navigate' && url.pathname.startsWith(new URL(SCOPE).pathname);
  const target = navigation ? new URL('index.html', SCOPE).href : url.href;
  const scoped = target.startsWith(SCOPE);
  const immutable = scoped && immutableFile(target.slice(SCOPE.length));
  if (!URLS.has(target) && !immutable) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const response = await cache.match(target);
    if (response) return response;
    if (immutable) {
      for (const key of await caches.keys()) {
        if (!key.startsWith(PREFIX) || key === CACHE) continue;
        const old = await (await caches.open(key)).match(target);
        if (old) return old;
      }
    }
    const entry = ENTRIES.find(({ file }) => new URL(file, SCOPE).href === target);
    return entry ? fetch(target, { cache: 'reload', integrity: entry.integrity }) : fetch(request);
  })());
});
