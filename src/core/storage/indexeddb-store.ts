/**
 * Thin promise-wrapped IndexedDB key-value store backing content-cache.ts's
 * persistent tier. Dependency-free (no idb/dexie) — the API surface needed
 * here (get/set/delete/delete-matching/clear over one object store) is
 * small enough that a wrapper library would add a dependency for less code
 * than hand-rolling it, matching XtreamClient's own "fetch only, no deps"
 * philosophy (see xtream-client.ts's doc comment).
 *
 * Every export here can reject (unsupported/disabled IndexedDB, quota,
 * private-mode restrictions) — callers (content-cache.ts) are expected to
 * catch and degrade to "IndexedDB tier unavailable," never to let a storage
 * failure surface as an app-level error.
 */

const DB_NAME = "iptv-cache-v1";
const DB_VERSION = 1;
const STORE_NAME = "kv";

export interface IdbStore {
  db: IDBDatabase;
}

let dbPromise: Promise<IdbStore> | undefined;

/** Opens (creating on first use) the single database this app uses for persistent cache. Cached at module scope — repeated calls reuse the same open connection rather than re-opening per operation. */
export function openIdbStore(): Promise<IdbStore> {
  if (!dbPromise) {
    dbPromise = new Promise<IdbStore>((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve({ db: request.result });
      request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
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

export function putEntry<T>(store: IdbStore, key: string, entry: T): Promise<void> {
  const tx = store.db.transaction(STORE_NAME, "readwrite");
  return runRequest(tx.objectStore(STORE_NAME).put(entry, key)).then(() => undefined);
}

export function deleteKey(store: IdbStore, key: string): Promise<void> {
  const tx = store.db.transaction(STORE_NAME, "readwrite");
  return runRequest(tx.objectStore(STORE_NAME).delete(key)).then(() => undefined);
}

/**
 * Deletes every key `matches` accepts, reading keys only (never values) —
 * so sweeping for a source's entries or for leftover legacy blobs never
 * deserializes a multi-MB value just to throw it away.
 */
export async function deleteKeysMatching(store: IdbStore, matches: (key: string) => boolean): Promise<void> {
  const tx = store.db.transaction(STORE_NAME, "readwrite");
  const objectStore = tx.objectStore(STORE_NAME);
  const keys = await runRequest(objectStore.getAllKeys());
  await Promise.all(
    keys.filter((key): key is string => typeof key === "string" && matches(key)).map((key) => runRequest(objectStore.delete(key))),
  );
}

export function clearStore(store: IdbStore): Promise<void> {
  const tx = store.db.transaction(STORE_NAME, "readwrite");
  return runRequest(tx.objectStore(STORE_NAME).clear()).then(() => undefined);
}

/** One entry, or undefined when the key isn't stored — content-cache.ts reads lazily, one key at a time, on a memory miss. */
export function getEntry<T>(store: IdbStore, key: string): Promise<T | undefined> {
  const tx = store.db.transaction(STORE_NAME, "readonly");
  return runRequest(tx.objectStore(STORE_NAME).get(key) as IDBRequest<T | undefined>);
}

/** Every stored key (no values) — for tests and key-only sweeps. */
export function getAllKeys(store: IdbStore): Promise<string[]> {
  const tx = store.db.transaction(STORE_NAME, "readonly");
  return runRequest(tx.objectStore(STORE_NAME).getAllKeys()).then((keys) => keys.map(String));
}

/** Test-only escape hatch: forces the next openIdbStore() call to re-open a fresh connection instead of reusing one from a previous test — matches xtream-client.ts's __resetRequestDedupeCacheForTests pattern for module-level state. */
export function __resetIdbStoreForTests(): void {
  dbPromise = undefined;
}
