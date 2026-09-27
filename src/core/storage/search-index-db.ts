import {
  MAX_UTF16_SUFFIX,
  SEARCH_BY_KEY_INDEX,
  SEARCH_BY_SOURCE_KIND_GENERATION_INDEX,
  SEARCH_INDEX_META_STORE,
  SEARCH_TOKENS_STORE,
  type CatalogDb,
  type CatalogKind,
  type CatalogRecord,
} from "./catalog-db.js";

/**
 * Storage for the search index (docs/global-search-plan.md, phase 2): its
 * own two stores in the catalog database, so the background indexer's
 * writes never make a Movies/Series read or a sync's write wait — IndexedDB
 * only queues transactions behind each other when their stores overlap.
 * Every function here is one short transaction.
 */

/** What's indexed: the two catalogs, and live channels (from live-db.ts). */
export type SearchKind = CatalogKind | "live";

/** One indexed title or channel. */
export interface SearchTokenRow {
  /** `${kind}|${catalog record id}`, or `live|${sourceId}:${list position}` — overwritten in place when re-indexed. */
  id: string;
  sourceId: string;
  kind: SearchKind;
  /** The catalog record's id (catalogRecordId), or a live channel's own id. */
  recordId: string;
  /** The catalog generation this row was built from — older ones are swept after a full pass. */
  generation: number;
  /** searchKey() per search word. */
  keys: string[];
}

export type SearchIndexPhase = "index" | "sweep" | "done";

/** Where the indexer got to for one source and kind. */
export interface SearchIndexMeta {
  key: string;
  /** The catalog (or live list) generation being, or last, indexed. */
  generation: number;
  /** The last catalog record id (or live list position) indexed, or null to start from the beginning. */
  lastKey: string | number | null;
  phase: SearchIndexPhase;
}

export function searchIndexMetaKey(sourceId: string, kind: SearchKind): string {
  return `${sourceId}|${kind}`;
}

/** The index key a word is stored under. The source and kind are part of it, since a multiEntry index can't be compound. */
export function searchKey(sourceId: string, kind: SearchKind, word: string): string {
  return `${sourceId}\u0000${kind}\u0000${word}`;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function completion(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export async function getSearchIndexMeta(catalogDb: CatalogDb, key: string): Promise<SearchIndexMeta | undefined> {
  const tx = catalogDb.db.transaction(SEARCH_INDEX_META_STORE, "readonly");
  return (await request(tx.objectStore(SEARCH_INDEX_META_STORE).get(key))) as SearchIndexMeta | undefined;
}

export async function putSearchIndexMeta(catalogDb: CatalogDb, meta: SearchIndexMeta): Promise<void> {
  const tx = catalogDb.db.transaction(SEARCH_INDEX_META_STORE, "readwrite");
  tx.objectStore(SEARCH_INDEX_META_STORE).put(meta);
  await completion(tx);
}

/** Up to `limit` of a source's catalog records after `lastKey`, in key order — one short readonly read of the catalog store. */
export async function readCatalogRecordsAfter(catalogDb: CatalogDb, kind: CatalogKind, sourceId: string, lastKey: string | null, limit: number): Promise<CatalogRecord[]> {
  const prefix = `${sourceId}:`;
  const range = lastKey === null ? IDBKeyRange.bound(prefix, prefix + MAX_UTF16_SUFFIX) : IDBKeyRange.bound(lastKey, prefix + MAX_UTF16_SUFFIX, true, false);
  const tx = catalogDb.db.transaction(kind, "readonly");
  const records = (await request(tx.objectStore(kind).getAll(range, limit))) as CatalogRecord[];
  return records.filter((record) => record.sourceId === sourceId);
}

/** Writes a batch of rows and the indexer's new position together, so progress never runs ahead of what's stored. */
export async function writeSearchRows(catalogDb: CatalogDb, rows: SearchTokenRow[], meta: SearchIndexMeta): Promise<void> {
  const tx = catalogDb.db.transaction([SEARCH_TOKENS_STORE, SEARCH_INDEX_META_STORE], "readwrite");
  const store = tx.objectStore(SEARCH_TOKENS_STORE);
  for (const row of rows) store.put(row);
  tx.objectStore(SEARCH_INDEX_META_STORE).put(meta);
  await completion(tx);
}

/**
 * Deletes up to `limit` rows for a source and kind built from a generation
 * older than `generation` (titles the provider dropped), and saves `meta`
 * in the same transaction. Returns how many were deleted.
 */
export async function sweepStaleSearchRows(catalogDb: CatalogDb, sourceId: string, kind: SearchKind, generation: number, limit: number, meta: SearchIndexMeta): Promise<number> {
  const tx = catalogDb.db.transaction([SEARCH_TOKENS_STORE, SEARCH_INDEX_META_STORE], "readwrite");
  const index = tx.objectStore(SEARCH_TOKENS_STORE).index(SEARCH_BY_SOURCE_KIND_GENERATION_INDEX);
  const range = IDBKeyRange.bound([sourceId, kind, -Infinity], [sourceId, kind, generation], false, true);
  let deleted = 0;
  await new Promise<void>((resolve, reject) => {
    const cursorRequest = index.openCursor(range);
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor || deleted >= limit) {
        resolve();
        return;
      }
      cursor.delete();
      deleted++;
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error("Search index sweep failed"));
  });
  tx.objectStore(SEARCH_INDEX_META_STORE).put(meta);
  await completion(tx);
  return deleted;
}

/** Record ids (catalog record ids, or live channel ids) indexed under a word starting with `word`, at most `limit` (not de-duplicated). */
export async function findSearchCandidates(catalogDb: CatalogDb, sourceId: string, kind: SearchKind, word: string, limit: number): Promise<string[]> {
  const from = searchKey(sourceId, kind, word);
  const tx = catalogDb.db.transaction(SEARCH_TOKENS_STORE, "readonly");
  const rows = (await request(tx.objectStore(SEARCH_TOKENS_STORE).index(SEARCH_BY_KEY_INDEX).getAll(IDBKeyRange.bound(from, from + MAX_UTF16_SUFFIX), limit))) as SearchTokenRow[];
  return rows.map((row) => row.recordId);
}

/** Every search row and progress record for a source — when the source is removed. */
export async function deleteSearchIndexForSource(catalogDb: CatalogDb, sourceId: string): Promise<void> {
  const tx = catalogDb.db.transaction([SEARCH_TOKENS_STORE, SEARCH_INDEX_META_STORE], "readwrite");
  const index = tx.objectStore(SEARCH_TOKENS_STORE).index(SEARCH_BY_SOURCE_KIND_GENERATION_INDEX);
  // Compound keys sort element by element, and an array sorts after any string — so this covers every kind and generation.
  const range = IDBKeyRange.bound([sourceId], [sourceId, []]);
  await new Promise<void>((resolve, reject) => {
    const cursorRequest = index.openCursor(range);
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error("Search index purge failed"));
  });
  const meta = tx.objectStore(SEARCH_INDEX_META_STORE);
  for (const kind of ["vod", "series", "live"] as SearchKind[]) meta.delete(searchIndexMetaKey(sourceId, kind));
  await completion(tx);
}
