import type { CatalogWorkerAction, CatalogWorkerCredentials, CatalogWorkerRequest, CatalogWorkerResponse } from "./catalog-fetch-worker.js";

export interface CatalogWorkerClient {
  fetchCatalog(request: { credentials: CatalogWorkerCredentials; action: CatalogWorkerAction; categoryId?: string }): Promise<unknown[]>;
  /**
   * Streaming counterpart to fetchCatalog for a full-catalog background sync
   * (see catalog-sync.ts): `onBatch` fires once per ~2000-record chunk as
   * the worker posts `progress` messages, and the returned promise resolves
   * with the total record count once the worker posts `done` — see
   * catalog-fetch-worker.ts's doc comment for why this exists instead of
   * always resolving one big array. Deliberately not deduped like
   * fetchCatalog — a sync is already guarded against overlap by
   * catalog-sync.ts's own in-flight tracking, keyed by source+kind rather
   * than the exact request shape.
   */
  syncCatalog(
    request: { credentials: CatalogWorkerCredentials; action: CatalogWorkerAction; categoryId?: string },
    onBatch: (batch: unknown[]) => void,
  ): Promise<{ total: number }>;
  terminate(): void;
}

let requestCounter = 0;

/**
 * Collapses bursts of near-simultaneous, identical fetchCatalog calls into
 * one in-flight worker request — mirrors XtreamClient's own requestCache
 * (see xtream-client.ts's doc comment for the full rationale: React 18
 * StrictMode double-invokes effects in dev, so every useCachedContent load
 * fires twice on mount; XtreamClient's requestCache already absorbs that
 * for every direct Xtream call, but this worker path had no equivalent,
 * which meant VOD/series catalogs — the two things actually big enough for
 * a doubled fetch+parse to be felt as a real freeze — were the one place
 * StrictMode's double-invoke wasn't being absorbed). Same short window as
 * XtreamClient: long enough to catch genuinely concurrent calls, short
 * enough that a real revisit later still gets a fresh fetch.
 */
const REQUEST_DEDUPE_MS = 3000;

/** Matches catalog-fetch-worker.ts's own DEFAULT_STREAM_BATCH_SIZE — passed explicitly rather than relying on the worker's default so this client's chunking behavior doesn't silently drift from what it thinks it asked for. */
const DEFAULT_SYNC_BATCH_SIZE = 2000;

function catalogRequestKey(request: { credentials: CatalogWorkerCredentials; action: CatalogWorkerAction; categoryId?: string }): string {
  return `${request.credentials.baseUrl}:${request.credentials.username}:${request.action}:${request.categoryId ?? ""}`;
}

/**
 * Main-thread wrapper around catalog-fetch-worker.ts's postMessage protocol,
 * turning it into a plain Promise-based API — content-loader.ts's VOD/series
 * loaders call this instead of constructing an XtreamClient directly (see
 * its doc comment), so the actual fetch+parse+reshape work happens off the
 * main thread.
 *
 * One Worker instance is created lazily and reused across calls (spinning
 * up a fresh Worker per request would add avoidable startup latency); each
 * in-flight request is tracked by a locally-generated id so multiple
 * concurrent fetchCatalog calls against the same worker resolve to the
 * right caller.
 */
export function createCatalogWorkerClient(): CatalogWorkerClient {
  let worker: Worker | undefined;
  const pending = new Map<string, { resolve: (data: unknown[]) => void; reject: (err: Error) => void }>();
  const streaming = new Map<string, { onBatch: (batch: unknown[]) => void; resolve: (result: { total: number }) => void; reject: (err: Error) => void }>();
  const requestCache = new Map<string, { promise: Promise<unknown[]>; cachedAt: number }>();

  function rejectAllPending(error: Error): void {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
    for (const entry of streaming.values()) entry.reject(error);
    streaming.clear();
  }

  function ensureWorker(): Worker {
    if (worker) return worker;
    worker = new Worker(new URL("./catalog-fetch-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<CatalogWorkerResponse>) => {
      const response = event.data;

      const streamEntry = streaming.get(response.id);
      if (streamEntry) {
        if ("type" in response && response.type === "progress") {
          streamEntry.onBatch(response.batch);
          return;
        }
        if ("type" in response && response.type === "done") {
          streaming.delete(response.id);
          streamEntry.resolve({ total: response.total });
          return;
        }
        if ("ok" in response && !response.ok) {
          streaming.delete(response.id);
          streamEntry.reject(new Error(response.error));
          return;
        }
        return;
      }

      const entry = pending.get(response.id);
      if (!entry) return; // Stale/unknown response (e.g. after terminate()) — nothing to resolve.
      pending.delete(response.id);
      if ("ok" in response && response.ok) entry.resolve(response.data);
      else if ("ok" in response) entry.reject(new Error(response.error));
    };
    worker.onerror = (event) => {
      // A worker-level error (e.g. a syntax error in the module) can't be
      // attributed to one specific pending request — reject everything
      // still outstanding rather than leaving callers hanging forever.
      rejectAllPending(new Error(event.message || "Catalog worker error"));
    };
    return worker;
  }

  function performFetchCatalog(request: { credentials: CatalogWorkerCredentials; action: CatalogWorkerAction; categoryId?: string }): Promise<unknown[]> {
    return new Promise<unknown[]>((resolve, reject) => {
      const id = `catalog-${++requestCounter}`;
      pending.set(id, { resolve, reject });
      const message: CatalogWorkerRequest = { id, ...request };
      ensureWorker().postMessage(message);
    });
  }

  return {
    fetchCatalog(request) {
      const key = catalogRequestKey(request);
      const cached = requestCache.get(key);
      if (cached && Date.now() - cached.cachedAt < REQUEST_DEDUPE_MS) {
        return cached.promise;
      }

      const promise = performFetchCatalog(request);
      requestCache.set(key, { promise, cachedAt: Date.now() });
      // A rejected fetch shouldn't keep poisoning the dedupe window — see
      // XtreamClient.fetchJson's identical comment.
      promise.catch(() => requestCache.delete(key));
      return promise;
    },
    syncCatalog(request, onBatch) {
      return new Promise<{ total: number }>((resolve, reject) => {
        const id = `catalog-sync-${++requestCounter}`;
        streaming.set(id, { onBatch, resolve, reject });
        const message: CatalogWorkerRequest = { id, ...request, streamBatchSize: DEFAULT_SYNC_BATCH_SIZE };
        ensureWorker().postMessage(message);
      });
    },
    terminate() {
      worker?.terminate();
      worker = undefined;
      pending.clear();
      streaming.clear();
      requestCache.clear();
    },
  };
}
