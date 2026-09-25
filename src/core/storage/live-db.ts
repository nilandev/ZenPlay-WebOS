/**
 * IndexedDB database holding each source's live channel list, one row per
 * channel in the provider's order — replaces content-cache.ts's
 * `live:${sourceId}` / `guide-channels:${sourceId}` blobs (the same list,
 * fetched and cached twice, JSON-stringified into sessionStorage on the
 * main thread each time).
 *
 * Written by src/live-sync-core.ts, normally inside the sync worker, so
 * this module stays DOM-free. Read on the main thread by src/live-store.ts.
 */

import type { Channel } from "../models/channel.js";
import { completion, deleteByIndexRange, runRequest } from "./idb-utils.js";

/** A live channel as stored: the Channel itself plus its place in the source's list. */
export interface LiveChannelRecord extends Channel {
  sourceId: string;
  /**
   * Index in the provider's list. Part of the key rather than the channel
   * id, because M3U playlists routinely repeat a tvg-id (the same channel in
   * HD and SD) and both entries must survive, in order.
   */
  position: number;
  /** Unique per sync run (increasing) — see deleteStaleChannels. */
  generation: number;
}

export interface LiveSyncMeta {
  sourceId: string;
  lastSyncedAt: number;
  generation: number;
  channelCount: number;
}

export interface LiveDb {
  db: IDBDatabase;
}

const DB_NAME = "iptv-live-v1";
const DB_VERSION = 1;
const CHANNELS_STORE = "channels";
const META_STORE = "sync_meta";
const BY_SOURCE_GENERATION_INDEX = "by_source_generation";

let dbPromise: Promise<LiveDb> | undefined;

/** Opens (creating on first use) the live channel database. Cached per JS context. */
export function openLiveDb(): Promise<LiveDb> {
  if (!dbPromise) {
    dbPromise = new Promise<LiveDb>((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(CHANNELS_STORE)) {
          const store = db.createObjectStore(CHANNELS_STORE, { keyPath: ["sourceId", "position"] });
          store.createIndex(BY_SOURCE_GENERATION_INDEX, ["sourceId", "generation"]);
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: "sourceId" });
        }
      };
      request.onsuccess = () => resolve({ db: request.result });
      request.onerror = () => reject(request.error ?? new Error("Failed to open live channel IndexedDB"));
    });
    dbPromise.catch(() => {
      dbPromise = undefined;
    });
  }
  return dbPromise;
}

/** Writes one batch of channels in a single transaction. */
export function putChannels(liveDb: LiveDb, records: LiveChannelRecord[]): Promise<void> {
  if (records.length === 0) return Promise.resolve();
  const tx = liveDb.db.transaction(CHANNELS_STORE, "readwrite");
  const store = tx.objectStore(CHANNELS_STORE);
  for (const record of records) store.put(record);
  return completion(tx, "Live channel batch write");
}

/**
 * Deletes a source's rows from older generations — after a re-sync these
 * are exactly the positions past the end of the new, shorter list (every
 * other position was overwritten in place under the new generation).
 */
export function deleteStaleChannels(liveDb: LiveDb, sourceId: string, currentGeneration: number): Promise<void> {
  const tx = liveDb.db.transaction(CHANNELS_STORE, "readwrite");
  const index = tx.objectStore(CHANNELS_STORE).index(BY_SOURCE_GENERATION_INDEX);
  deleteByIndexRange(index, IDBKeyRange.bound([sourceId, -Infinity], [sourceId, currentGeneration], false, true));
  return completion(tx, "Live channel stale-generation cleanup");
}

/** Every channel and the sync record for a source — used when its data is cleared. */
export function deleteSourceChannels(liveDb: LiveDb, sourceId: string): Promise<void> {
  const tx = liveDb.db.transaction([CHANNELS_STORE, META_STORE], "readwrite");
  tx.objectStore(CHANNELS_STORE).delete(IDBKeyRange.bound([sourceId, -Infinity], [sourceId, Infinity]));
  tx.objectStore(META_STORE).delete(sourceId);
  return completion(tx, "Live channel source purge");
}

/** A source's whole channel list in provider order (the primary key order). */
export function getSourceChannels(liveDb: LiveDb, sourceId: string): Promise<LiveChannelRecord[]> {
  const tx = liveDb.db.transaction(CHANNELS_STORE, "readonly");
  const range = IDBKeyRange.bound([sourceId, -Infinity], [sourceId, Infinity]);
  return runRequest(tx.objectStore(CHANNELS_STORE).getAll(range) as IDBRequest<LiveChannelRecord[]>);
}

export function getLiveSyncMeta(liveDb: LiveDb, sourceId: string): Promise<LiveSyncMeta | undefined> {
  const tx = liveDb.db.transaction(META_STORE, "readonly");
  return runRequest(tx.objectStore(META_STORE).get(sourceId) as IDBRequest<LiveSyncMeta | undefined>);
}

export function putLiveSyncMeta(liveDb: LiveDb, meta: LiveSyncMeta): Promise<void> {
  const tx = liveDb.db.transaction(META_STORE, "readwrite");
  tx.objectStore(META_STORE).put(meta);
  return completion(tx, "Live channel sync meta write");
}

/** Test-only: forces the next openLiveDb() to open a fresh connection. */
export function __resetLiveDbForTests(): void {
  dbPromise = undefined;
}

/** Test-only: wipes both stores. */
export async function __clearLiveDbForTests(): Promise<void> {
  const liveDb = await openLiveDb();
  const tx = liveDb.db.transaction([CHANNELS_STORE, META_STORE], "readwrite");
  tx.objectStore(CHANNELS_STORE).clear();
  tx.objectStore(META_STORE).clear();
  await completion(tx, "Live channel clear");
}
