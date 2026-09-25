/// <reference lib="webworker" />
import { EpgStorageUnavailableError, runEpgSync, type EpgSyncRequest } from "../epg-sync-core.js";
import { createProxyFetch } from "../proxy-fetch.js";
import { EPG_DOWNLOAD_TIMEOUT_MS } from "./epg-sync-protocol.js";
import type { EpgWorkerRequest, EpgWorkerResponse } from "./epg-sync-protocol.js";

/**
 * Runs the whole EPG sync — XMLTV download, regex parse, and the IndexedDB
 * writes — off the main thread. A 50–100MB guide takes several seconds of
 * pure CPU to parse on webOS's WebKit; on the main thread that froze the
 * remote on Home right after profile select (see
 * docs/sync-architecture-plan.md §1.1). Only small progress/done messages
 * ever cross back to the main thread — never the programmes themselves —
 * so there's no big structured clone on the way back either.
 */

const fetchWithDeadline = createProxyFetch(EPG_DOWNLOAD_TIMEOUT_MS);

function post(message: EpgWorkerResponse): void {
  self.postMessage(message);
}

self.onmessage = async (event: MessageEvent<EpgWorkerRequest>) => {
  const { id, ...request } = event.data;
  try {
    const result = await runEpgSync(request satisfies EpgSyncRequest, {
      fetchImpl: fetchWithDeadline,
      onProgress: (written) => post({ id, type: "progress", written }),
    });
    post({ id, type: "done", ...result });
  } catch (err) {
    post({
      id,
      type: "error",
      code: err instanceof EpgStorageUnavailableError ? "storage-unavailable" : "failed",
      name: err instanceof Error ? err.name : "Error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
