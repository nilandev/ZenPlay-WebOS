import type { EpgSyncRequest, EpgSyncResult } from "../epg-sync-core.js";
import type { LiveSyncRequest, LiveSyncResult } from "../live-sync-core.js";

/** Whole-download deadline for an XMLTV guide — they can reach 100MB, well past proxy-fetch.ts's general DOWNLOAD_TIMEOUT_MS on a slow connection. */
export const EPG_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

/** Every job the sync worker runs, with its request and result shapes. */
export interface SyncJobs {
  epg: { request: EpgSyncRequest; result: EpgSyncResult };
  live: { request: LiveSyncRequest; result: LiveSyncResult };
}
export type SyncJobName = keyof SyncJobs;

export type SyncWorkerRequest = { [J in SyncJobName]: { id: string; job: J; request: SyncJobs[J]["request"] } }[SyncJobName];

export type SyncWorkerResponse =
  | { id: string; type: "progress"; written: number }
  | { id: string; type: "done"; result: SyncJobs[SyncJobName]["result"] }
  | {
      id: string;
      type: "error";
      /** "storage-unavailable": this worker can't open IndexedDB, so the main thread should run the job itself. */
      code: "storage-unavailable" | "failed";
      name: string;
      message: string;
    };
