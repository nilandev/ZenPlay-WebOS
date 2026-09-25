import type { EpgSyncRequest, EpgSyncResult } from "../epg-sync-core.js";

/** Whole-download deadline for an XMLTV guide — they can reach 100MB, well past proxy-fetch.ts's general DOWNLOAD_TIMEOUT_MS on a slow connection. */
export const EPG_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

export type EpgWorkerRequest = EpgSyncRequest & { id: string };

export type EpgWorkerResponse =
  | { id: string; type: "progress"; written: number }
  | ({ id: string; type: "done" } & EpgSyncResult)
  | {
      id: string;
      type: "error";
      /** "storage-unavailable": this worker can't open IndexedDB, so the main thread should run the sync itself. */
      code: "storage-unavailable" | "failed";
      name: string;
      message: string;
    };
