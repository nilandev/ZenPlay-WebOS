import { KIDS_TAGS, type Category, type Channel, type SeriesInfo } from "@core";
import {
  countRecords,
  getCategoryIds,
  getRecordsByIds as getCatalogDbRecordsByIds,
  openCatalogDb,
  queryByTags,
  queryPage,
  type CatalogDb,
  type CatalogKind,
  type CatalogRecord,
} from "./core/storage/catalog-db.js";
import { MORE_FOR_KIDS_CATEGORY_ID, PARENT_PICKS_CATEGORY_ID, type CatalogFilter } from "./content-policy.js";
import { hasCompletedSync } from "./catalog-sync.js";

/**
 * Read side of the local catalog table (see catalog-db.ts for the schema,
 * catalog-sync.ts for how it's populated). VodScreen/SeriesScreen read
 * paginated, indexed slices through this rather than ever loading a whole
 * source's catalog into memory — see use-catalog-page.ts for the hook that
 * wraps getCatalogPage with the "load more as you scroll" growth pattern
 * spatial navigation needs.
 */

export type { CatalogKind };

export interface CatalogPageQuery {
  categoryId?: string;
  /** Matched case-insensitively as a prefix against the stored name — see catalog-db.ts's by_source_name index. Not a substring match (confirmed trade-off for O(log n) lookups at 100k+ record scale). */
  namePrefix?: string;
  /** A Kids profile's filter (see content-policy.ts) — also what the two virtual Kids categories read from. */
  filter?: CatalogFilter;
  offset: number;
  limit: number;
}

/** Upper bound for counting the More for Kids category — it's walked, not counted by an index. */
const MORE_FOR_KIDS_COUNT_LIMIT = 5000;

function recordToChannel(record: CatalogRecord, kind: "movie"): Channel {
  return {
    id: record.streamId,
    name: record.name,
    logoUrl: record.logoUrl,
    groupTitle: record.groupTitle,
    streamUrl: record.streamUrl ?? "",
    kind,
  };
}

function recordToSeriesSummary(record: CatalogRecord): Pick<SeriesInfo, "id" | "name" | "posterUrl" | "groupTitle" | "genre"> {
  return {
    id: record.streamId,
    name: record.name,
    posterUrl: record.posterUrl,
    groupTitle: record.groupTitle,
    ...(record.genre ? { genre: record.genre } : {}),
  };
}

/**
 * Records for a (possibly filtered) page — the two virtual Kids categories
 * have their own sources: Picked by Parent is the parent's force-included
 * ids, More for Kids walks the tag index for kid-friendly titles outside
 * the allowed categories. Everything else is the indexed cursor walk, with
 * the filter's predicate applied as it goes.
 */
async function readRecords(catalogDb: CatalogDb, sourceId: string, kind: CatalogKind, query: CatalogPageQuery): Promise<CatalogRecord[]> {
  const { filter } = query;
  if (filter && query.categoryId === PARENT_PICKS_CATEGORY_ID) {
    const records = await getCatalogDbRecordsByIds(catalogDb, kind, filter.pickedIds.map((id) => `${sourceId}:${id}`));
    return records.slice(query.offset, query.offset + query.limit);
  }
  if (filter && query.categoryId === MORE_FOR_KIDS_CATEGORY_ID) {
    if (!filter.moreForKids) return [];
    return queryByTags(catalogDb, kind, sourceId, KIDS_TAGS, moreForKidsPredicate(filter), query.offset, query.limit);
  }
  return queryPage(catalogDb, kind, { ...toQueryOptions(sourceId, kind, query), predicate: filter?.accepts });
}

function moreForKidsPredicate(filter: CatalogFilter): (record: CatalogRecord) => boolean {
  return (record) => !filter.isCategoryAllowed(record.groupTitle) && filter.accepts(record);
}

function toQueryOptions(sourceId: string, kind: CatalogKind, query: CatalogPageQuery) {
  return {
    sourceId,
    categoryId: query.categoryId,
    namePrefixLower: query.namePrefix?.toLowerCase(),
    offset: query.offset,
    limit: query.limit,
  } as const;
}

export async function getCatalogPage(sourceId: string, kind: "vod", query: CatalogPageQuery): Promise<Channel[]>;
export async function getCatalogPage(
  sourceId: string,
  kind: "series",
  query: CatalogPageQuery,
): Promise<Array<Pick<SeriesInfo, "id" | "name" | "posterUrl" | "groupTitle">>>;
export async function getCatalogPage(sourceId: string, kind: CatalogKind, query: CatalogPageQuery): Promise<unknown[]> {
  const catalogDb = await openCatalogDb();
  const records = await readRecords(catalogDb, sourceId, kind, query);
  return kind === "vod" ? records.map((r) => recordToChannel(r, "movie")) : records.map(recordToSeriesSummary);
}

/** Total matching record count for the same filter getCatalogPage uses — backs "no more pages" checks in use-catalog-page.ts without reading every row. */
export async function getCatalogCount(sourceId: string, kind: CatalogKind, query: Omit<CatalogPageQuery, "offset" | "limit"> = {}): Promise<number> {
  const catalogDb = await openCatalogDb();
  const { filter } = query;
  if (filter && query.categoryId === PARENT_PICKS_CATEGORY_ID) {
    return (await getCatalogDbRecordsByIds(catalogDb, kind, filter.pickedIds.map((id) => `${sourceId}:${id}`))).length;
  }
  if (filter && query.categoryId === MORE_FOR_KIDS_CATEGORY_ID) {
    if (!filter.moreForKids) return 0;
    return (await queryByTags(catalogDb, kind, sourceId, KIDS_TAGS, moreForKidsPredicate(filter), 0, MORE_FOR_KIDS_COUNT_LIMIT)).length;
  }
  return countRecords(catalogDb, kind, {
    sourceId,
    categoryId: query.categoryId,
    namePrefixLower: query.namePrefix?.toLowerCase(),
    predicate: filter?.accepts,
  });
}

export async function getRecordsByIds(sourceId: string, kind: "vod", streamIds: string[]): Promise<Channel[]>;
export async function getRecordsByIds(
  sourceId: string,
  kind: "series",
  streamIds: string[],
): Promise<Array<Pick<SeriesInfo, "id" | "name" | "posterUrl" | "groupTitle">>>;
/**
 * Resolves bare stream ids (as stored in a Continue Watching/Favorites
 * entry's contentId/episodeId) back into full Channel/SeriesInfo summaries,
 * in the same order as `streamIds` — missing/removed streams are dropped
 * rather than left as holes. Only covers vod/series, the two kinds
 * catalog-db.ts indexes; live channels have no local catalog table and are
 * resolved separately from content-cache.ts's live:<sourceId> list.
 */
export async function getRecordsByIds(sourceId: string, kind: CatalogKind, streamIds: string[]): Promise<unknown[]> {
  const catalogDb = await openCatalogDb();
  const ids = streamIds.map((streamId) => `${sourceId}:${streamId}`);
  const records = await getCatalogDbRecordsByIds(catalogDb, kind, ids);
  return kind === "vod" ? records.map((r) => recordToChannel(r, "movie")) : records.map(recordToSeriesSummary);
}

/** The categories a source's local catalog uses, named after their ids — for M3U sources, whose groups are the only categories they have. */
export async function getCatalogCategories(sourceId: string, kind: CatalogKind): Promise<Category[]> {
  try {
    const ids = await getCategoryIds(await openCatalogDb(), kind, sourceId);
    return ids.map((id) => ({ id, name: id, kind: kind === "vod" ? "movie" : "series" }));
  } catch {
    return [];
  }
}

/**
 * Whether this source+kind has a local catalog ready to read from at all —
 * screens show the sync manager's progress instead until it does (see
 * use-local-catalog-ready.ts).
 */
export function hasLocalCatalog(sourceId: string, kind: CatalogKind): Promise<boolean> {
  return hasCompletedSync(sourceId, kind);
}
