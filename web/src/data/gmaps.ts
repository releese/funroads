import type { LonLat } from './raw';
import { cumulativeKm, pointAtFraction } from '../map/geo';

export const COMPACT_WAYPOINTS = 3;
export const DESKTOP_WAYPOINTS = 9;
export const MAPS_URL_LIMIT = 2048;
export const SHAPE_DEVIATION_KM = 0.1;
export const MAX_POINT_GAP_KM = 5;
export const BEND_APPROACH_KM = 0.5;

export interface ShapingPoint {
  point: LonLat;
  km: number;
}

export interface MapsHandover {
  points: ShapingPoint[];
  href: string;
  /** Requested geometry targets are not necessarily achievable within one URL. */
  limited: boolean;
  maxGapKm: number;
  maxDeviationKm: number;
}

// Keep coordinate precision: rounding can erase very short legs or repeat visits.
const coordinate = ([lon, lat]: LonLat) => `${lat},${lon}`;
const same = (a: LonLat, b: LonLat) => a[0] === b[0] && a[1] === b[1];

/** Local metric chord distance, appropriate for the NL/EE route extents. */
export function chordDeviationKm(p: LonLat, a: LonLat, b: LonLat): number {
  const xScale = 111.195 * Math.cos((a[1] + b[1]) / 2 * Math.PI / 180);
  const x = (b[0] - a[0]) * xScale, y = (b[1] - a[1]) * 111.195;
  const px = (p[0] - a[0]) * xScale, py = (p[1] - a[1]) * 111.195;
  const t = x * x + y * y ? Math.max(0, Math.min(1, (px * x + py * y) / (x * x + y * y))) : 0;
  return Math.hypot(px - t * x, py - t * y);
}

/** One whole-route request, prioritising shape and distance within a fixed budget. */
export function mapsHandover(input: LonLat[], loop: boolean, budget: number): MapsHandover | null {
  if (!Number.isInteger(budget) || budget < 1 || budget > DESKTOP_WAYPOINTS) throw new Error('Invalid waypoint budget');
  if (input.some(([lon, lat]) => !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90)) {
    throw new Error('Invalid navigation coordinates');
  }
  const line = input.filter((p, i) => !i || !same(p, input[i - 1]));
  if (line.length < 2) return null;
  if (loop && !same(line[0], line.at(-1)!)) line.push(line[0]);
  const distances = cumulativeKm(line);
  const last = line.length - 1;
  const total = distances[last];
  const atKm = (km: number): ShapingPoint => ({ point: pointAtFraction(line, km / total), km });
  const points: ShapingPoint[] = [{ point: line[0], km: 0 }, { point: line[last], km: total }];
  const interval = (a: ShapingPoint, b: ShapingPoint) => {
    let deviation = 0, index = -1;
    for (let i = 1; i < last; i++) {
      if (distances[i] <= a.km || distances[i] >= b.km) continue;
      const d = chordDeviationKm(line[i], a.point, b.point);
      if (d > deviation) { deviation = d; index = i; }
    }
    return { deviation, index, gap: b.km - a.km };
  };
  while (points.length < budget + 2) {
    let priority = 1, insert = -1, candidate: ShapingPoint | null = null;
    for (let j = 1; j < points.length; j++) {
      const a = points[j - 1], b = points[j], { deviation, index, gap } = interval(a, b);
      // Identical endpoints must not collapse a closed line or repeated visit.
      const score = same(a.point, b.point) && deviation > 0 ? Infinity
        : Math.max(deviation / SHAPE_DEVIATION_KM, gap / MAX_POINT_GAP_KM);
      if (score <= priority) continue;
      const next = index >= 0 && deviation > 0 && (same(a.point, b.point) || deviation / SHAPE_DEVIATION_KM >= gap / MAX_POINT_GAP_KM)
        ? { point: line[index], km: distances[index] } : atKm((a.km + b.km) / 2);
      if (same(next.point, a.point) || same(next.point, b.point)) continue;
      priority = score;
      insert = j;
      candidate = next;
    }
    if (insert < 0 || !candidate) break;
    points.splice(insert, 0, candidate);
  }
  const constrained = points.slice(1).some((p, i) => {
    const { deviation, gap } = interval(points[i], p);
    return deviation > SHAPE_DEVIATION_KM + 1e-9 || gap > MAX_POINT_GAP_KM + 1e-9;
  });
  // ponytail: geometry-only approach placement, not junction detection. Revisit
  // with road/junction evidence if device trials expose more snapping detours.
  const placed = points.map((p, i) => {
    if (!constrained || !i || i === points.length - 1) return p;
    const probe = Math.min(0.1, (p.km - points[i - 1].km) / 4, (points[i + 1].km - p.km) / 4);
    const a = atKm(p.km - probe).point, b = atKm(p.km + probe).point;
    const scale = Math.cos(p.point[1] * Math.PI / 180);
    const x1 = (p.point[0] - a[0]) * scale, y1 = p.point[1] - a[1];
    const x2 = (b[0] - p.point[0]) * scale, y2 = b[1] - p.point[1];
    const cosine = (x1 * x2 + y1 * y2) / (Math.hypot(x1, y1) * Math.hypot(x2, y2));
    // Request a point on the approach, rather than the apex of a >=45° bend.
    if (cosine >= Math.SQRT1_2 || !Number.isFinite(cosine)) return p;
    const offset = Math.min(BEND_APPROACH_KM, (p.km - points[i - 1].km) / 4);
    const approach = atKm(p.km - offset);
    return same(approach.point, points[i - 1].point) ? p : approach;
  });
  let maxGapKm = 0, maxDeviationKm = 0;
  for (let i = 1; i < placed.length; i++) {
    const { deviation, gap } = interval(placed[i - 1], placed[i]);
    maxGapKm = Math.max(maxGapKm, gap);
    maxDeviationKm = Math.max(maxDeviationKm, deviation);
  }
  if (placed.some((p, i) => i && same(p.point, placed[i - 1].point))) throw new Error('Degenerate navigation request');
  const params = new URLSearchParams({
    api: '1', origin: coordinate(placed[0].point),
    destination: coordinate(placed.at(-1)!.point), travelmode: 'driving',
  });
  if (placed.length > 2) params.set('waypoints', placed.slice(1, -1).map((p) => coordinate(p.point)).join('|'));
  const href = `https://www.google.com/maps/dir/?${params}`;
  if (href.length > MAPS_URL_LIMIT) throw new Error('Navigation URL exceeds the documented limit');
  return { points: placed, href, maxGapKm, maxDeviationKm,
    limited: maxGapKm > MAX_POINT_GAP_KM + 1e-9 || maxDeviationKm > SHAPE_DEVIATION_KM + 1e-9 };
}
