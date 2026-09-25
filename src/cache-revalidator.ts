import type { PlaylistSource } from "@core";
import { bumpCacheVersion } from "./cache-invalidation-store.js";
import { type CacheKind, isCacheStale, setCachedContent } from "./content-cache.js";
import { loadChannelsByKind, loadPlaylistInfo, loadSeriesCategories, loadVodCategories } from "./content-loader.js";

export interface RevalidationTarget {
  key: string;
  kind: CacheKind;
  load: () => Promise<unknown>;
}

/**
 * The complete set of cache keys HomeScreen keeps warm for the active
 * source — one definition shared by the periodic background revalidator,
 * the manual Refresh action, and the idle prefetcher (see
 * startBackgroundRevalidation, HomeScreen's handleRefresh, and
 * idle-prefetch.ts) so all three agree on exactly what "this source's
 * content" means instead of drifting into three separate lists.
 *
 * Deliberately excludes the full VOD/series catalogs (`vod:${source.id}` /
 * `series-list:${source.id}`) — those are now kept fresh by
 * catalog-sync.ts's own once-a-day background sync into the local
 * IndexedDB table (see HomeScreen's startCatalogBackgroundSync effect),
 * which VodScreen/SeriesScreen read from directly once synced, rather than
 * this hours-scale blob-cache revalidator re-fetching the entire (possibly
 * 100k+ record) catalog on every tick. A source that hasn't completed its
 * first catalog sync yet still gets its full catalog via
 * content-loader.ts's direct fetch path — see those screens' fallback
 * logic — so nothing here is needed to keep that path populated either.
 *
 * The programme guide isn't here either: it lives in its own local table,
 * synced off the main thread by epg-sync.ts (see syncEpgIfDue/syncEpg).
 */
export function buildRevalidationTargets(source: PlaylistSource): RevalidationTarget[] {
  return [
    { key: `live:${source.id}`, kind: "catalog", load: () => loadChannelsByKind(source, "live") },
    { key: `vod-categories:${source.id}`, kind: "category", load: () => loadVodCategories(source) },
    { key: `series-categories:${source.id}`, kind: "category", load: () => loadSeriesCategories(source) },
    { key: `playlist-info:${source.id}`, kind: "playlist-info", load: () => loadPlaylistInfo(source) },
  ];
}

const MAX_CONCURRENT_REVALIDATIONS = 2;
const DEFAULT_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries a background fetch with exponential backoff. Deliberately only
 * used here (background revalidation), not inside useCachedContent's own
 * fetch path — a user-initiated screen mount should fail fast and show its
 * error state, not spin silently for several seconds retrying, whereas a
 * background refresh nobody is watching can afford to.
 */
async function withRetry<T>(fn: () => Promise<T>, retries = DEFAULT_RETRIES, baseDelayMs = DEFAULT_BASE_DELAY_MS): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) await delay(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}

/** Runs `worker` over `items` with at most `concurrency` in flight at once — a plain bounded queue, no dependency needed for this small a job. */
async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  async function next(): Promise<void> {
    while (index < items.length) {
      const item = items[index++];
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
}

export interface RevalidateOptions {
  /** When true, fetches every target regardless of staleness — used by a manual Refresh action so it always does real work, not just when something happens to be due. */
  force?: boolean;
}

/**
 * Re-fetches every stale (or, with force, every) target, writes fresh data
 * into content-cache.ts, and bumps its invalidation version so any
 * already-mounted screen using that key picks it up without remounting (see
 * cache-invalidation-store.ts). One target's failure (after retries) is
 * swallowed and does not stop the others — a slow/broken provider call for
 * one kind of content shouldn't block revalidating everything else, and the
 * previously-cached value for that key is simply left in place untouched.
 */
export async function revalidateStaleTargets(targets: RevalidationTarget[], options: RevalidateOptions = {}): Promise<void> {
  const { force = false } = options;
  const due = force ? targets : targets.filter((target) => isCacheStale(target.key));

  await runWithConcurrency(due, MAX_CONCURRENT_REVALIDATIONS, async (target) => {
    try {
      const value = await withRetry(target.load);
      setCachedContent(target.key, value, target.kind);
      bumpCacheVersion(target.key);
    } catch {
      // Exhausted retries — leave the existing cached value (if any) in
      // place rather than surfacing an error nobody asked to see; the next
      // scheduled tick (or a manual Refresh) will try again.
    }
  });
}

/**
 * Schedules revalidateStaleTargets on a fixed interval. `getTargets` is
 * called fresh on every tick (not captured once) so it always reflects
 * whatever the current active source/profile actually need, rather than a
 * stale closure from whenever the scheduler started. Returns a stop
 * function; HomeScreen starts this on mount and stops it on unmount (Home
 * fully unmounts/remounts on every tab switch — see App.tsx — so this is
 * effectively restarted each time the user returns Home, which is fine
 * given the coarse, hours-long TTLs involved).
 *
 * setInterval rather than requestIdleCallback: nothing else in this
 * codebase uses requestIdleCallback, and its support/behavior across TV
 * WebKit/Chromium builds isn't reliable enough to depend on — a plain
 * interval is simple and sufficient for a background task this infrequent.
 */
export function startBackgroundRevalidation(getTargets: () => RevalidationTarget[], intervalMs = 15 * 60 * 1000): () => void {
  const handle = setInterval(() => {
    void revalidateStaleTargets(getTargets());
  }, intervalMs);
  return () => clearInterval(handle);
}
