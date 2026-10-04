import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogueFiles, publishedCatalogues } from '../catalogues.mjs';

test('packages complete country pairs without moving the legacy Netherlands inputs', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'funroads-countries-'));
  try {
    const files = catalogueFiles(root);
    assert.equal(files.length, 4);
    assert(files.find(({ file }) => file === 'data/nl/routes.json').source.endsWith(path.join('data', 'cache', 'routes.json')));
    const write = (country, name, meta) => {
      const { source } = files.find((entry) => entry.country === country && entry.file.endsWith(name));
      mkdirSync(path.dirname(source), { recursive: true });
      writeFileSync(source, JSON.stringify({ meta }));
    };
    assert.throws(() => publishedCatalogues(root), /Incomplete nl catalogue/);
    for (const name of ['routes.json', 'linked.json']) write('nl', name, {});
    assert.deepEqual(publishedCatalogues(root).map(({ country }) => country), ['nl', 'nl']);
    write('ee', 'routes.json', { country: 'ee', schema_version: 1 });
    assert.throws(() => publishedCatalogues(root), /Incomplete ee catalogue/);
    write('ee', 'linked.json', { country: 'ee', schema_version: 1 });
    assert.equal(publishedCatalogues(root).length, 4);
    write('ee', 'linked.json', { country: 'nl', schema_version: 1 });
    assert.throws(() => publishedCatalogues(root), /country mismatch/);
    write('ee', 'linked.json', { country: 'ee', schema_version: 2 });
    assert.throws(() => publishedCatalogues(root), /schema_version/);
  } finally {
    // Only the temporary directory created by this test is removed.
    rmSync(root, { recursive: true, force: true });
  }
});
