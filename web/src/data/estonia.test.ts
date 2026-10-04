// Integration checks read the downloaded-data catalogue, never a fixture.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { getCountry } from './countries';
import { validateLinkedDoc, validateRoutesDoc } from './validate';
import { buildCatalogue, buildCollections } from './model';
import { cumulativeKm } from '../map/geo';

const cache = path.resolve(import.meta.dirname, '../../../data/ee/cache');
const hasCatalogue = ['routes.json', 'linked.json'].every((name) => existsSync(path.join(cache, name)));

it.skipIf(!hasCatalogue)('validates the real Estonia national catalogue without fallback', () => {
  const country = getCountry('ee');
  const routes = validateRoutesDoc(JSON.parse(readFileSync(path.join(cache, 'routes.json'), 'utf8')), country);
  const linked = validateLinkedDoc(JSON.parse(readFileSync(path.join(cache, 'linked.json'), 'utf8')), country);
  expect(routes.dropped).toEqual([]);
  expect(linked.dropped).toEqual([]);
  expect(routes.doc.sprints.length).toBeGreaterThan(0);
  expect(linked.doc.rides.length).toBeGreaterThan(0);
  expect(routes.doc.meta.generated).toBeTruthy();
  const cat = buildCatalogue(routes.doc, linked.doc, country);
  expect(new Set(cat.routes.map((r) => r.key)).size).toBe(cat.routes.length);
  for (const r of cat.routes) {
    expect(r.key).toMatch(/^ee:(circuit|sprint|linked):/);
    expect([r.name, ...r.roads.map((road) => road.name), ...r.anchorRoads, r.circuit?.areaName ?? ''].join(' ')).not.toContain('\u2014');
    expect(r.driveMin).toBeGreaterThan(0);
    expect(r.navigation.compact).toBe(r.navigation.desktop);
    for (const [layout, budget] of [['compact', 9], ['desktop', 9]] as const) {
      const handover = r.navigation[layout]!;
      expect(handover).not.toBeNull();
      expect(handover.points[0].point).toEqual(r.line[0]);
      expect(handover.points.at(-1)!.point).toEqual(r.line.at(-1));
      expect(handover.href).toMatch(/^https:\/\/www.google.com\/maps\/dir\//);
      expect(handover.href.length).toBeLessThanOrEqual(2048);
      expect(new URL(handover.href).searchParams.get('waypoints')?.split('|').length ?? 0).toBeLessThanOrEqual(budget);
      handover.points.slice(1).forEach((point, i) => expect(point.km).toBeGreaterThan(handover.points[i].km));
      const total = handover.points.at(-1)!.km;
      if (total > 5 * (budget + 1)) {
        expect(handover.maxGapKm).toBeLessThanOrEqual(2 * total / (budget + 1) + 0.5);
      }
    }
    expect(r.funScore).toBeGreaterThanOrEqual(0);
    expect(r.funScore).toBeLessThanOrEqual(100);
    expect(r.profile.elev.length).toBeGreaterThan(0);
    expect(r.profile.climbM).toBeGreaterThanOrEqual(0);
    expect(r.profile.elev.every(([km, height]) => Number.isFinite(km) && Number.isFinite(height))).toBe(true);
    for (const value of Object.values(r.dims)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
    for (const [lon, lat] of r.line) {
      expect(lon).toBeGreaterThanOrEqual(country.bounds[0]);
      expect(lon).toBeLessThanOrEqual(country.bounds[2]);
      expect(lat).toBeGreaterThanOrEqual(country.bounds[1]);
      expect(lat).toBeLessThanOrEqual(country.bounds[3]);
    }
    const measured = cumulativeKm(r.line).at(-1)!;
    expect(Math.abs(measured - r.km)).toBeLessThan(Math.max(.15, r.km * .01));
    for (const segment of r.profile.seg) {
      expect(segment.i0).toBeGreaterThanOrEqual(0);
      expect(segment.i1).toBeLessThan(r.line.length);
      expect([20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130]).toContain(segment.lim);
    }
    expect(Object.keys(r.distanceKm ?? {}).sort()).toEqual(['Tallinn', 'Tartu']);
    if (r.kind === 'circuit' || r.kind === 'linked-loop') {
      expect(r.line[0]).toEqual(r.line.at(-1));
    }
  }
  expect([...cat.areas, ...cat.toproads].map((item) => item.name).join(' ')).not.toContain('\u2014');
  expect(buildCollections(cat).some((c) => /national/i.test(c.title + c.description))).toBe(true);
});
