import { XtreamClient, type Channel, type PlaylistSource, type SeriesInfo } from "@core";
import {
  deleteStaleGeneration,
  getSyncMeta,
  openCatalogDb,
  putRecordsBatch,
  putSyncMeta,
  type CatalogKind,
  type CatalogRecord,
} from "./core/storage/catalog-db.js";
import { bumpCacheVersion } from "./cache-invalidation-store.js";
import { proxyFetch } from "./proxy-fetch.js";
import { createCatalogWorkerClient } from "./workers/catalog-worker-client.js";

export type { CatalogKind };

/**
 * Background full-catalog sync: fetches the *entire* VOD/series catalog for
 * a source via the catalog worker's streaming syncCatalog (see
 * catalog-worker-client.ts/catalog-fetch-worker.ts), writing it into the
 * local IndexedDB table (catalog-db.ts) in batches as it arrives, instead of
 * content-cache.ts's old approach of holding one big array in memory/
 * sessionStorage/IndexedDB-as-a-blob.
 *
 * This is what lets VodScreen/SeriesScreen (see use-catalog-page.ts) read
 * paginated, indexed slices of a source's catalog without ever loading the
 * whole thing themselves — the full fetch still happens exactly once
 * per-source per sync interval, just here, off the screen's critical path.
 *
 * Only Xtream sources have a full-catalog concept worth syncing this way —
 * M3U sources are a flat, already-local text file/URL with no separate
 * VOD/series listing API (see content-loader.ts's doc comment), so
 * isCatalogSyncDue/syncCatalog are no-ops for them.
 */

const SYNC_STALE_AFTER_MS = 24 * 60 * 60 * 1000; // once/day, per the request's "periodically once every day" ask — coarser than content-cache.ts's hours-scale CacheKind thresholds, since this is the full-table resync, not the screen-level blob cache.

const catalogWorker = createCatalogWorkerClient();

/** One in-flight sync per source+kind — guards against a screen remounting (VodScreen/SeriesScreen start this on every mount, see startCatalogBackgroundSync) kicking off overlapping syncs of the same table. */
const inFlightSyncs = new Map<string, Promise<void>>();

function syncMetaKey(sourceId: string, kind: CatalogKind): string {
  return `${kind}:${sourceId}`;
}

/** Cache-invalidation key screens subscribe to (via use-catalog-page.ts) to notice a completed sync without remounting — same mechanism content-cache.ts's revalidation/prefetch/IDB-warm-up already use (see cache-invalidation-store.ts). */
export function catalogVersionKey(sourceId: string, kind: CatalogKind): string {
  return `local-catalog:${sourceId}:${kind}`;
}

function actionForKind(kind: CatalogKind): "get_vod_streams" | "get_series" {
  return kind === "vod" ? "get_vod_streams" : "get_series";
}

export async function isCatalogSyncDue(sourceId: string, kind: CatalogKind): Promise<boolean> {
  try {
    const catalogDb = await openCatalogDb();
    const meta = await getSyncMeta(catalogDb, syncMetaKey(sourceId, kind));
    if (!meta) return true;
    return Date.now() - meta.lastSyncedAt > SYNC_STALE_AFTER_MS;
  } catch {
    // IndexedDB unavailable — nothing to sync into, so there's no sync to be "due".
    return false;
  }
}

/** True once at least one full sync has completed for this source+kind — callers (use-catalog-page.ts) use this to decide whether to read the local table or fall back to a direct fetch for a source that's never been synced yet. */
export async function hasCompletedSync(sourceId: string, kind: CatalogKind): Promise<boolean> {
  try {
    const catalogDb = await openCatalogDb();
    const meta = await getSyncMeta(catalogDb, syncMetaKey(sourceId, kind));
    return meta !== undefined;
  } catch {
    return false;
  }
}

function channelToRecord(sourceId: string, generation: number, item: Channel): CatalogRecord {
  return {
    id: `${sourceId}:${item.id}`,
    sourceId,
    streamId: item.id,
    name: item.name,
    nameLower: item.name.toLowerCase(),
    groupTitle: item.groupTitle,
    streamUrl: item.streamUrl,
    logoUrl: item.logoUrl,
    generation,
  };
}

function seriesToRecord(sourceId: string, generation: number, item: Pick<SeriesInfo, "id" | "name" | "posterUrl" | "groupTitle">): CatalogRecord {
  return {
    id: `${sourceId}:${item.id}`,
    sourceId,
    streamId: item.id,
    name: item.name,
    nameLower: item.name.toLowerCase(),
    groupTitle: item.groupTitle,
    posterUrl: item.posterUrl,
    generation,
  };
}

/**
 * Runs one full sync for a source+kind: authenticates on the main thread
 * first (same reasoning as content-loader.ts's loadChannelsByKind — a bad
 * login should surface as XtreamAuthError rather than a generic worker
 * failure), then streams the catalog worker's batches straight into
 * IndexedDB tagged with a new generation, and only once every batch has
 * landed does it flip sync_meta to that generation and delete the old one —
 * see catalog-db.ts's deleteStaleGeneration doc comment for why the order
 * matters (a sync that dies partway through must never leave readers
 * looking at a half-populated table).
 */
async function runSync(source: PlaylistSource, kind: CatalogKind): Promise<void> {
  if (source.kind !== "xtream") return;

  const client = new XtreamClient(source, proxyFetch);
  await client.authenticate();

  const catalogDb = await openCatalogDb();
  const key = syncMetaKey(source.id, kind);
  const previousMeta = await getSyncMeta(catalogDb, key);
  const generation = (previousMeta?.generation ?? 0) + 1;

  let recordCount = 0;
  const writeQueue: Promise<void>[] = [];

  const { total } = await catalogWorker.syncCatalog({ credentials: source, action: actionForKind(kind) }, (batch) => {
    const records =
      kind === "vod"
        ? (batch as Channel[]).map((item) => channelToRecord(source.id, generation, item))
        : (batch as Array<Pick<SeriesInfo, "id" | "name" | "posterUrl" | "groupTitle">>).map((item) => seriesToRecord(source.id, generation, item));
    recordCount += records.length;
    // Batches are written as they arrive rather than awaited serially here —
    // queued and drained together below — so a slow IndexedDB write never
    // backs up the worker's postMessage stream.
    writeQueue.push(putRecordsBatch(catalogDb, kind, records));
  });

  await Promise.all(writeQueue);
  await putSyncMeta(catalogDb, { key, lastSyncedAt: Date.now(), recordCount: total || recordCount, generation });
  if (previousMeta) await deleteStaleGeneration(catalogDb, kind, source.id, generation);
  // Lets an already-mounted VodScreen/SeriesScreen (via use-catalog-page.ts)
  // notice this completed sync and switch from its fallback direct-fetch
  // path to the local table, without needing to remount — same pattern
  // cache-revalidator.ts/idle-prefetch.ts use for their own cache keys.
  bumpCacheVersion(catalogVersionKey(source.id, kind));
}

/** Fetches and stores the full catalog for one source+kind, deduping overlapping calls for the same source+kind (see inFlightSyncs' doc comment). Safe to call even when a sync isn't due — callers that only want to sync when due should check isCatalogSyncDue first. */
export function syncCatalog(source: PlaylistSource, kind: CatalogKind): Promise<void> {
  const key = `${source.id}:${kind}`;
  const existing = inFlightSyncs.get(key);
  if (existing) return existing;

  const promise = runSync(source, kind).finally(() => inFlightSyncs.delete(key));
  inFlightSyncs.set(key, promise);
  return promise;
}

const CHECK_INTERVAL_MS = 20 * 60 * 1000; // How often to check whether a sync is due — the actual sync only ever runs once per SYNC_STALE_AFTER_MS, this just keeps a suspended/backgrounded TV from missing its daily window, same rationale as cache-revalidator.ts's startBackgroundRevalidation interval.

/**
 * Checks the given catalogs for `getSource()`'s current source and kicks off
 * a background syncCatalog for whichever is due, then repeats on
 * CHECK_INTERVAL_MS — mirrors cache-revalidator.ts's
 * startBackgroundRevalidation (see its doc comment for why a plain interval,
 * not requestIdleCallback). Started by VodScreen ("vod") and SeriesScreen
 * ("series") while they're open — not from Home, which does no data work —
 * so each screen's local paginated table (see use-catalog-page.ts) gets
 * built the first time it's visited and refreshed daily after that.
 * Returns a stop function.
 */
export function startCatalogBackgroundSync(getSource: () => PlaylistSource, kinds: CatalogKind[] = ["vod", "series"]): () => void {
  async function checkAndSync(): Promise<void> {
    const source = getSource();
    if (source.kind !== "xtream") return;
    for (const kind of kinds) {
      if (await isCatalogSyncDue(source.id, kind)) {
        // A failed sync (offline, provider error) isn't fatal: the screen
        // keeps using its legacy direct-fetch path, and the next interval
        // tick retries since sync_meta was never written.
        syncCatalog(source, kind).catch(() => {});
      }
    }
  }

  void checkAndSync();
  const handle = setInterval(() => void checkAndSync(), CHECK_INTERVAL_MS);
  return () => clearInterval(handle);
}

/** Test-only escape hatch: clears in-flight sync tracking between tests, mirroring xtream-client.ts's __resetRequestDedupeCacheForTests. */
export function __resetCatalogSyncForTests(): void {
  inFlightSyncs.clear();
}
