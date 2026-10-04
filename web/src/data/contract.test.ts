// Contract tests against the real pinned caches, so a schema drift or a data
// quality regression in the pipeline output fails here instead of silently
// rendering wrong numbers. Assert invariants and anchor roads with tolerance
// bands, not exact counts: intentional regenerations shift counts.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateLinkedDoc, validateRoutesDoc } from './validate';
import { buildCatalogue } from './model';
import { applyFilters, DEFAULT_FILTERS, type Filters } from './filters';
import { buildSearchIndex, searchSuggestions } from './search';

const cache = path.resolve(import.meta.dirname, '../../../data/cache');
const routesPath = path.join(cache, 'routes.json');
const linkedPath = path.join(cache, 'linked.json');
const hasData = existsSync(routesPath) && existsSync(linkedPath);

describe.skipIf(!hasData)('pinned national data', () => {
  const routes = validateRoutesDoc(JSON.parse(readFileSync(routesPath, 'utf8')));
  const linked = validateLinkedDoc(JSON.parse(readFileSync(linkedPath, 'utf8')));
  const cat = buildCatalogue(routes.doc, linked.doc);
  const f = (patch: Partial<Filters>): Filters => ({ ...DEFAULT_FILTERS, ...patch });

  it('keeps every record and every catalogue', () => {
    expect(routes.dropped).toEqual([]);
    expect(linked.dropped).toEqual([]);
    expect(new Set(cat.routes.map((r) => r.key)).size).toBe(cat.routes.length);
  });

  it('stays within expected catalogue bands (regenerations shift counts, this catches explosions)', () => {
    expect(cat.counts.circuit).toBe(12); // routing.top_routes
    expect(cat.areas.length).toBeGreaterThanOrEqual(5);
    expect(cat.areas.length).toBeLessThanOrEqual(30);
    expect(cat.counts.sprint).toBeGreaterThan(1500);
    expect(cat.counts.sprint).toBeLessThan(6000);
    const linkedTotal = cat.counts['linked-open'] + cat.counts['linked-loop'];
    expect(linkedTotal).toBeGreaterThan(300);
    expect(linkedTotal).toBeLessThan(2500);
  });

  it('shows the whole country by default', () => {
    expect(applyFilters(cat.routes, DEFAULT_FILTERS).results).toHaveLength(cat.routes.length);
  });

  it('keeps scores on a 0-100 display scale', () => {
    for (const r of cat.routes) {
      expect(r.funScore).toBeGreaterThanOrEqual(0);
      expect(r.funScore).toBeLessThanOrEqual(100);
      for (const v of Object.values(r.dims)) expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('keeps eligible sprints above the quality floor and limits weak linked rides', () => {
    for (const s of routes.doc.sprints) expect(s.fun).toBeGreaterThanOrEqual(0.55);
    for (const ride of linked.doc.rides) {
      expect(ride.score.total).toBeGreaterThanOrEqual(45);
      expect(ride.connector_share).toBeLessThanOrEqual(0.2);
      expect(ride.retrace_share ?? 0).toBeLessThanOrEqual(0.2);
    }
  });

  it('finds linked rides by any anchor road, not only their top roads', () => {
    const ride = linked.doc.rides.find((r) =>
      (r.anchor_roads ?? []).some((a) => !r.roads.slice(0, 3).some((x) => x.name === a)),
    );
    expect(ride, 'some ride should have an anchor outside its top three roads').toBeDefined();
    const anchor = ride!.anchor_roads!.find((a) => !ride!.roads.slice(0, 3).some((x) => x.name === a))!;
    const hit = searchSuggestions(buildSearchIndex(cat), anchor).find((h) => h.label === anchor);
    expect(hit, `${anchor} should be searchable`).toBeDefined();
    const res = applyFilters(cat.routes, f({ search: hit!.selection })).results;
    expect(res.some((r) => r.key.includes(ride!.id))).toBe(true);
  });

  it('keeps the compact phone navigation link within three waypoints', () => {
    for (const r of cat.routes) {
      const stops = new URL(r.navigation.compact!.href).searchParams.get('waypoints');
      expect(stops ? stops.split('|').length : 0).toBeLessThanOrEqual(3);
    }
  });

  it('supplies route-specific profiles and reasons across all catalogues', () => {
    for (const r of cat.routes) {
      expect(r.profile.why.length).toBeGreaterThan(0);
      expect(r.profile.cornerCount).not.toBeNull();
      expect(r.profile.curv.length).toBeGreaterThan(0);
    }
  });

  it('builds linked loops from multiple named stretches, including some longer chains', () => {
    for (const ride of linked.doc.rides) {
      expect(ride.anchor_roads?.length).toBeGreaterThanOrEqual(2);
    }
    expect(linked.doc.rides.some((r) => (r.anchor_roads?.length ?? 0) >= 3)).toBe(true);
  });

  it('keeps the anchor roads: known-good drives must survive rubric and mining changes', () => {
    // Duinlustweg, Brikweg, Autoweg: fast flowing roads carried by the speed
    // dimension; dropped by the reverted 2026-09 retune experiment.
    // Camerig: hill road that must keep surfacing via stretch bridging.
    // Langevelderslag: must extend to its crossroads, not stop at junction stubs.
    for (const name of ['Duinlustweg', 'Brikweg', 'Autoweg', 'Camerig', 'Langevelderslag']) {
      const hits = cat.routes.filter((r) => r.roadKeys.includes(name.toLowerCase()));
      expect(hits.length, `${name} should appear in at least one route`).toBeGreaterThan(0);
    }
  });

  it('links known sprint roads together near the Haarlem dunes', () => {
    const chains = cat.routes.filter(
      (r) => r.catalog === 'linked' && r.roadKeys.includes('duinlustweg') && r.roadKeys.length >= 3,
    );
    expect(chains.length).toBeGreaterThan(0);
  });

  it('counts nearby routes by straight-line distance and hides circuits without one', () => {
    const z = applyFilters(cat.routes, f({ scope: 'nearby' }));
    expect(z.typeCounts.circuit).toBe(0); // circuits carry no distance_km
    expect(z.hiddenNoDistance).toBe(cat.counts.circuit);
    expect(z.typeCounts.sprint).toBeGreaterThan(500);
    expect(z.typeCounts.linked).toBeGreaterThan(100);
    const h = applyFilters(cat.routes, f({ scope: 'nearby', home: 'Haarlem' }));
    expect(h.typeCounts.sprint).toBeGreaterThan(500);
    expect(h.typeCounts.linked).toBeGreaterThan(100);
  });

  it('treats unknown drive time as hidden, not as zero minutes', () => {
    const r = applyFilters(cat.routes, f({ maxDriveMin: 30 }));
    expect(r.results.every((x) => x.driveMin != null && x.driveMin <= 30)).toBe(true);
    expect(cat.routes.filter((x) => x.catalog === 'sprint').every((x) => x.driveMin != null)).toBe(true);
    expect(r.hiddenNoDrive).toBe(0);
  });

  it('finds Duinlustweg and filters to the routes that use it', () => {
    const index = buildSearchIndex(cat);
    const [hit] = searchSuggestions(index, 'duinlust');
    expect(hit.label).toBe('Duinlustweg');
    const res = applyFilters(cat.routes, f({ search: hit.selection })).results;
    expect(res.length).toBeGreaterThan(0);
    expect(res.every((r) => r.roadKeys.includes('duinlustweg'))).toBe(true);
  });

  it('has no town gazetteer: a town name only matches real road names', () => {
    const hits = searchSuggestions(buildSearchIndex(cat), 'Zaandam');
    expect(hits.every((h) => h.selection.kind === 'road' && h.label !== 'Zaandam')).toBe(true);
    expect(searchSuggestions(buildSearchIndex(cat), '1506 AB')).toEqual([]);
  });

  it('disambiguates duplicate area names when the data has any', () => {
    const index = buildSearchIndex(cat);
    const byLabel = new Map<string, string[]>();
    for (const e of index.entries.filter((e) => e.selection.kind === 'area')) {
      byLabel.set(e.label, [...(byLabel.get(e.label) ?? []), e.description ?? '']);
    }
    for (const [label, descriptions] of byLabel) {
      if (descriptions.length > 1) {
        expect(new Set(descriptions).size, `duplicate area "${label}" needs distinct descriptions`).toBe(descriptions.length);
      }
    }
  });

  it('requests each whole route with one ordered line-derived Maps link per layout', () => {
    for (const r of cat.routes) {
      for (const [layout, budget] of [['compact', 3], ['desktop', 9]] as const) {
        const handover = r.navigation[layout]!;
        expect(handover).not.toBeNull();
        expect(handover.points[0].point).toEqual(r.line[0]);
        expect(handover.points.at(-1)!.point).toEqual(r.line.at(-1));
        expect(handover.points.length - 2).toBeLessThanOrEqual(budget);
        expect(handover.href.length).toBeLessThanOrEqual(2048);
        expect(handover.href).toMatch(/^https:\/\/www.google.com\/maps\/dir\//);
        handover.points.slice(1).forEach((point, i) => expect(point.km).toBeGreaterThan(handover.points[i].km));
      }
    }
  });
});
