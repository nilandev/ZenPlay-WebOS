import { XtreamClient, parseM3u, parseXmltvToArray, type Channel, type EpgProgramme, type PlaylistSource, type SeriesEpisode } from "@core";
import { proxyFetch } from "./proxy-fetch.js";

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
    return []; // series are fetched via loadSeriesList/loadSeriesEpisodes instead.
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

export async function loadSeriesEpisodes(source: PlaylistSource, seriesId: string): Promise<SeriesEpisode[]> {
  if (source.kind !== "xtream") return [];
  const client = new XtreamClient(source, proxyFetch);
  return client.getSeriesInfo(seriesId);
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
