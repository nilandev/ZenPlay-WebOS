import { deleteKey, deleteKeysMatching, getEntry, openIdbStore, putEntry, clearStore } from "./core/storage/indexeddb-store.js";

interface CacheEntry<T> {
  value: T;
  /** Date.now() when this entry was written — used to decide staleness, see isCacheStale. */
  cachedAt: number;
  /** Determines which STALE_AFTER_MS_BY_KIND threshold applies — see isCacheStale. Stored on the entry itself (rather than required as a second argument to isCacheStale) so a caller checking staleness never has to remember/re-supply the same kind it originally cached with. */
  kind: CacheKind;
}

/**
 * How volatile each kind of cached content actually is on a real Xtream
 * provider. Catalogs/categories/account info change on the timescale of
 * hours-to-days, not minutes. EPG is the one kind that's worth checking
 * more often, since a viewing session cares about "what's on now".
 *
 * These are the freshness windows useCachedContent checks before refetching
 * (the sync manager refreshes categories and account info alongside its
 * own stages, and a manual Refresh forces them).
 */
export type CacheKind = "catalog" | "category" | "epg" | "playlist-info";

const STALE_AFTER_MS_BY_KIND: Record<CacheKind, number> = {
  catalog: 3 * 60 * 60 * 1000, // VOD/series lists on the not-yet-synced fallback path, series details
  category: 6 * 60 * 60 * 1000, // category lists change even less often than the catalogs themselves
  epg: 20 * 60 * 1000, // "what's on now" is worth checking more often within a session
  "playlist-info": 2 * 60 * 60 * 1000, // account status/expiry
};

/**
 * Two-tier cache for small screen content — category lists, account info,
 * series details, and the VOD/series lists a source uses until its first
 * catalog sync lands: an in-memory Map for instant same-session access,
 * backed by IndexedDB (indexeddb-store.ts) so a cold start after webOS
 * suspends/kills the app still has something to show.
 *
 * The big datasets no longer live here — the live channel list, the
 * programme guide and synced VOD/series catalogs each have their own table
 * (live-db.ts, epg-db.ts, catalog-db.ts), written off the main thread.
 * That's why there's no longer a sessionStorage tier (every write
 * JSON-stringified the whole value on the main thread) nor a boot-time
 * warm-up that deserialized every stored value at once.
 *
 * Instead IndexedDB is read lazily, one key at a time, on a memory miss:
 * getCachedContent/isCacheStale stay synchronous and memory-only, and
 * loadCachedEntry is what callers await before deciding whether to fetch
 * (see use-cached-content.ts and sync/sync-manager.ts), so a cold start
 * reuses a still-fresh stored value instead of refetching it.
 */
const MEMORY_CACHE = new Map<string, CacheEntry<unknown>>();

/** In-flight IndexedDB reads, deduped per key. */
const pendingReads = new Map<string, Promise<CacheEntry<unknown> | undefined>>();

/**
 * Bumped whenever a key is written or cleared (per key, and globally for
 * clear-all) — an IndexedDB read that started before such a change must not
 * put what it read back into memory, or a clear could be undone by a read
 * that was already in flight.
 */
const keyEpochs = new Map<string, number>();
let globalEpoch = 0;
const epochOf = (key: string) => `${globalEpoch}:${keyEpochs.get(key) ?? 0}`;
function bumpEpoch(key: string): void {
  keyEpochs.set(key, (keyEpochs.get(key) ?? 0) + 1);
}

/** The cached value if it's in memory — synchronous, never touches IndexedDB. Await loadCachedEntry first where a cold-start value matters. */
export function getCachedContent<T>(key: string): T | undefined {
  return (MEMORY_CACHE.get(key) as CacheEntry<T> | undefined)?.value;
}

/** True when there's no entry in memory, or it's older than its kind's freshness window. Memory-only, like getCachedContent. */
export function isCacheStale(key: string): boolean {
  const entry = MEMORY_CACHE.get(key);
  if (!entry) return true;
  return Date.now() - entry.cachedAt > STALE_AFTER_MS_BY_KIND[entry.kind];
}

/**
 * The entry for `key` from memory, or else from IndexedDB (then kept in
 * memory). Resolves undefined when it isn't stored anywhere or storage is
 * unavailable — never rejects.
 */
export function loadCachedEntry<T>(key: string): Promise<{ value: T; cachedAt: number } | undefined> {
  const inMemory = MEMORY_CACHE.get(key) as CacheEntry<T> | undefined;
  if (inMemory) return Promise.resolve(inMemory);
  const pending = pendingReads.get(key);
  if (pending) return pending as Promise<CacheEntry<T> | undefined>;

  const epoch = epochOf(key);
  const read = openIdbStore()
    .then((store) => getEntry<CacheEntry<unknown>>(store, key))
    .catch(() => undefined)
    .then((entry) => {
      if (epochOf(key) !== epoch) return MEMORY_CACHE.get(key);
      if (entry && !MEMORY_CACHE.has(key)) MEMORY_CACHE.set(key, entry);
      return MEMORY_CACHE.get(key);
    })
    .finally(() => pendingReads.delete(key));
  pendingReads.set(key, read);
  return read as Promise<CacheEntry<T> | undefined>;
}

export function setCachedContent<T>(key: string, value: T, kind: CacheKind): void {
  const entry: CacheEntry<T> = { value, cachedAt: Date.now(), kind };
  bumpEpoch(key);
  MEMORY_CACHE.set(key, entry);
  void openIdbStore()
    .then((store) => putEntry(store, key, entry))
    .catch(() => {
      // IndexedDB unavailable — the in-memory tier still has the value for this session.
    });
}

/** Drops a single cached entry (memory + IndexedDB) so its next load re-fetches from the source. */
export function clearCachedContent(key: string): void {
  bumpEpoch(key);
  MEMORY_CACHE.delete(key);
  void openIdbStore()
    .then((store) => deleteKey(store, key))
    .catch(() => {});
}

/** Drops every cached entry whose key `matches` (memory + IndexedDB, keys only — values are never read). */
export function clearCachedContentMatching(matches: (key: string) => boolean): void {
  for (const key of [...MEMORY_CACHE.keys(), ...pendingReads.keys()]) {
    if (matches(key)) {
      bumpEpoch(key);
      MEMORY_CACHE.delete(key);
    }
  }
  // Reads started after this point queue behind the delete below (IndexedDB runs overlapping transactions in creation order), so only reads already in flight needed fencing.
  void openIdbStore()
    .then((store) => deleteKeysMatching(store, matches))
    .catch(() => {});
}

/**
 * Drops every cached entry belonging to one playlist source. Every cache key
 * in this app ends in `:${sourceId}` (see the screens' useCachedContent
 * keys), so matching that suffix catches all of them. Used by
 * ManagePlaylistsScreen's per-source "Clear Cache" action.
 */
export function clearCachedContentForSource(sourceId: string): void {
  const suffix = `:${sourceId}`;
  clearCachedContentMatching((key) => key.endsWith(suffix));
}

/** Drops every cached entry (memory + IndexedDB). */
export function clearAllCachedContent(): void {
  globalEpoch++;
  MEMORY_CACHE.clear();
  void openIdbStore()
    .then((store) => clearStore(store))
    .catch(() => {});
}

/**
 * Keys of the big blobs that now live in their own tables (live-db.ts,
 * epg-db.ts) and are never read from this cache again. `live:` matches the
 * old channel-list key but not `live-categories:`.
 */
const LEGACY_TABLE_KEY_PREFIXES = ["guide-epg:", "live:", "guide-channels:"];
/** The removed sessionStorage tier's key prefix. */
const LEGACY_SESSION_STORAGE_PREFIX = "iptv.cache.v1:";

/**
 * One-off housekeeping at boot (see main.tsx), in the background: deletes
 * leftover pre-table blobs from IndexedDB by key alone — values are never
 * read — and whatever the removed sessionStorage tier left behind in this
 * browsing session.
 */
export async function purgeLegacyCacheEntries(): Promise<void> {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(LEGACY_SESSION_STORAGE_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    // sessionStorage unavailable — nothing to clean.
  }
  try {
    const store = await openIdbStore();
    await deleteKeysMatching(store, (key) => LEGACY_TABLE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)));
  } catch {
    // IndexedDB unavailable — nothing to clean.
  }
}

/** Test-only: forgets memory, in-flight reads and epochs (IndexedDB contents are left alone). */
export function __resetMemoryCacheForTests(): void {
  MEMORY_CACHE.clear();
  pendingReads.clear();
  keyEpochs.clear();
  globalEpoch = 0;
}
