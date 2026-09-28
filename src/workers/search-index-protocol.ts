import type { SearchIndexJob } from "../search/search-indexer.js";

/** Main thread → search-index worker. */
export type SearchIndexRequest =
  /** Work through `jobs` (resuming each from where it stopped), pausing `paceMs` after every unit. */
  | { type: "run"; jobs: SearchIndexJob[]; paceMs: number }
  /** Stop at the next unit boundary. Answered with "paused" (or "done", if it finished first). */
  | { type: "pause" };

/** Search-index worker → main thread. */
export type SearchIndexResponse = { type: "done" } | { type: "paused" } | { type: "error"; message: string };
