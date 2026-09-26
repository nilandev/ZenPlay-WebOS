import type { PlaylistSource } from "@core";
import { clearCatalogForSource } from "../catalog-sync.js";
import { clearCachedContentForSource } from "../content-cache.js";
import { clearEpgForSource } from "../epg-sync.js";
import { forgetWorkingLiveStreamFormat } from "../live-stream-url.js";
import { clearLiveForSource } from "../live-sync.js";
import { removeSourceUserData } from "../profile-store.js";
import { removeSourceKidsRules } from "../parental-store.js";
import { cancelSync, syncSource, whenIdle, type SyncOutcome } from "./sync-manager.js";
import { useSyncStore } from "./sync-store.js";

/**
 * Stops whatever is syncing for the source and waits for it to stop — a
 * stage already handed to a worker finishes first, so nothing can write
 * rows back in after they've been cleared.
 */
async function stopSyncing(sourceId: string): Promise<void> {
  cancelSync(sourceId);
  await whenIdle(sourceId);
}

/** Every piece of downloaded data for a source: the small-item cache and the live, movie, series and guide tables with their sync records. */
async function clearDownloadedData(sourceId: string): Promise<void> {
  clearCachedContentForSource(sourceId);
  await Promise.all([clearLiveForSource(sourceId), clearCatalogForSource(sourceId), clearEpgForSource(sourceId)]);
}

/**
 * Manage Playlists → "Reset data": throws away everything downloaded for
 * the source and syncs it again from scratch. The user's favourites and
 * history are kept — they're still the same playlist.
 */
export async function resetSourceData(source: PlaylistSource): Promise<SyncOutcome> {
  await stopSyncing(source.id);
  await clearDownloadedData(source.id);
  useSyncStore.getState().forget(source.id);
  return syncSource(source, { trigger: "manual", force: true });
}

/**
 * The playlist is being removed: stop its sync, then delete everything
 * stored for it — downloaded data, sync status, and every profile's
 * favourites and Recently Watched entries for it — so nothing with its id
 * is left behind.
 */
export async function purgeSourceData(sourceId: string): Promise<void> {
  await stopSyncing(sourceId);
  await clearDownloadedData(sourceId);
  removeSourceUserData(sourceId);
  removeSourceKidsRules(sourceId);
  forgetWorkingLiveStreamFormat(sourceId);
  useSyncStore.getState().forget(sourceId);
}
