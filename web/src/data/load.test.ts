import { afterEach, expect, it, vi } from 'vitest';
import { loadAll } from './load';
import { getCountry } from './countries';

vi.mock('virtual:funroads-release', () => ({
  CATALOGUES: {
    'data/nl/routes.json': { file: `data/nl/routes.${'a'.repeat(64)}.json`, integrity: 'sha256-routes' },
    'data/nl/linked.json': { file: `data/nl/linked.${'b'.repeat(64)}.json`, integrity: 'sha256-linked' },
  },
}));
afterEach(() => vi.unstubAllGlobals());

it('loads the build-pinned catalogue URLs with integrity, including without a controlling worker', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), body: null, json: async () => ({}) });
  vi.stubGlobal('fetch', fetch);
  const signal = new AbortController().signal;
  await loadAll('/funroads/', undefined, getCountry('nl'), signal);
  expect(fetch).toHaveBeenCalledWith(`/funroads/data/nl/routes.${'a'.repeat(64)}.json`, { signal, integrity: 'sha256-routes' });
  expect(fetch).toHaveBeenCalledWith(`/funroads/data/nl/linked.${'b'.repeat(64)}.json`, { signal, integrity: 'sha256-linked' });
});

it('reports integrity/network failure instead of silently loading a mutable replacement', async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError('Integrity mismatch'));
  vi.stubGlobal('fetch', fetch);
  const result = await loadAll('/funroads/');
  expect(result.routes.value).toBeNull();
  expect(result.routes.error).toBe('Integrity mismatch');
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls.every(([url]) => /\.[a-f0-9]{64}\.json$/.test(url))).toBe(true);
});
