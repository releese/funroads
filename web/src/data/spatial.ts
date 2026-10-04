import type { LonLat } from './raw';

/**
 * Muted map tints that separate neighbouring routes. They carry no meaning of
 * their own (kind is carried by dash pattern, rank by list order), and each
 * keeps at least 3:1 contrast on the light basemap.
 */
export const TINTS = ['#3f5e8c', '#4e7a3a', '#8a6414', '#7a4a86', '#1f7373', '#a0472b'] as const;
export const CIRCUIT_INK = '#1f1f1f';

export interface SpatialItem {
  key: string;
  bbox: [number, number, number, number];
  line: LonLat[];
  isCircuit: boolean;
  /** Higher first when choosing tints, so the best routes get stable colours. */
  rank: number;
}

export interface Overlap {
  key: string;
  share: number;
}

export interface SpatialInfo {
  tint: Map<string, number>;
  overlaps: Map<string, Overlap[]>;
}

const NEIGHBOUR_PAD_DEG = 0.004; // ~300-450 m: routes this close read as one blur
const BUCKET_DEG = 0.05;
// ~65 m cells: two carriageways of one road fall together, a parallel road
// one field away usually does not.
const CELL_LAT = 0.0006;
const CELL_LON = 0.0009;
export const OVERLAP_MIN_SHARE = 0.2;

function buckets(b: [number, number, number, number], pad: number): string[] {
  const out: string[] = [];
  for (let x = Math.floor((b[0] - pad) / BUCKET_DEG); x <= Math.floor((b[2] + pad) / BUCKET_DEG); x++)
    for (let y = Math.floor((b[1] - pad) / BUCKET_DEG); y <= Math.floor((b[3] + pad) / BUCKET_DEG); y++) out.push(`${x}:${y}`);
  return out;
}

const touches = (a: SpatialItem['bbox'], b: SpatialItem['bbox'], pad: number) =>
  a[0] - pad <= b[2] && a[2] + pad >= b[0] && a[1] - pad <= b[3] && a[3] + pad >= b[1];

/** Greedy colouring: each route takes the tint least used by already-tinted neighbours. */
function assignTints(items: SpatialItem[]): Map<string, number> {
  const order = items.filter((i) => !i.isCircuit).sort((a, b) => b.rank - a.rank || (a.key < b.key ? -1 : 1));
  const grid = new Map<string, SpatialItem[]>();
  const tint = new Map<string, number>();
  for (const it of order) {
    const cells = buckets(it.bbox, NEIGHBOUR_PAD_DEG);
    const counts = new Array<number>(TINTS.length).fill(0);
    const seen = new Set<string>();
    for (const c of cells)
      for (const other of grid.get(c) ?? []) {
        if (seen.has(other.key) || !touches(it.bbox, other.bbox, NEIGHBOUR_PAD_DEG)) continue;
        seen.add(other.key);
        counts[tint.get(other.key)!]++;
      }
    let best = 0;
    for (let i = 1; i < TINTS.length; i++) if (counts[i] < counts[best]) best = i;
    tint.set(it.key, best);
    for (const c of buckets(it.bbox, 0)) {
      const list = grid.get(c);
      if (list) list.push(it);
      else grid.set(c, [it]);
    }
  }
  return tint;
}

const cellOf = (lon: number, lat: number) => `${Math.floor(lon / CELL_LON)}:${Math.floor(lat / CELL_LAT)}`;

/** Share of each non-circuit route's line that runs on (within ~65 m of) a circuit. */
export function findOverlaps(items: SpatialItem[]): Map<string, Overlap[]> {
  const cells = new Map<string, Set<string>>();
  for (const c of items.filter((i) => i.isCircuit)) {
    for (let i = 1; i < c.line.length; i++) {
      const [x0, y0] = c.line[i - 1];
      const [x1, y1] = c.line[i];
      // Rasterise each segment finely enough that no cell along it is skipped.
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0) / CELL_LON, Math.abs(y1 - y0) / CELL_LAT) * 2));
      for (let s = 0; s <= steps; s++) {
        const k = cellOf(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps);
        const set = cells.get(k);
        if (set) set.add(c.key);
        else cells.set(k, new Set([c.key]));
      }
    }
  }
  const out = new Map<string, Overlap[]>();
  if (!cells.size) return out;
  for (const it of items) {
    if (it.isCircuit || !it.line.length) continue;
    const hits = new Map<string, number>();
    for (const [lon, lat] of it.line) {
      const cx = Math.floor(lon / CELL_LON);
      const cy = Math.floor(lat / CELL_LAT);
      const here = new Set<string>();
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) for (const k of cells.get(`${cx + dx}:${cy + dy}`) ?? []) here.add(k);
      for (const k of here) hits.set(k, (hits.get(k) ?? 0) + 1);
    }
    const list = [...hits.entries()]
      .map(([key, n]) => ({ key, share: n / it.line.length }))
      .filter((o) => o.share >= OVERLAP_MIN_SHARE)
      .sort((a, b) => b.share - a.share);
    if (list.length) out.set(it.key, list);
  }
  return out;
}

export function spatialInfo(items: SpatialItem[]): SpatialInfo {
  return { tint: assignTints(items), overlaps: findOverlaps(items) };
}
