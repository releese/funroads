import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const entries = ['index.html', 'assets/app.js', 'data/nl/routes.json', 'data/nl/linked.json']
  .map((file) => ({ file, integrity: 'sha256-test' }));
const scope = 'https://example.org/funroads/';
const prefix = `funroads:${scope}:`;
const template = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');

function worker(fail = false, workerEntries = entries) {
  const handlers = {};
  const stores = new Map([[`${prefix}old`, new Map()], ['another-app', new Map()]]);
  const requests = [];
  const clients = [];
  let skipped = 0;
  let claimed = 0;
  const registration = { scope, installing: null, waiting: null };
  const caches = {
    async open(key) {
      if (!stores.has(key)) stores.set(key, new Map());
      const store = stores.get(key);
      return {
        put: async (url, response) => store.set(url, response),
        match: async (url) => {
          const response = store.get(url);
          return response?.clone ? response.clone() : response;
        },
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (key) => stores.delete(key),
  };
  const restart = () => vm.runInNewContext(template.replace('__VERSION__', '"new"').replace('__BUILD_ID__', '"new-build"')
    .replace('__ENTRIES__', JSON.stringify(workerEntries)), {
    URL, Response, caches,
    self: {
      registration, addEventListener: (name, fn) => { handlers[name] = fn; },
      skipWaiting: async () => { skipped++; },
      clients: { claim: async () => { claimed++; }, matchAll: async () => clients },
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (fail && url.endsWith('linked.json')) throw new Error('integrity/network failure');
      return { ok: true, url };
    },
  });
  restart();
  const lifecycle = (name) => {
    let result;
    handlers[name]({ waitUntil: (promise) => { result = promise; } });
    return result;
  };
  const request = (url, mode = 'cors', method = 'GET') => {
    let result;
    handlers.fetch({ request: { url, mode, method }, respondWith: (promise) => { result = promise; } });
    return result;
  };
  const offlineStatus = (country = 'nl') => {
    let result;
    let response;
    handlers.message({
      data: { type: 'OFFLINE_STATUS', country },
      ports: [{ postMessage: (value) => { response = value; } }],
      waitUntil: (promise) => { result = promise; },
    });
    return result.then(() => response);
  };
  const message = (data, client) => {
    let result;
    handlers.message({ data, source: client, waitUntil: (promise) => { result = promise; } });
    return result;
  };
  return { stores, requests, lifecycle, request, offlineStatus, message, clients, registration, restart,
    get skipped() { return skipped; }, get claimed() { return claimed; } };
}

test('installs a complete integrity-checked version without activating over an open app', async () => {
  const w = worker();
  await w.lifecycle('install');
  assert.equal(w.stores.get(`${prefix}new`).size, entries.length);
  assert(w.stores.has(`${prefix}old`));
  assert(w.requests.every(({ url, options }) => url.startsWith(scope)
    && options.cache === 'reload' && options.integrity === 'sha256-test'));
  assert.equal(w.skipped, 0, 'Install must never activate an incomplete or unrequested release');
  await w.lifecycle('activate');
  assert.equal(w.claimed, 1);
  assert(!w.stores.has(`${prefix}old`));
  assert(w.stores.has('another-app'));
});

test('reuses unchanged verified immutable catalogues and assets without downloading them again', async () => {
  const routes = { file: `data/nl/routes.${'a'.repeat(64)}.json`, integrity: 'sha256-routes' };
  const linked = { file: `data/nl/linked.${'b'.repeat(64)}.json`, integrity: 'sha256-linked' };
  const asset = { file: 'assets/font-unchanged.woff2', integrity: 'sha256-font' };
  const w = worker(false, [entries[0], routes, linked, asset]);
  for (const { file } of [routes, linked, asset]) {
    const url = `${scope}${file}`;
    w.stores.get(`${prefix}old`).set(url, { ok: true, url });
  }
  await w.lifecycle('install');
  assert.equal(w.requests.length, 1);
  assert.equal(w.requests[0].url, `${scope}index.html`, 'Only the mutable shell must be fetched');
  assert.equal(w.stores.get(`${prefix}new`).size, 4);
  assert.equal((await w.offlineStatus()).ready, true);
});

test('downloads a changed content-hashed catalogue instead of reusing its previous version', async () => {
  const routes = { file: `data/nl/routes.${'b'.repeat(64)}.json`, integrity: 'sha256-new-routes' };
  const w = worker(false, [routes]);
  const old = `${scope}data/nl/routes.${'a'.repeat(64)}.json`;
  w.stores.get(`${prefix}old`).set(old, { ok: true, url: old });
  await w.lifecycle('install');
  assert.equal(w.requests.length, 1);
  assert.equal(w.requests[0].url, `${scope}${routes.file}`);
  assert.equal(w.requests[0].options.integrity, routes.integrity);
});

test('failed catalogue install discards only the incomplete version', async () => {
  const w = worker(true);
  await assert.rejects(w.lifecycle('install'));
  assert(!w.stores.has(`${prefix}new`));
  assert(w.stores.has(`${prefix}old`));
});

test('serves project-path navigations and catalogues offline, not external tiles or other apps', async () => {
  const w = worker();
  await w.lifecycle('install');
  w.requests.length = 0;
  assert.equal((await w.request(`${scope}?installed=1`, 'navigate')).url, `${scope}index.html`);
  assert.equal((await w.request(`${scope}data/nl/routes.json`)).url, `${scope}data/nl/routes.json`);
  assert.equal(w.requests.length, 0);
  assert.equal(w.request('https://tiles.openfreemap.org/style'), undefined);
  assert.equal(w.request('https://example.org/other/', 'navigate'), undefined);
  assert.equal(w.request(`${scope}data/nl/routes.json`, 'cors', 'POST'), undefined);
});

test('reports offline readiness only while every versioned entry exists', async () => {
  const w = worker();
  assert.deepEqual(JSON.parse(JSON.stringify(await w.offlineStatus())), { type: 'OFFLINE_STATUS', country: 'nl', ready: false, version: 'new', build: 'new-build' });
  await w.lifecycle('install');
  assert.equal((await w.offlineStatus()).ready, true);
  w.stores.get(`${prefix}new`).delete(`${scope}data/nl/linked.json`);
  assert.equal((await w.offlineStatus()).ready, false);
});

test('activates only an explicitly requested, complete matching version', async () => {
  const w = worker();
  await w.message({ type: 'ACTIVATE_UPDATE', version: 'new' });
  assert.equal(w.skipped, 0);
  await w.lifecycle('install');
  await w.message({ type: 'ACTIVATE_UPDATE', version: 'other' });
  assert.equal(w.skipped, 0);
  await w.message({ type: 'ACTIVATE_UPDATE', version: 'new' });
  assert.equal(w.skipped, 1);
  w.stores.get(`${prefix}new`).delete(`${scope}data/nl/linked.json`);
  await w.message({ type: 'ACTIVATE_UPDATE', version: 'new' });
  assert.equal(w.skipped, 1);
});

test('retains old immutable files for suspended tabs, then cleans only scoped unused caches', async () => {
  const w = worker();
  const awake = { id: 'awake', url: scope };
  const sleeping = { id: 'sleeping', url: `${scope}?country=nl` };
  w.clients.push(awake, sleeping);
  const oldData = `${scope}data/nl/routes.${'a'.repeat(64)}.json`;
  const oldAsset = `${scope}assets/old-app.js`;
  w.stores.get(`${prefix}old`).set(oldData, { ok: true, url: oldData });
  w.stores.get(`${prefix}old`).set(oldAsset, { ok: true, url: oldAsset });
  await w.lifecycle('install');
  await w.lifecycle('activate');
  assert(w.stores.has(`${prefix}old`));
  assert.equal((await w.request(oldData)).url, oldData);
  assert.equal((await w.request(oldAsset)).url, oldAsset);
  await w.message({ type: 'CLIENT_BUILD', build: 'new-build' }, awake);
  assert(w.stores.has(`${prefix}old`));
  await w.message({ type: 'CLIENT_BUILD', build: 'old-build' }, sleeping);
  assert(w.stores.has(`${prefix}old`));
  await w.message({ type: 'CLIENT_BUILD', build: 'new-build' }, sleeping);
  assert(!w.stores.has(`${prefix}old`));
  assert(w.stores.has('another-app'));
});

test('uses integrity-checked recovery if an entry was evicted, never mutable new data', async () => {
  const w = worker();
  await w.lifecycle('install');
  w.stores.get(`${prefix}new`).delete(`${scope}index.html`);
  await w.request(scope, 'navigate');
  assert.equal(w.requests.at(-1).options.cache, 'reload');
  assert.equal(w.requests.at(-1).options.integrity, 'sha256-test');
});

test('remembers retired versions across worker restarts without deleting newer caches', async () => {
  const w = worker();
  const client = { id: 'current', url: scope };
  w.clients.push(client);
  await w.lifecycle('install');
  await w.lifecycle('activate');
  assert(w.stores.has(`${prefix}old`));
  w.stores.set(`${prefix}newer-release`, new Map());
  w.restart();
  await w.message({ type: 'CLIENT_BUILD', build: 'new-build' }, client);
  assert(!w.stores.has(`${prefix}old`));
  assert(w.stores.has(`${prefix}newer-release`));
  assert(w.stores.has('another-app'));
});

test('does not clean a release that is still installing or waiting', async () => {
  const w = worker();
  const client = { id: 'current', url: scope };
  w.clients.push(client);
  await w.lifecycle('install');
  for (const state of ['installing', 'waiting']) {
    w.stores.set(`${prefix}future`, new Map());
    w.registration[state] = {};
    await w.message({ type: 'CLIENT_BUILD', build: 'new-build' }, client);
    assert(w.stores.has(`${prefix}future`));
    w.registration[state] = null;
  }
});

test('does not claim an unpublished country is available offline', async () => {
  const w = worker();
  await w.lifecycle('install');
  assert.equal((await w.offlineStatus('nl')).ready, true);
  assert.equal((await w.offlineStatus('ee')).ready, false);
  assert.equal(w.request(`${scope}data/ee/routes.json`), undefined);
  assert.equal((await w.request(`${scope}?country=ee`, 'navigate')).url, `${scope}index.html`);
});
