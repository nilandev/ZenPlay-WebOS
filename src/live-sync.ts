import { XtreamClient, type PlaylistSource } from "@core";
import { bumpCacheVersion } from "./cache-invalidation-store.js";
import { clearCachedContent } from "./content-cache.js";
import { deleteSourceChannels, openLiveDb } from "./core/storage/live-db.js";
import type { LiveSyncResult } from "./live-sync-core.js";
import { forgetLiveChannels, getLocalLiveMeta, liveVersionKey } from "./live-store.js";
import { proxyFetch } from "./proxy-fetch.js";
import { runSyncJobOffMainThread } from "./workers/sync-worker-client.js";

/**
 * Keeps each source's live channel list in the local live table
 * (core/storage/live-db.ts). The fetch, parse and writes run in
 * src/workers/sync-worker.ts; this is the main-thread side — deciding when
 * a sync is due, deduping, and telling mounted screens (via
 * use-live-channels.ts) when a fresh list has landed.
 */

/** A live list is refetched once it's older than this. */
export const LIVE_STALE_AFTER_MS = 12 * 60 * 60 * 1000;

/** The pre-table cache keys for the same list — freed once a sync lands, and never revived at boot (see content-cache.ts). */
const LEGACY_KEYS = (sourceId: string) => [`live:${sourceId}`, `guide-channels:${sourceId}`];

export async function isLiveSyncDue(source: PlaylistSource): Promise<boolean> {
  const meta = await getLocalLiveMeta(source.id);
  return !meta || Date.now() - meta.lastSyncedAt > LIVE_STALE_AFTER_MS;
}

const inFlight = new Map<string, Promise<LiveSyncResult>>();

/**
 * Fetches and stores the source's live list now, regardless of age.
 * Concurrent calls for the same source share one sync. Xtream logins are
 * checked here first, on the main thread (cheap, and deduped by
 * XtreamClient), so a bad password rejects with XtreamAuthError rather than
 * a generic worker failure.
 */
export function syncLiveChannels(source: PlaylistSource, options: { onProgress?: (written: number) => void } = {}): Promise<LiveSyncResult> {
  const existing = inFlight.get(source.id);
  if (existing) return existing;

  const promise = (async () => {
    if (source.kind === "xtream") await new XtreamClient(source, proxyFetch).authenticate();
    const result = await runSyncJobOffMainThread("live", { source }, options.onProgress);
    forgetLiveChannels(source.id);
    for (const key of LEGACY_KEYS(source.id)) clearCachedContent(key);
    bumpCacheVersion(liveVersionKey(source.id));
    return result;
  })().finally(() => inFlight.delete(source.id));
  inFlight.set(source.id, promise);
  return promise;
}

/** Drops a source's stored live list (Manage Playlists → Clear Cache). */
export async function clearLiveForSource(sourceId: string): Promise<void> {
  try {
    await deleteSourceChannels(await openLiveDb(), sourceId);
  } catch {
    // Nothing stored, or storage unavailable — nothing to clear.
  }
  forgetLiveChannels(sourceId);
  bumpCacheVersion(liveVersionKey(sourceId));
}

/** Test-only. */
export function __resetLiveSyncForTests(): void {
  inFlight.clear();
}
