import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_COUNTRY, getCountry } from './countries';
import { DEFAULT_FILTERS } from './filters';
import { readBrowsingState, saveBrowsingState, type BrowsingState } from './browsing-state';

const value: BrowsingState = {
  filters: { ...DEFAULT_FILTERS, home: 'Haarlem', profile: 'scenic', sort: 'nearest',
    type: ['circuit', 'sprint'], search: { kind: 'road', name: 'Test Road', key: 'test-road' }, minFun: 65 },
  favOnly: true, collectionId: 'scenic', shown: 120, sheetOpen: true, browseScroll: 450, detailScroll: 220,
};
beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

it('restores filters, ranking, pagination and scroll positions exactly once', () => {
  saveBrowsingState(DEFAULT_COUNTRY, value);
  expect(readBrowsingState(DEFAULT_COUNTRY)).toEqual(value);
  expect(readBrowsingState(DEFAULT_COUNTRY)).toBeNull();
});

it('does not reuse another country or URL context', () => {
  saveBrowsingState(DEFAULT_COUNTRY, value);
  expect(readBrowsingState(getCountry('ee'))).toBeNull();
  saveBrowsingState(DEFAULT_COUNTRY, value);
  const raw = JSON.parse(sessionStorage.getItem('funroads:update-state:v1')!);
  raw.url += '#other';
  sessionStorage.setItem('funroads:update-state:v1', JSON.stringify(raw));
  expect(readBrowsingState(DEFAULT_COUNTRY)).toBeNull();
});

it.each([
  { shown: -1 }, { browseScroll: '450' }, { filters: { ...value.filters, home: 'Unknown' } },
  { filters: { ...value.filters, sort: 'unknown' } }, { filters: { ...value.filters, minFun: null } },
  { filters: { ...value.filters, search: { kind: 'road', name: 'Test' } } },
])('rejects malformed snapshots: %j', (patch) => {
  saveBrowsingState(DEFAULT_COUNTRY, { ...value, ...patch } as BrowsingState);
  expect(readBrowsingState(DEFAULT_COUNTRY)).toBeNull();
});

it('expires old snapshots and tolerates unavailable storage', () => {
  saveBrowsingState(DEFAULT_COUNTRY, value);
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 25 * 60 * 60 * 1000);
  expect(readBrowsingState(DEFAULT_COUNTRY)).toBeNull();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Denied'); });
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Denied'); });
  expect(() => saveBrowsingState(DEFAULT_COUNTRY, value)).not.toThrow();
  expect(readBrowsingState(DEFAULT_COUNTRY)).toBeNull();
});
