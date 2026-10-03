import type { LonLat } from '../data/raw';
import type { Kind, RouteView } from '../data/model';

export type BBox = [number, number, number, number];

export const MAX_CONTEXT_LINES = 250;

export function intersects(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function unionBBox(boxes: BBox[]): BBox | null {
  if (!boxes.length) return null;
  const out: BBox = [...boxes[0]] as BBox;
  for (const b of boxes) {
    out[0] = Math.min(out[0], b[0]);
    out[1] = Math.min(out[1], b[1]);
    out[2] = Math.max(out[2], b[2]);
    out[3] = Math.max(out[3], b[3]);
  }
  return out;
}

/**
 * Lines to draw for the current view: best-ranked routes whose extent touches
 * the viewport, capped so thousands of polylines never render at once.
 */
export function visibleLines(ranked: RouteView[], view: BBox, cap = MAX_CONTEXT_LINES): RouteView[] {
  const out: RouteView[] = [];
  for (const r of ranked) {
    if (intersects(r.bbox, view)) {
      out.push(r);
      if (out.length >= cap) break;
    }
  }
  return out;
}

export const DASH: Record<Kind, number[] | null> = {
  circuit: null,
  'linked-loop': [5, 2],
  'linked-open': [2, 2],
  sprint: [0.1, 2],
};

function haversineKm(a: LonLat, b: LonLat): number {
  const R = 6371;
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Cumulative distance in km at each vertex of the line. */
export function cumulativeKm(line: LonLat[]): number[] {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + haversineKm(line[i - 1], line[i]));
  return cum;
}

/** Point at a fraction of the line's length, for the profile cursor. */
export function pointAtFraction(line: LonLat[], fraction: number): LonLat {
  if (line.length < 2) return line[0];
  const cum = cumulativeKm(line);
  const target = Math.max(0, Math.min(1, fraction)) * cum[cum.length - 1];
  let i = 1;
  while (i < cum.length - 1 && cum[i] < target) i++;
  const span = cum[i] - cum[i - 1] || 1;
  const f = (target - cum[i - 1]) / span;
  const a = line[i - 1];
  const b = line[i];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}
