import {
  DIMENSIONS,
  HOMES,
  type LinkedDoc,
  type RawCircuit,
  type RawRide,
  type RawSprint,
  type RoutesDoc,
} from './raw';

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
    v.every((p) => Array.isArray(p) && p.length >= 2 && isNum(p[0]) && isNum(p[1]))
  );
}

function isRoads(v: unknown): boolean {
  return Array.isArray(v) && v.every((r) => isObj(r) && isStr(r.name) && isNum(r.km) && isNum(r.fun));
}

function hasDims(score: unknown, withTotal: boolean): boolean {
  if (!isObj(score)) return false;
  return DIMENSIONS.every((d) => isNum(score[d])) && (!withTotal || isNum(score.total));
}

function hasHomes(v: unknown): boolean {
  return isObj(v) && HOMES.every((h) => isNum(v[h]));
}

const isPoint = (v: unknown) => isObj(v) && isNum(v.lat) && isNum(v.lon);

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

export function validateRoutesDoc(raw: unknown): Validated<RoutesDoc> {
  if (!isObj(raw)) throw new DataError('routes.json is not an object');
  if (!Array.isArray(raw.routes) || !Array.isArray(raw.sprints)) {
    throw new DataError('routes.json lacks routes[] or sprints[]');
  }
  const dropped: Validated<unknown>['dropped'] = [];
  const doc: RoutesDoc = {
    meta: isObj(raw.meta) ? (raw.meta as RoutesDoc['meta']) : {},
    home: isObj(raw.home) ? (raw.home as RoutesDoc['home']) : undefined,
    routes: filterRecords<RawCircuit>(raw.routes, 'circuit', checkCircuit, dropped),
    sprints: filterRecords<RawSprint>(raw.sprints, 'sprint', checkSprint, dropped),
    areas: Array.isArray(raw.areas)
      ? (raw.areas.filter((a) => isObj(a) && isStr(a.id) && isStr(a.name)) as RoutesDoc['areas'])
      : [],
    toproads: Array.isArray(raw.toproads)
      ? (raw.toproads.filter((t) => isObj(t) && isStr(t.name) && isLine(t.line)) as RoutesDoc['toproads'])
      : [],
  };
  for (const s of doc.sprints) {
    // Missing distances make the sprint unknown for nearby views, not zero km.
    if (!hasHomes(s.distance_km)) (s as { distance_km?: unknown }).distance_km = undefined;
  }
  return { doc, dropped };
}

export function validateLinkedDoc(raw: unknown): Validated<LinkedDoc> {
  if (!isObj(raw)) throw new DataError('linked.json is not an object');
  if (!Array.isArray(raw.rides)) throw new DataError('linked.json lacks rides[]');
  const dropped: Validated<unknown>['dropped'] = [];
  const rides = filterRecords<RawRide>(raw.rides, 'linked', checkRide, dropped);
  for (const r of rides) {
    if (!hasHomes(r.distance_km)) (r as { distance_km?: unknown }).distance_km = undefined;
  }
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
    for (const home of HOMES) {
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
