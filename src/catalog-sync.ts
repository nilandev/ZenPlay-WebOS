import { KIDS_RULES_VERSION, XtreamClient, type PlaylistSource } from "@core";
import { deleteSourceCatalog, getSyncMeta, openCatalogDb, catalogSyncMetaKey, type CatalogKind } from "./core/storage/catalog-db.js";
import { bumpCacheVersion } from "./cache-invalidation-store.js";
import type { CatalogSyncResult } from "./catalog-sync-core.js";
import { clearCachedContentMatching } from "./content-cache.js";
import { proxyFetch } from "./proxy-fetch.js";
import { loadSettings } from "./settings-store.js";
import { runSyncJobOffMainThread } from "./workers/sync-worker-client.js";

export type { CatalogKind };

/**
 * Background full-catalog sync for Xtream movies and series. The download,
 * parse and writes run in the sync worker (catalog-sync-core.ts, which
 * only writes what changed since the last sync); this is the main-thread
 * side — checking the login first, deciding when a sync is due, deduping,
 * and telling mounted screens (use-catalog-page.ts) when the table changed.
 *
 * VodScreen/SeriesScreen read paginated, indexed slices of the table and
 * never load the whole catalog themselves. An M3U playlist's movies arrive
 * in the same file as its live channels, so live-sync-core.ts writes them.
 * When to sync is decided by sync/sync-manager.ts, never by screens — except
 * refreshCatalogCategory, a screen's "Refresh" on the category it shows.
 */

const HOUR_MS = 60 * 60 * 1000;

/** A catalog is refetched once it's older than this — the "Movies & Series Sync Interval" setting. */
export function catalogStaleAfterMs(): number {
  return loadSettings().catalogRefreshHours * HOUR_MS;
}

/** One in-flight sync per source+kind (and per refreshed category), so overlapping requests never write the same rows twice at once. */
const inFlightSyncs = new Map<string, Promise<unknown>>();

/** When each category was last refreshed on its own this session — for a screen's "Updated …" line. */
const categoryRefreshedAt = new Map<string, number>();

const syncMetaKey = catalogSyncMetaKey;

/** Cache-invalidation key screens subscribe to (via use-catalog-page.ts) to notice a completed sync without remounting — same mechanism content-cache.ts's revalidation/prefetch/IDB-warm-up already use (see cache-invalidation-store.ts). */
export function catalogVersionKey(sourceId: string, kind: CatalogKind): string {
  return `local-catalog:${sourceId}:${kind}`;
}

export async function isCatalogSyncDue(sourceId: string, kind: CatalogKind): Promise<boolean> {
  try {
    const catalogDb = await openCatalogDb();
    const meta = await getSyncMeta(catalogDb, syncMetaKey(sourceId, kind));
    if (!meta) return true;
    // Tagged under older Kids rules: re-sync so the tag index matches the bundled rules.
    if ((meta.rulesVersion ?? 0) < KIDS_RULES_VERSION) return true;
    return Date.now() - meta.lastSyncedAt > catalogStaleAfterMs();
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

/** When the stored catalog was last fully synced, or undefined before its first sync. */
export async function getCatalogSyncedAt(sourceId: string, kind: CatalogKind): Promise<number | undefined> {
  try {
    return (await getSyncMeta(await openCatalogDb(), syncMetaKey(sourceId, kind)))?.lastSyncedAt;
  } catch {
    return undefined;
  }
}

/** When a category was last refreshed on its own this session (see refreshCatalogCategory). */
export function getCategoryRefreshedAt(sourceId: string, kind: CatalogKind, categoryId: string): number | undefined {
  return categoryRefreshedAt.get(`${sourceId}:${kind}:${categoryId}`);
}

/** Lets mounted screens re-read the table (see use-catalog-page.ts) and frees the per-category lists fetched before it existed. */
function afterCatalogChange(sourceId: string, kind: CatalogKind): void {
  bumpCacheVersion(catalogVersionKey(sourceId, kind));
  const blobKey = kind === "vod" ? `vod:${sourceId}` : `series-list:${sourceId}`;
  clearCachedContentMatching((key) => key === blobKey || key.startsWith(`${blobKey}:cat:`));
}

/**
 * Runs one full sync for a source+kind: checks the login on the main
 * thread first (cheap, deduped by XtreamClient, and a bad password rejects
 * with XtreamAuthError rather than a generic worker failure), then hands the
 * download and writes to the sync worker.
 */
async function runSync(source: PlaylistSource, kind: CatalogKind, onProgress?: (processed: number) => void): Promise<CatalogSyncResult | undefined> {
  if (source.kind !== "xtream") return undefined;
  await new XtreamClient(source, proxyFetch).authenticate();
  const result = await runSyncJobOffMainThread("catalog", { source, kind }, onProgress);
  afterCatalogChange(source.id, kind);
  return result;
}

/** Fetches and stores the full catalog for one source+kind, deduping overlapping calls for the same source+kind (see inFlightSyncs' doc comment). Safe to call even when a sync isn't due — callers that only want to sync when due should check isCatalogSyncDue first. */
export function syncCatalog(
  source: PlaylistSource,
  kind: CatalogKind,
  options: { onProgress?: (processed: number) => void } = {},
): Promise<CatalogSyncResult | undefined> {
  const key = `${source.id}:${kind}`;
  const existing = inFlightSyncs.get(key) as Promise<CatalogSyncResult | undefined> | undefined;
  if (existing) return existing;

  const promise = runSync(source, kind, options.onProgress).finally(() => inFlightSyncs.delete(key));
  inFlightSyncs.set(key, promise);
  return promise;
}

/**
 * Re-downloads one category of an already-synced Xtream catalog (a
 * screen's "Refresh") and writes only what changed in it. Waits for a
 * full sync of the same catalog that's already running, then goes ahead.
 */
export function refreshCatalogCategory(source: PlaylistSource, kind: CatalogKind, categoryId: string): Promise<CatalogSyncResult> {
  const key = `${source.id}:${kind}:${categoryId}`;
  const existing = inFlightSyncs.get(key) as Promise<CatalogSyncResult> | undefined;
  if (existing) return existing;

  const promise = (async () => {
    await inFlightSyncs.get(`${source.id}:${kind}`)?.catch(() => undefined);
    if (source.kind === "xtream") await new XtreamClient(source, proxyFetch).authenticate();
    const result = await runSyncJobOffMainThread("catalog", { source, kind, categoryId });
    categoryRefreshedAt.set(key, Date.now());
    afterCatalogChange(source.id, kind);
    return result;
  })().finally(() => inFlightSyncs.delete(key));
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
  categoryRefreshedAt.clear();
}
