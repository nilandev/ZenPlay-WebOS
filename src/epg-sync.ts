import type { PlaylistSource } from "@core";
import { bumpCacheVersion } from "./cache-invalidation-store.js";
import { clearCachedContent } from "./content-cache.js";
import { deleteSourceProgrammes, openEpgDb } from "./core/storage/epg-db.js";
import { forgetSourceGuides } from "./epg-cache.js";
import { epgVersionKey, getLocalEpgMeta } from "./epg-store.js";
import { EpgStorageUnavailableError, runEpgSync, type EpgSyncRequest, type EpgSyncResult } from "./epg-sync-core.js";
import { createProxyFetch } from "./proxy-fetch.js";
import { EPG_DOWNLOAD_TIMEOUT_MS, type EpgWorkerRequest, type EpgWorkerResponse } from "./workers/epg-sync-protocol.js";

/**
 * Keeps each source's programme guide in the local EPG table
 * (core/storage/epg-db.ts): the XMLTV download, parse and writes all run in
 * src/workers/epg-sync-worker.ts, and this module is the main-thread side —
 * deciding when a sync is due, deduping, and telling mounted screens when
 * fresh data has landed. Replaces the old `guide-epg:${sourceId}` blob that
 * cache-revalidator.ts fetched and parsed on the main thread.
 *
 * Where a worker can't open IndexedDB (reported back as
 * "storage-unavailable"), the same sync runs on the main thread instead,
 * in small batches with a macrotask yield between each so remote input
 * still gets through.
 */

/** A guide is refetched once it's older than this. */
export const EPG_STALE_AFTER_MS = 6 * 60 * 60 * 1000;
/** Programmes that ended more than this long ago aren't kept — enough for "what just finished" and short catch-up browsing. */
export const EPG_KEEP_PAST_MS = 2 * 60 * 60 * 1000;
/** How far ahead programmes are kept. */
export const EPG_KEEP_FUTURE_MS = 3 * 24 * 60 * 60 * 1000;

const MAIN_THREAD_BATCH_SIZE = 500;

/** The XMLTV URL for a source, or undefined when it has none (an M3U source without an EPG URL). */
export function epgUrlFor(source: PlaylistSource): string | undefined {
  if (source.kind === "xtream") {
    const base = source.baseUrl.endsWith("/") ? source.baseUrl.slice(0, -1) : source.baseUrl;
    return `${base}/xmltv.php?username=${encodeURIComponent(source.username)}&password=${encodeURIComponent(source.password)}`;
  }
  return source.epgUrl || undefined;
}

export async function isEpgSyncDue(source: PlaylistSource): Promise<boolean> {
  if (!epgUrlFor(source)) return false;
  const meta = await getLocalEpgMeta(source.id);
  return !meta || Date.now() - meta.lastSyncedAt > EPG_STALE_AFTER_MS;
}

// --- Worker transport -------------------------------------------------------

let worker: Worker | undefined;
/** Flipped once a worker reports it can't open IndexedDB — later syncs go straight to the main-thread path. */
let workerCanStore = typeof Worker !== "undefined";
let requestCounter = 0;
const pending = new Map<string, { resolve: (result: EpgSyncResult) => void; reject: (err: Error) => void }>();

function rejectAll(error: Error): void {
  for (const entry of pending.values()) entry.reject(error);
  pending.clear();
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./workers/epg-sync-worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<EpgWorkerResponse>) => {
    const message = event.data;
    const entry = pending.get(message.id);
    if (!entry || message.type === "progress") return;
    pending.delete(message.id);
    if (message.type === "done") {
      entry.resolve({ programmeCount: message.programmeCount, channelCount: message.channelCount });
      return;
    }
    const error = message.code === "storage-unavailable" ? new EpgStorageUnavailableError() : new Error(message.message);
    error.name = message.code === "storage-unavailable" ? error.name : message.name;
    entry.reject(error);
  };
  worker.onerror = (event) => {
    // A worker that can't even load (bad module, unsupported) is as good as one without storage.
    workerCanStore = false;
    worker = undefined;
    rejectAll(new EpgStorageUnavailableError(new Error(event.message || "EPG worker failed to start")));
  };
  return worker;
}

function runInWorker(request: EpgSyncRequest): Promise<EpgSyncResult> {
  return new Promise((resolve, reject) => {
    const id = `epg-${++requestCounter}`;
    pending.set(id, { resolve, reject });
    const message: EpgWorkerRequest = { id, ...request };
    ensureWorker().postMessage(message);
  });
}

function runOnMainThread(request: EpgSyncRequest): Promise<EpgSyncResult> {
  return runEpgSync(request, {
    fetchImpl: createProxyFetch(EPG_DOWNLOAD_TIMEOUT_MS),
    batchSize: MAIN_THREAD_BATCH_SIZE,
    yieldBetweenBatches: () => new Promise((resolve) => setTimeout(resolve, 0)),
  });
}

async function runSync(request: EpgSyncRequest): Promise<EpgSyncResult> {
  if (workerCanStore) {
    try {
      return await runInWorker(request);
    } catch (err) {
      if (!(err instanceof EpgStorageUnavailableError)) throw err;
      workerCanStore = false;
    }
  }
  return runOnMainThread(request);
}

// --- Public API -------------------------------------------------------------

const inFlight = new Map<string, Promise<EpgSyncResult | null>>();

/**
 * Downloads and stores the source's guide now, regardless of age. Resolves
 * null for a source with no guide URL. Concurrent calls for the same source
 * share one sync. On success, mounted Guide/Live TV screens are told to
 * re-read (epgVersionKey) and the per-channel memory cache is dropped.
 */
export function syncEpg(source: PlaylistSource): Promise<EpgSyncResult | null> {
  const existing = inFlight.get(source.id);
  if (existing) return existing;

  const url = epgUrlFor(source);
  if (!url) return Promise.resolve(null);

  const now = Date.now();
  const promise = runSync({ sourceId: source.id, url, windowStartMs: now - EPG_KEEP_PAST_MS, windowEndMs: now + EPG_KEEP_FUTURE_MS })
    .then((result) => {
      forgetSourceGuides(source.id);
      // The pre-table blob this replaces — free its storage now there's a local guide.
      clearCachedContent(`guide-epg:${source.id}`);
      bumpCacheVersion(epgVersionKey(source.id));
      return result;
    })
    .finally(() => inFlight.delete(source.id));
  inFlight.set(source.id, promise);
  return promise;
}

/** Background entry point: syncs only when the stored guide is missing or stale, and never rejects (a failed guide sync just leaves the previous guide in place). */
export async function syncEpgIfDue(source: PlaylistSource): Promise<void> {
  try {
    if (await isEpgSyncDue(source)) await syncEpg(source);
  } catch {
    // Offline or provider error — retried the next time a sync is due-checked.
  }
}

/** Drops a source's stored guide entirely (Manage Playlists → Clear Cache). */
export async function clearEpgForSource(sourceId: string): Promise<void> {
  try {
    await deleteSourceProgrammes(await openEpgDb(), sourceId);
  } catch {
    // Nothing stored, or storage unavailable — nothing to clear.
  }
  forgetSourceGuides(sourceId);
  bumpCacheVersion(epgVersionKey(sourceId));
}

/** Test-only: forget in-flight syncs and worker state. */
export function __resetEpgSyncForTests(options: { workerAvailable?: boolean } = {}): void {
  inFlight.clear();
  rejectAll(new Error("reset"));
  worker?.terminate();
  worker = undefined;
  workerCanStore = options.workerAvailable ?? typeof Worker !== "undefined";
}
