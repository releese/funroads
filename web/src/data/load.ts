import type { LinkedDoc, RoutesDoc } from './raw';
import { validateLinkedDoc, validateRoutesDoc, type Validated } from './validate';
import { DEFAULT_COUNTRY, type Country } from './countries';
import { CATALOGUES } from 'virtual:funroads-release';

export type Progress = (loadedBytes: number, totalBytes: number | null) => void;

async function fetchJson(url: string, onProgress?: Progress, signal?: AbortSignal, integrity?: string): Promise<unknown> {
  const res = await fetch(url, { signal, integrity });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get('Content-Length')) || null;
  if (!res.body || !onProgress) return res.json();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  const buf = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) {
    buf.set(c, o);
    o += c.length;
  }
  return JSON.parse(new TextDecoder().decode(buf));
}

export interface LoadOutcome<T> {
  value: Validated<T> | null;
  error: string | null;
}

async function settle<T>(p: Promise<unknown>, validate: (raw: unknown) => Validated<T>): Promise<LoadOutcome<T>> {
  try {
    return { value: validate(await p), error: null };
  } catch (e) {
    return { value: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Both documents load and validate independently; one failing never blocks the other. */
export async function loadAll(base: string, onProgress?: Progress, country: Country = DEFAULT_COUNTRY, signal?: AbortSignal) {
  const progress = new Map<string, [number, number | null]>();
  const report = (name: string): Progress => (l, t) => {
    progress.set(name, [l, t]);
    if (!onProgress) return;
    let loaded = 0;
    let total: number | null = 0;
    for (const [pl, pt] of progress.values()) {
      loaded += pl;
      total = total == null || pt == null ? null : total + pt;
    }
    onProgress(loaded, total);
  };
  const fetchCatalogue = (name: 'routes' | 'linked') => {
    const file = `data/${country.id}/${name}.json`;
    const entry = CATALOGUES[file];
    return fetchJson(`${base}${entry?.file ?? file}`, report(name), signal, entry?.integrity);
  };
  const [routes, linked] = await Promise.all([
    settle<RoutesDoc>(fetchCatalogue('routes'), (raw) => validateRoutesDoc(raw, country)),
    settle<LinkedDoc>(fetchCatalogue('linked'), (raw) => validateLinkedDoc(raw, country)),
  ]);
  return { routes, linked };
}
