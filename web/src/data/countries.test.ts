import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { belongsToCountry, countryFromLocation, countryHref, DEFAULT_COUNTRY, getCountry, rememberCountry } from './countries';
import { validateLinkedDoc, validateRoutesDoc } from './validate';
import { buildCatalogue, buildCollections } from './model';
import { applyFilters, DEFAULT_FILTERS } from './filters';
import { loadAll } from './load';
import { formatDate } from './format';
import { routeAttribution } from '../map/MapView';

const estonia = getCountry('ee');
const dimensions = { corners: 0.5, flow: 0.5, quiet: 0.5, speed: 0.5, elevation: 0.5, surface: 0.5, scenery: 0.5 };
// Synthetic contract fixtures, not a published Estonia catalogue.
const sprint = {
  id: 'same-id', name: 'Rõuge test sprint', km: 5, fun_km: 3, fun: 0.6,
  line: [[26.9, 57.73], [26.91, 57.74]], roads: [], score: dimensions,
  windows: ['2026-09-28 08:00'], start: { lon: 26.9, lat: 57.73 }, end: { lon: 26.91, lat: 57.74 },
  distance_km: { Tallinn: 220, Tartu: 65 },
};
const routes = { meta: { country: 'ee', schema_version: 1 }, routes: [], sprints: [sprint] };
const ride = {
  id: 'same-id', type: 'open', name: 'Test ride', km: 5, fun_km: 3,
  line: sprint.line, roads: [], score: { ...dimensions, total: 60 }, windows: sprint.windows,
  distance_km: sprint.distance_km,
};
const linked = {
  meta: { country: 'ee', schema_version: 1 }, rides: [ride],
  nearby_100km: { Tartu: { quiet: ['same-id'] }, Zaandam: { quiet: ['same-id'] } },
};

beforeEach(() => { localStorage.clear(); history.replaceState(null, '', '/'); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); history.replaceState(null, '', '/'); });

it('selects an explicit country without changing default Netherlands links', () => {
  history.replaceState(null, '', '/funroads/?country=ee#route=ee:sprint:same-id');
  expect(countryFromLocation().id).toBe('ee');
  history.replaceState(null, '', '/funroads/');
  expect(countryFromLocation('Europe/Amsterdam').id).toBe('nl');
  expect(() => getCountry('../nl')).toThrow('Unsupported country');
  history.replaceState(null, '', '/?country=unknown');
  expect(() => countryFromLocation()).toThrow('Unsupported country');
});

it.each([
  ['Europe/Tallinn', 'ee'], ['Europe/Amsterdam', 'nl'], ['Europe/Helsinki', 'nl'], ['UTC', 'nl'],
])('uses a first-visit timezone hint without asking for location (%s)', (timezone, expected) => {
  expect(countryFromLocation(timezone).id).toBe(expected);
  expect(localStorage.getItem('funroads:country:v1')).toBeNull();
});

it('remembers a manual country choice ahead of timezone hints but never ahead of explicit URLs', () => {
  rememberCountry('nl');
  expect(countryFromLocation('Europe/Tallinn').id).toBe('nl');
  rememberCountry('ee');
  expect(countryFromLocation('Europe/Amsterdam').id).toBe('ee');
  history.replaceState(null, '', '/?country=nl');
  expect(countryFromLocation('Europe/Tallinn').id).toBe('nl');
  expect(localStorage.getItem('funroads:country:v1')).toBe('ee');
});

it('ignores invalid saved choices and keeps navigation working without storage', () => {
  localStorage.setItem('funroads:country:v1', '__proto__');
  expect(countryFromLocation('Europe/Tallinn').id).toBe('ee');
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('Storage blocked'); });
  expect(() => rememberCountry('nl')).not.toThrow();
  expect(countryFromLocation('Europe/Tallinn').id).toBe('ee');
  history.replaceState(null, '', '/?country=nl');
  expect(countryFromLocation('Europe/Tallinn').id).toBe('nl');
});

it('switches country with a same-page link, preserving queries but clearing foreign route context', () => {
  const current = 'https://example.test/funroads/?country=nl&qa=check#route=sprint%3Asame-id&detail=1';
  expect(countryHref('ee', current)).toBe('/funroads/?country=ee&qa=check');
  expect(countryHref('nl', 'https://example.test/funroads/?country=ee#route=ee:sprint:same-id'))
    .toBe('/funroads/?country=nl');
});

it('normalizes both countries into the same route model, without colliding saved IDs', () => {
  const ee = buildCatalogue(validateRoutesDoc(routes, estonia).doc, validateLinkedDoc(linked, estonia).doc, estonia);
  const nl = buildCatalogue(validateRoutesDoc({
    ...routes, meta: {}, sprints: [{ ...sprint, distance_km: { Zaandam: 10, Haarlem: 20 } }],
  }).doc, null);
  expect(ee.country.id).toBe('ee');
  expect(ee.routes.find((r) => r.kind === 'sprint')).toMatchObject({
    key: 'ee:sprint:same-id', funScore: 60, dims: { corners: 50 }, distanceKm: { Tallinn: 220, Tartu: 65 },
  });
  expect(nl.routes[0].key).toBe('sprint:same-id');
  expect(belongsToCountry(nl.routes[0].key, estonia)).toBe(false);
  expect(belongsToCountry(ee.routes[0].key, DEFAULT_COUNTRY)).toBe(false);
  expect(applyFilters(ee.routes, { ...DEFAULT_FILTERS, home: 'Tartu', scope: 'nearby' }).results).toHaveLength(2);
  expect(buildCollections(ee).map((c) => c.id)).toContain('nearby:quiet:Tartu');
  expect(buildCollections(ee).map((c) => c.id)).not.toContain('nearby:quiet:Zaandam');
});

it('rejects wrong-country, unversioned and unsupported catalogues without a Netherlands fallback', () => {
  expect(() => validateRoutesDoc(routes)).toThrow('country');
  expect(() => validateRoutesDoc({ ...routes, meta: {} }, estonia)).toThrow('country');
  expect(() => validateRoutesDoc({ ...routes, meta: { country: 'ee' } }, estonia)).toThrow('schema_version');
  expect(() => validateLinkedDoc({ ...linked, meta: { country: 'ee', schema_version: 2 } }, estonia)).toThrow('schema_version');
});

it('does not mutate source records or turn invalid origin distances into zero', () => {
  const input = { ...routes, sprints: [{ ...sprint, distance_km: { Tallinn: -1, Tartu: 65 } }] };
  const original = structuredClone(input);
  const ee = buildCatalogue(validateRoutesDoc(input, estonia).doc, null, estonia);
  expect(input).toEqual(original);
  expect(ee.routes[0].distanceKm).toBeNull();
  expect(applyFilters(ee.routes, { ...DEFAULT_FILTERS, home: 'Tartu', scope: 'nearby' }).results).toEqual([]);
});

it('rejects projected coordinates at the WGS84 catalogue boundary', () => {
  const { dropped } = validateRoutesDoc({ ...routes, sprints: [{ ...sprint, line: [[575468, 6556276], [575469, 6556277]] }] }, estonia);
  expect(dropped).toEqual([{ catalog: 'sprint', id: 'same-id', problem: 'line' }]);
});

it('loads only the selected country and keeps catalogue failures independent', async () => {
  const fetcher = vi.fn(async (url: string) => ({
    ok: !url.endsWith('linked.json'), status: 404, body: null,
    headers: { get: () => null }, json: async () => structuredClone(routes),
  }));
  vi.stubGlobal('fetch', fetcher);
  const outcome = await loadAll('/funroads/', undefined, estonia);
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    '/funroads/data/ee/routes.json', '/funroads/data/ee/linked.json',
  ]);
  expect(outcome.routes.value?.doc.sprints).toHaveLength(1);
  expect(outcome.linked.error).toContain('404');
  const nl = await loadAll('/funroads/');
  expect(nl.routes.error).toContain('country');
});

it('uses country-specific timezone and attribution rather than Dutch sources', () => {
  const instant = '2026-01-01T22:30:00Z';
  expect(formatDate(instant, estonia.timezone)).toBe('2 January 2026');
  expect(formatDate(instant)).toBe('1 January 2026');
  expect(routeAttribution(estonia)).toContain('https://www.openstreetmap.org/copyright');
  expect(routeAttribution(estonia)).not.toMatch(/WKD|NDW|CBS|AHN/);
});

it('cancels both country downloads with the supplied signal', async () => {
  const controller = new AbortController();
  const fetcher = vi.fn((_url: string, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
  }));
  vi.stubGlobal('fetch', fetcher);
  const loading = loadAll('/', undefined, estonia, controller.signal);
  controller.abort();
  const outcome = await loading;
  expect(fetcher.mock.calls.every(([, options]) => options?.signal === controller.signal)).toBe(true);
  expect(outcome.routes).toEqual({ value: null, error: expect.stringContaining('Cancelled') });
  expect(outcome.linked).toEqual({ value: null, error: expect.stringContaining('Cancelled') });
});
