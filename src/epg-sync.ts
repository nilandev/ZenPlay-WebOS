import type { PlaylistSource } from "@core";
import { bumpCacheVersion } from "./cache-invalidation-store.js";
import { clearCachedContent } from "./content-cache.js";
import { deleteSourceProgrammes, openEpgDb } from "./core/storage/epg-db.js";
import { forgetSourceGuides } from "./epg-cache.js";
import { epgVersionKey, getLocalEpgMeta } from "./epg-store.js";
import type { EpgSyncResult } from "./epg-sync-core.js";
import { __resetSyncWorkerClientForTests, runSyncJobOffMainThread } from "./workers/sync-worker-client.js";

/**
 * Keeps each source's programme guide in the local EPG table
 * (core/storage/epg-db.ts): the XMLTV download, parse and writes all run in
 * src/workers/sync-worker.ts, and this module is the main-thread side —
 * deciding when a sync is due, deduping, and telling mounted screens when
 * fresh data has landed. Replaces the old `guide-epg:${sourceId}` blob that
 * the old main-thread revalidator fetched and parsed on the main thread.
 * When to sync is decided by sync/sync-manager.ts.
 * (See workers/sync-worker-client.ts for the main-thread fallback where a
 * worker can't reach IndexedDB.)
 */

/** A guide is refetched once it's older than this. */
export const EPG_STALE_AFTER_MS = 6 * 60 * 60 * 1000;
/** Programmes that ended more than this long ago aren't kept — enough for "what just finished" and short catch-up browsing. */
export const EPG_KEEP_PAST_MS = 2 * 60 * 60 * 1000;
/** How far ahead programmes are kept. */
export const EPG_KEEP_FUTURE_MS = 3 * 24 * 60 * 60 * 1000;

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

// --- Public API -------------------------------------------------------------

const inFlight = new Map<string, Promise<EpgSyncResult | null>>();

/**
 * Downloads and stores the source's guide now, regardless of age. Resolves
 * null for a source with no guide URL. Concurrent calls for the same source
 * share one sync. On success, mounted Guide/Live TV screens are told to
 * re-read (epgVersionKey) and the per-channel memory cache is dropped.
 */
export function syncEpg(source: PlaylistSource, options: { onProgress?: (written: number) => void } = {}): Promise<EpgSyncResult | null> {
  const existing = inFlight.get(source.id);
  if (existing) return existing;

  const url = epgUrlFor(source);
  if (!url) return Promise.resolve(null);

  const now = Date.now();
  const promise = runSyncJobOffMainThread(
    "epg",
    { sourceId: source.id, url, windowStartMs: now - EPG_KEEP_PAST_MS, windowEndMs: now + EPG_KEEP_FUTURE_MS },
    options.onProgress,
  )
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
  __resetSyncWorkerClientForTests(options);
}
