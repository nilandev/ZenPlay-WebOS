import { XtreamClient, type Channel, type PlaylistSource, type SeriesInfo } from "@core";
import {
  catalogSyncMetaKey,
  deleteSourceCatalog,
  deleteStaleGeneration,
  getSyncMeta,
  openCatalogDb,
  putRecordsBatch,
  putSyncMeta,
  type CatalogKind,
} from "./core/storage/catalog-db.js";
import { bumpCacheVersion } from "./cache-invalidation-store.js";
import { channelToRecord, seriesToRecord } from "./catalog-records.js";
import { clearCachedContentMatching } from "./content-cache.js";
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
 * Only Xtream sources are synced here — an M3U playlist's movies arrive in
 * the same file as its live channels, so live-sync-core.ts writes them into
 * this same table from that one download. When to sync is decided by
 * sync/sync-manager.ts, never by screens.
 */

const SYNC_STALE_AFTER_MS = 24 * 60 * 60 * 1000; // once/day, per the request's "periodically once every day" ask — coarser than content-cache.ts's hours-scale CacheKind thresholds, since this is the full-table resync, not the screen-level blob cache.

const catalogWorker = createCatalogWorkerClient();

/** One in-flight sync per source+kind, so overlapping requests never write the same table twice at once. */
const inFlightSyncs = new Map<string, Promise<void>>();

const syncMetaKey = catalogSyncMetaKey;

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

/** True once at least one full sync has completed for this source+kind — see use-local-catalog-ready.ts. */
export async function hasCompletedSync(sourceId: string, kind: CatalogKind): Promise<boolean> {
  try {
    const catalogDb = await openCatalogDb();
    const meta = await getSyncMeta(catalogDb, syncMetaKey(sourceId, kind));
    return meta !== undefined;
  } catch {
    return false;
  }
}

/**
 * Runs one full sync for a source+kind: authenticates on the main thread
 * first (same reasoning as content-loader.ts's loadChannelsByKind — a bad
 * login should surface as XtreamAuthError rather than a generic worker
 * failure), then streams the catalog worker's batches straight into
 * IndexedDB tagged with a new generation, and only once every batch has
 * landed does it flip sync_meta to that generation and delete the old one —
 * see catalog-db.ts's deleteStaleGeneration doc comment. A refresh is a
 * full replace (dropped titles disappear); during it readers may briefly
 * see old and new rows side by side, but never a title missing, and a sync
 * that dies partway leaves the previous generation fully readable.
 */
async function runSync(source: PlaylistSource, kind: CatalogKind, onProgress?: (written: number) => void): Promise<void> {
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
    onProgress?.(recordCount);
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
  // useCachedContent uses for its own cache keys.
  bumpCacheVersion(catalogVersionKey(source.id, kind));
  // The per-category lists fetched while the table was being built (and any
  // full-list blob from before the table existed) are superseded now — free them.
  const blobKey = kind === "vod" ? `vod:${source.id}` : `series-list:${source.id}`;
  clearCachedContentMatching((key) => key === blobKey || key.startsWith(`${blobKey}:cat:`));
}

/** Fetches and stores the full catalog for one source+kind, deduping overlapping calls for the same source+kind (see inFlightSyncs' doc comment). Safe to call even when a sync isn't due — callers that only want to sync when due should check isCatalogSyncDue first. */
export function syncCatalog(source: PlaylistSource, kind: CatalogKind, options: { onProgress?: (written: number) => void } = {}): Promise<void> {
  const key = `${source.id}:${kind}`;
  const existing = inFlightSyncs.get(key);
  if (existing) return existing;

  const promise = runSync(source, kind, options.onProgress).finally(() => inFlightSyncs.delete(key));
  inFlightSyncs.set(key, promise);
  return promise;
}

/** Drops a source's movie and series tables and their sync records (reset / removal — see sync/purge.ts). */
export async function clearCatalogForSource(sourceId: string): Promise<void> {
  try {
    const catalogDb = await openCatalogDb();
    await Promise.all([deleteSourceCatalog(catalogDb, "vod", sourceId), deleteSourceCatalog(catalogDb, "series", sourceId)]);
  } catch {
    // Storage unavailable — nothing stored to clear.
  }
  bumpCacheVersion(catalogVersionKey(sourceId, "vod"));
  bumpCacheVersion(catalogVersionKey(sourceId, "series"));
}

/** Test-only escape hatch: clears in-flight sync tracking between tests, mirroring xtream-client.ts's __resetRequestDedupeCacheForTests. */
export function __resetCatalogSyncForTests(): void {
  inFlightSyncs.clear();
}
