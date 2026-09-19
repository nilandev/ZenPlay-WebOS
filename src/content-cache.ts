const MEMORY_CACHE = new Map<string, unknown>();
const STORAGE_PREFIX = "iptv.cache.v1:";

/** Revives ISO 8601 date strings back into Date instances (JSON.stringify turns Date into a string on write). */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function reviveDates(_key: string, value: unknown): unknown {
  return typeof value === "string" && ISO_DATE_RE.test(value) ? new Date(value) : value;
}

function readFromSessionStorage<T>(key: string): T | undefined {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + key);
    return raw ? (JSON.parse(raw, reviveDates) as T) : undefined;
  } catch {
    // Corrupt entry or sessionStorage unavailable (private browsing, quota) — treat as a cache miss.
    return undefined;
  }
}

function writeToSessionStorage(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota exceeded (large EPG payloads) or storage disabled — the in-memory
    // cache still works for the current tab session, so this is non-fatal.
  }
}

/**
 * Two-tier cache for screen content (channel lists, EPG, movies, series):
 * an in-memory Map for instant same-session access, backed by
 * sessionStorage so a page reload within the same browser tab/session still
 * shows cached content immediately instead of an empty screen. Not
 * localStorage — EPG payloads can be large, and this data is meant to be
 * fresh-ish per session rather than kept indefinitely.
 */
export function getCachedContent<T>(key: string): T | undefined {
  if (MEMORY_CACHE.has(key)) return MEMORY_CACHE.get(key) as T;
  const fromStorage = readFromSessionStorage<T>(key);
  if (fromStorage !== undefined) MEMORY_CACHE.set(key, fromStorage);
  return fromStorage;
}

export function setCachedContent<T>(key: string, value: T): void {
  MEMORY_CACHE.set(key, value);
  writeToSessionStorage(key, value);
}

/** Drops a single cached entry (memory + sessionStorage) so its next load re-fetches from the source — used by ManagePlaylistsScreen's per-source Refresh action. */
export function clearCachedContent(key: string): void {
  MEMORY_CACHE.delete(key);
  try {
    sessionStorage.removeItem(STORAGE_PREFIX + key);
  } catch {
    // sessionStorage unavailable — in-memory cache is already cleared, which is enough for the current tab session.
  }
}

/**
 * Drops every cached entry belonging to one playlist source (memory +
 * sessionStorage) — live/VOD/series/EPG/playlist-info, anything cached under
 * a `<kind>:${sourceId}` key — so the next visit to any screen re-fetches
 * fresh data for that source. Every cache key in this app follows that
 * `<kind>:${sourceId}` shape (see LiveTvScreen/VodScreen/SeriesScreen/
 * HomeScreen), so matching on a `:${sourceId}` suffix catches all of them
 * without ManagePlaylistsScreen needing to know each kind's exact prefix.
 * Used by ManagePlaylistsScreen's per-source "Delete Cache" action.
 */
export function clearCachedContentForSource(sourceId: string): void {
  const suffix = `:${sourceId}`;
  for (const key of MEMORY_CACHE.keys()) {
    if (key.endsWith(suffix)) MEMORY_CACHE.delete(key);
  }
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX) && key.endsWith(suffix)) toRemove.push(key);
    }
    for (const key of toRemove) sessionStorage.removeItem(key);
  } catch {
    // sessionStorage unavailable — in-memory cache is already cleared, which is enough for the current tab session.
  }
}

/** Drops every cached entry (memory + sessionStorage) so the next load of each screen re-fetches from the source — used by the home screen's "Refresh" tile. */
export function clearAllCachedContent(): void {
  MEMORY_CACHE.clear();
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    // sessionStorage unavailable — in-memory cache is already cleared, which is enough for the current tab session.
  }
}
