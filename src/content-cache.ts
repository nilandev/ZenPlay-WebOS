interface CacheEntry<T> {
  value: T;
  /** Date.now() when this entry was written — used to decide staleness, see getCacheAge/isCacheStale. */
  cachedAt: number;
  /** Determines which STALE_AFTER_MS_BY_KIND threshold applies — see isCacheStale. Stored on the entry itself (rather than required as a second argument to isCacheStale) so a caller checking staleness never has to remember/re-supply the same kind it originally cached with. */
  kind: CacheKind;
}

const MEMORY_CACHE = new Map<string, CacheEntry<unknown>>();
const STORAGE_PREFIX = "iptv.cache.v1:";

/**
 * How volatile each kind of cached content actually is on a real Xtream
 * provider. Catalogs/categories/account info change on the timescale of
 * hours-to-days, not minutes — a flat 5-minute TTL (the old behavior) meant
 * almost every ordinary revisit re-paid the full 10MB+ catalog fetch for no
 * reason. EPG is the one kind that's worth checking more often, since a
 * viewing session cares about "what's on now" shifting within the hour.
 *
 * These are the *background/foreground staleness* thresholds — see
 * cache-revalidator.ts for how background revalidation uses them, and
 * HomeScreen's Refresh action for how a manual refresh bypasses them
 * entirely (forces a fetch regardless of age).
 */
export type CacheKind = "catalog" | "category" | "epg" | "playlist-info";

const STALE_AFTER_MS_BY_KIND: Record<CacheKind, number> = {
  catalog: 3 * 60 * 60 * 1000, // live/VOD/series lists — hours, not minutes
  category: 6 * 60 * 60 * 1000, // category lists change even less often than the catalogs themselves
  epg: 20 * 60 * 1000, // "what's on now" is worth checking more often within a session
  "playlist-info": 2 * 60 * 60 * 1000, // account status/expiry
};

/** Revives ISO 8601 date strings back into Date instances (JSON.stringify turns Date into a string on write). */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function reviveDates(_key: string, value: unknown): unknown {
  return typeof value === "string" && ISO_DATE_RE.test(value) ? new Date(value) : value;
}

function readFromSessionStorage<T>(key: string): CacheEntry<T> | undefined {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + key);
    return raw ? (JSON.parse(raw, reviveDates) as CacheEntry<T>) : undefined;
  } catch {
    // Corrupt entry or sessionStorage unavailable (private browsing, quota) — treat as a cache miss.
    return undefined;
  }
}

function writeToSessionStorage<T>(key: string, entry: CacheEntry<T>): void {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
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
 *
 * A third, persistent tier (IndexedDB) backs this further so a cold app
 * start after webOS suspends/kills the process — which does not preserve
 * sessionStorage — still has something to show; see indexeddb-store.ts and
 * initContentCacheFromIdb below.
 */
export function getCachedContent<T>(key: string): T | undefined {
  const entry = getCacheEntry<T>(key);
  return entry?.value;
}

function getCacheEntry<T>(key: string): CacheEntry<T> | undefined {
  if (MEMORY_CACHE.has(key)) return MEMORY_CACHE.get(key) as CacheEntry<T>;
  const fromStorage = readFromSessionStorage<T>(key);
  if (fromStorage !== undefined) MEMORY_CACHE.set(key, fromStorage);
  return fromStorage;
}

/** True when there's no cached entry, or it's older than its kind's freshness window and due for a background refetch. */
export function isCacheStale(key: string): boolean {
  const entry = getCacheEntry(key);
  if (!entry) return true;
  return Date.now() - entry.cachedAt > STALE_AFTER_MS_BY_KIND[entry.kind];
}

export function setCachedContent<T>(key: string, value: T, kind: CacheKind): void {
  const entry: CacheEntry<T> = { value, cachedAt: Date.now(), kind };
  MEMORY_CACHE.set(key, entry);
  writeToSessionStorage(key, entry);
  writeToIdbStore(key, entry);
}

/** Drops a single cached entry (memory + sessionStorage + IndexedDB) so its next load re-fetches from the source — used by ManagePlaylistsScreen's per-source Refresh action. */
export function clearCachedContent(key: string): void {
  MEMORY_CACHE.delete(key);
  try {
    sessionStorage.removeItem(STORAGE_PREFIX + key);
  } catch {
    // sessionStorage unavailable — in-memory cache is already cleared, which is enough for the current tab session.
  }
  void deleteFromIdbStore(key);
}

/**
 * Drops every cached entry belonging to one playlist source (memory +
 * sessionStorage + IndexedDB) — live/VOD/series/EPG/playlist-info, anything
 * cached under a `<kind>:${sourceId}` key — so the next visit to any screen
 * re-fetches fresh data for that source. Every cache key in this app follows
 * that `<kind>:${sourceId}` shape (see LiveTvScreen/VodScreen/SeriesScreen/
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
  void deleteFromIdbStoreBySuffix(suffix);
}

/** Drops every cached entry (memory + sessionStorage + IndexedDB) so the next load of each screen re-fetches from the source — used by the home screen's "Refresh" tile. */
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
  void clearIdbStore();
}

// --- IndexedDB persistent tier -------------------------------------------
//
// sessionStorage (above) is wiped whenever the browsing session ends, which
// on webOS means whenever the app is suspended/killed — the normal
// lifecycle for a backgrounded TV app, not an edge case. IndexedDB survives
// that, so it's used as a boot-time warm-up source: writes go through
// fire-and-forget (nothing here needs to await a write before continuing,
// since the in-memory Map + sessionStorage tiers already serve the value
// synchronously), and initContentCacheFromIdb() is called once from
// src/main.tsx to refill the in-memory Map from whatever survived, notifying
// any already-mounted screen via bumpCacheVersion so it can pick up the
// restored data without needing to remount.
//
// Every function here degrades to a no-op on failure (unsupported/disabled
// IndexedDB, quota, private-mode restrictions) — exactly like
// readFromSessionStorage/writeToSessionStorage above — since the in-memory +
// sessionStorage tiers already make this a purely additive enhancement.

import { deleteAllBySuffix, deleteKey, getAllEntries, openIdbStore, putEntry, clearStore } from "./core/storage/indexeddb-store.js";
import { bumpCacheVersion } from "./cache-invalidation-store.js";

const LEGACY_GUIDE_KEY_PREFIX = "guide-epg:";

function writeToIdbStore<T>(key: string, entry: CacheEntry<T>): void {
  openIdbStore()
    .then((store) => putEntry(store, key, entry))
    .catch(() => {
      // IndexedDB unavailable — the in-memory + sessionStorage tiers already have the value, which is enough for this session.
    });
}

function deleteFromIdbStore(key: string): Promise<void> {
  return openIdbStore()
    .then((store) => deleteKey(store, key))
    .catch(() => {
      // Nothing to clean up if IndexedDB isn't available in the first place.
    });
}

function deleteFromIdbStoreBySuffix(suffix: string): Promise<void> {
  return openIdbStore()
    .then((store) => deleteAllBySuffix(store, suffix))
    .catch(() => {
      // Nothing to clean up if IndexedDB isn't available in the first place.
    });
}

function clearIdbStore(): Promise<void> {
  return openIdbStore()
    .then((store) => clearStore(store))
    .catch(() => {
      // Nothing to clean up if IndexedDB isn't available in the first place.
    });
}

/**
 * Warms the in-memory Map from IndexedDB once at app boot (see main.tsx) so
 * a cold start after webOS suspended/killed the app still has something to
 * show, instead of every screen seeing a genuine cache miss. Deliberately
 * not awaited by app startup — this runs in the background and notifies
 * already-mounted screens via bumpCacheVersion as entries arrive, rather
 * than delaying first paint on an IndexedDB round-trip.
 */
export async function initContentCacheFromIdb(): Promise<void> {
  try {
    const store = await openIdbStore();
    const entries = await getAllEntries<unknown>(store);
    for (const [key, entry] of entries) {
      // Don't clobber a value this session has already fetched fresh (e.g. a
      // very fast cold start that raced its own first screen's fetch) —
      // only fill in what's genuinely missing from the in-memory tier.
      if (MEMORY_CACHE.has(key)) continue;
      // Pre-table guide blobs (now kept in epg-db.ts's own table): never
      // revive one into memory — they can be 100k+ programmes — just delete.
      if (key.startsWith(LEGACY_GUIDE_KEY_PREFIX)) {
        void deleteKey(store, key).catch(() => {});
        continue;
      }
      MEMORY_CACHE.set(key, entry as CacheEntry<unknown>);
      bumpCacheVersion(key);
    }
  } catch {
    // IndexedDB unavailable or empty (first-ever launch) — nothing to warm from, which is fine.
  }
}
