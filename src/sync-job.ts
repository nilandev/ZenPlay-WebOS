/** Pieces shared by every sync job that runs in src/workers/sync-worker.ts (epg-sync-core.ts, live-sync-core.ts). DOM-free. */

export interface SyncJobOptions {
  fetchImpl: typeof fetch;
  /** Called after each batch lands, with the running total written. */
  onProgress?: (written: number) => void;
  batchSize?: number;
  /** Awaited between batches — the main-thread fallback passes a macrotask yield so remote input gets handled mid-sync. */
  yieldBetweenBatches?: () => Promise<void>;
}

/** IndexedDB can't be opened in this context — the caller should rerun the job somewhere that can (see workers/sync-worker-client.ts's main-thread fallback). */
export class SyncStorageUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(`Local storage unavailable${cause instanceof Error ? `: ${cause.message}` : ""}`);
    this.name = "SyncStorageUnavailableError";
  }
}
