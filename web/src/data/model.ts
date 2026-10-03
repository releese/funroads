import {
  DIMENSIONS,
  HOMES,
  type Dimension,
  type Home,
  type LinkedDoc,
  type LinkedProfile,
  type LonLat,
  type RawDetail,
  type RawRoad,
  type RoutesDoc,
} from './raw';
import { CIRCUIT_INK, spatialInfo, TINTS } from './spatial';
import { cumulativeKm } from '../map/geo';

/** Display families. Linked loops are a different algorithm from national circuits. */
export type Kind = 'circuit' | 'linked-loop' | 'linked-open' | 'sprint';
export type Catalog = 'circuit' | 'linked' | 'sprint';

export const KIND_LABEL: Record<Kind, string> = {
  circuit: 'Circuit',
  'linked-loop': 'Linked loop',
  'linked-open': 'Linked ride',
  sprint: 'Sprint',
};

export const KIND_SHAPE: Record<Kind, string> = {
  circuit: 'Returns to start',
  'linked-loop': 'Joins high-fun stretches and returns to start',
  'linked-open': 'Joins high-fun stretches, ends elsewhere',
  sprint: 'One road, out and back only after a safe legal turn',
};

/** Map pin text per warning type; one letter was ambiguous (camera vs cyclists). */
export const STOP_PIN: Record<string, string> = { camera: 'Cam', bump: 'Bump', cyclists: 'Bike' };
export const stopPin = (type: string) => STOP_PIN[type] ?? type.charAt(0).toUpperCase();

// Catalogues built before the wording change still carry the old reason.
const LEGACY_QUIET_WHY = 'Quiet back roads, little traffic';
export const QUIET_WHY = 'Modelled as usually quiet (static estimate, not live traffic)';

/**
 * Google documents 3 waypoints for mobile browsers and 9 elsewhere. Phones get
 * the full link first; this size is the fallback.
 */
export const COMPACT_WAYPOINTS = 3;

export interface RouteProfile {
  climbM: number | null;
  cornerCount: NonNullable<RawDetail['corner_count']> | null;
  corners: NonNullable<RawDetail['corners']>;
  stops: NonNullable<RawDetail['stops']>;
  elev: NonNullable<RawDetail['elev']>;
  curv: NonNullable<RawDetail['curv']>;
  seg: NonNullable<RawDetail['seg']>;
  why: string[];
}

export interface CircuitDetail extends RouteProfile {
  areaId: string;
  areaName: string;
  flags: string[];
  /** Modeled drive from the Zaandam graph origin; there is no Haarlem value. */
  reachMinFromZaandam: number | null;
}

export interface RouteView {
  /** Catalog-prefixed so IDs from different files never collide. */
  key: string;
  id: string;
  catalog: Catalog;
  kind: Kind;
  name: string;
  km: number;
  funKm: number;
  /** 0-100 for display and UI ranking only. */
  funScore: number;
  funScoreBasis: 'route-total' | 'road-average';
  dims: Record<Dimension, number>; // 0-100
  driveMin: number | null;
  /** Straight-line km from each home; null where the data has none (circuits). */
  distanceKm: Record<Home, number> | null;
  connectorShare: number | null;
  /** Linked rides only: share driven twice in opposite directions. */
  retraceShare: number | null;
  roads: RawRoad[];
  anchorRoads: string[];
  windows: string[];
  traits: string[];
  returnNote: string | null;
  clusterId: number | null;
  start: LonLat;
  end: LonLat;
  bbox: [number, number, number, number];
  line: LonLat[];
  gmaps: string | null;
  /** Line-derived link within the mobile-browser waypoint limit. */
  gmapsCompact: string | null;
  /** 'pipeline' = link shipped in the data; 'line' = built here from the route's own line. */
  gmapsSource: 'pipeline' | 'line' | null;
  circuit: CircuitDetail | null;
  profile: RouteProfile;
  /** Linked profile lists this ride appears in (national). */
  profileLists: LinkedProfile[];
  /** Linked nearby lists per home. */
  nearbyLists: Partial<Record<Home, LinkedProfile[]>>;
  /** Lowercased road names, for exact road matching. */
  roadKeys: string[];
  /** Map colour: ink for circuits, otherwise a tint that differs from close neighbours. */
  color: string;
  /** National circuits this route runs along, by share of its own line. */
  sharesWith: { key: string; name: string; share: number }[];
}

export interface Catalogue {
  routes: RouteView[];
  byKey: Map<string, RouteView>;
  areas: RoutesDoc['areas'];
  toproads: RoutesDoc['toproads'];
  windows: string[];
  meta: { routesGenerated?: string; linkedGenerated?: string; windowsNote?: string; linkedNote?: string };
  counts: Record<Kind, number>;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function routeProfile(r: RawDetail): RouteProfile {
  return {
    climbM: typeof r.climb_m === 'number' ? r.climb_m : null,
    cornerCount: r.corner_count ?? null,
    corners: r.corners ?? [],
    stops: r.stops ?? [],
    elev: r.elev ?? [],
    curv: r.curv ?? [],
    seg: r.seg ?? [],
    why: (r.why ?? []).map((w) => (w === LEGACY_QUIET_WHY ? QUIET_WHY : w)),
  };
}

function roadKeysOf(roads: RawRoad[], anchors: string[] = []): string[] {
  return [...new Set([...roads.map((r) => r.name), ...anchors].map(roadKey).filter(Boolean))];
}

function bboxOf(line: LonLat[]): [number, number, number, number] {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of line) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

export function roadKey(name: string): string {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/** Only well-formed Google Maps direction links are offered. */
export function validGmaps(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'www.google.com' && u.pathname.startsWith('/maps/dir/')
      ? url
      : null;
  } catch {
    return null;
  }
}

/**
 * A Google Maps directions link through points of the route's own line spaced
 * evenly by distance, not by vertex count (vertices bunch up in bends). Google
 * allows 9 waypoints on desktop but only COMPACT_WAYPOINTS in mobile browsers.
 */
export function gmapsFromLine(line: LonLat[], loop: boolean, waypoints = 8): string | null {
  if (line.length < 2) return null;
  const fmt = ([lon, lat]: LonLat) => `${lat.toFixed(6)},${lon.toFixed(6)}`;
  const last = line.length - 1;
  const cum = cumulativeKm(line);
  const inner: LonLat[] = [];
  let idx = 1;
  for (let i = 1; i <= waypoints; i++) {
    const target = (i * cum[last]) / (waypoints + 1);
    while (idx < last && cum[idx] < target) idx++;
    if (idx < last && inner[inner.length - 1] !== line[idx]) inner.push(line[idx]);
  }
  const p = new URLSearchParams({
    api: '1',
    origin: fmt(line[0]),
    destination: fmt(loop ? line[0] : line[last]),
    travelmode: 'driving',
  });
  if (inner.length) p.set('waypoints', inner.map(fmt).join('|'));
  return `https://www.google.com/maps/dir/?${p.toString()}`;
}

function dims(score: Record<string, number>, scale: number): Record<Dimension, number> {
  const out = {} as Record<Dimension, number>;
  for (const d of DIMENSIONS) out[d] = round1(score[d] * scale);
  return out;
}

export function buildCatalogue(
  routesDoc: RoutesDoc | null,
  linkedDoc: LinkedDoc | null,
): Catalogue {
  const routes: RouteView[] = [];

  for (const c of routesDoc?.routes ?? []) {
    routes.push({
      key: `circuit:${c.id}`,
      id: c.id,
      catalog: 'circuit',
      kind: 'circuit',
      name: c.name,
      km: c.km,
      funKm: c.fun_km,
      funScore: c.score.total,
      funScoreBasis: 'route-total',
      dims: dims(c.score, 1),
      driveMin: typeof c.drive_min === 'number' ? c.drive_min : null,
      distanceKm: null,
      connectorShare: null,
      retraceShare: null,
      roads: c.roads,
      anchorRoads: [],
      windows: c.windows,
      traits: [],
      returnNote: null,
      clusterId: null,
      start: [c.start.lon, c.start.lat],
      end: [c.start.lon, c.start.lat],
      bbox: bboxOf(c.line),
      line: c.line,
      gmaps: validGmaps(c.links?.gmaps) ?? gmapsFromLine(c.line, true),
      gmapsCompact: gmapsFromLine(c.line, true, COMPACT_WAYPOINTS),
      gmapsSource: validGmaps(c.links?.gmaps) ? 'pipeline' : 'line',
      circuit: {
        ...routeProfile(c),
        areaId: c.area_id,
        areaName: c.area_name,
        flags: Array.isArray(c.flags) ? c.flags : [],
        reachMinFromZaandam: typeof c.reach_min === 'number' ? c.reach_min : null,
      },
      profile: routeProfile(c),
      profileLists: [],
      nearbyLists: {},
      roadKeys: roadKeysOf(c.roads),
      color: CIRCUIT_INK,
      sharesWith: [],
    });
  }

  const profileIndex = new Map<string, LinkedProfile[]>();
  for (const [p, ids] of Object.entries(linkedDoc?.profiles ?? {})) {
    for (const id of ids ?? []) profileIndex.set(id, [...(profileIndex.get(id) ?? []), p as LinkedProfile]);
  }
  const nearbyIndex = new Map<string, Partial<Record<Home, LinkedProfile[]>>>();
  for (const [home, block] of Object.entries(linkedDoc?.nearby_100km ?? {})) {
    for (const [p, ids] of Object.entries(block ?? {})) {
      for (const id of ids ?? []) {
        const entry = nearbyIndex.get(id) ?? {};
        entry[home as Home] = [...(entry[home as Home] ?? []), p as LinkedProfile];
        nearbyIndex.set(id, entry);
      }
    }
  }

  for (const r of linkedDoc?.rides ?? []) {
    const last = r.line[r.line.length - 1];
    routes.push({
      key: `linked:${r.id}`,
      id: r.id,
      catalog: 'linked',
      kind: r.type === 'circuit' ? 'linked-loop' : 'linked-open',
      name: r.name,
      km: r.km,
      funKm: r.fun_km,
      funScore: r.score.total,
      funScoreBasis: 'route-total',
      dims: dims(r.score, 1),
      driveMin: typeof r.drive_min === 'number' ? r.drive_min : null,
      distanceKm: r.distance_km ?? null,
      connectorShare: typeof r.connector_share === 'number' ? r.connector_share : null,
      retraceShare: typeof r.retrace_share === 'number' ? r.retrace_share : null,
      roads: r.roads,
      anchorRoads: r.anchor_roads ?? [],
      windows: r.windows,
      traits: [],
      returnNote: null,
      clusterId: typeof r.area === 'number' ? r.area : null,
      start: r.line[0],
      end: last,
      bbox: bboxOf(r.line),
      line: r.line,
      gmaps: gmapsFromLine(r.line, r.type === 'circuit'),
      gmapsCompact: gmapsFromLine(r.line, r.type === 'circuit', COMPACT_WAYPOINTS),
      gmapsSource: 'line',
      circuit: null,
      profile: routeProfile(r),
      profileLists: profileIndex.get(r.id) ?? [],
      nearbyLists: nearbyIndex.get(r.id) ?? {},
      roadKeys: roadKeysOf(r.roads, r.anchor_roads),
      color: CIRCUIT_INK,
      sharesWith: [],
    });
  }

  for (const s of routesDoc?.sprints ?? []) {
    routes.push({
      key: `sprint:${s.id}`,
      id: s.id,
      catalog: 'sprint',
      kind: 'sprint',
      name: s.name,
      km: s.km,
      funKm: s.fun_km,
      funScore: round1(s.fun * 100),
      funScoreBasis: 'road-average',
      dims: dims(s.score, 100),
      driveMin: typeof s.drive_min === 'number' ? s.drive_min : null,
      distanceKm: s.distance_km ?? null,
      connectorShare: null,
      retraceShare: null,
      roads: s.roads,
      anchorRoads: [],
      windows: s.windows,
      traits: Array.isArray(s.traits) ? s.traits : [],
      returnNote: typeof s.return === 'string' ? s.return : null,
      clusterId: null,
      start: [s.start.lon, s.start.lat],
      end: [s.end.lon, s.end.lat],
      bbox: bboxOf(s.line),
      line: s.line,
      // Few waypoints: sprints are short, and extra points make Google detour.
      gmaps: gmapsFromLine(s.line, false, 3),
      gmapsCompact: gmapsFromLine(s.line, false, COMPACT_WAYPOINTS),
      gmapsSource: 'line',
      circuit: null,
      profile: routeProfile(s),
      profileLists: [],
      nearbyLists: {},
      roadKeys: roadKeysOf(s.roads),
      color: CIRCUIT_INK,
      sharesWith: [],
    });
  }

  const byKey = new Map(routes.map((r) => [r.key, r]));
  const spatial = spatialInfo(
    routes.map((r) => ({ key: r.key, bbox: r.bbox, line: r.line, isCircuit: r.kind === 'circuit', rank: r.funKm })),
  );
  for (const r of routes) {
    r.color = r.kind === 'circuit' ? CIRCUIT_INK : TINTS[spatial.tint.get(r.key) ?? 0];
    r.sharesWith = (spatial.overlaps.get(r.key) ?? []).map((o) => ({ ...o, name: byKey.get(o.key)!.name }));
  }

  const windows = [...new Set(routes.flatMap((r) => r.windows))].sort();
  const counts: Record<Kind, number> = { circuit: 0, 'linked-loop': 0, 'linked-open': 0, sprint: 0 };
  for (const r of routes) counts[r.kind]++;

  return {
    routes,
    byKey,
    areas: routesDoc?.areas ?? [],
    toproads: routesDoc?.toproads ?? [],
    windows,
    meta: {
      routesGenerated: routesDoc?.meta.generated,
      linkedGenerated: linkedDoc?.meta.generated,
      windowsNote: routesDoc?.meta.windows,
      linkedNote: linkedDoc?.meta.note,
    },
    counts,
  };
}

/** Centre of a route's bounding box, used for cheap same-area similarity. */
function bboxCenter(bbox: [number, number, number, number]): LonLat {
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

/**
 * "More like this": same route form first, nearest by bbox centre, then the
 * best of the other forms nearby. Routes that largely share a line are not
 * similar, they are the same roads — those are excluded.
 */
export function similarRoutes(route: RouteView, all: RouteView[], limit = 5): RouteView[] {

  const [cx, cy] = bboxCenter(route.bbox);
  const dist = (r: RouteView) => {
    const [x, y] = bboxCenter(r.bbox);
    // Rough km scale at Dutch latitudes, good enough for ranking neighbours.
    return Math.hypot((x - cx) * 68, (y - cy) * 111);
  };
  const overlapping = new Set(route.sharesWith.filter((s) => s.share >= 0.5).map((s) => s.key));
  const candidates = all.filter((r) => r.key !== route.key && !overlapping.has(r.key));
  const scored = candidates.map((r) => ({ r, d: dist(r) + (r.kind === route.kind ? 0 : 25) }));
  scored.sort((a, b) => a.d - b.d || b.r.funScore - a.r.funScore);
  return scored.slice(0, limit).map((s) => s.r);
}

/** A curated, ranked set of routes shown as a browsable destination. */
export interface Collection {
  /** Stable id: `profile:scenic`, `nearby:quiet:Zaandam`, `circuits`. */
  id: string;
  title: string;
  description: string;
  /** Ranked route keys, in the catalogue's own ranking order. */
  keys: string[];
}

const PROFILE_TITLE: Record<LinkedProfile, string> = {
  scenic: 'Scenic linked rides',
  technical: 'Technical linked rides',
  quiet: 'Quiet linked rides',
};
const PROFILE_BLURB: Record<LinkedProfile, string> = {
  scenic: 'The highest scenery scores among linked rides nationally.',
  technical: 'The highest corner scores among linked rides nationally.',
  quiet: 'The quietest modelled linked rides nationally (static estimate, not live traffic).',
};

/**
 * Curated entry points built only from lists already present in the data:
 * the national linked-ride profile rankings, the per-home nearby rankings,
 * and the national circuits. Keys that no longer resolve are dropped.
 */
export function buildCollections(cat: Catalogue): Collection[] {
  const out: Collection[] = [];
  if (cat.counts.circuit > 0) {
    out.push({
      id: 'circuits',
      title: 'National circuits',
      description: 'The ranked national loops, 40–120 km, returning to their start.',
      keys: cat.routes.filter((r) => r.kind === 'circuit').map((r) => r.key),
    });
  }
  const seenProfiles = new Set<LinkedProfile>();
  for (const r of cat.routes) for (const p of r.profileLists) seenProfiles.add(p);
  for (const p of ['scenic', 'technical', 'quiet'] as LinkedProfile[]) {
    if (!seenProfiles.has(p)) continue;
    const keys = cat.routes
      .filter((r) => r.profileLists.includes(p))
      .sort((a, b) => b.dims[p === 'technical' ? 'corners' : p === 'scenic' ? 'scenery' : 'quiet'] - a.dims[p === 'technical' ? 'corners' : p === 'scenic' ? 'scenery' : 'quiet'])
      .map((r) => r.key);
    out.push({ id: `profile:${p}`, title: PROFILE_TITLE[p], description: PROFILE_BLURB[p], keys });
  }
  for (const home of HOMES) {
    const seen = new Set<LinkedProfile>();
    for (const r of cat.routes) for (const p of r.nearbyLists[home] ?? []) seen.add(p);
    for (const p of ['scenic', 'technical', 'quiet'] as LinkedProfile[]) {
      if (!seen.has(p)) continue;
      const keys = cat.routes
        .filter((r) => (r.nearbyLists[home] ?? []).includes(p))
        .sort((a, b) => b.dims[p === 'technical' ? 'corners' : p === 'scenic' ? 'scenery' : 'quiet'] - a.dims[p === 'technical' ? 'corners' : p === 'scenic' ? 'scenery' : 'quiet'])
        .map((r) => r.key);
      out.push({
        id: `nearby:${p}:${home}`,
        title: `${PROFILE_TITLE[p]} near ${home}`,
        description: `Top ${p === 'technical' ? 'corner' : p} linked rides within 100 km straight-line of ${home}.`,
        keys,
      });
    }
  }
  return out;
}
