import definitions from '../../countries.json';

export type CountryId = keyof typeof definitions;
export interface Country {
  id: CountryId;
  name: string;
  timezone: string;
  bounds: [number, number, number, number];
  homes: string[];
  reachOrigin: string | null;
  searchExample: string;
  sourceSummary: string;
  quietDescription: string;
  attribution: string;
  coverage?: string;
  sourceLinks?: { label: string; url: string }[];
}

export function getCountry(id: string): Country {
  if (!Object.prototype.hasOwnProperty.call(definitions, id)) throw new Error(`Unsupported country: ${id}`);
  const definition = definitions[id as CountryId];
  return { ...definition, id: id as CountryId, bounds: [...definition.bounds] as Country['bounds'] };
}

export const DEFAULT_COUNTRY = getCountry('nl');
export const COUNTRIES = Object.keys(definitions).map(getCountry);

/** Keep country links usable offline and under a deployment subpath. */
export function countryHref(id: CountryId, current = window.location.href): string {
  const url = new URL(current);
  url.searchParams.set('country', getCountry(id).id);
  url.hash = '';
  return url.pathname + url.search;
}

export function countryFromLocation(): Country {
  return getCountry(new URLSearchParams(window.location.search).get('country') ?? 'nl');
}

/** Preserve existing Netherlands links and saved keys; new countries are namespaced. */
export function routeKey(country: Country, catalog: string, id: string): string {
  return `${country.id === 'nl' ? '' : `${country.id}:`}${catalog}:${id}`;
}

export function belongsToCountry(key: string, country: Country): boolean {
  return country.id === 'nl'
    ? /^(circuit|linked|sprint):/.test(key)
    : key.startsWith(`${country.id}:`);
}
