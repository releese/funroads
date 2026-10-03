import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const entries = ['index.html', 'assets/app.js', 'data/routes.json', 'data/linked.json']
  .map((file) => ({ file, integrity: 'sha256-test' }));
const scope = 'https://example.org/funroads/';
const prefix = `funroads:${scope}:`;
const source = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8')
  .replace('__VERSION__', '"new"').replace('__ENTRIES__', JSON.stringify(entries));

function worker(fail = false) {
  const handlers = {};
  const stores = new Map([[`${prefix}old`, new Map()], ['another-app', new Map()]]);
  const requests = [];
  const caches = {
    async open(key) {
      if (!stores.has(key)) stores.set(key, new Map());
      const store = stores.get(key);
      return { put: async (url, response) => store.set(url, response), match: async (url) => store.get(url) };
    },
    keys: async () => [...stores.keys()],
    delete: async (key) => stores.delete(key),
  };
  vm.runInNewContext(source, {
    URL, caches,
    self: { registration: { scope }, addEventListener: (name, fn) => { handlers[name] = fn; } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (fail && url.endsWith('linked.json')) throw new Error('integrity/network failure');
      return { ok: true, url };
    },
  });
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
  return { stores, requests, lifecycle, request };
}

test('installs a complete integrity-checked version without activating over an open app', async () => {
  const w = worker();
  await w.lifecycle('install');
  assert.equal(w.stores.get(`${prefix}new`).size, entries.length);
  assert(w.stores.has(`${prefix}old`));
  assert(w.requests.every(({ url, options }) => url.startsWith(scope)
    && options.cache === 'reload' && options.integrity === 'sha256-test'));
  assert(!source.includes('self.skipWaiting('));
  await w.lifecycle('activate');
  assert(!w.stores.has(`${prefix}old`));
  assert(w.stores.has('another-app'));
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
  assert.equal((await w.request(`${scope}data/routes.json`)).url, `${scope}data/routes.json`);
  assert.equal(w.requests.length, 0);
  assert.equal(w.request('https://tiles.openfreemap.org/style'), undefined);
  assert.equal(w.request('https://example.org/other/', 'navigate'), undefined);
  assert.equal(w.request(`${scope}data/routes.json`, 'cors', 'POST'), undefined);
});
