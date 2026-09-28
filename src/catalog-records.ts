import { getDefaultKidsRules, type Channel, type SeriesInfo } from "@core";
import { catalogRecordId, streamIdSortKey, type CatalogRecord } from "./core/storage/catalog-db.js";

/**
 * Channel/series → catalog-db row mappers, shared by catalog-sync.ts
 * (Xtream VOD/series, main thread) and live-sync-core.ts (an M3U
 * playlist's movies, written from the sync worker). Pure and DOM-free.
 */

/** Group used for M3U entries with no group-title — the category index skips rows without one, so they'd never appear on a shelf. */
export const UNGROUPED_CATEGORY = "Uncategorized";

/**
 * Kids tags for a title (and genre), written with the record so the
 * multiEntry tag index can find "every animation title" without a scan —
 * see docs/kids-profile.md §3.4. Read-time filtering re-derives the mature
 * flag from the name itself, so a record synced under older rules is never
 * trusted for safety, only for the tag index.
 */
function kidsFields(sourceId: string, text: string): Pick<CatalogRecord, "tags" | "mature" | "tagKeys"> {
  const { tags, mature } = getDefaultKidsRules().tagText(text);
  return { tags, mature: mature ? 1 : 0, tagKeys: tags.map((tag) => `${sourceId}|${tag}`) };
}

export function channelToRecord(sourceId: string, generation: number, item: Channel): CatalogRecord {
  return {
    id: catalogRecordId(sourceId, item.id),
    sourceId,
    streamId: item.id,
    name: item.name,
    nameLower: item.name.toLowerCase(),
    groupTitle: item.groupTitle,
    streamUrl: item.streamUrl,
    logoUrl: item.logoUrl,
    ...kidsFields(sourceId, item.name),
    generation,
  };
}

export function seriesToRecord(
  sourceId: string,
  generation: number,
  item: Pick<SeriesInfo, "id" | "name" | "posterUrl" | "groupTitle" | "genre">,
): CatalogRecord {
  return {
    id: catalogRecordId(sourceId, item.id),
    sourceId,
    streamId: item.id,
    name: item.name,
    nameLower: item.name.toLowerCase(),
    groupTitle: item.groupTitle,
    posterUrl: item.posterUrl,
    ...(item.genre ? { genre: item.genre } : {}),
    ...kidsFields(sourceId, item.genre ? `${item.name} ${item.genre}` : item.name),
    generation,
  };
}

/** Newest first — descending stream id, the same order the local table is read in (see catalog-db.ts's queryPage) — for lists fetched straight from the provider. Returns a new array. */
export function sortNewestFirst<T extends { id: string }>(items: readonly T[]): T[] {
  return items
    .map((item) => ({ item, key: streamIdSortKey(item.id) }))
    .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0))
    .map(({ item }) => item);
}
