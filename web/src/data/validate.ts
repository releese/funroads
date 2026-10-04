import {
  DIMENSIONS,
  type LinkedDoc,
  type RawCircuit,
  type RawRide,
  type RawSprint,
  type RoutesDoc,
} from './raw';
import { DEFAULT_COUNTRY, type Country } from './countries';

export class DataError extends Error {}

export interface Validated<T> {
  doc: T;
  /** Records dropped because a required field was missing or malformed. */
  dropped: { catalog: string; id: string; problem: string }[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

function isLine(v: unknown): boolean {
  return (
    Array.isArray(v) &&
    v.length >= 2 &&
    v.every((p) => Array.isArray(p) && p.length >= 2 && isNum(p[0]) && Math.abs(p[0]) <= 180 && isNum(p[1]) && Math.abs(p[1]) <= 90)
  );
}

function isRoads(v: unknown): boolean {
  return Array.isArray(v) && v.every((r) => isObj(r) && isStr(r.name) && isNum(r.km) && isNum(r.fun));
}

function hasDims(score: unknown, withTotal: boolean): boolean {
  if (!isObj(score)) return false;
  return DIMENSIONS.every((d) => isNum(score[d])) && (!withTotal || isNum(score.total));
}

function distances(v: unknown, country: Country): Record<string, number> | undefined {
  if (!isObj(v) || !country.homes.every((h) => isNum(v[h]) && v[h] >= 0)) return undefined;
  return Object.fromEntries(country.homes.map((h) => [h, v[h] as number]));
}

const isPoint = (v: unknown) => isObj(v) && isNum(v.lat) && isNum(v.lon);

function checkCountry(raw: Record<string, unknown>, country: Country): void {
  const meta = isObj(raw.meta) ? raw.meta : {};
  // Existing NL snapshots predate country/version metadata. Other countries
  // must declare it so a misplaced Dutch file cannot silently become Estonia.
  if (meta.country != null ? meta.country !== country.id : country.id !== 'nl') {
    throw new DataError(`Catalogue country does not match ${country.id}`);
  }
  if (meta.schema_version != null ? meta.schema_version !== 1 : country.id !== 'nl') {
    throw new DataError('Unsupported or missing catalogue schema_version (expected 1)');
  }
}

function checkCircuit(r: Record<string, unknown>): string | null {
  if (!isStr(r.id) || !isStr(r.name)) return 'id/name';
  if (!isNum(r.km) || !isNum(r.fun_km)) return 'km/fun_km';
  if (!isLine(r.line)) return 'line';
  if (!hasDims(r.score, true)) return 'score';
  if (!isRoads(r.roads)) return 'roads';
  if (!isStrArr(r.windows)) return 'windows';
  if (!isPoint(r.start)) return 'start';
  return null;
}

function checkSprint(r: Record<string, unknown>): string | null {
  if (!isStr(r.id) || !isStr(r.name)) return 'id/name';
  if (!isNum(r.km) || !isNum(r.fun) || !isNum(r.fun_km)) return 'km/fun';
  if (!isLine(r.line)) return 'line';
  if (!hasDims(r.score, false)) return 'score';
  if (!isRoads(r.roads)) return 'roads';
  if (!isStrArr(r.windows)) return 'windows';
  if (!isPoint(r.start) || !isPoint(r.end)) return 'start/end';
  return null;
}

function checkRide(r: Record<string, unknown>): string | null {
  if (!isStr(r.id) || !isStr(r.name)) return 'id/name';
  if (r.type !== 'open' && r.type !== 'circuit') return 'type';
  if (!isNum(r.km) || !isNum(r.fun_km)) return 'km/fun_km';
  if (!isLine(r.line)) return 'line';
  if (!hasDims(r.score, true)) return 'score';
  if (!isRoads(r.roads)) return 'roads';
  if (!isStrArr(r.windows)) return 'windows';
  return null;
}

function filterRecords<T>(
  arr: unknown,
  catalog: string,
  check: (r: Record<string, unknown>) => string | null,
  dropped: Validated<unknown>['dropped'],
): T[] {
  if (!Array.isArray(arr)) throw new DataError(`${catalog} is not a list`);
  const out: T[] = [];
  for (const item of arr) {
    if (!isObj(item)) {
      dropped.push({ catalog, id: '?', problem: 'not an object' });
      continue;
    }
    const problem = check(item);
    if (problem) dropped.push({ catalog, id: String(item.id ?? '?'), problem });
    else out.push(item as T);
  }
  return out;
}

export function validateRoutesDoc(raw: unknown, country: Country = DEFAULT_COUNTRY): Validated<RoutesDoc> {
  if (!isObj(raw)) throw new DataError('routes.json is not an object');
  checkCountry(raw, country);
  if (!Array.isArray(raw.routes) || !Array.isArray(raw.sprints)) {
    throw new DataError('routes.json lacks routes[] or sprints[]');
  }
  const dropped: Validated<unknown>['dropped'] = [];
  const doc: RoutesDoc = {
    meta: isObj(raw.meta) ? (raw.meta as RoutesDoc['meta']) : {},
    home: isObj(raw.home) ? (raw.home as RoutesDoc['home']) : undefined,
    routes: filterRecords<RawCircuit>(raw.routes, 'circuit', checkCircuit, dropped),
    sprints: filterRecords<RawSprint>(raw.sprints, 'sprint', checkSprint, dropped)
      .map((s) => ({ ...s, distance_km: distances(s.distance_km, country) } as RawSprint)),
    areas: Array.isArray(raw.areas)
      ? (raw.areas.filter((a) => isObj(a) && isStr(a.id) && isStr(a.name)) as RoutesDoc['areas'])
      : [],
    toproads: Array.isArray(raw.toproads)
      ? (raw.toproads.filter((t) => isObj(t) && isStr(t.name) && isLine(t.line)) as RoutesDoc['toproads'])
      : [],
  };
  return { doc, dropped };
}

export function validateLinkedDoc(raw: unknown, country: Country = DEFAULT_COUNTRY): Validated<LinkedDoc> {
  if (!isObj(raw)) throw new DataError('linked.json is not an object');
  checkCountry(raw, country);
  if (!Array.isArray(raw.rides)) throw new DataError('linked.json lacks rides[]');
  const dropped: Validated<unknown>['dropped'] = [];
  const rides = filterRecords<RawRide>(raw.rides, 'linked', checkRide, dropped)
    .map((r) => ({ ...r, distance_km: distances(r.distance_km, country) } as RawRide));
  const idList = (v: unknown) => (isStrArr(v) ? v : undefined);
  const profiles: LinkedDoc['profiles'] = {};
  if (isObj(raw.profiles)) {
    for (const [k, v] of Object.entries(raw.profiles)) {
      const ids = idList(v);
      if (ids && (k === 'scenic' || k === 'technical' || k === 'quiet')) profiles[k] = ids;
    }
  }
  const nearby: LinkedDoc['nearby_100km'] = {};
  if (isObj(raw.nearby_100km)) {
    for (const home of country.homes) {
      const block = raw.nearby_100km[home];
      if (!isObj(block)) continue;
      nearby[home] = {};
      for (const [k, v] of Object.entries(block)) {
        const ids = idList(v);
        if (ids && (k === 'scenic' || k === 'technical' || k === 'quiet')) nearby[home]![k] = ids;
      }
    }
  }
  return {
    doc: {
      meta: isObj(raw.meta) ? (raw.meta as LinkedDoc['meta']) : {},
      rides,
      profiles,
      nearby_100km: nearby,
    },
    dropped,
  };
}
