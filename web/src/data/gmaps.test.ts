import { describe, expect, it } from 'vitest';
import type { LonLat } from './raw';
import { cumulativeKm } from '../map/geo';
import { mapsHandover, MAX_POINT_GAP_KM, MAPS_URL_LIMIT, BEND_APPROACH_KM, chordDeviationKm } from './gmaps';

const straight: LonLat[] = [[4.8, 52.4], [5.8, 52.4]];
const detour: LonLat[] = [[4.8, 52.4], [4.8, 52.5], [4.81, 52.5], [4.81, 52.4]];
const crossing: LonLat[] = [[4.8, 52.4], [4.9, 52.5], [4.8, 52.5], [4.9, 52.4], [4.9, 52.5], [5, 52.5]];

describe('shape-aware Maps handover', () => {
  it.each([
    ['straight', straight, false],
    ['uneven', [[4.8, 52.4], [4.80001, 52.4], [5.8, 52.4]], false],
    ['hairpin', detour, false],
    ['duplicates', [detour[0], detour[0], ...detour.slice(1)], false],
    ['crossing', crossing, false],
    ['closed', [...detour, detour[0]], true],
    ['tiny closed', [[4.8, 52.4], [4.80001, 52.4], [4.8, 52.4]], true],
    ['very short', [[4.8, 52.4], [4.80000001, 52.4]], false],
    ['long', [[4.8, 52.4], [8.8, 52.4]], false],
  ] as [string, LonLat[], boolean][])('preserves ordered coverage for %s', (_, line, loop) => {
    const original = structuredClone(line);
    for (const budget of [3, 9]) {
      const handover = mapsHandover(line, loop, budget)!;
      const { points } = handover;
      expect(mapsHandover(line, loop, budget)).toEqual(handover);
      expect(line).toEqual(original);
      expect(points[0]).toEqual({ point: line[0], km: 0 });
      expect(points.at(-1)!.point).toEqual(line.at(-1));
      expect(points.at(-1)!.km).toBeCloseTo(cumulativeKm(line).at(-1)!, 8);
      points.slice(1).forEach((p, i) => {
        expect(p.km).toBeGreaterThan(points[i].km);
        expect(p.point).not.toEqual(points[i].point);
        expect(p.point.every(Number.isFinite)).toBe(true);
        expect(Math.min(...line.slice(1).map((b, j) => chordDeviationKm(p.point, line[j], b)))).toBeLessThan(1e-8);
      });
      const url = new URL(handover.href);
      expect(handover.href.length).toBeLessThanOrEqual(MAPS_URL_LIMIT);
      expect(url.searchParams.get('waypoints')?.split('|').length ?? 0).toBeLessThanOrEqual(budget);
      expect(url.searchParams.get('api')).toBe('1');
      expect(url.searchParams.get('travelmode')).toBe('driving');
      const coordinates = [url.searchParams.get('origin')!, ...(url.searchParams.get('waypoints')?.split('|') ?? []), url.searchParams.get('destination')!];
      expect(coordinates).toEqual(points.map(({ point: [lon, lat] }) => `${lat},${lon}`));
      if (handover.maxGapKm > MAX_POINT_GAP_KM) expect(handover.limited).toBe(true);
    }
  });

  it('uses fewer shape points on straight roads and samples the polyline', () => {
    expect(mapsHandover([[4.8, 52.4], [4.81, 52.4]], false, 9)!.points).toHaveLength(2);
    const { points } = mapsHandover(detour, false, 9)!;
    expect(points.length).toBeGreaterThan(2);
    for (const p of points) expect(Math.min(...detour.slice(1).map((b, i) => chordDeviationKm(p.point, detour[i], b)))).toBeLessThan(1e-8);
    expect(mapsHandover(crossing, false, 9)!.points.at(-1)!.km).toBeCloseTo(cumulativeKm(crossing).at(-1)!);
  });

  it('rejects invalid coordinates and returns no handover for zero-length lines', () => {
    expect(() => mapsHandover([[NaN, 52], [4, 52]], false, 9)).toThrow();
    expect(() => mapsHandover([[181, 52], [4, 52]], false, 9)).toThrow();
    expect(mapsHandover([], false, 9)).toBeNull();
    expect(mapsHandover([[4, 52], [4, 52]], true, 9)).toBeNull();
    expect(() => mapsHandover([], false, 10)).toThrow();
  });

  it('discloses unmet geometry targets instead of splitting or truncating a long route', () => {
    const handover = mapsHandover([[4.8, 52.4], [8.8, 52.4]], false, 3)!;
    expect(handover.points).toHaveLength(5);
    expect(handover.maxGapKm).toBeGreaterThan(5);
    expect(handover.limited).toBe(true);
    expect(handover.points.at(-1)!.point).toEqual([8.8, 52.4]);
  });

  it('places a sharp bend point on the actual approach, never across its chord', () => {
    const line: LonLat[] = [[4.8, 52.4], [4.9, 52.4], [4.9, 52.5]];
    const handover = mapsHandover(line, false, 1)!;
    expect(handover.points[1].point[1]).toBe(52.4);
    expect(handover.points[1].point[0]).toBeLessThan(4.9);
    expect(cumulativeKm(line)[1] - handover.points[1].km).toBeCloseTo(0.5);
  });

  it('leaves well-represented short bends unchanged', () => {
    const line: LonLat[] = [[4.8, 52.4], [4.81, 52.4], [4.81, 52.41]];
    const handover = mapsHandover(line, false, 9)!;
    expect(handover.points.map((p) => p.point)).toEqual(line);
    expect(handover.limited).toBe(false);
  });

  it.each([3, 9])('covers both ends of a long circuit despite concentrated bends (budget=%s)', (budget) => {
    const line: LonLat[] = [
      [4.8, 52.4],
      ...Array.from({ length: 30 }, (_, i): LonLat => [4.8 + (i + 1) * 0.01, 52.4 + (i % 2 ? 0 : 0.035)]),
      [5.5, 52.4], [5.5, 52.1], [4.8, 52.1], [4.8, 52.4],
    ];
    const handover = mapsHandover(line, true, budget)!;
    const total = cumulativeKm(line).at(-1)!;
    const step = total / (budget + 1);
    expect(handover.points).toHaveLength(budget + 2);
    handover.points.slice(1, -1).forEach((p, i) => {
      expect(p.km).toBeGreaterThanOrEqual((i + 0.5) * step - BEND_APPROACH_KM);
      expect(p.km).toBeLessThanOrEqual((i + 1.5) * step);
    });
    expect(handover.maxGapKm).toBeLessThanOrEqual(2 * step + BEND_APPROACH_KM);
    expect(handover.limited).toBe(true);
  });

  it('prefers a substantial bend over the distance midpoint of its region', () => {
    const line: LonLat[] = [[4.8, 52.4], [5.1, 52.4], [5.1, 53]];
    const corner = cumulativeKm(line)[1];
    const handover = mapsHandover(line, false, 9)!;
    expect(handover.points.some((p) => Math.abs(p.km - (corner - BEND_APPROACH_KM)) < 1e-8)).toBe(true);
  });

  it('does not repeat consecutive stops on a long out-and-back with an even budget', () => {
    const line: LonLat[] = [[4.8, 52.4], [5.8, 52.4], [4.8, 52.4]];
    const handover = mapsHandover(line, true, 2)!;
    expect(handover.points.length).toBeLessThanOrEqual(4);
    handover.points.slice(1).forEach((p, i) => expect(p.point).not.toEqual(handover.points[i].point));
    expect(handover.points.at(-1)!.point).toEqual(line[0]);
  });
});
