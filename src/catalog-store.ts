import type { Channel, SeriesInfo } from "@core";
import { countRecords, openCatalogDb, queryPage, type CatalogKind, type CatalogRecord } from "./core/storage/catalog-db.js";
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

/**
 * Whether this source+kind has a local catalog ready to read from at all —
 * screens use this to decide between the local paginated path and falling
 * back to content-loader.ts's direct fetch for a source that's never
 * completed a background sync yet (see catalog-sync.ts's doc comment).
 */
export function hasLocalCatalog(sourceId: string, kind: CatalogKind): Promise<boolean> {
  return hasCompletedSync(sourceId, kind);
}
