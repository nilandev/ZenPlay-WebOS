/// <reference lib="webworker" />
import { SyncStorageUnavailableError } from "../sync-job.js";
import { runSyncJob } from "./sync-jobs.js";
import type { SyncWorkerRequest, SyncWorkerResponse } from "./sync-worker-protocol.js";

/**
 * Runs the heavy sync jobs — the XMLTV guide (epg-sync-core.ts), the live
 * channel list (live-sync-core.ts) and the movie/series catalogs
 * (catalog-sync-core.ts) — entirely off the main thread: download,
 * parse, map and the IndexedDB writes. On webOS's WebKit, parsing a 50MB+
 * guide or a 20k-channel JSON list takes seconds of CPU; on the main thread
 * that froze the remote (see docs/sync-architecture-plan.md §1.1/§1.2).
 * Only small progress/done messages come back — never the data itself.
 */

function post(message: SyncWorkerResponse): void {
  self.postMessage(message);
}

self.onmessage = async (event: MessageEvent<SyncWorkerRequest>) => {
  const { id, job, request } = event.data;
  try {
    const result = await runSyncJob(job, request, { onProgress: (written) => post({ id, type: "progress", written }) });
    post({ id, type: "done", result });
  } catch (err) {
    post({
      id,
      type: "error",
      code: err instanceof SyncStorageUnavailableError ? "storage-unavailable" : "failed",
      name: err instanceof Error ? err.name : "Error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
