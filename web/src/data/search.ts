import { roadKey, type Catalogue } from './model';
import type { SearchSelection } from './filters';

export interface Suggestion {
  id: string;
  label: string;
  description: string;
  selection: SearchSelection;
  count: number;
}

export interface SearchIndex {
  entries: (Suggestion & { key: string; words: string[] })[];
}

/**
 * Only names actually present in the data: the circuit areas and road names.
 * There is no gazetteer or geocoder, so a town or postcode will not match.
 */
export function buildSearchIndex(cat: Catalogue): SearchIndex {
  const entries: SearchIndex['entries'] = [];
  const areaNameCount = new Map<string, number>();
  for (const a of cat.areas) areaNameCount.set(a.name, (areaNameCount.get(a.name) ?? 0) + 1);
  for (const a of cat.areas) {
    const inArea = cat.routes.filter((r) => r.circuit?.areaId === a.id);
    // Two areas can share a label; disambiguate with the circuits they hold.
    const circuits = inArea.map((r) => r.name).join(', ');
    const key = roadKey(a.name);
    entries.push({
      id: `area:${a.id}`,
      label: a.name,
      description:
        (areaNameCount.get(a.name)! > 1 ? `Circuit area at ${a.lat.toFixed(2)}, ${a.lon.toFixed(2)}` : 'Circuit area') +
        (circuits ? ` · ${circuits}` : ''),
      selection: { kind: 'area', id: a.id, name: a.name },
      count: inArea.length,
      key,
      words: key.split(/[\s-]+/),
    });
  }
  const roads = new Map<string, { name: string; count: number }>();
  for (const r of cat.routes) {
    const seen = new Set<string>();
    // Anchors too: `roads` is only the top three by fun-km and can omit one.
    for (const name of [...r.roads.map((x) => x.name), ...r.anchorRoads]) {
      const key = roadKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const entry = roads.get(key) ?? { name, count: 0 };
      entry.count++;
      roads.set(key, entry);
    }
  }
  for (const [key, { name, count }] of roads) {
    entries.push({
      id: `road:${key}`,
      label: name,
      description: `Road · in ${count} route${count === 1 ? '' : 's'}`,
      selection: { kind: 'road', name, key },
      count,
      key,
      words: key.split(/[\s-]+/),
    });
  }
  return { entries };
}

export function searchSuggestions(index: SearchIndex, query: string, limit = 8): Suggestion[] {
  const q = roadKey(query);
  if (q.length < 2) return [];
  const scored: { s: SearchIndex['entries'][number]; rank: number }[] = [];
  for (const e of index.entries) {
    let rank = -1;
    if (e.key === q) rank = 0;
    else if (e.key.startsWith(q)) rank = 1;
    else if (e.words.some((w) => w.startsWith(q))) rank = 2;
    else if (e.key.includes(q)) rank = 3;
    if (rank >= 0) scored.push({ s: e, rank });
  }
  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      (a.s.selection.kind === b.s.selection.kind ? 0 : a.s.selection.kind === 'area' ? -1 : 1) ||
      b.s.count - a.s.count ||
      a.s.label.localeCompare(b.s.label),
  );
  return scored.slice(0, limit).map(({ s }) => ({
    id: s.id,
    label: s.label,
    description: s.description,
    selection: s.selection,
    count: s.count,
  }));
}
