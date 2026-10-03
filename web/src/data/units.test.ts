import { describe, expect, it } from 'vitest';
import { DataError, validateLinkedDoc, validateRoutesDoc } from './validate';
import {
  buildCatalogue,
  buildCollections,
  COMPACT_WAYPOINTS,
  gmapsFromLine,
  QUIET_WHY,
  roadKey,
  similarRoutes,
  stopPin,
  validGmaps,
  type RouteView,
} from './model';
import { activePills, applyFilters, clearPill, DEFAULT_FILTERS, resetFilters, typeMatches } from './filters';
import { loadFavoriteNames, loadFavorites, saveFavoriteNames, saveFavorites, toggleFavorite } from './favorites';
import { buildSearchIndex, searchSuggestions } from './search';
import { CIRCUIT_INK, OVERLAP_MIN_SHARE, spatialInfo, TINTS, type SpatialItem } from './spatial';
import { formatWindow } from './format';
import { visibleLines } from '../map/geo';
import { groupStops } from '../components/RouteDetail';

const score = { corners: 0.5, flow: 0.5, quiet: 0.5, speed: 0.5, elevation: 0.5, surface: 0.5, scenery: 0.5 };
const sprint = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Road ${id} Sprint`,
  km: 5,
  fun: 0.6,
  fun_km: 3,
  line: [
    [4.8, 52.4],
    [4.81, 52.41],
  ],
  score,
  roads: [{ name: `Road ${id}`, km: 5, fun: 0.6 }],
  windows: ['2026-09-28 08:00'],
  start: { lat: 52.4, lon: 4.8 },
  end: { lat: 52.41, lon: 4.81 },
  distance_km: { Zaandam: 10, Haarlem: 20 },
  ...extra,
});

describe('validation', () => {
  it('rejects documents without the core lists', () => {
    expect(() => validateRoutesDoc({ routes: [] })).toThrow(DataError);
    expect(() => validateLinkedDoc(null)).toThrow(DataError);
  });

  it('drops malformed records individually and reports them', () => {
    const { doc, dropped } = validateRoutesDoc({
      routes: [],
      sprints: [sprint('a'), sprint('b', { line: [[4.8, 52.4]] }), 'junk'],
    });
    expect(doc.sprints.map((s) => s.id)).toEqual(['a']);
    expect(dropped.map((d) => d.problem)).toEqual(['line', 'not an object']);
  });

  it('turns an incomplete distance into unknown rather than zero', () => {
    const { doc } = validateRoutesDoc({ routes: [], sprints: [sprint('a', { distance_km: { Zaandam: 3 } })] });
    const cat = buildCatalogue(doc, null);
    expect(cat.routes[0].distanceKm).toBeNull();
    const nearby = applyFilters(cat.routes, { ...DEFAULT_FILTERS, scope: 'nearby' });
    expect(nearby.results).toEqual([]);
    expect(nearby.hiddenNoDistance).toBe(1);
  });
});

describe('model helpers', () => {
  it('accepts only https Google Maps direction links', () => {
    expect(validGmaps('https://www.google.com/maps/dir/52.1,4.8/52.2,4.9')).not.toBeNull();
    expect(validGmaps('http://www.google.com/maps/dir/1,2')).toBeNull();
    expect(validGmaps('https://evil.example/maps/dir/1,2')).toBeNull();
    expect(validGmaps('javascript:alert(1)')).toBeNull();
    expect(validGmaps(undefined)).toBeNull();
  });

  it('normalises road names for matching', () => {
    expect(roadKey('  Rijksstraatweg ')).toBe('rijksstraatweg');
    expect(roadKey('Café-laan')).toBe('cafe-laan');
  });

  it('scales sprint road fun to 0-100', () => {
    const { doc } = validateRoutesDoc({ routes: [], sprints: [sprint('a', { drive_min: 6 })] });
    const [r] = buildCatalogue(doc, null).routes;
    expect(r.funScore).toBe(60);
    expect(r.funScoreBasis).toBe('road-average');
    expect(r.dims.corners).toBe(50);
    expect(r.driveMin).toBe(6);
  });

  it('shows generated detail on sprints and linked rides without treating them as national circuits', () => {
    const detail = {
      climb_m: 12,
      corner_count: { tight: 0, sweet: 2, flowing: 1 },
      corners: [{ dir: 'L', lon: 4.8, lat: 52.4, r: 80, v: 40 }],
      stops: [{ type: 'bump', lon: 4.8, lat: 52.4, note: 'Speed bumps' }],
      curv: [[0, 0.5]],
      elev: [[0, 3]],
      seg: [{ i0: 0, i1: 1, fun: 60, lim: 60, v: 60 }],
      why: ['Scenic stretch'],
    };
    const { doc } = validateRoutesDoc({ routes: [], sprints: [sprint('a', detail)] });
    const linked = validateLinkedDoc({
      rides: [{
        id: 'l1', type: 'open', name: 'Ride', km: 5, fun_km: 3,
        line: [[4.8, 52.4], [4.81, 52.41]], score: { ...score, total: 60 },
        roads: [], anchor_roads: ['First', 'Second'], windows: ['2026-09-28 08:00'], ...detail,
      }],
    });
    for (const r of buildCatalogue(doc, linked.doc).routes) {
      expect(r.circuit).toBeNull();
      expect(r.profile).toMatchObject({ climbM: 12, why: ['Scenic stretch'], cornerCount: detail.corner_count });
      expect(r.profile.corners).toHaveLength(1);
      expect(r.profile.elev).toEqual([[0, 3]]);
    }
    expect(buildCatalogue(doc, linked.doc).byKey.get('linked:l1')!.anchorRoads).toEqual(['First', 'Second']);
  });

  it('finds a linked ride by an anchor road that is not among its top roads', () => {
    const linked = validateLinkedDoc({
      rides: [{
        id: 'l1', type: 'open', name: 'Ride', km: 5, fun_km: 3, line: [[4.8, 52.4], [4.81, 52.41]],
        score: { ...score, total: 60 }, roads: [{ name: 'Main', km: 4, fun: 60 }],
        anchor_roads: ['Zijweg', 'Main'], windows: ['2026-09-28 08:00'], retrace_share: 0.04,
      }],
    });
    const cat = buildCatalogue(null, linked.doc);
    const [hit] = searchSuggestions(buildSearchIndex(cat), 'zijweg');
    expect(hit.label).toBe('Zijweg');
    expect(applyFilters(cat.routes, { ...DEFAULT_FILTERS, search: hit.selection }).results.map((r) => r.key)).toEqual(['linked:l1']);
    expect(cat.routes[0].retraceShare).toBe(0.04);
  });

  it('relabels the legacy quiet reason as a modelled estimate', () => {
    const { doc } = validateRoutesDoc({ routes: [], sprints: [sprint('a', { why: ['Quiet back roads, little traffic'] })] });
    expect(buildCatalogue(doc, null).routes[0].profile.why).toEqual([QUIET_WHY]);
  });
});

describe('filter pills', () => {
  it('filters by minimum fun on the displayed 0–100 scale and clears it', () => {
    const { doc } = validateRoutesDoc({ routes: [], sprints: [sprint('a')] });
    const cat = buildCatalogue(doc, null);
    const threshold = { ...DEFAULT_FILTERS, minFun: 60 };
    expect(applyFilters(cat.routes, threshold).results).toHaveLength(1);
    expect(applyFilters(cat.routes, { ...threshold, minFun: 65 }).results).toHaveLength(0);
    expect(activePills(threshold)).toContainEqual({ id: 'minFun', label: 'Fun ≥ 60' });
    expect(clearPill(threshold, 'minFun').minFun).toBe(0);
    expect(resetFilters(threshold).minFun).toBe(0);
  });
  it('lists, clears and resets filters while keeping home', () => {
    const f = { ...DEFAULT_FILTERS, home: 'Haarlem' as const, scope: 'nearby' as const, kmMin: 10 };
    const ids = activePills(f).map((p) => p.id);
    expect(ids).toEqual(['scope', 'kmRange']);
    expect(clearPill(f, 'kmRange').kmMin).toBe(DEFAULT_FILTERS.kmMin);
    expect(clearPill(f, 'scope').scope).toBe('national');
    expect(resetFilters(f)).toEqual({ ...DEFAULT_FILTERS, home: 'Haarlem' });
  });
  it('combines route families and applies linked shape only to linked routes', () => {
    const f = { ...DEFAULT_FILTERS, type: ['circuit', 'linked'] as ('circuit' | 'linked')[], linkedShape: 'loop' as const };
    expect(typeMatches('circuit', f)).toBe(true);
    expect(typeMatches('linked-loop', f)).toBe(true);
    expect(typeMatches('linked-open', f)).toBe(false);
    expect(typeMatches('sprint', f)).toBe(false);
    expect(typeMatches('circuit', { ...f, type: [] })).toBe(false);
  });
});

it('reports whether favorite changes could actually be persisted', () => {
  expect(saveFavorites(new Set(['sprint:a']), null)).toBe(false);
  expect(saveFavorites(new Set(['sprint:a']), { setItem: () => { throw new Error('Quota'); } })).toBe(false);
  expect(saveFavorites(new Set(['sprint:a']), { setItem: () => {} })).toBe(true);
});

describe('formatting', () => {
  it('formats sample windows independent of viewer time zone', () => {
    expect(formatWindow('2026-09-28 08:00')).toBe('Mon 28 Sep 2026, 08:00');
    expect(formatWindow('not a window')).toBe('not a window');
  });

  it('groups repeated heads-up notes', () => {
    const bump = { note: 'Speed bump', type: 'bump' };
    expect(groupStops([bump, { ...bump }, { note: 'Signals', type: 'x' }]).map(([n, c, s]) => [n, c, s.type])).toEqual([
      ['Speed bump', 2, 'bump'],
      ['Signals', 1, 'x'],
    ]);
  });

  it('gives each warning type a distinct map pin', () => {
    const pins = ['camera', 'bump', 'cyclists'].map(stopPin);
    expect(new Set(pins).size).toBe(3);
    expect(stopPin('other')).toBe('O');
  });
});

describe('navigation links from route lines', () => {
  const line: [number, number][] = Array.from({ length: 20 }, (_, i) => [4.8 + i * 0.01, 52.4 + i * 0.005]);

  it('builds a loop link returning to the start', () => {
    const url = new URL(gmapsFromLine(line, true)!);
    expect(url.origin).toBe('https://www.google.com');
    expect(url.pathname).toBe('/maps/dir/');
    const p = url.searchParams;
    expect(p.get('origin')).toBe(p.get('destination'));
    expect(p.get('travelmode')).toBe('driving');
    expect(p.get('waypoints')!.split('|')).toHaveLength(8);
  });

  it('builds a one-way link with the requested waypoint count', () => {
    const url = new URL(gmapsFromLine(line, false, 3)!);
    expect(url.searchParams.get('waypoints')!.split('|')).toHaveLength(3);
    expect(url.searchParams.get('origin')).not.toBe(url.searchParams.get('destination'));
  });

  it('refuses degenerate lines', () => {
    expect(gmapsFromLine([[4.8, 52.4]], true)).toBeNull();
  });

  it('spaces waypoints by distance, not by vertex count', () => {
    // 50 vertices crowded into the first 10% of the distance, then 2 more.
    const bunched: [number, number][] = [
      ...Array.from({ length: 50 }, (_, i) => [4.8 + i * 0.0002, 52.4] as [number, number]),
      [4.9, 52.4],
      [4.9 + 0.0001, 52.4],
    ];
    const wp = new URL(gmapsFromLine(bunched, false, 3)!).searchParams.get('waypoints')!.split('|');
    // Vertex spacing would put all three inside the bunch (lon < 4.81).
    expect(wp.filter((p) => Number(p.split(',')[1]) > 4.81).length).toBeGreaterThan(0);
  });

  it('offers a phone link within the mobile waypoint limit for every route type', () => {
    const { doc } = validateLinkedDoc({
      rides: [{ id: 'l1', name: 'Loop', type: 'circuit', km: 40, fun_km: 20, score: { ...score, total: 50 }, line, roads: [], windows: ['2026-09-28 08:00'] }],
    });
    const cat = buildCatalogue(validateRoutesDoc({ routes: [], sprints: [sprint('a')] }).doc, doc);
    for (const r of cat.routes) {
      const n = new URL(r.gmapsCompact!).searchParams.get('waypoints')?.split('|').length ?? 0;
      expect(n).toBeLessThanOrEqual(COMPACT_WAYPOINTS);
    }
  });

  it('prefers a valid pipeline link, else derives from the line', () => {
    const c = {
      id: 'c1',
      name: 'Circuit',
      km: 60,
      fun_km: 30,
      score: { ...score, total: 55 },
      line,
      roads: [{ name: 'Road', km: 60, fun: 0.6 }],
      windows: ['2026-09-28 08:00'],
      start: { lat: 52.4, lon: 4.8 },
      area_id: 'a1',
      area_name: 'Area',
    };
    const withLink = validateRoutesDoc({ routes: [{ ...c, links: { gmaps: 'https://www.google.com/maps/dir/52.1,4.8/52.2,4.9' } }], sprints: [] });
    const r1 = buildCatalogue(withLink.doc, null).routes[0];
    expect(r1.gmaps).toBe('https://www.google.com/maps/dir/52.1,4.8/52.2,4.9');
    expect(r1.gmapsSource).toBe('pipeline');
    const withoutLink = validateRoutesDoc({ routes: [c], sprints: [] });
    const r2 = buildCatalogue(withoutLink.doc, null).routes[0];
    expect(r2.gmaps).toContain('https://www.google.com/maps/dir/?');
    expect(r2.gmapsSource).toBe('line');
  });

  it('gives linked rides and sprints line-derived links', () => {
    const { doc } = validateLinkedDoc({
      rides: [
        {
          id: 'l1',
          name: 'Loop',
          type: 'circuit',
          km: 40,
          fun_km: 20,
          score: { ...score, total: 50 },
          line,
          roads: [{ name: 'Road', km: 40, fun: 0.5 }],
          windows: ['2026-09-28 08:00'],
        },
      ],
    });
    const cat = buildCatalogue(validateRoutesDoc({ routes: [], sprints: [sprint('a')] }).doc, doc);
    const loop = cat.byKey.get('linked:l1')!;
    expect(loop.gmapsSource).toBe('line');
    expect(new URL(loop.gmaps!).searchParams.get('origin')).toBe(new URL(loop.gmaps!).searchParams.get('destination'));
    const sp = cat.byKey.get('sprint:a')!;
    expect(sp.gmapsSource).toBe('line');
  });
});

describe('favorites', () => {
  const memStorage = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    };
  };

  it('round-trips through storage', () => {
    const s = memStorage();
    saveFavorites(new Set(['circuit:a', 'sprint:b']), s);
    expect([...loadFavorites(s)].sort()).toEqual(['circuit:a', 'sprint:b']);
  });

  it('keeps saved route names so removed routes can be named', () => {
    const s = memStorage();
    saveFavoriteNames({ 'linked:gone': 'Old Ride' }, s);
    expect(loadFavoriteNames(s)).toEqual({ 'linked:gone': 'Old Ride' });
    expect(loadFavoriteNames({ getItem: () => '["x"]' })).toEqual({});
    expect(loadFavoriteNames({ getItem: () => '{"a":"A","b":3}' })).toEqual({ a: 'A' });
  });

  it('toggles membership', () => {
    const once = toggleFavorite(new Set(), 'k');
    expect(once.has('k')).toBe(true);
    expect(toggleFavorite(once, 'k').size).toBe(0);
  });

  it('ignores corrupt or absent storage', () => {
    expect(loadFavorites(null).size).toBe(0);
    expect(loadFavorites({ getItem: () => '{oops' }).size).toBe(0);
    expect(loadFavorites({ getItem: () => '{"not":"array"}' }).size).toBe(0);
    expect(loadFavorites({ getItem: () => '[1, "ok", null]' })).toEqual(new Set(['ok']));
  });
});

describe('map tints and overlaps', () => {
  const item = (key: string, x: number, y: number, isCircuit = false, rank = 1): SpatialItem => ({
    key,
    bbox: [x, y, x + 0.01, y + 0.01],
    line: [
      [x, y],
      [x + 0.01, y + 0.01],
    ],
    isCircuit,
    rank,
  });

  it('gives close neighbours different tints', () => {
    const a = item('a', 4.8, 52.4);
    const b = item('b', 4.802, 52.402); // ~200 m away: within neighbour padding
    const far = item('c', 5.2, 52.6);
    const { tint } = spatialInfo([a, b, far]);
    expect(tint.get('a')).not.toBe(tint.get('b'));
    for (const k of ['a', 'b', 'c']) expect(TINTS).toContain(TINTS[tint.get(k)!]);
  });

  it('colours higher-ranked routes first for stable tints', () => {
    const a = item('a', 4.8, 52.4, false, 10);
    const b = item('b', 4.802, 52.402, false, 1);
    const first = spatialInfo([a, b]).tint.get('a');
    const second = spatialInfo([item('a', 4.8, 52.4, false, 1), item('b', 4.802, 52.402, false, 10)]).tint.get('b');
    expect(first).toBe(second); // the top route always claims tint 0
  });

  it('flags a route that shares a circuit line, and only above the threshold', () => {
    const circuit = item('circuit:x', 4.8, 52.4, true);
    const onTop = { ...item('on', 4.8001, 52.4001), line: circuit.line.map(([x, y]) => [x + 0.00005, y + 0.00005] as [number, number]) };
    const beside = { ...item('off', 4.83, 52.43), line: [[4.83, 52.43], [4.85, 52.45]] as [number, number][] };
    const { overlaps } = spatialInfo([circuit, onTop, beside]);
    expect(overlaps.get('on')![0]).toMatchObject({ key: 'circuit:x' });
    expect(overlaps.get('on')![0].share).toBeGreaterThanOrEqual(OVERLAP_MIN_SHARE);
    expect(overlaps.has('off')).toBe(false);
    expect(overlaps.has('circuit:x')).toBe(false); // circuits never offset against themselves
  });

  it('buildCatalogue paints circuits in ink and others in a tint', () => {
    const { doc } = validateRoutesDoc({
      routes: [
        {
          id: 'c1',
          name: 'Circuit',
          km: 60,
          fun_km: 30,
          score: { ...score, total: 55 },
          line: [
            [4.8, 52.4],
            [4.9, 52.5],
          ],
          roads: [{ name: 'Road', km: 60, fun: 0.6 }],
          windows: ['2026-09-28 08:00'],
          start: { lat: 52.4, lon: 4.8 },
          area_id: 'a1',
          area_name: 'Area',
        },
      ],
      sprints: [sprint('a')],
    });
    const cat = buildCatalogue(doc, null);
    expect(cat.byKey.get('circuit:c1')!.color).toBe(CIRCUIT_INK);
    expect(TINTS).toContain(cat.byKey.get('sprint:a')!.color);
  });
});

describe('bounded map rendering', () => {
  it('caps lines to those in view, keeping rank order', () => {
    const mk = (i: number, x: number) => ({ key: `k${i}`, bbox: [x, 52, x + 0.1, 52.1] }) as RouteView;
    const ranked = Array.from({ length: 600 }, (_, i) => mk(i, i % 2 ? 10 : 4.8));
    const out = visibleLines(ranked, [4.5, 51.9, 5.5, 52.5], 250);
    expect(out).toHaveLength(250);
    expect(out[0].key).toBe('k0');
    expect(out.every((r) => r.bbox[0] === 4.8)).toBe(true);
  });
});

describe('similar routes', () => {
  const near = (id: string, lon: number, lat: number) => sprint(id, { start: { lat, lon }, end: { lat: lat + 0.01, lon: lon + 0.01 }, line: [[lon, lat], [lon + 0.01, lat + 0.01]] });
  it('ranks the nearest same-kind route first and never returns the route itself', () => {
    const { doc } = validateRoutesDoc({
      routes: [],
      sprints: [near('me', 4.8, 52.4), near('close', 4.81, 52.41), near('far', 5.5, 52.9)],
    });
    const cat = buildCatalogue(doc, null);
    const me = cat.byKey.get('sprint:me')!;
    const out = similarRoutes(me, cat.routes);
    expect(out.map((r) => r.id)).toEqual(['close', 'far']);
    expect(out.some((r) => r.key === me.key)).toBe(false);
  });

  it('excludes routes that mostly share this route’s line', () => {
    const { doc } = validateRoutesDoc({ routes: [], sprints: [near('me', 4.8, 52.4), near('twin', 4.8001, 52.4001), near('other', 4.85, 52.45)] });
    const cat = buildCatalogue(doc, null);
    const me = cat.byKey.get('sprint:me')!;
    const twin = cat.byKey.get('sprint:twin')!;
    me.sharesWith.push({ key: twin.key, name: twin.name, share: 0.8 });
    const out = similarRoutes(me, cat.routes);
    expect(out.map((r) => r.id)).toEqual(['other']);
  });
});

describe('curated collections', () => {
  const ride = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    type: 'open',
    name: `Ride ${id}`,
    km: 20,
    fun_km: 12,
    line: [
      [4.8, 52.4],
      [4.9, 52.5],
    ],
    score: { ...score, total: 60 },
    roads: [{ name: `Road ${id}`, km: 20, fun: 0.6 }],
    windows: ['2026-09-28 08:00'],
    distance_km: { Zaandam: 10, Haarlem: 20 },
    connector_share: 0.1,
    ...extra,
  });

  it('builds profile and nearby collections only for lists present in the data', () => {
    const linked = validateLinkedDoc({
      rides: [ride('a'), ride('b')],
      profiles: { scenic: ['a'], technical: ['b'] },
      nearby_100km: { Zaandam: { quiet: ['a'] } },
    });
    const cat = buildCatalogue(null, linked.doc);
    const cols = buildCollections(cat);
    const ids = cols.map((c) => c.id);
    expect(ids).toContain('profile:scenic');
    expect(ids).toContain('profile:technical');
    expect(ids).not.toContain('profile:quiet'); // no national quiet list in the data
    expect(ids).toContain('nearby:quiet:Zaandam');
    expect(ids).not.toContain('nearby:quiet:Haarlem');
    expect(ids).not.toContain('circuits'); // no circuits loaded
    expect(cols.find((c) => c.id === 'profile:scenic')!.keys).toEqual(['linked:a']);
  });

  it('drops keys that no longer resolve after a data update', () => {
    const linked = validateLinkedDoc({ rides: [ride('a')], profiles: { scenic: ['a', 'gone'] } });
    const cat = buildCatalogue(null, linked.doc);
    const scenic = buildCollections(cat).find((c) => c.id === 'profile:scenic')!;
    expect(scenic.keys).toEqual(['linked:a']);
  });

  it('lists national circuits as a collection in score order', () => {
    const circuit = (id: string, total: number) => ({
      id,
      name: `Circuit ${id}`,
      km: 60,
      fun_km: 30,
      score: { ...score, total },
      line: [
        [4.8, 52.4],
        [4.9, 52.5],
      ],
      roads: [{ name: 'Road', km: 60, fun: 0.6 }],
      windows: ['2026-09-28 08:00'],
      start: { lat: 52.4, lon: 4.8 },
      area_id: 'a1',
      area_name: 'Area',
    });
    const { doc } = validateRoutesDoc({ routes: [circuit('c1', 55), circuit('c2', 70)], sprints: [] });
    const cat = buildCatalogue(doc, null);
    const col = buildCollections(cat).find((c) => c.id === 'circuits')!;
    expect(col.keys).toEqual(['circuit:c1', 'circuit:c2']);
  });
});
