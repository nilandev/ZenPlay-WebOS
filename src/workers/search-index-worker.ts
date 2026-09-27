/// <reference lib="webworker" />
import { openCatalogDb } from "../core/storage/catalog-db.js";
import { runIndexJobs } from "../search/search-indexer.js";
import type { SearchIndexRequest, SearchIndexResponse } from "./search-index-protocol.js";

/**
 * Builds the search index in the background (docs/global-search-plan.md,
 * "The indexer"). Its own worker rather than the sync worker, so a long run
 * can never delay a sync job queued behind it; it opens the catalog
 * database itself, so the main thread does no indexing work at all.
 * search/search-index-scheduler.ts decides when it may run.
 */

let running = false;
let pauseRequested = false;

function post(message: SearchIndexResponse): void {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<SearchIndexRequest>) => {
  const message = event.data;
  if (message.type === "pause") {
    pauseRequested = true;
    if (!running) post({ type: "paused" });
    return;
  }
  if (running) return;
  running = true;
  pauseRequested = false;
  void (async () => {
    try {
      const catalogDb = await openCatalogDb();
      const result = await runIndexJobs(catalogDb, message.jobs, { paceMs: message.paceMs, shouldStop: () => pauseRequested });
      post({ type: result === "done" ? "done" : "paused" });
    } catch (err) {
      post({ type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      running = false;
    }
  })();
};
