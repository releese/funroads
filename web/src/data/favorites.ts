/**
 * Favorites persist in localStorage, keyed by route key. Route keys are content
 * hashes, so a data regeneration can invalidate saved favorites. Names are kept
 * alongside so the UI can say which saved routes disappeared.
 */
const KEY = 'funroads:favorites:v1';
const NAMES_KEY = 'funroads:favorites:names:v1';

export function loadFavoriteNames(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Record<string, string> {
  if (!storage) return {};
  try {
    const raw: unknown = JSON.parse(storage.getItem(NAMES_KEY) ?? '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === 'string'));
  } catch {
    return {};
  }
}

export function saveFavoriteNames(names: Record<string, string>, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(NAMES_KEY, JSON.stringify(names));
  } catch {
    // Same as favorites: keep them in memory only.
  }
}

export function loadFavorites(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Set<string> {
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return new Set();
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

export function saveFavorites(favs: ReadonlySet<string>, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify([...favs].sort()));
  } catch {
    // Quota or privacy mode: favorites stay in memory for this session.
  }
}

export function toggleFavorite(favs: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(favs);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
