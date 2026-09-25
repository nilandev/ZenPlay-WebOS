/** Promise wrappers shared by the worker-written tables (epg-db.ts, live-db.ts). DOM-free, so they work inside Web Workers too. */

export function runRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export function completion(tx: IDBTransaction, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(`${what} failed`));
    tx.onabort = () => reject(tx.error ?? new Error(`${what} aborted`));
  });
}

/** Deletes every row an index cursor visits over `range`, inside `tx`. Completes with the transaction. */
export function deleteByIndexRange(index: IDBIndex, range: IDBKeyRange): void {
  const cursorRequest = index.openCursor(range);
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    cursor.delete();
    cursor.continue();
  };
}
