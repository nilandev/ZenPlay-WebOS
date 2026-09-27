import { cleanTitle, type Channel } from "@core";
import { getLiveSyncMeta, getSourceChannels, openLiveDb, type LiveChannelRecord, type LiveSyncMeta } from "./core/storage/live-db.js";

/**
 * Main-thread reads of the live channel table that live-sync.ts keeps
 * filled. The list is read once per sync and shared (Live TV, Guide and My
 * List all need the same full list — for numbering, CH+/CH− lineups and
 * favourites), so revisiting a screen is instant rather than another
 * IndexedDB read.
 */

/** Cache-invalidation key bumped when a source's live sync lands — use-live-channels.ts re-reads on it. */
export function liveVersionKey(sourceId: string): string {
  return `local-live:${sourceId}`;
}

const snapshots = new Map<string, Channel[]>();
const pendingReads = new Map<string, Promise<Channel[] | undefined>>();

function toChannel({ sourceId: _sourceId, position: _position, generation: _generation, ...channel }: LiveChannelRecord): Channel {
  // Rows stored before titles were cleaned at sync time.
  return { ...channel, name: cleanTitle(channel.name) };
}

/** The source's channel list if it's already been read this session — synchronous, for a first render with no loading flash. */
export function peekLiveChannels(sourceId: string): Channel[] | undefined {
  return snapshots.get(sourceId);
}

/**
 * The source's channel list in provider order, or `undefined` when it has
 * never completed a live sync (the caller should start one). Concurrent
 * calls share one read.
 */
export function readLiveChannels(sourceId: string): Promise<Channel[] | undefined> {
  const snapshot = snapshots.get(sourceId);
  if (snapshot) return Promise.resolve(snapshot);
  const pending = pendingReads.get(sourceId);
  if (pending) return pending;

  const read = (async () => {
    try {
      const liveDb = await openLiveDb();
      const meta = await getLiveSyncMeta(liveDb, sourceId);
      if (!meta) return undefined;
      const channels = (await getSourceChannels(liveDb, sourceId)).map(toChannel);
      snapshots.set(sourceId, channels);
      return channels;
    } catch {
      return undefined;
    }
  })().finally(() => pendingReads.delete(sourceId));
  pendingReads.set(sourceId, read);
  return read;
}

/** Drops the in-memory list so the next read comes from the table — called when a sync lands or the source's data is cleared. */
export function forgetLiveChannels(sourceId: string): void {
  snapshots.delete(sourceId);
  pendingReads.delete(sourceId);
}

export async function getLocalLiveMeta(sourceId: string): Promise<LiveSyncMeta | undefined> {
  try {
    return await getLiveSyncMeta(await openLiveDb(), sourceId);
  } catch {
    return undefined;
  }
}

/** Test-only. */
export function __resetLiveStoreForTests(): void {
  snapshots.clear();
  pendingReads.clear();
}
