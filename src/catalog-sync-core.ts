import { KIDS_RULES_VERSION, mapSeriesEntry, mapVodStream, type Channel, type PlaylistSource, type XtreamSeriesRaw, type XtreamVodStreamRaw } from "@core";
import {
  catalogSyncMetaKey,
  countRecords,
  getSyncMeta,
  openCatalogDb,
  putSyncMeta,
  readCategoryRecords,
  readRecordsAfter,
  writeCatalogChanges,
  type CatalogDb,
  type CatalogKind,
  type CatalogRecord,
} from "./core/storage/catalog-db.js";
import { getSearchIndexMeta, searchIndexMetaKey, searchKey, type SearchTokenRow } from "./core/storage/search-index-db.js";
import { channelToRecord, seriesToRecord } from "./catalog-records.js";
import { indexTokens } from "./search/normalize.js";
import { SyncStorageUnavailableError, type SyncJobOptions } from "./sync-job.js";

/**
 * The Xtream movie/series catalog sync: download the provider's list, map
 * it, and bring the local table (core/storage/catalog-db.ts) in line with
 * it. DOM-free, so it runs inside src/workers/sync-worker.ts — the download,
 * JSON parse, Kids tagging and every IndexedDB write stay off the main thread.
 *
 * A refresh only writes what changed. Each downloaded title is compared
 * with the stored row (the fields a screen shows, and the Kids tags when
 * the bundled rules are newer); only new and changed titles are written,
 * and titles the provider dropped are deleted. A daily refresh of a
 * 130k-title catalog is typically a few hundred writes instead of 130k
 * writes plus 130k deletes, and the table's generation stays the same, so
 * the search index isn't rebuilt: this sync updates the search rows of
 * new, renamed and deleted titles itself, in the same transaction.
 *
 * New and changed titles are written before anything is deleted, so a sync
 * that dies partway never loses a title that's still offered; sync_meta is
 * only updated at the end, so the next check still finds it due.
 *
 * With `categoryId`, only that category is fetched and compared (a
 * screen's "Refresh" on one category) — the rest of the table is untouched
 * and the catalog's sync time isn't moved.
 */

export interface CatalogSyncRequest {
  source: PlaylistSource;
  kind: CatalogKind;
  /** Refresh one category only. Needs a table that has been fully synced at least once. */
  categoryId?: string;
}

export interface CatalogSyncResult {
  /** Titles now stored for the source (whole catalog). */
  recordCount: number;
  /** Titles written because they were new or changed. */
  written: number;
  /** Titles removed because the provider no longer lists them. */
  deleted: number;
}

/** The provider returned no titles where there were some — kept separate so a good catalog isn't wiped by an empty response. */
export class CatalogEmptyError extends Error {
  constructor() {
    super("The provider returned an empty list.");
    this.name = "CatalogEmptyError";
  }
}

export const DEFAULT_CATALOG_BATCH_SIZE = 2000;

type CatalogItem = Channel | ReturnType<typeof mapSeriesEntry>;

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

async function fetchCatalog(request: CatalogSyncRequest, fetchImpl: typeof fetch): Promise<CatalogItem[]> {
  const { source, kind, categoryId } = request;
  if (source.kind !== "xtream") throw new Error("Only Xtream playlists have a separate catalog to sync.");
  const url = new URL(`${stripTrailingSlash(source.baseUrl)}/player_api.php`);
  url.searchParams.set("username", source.username);
  url.searchParams.set("password", source.password);
  url.searchParams.set("action", kind === "vod" ? "get_vod_streams" : "get_series");
  if (categoryId) url.searchParams.set("category_id", categoryId);
  const response = await fetchImpl(url.toString());
  if (!response.ok) throw new Error(`Xtream request failed: HTTP ${response.status}`);
  const raw = (await response.json()) as unknown;
  // A panel that rejects the login answers with an object, not a list.
  if (!Array.isArray(raw)) throw new Error("The provider didn't return a list.");
  return kind === "vod" ? (raw as XtreamVodStreamRaw[]).map((s) => mapVodStream(source, s)) : (raw as XtreamSeriesRaw[]).map(mapSeriesEntry);
}

/** What's compared to decide whether a stored row needs rewriting — everything a screen shows. The Kids tags follow from name and genre. */
function signature(record: CatalogRecord): string {
  return JSON.stringify([record.name, record.groupTitle, record.streamUrl, record.logoUrl, record.posterUrl, record.genre]);
}

interface StoredRow {
  signature: string;
  name: string;
}

const READ_CHUNK = 2000;

async function readStored(catalogDb: CatalogDb, kind: CatalogKind, sourceId: string, categoryId?: string): Promise<Map<string, StoredRow>> {
  const stored = new Map<string, StoredRow>();
  const add = (records: CatalogRecord[]) => {
    for (const record of records) stored.set(record.id, { signature: signature(record), name: record.name });
  };
  if (categoryId !== undefined) {
    add(await readCategoryRecords(catalogDb, kind, sourceId, categoryId));
    return stored;
  }
  for (let lastKey: string | null = null; ; ) {
    const records = await readRecordsAfter(catalogDb, kind, sourceId, lastKey, READ_CHUNK);
    if (records.length === 0) return stored;
    add(records);
    lastKey = records[records.length - 1].id;
  }
}

function searchRowId(kind: CatalogKind, recordId: string): string {
  return `${kind}|${recordId}`;
}

export interface WriteCatalogOptions extends Pick<SyncJobOptions, "onProgress" | "batchSize" | "yieldBetweenBatches"> {
  /** Only this category's stored rows are compared (and can be deleted). */
  categoryId?: string;
  /** An empty list is a real answer (clears the table) rather than a suspect response. */
  allowEmpty?: boolean;
}

/**
 * Brings a source's stored catalog in line with `items` (see the module
 * doc comment) and records the sync. Shared with live-sync-core.ts, which
 * writes an M3U playlist's movies the same way.
 */
export async function writeCatalog(
  catalogDb: CatalogDb,
  kind: CatalogKind,
  sourceId: string,
  items: CatalogItem[],
  options: WriteCatalogOptions = {},
): Promise<CatalogSyncResult> {
  const { categoryId, allowEmpty = false, onProgress, batchSize = DEFAULT_CATALOG_BATCH_SIZE, yieldBetweenBatches } = options;
  const key = catalogSyncMetaKey(sourceId, kind);
  const previous = await getSyncMeta(catalogDb, key);
  if (categoryId !== undefined && !previous) throw new Error("This catalog hasn't been downloaded yet.");

  const stored = await readStored(catalogDb, kind, sourceId, categoryId);
  if (items.length === 0 && stored.size > 0 && !allowEmpty) throw new CatalogEmptyError();

  const generation = previous?.generation ?? 1;
  // Tagged under older Kids rules: rewrite every row so the tag index matches the bundled rules.
  const retagAll = categoryId === undefined && (previous?.rulesVersion ?? 0) < KIDS_RULES_VERSION;
  // Keep the search index current only once it's building this generation — before that, the indexer's own pass covers everything.
  const searchMeta = await getSearchIndexMeta(catalogDb, searchIndexMetaKey(sourceId, kind));
  const maintainSearch = searchMeta !== undefined && searchMeta.generation === generation;

  const toRecord = (item: CatalogItem): CatalogRecord =>
    kind === "vod" ? channelToRecord(sourceId, generation, item as Channel) : seriesToRecord(sourceId, generation, item as ReturnType<typeof mapSeriesEntry>);

  let written = 0;
  for (let offset = 0; offset < items.length; offset += batchSize) {
    const put: CatalogRecord[] = [];
    const searchPut: SearchTokenRow[] = [];
    for (const item of items.slice(offset, offset + batchSize)) {
      const record = toRecord(item);
      const existing = stored.get(record.id);
      stored.delete(record.id); // whatever is left at the end is gone from the provider
      if (existing && !retagAll && existing.signature === signature(record)) continue;
      put.push(record);
      if (maintainSearch && existing?.name !== record.name) {
        searchPut.push({
          id: searchRowId(kind, record.id),
          sourceId,
          kind,
          recordId: record.id,
          generation,
          keys: indexTokens(record.name).map((word) => searchKey(sourceId, kind, word)),
        });
      }
    }
    await writeCatalogChanges(catalogDb, kind, { put, delete: [], searchPut });
    written += put.length;
    onProgress?.(Math.min(offset + batchSize, items.length));
    if (yieldBetweenBatches) await yieldBetweenBatches();
  }

  const gone = [...stored.keys()];
  for (let offset = 0; offset < gone.length; offset += batchSize) {
    const ids = gone.slice(offset, offset + batchSize);
    await writeCatalogChanges(catalogDb, kind, { put: [], delete: ids, searchDelete: maintainSearch ? ids.map((id) => searchRowId(kind, id)) : [] });
    if (yieldBetweenBatches) await yieldBetweenBatches();
  }

  const recordCount = categoryId === undefined ? items.length : await countRecords(catalogDb, kind, { sourceId });
  await putSyncMeta(
    catalogDb,
    categoryId === undefined || !previous
      ? { key, lastSyncedAt: Date.now(), recordCount, generation, rulesVersion: KIDS_RULES_VERSION }
      : { ...previous, recordCount },
  );
  return { recordCount, written, deleted: gone.length };
}

export async function runCatalogSync(request: CatalogSyncRequest, options: SyncJobOptions): Promise<CatalogSyncResult> {
  let catalogDb: CatalogDb;
  try {
    catalogDb = await openCatalogDb();
  } catch (err) {
    throw new SyncStorageUnavailableError(err);
  }
  const items = await fetchCatalog(request, options.fetchImpl);
  return writeCatalog(catalogDb, request.kind, request.source.id, items, { ...options, categoryId: request.categoryId });
}
