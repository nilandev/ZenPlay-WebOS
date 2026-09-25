import {
  XtreamClient,
  parseM3u,
  parseXmltvToArray,
  type Category,
  type Channel,
  type EpgProgramme,
  type MovieDetails,
  type PlaylistSource,
  type SeriesDetails,
  type SeriesEpisode,
} from "@core";
import { proxyDownloadFetch, proxyFetch } from "./proxy-fetch.js";
import { createCatalogWorkerClient } from "./workers/catalog-worker-client.js";

/**
 * One catalog worker, reused across every VOD/series fetch this tab session
 * makes — see catalog-worker-client.ts's doc comment for why the worker
 * itself is a lazily-created singleton rather than one per call.
 */
const catalogWorker = createCatalogWorkerClient();

export interface PlaylistInfo {
  name: string;
  /** null for an unlimited/no-expiry account, or for source kinds (M3U) that don't expose expiry at all. */
  expiresAt: Date | null;
}

/** Playlist name + expiry for the home screen footer. Only Xtream sources expose expiry via the provider API. */
export async function loadPlaylistInfo(source: PlaylistSource): Promise<PlaylistInfo> {
  if (source.kind !== "xtream") return { name: source.name, expiresAt: null };
  const client = new XtreamClient(source, proxyFetch);
  const { expiresAt } = await client.getAccountInfo();
  return { name: source.name, expiresAt };
}

/**
 * Xtream credentials give us live/VOD/series streams directly from the
 * provider API. M3U sources are a flat channel list with no separate
 * VOD/series split from the API — v1 relies on parseM3u's kind detection
 * (see src/core/m3u/parse-m3u.ts) to bucket entries.
 *
 * `categoryId`, when given, is passed straight through to Xtream's
 * server-side category filter (see XtreamClient.getLiveChannels/
 * getVodStreams) so a screen showing just one category's grid doesn't need
 * to fetch and then filter the entire catalog — see VodScreen's per-category
 * cache key. M3U sources have no server-side category filter, so this is
 * applied client-side there instead, over the same groupTitle field the
 * screens already group by.
 *
 * VOD (potentially tens of thousands of entries, 10MB+ of JSON) is fetched
 * and parsed inside a Web Worker (see workers/catalog-fetch-worker.ts)
 * rather than on the main thread — live channels stay on the direct
 * XtreamClient path since they're not large enough to be worth the
 * postMessage/structured-clone overhead. authenticate() still runs first on
 * the main thread (cheap, and deduped against other concurrent calls via
 * XtreamClient's own request cache — see its doc comment) purely so a bad
 * login surfaces as the familiar XtreamAuthError rather than a generic
 * fetch failure from inside the worker.
 */
export async function loadChannelsByKind(source: PlaylistSource, kind: Channel["kind"], categoryId?: string): Promise<Channel[]> {
  if (source.kind === "xtream") {
    // The full live list can run to several MB, so it gets the long download deadline.
    const client = new XtreamClient(source, proxyDownloadFetch);
    await client.authenticate();
    if (kind === "live") return client.getLiveChannels(categoryId);
    if (kind === "movie") {
      return catalogWorker.fetchCatalog({ credentials: source, action: "get_vod_streams", categoryId }) as Promise<Channel[]>;
    }
    return []; // series are fetched via loadSeriesList/loadSeriesDetails instead.
  }

  const content = source.kind === "m3u-file" ? source.content : await (await proxyDownloadFetch(source.url)).text();
  const channels = parseM3u(content).filter((c) => c.kind === kind);
  return categoryId ? channels.filter((c) => c.groupTitle === categoryId) : channels;
}

export async function loadSeriesList(source: PlaylistSource, categoryId?: string): ReturnType<XtreamClient["getSeriesList"]> {
  if (source.kind !== "xtream") return [];
  const client = new XtreamClient(source, proxyFetch);
  await client.authenticate();
  return catalogWorker.fetchCatalog({ credentials: source, action: "get_series", categoryId }) as ReturnType<XtreamClient["getSeriesList"]>;
}

/** Series categories for the browse grid's category filter — M3U sources have no separate category API, so this is Xtream-only like loadSeriesList. */
export async function loadSeriesCategories(source: PlaylistSource): Promise<Category[]> {
  if (source.kind !== "xtream") return [];
  const client = new XtreamClient(source, proxyFetch);
  await client.authenticate();
  return client.getSeriesCategories();
}

/** VOD categories for the movies browse grid's category filter — M3U sources have no separate category API, so this is Xtream-only like loadChannelsByKind. */
export async function loadVodCategories(source: PlaylistSource): Promise<Category[]> {
  if (source.kind !== "xtream") return [];
  const client = new XtreamClient(source, proxyFetch);
  await client.authenticate();
  return client.getVodCategories();
}

/** Live categories for the Live TV screen's category sidebar — M3U sources have no separate category API, so callers group client-side by Channel.groupTitle instead (see GuideScreen's groupChannelsByCategory). */
export async function loadLiveCategories(source: PlaylistSource): Promise<Category[]> {
  if (source.kind !== "xtream") return [];
  const client = new XtreamClient(source, proxyFetch);
  await client.authenticate();
  return client.getLiveCategories();
}

export interface SeriesDetailsResult {
  details: SeriesDetails;
  episodes: SeriesEpisode[];
}

const EMPTY_SERIES_DETAILS: SeriesDetailsResult = { details: {}, episodes: [] };

/**
 * Episodes plus series-level metadata (plot/cast/genre/rating/backdrop) for
 * the detail hero. `details` comes back empty (never undefined) when the
 * source isn't Xtream, or when a provider's get_series_info response omits
 * its `info` block entirely (seen on some panels for older/less-maintained
 * titles) — callers fall back to the browse-grid summary (name/poster) they
 * already have from loadSeriesList rather than showing a blank hero.
 */
export async function loadSeriesDetails(source: PlaylistSource, seriesId: string): Promise<SeriesDetailsResult> {
  if (source.kind !== "xtream") return EMPTY_SERIES_DETAILS;
  const client = new XtreamClient(source, proxyFetch);
  return client.getSeriesDetails(seriesId);
}

const movieDetailsCache = new Map<string, Promise<MovieDetails>>();

/** A film's plot/rating/year/backdrop for the player — Xtream only, cached per source+film for the session; {} on failure. */
export function loadMovieDetails(source: PlaylistSource, movieId: string): Promise<MovieDetails> {
  if (source.kind !== "xtream") return Promise.resolve({});
  const key = `${source.id}:${movieId}`;
  let pending = movieDetailsCache.get(key);
  if (!pending) {
    pending = new XtreamClient(source, proxyFetch).getVodDetails(movieId).catch(() => {
      movieDetailsCache.delete(key); // don't pin a failure for the whole session
      return {};
    });
    movieDetailsCache.set(key, pending);
  }
  return pending;
}

export async function loadEpg(source: PlaylistSource): Promise<EpgProgramme[]> {
  const epgUrl = source.kind === "m3u-url" || source.kind === "m3u-file" ? source.epgUrl : undefined;
  if (source.kind === "xtream") {
    const base = source.baseUrl.endsWith("/") ? source.baseUrl.slice(0, -1) : source.baseUrl;
    const url = `${base}/xmltv.php?username=${encodeURIComponent(source.username)}&password=${encodeURIComponent(source.password)}`;
    const xml = await (await proxyDownloadFetch(url)).text();
    return parseXmltvToArray(xml);
  }
  if (!epgUrl) return [];
  const xml = await (await proxyDownloadFetch(epgUrl)).text();
  return parseXmltvToArray(xml);
}

/**
 * Per-channel EPG for the redesigned Guide screen's column 3 — Xtream's
 * get_epg&stream_id=X, one call per highlighted channel rather than the
 * bulk xmltv.php export loadEpg fetches (see XtreamClient.getShortEpg's
 * doc comment for why the two can disagree). M3U sources have no
 * per-stream EPG action, so this always returns [] there — callers should
 * fall back to loadEpg's bulk XMLTV result (keyed by
 * channel.epgChannelId) for M3U, same as GuideScreen already did before
 * this screen existed.
 */
export async function loadStreamEpg(source: PlaylistSource, streamId: string): Promise<EpgProgramme[]> {
  if (source.kind !== "xtream") return [];
  const client = new XtreamClient(source, proxyFetch);
  await client.authenticate();
  return client.getShortEpg(streamId);
}
