import type { Home } from './raw';
import type { Kind, RouteView } from './model';

export type TypeTab = 'all' | 'circuit' | 'linked' | 'sprint';
export type LinkedShape = 'any' | 'open' | 'loop';
export type Profile = 'balanced' | 'scenic' | 'technical' | 'quiet';
export type SortKey = 'profile' | 'funKm' | 'score' | 'shortest' | 'longest' | 'nearest';
export type Scope = 'nearby' | 'national';

export type SearchSelection =
  | { kind: 'road'; name: string; key: string }
  | { kind: 'area'; id: string; name: string };

export interface Filters {
  home: Home;
  scope: Scope;
  /** Straight-line view radius; only used in the nearby scope. Never a mining limit. */
  radiusKm: number;
  type: TypeTab;
  linkedShape: LinkedShape;
  profile: Profile;
  sort: SortKey;
  search: SearchSelection | null;
  kmMin: number;
  kmMax: number;
  maxDriveMin: number | null;
  window: string | null;
  minScenery: number;
  minQuiet: number;
  minCorners: number;
}

export const NEARBY_KM = 100;
export const KM_LIMITS = { min: 0, max: 120 };

export const DEFAULT_FILTERS: Filters = {
  home: 'Zaandam',
  scope: 'national',
  radiusKm: NEARBY_KM,
  type: 'all',
  linkedShape: 'any',
  profile: 'balanced',
  sort: 'profile',
  search: null,
  kmMin: KM_LIMITS.min,
  kmMax: KM_LIMITS.max,
  maxDriveMin: null,
  window: null,
  minScenery: 0,
  minQuiet: 0,
  minCorners: 0,
};

export const PROFILE_LABEL: Record<Profile, string> = {
  balanced: 'Balanced',
  scenic: 'Scenic',
  technical: 'Technical',
  quiet: 'Quiet',
};

export function typeMatches(kind: Kind, f: Pick<Filters, 'type' | 'linkedShape'>): boolean {
  switch (f.type) {
    case 'all':
      return true;
    case 'circuit':
      return kind === 'circuit';
    case 'sprint':
      return kind === 'sprint';
    case 'linked':
      return (kind === 'linked-open' || kind === 'linked-loop') && linkedShapeOk(kind, f.linkedShape);
  }
}

function linkedShapeOk(kind: Kind, shape: LinkedShape): boolean {
  return shape === 'any' || (shape === 'open' ? kind === 'linked-open' : kind === 'linked-loop');
}

/**
 * Why a route is not in the current results. Empty means it matches.
 * Filters only hide already-eligible routes; they never make anything legal.
 */
export function exclusionReasons(r: RouteView, f: Filters): string[] {
  const out: string[] = [];
  if (!typeMatches(r.kind, f)) out.push('Its route type is not selected');
  if (f.scope === 'nearby') {
    const d = r.distanceKm?.[f.home];
    if (d == null) out.push(`The data has no straight-line distance from ${f.home} for this route type`);
    else if (d > f.radiusKm) out.push(`It is ${d} km straight-line from ${f.home}, beyond ${f.radiusKm} km`);
  }
  if (f.search?.kind === 'road' && !r.roadKeys.includes(f.search.key)) out.push(`${f.search.name} is not among its main or anchor roads`);
  if (f.search?.kind === 'area' && r.circuit?.areaId !== f.search.id) out.push(`It is not in ${f.search.name}`);
  if (r.km < f.kmMin || r.km > f.kmMax) out.push(`Its length (${r.km} km) is outside ${f.kmMin}–${f.kmMax} km`);
  if (f.maxDriveMin != null) {
    if (r.driveMin == null) out.push('Its drive time is unknown');
    else if (r.driveMin > f.maxDriveMin) out.push(`Its drive time (${r.driveMin} min) is over ${f.maxDriveMin} min`);
  }
  if (f.window && !r.windows.includes(f.window)) out.push('It was not accessible in the chosen sample window');
  if (r.dims.scenery < f.minScenery) out.push(`Scenery ${r.dims.scenery} is below ${f.minScenery}`);
  if (r.dims.quiet < f.minQuiet) out.push(`Quiet ${r.dims.quiet} is below ${f.minQuiet}`);
  if (r.dims.corners < f.minCorners) out.push(`Corners ${r.dims.corners} is below ${f.minCorners}`);
  return out;
}

function profileValue(r: RouteView, p: Profile): number {
  switch (p) {
    case 'balanced':
      return r.funKm;
    case 'scenic':
      return r.dims.scenery;
    case 'technical':
      return r.dims.corners;
    case 'quiet':
      return r.dims.quiet;
  }
}

export function compareRoutes(f: Pick<Filters, 'sort' | 'profile' | 'home'>) {
  return (a: RouteView, b: RouteView): number => {
    let d = 0;
    switch (f.sort) {
      case 'profile':
        d = profileValue(b, f.profile) - profileValue(a, f.profile) || b.funKm - a.funKm;
        break;
      case 'funKm':
        d = b.funKm - a.funKm;
        break;
      case 'score':
        d = b.funScore - a.funScore;
        break;
      case 'shortest':
        d = a.km - b.km;
        break;
      case 'longest':
        d = b.km - a.km;
        break;
      case 'nearest': {
        // Unknown distance sorts last rather than being treated as 0 km.
        const da = a.distanceKm?.[f.home] ?? Infinity;
        const db = b.distanceKm?.[f.home] ?? Infinity;
        d = da === db ? 0 : da - db;
        break;
      }
    }
    return d || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  };
}

export interface FilterResult {
  results: RouteView[];
  /** Routes of the selected type(s) hidden only because a field is missing. */
  hiddenNoDistance: number;
  hiddenNoDrive: number;
  typeCounts: Record<TypeTab, number>;
}

export function applyFilters(all: RouteView[], f: Filters): FilterResult {
  const results: RouteView[] = [];
  let hiddenNoDistance = 0;
  let hiddenNoDrive = 0;
  const typeCounts: Record<TypeTab, number> = { all: 0, circuit: 0, linked: 0, sprint: 0 };
  const noType = { ...f, type: 'all' as TypeTab };
  for (const r of all) {
    const reasons = exclusionReasons(r, noType);
    if (reasons.length === 0) {
      typeCounts.all++;
      typeCounts[r.catalog]++;
      if (typeMatches(r.kind, f)) results.push(r);
      continue;
    }
    if (!typeMatches(r.kind, f)) continue;
    if (reasons.length === 1 && f.scope === 'nearby' && r.distanceKm == null) hiddenNoDistance++;
    if (reasons.length === 1 && f.maxDriveMin != null && r.driveMin == null) hiddenNoDrive++;
  }
  results.sort(compareRoutes(f));
  return { results, hiddenNoDistance, hiddenNoDrive, typeCounts };
}

export interface ActivePill {
  id: keyof Filters | 'kmRange';
  label: string;
}

export function activePills(f: Filters, formatWindow: (w: string) => string): ActivePill[] {
  const pills: ActivePill[] = [];
  if (f.scope === 'nearby') pills.push({ id: 'scope', label: `Within ${f.radiusKm} km straight-line of ${f.home}` });
  if (f.search) pills.push({ id: 'search', label: f.search.kind === 'road' ? `Road: ${f.search.name}` : `Area: ${f.search.name}` });
  if (f.linkedShape !== 'any' && f.type === 'linked')
    pills.push({ id: 'linkedShape', label: f.linkedShape === 'open' ? 'Linked: ends elsewhere' : 'Linked: returns to start' });
  if (f.kmMin !== DEFAULT_FILTERS.kmMin || f.kmMax !== DEFAULT_FILTERS.kmMax)
    pills.push({ id: 'kmRange', label: `${f.kmMin}–${f.kmMax} km long` });
  if (f.maxDriveMin != null) pills.push({ id: 'maxDriveMin', label: `Drive ≤ ${f.maxDriveMin} min` });
  if (f.window) pills.push({ id: 'window', label: `Sampled ${formatWindow(f.window)}` });
  if (f.minScenery) pills.push({ id: 'minScenery', label: `Scenery ≥ ${f.minScenery}` });
  if (f.minQuiet) pills.push({ id: 'minQuiet', label: `Quiet ≥ ${f.minQuiet}` });
  if (f.minCorners) pills.push({ id: 'minCorners', label: `Corners ≥ ${f.minCorners}` });
  return pills;
}

export function clearPill(f: Filters, id: ActivePill['id']): Filters {
  switch (id) {
    case 'kmRange':
      return { ...f, kmMin: DEFAULT_FILTERS.kmMin, kmMax: DEFAULT_FILTERS.kmMax };
    case 'scope':
      return { ...f, scope: 'national' };
    default:
      return { ...f, [id]: DEFAULT_FILTERS[id] };
  }
}

/** Reset filters but keep the chosen home, which is a preference rather than a filter. */
export function resetFilters(f: Filters): Filters {
  return { ...DEFAULT_FILTERS, home: f.home };
}
