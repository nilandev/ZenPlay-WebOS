import type { EpgProgramme } from "@core";
import { getChannelProgrammes, getEpgSyncMeta, openEpgDb, type EpgSyncMeta } from "./core/storage/epg-db.js";

/**
 * Main-thread reads of the local programme guide that epg-sync.ts keeps
 * filled — one channel at a time, straight off the primary key, so no
 * screen ever holds a whole XMLTV guide in memory.
 */

/** Cache-invalidation key bumped when a source's guide sync lands (see cache-invalidation-store.ts) — Guide/Live TV re-read their channels on it. */
export function epgVersionKey(sourceId: string): string {
  return `local-epg:${sourceId}`;
}

/**
 * One channel's programmes from the local guide, sorted by start.
 * `undefined` means the source has never completed a guide sync (so the
 * caller may try another source of guide data); `[]` means it has, and the
 * guide simply has nothing for this channel.
 */
export async function getLocalChannelProgrammes(sourceId: string, epgChannelId: string): Promise<EpgProgramme[] | undefined> {
  try {
    const epgDb = await openEpgDb();
    const [meta, records] = await Promise.all([getEpgSyncMeta(epgDb, sourceId), getChannelProgrammes(epgDb, sourceId, epgChannelId)]);
    if (!meta) return undefined;
    return records.map((r) => ({
      channelId: r.channelId,
      title: r.title,
      description: r.description,
      ...(r.categories ? { categories: r.categories } : {}),
      ...(r.rating ? { rating: r.rating } : {}),
      start: new Date(r.start),
      stop: new Date(r.stop),
    }));
  } catch {
    return undefined;
  }
}

export async function getLocalEpgMeta(sourceId: string): Promise<EpgSyncMeta | undefined> {
  try {
    return await getEpgSyncMeta(await openEpgDb(), sourceId);
  } catch {
    return undefined;
  }
}
