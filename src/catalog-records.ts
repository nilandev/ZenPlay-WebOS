import type { Channel, SeriesInfo } from "@core";
import type { CatalogRecord } from "./core/storage/catalog-db.js";

/**
 * Channel/series → catalog-db row mappers, shared by catalog-sync.ts
 * (Xtream VOD/series, main thread) and live-sync-core.ts (an M3U
 * playlist's movies, written from the sync worker). Pure and DOM-free.
 */

/** Group used for M3U entries with no group-title — the category index skips rows without one, so they'd never appear on a shelf. */
export const UNGROUPED_CATEGORY = "Uncategorized";

export function channelToRecord(sourceId: string, generation: number, item: Channel): CatalogRecord {
  return {
    id: `${sourceId}:${item.id}`,
    sourceId,
    streamId: item.id,
    name: item.name,
    nameLower: item.name.toLowerCase(),
    groupTitle: item.groupTitle,
    streamUrl: item.streamUrl,
    logoUrl: item.logoUrl,
    generation,
  };
}

export function seriesToRecord(sourceId: string, generation: number, item: Pick<SeriesInfo, "id" | "name" | "posterUrl" | "groupTitle">): CatalogRecord {
  return {
    id: `${sourceId}:${item.id}`,
    sourceId,
    streamId: item.id,
    name: item.name,
    nameLower: item.name.toLowerCase(),
    groupTitle: item.groupTitle,
    posterUrl: item.posterUrl,
    generation,
  };
}
