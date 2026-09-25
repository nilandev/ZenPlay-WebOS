import { runEpgSync } from "../epg-sync-core.js";
import { runLiveSync } from "../live-sync-core.js";
import { createProxyFetch, DOWNLOAD_TIMEOUT_MS } from "../proxy-fetch.js";
import type { SyncJobOptions } from "../sync-job.js";
import { EPG_DOWNLOAD_TIMEOUT_MS, type SyncJobName, type SyncJobs } from "./sync-worker-protocol.js";

/** Runs one named sync job with its download deadline — shared by the worker and the main-thread fallback so both behave identically. */
export function runSyncJob<J extends SyncJobName>(job: J, request: SyncJobs[J]["request"], options: Omit<SyncJobOptions, "fetchImpl">): Promise<SyncJobs[J]["result"]> {
  if (job === "epg") {
    return runEpgSync(request as SyncJobs["epg"]["request"], { ...options, fetchImpl: createProxyFetch(EPG_DOWNLOAD_TIMEOUT_MS) });
  }
  return runLiveSync(request as SyncJobs["live"]["request"], { ...options, fetchImpl: createProxyFetch(DOWNLOAD_TIMEOUT_MS) });
}
