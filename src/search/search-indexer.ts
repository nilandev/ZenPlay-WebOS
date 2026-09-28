import { catalogSyncMetaKey, getSyncMeta, type CatalogDb } from "../core/storage/catalog-db.js";
import { getLiveSyncMeta, getSourceChannelsAfter, openLiveDb } from "../core/storage/live-db.js";
import {
  getSearchIndexMeta,
  readCatalogRecordsAfter,
  searchIndexMetaKey,
  searchKey,
  sweepStaleSearchRows,
  writeSearchRows,
  type SearchIndexMeta,
  type SearchKind,
  type SearchTokenRow,
} from "../core/storage/search-index-db.js";
import { indexTokens } from "./normalize.js";

/**
 * The background indexer's work, one small unit at a time (see
 * docs/global-search-plan.md, "The indexer"). Runs inside
 * workers/search-index-worker.ts, never on the main thread; kept here, free
 * of any worker plumbing, so tests can drive it step by step.
 */

/** Titles per unit: small enough that a pause request is honoured within a moment. */
export const INDEX_UNIT_SIZE = 100;

export interface SearchIndexJob {
  sourceId: string;
  kind: SearchKind;
}

/** The generation to index against: the catalog's sync_meta, or the live list's. Undefined when it isn't downloaded (yet). */
async function sourceGeneration(catalogDb: CatalogDb, { sourceId, kind }: SearchIndexJob): Promise<number | undefined> {
  if (kind === "live") return (await getLiveSyncMeta(await openLiveDb(), sourceId))?.generation;
  return (await getSyncMeta(catalogDb, catalogSyncMetaKey(sourceId, kind)))?.generation;
}

/** The next unit's rows after `lastKey`, and the key to resume after them — empty when the list is finished. */
async function readUnit(catalogDb: CatalogDb, { sourceId, kind }: SearchIndexJob, generation: number, lastKey: string | number | null, unitSize: number): Promise<{ rows: SearchTokenRow[]; lastKey: string | number | null }> {
  if (kind === "live") {
    const channels = await getSourceChannelsAfter(await openLiveDb(), sourceId, typeof lastKey === "number" ? lastKey : null, unitSize);
    const rows = channels.map((channel) => ({
      id: `live|${sourceId}:${channel.position}`,
      sourceId,
      kind,
      recordId: channel.id,
      generation,
      keys: indexTokens(channel.name).map((word) => searchKey(sourceId, kind, word)),
    }));
    return { rows, lastKey: channels.length > 0 ? channels[channels.length - 1].position : null };
  }
  const records = await readCatalogRecordsAfter(catalogDb, kind, sourceId, typeof lastKey === "string" ? lastKey : null, unitSize);
  const rows = records.map((record) => ({
    id: `${kind}|${record.id}`,
    sourceId,
    kind,
    recordId: record.id,
    generation,
    keys: indexTokens(record.name).map((word) => searchKey(sourceId, kind, word)),
  }));
  return { rows, lastKey: records.length > 0 ? records[records.length - 1].id : null };
}

/**
 * Does one unit of work for a source and kind (a catalog, or the live
 * channel list):
 *
 * - index: tokenizes the next INDEX_UNIT_SIZE records (or channels) and saves
 *   their rows together with the new position;
 * - sweep: once every record is indexed, deletes up to INDEX_UNIT_SIZE rows
 *   left over from an older catalog generation;
 * - done: nothing left until the catalog changes.
 *
 * A new catalog generation (a sync finished) starts the source and kind
 * over from the beginning; its existing rows stay searchable meanwhile and
 * are overwritten as it goes. Returns whether there's more to do.
 */
export async function runIndexUnit(catalogDb: CatalogDb, job: SearchIndexJob, unitSize = INDEX_UNIT_SIZE): Promise<"more" | "done"> {
  const { sourceId, kind } = job;
  const generation = await sourceGeneration(catalogDb, job);
  if (generation === undefined) return "done"; // not downloaded (yet): nothing to index

  const key = searchIndexMetaKey(sourceId, kind);
  let meta: SearchIndexMeta | undefined = await getSearchIndexMeta(catalogDb, key);
  if (!meta || meta.generation !== generation) meta = { key, generation, lastKey: null, phase: "index" };
  if (meta.phase === "done") return "done";

  if (meta.phase === "index") {
    const unit = await readUnit(catalogDb, job, meta.generation, meta.lastKey, unitSize);
    if (unit.rows.length === 0) {
      await writeSearchRows(catalogDb, [], { ...meta, lastKey: null, phase: "sweep" });
      return "more";
    }
    await writeSearchRows(catalogDb, unit.rows, { ...meta, lastKey: unit.lastKey });
    return "more";
  }

  // Sweep: the meta written with the final chunk says "done", in the same transaction as the deletes.
  const deleted = await sweepStaleSearchRows(catalogDb, sourceId, kind, meta.generation, unitSize, { ...meta, phase: "sweep" });
  if (deleted < unitSize) {
    await sweepStaleSearchRows(catalogDb, sourceId, kind, meta.generation, 0, { ...meta, phase: "done" });
    return "done";
  }
  return "more";
}

export interface RunIndexJobsOptions {
  /** Wait after each unit, so the indexer only ever takes a small share of the CPU. */
  paceMs: number;
  /** Checked between units — true stops the run at that boundary. */
  shouldStop: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  unitSize?: number;
}

/**
 * Works through `jobs` in order, one unit at a time with a pause after
 * each, until they're all done or `shouldStop()` says to stop. Never
 * interrupted mid-unit, so there's no partial state to repair.
 */
export async function runIndexJobs(catalogDb: CatalogDb, jobs: SearchIndexJob[], options: RunIndexJobsOptions): Promise<"done" | "stopped"> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (const job of jobs) {
    for (;;) {
      if (options.shouldStop()) return "stopped";
      const result = await runIndexUnit(catalogDb, job, options.unitSize);
      if (result === "done") break;
      await sleep(options.paceMs);
    }
  }
  return "done";
}
