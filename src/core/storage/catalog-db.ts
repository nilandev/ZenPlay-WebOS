/**
 * IndexedDB database backing the local VOD/series catalog — see
 * src/catalog-sync.ts's doc comment for why this exists (avoiding a
 * full-catalog fetch on every Movies/Series visit) and src/catalog-store.ts
 * for the read side built on top of this.
 *
 * Deliberately a separate database (`iptv-catalog-v1`) from content-cache.ts's
 * `iptv-cache-v1` kv store — that one holds whole-blob cache entries under a
 * single "kv" object store; this one holds individual VOD/series records
 * with real indexes (by source, by category, by name prefix), which is a
 * different enough access pattern (paginated cursor reads, not "fetch one
 * key") to be its own schema rather than shoehorned into the kv shape.
 *
 * Same "no deps" philosophy as indexeddb-store.ts: hand-rolled promise
 * wrappers rather than idb/dexie, and every operation is expected to
 * degrade/reject cleanly so callers (catalog-sync.ts/catalog-store.ts) can
 * treat "IndexedDB unavailable" as a plain error rather than a crash.
 */

export type CatalogKind = "vod" | "series";

/** One VOD or series record as stored — a flattened, IndexedDB-friendly shape rather than the richer Channel/SeriesInfo types screens render, which catalog-store.ts maps to/from. */
export interface CatalogRecord {
  /** `${sourceId}:${streamId}` — unique across every source sharing this store. */
  id: string;
  sourceId: string;
  streamId: string;
  name: string;
  /** Lowercased `name`, precomputed at write time so the by_source_name index can do a case-insensitive prefix range without a per-query transform. */
  nameLower: string;
  /** Xtream's category_id — kept under the field name screens already know from Channel.groupTitle/SeriesInfo.groupTitle. */
  groupTitle?: string;
  streamUrl?: string;
  logoUrl?: string;
  posterUrl?: string;
  /** Bumped once per completed sync (see catalog-sync.ts) — lets a sync that dies partway through be told apart from the previous complete generation, so readers never see a half-populated table. */
  generation: number;
}

export interface SyncMeta {
  key: string;
  lastSyncedAt: number;
  recordCount: number;
  generation: number;
}

export interface CatalogDb {
  db: IDBDatabase;
}

const DB_NAME = "iptv-catalog-v1";
const DB_VERSION = 1;
const SYNC_META_STORE = "sync_meta";

const BY_SOURCE_INDEX = "by_source";
const BY_SOURCE_CATEGORY_INDEX = "by_source_category";
const BY_SOURCE_NAME_INDEX = "by_source_name";

/** Upper bound for a same-prefix IDBKeyRange scan — the highest code point IndexedDB's default key comparator will ever sort a real string below. */
const MAX_UTF16_SUFFIX = "￿";

function storeName(kind: CatalogKind): string {
  return kind;
}

let dbPromise: Promise<CatalogDb> | undefined;

/** Opens (creating on first use) the catalog database. Cached at module scope, same pattern as indexeddb-store.ts's openIdbStore. */
export function openCatalogDb(): Promise<CatalogDb> {
  if (!dbPromise) {
    dbPromise = new Promise<CatalogDb>((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const kind of ["vod", "series"] as CatalogKind[]) {
          const name = storeName(kind);
          if (db.objectStoreNames.contains(name)) continue;
          const store = db.createObjectStore(name, { keyPath: "id" });
          store.createIndex(BY_SOURCE_INDEX, "sourceId");
          store.createIndex(BY_SOURCE_CATEGORY_INDEX, ["sourceId", "groupTitle"]);
          store.createIndex(BY_SOURCE_NAME_INDEX, ["sourceId", "nameLower"]);
        }
        if (!db.objectStoreNames.contains(SYNC_META_STORE)) {
          db.createObjectStore(SYNC_META_STORE, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve({ db: request.result });
      request.onerror = () => reject(request.error ?? new Error("Failed to open catalog IndexedDB"));
    });
  }
  return dbPromise;
}

function runRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

/** Writes a batch of records in one readwrite transaction — the "batched DB transactions" piece: a sync's ~2000-record chunks each cost one transaction, not one per record. */
export function putRecordsBatch(catalogDb: CatalogDb, kind: CatalogKind, records: CatalogRecord[]): Promise<void> {
  if (records.length === 0) return Promise.resolve();
  const tx = catalogDb.db.transaction(storeName(kind), "readwrite");
  const store = tx.objectStore(storeName(kind));
  for (const record of records) store.put(record);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Batch write failed"));
  });
}

/**
 * Deletes every record for `sourceId` whose generation is older than
 * `currentGeneration` — the cleanup half of the shadow-write-then-swap sync
 * strategy (see catalog-sync.ts): the new generation's records are written
 * first, sync_meta is flipped to point at it, and only then does the old
 * generation get deleted, so a reader never sees a half-populated table.
 */
export async function deleteStaleGeneration(catalogDb: CatalogDb, kind: CatalogKind, sourceId: string, currentGeneration: number): Promise<void> {
  const tx = catalogDb.db.transaction(storeName(kind), "readwrite");
  const index = tx.objectStore(storeName(kind)).index(BY_SOURCE_INDEX);
  const range = IDBKeyRange.only(sourceId);
  await new Promise<void>((resolve, reject) => {
    const cursorRequest = index.openCursor(range);
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        resolve();
        return;
      }
      const record = cursor.value as CatalogRecord;
      if (record.generation < currentGeneration) cursor.delete();
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error("Stale-generation cleanup failed"));
  });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Stale-generation cleanup transaction failed"));
  });
}

export interface QueryPageOptions {
  sourceId: string;
  categoryId?: string;
  /** Case-insensitive prefix to match against the record's name — lowercased by the caller (catalog-store.ts) before this is used as an IDBKeyRange bound. */
  namePrefixLower?: string;
  offset: number;
  limit: number;
}

/**
 * Cursor-based paginated read: seeks to the right IndexedDB index for the
 * given filter (category, name-prefix search, or plain source-scoped
 * listing), skips `offset` records, then collects up to `limit` — never
 * loads the full table into memory, which is the whole point of moving
 * screens off a single big in-memory array.
 */
export function queryPage(catalogDb: CatalogDb, kind: CatalogKind, options: QueryPageOptions): Promise<CatalogRecord[]> {
  const { sourceId, categoryId, namePrefixLower, offset, limit } = options;
  const tx = catalogDb.db.transaction(storeName(kind), "readonly");
  const store = tx.objectStore(storeName(kind));

  let source: IDBIndex;
  let range: IDBKeyRange;
  if (namePrefixLower !== undefined) {
    source = store.index(BY_SOURCE_NAME_INDEX);
    range = IDBKeyRange.bound([sourceId, namePrefixLower], [sourceId, namePrefixLower + MAX_UTF16_SUFFIX]);
  } else if (categoryId !== undefined) {
    source = store.index(BY_SOURCE_CATEGORY_INDEX);
    range = IDBKeyRange.only([sourceId, categoryId]);
  } else {
    source = store.index(BY_SOURCE_INDEX);
    range = IDBKeyRange.only(sourceId);
  }

  const results: CatalogRecord[] = [];
  let skipped = 0;
  return new Promise((resolve, reject) => {
    const cursorRequest = source.openCursor(range);
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor || results.length >= limit) {
        resolve(results);
        return;
      }
      if (skipped < offset) {
        skipped++;
        cursor.continue();
        return;
      }
      results.push(cursor.value as CatalogRecord);
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error("Paginated query failed"));
  });
}

/**
 * Looks up records by primary key (`${sourceId}:${streamId}`), preserving
 * `ids`' order and silently dropping any id with no matching record (the
 * stream was removed from the provider since it was favourited/watched) —
 * callers (catalog-store.ts's getRecordsByIds) never see a hole in the
 * array. Used to resolve Continue Watching/Favorites entries, which only
 * store bare ids, back into full displayable records without loading a
 * source's whole catalog.
 */
export async function getRecordsByIds(catalogDb: CatalogDb, kind: CatalogKind, ids: string[]): Promise<CatalogRecord[]> {
  if (ids.length === 0) return [];
  const tx = catalogDb.db.transaction(storeName(kind), "readonly");
  const store = tx.objectStore(storeName(kind));
  const results = await Promise.all(ids.map((id) => runRequest(store.get(id))));
  return results.filter((r): r is CatalogRecord => r !== undefined);
}

/** Total matching record count for the same filter shape queryPage uses, via IDBObjectStore/IDBIndex.count() rather than reading every row — backs "N results" affordances and hasMore checks. */
export function countRecords(catalogDb: CatalogDb, kind: CatalogKind, options: Omit<QueryPageOptions, "offset" | "limit">): Promise<number> {
  const { sourceId, categoryId, namePrefixLower } = options;
  const tx = catalogDb.db.transaction(storeName(kind), "readonly");
  const store = tx.objectStore(storeName(kind));

  if (namePrefixLower !== undefined) {
    const range = IDBKeyRange.bound([sourceId, namePrefixLower], [sourceId, namePrefixLower + MAX_UTF16_SUFFIX]);
    return runRequest(store.index(BY_SOURCE_NAME_INDEX).count(range));
  }
  if (categoryId !== undefined) {
    return runRequest(store.index(BY_SOURCE_CATEGORY_INDEX).count(IDBKeyRange.only([sourceId, categoryId])));
  }
  return runRequest(store.index(BY_SOURCE_INDEX).count(IDBKeyRange.only(sourceId)));
}

export function getSyncMeta(catalogDb: CatalogDb, key: string): Promise<SyncMeta | undefined> {
  const tx = catalogDb.db.transaction(SYNC_META_STORE, "readonly");
  return runRequest(tx.objectStore(SYNC_META_STORE).get(key));
}

export function putSyncMeta(catalogDb: CatalogDb, meta: SyncMeta): Promise<void> {
  const tx = catalogDb.db.transaction(SYNC_META_STORE, "readwrite");
  return runRequest(tx.objectStore(SYNC_META_STORE).put(meta)).then(() => undefined);
}

/** Test-only escape hatch: forces the next openCatalogDb() call to re-open a fresh connection — mirrors indexeddb-store.ts's __resetIdbStoreForTests. */
export function __resetCatalogDbForTests(): void {
  dbPromise = undefined;
}

/** Test-only escape hatch: wipes every store (vod/series/sync_meta) so one test file's writes never leak into the next — fake-indexeddb persists the "database" across openCatalogDb() calls within a test file, only __resetCatalogDbForTests's connection-cache reset doesn't clear its contents. */
export async function __clearCatalogDbForTests(): Promise<void> {
  const catalogDb = await openCatalogDb();
  const storeNames = ["vod", "series", SYNC_META_STORE];
  await Promise.all(
    storeNames.map(
      (name) =>
        new Promise<void>((resolve, reject) => {
          const tx = catalogDb.db.transaction(name, "readwrite");
          const request = tx.objectStore(name).clear();
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error ?? new Error("Clear failed"));
        }),
    ),
  );
}
