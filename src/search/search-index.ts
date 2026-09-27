import type { Channel, SeriesInfo } from "@core";
import { recordToChannel, recordToSeriesSummary } from "../catalog-store.js";
import type { CatalogFilter } from "../content-policy.js";
import { getRecordsByIds, openCatalogDb, queryPage, type CatalogKind, type CatalogRecord } from "../core/storage/catalog-db.js";
import { findSearchCandidates } from "../core/storage/search-index-db.js";
import { foldCase, queryTokens, scoreTitle } from "./normalize.js";

/**
 * The query side of search (docs/global-search-plan.md, "Querying"): word
 * matches from the background index, merged with today's start-of-title
 * matches — which are always complete, so search works fully before (and
 * while) the index is built. Reads are a few short readonly transactions
 * with capped sizes, so a query stays quick during indexing or a sync.
 */

/** Rows read from the word index per query. */
const WORD_CANDIDATES = 500;
/** Rows read from the start-of-title index per query. */
const PREFIX_CANDIDATES = 100;
/** Score for a start-of-title match that the word rules don't cover (e.g. a query that includes a provider tag). */
const SCORE_RAW_PREFIX = 50;

type SeriesSummary = Pick<SeriesInfo, "id" | "name" | "posterUrl" | "groupTitle" | "genre">;

/**
 * Titles that read the same on screen. Providers often list one film,
 * series or channel several times under different ids (in several
 * categories, or as backup streams); browsing spreads those across
 * categories, but search would show them side by side as identical cards
 * — so each title appears once, as its best-ranked entry.
 */
function sameTitleKey(name: string): string {
  return foldCase(name).replace(/\s+/g, " ").trim();
}

function uniqueByTitle<T>(ranked: T[], nameOf: (entry: T) => string): T[] {
  const seen = new Set<string>();
  return ranked.filter((entry) => {
    const key = sameTitleKey(nameOf(entry));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface SearchCatalogOptions {
  limit: number;
  /** A Kids profile's filter (content-policy.ts); undefined for a standard profile. */
  filter?: CatalogFilter;
}

export interface SearchCatalogResult<T> {
  items: T[];
  /** More than `limit` matched. */
  hasMore: boolean;
  /** The best match's score (0 when nothing matched) — the Search screen orders its rows by it. */
  bestScore: number;
}

export function searchCatalog(sourceId: string, kind: "vod", query: string, options: SearchCatalogOptions): Promise<SearchCatalogResult<Channel>>;
export function searchCatalog(sourceId: string, kind: "series", query: string, options: SearchCatalogOptions): Promise<SearchCatalogResult<SeriesSummary>>;
export async function searchCatalog(sourceId: string, kind: CatalogKind, query: string, { limit, filter }: SearchCatalogOptions): Promise<SearchCatalogResult<unknown>> {
  const words = queryTokens(query);
  const rawPrefix = foldCase(query.trim());
  if (words.length === 0 && rawPrefix.length === 0) return { items: [], hasMore: false, bestScore: 0 };

  const catalogDb = await openCatalogDb();
  // The longest word is the most selective one to look up; the rest are checked by scoring.
  const lookup = words.reduce((longest, word) => (word.length > longest.length ? word : longest), "");
  const [candidateIds, prefixRecords] = await Promise.all([
    lookup ? findSearchCandidates(catalogDb, sourceId, kind, lookup, WORD_CANDIDATES) : Promise.resolve([]),
    queryPage(catalogDb, kind, { sourceId, namePrefixLower: query.trim().toLowerCase(), predicate: filter?.accepts, offset: 0, limit: PREFIX_CANDIDATES }),
  ]);

  const prefixIds = new Set(prefixRecords.map((record) => record.id));
  const missing = [...new Set(candidateIds)].filter((id) => !prefixIds.has(id));
  // A title removed since it was indexed simply isn't found here.
  const wordRecords = await getRecordsByIds(catalogDb, kind, missing);

  const scored: Array<{ record: CatalogRecord; score: number }> = [];
  for (const record of [...prefixRecords, ...wordRecords]) {
    if (filter && !filter.accepts(record)) continue;
    let score = scoreTitle(words, record.name);
    if (score === 0 && prefixIds.has(record.id)) score = SCORE_RAW_PREFIX;
    if (score > 0) scored.push({ record, score });
  }
  // Best match first; equally good ones newest first (record ids sort by stream id).
  scored.sort((a, b) => b.score - a.score || (a.record.id < b.record.id ? 1 : a.record.id > b.record.id ? -1 : 0));
  const unique = uniqueByTitle(scored, ({ record }) => record.name);

  const top = unique.slice(0, limit).map(({ record }) => (kind === "vod" ? recordToChannel(record, "movie") : recordToSeriesSummary(record)));
  return { items: top, hasMore: unique.length > limit, bestScore: unique[0]?.score ?? 0 };
}

/**
 * Live channels matching `query`, from the channel list the caller already
 * holds (Kids-filtered, numbered): word matches via the index, plus a
 * starts-with match on the list itself, which is complete before the
 * channels are indexed. Best match first; equally good ones in channel
 * order. A channel listed twice (the same id, or the same name) appears once.
 */
export async function searchChannels(sourceId: string, channels: Channel[], query: string, { limit }: { limit: number }): Promise<SearchCatalogResult<Channel>> {
  const words = queryTokens(query);
  const rawPrefix = query.trim().toLowerCase();
  if (channels.length === 0 || (words.length === 0 && rawPrefix.length === 0)) return { items: [], hasMore: false, bestScore: 0 };

  const lookup = words.reduce((longest, word) => (word.length > longest.length ? word : longest), "");
  const candidateIds = new Set(lookup ? await findSearchCandidates(await openCatalogDb(), sourceId, "live", lookup, WORD_CANDIDATES) : []);

  const scored: Array<{ channel: Channel; order: number; score: number }> = [];
  const seen = new Set<string>();
  channels.forEach((channel, order) => {
    if (seen.has(channel.id)) return;
    const byPrefix = channel.name.toLowerCase().startsWith(rawPrefix);
    if (!byPrefix && !candidateIds.has(channel.id)) return;
    let score = scoreTitle(words, channel.name);
    if (score === 0 && byPrefix) score = SCORE_RAW_PREFIX;
    if (score === 0) return;
    seen.add(channel.id);
    scored.push({ channel, order, score });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  const unique = uniqueByTitle(scored, ({ channel }) => channel.name);
  return { items: unique.slice(0, limit).map((entry) => entry.channel), hasMore: unique.length > limit, bestScore: unique[0]?.score ?? 0 };
}
