import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import type { RouteProfile } from '../data/model';

interface Props {
  circuit: RouteProfile;
  totalKm: number;
  onCursorKm: (km: number | null) => void;
}

/** Merge elevation and curvature samples onto one km axis; gaps are spanned, not zero-filled. */
export function mergeProfile(c: RouteProfile): [number[], (number | null)[], (number | null)[]] {
  const xs = [...new Set([...c.elev.map((p) => p[0]), ...c.curv.map((p) => p[0])])].sort((a, b) => a - b);
  const e = new Map(c.elev.map((p) => [p[0], p[1]]));
  const k = new Map(c.curv.map((p) => [p[0], p[1]]));
  return [xs, xs.map((x) => e.get(x) ?? null), xs.map((x) => k.get(x) ?? null)];
}

/** Share of the route under each legal limit, from the chunk index span. */
export function limitMix(c: RouteProfile): { lim: number; share: number }[] {
  const acc = new Map<number, number>();
  let total = 0;
  for (const s of c.seg) {
    const len = Math.max(0, s.i1 - s.i0);
    total += len;
    acc.set(s.lim, (acc.get(s.lim) ?? 0) + len);
  }
  if (!total) return [];
  return [...acc.entries()].map(([lim, n]) => ({ lim, share: n / total })).sort((a, b) => b.share - a.share);
}

export function profileSummary(c: RouteProfile, totalKm: number): string {
  const parts: string[] = [];
  if (c.elev.length) {
    const ys = c.elev.map((p) => p[1]);
    parts.push(`Elevation ranges from ${Math.min(...ys).toFixed(0)} to ${Math.max(...ys).toFixed(0)} m over ${totalKm} km`);
  }
  if (c.climbM != null) parts.push(`total climb +${c.climbM} m`);
  if (c.curv.length) {
    const peak = c.curv.reduce((a, b) => (b[1] > a[1] ? b : a));
    parts.push(`curvature peaks at ${peak[1].toFixed(2)} near km ${peak[0].toFixed(0)}`);
  }
  return parts.length ? parts.join('; ') + '.' : 'No profile data.';
}

export function ProfileChart({ circuit, totalKm, onCursorKm }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const cb = useRef(onCursorKm);
  cb.current = onCursorKm;

  useEffect(() => {
    const el = host.current;
    if (!el || (!circuit.elev.length && !circuit.curv.length)) return;
    const data = mergeProfile(circuit);
    let plot: uPlot | null = null;
    try {
      plot = new uPlot(
        {
          width: Math.max(260, el.clientWidth),
          height: 180,
          scales: { x: { time: false }, curv: { range: [0, 1] } },
          series: [
            { label: 'km', value: (_u, v) => (v == null ? '–' : `${v.toFixed(1)} km`) },
            {
              label: 'Elevation (m)',
              scale: 'm',
              stroke: '#000000',
              width: 2,
              fill: 'rgba(0,0,0,0.06)',
              spanGaps: true,
              value: (_u, v) => (v == null ? '–' : `${v.toFixed(1)} m`),
            },
            {
              label: 'Curvature (0–1, dashed)',
              scale: 'curv',
              stroke: '#5e5e5e',
              width: 2,
              dash: [6, 4],
              spanGaps: true,
              value: (_u, v) => (v == null ? '–' : v.toFixed(2)),
            },
          ],
          axes: [
            { label: 'km', stroke: '#4b4b4b' },
            { scale: 'm', label: 'm', stroke: '#4b4b4b', size: 48 },
            { scale: 'curv', side: 1, label: 'curvature', stroke: '#4b4b4b', grid: { show: false }, size: 48 },
          ],
          legend: { show: false },
          cursor: { drag: { x: false, y: false } },
          hooks: {
            setCursor: [
              (u) => {
                const i = u.cursor.idx;
                cb.current(i == null ? null : (u.data[0][i] as number));
              },
            ],
          },
        },
        data as uPlot.AlignedData,
        el,
      );
    } catch {
      return;
    }
    const ro = new ResizeObserver(() => plot?.setSize({ width: Math.max(260, el.clientWidth), height: 180 }));
    ro.observe(el);
    const leave = () => cb.current(null);
    el.addEventListener('mouseleave', leave);
    return () => {
      ro.disconnect();
      el.removeEventListener('mouseleave', leave);
      plot?.destroy();
      cb.current(null);
    };
  }, [circuit]);

  return (
    <figure style={{ margin: 0 }}>
      <div ref={host} aria-hidden="true" />
      <figcaption style={{ fontSize: 14, lineHeight: '20px', color: '#4b4b4b', marginTop: 8 }}>
        <span style={{ display: 'block', marginBottom: 4, color: '#000' }}>
          Solid line: elevation in metres (left axis). Dashed line: curvature 0–1 (right axis).
        </span>
        {profileSummary(circuit, totalKm)}
      </figcaption>
    </figure>
  );
}
