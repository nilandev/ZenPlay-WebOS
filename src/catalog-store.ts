import type { Channel, SeriesInfo } from "@core";
import {
  countRecords,
  getRecordsByIds as getCatalogDbRecordsByIds,
  openCatalogDb,
  queryPage,
  type CatalogKind,
  type CatalogRecord,
} from "./core/storage/catalog-db.js";
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
  offset: number;
  limit: number;
}

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

function recordToSeriesSummary(record: CatalogRecord): Pick<SeriesInfo, "id" | "name" | "posterUrl" | "groupTitle"> {
  return {
    id: record.streamId,
    name: record.name,
    posterUrl: record.posterUrl,
    groupTitle: record.groupTitle,
  };
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
  const records = await queryPage(catalogDb, kind, toQueryOptions(sourceId, kind, query));
  return kind === "vod" ? records.map((r) => recordToChannel(r, "movie")) : records.map(recordToSeriesSummary);
}

/** Total matching record count for the same filter getCatalogPage uses — backs "no more pages" checks in use-catalog-page.ts without reading every row. */
export async function getCatalogCount(sourceId: string, kind: CatalogKind, query: Omit<CatalogPageQuery, "offset" | "limit"> = {}): Promise<number> {
  const catalogDb = await openCatalogDb();
  return countRecords(catalogDb, kind, {
    sourceId,
    categoryId: query.categoryId,
    namePrefixLower: query.namePrefix?.toLowerCase(),
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

/**
 * Whether this source+kind has a local catalog ready to read from at all —
 * screens use this to decide between the local paginated path and falling
 * back to content-loader.ts's direct fetch for a source that's never
 * completed a background sync yet (see catalog-sync.ts's doc comment).
 */
export function hasLocalCatalog(sourceId: string, kind: CatalogKind): Promise<boolean> {
  return hasCompletedSync(sourceId, kind);
}
