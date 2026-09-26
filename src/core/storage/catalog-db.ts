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
  /** catalogRecordId(sourceId, streamId) — unique across every source sharing this store, and the order browse pages read in (descending). */
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
  /** Series genre from the provider's list (Xtream get_series), when given — tagged like the title. */
  genre?: string;
  /** Kids tags from the title (and genre), computed at write time — see catalog-records.ts. */
  tags?: string[];
  /** 1 when the title (or genre) has a mature keyword, else 0. */
  mature?: 0 | 1;
  /** `${sourceId}|${tag}` per tag — multiEntry-indexed, so "every animation title in this playlist" is one index range. */
  tagKeys?: string[];
  /** Bumped once per completed sync (see catalog-sync.ts) — lets a sync that dies partway through be told apart from the previous complete generation, so its leftovers are swept by the next one. */
  generation: number;
}

export interface SyncMeta {
  key: string;
  lastSyncedAt: number;
  recordCount: number;
  generation: number;
  /** The Kids rules version the records were tagged with (see KIDS_RULES_VERSION) — an older one makes the sync due. */
  rulesVersion?: number;
}

/** A row filter applied while walking a cursor — a Kids profile's content policy (see content-policy.ts). */
export type CatalogRecordPredicate = (record: CatalogRecord) => boolean;

export interface CatalogDb {
  db: IDBDatabase;
}

const DB_NAME = "iptv-catalog-v1";
// v2: the multiEntry by_tag_key index (Kids tags). Rows written before it
// simply aren't in the index until the next sync re-tags them.
// v3: two addedAt indexes, from a short-lived build — dropped again by v4.
// v4: zero-padded numeric ids (see catalogRecordId), existing rows re-keyed in place.
const DB_VERSION = 4;
/** Indexes an older build created that this one no longer uses. */
const RETIRED_INDEXES = ["by_source_added", "by_source_category_added"];
const SYNC_META_STORE = "sync_meta";

const BY_SOURCE_INDEX = "by_source";
const BY_SOURCE_CATEGORY_INDEX = "by_source_category";
const BY_SOURCE_NAME_INDEX = "by_source_name";
const BY_TAG_KEY_INDEX = "by_tag_key";

/** Wide enough for any Xtream stream id, so every numeric id pads to the same length. */
const STREAM_ID_WIDTH = 15;

/**
 * A stream id as it sorts in the primary key: numeric ids zero-padded so
 * text order is numeric order ("000…100000" after "000…99999", where the
 * bare strings sort the other way round). Providers hand out ids as titles
 * are added, so descending id order is roughly newest first — the order
 * browse pages read in (see queryPage). Non-numeric ids (M3U tvg-ids) pass
 * through unchanged.
 */
export function streamIdSortKey(streamId: string): string {
  return /^\d+$/.test(streamId) ? streamId.padStart(STREAM_ID_WIDTH, "0") : streamId;
}

/** The primary key for one source's stream — the only way records should be keyed or looked up. */
export function catalogRecordId(sourceId: string, streamId: string): string {
  return `${sourceId}:${streamIdSortKey(streamId)}`;
}

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
      request.onupgradeneeded = (event) => {
        const db = request.result;
        for (const kind of ["vod", "series"] as CatalogKind[]) {
          const name = storeName(kind);
          let store: IDBObjectStore;
          if (db.objectStoreNames.contains(name)) {
            store = request.transaction!.objectStore(name);
          } else {
            store = db.createObjectStore(name, { keyPath: "id" });
            store.createIndex(BY_SOURCE_INDEX, "sourceId");
            store.createIndex(BY_SOURCE_CATEGORY_INDEX, ["sourceId", "groupTitle"]);
            store.createIndex(BY_SOURCE_NAME_INDEX, ["sourceId", "nameLower"]);
          }
          if (!store.indexNames.contains(BY_TAG_KEY_INDEX)) store.createIndex(BY_TAG_KEY_INDEX, "tagKeys", { multiEntry: true });
          for (const retired of RETIRED_INDEXES) if (store.indexNames.contains(retired)) store.deleteIndex(retired);
          if (event.oldVersion > 0 && event.oldVersion < 4) rekeyRecords(store);
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

/**
 * Moves every pre-v4 row to its padded catalogRecordId, inside the upgrade
 * transaction — so a synced catalog reads newest first (and Favorites'
 * lookups by padded id still find it) straight away, without a re-sync.
 * A re-keyed row sorts before the cursor's position ("0" < "1"–"9"), so
 * the walk never visits it twice.
 */
function rekeyRecords(store: IDBObjectStore): void {
  const cursorRequest = store.openCursor();
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    const record = cursor.value as CatalogRecord;
    const id = catalogRecordId(record.sourceId, record.streamId);
    if (id !== record.id) {
      cursor.delete();
      store.put({ ...record, id });
    }
    cursor.continue();
  };
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
 * generation get deleted. A refresh is therefore a full replace: titles the
 * provider dropped disappear, the rest are upserted. While a sync runs a
 * reader can briefly see a mix of old and new rows — never a title missing.
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

/** Every record and the sync_meta entry for one source+kind — used when a source's data is reset or the source is removed. */
export async function deleteSourceCatalog(catalogDb: CatalogDb, kind: CatalogKind, sourceId: string): Promise<void> {
  const tx = catalogDb.db.transaction([storeName(kind), SYNC_META_STORE], "readwrite");
  const cursorRequest = tx.objectStore(storeName(kind)).index(BY_SOURCE_INDEX).openCursor(IDBKeyRange.only(sourceId));
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    cursor.delete();
    cursor.continue();
  };
  tx.objectStore(SYNC_META_STORE).delete(catalogSyncMetaKey(sourceId, kind));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Catalog source purge failed"));
  });
}

export interface QueryPageOptions {
  sourceId: string;
  categoryId?: string;
  /** Case-insensitive prefix to match against the record's name — lowercased by the caller (catalog-store.ts) before this is used as an IDBKeyRange bound. */
  namePrefixLower?: string;
  /** Only rows it accepts are returned and counted — `offset` counts accepted rows, not rows walked. */
  predicate?: CatalogRecordPredicate;
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
  const { sourceId, categoryId, namePrefixLower, predicate, offset, limit } = options;
  const tx = catalogDb.db.transaction(storeName(kind), "readonly");
  const store = tx.objectStore(storeName(kind));

  // Search results read alphabetically. Category and full listings share one
  // index key per row, so they come out in primary-key order — walked
  // backwards, that's newest first (see streamIdSortKey).
  let source: IDBIndex;
  let range: IDBKeyRange;
  let direction: IDBCursorDirection = "prev";
  if (namePrefixLower !== undefined) {
    source = store.index(BY_SOURCE_NAME_INDEX);
    range = IDBKeyRange.bound([sourceId, namePrefixLower], [sourceId, namePrefixLower + MAX_UTF16_SUFFIX]);
    direction = "next";
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
    const cursorRequest = source.openCursor(range, direction);
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor || results.length >= limit) {
        resolve(results);
        return;
      }
      if (predicate && !predicate(cursor.value as CatalogRecord)) {
        cursor.continue();
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
 * Looks up records by primary key (catalogRecordId), preserving
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
  const { sourceId, categoryId, namePrefixLower, predicate } = options;
  const tx = catalogDb.db.transaction(storeName(kind), "readonly");
  const store = tx.objectStore(storeName(kind));

  if (predicate) {
    // A filtered count has to look at each row — still bounded by the same index range.
    const [source, range] =
      namePrefixLower !== undefined
        ? [store.index(BY_SOURCE_NAME_INDEX), IDBKeyRange.bound([sourceId, namePrefixLower], [sourceId, namePrefixLower + MAX_UTF16_SUFFIX])]
        : categoryId !== undefined
          ? [store.index(BY_SOURCE_CATEGORY_INDEX), IDBKeyRange.only([sourceId, categoryId])]
          : [store.index(BY_SOURCE_INDEX), IDBKeyRange.only(sourceId)];
    return countMatching(source, range, predicate);
  }

  if (namePrefixLower !== undefined) {
    const range = IDBKeyRange.bound([sourceId, namePrefixLower], [sourceId, namePrefixLower + MAX_UTF16_SUFFIX]);
    return runRequest(store.index(BY_SOURCE_NAME_INDEX).count(range));
  }
  if (categoryId !== undefined) {
    return runRequest(store.index(BY_SOURCE_CATEGORY_INDEX).count(IDBKeyRange.only([sourceId, categoryId])));
  }
  return runRequest(store.index(BY_SOURCE_INDEX).count(IDBKeyRange.only(sourceId)));
}

function countMatching(source: IDBIndex, range: IDBKeyRange, predicate: CatalogRecordPredicate): Promise<number> {
  let count = 0;
  return new Promise((resolve, reject) => {
    const cursorRequest = source.openCursor(range);
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        resolve(count);
        return;
      }
      if (predicate(cursor.value as CatalogRecord)) count++;
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error("Filtered count failed"));
  });
}

/**
 * Rows carrying any of `tags` (via the multiEntry by_tag_key index), in
 * tag order and without duplicates, that `predicate` accepts — backs the
 * Kids profile's "More for Kids" category and tag rails. Reads at most
 * `offset + limit` accepted rows.
 */
export async function queryByTags(
  catalogDb: CatalogDb,
  kind: CatalogKind,
  sourceId: string,
  tags: string[],
  predicate: CatalogRecordPredicate,
  offset: number,
  limit: number,
): Promise<CatalogRecord[]> {
  const seen = new Set<string>();
  const accepted: CatalogRecord[] = [];
  const wanted = offset + limit;
  for (const tag of tags) {
    if (accepted.length >= wanted) break;
    // One transaction per tag: awaiting between cursors would let a shared transaction auto-commit.
    const index = catalogDb.db.transaction(storeName(kind), "readonly").objectStore(storeName(kind)).index(BY_TAG_KEY_INDEX);
    await new Promise<void>((resolve, reject) => {
      const cursorRequest = index.openCursor(IDBKeyRange.only(`${sourceId}|${tag}`));
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor || accepted.length >= wanted) {
          resolve();
          return;
        }
        const record = cursor.value as CatalogRecord;
        if (!seen.has(record.id) && predicate(record)) {
          seen.add(record.id);
          accepted.push(record);
        }
        cursor.continue();
      };
      cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error("Tag query failed"));
    });
  }
  return accepted.slice(offset, wanted);
}

/**
 * The distinct category ids a source's catalog uses — walked off the
 * by_source_category index's unique keys, never the rows. M3U playlists
 * have no category API, so this is where their movie categories come from
 * (see content-loader.ts's loadVodCategories).
 */
export function getCategoryIds(catalogDb: CatalogDb, kind: CatalogKind, sourceId: string): Promise<string[]> {
  const tx = catalogDb.db.transaction(storeName(kind), "readonly");
  const index = tx.objectStore(storeName(kind)).index(BY_SOURCE_CATEGORY_INDEX);
  const range = IDBKeyRange.bound([sourceId, ""], [sourceId, MAX_UTF16_SUFFIX]);
  const ids: string[] = [];
  return new Promise((resolve, reject) => {
    const cursorRequest = index.openKeyCursor(range, "nextunique");
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        resolve(ids);
        return;
      }
      ids.push((cursor.key as [string, string])[1]);
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error("Category listing failed"));
  });
}

/** sync_meta key for one source+kind's catalog — shared by catalog-sync.ts and the worker's M3U path (live-sync-core.ts). */
export function catalogSyncMetaKey(sourceId: string, kind: CatalogKind): string {
  return `${kind}:${sourceId}`;
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
