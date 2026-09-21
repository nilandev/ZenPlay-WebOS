import type { Channel, SeriesInfo } from "../models/channel.js";
import type { XtreamCredentials } from "../models/playlist-source.js";

/**
 * Pure reshape functions for player_api.php's raw JSON shapes into this
 * app's Channel/SeriesInfo types — extracted out of XtreamClient so
 * catalog-worker-client.ts's Web Worker (see workers/catalog-fetch-worker.ts)
 * can apply the exact same mapping to a payload it fetched and parsed off
 * the main thread, without duplicating (and risking drift from) the logic
 * XtreamClient itself uses for callers that don't go through the worker
 * (e.g. live channels, which aren't large enough to be worth offloading —
 * see catalog-worker-client.ts's doc comment).
 */

export interface XtreamLiveStreamRaw {
  stream_id: number;
  name: string;
  stream_icon?: string;
  category_id?: string;
  epg_channel_id?: string;
  tv_archive?: number;
  tv_archive_duration?: number;
}

export interface XtreamVodStreamRaw {
  stream_id: number;
  name: string;
  stream_icon?: string;
  category_id?: string;
  container_extension?: string;
}

export interface XtreamSeriesRaw {
  series_id: number;
  name: string;
  cover?: string;
  category_id?: string;
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/** Same URL shape XtreamClient.buildStreamUrl builds — a plain function of the credentials rather than a method, so the worker (which never holds an XtreamClient instance) can build identical URLs from the credentials postMessage'd to it. */
export function buildXtreamStreamUrl(
  credentials: Pick<XtreamCredentials, "baseUrl" | "username" | "password">,
  kind: "live" | "movie" | "series",
  streamId: number,
  extension: string,
): string {
  const base = stripTrailingSlash(credentials.baseUrl);
  return `${base}/${kind}/${credentials.username}/${credentials.password}/${streamId}.${extension}`;
}

export function mapLiveStream(credentials: Pick<XtreamCredentials, "baseUrl" | "username" | "password">, s: XtreamLiveStreamRaw): Channel {
  return {
    id: String(s.stream_id),
    name: s.name,
    logoUrl: s.stream_icon,
    groupTitle: s.category_id,
    epgChannelId: s.epg_channel_id,
    streamUrl: buildXtreamStreamUrl(credentials, "live", s.stream_id, "m3u8"),
    kind: "live",
    hasArchive: s.tv_archive === 1,
    archiveDurationDays: s.tv_archive_duration,
  };
}

/**
 * VOD list items deliberately carry only what the browse grid needs
 * (id/name/artwork/category/playback URL) — no hasArchive/
 * archiveDurationDays, which only live channels ever populate (catch-up is
 * a live-TV concept). This is already the full extent of the "slim list
 * item" trim worth doing here: SeriesInfo/SeriesDetails already separate
 * list vs. detail metadata the same way (see loadSeriesList vs.
 * loadSeriesDetails in content-loader.ts).
 */
export function mapVodStream(credentials: Pick<XtreamCredentials, "baseUrl" | "username" | "password">, s: XtreamVodStreamRaw): Channel {
  return {
    id: String(s.stream_id),
    name: s.name,
    logoUrl: s.stream_icon,
    groupTitle: s.category_id,
    streamUrl: buildXtreamStreamUrl(credentials, "movie", s.stream_id, s.container_extension || "mp4"),
    kind: "movie",
  };
}

export function mapSeriesEntry(s: XtreamSeriesRaw): Pick<SeriesInfo, "id" | "name" | "posterUrl" | "groupTitle"> {
  return {
    id: String(s.series_id),
    name: s.name,
    posterUrl: s.cover,
    groupTitle: s.category_id,
  };
}
