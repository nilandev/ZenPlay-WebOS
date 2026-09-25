import { parseXmltv } from "@core";
import {
  deleteStaleProgrammes,
  getEpgSyncMeta,
  openEpgDb,
  putEpgSyncMeta,
  putProgrammes,
  type EpgDb,
  type EpgRecord,
} from "./core/storage/epg-db.js";

/**
 * The actual EPG sync — download one XMLTV file, stream-parse it, and write
 * the programmes inside the retention window into the EPG table
 * (core/storage/epg-db.ts) in batches. Deliberately DOM-free and
 * React-free: it normally runs inside src/workers/epg-sync-worker.ts, and
 * only falls back to the main thread (with yields between batches, see
 * epg-sync.ts) where a worker can't reach IndexedDB.
 *
 * Write-then-swap, same as catalog-sync.ts: rows are written under a new
 * generation, sync_meta is flipped, then older-generation rows are deleted.
 * Because the primary key is [sourceId, channelId, start], a programme
 * present in both the old and new feed is simply overwritten in place, so a
 * reader mid-sync sees old or new data for a channel, never a gap.
 */

export interface EpgSyncRequest {
  sourceId: string;
  url: string;
  /** Programmes ending before this (epoch ms) are dropped. */
  windowStartMs: number;
  /** Programmes starting at or after this (epoch ms) are dropped. */
  windowEndMs: number;
}

export interface EpgSyncResult {
  programmeCount: number;
  channelCount: number;
}

export interface EpgSyncOptions {
  fetchImpl: typeof fetch;
  /** Called after each batch lands, with the running total written. */
  onProgress?: (written: number) => void;
  batchSize?: number;
  /** Awaited between batches — the main-thread fallback passes a macrotask yield so remote input gets handled mid-parse. */
  yieldBetweenBatches?: () => Promise<void>;
}

/** IndexedDB can't be opened in this context — the caller should retry the sync somewhere that can (see epg-sync.ts's main-thread fallback). */
export class EpgStorageUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(`EPG storage unavailable${cause instanceof Error ? `: ${cause.message}` : ""}`);
    this.name = "EpgStorageUnavailableError";
  }
}

/** The provider returned a guide with nothing in the retention window — kept separate so a previously-good guide isn't wiped by a broken/empty response. */
export class EpgEmptyError extends Error {
  constructor() {
    super("The provider's guide had no programmes for the coming days.");
    this.name = "EpgEmptyError";
  }
}

export const DEFAULT_EPG_BATCH_SIZE = 2000;

export async function runEpgSync(request: EpgSyncRequest, options: EpgSyncOptions): Promise<EpgSyncResult> {
  const { sourceId, url, windowStartMs, windowEndMs } = request;
  const { fetchImpl, onProgress, batchSize = DEFAULT_EPG_BATCH_SIZE, yieldBetweenBatches } = options;

  // Open storage before downloading, so a context without IndexedDB fails in milliseconds rather than after a 100MB download.
  let epgDb: EpgDb;
  try {
    epgDb = await openEpgDb();
  } catch (err) {
    throw new EpgStorageUnavailableError(err);
  }

  const previous = await getEpgSyncMeta(epgDb, sourceId);
  // Time-based rather than previous + 1: a sync that died partway through
  // left rows under its own generation without recording it, and a reused
  // number would shield those rows from the cleanup below forever.
  const generation = Math.max(Date.now(), (previous?.generation ?? 0) + 1);

  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`EPG request failed: HTTP ${response.status}`);
  const xml = await response.text();

  const channels = new Set<string>();
  let written = 0;
  let batch: EpgRecord[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const toWrite = batch;
    batch = [];
    await putProgrammes(epgDb, toWrite);
    written += toWrite.length;
    onProgress?.(written);
    if (yieldBetweenBatches) await yieldBetweenBatches();
  };

  let scanned = 0;
  for (const programme of parseXmltv(xml)) {
    // A 14-day guide can have long runs outside the 3-day window that never
    // fill a batch — yield on programmes scanned too, not just on writes.
    if (yieldBetweenBatches && ++scanned % batchSize === 0 && batch.length < batchSize) await yieldBetweenBatches();
    const start = programme.start.getTime();
    const stop = programme.stop.getTime();
    if (!Number.isFinite(start) || !Number.isFinite(stop)) continue;
    if (stop <= windowStartMs || start >= windowEndMs) continue;

    channels.add(programme.channelId);
    batch.push({
      sourceId,
      channelId: programme.channelId,
      start,
      stop,
      title: programme.title,
      description: programme.description,
      generation,
    });
    if (batch.length >= batchSize) await flush();
  }
  await flush();

  if (written === 0 && previous) throw new EpgEmptyError();

  await putEpgSyncMeta(epgDb, { sourceId, lastSyncedAt: Date.now(), generation, programmeCount: written, channelCount: channels.size });
  await deleteStaleProgrammes(epgDb, sourceId, generation);

  return { programmeCount: written, channelCount: channels.size };
}
