import type { Country } from './countries';
import { DEFAULT_FILTERS, ROUTE_TYPES, type Filters } from './filters';

const KEY = 'funroads:update-state:v1';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface BrowsingState {
  filters: Filters;
  favOnly: boolean;
  collectionId: string | null;
  shown: number;
  sheetOpen: boolean;
  browseScroll: number;
  detailScroll: number;
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const number = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000;
const text = (value: unknown): value is string => typeof value === 'string' && value.length <= 2000;
const choice = (value: unknown, choices: readonly string[]) => typeof value === 'string' && choices.includes(value);

function validFilters(value: unknown, country: Country): value is Filters {
  if (!record(value) || !choice(value.home, country.homes)
    || !choice(value.scope, ['nearby', 'national'])
    || !choice(value.linkedShape, ['any', 'open', 'loop'])
    || !choice(value.profile, ['balanced', 'scenic', 'technical', 'quiet'])
    || !choice(value.sort, ['profile', 'funKm', 'score', 'shortest', 'longest', 'nearest'])
    || !(Array.isArray(value.type)
      ? value.type.length <= ROUTE_TYPES.length && value.type.every((type) => choice(type, ROUTE_TYPES))
      : choice(value.type, ['all', ...ROUTE_TYPES]))) return false;
  if (!['radiusKm', 'kmMin', 'kmMax', 'minFun', 'minScenery', 'minQuiet', 'minCorners'].every((key) => number(value[key]))
    || (value.maxDriveMin !== null && !number(value.maxDriveMin))) return false;
  const search = value.search;
  return search === null || (record(search) && text(search.name)
    && ((search.kind === 'road' && text(search.key)) || (search.kind === 'area' && text(search.id))));
}

/** A one-shot, tab-local handoff, not a permanent preference or cross-tab state. */
export function readBrowsingState(country: Country): BrowsingState | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!raw) return null;
    const saved: unknown = JSON.parse(raw);
    if (!record(saved) || saved.country !== country.id || saved.url !== location.href) return null;
    if (typeof saved.at !== 'number' || !Number.isFinite(saved.at)
      || Date.now() - saved.at < 0 || Date.now() - saved.at > MAX_AGE_MS) return null;
    const value = saved.value;
    if (!record(value) || !validFilters(value.filters, country)
      || typeof value.favOnly !== 'boolean' || typeof value.sheetOpen !== 'boolean'
      || !(value.collectionId === null || text(value.collectionId))
      || !number(value.shown) || !Number.isInteger(value.shown) || value.shown < 1
      || !number(value.browseScroll) || !number(value.detailScroll)) return null;
    // Drop unknown properties from stored data before handing it to the UI.
    const storedFilters = value.filters;
    const filters = Object.fromEntries(Object.keys(DEFAULT_FILTERS).map((key) => [key, storedFilters[key as keyof Filters]])) as unknown as Filters;
    return {
      filters, favOnly: value.favOnly, collectionId: value.collectionId,
      shown: value.shown, sheetOpen: value.sheetOpen,
      browseScroll: value.browseScroll, detailScroll: value.detailScroll,
    };
  } catch {
    return null;
  }
}

export function saveBrowsingState(country: Country, value: BrowsingState): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ country: country.id, url: location.href, at: Date.now(), value }));
  } catch { /* Reloading a verified release does not depend on optional storage. */ }
}
