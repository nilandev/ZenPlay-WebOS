import { SyncStorageUnavailableError } from "../sync-job.js";
import { runSyncJob } from "./sync-jobs.js";
import type { SyncJobName, SyncJobs, SyncWorkerRequest, SyncWorkerResponse } from "./sync-worker-protocol.js";

/**
 * Main-thread side of src/workers/sync-worker.ts: one lazily-created worker
 * shared by every sync job, turned into a plain Promise per job.
 *
 * Where the worker can't open IndexedDB (it reports "storage-unavailable",
 * or fails to start at all), the job reruns here on the main thread in
 * small batches with a macrotask yield between each, so remote input still
 * gets through — and every later job skips straight to that path.
 */

const MAIN_THREAD_BATCH_SIZE = 500;

let worker: Worker | undefined;
let workerCanStore = typeof Worker !== "undefined";
let requestCounter = 0;
const pending = new Map<string, { resolve: (result: unknown) => void; reject: (err: Error) => void; onProgress?: (written: number) => void }>();

function rejectAll(error: Error): void {
  for (const entry of pending.values()) entry.reject(error);
  pending.clear();
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./sync-worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<SyncWorkerResponse>) => {
    const message = event.data;
    const entry = pending.get(message.id);
    if (!entry) return;
    if (message.type === "progress") {
      entry.onProgress?.(message.written);
      return;
    }
    pending.delete(message.id);
    if (message.type === "done") {
      entry.resolve(message.result);
      return;
    }
    if (message.code === "storage-unavailable") {
      entry.reject(new SyncStorageUnavailableError(new Error(message.message)));
      return;
    }
    const error = new Error(message.message);
    error.name = message.name;
    entry.reject(error);
  };
  worker.onerror = (event) => {
    // A worker that can't even load is as good as one without storage.
    workerCanStore = false;
    worker = undefined;
    rejectAll(new SyncStorageUnavailableError(new Error(event.message || "Sync worker failed to start")));
  };
  return worker;
}

function runInWorker<J extends SyncJobName>(job: J, request: SyncJobs[J]["request"], onProgress?: (written: number) => void): Promise<SyncJobs[J]["result"]> {
  return new Promise((resolve, reject) => {
    const id = `sync-${++requestCounter}`;
    pending.set(id, { resolve: resolve as (result: unknown) => void, reject, onProgress });
    ensureWorker().postMessage({ id, job, request } as SyncWorkerRequest);
  });
}

/** Runs a sync job in the worker, or on the main thread where the worker can't store. `onProgress` gets the running count of rows written. */
export async function runSyncJobOffMainThread<J extends SyncJobName>(
  job: J,
  request: SyncJobs[J]["request"],
  onProgress?: (written: number) => void,
): Promise<SyncJobs[J]["result"]> {
  if (workerCanStore) {
    try {
      return await runInWorker(job, request, onProgress);
    } catch (err) {
      if (!(err instanceof SyncStorageUnavailableError)) throw err;
      workerCanStore = false;
    }
  }
  return runSyncJob(job, request, {
    onProgress,
    batchSize: MAIN_THREAD_BATCH_SIZE,
    yieldBetweenBatches: () => new Promise((resolve) => setTimeout(resolve, 0)),
  });
}

/** Test-only: drop the worker and choose whether one is "available". */
export function __resetSyncWorkerClientForTests(options: { workerAvailable?: boolean } = {}): void {
  rejectAll(new Error("reset"));
  worker?.terminate();
  worker = undefined;
  workerCanStore = options.workerAvailable ?? typeof Worker !== "undefined";
}
