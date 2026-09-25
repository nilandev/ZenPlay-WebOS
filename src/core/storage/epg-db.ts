/**
 * IndexedDB database holding each source's programme guide, one row per
 * programme — replaces content-cache.ts's old `guide-epg:${sourceId}` blob,
 * which held a whole parsed XMLTV file (often 100k+ programmes) as a single
 * value that had to be JSON-stringified into sessionStorage and cloned into
 * IndexedDB on the main thread on every refresh.
 *
 * Written by src/epg-sync-core.ts, normally from inside a Web Worker (see
 * src/workers/epg-sync-worker.ts), so this module must stay DOM-free —
 * IndexedDB is available in dedicated workers too. Read on the main thread
 * by src/epg-store.ts, one channel at a time.
 *
 * A separate database from catalog-db.ts's `iptv-catalog-v1` so the two
 * schemas can migrate independently.
 */

import { completion, deleteByIndexRange, runRequest } from "./idb-utils.js";

export interface EpgRecord {
  sourceId: string;
  /** XMLTV channel id — matched against Channel.epgChannelId (falling back to Channel.id). */
  channelId: string;
  /** Epoch ms — stored as numbers, not Dates, so they work as index keys and survive structured clone cheaply. */
  start: number;
  stop: number;
  title: string;
  description?: string;
  /** Unique per sync run (increasing) — see deleteStaleProgrammes. */
  generation: number;
}

export interface EpgSyncMeta {
  sourceId: string;
  lastSyncedAt: number;
  generation: number;
  programmeCount: number;
  channelCount: number;
}

export interface EpgDb {
  db: IDBDatabase;
}

const DB_NAME = "iptv-epg-v1";
const DB_VERSION = 1;
const PROGRAMMES_STORE = "programmes";
const META_STORE = "sync_meta";
const BY_SOURCE_GENERATION_INDEX = "by_source_generation";

let dbPromise: Promise<EpgDb> | undefined;

/** Opens (creating on first use) the EPG database. Cached per JS context — the worker and the main thread each hold their own connection. */
export function openEpgDb(): Promise<EpgDb> {
  if (!dbPromise) {
    dbPromise = new Promise<EpgDb>((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(PROGRAMMES_STORE)) {
          // Natural key: a re-sync overwrites the same programme in place instead of duplicating it.
          const store = db.createObjectStore(PROGRAMMES_STORE, { keyPath: ["sourceId", "channelId", "start"] });
          store.createIndex(BY_SOURCE_GENERATION_INDEX, ["sourceId", "generation"]);
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: "sourceId" });
        }
      };
      request.onsuccess = () => resolve({ db: request.result });
      request.onerror = () => reject(request.error ?? new Error("Failed to open EPG IndexedDB"));
    });
    // A failed open (e.g. storage blocked) shouldn't be cached forever.
    dbPromise.catch(() => {
      dbPromise = undefined;
    });
  }
  return dbPromise;
}

/** Writes one batch of programmes in a single transaction. */
export function putProgrammes(epgDb: EpgDb, records: EpgRecord[]): Promise<void> {
  if (records.length === 0) return Promise.resolve();
  const tx = epgDb.db.transaction(PROGRAMMES_STORE, "readwrite");
  const store = tx.objectStore(PROGRAMMES_STORE);
  for (const record of records) store.put(record);
  return completion(tx, "EPG batch write");
}

/**
 * Deletes every programme for `sourceId` written by an older generation —
 * the cleanup half of the write-then-swap sync (see epg-sync-core.ts). Rows
 * the new sync rewrote already carry the new generation (same key, put
 * overwrites), so this only removes programmes that dropped out of the feed
 * or out of the retention window. Walks only the stale range of the
 * by_source_generation index, never the whole table.
 */
export function deleteStaleProgrammes(epgDb: EpgDb, sourceId: string, currentGeneration: number): Promise<void> {
  const tx = epgDb.db.transaction(PROGRAMMES_STORE, "readwrite");
  const index = tx.objectStore(PROGRAMMES_STORE).index(BY_SOURCE_GENERATION_INDEX);
  deleteByIndexRange(index, IDBKeyRange.bound([sourceId, -Infinity], [sourceId, currentGeneration], false, true));
  return completion(tx, "EPG stale-generation cleanup");
}

/** Every programme stored for a source (all generations) — used when a source is cleared or removed. */
export function deleteSourceProgrammes(epgDb: EpgDb, sourceId: string): Promise<void> {
  const tx = epgDb.db.transaction([PROGRAMMES_STORE, META_STORE], "readwrite");
  const index = tx.objectStore(PROGRAMMES_STORE).index(BY_SOURCE_GENERATION_INDEX);
  deleteByIndexRange(index, IDBKeyRange.bound([sourceId, -Infinity], [sourceId, Infinity]));
  tx.objectStore(META_STORE).delete(sourceId);
  return completion(tx, "EPG source purge");
}

/** One channel's programmes, sorted by start (the primary key order). */
export function getChannelProgrammes(epgDb: EpgDb, sourceId: string, channelId: string): Promise<EpgRecord[]> {
  const tx = epgDb.db.transaction(PROGRAMMES_STORE, "readonly");
  const range = IDBKeyRange.bound([sourceId, channelId, -Infinity], [sourceId, channelId, Infinity]);
  return runRequest(tx.objectStore(PROGRAMMES_STORE).getAll(range) as IDBRequest<EpgRecord[]>);
}

export function getEpgSyncMeta(epgDb: EpgDb, sourceId: string): Promise<EpgSyncMeta | undefined> {
  const tx = epgDb.db.transaction(META_STORE, "readonly");
  return runRequest(tx.objectStore(META_STORE).get(sourceId) as IDBRequest<EpgSyncMeta | undefined>);
}

export function putEpgSyncMeta(epgDb: EpgDb, meta: EpgSyncMeta): Promise<void> {
  const tx = epgDb.db.transaction(META_STORE, "readwrite");
  tx.objectStore(META_STORE).put(meta);
  return completion(tx, "EPG sync meta write");
}

/** Test-only: forces the next openEpgDb() to open a fresh connection. */
export function __resetEpgDbForTests(): void {
  dbPromise = undefined;
}

/** Test-only: wipes both stores so one test's writes never leak into the next. */
export async function __clearEpgDbForTests(): Promise<void> {
  const epgDb = await openEpgDb();
  const tx = epgDb.db.transaction([PROGRAMMES_STORE, META_STORE], "readwrite");
  tx.objectStore(PROGRAMMES_STORE).clear();
  tx.objectStore(META_STORE).clear();
  await completion(tx, "EPG clear");
}
