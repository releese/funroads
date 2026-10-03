import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const site = new URL('../../site/', import.meta.url);
test('publishes only current build files and a complete, matching offline version', () => {
  const sw = readFileSync(new URL('sw.js', site), 'utf8');
  const context = { self: { registration: { scope: 'https://example.org/funroads/' }, addEventListener() {} }, URL };
  vm.createContext(context);
  vm.runInContext(`${sw}\nglobalThis.entries = ENTRIES;`, context);
  const files = readdirSync(site, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${entry.parentPath.replaceAll('\\', '/')}/${entry.name}`);
  assert.equal(files.length, context.entries.length + 1);
  const worker = context.entries.find(({ file }) => /assets\/maplibre-gl-worker-[^/]+\.js$/.test(file));
  assert(worker, 'MapLibre worker must be bundled and included in the offline cache');
  const scripts = context.entries.filter(({ file }) => /assets\/index-[^/]+\.js$/.test(file));
  assert(scripts.some(({ file }) => readFileSync(new URL(file, site), 'utf8')
    .includes(worker.file.split('/').at(-1))), 'App must reference the bundled worker');
  for (const { file, integrity } of context.entries) {
    const bytes = readFileSync(new URL(file, site));
    assert.equal(integrity, `sha256-${createHash('sha256').update(bytes).digest('base64')}`);
    assert(!file.includes('demo') && !file.endsWith('.md'));
  }
  for (const file of ['routes.json', 'linked.json']) {
    assert.deepEqual(readFileSync(new URL(`data/${file}`, site)),
      readFileSync(new URL(`../../data/cache/${file}`, import.meta.url)));
  }
  const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', site), 'utf8'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const bytes = readFileSync(new URL(icon.src, site));
    const size = Number(icon.sizes.split('x')[0]);
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
  }
  const html = readFileSync(new URL('index.html', site), 'utf8');
  assert(html.includes('href="./manifest.webmanifest"'));
  assert(html.includes('src="./assets/'));
});
