// Local frontend-only measurements. Does not write catalogue inputs.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createServer } from '../../web/node_modules/vite/dist/node/index.js';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const server = await createServer({ root: `${root}/web`, server: { middlewareMode: true } });
try {
  const { mapsHandover } = await server.ssrLoadModule('/src/data/gmaps.ts');
  const quantiles = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const at = (q) => sorted[Math.ceil((sorted.length - 1) * q)];
    return { min: sorted[0], p50: at(.5), p90: at(.9), p95: at(.95), p99: at(.99), max: sorted.at(-1) };
  };
  const report = { date: '2026-10-04', design: 'Single whole-route URL, no parts', countries: {}, examples: [] };
  for (const country of ['nl', 'ee']) {
    const prefix = country === 'ee' ? 'data/ee/cache' : 'data/cache';
    const docs = ['routes', 'linked'].map((name) => {
      const bytes = readFileSync(`${root}/${prefix}/${name}.json`);
      return { doc: JSON.parse(bytes), hash: createHash('sha256').update(bytes).digest('hex'), source: `${prefix}/${name}.json` };
    });
    const rows = [
      ...docs[0].doc.routes.map((r) => ({ ...r, family: 'circuit', loop: true })),
      ...docs[0].doc.sprints.map((r) => ({ ...r, family: 'sprint', loop: false })),
      ...docs[1].doc.rides.map((r) => ({ ...r, family: r.type === 'circuit' ? 'linked-loop' : 'linked-open', loop: r.type === 'circuit' })),
    ].map((r) => {
      const result = { key: `${country === 'ee' ? 'ee:' : ''}${r.family.startsWith('linked') ? 'linked' : r.family}:${r.id}`,
        name: r.name.replaceAll(' — ', ' → '), family: r.family, km: r.km };
      for (const [layout, budget] of [['compact', 3], ['desktop', 9]]) {
        const h = mapsHandover(r.line, r.loop, budget);
        assert(h, result.key);
        assert.deepEqual(h.points[0].point, r.line[0]);
        assert.deepEqual(h.points.at(-1).point, r.line.at(-1));
        assert(h.points.length <= budget + 2);
        assert(h.href.length <= 2048);
        assert(h.points.every((p, i) => p.point.every(Number.isFinite) && (!i || p.km > h.points[i - 1].km)));
        const url = new URL(h.href);
        const coordinates = [url.searchParams.get('origin'), ...(url.searchParams.get('waypoints')?.split('|') ?? []), url.searchParams.get('destination')];
        assert.deepEqual(coordinates, h.points.map(({ point: [lon, lat] }) => `${lat},${lon}`));
        result[layout] = { waypoints: h.points.length - 2, parts: 1, limited: h.limited,
          maxGapKm: h.maxGapKm, maxDeviationKm: h.maxDeviationKm, urlLength: h.href.length,
          href: h.href, points: h.points };
      }
      return result;
    });
    report.countries[country] = { routes: rows.length, hashes: docs.map(({ hash, source }) => ({ source, hash })) };
    for (const layout of ['desktop', 'compact']) {
      const histogram = {};
      for (const row of rows) histogram[row[layout].waypoints] = (histogram[row[layout].waypoints] ?? 0) + 1;
      report.countries[country][layout] = {
        waypointHistogram: histogram, pointCount: quantiles(rows.map((r) => r[layout].waypoints + 2)),
        partsPerRoute: 1, limitedRoutes: rows.filter((r) => r[layout].limited).length,
        maxGapKm: quantiles(rows.map((r) => r[layout].maxGapKm)),
        maxDeviationKm: quantiles(rows.map((r) => r[layout].maxDeviationKm)),
        urlLength: quantiles(rows.map((r) => r[layout].urlLength)),
        worstGap: [...rows].sort((a, b) => b[layout].maxGapKm - a[layout].maxGapKm)[0].key,
        worstDeviation: [...rows].sort((a, b) => b[layout].maxDeviationKm - a[layout].maxDeviationKm)[0].key,
      };
    }
    const examples = [
      country === 'ee' ? rows.find((r) => r.key === 'ee:circuit:area-041-main') : rows.filter((r) => r.family === 'circuit').sort((a, b) => b.km - a.km)[0],
      rows.filter((r) => r.family === 'sprint').sort((a, b) => a.km - b.km)[0],
      rows.filter((r) => r.family === 'linked-loop').sort((a, b) => b.km - a.km)[0],
      rows.filter((r) => r.family === 'linked-open').sort((a, b) => b.name.length - a.name.length)[0],
    ];
    report.examples.push(...examples);
  }
  const target = new URL('./maps-handover-measurements-20261004.json', import.meta.url);
  writeFileSync(target, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.countries, null, 2));
  console.log('Examples:', report.examples.map(({ key, name, km }) => ({ key, name, km })));
} finally {
  await server.close();
}
