import {
  XtreamClient,
  parseM3u,
  parseXmltvToArray,
  type Category,
  type Channel,
  type EpgProgramme,
  type PlaylistSource,
  type SeriesDetails,
  type SeriesEpisode,
} from "@core";
import { proxyFetch } from "./proxy-fetch.js";

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
 */
export async function loadChannelsByKind(source: PlaylistSource, kind: Channel["kind"]): Promise<Channel[]> {
  if (source.kind === "xtream") {
    const client = new XtreamClient(source, proxyFetch);
    await client.authenticate();
    if (kind === "live") return client.getLiveChannels();
    if (kind === "movie") return client.getVodStreams();
    return []; // series are fetched via loadSeriesList/loadSeriesDetails instead.
  }

  const content = source.kind === "m3u-file" ? source.content : await (await proxyFetch(source.url)).text();
  return parseM3u(content).filter((c) => c.kind === kind);
}

export async function loadSeriesList(source: PlaylistSource): ReturnType<XtreamClient["getSeriesList"]> {
  if (source.kind !== "xtream") return [];
  const client = new XtreamClient(source, proxyFetch);
  await client.authenticate();
  return client.getSeriesList();
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

export async function loadEpg(source: PlaylistSource): Promise<EpgProgramme[]> {
  const epgUrl = source.kind === "m3u-url" || source.kind === "m3u-file" ? source.epgUrl : undefined;
  if (source.kind === "xtream") {
    const base = source.baseUrl.endsWith("/") ? source.baseUrl.slice(0, -1) : source.baseUrl;
    const url = `${base}/xmltv.php?username=${encodeURIComponent(source.username)}&password=${encodeURIComponent(source.password)}`;
    const xml = await (await proxyFetch(url)).text();
    return parseXmltvToArray(xml);
  }
  if (!epgUrl) return [];
  const xml = await (await proxyFetch(epgUrl)).text();
  return parseXmltvToArray(xml);
}
