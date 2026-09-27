import type { Channel, SeriesInfo } from "../models/channel.js";
import type { EpgProgramme } from "../models/epg.js";
import type { XtreamCredentials } from "../models/playlist-source.js";
import { cleanTitle } from "../text/clean-title.js";

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
  /** Provider channel number. Some panels send it as a string, some omit it. */
  num?: number | string;
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
  /** Comma-separated on most panels ("Animation, Family"); often empty. */
  genre?: string | null;
}

export interface XtreamEpgListingRaw {
  channel_id: string;
  /** Unix seconds — used over the string `start`/`end` fields since those are the provider's local time with no offset, ambiguous to parse portably. */
  start_timestamp: number;
  stop_timestamp: number;
  /** Base64-encoded (Xtream Codes convention for get_epg/get_short_epg — see XtreamClient.getShortEpg's doc comment). */
  title: string;
  /** Base64-encoded, same as title. */
  description?: string;
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/** Same URL shape XtreamClient.buildStreamUrl builds — a plain function of the credentials rather than a method, so the worker (which never holds an XtreamClient instance) can build identical URLs from the credentials postMessage'd to it. */
/** The two containers an Xtream panel can serve a live channel in (its `allowed_output_formats`). */
export type LiveStreamFormat = "m3u8" | "ts";

const XTREAM_LIVE_URL_RE = /^(.*\/live\/[^/]+\/[^/]+\/[^/?#]+)\.(m3u8|ts)([?#].*)?$/i;

/**
 * The same Xtream live channel in the other container: `/live/u/p/42.m3u8`
 * (HLS) ↔ `/live/u/p/42.ts` (a continuous MPEG-TS stream). Panels serve
 * both from the same id; which one plays better depends on the panel and
 * the TV. Returns undefined for anything that isn't an Xtream live URL (an
 * M3U entry, a catch-up/timeshift URL, a film), which has no alternative.
 */
export function withLiveStreamFormat(url: string, format: LiveStreamFormat): string | undefined {
  const match = XTREAM_LIVE_URL_RE.exec(url);
  if (!match) return undefined;
  return `${match[1]}.${format}${match[3] ?? ""}`;
}

/** Which container an Xtream live URL uses, or undefined when it isn't one. */
export function liveStreamFormatOf(url: string): LiveStreamFormat | undefined {
  const extension = XTREAM_LIVE_URL_RE.exec(url)?.[2]?.toLowerCase();
  return extension === "m3u8" || extension === "ts" ? extension : undefined;
}

export function buildXtreamStreamUrl(
  credentials: Pick<XtreamCredentials, "baseUrl" | "username" | "password">,
  kind: "live" | "movie" | "series",
  streamId: number,
  extension: string,
): string {
  const base = stripTrailingSlash(credentials.baseUrl);
  return `${base}/${kind}/${credentials.username}/${credentials.password}/${streamId}.${extension}`;
}

/** A positive integer channel number, or undefined for a missing/garbage value. */
export function parseChannelNumber(raw: number | string | undefined): number | undefined {
  const value = typeof raw === "string" ? Number.parseInt(raw, 10) : raw;
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : undefined;
}

export function mapLiveStream(credentials: Pick<XtreamCredentials, "baseUrl" | "username" | "password">, s: XtreamLiveStreamRaw): Channel {
  return {
    id: String(s.stream_id),
    name: cleanTitle(s.name),
    logoUrl: s.stream_icon,
    groupTitle: s.category_id,
    epgChannelId: s.epg_channel_id,
    streamUrl: buildXtreamStreamUrl(credentials, "live", s.stream_id, "m3u8"),
    kind: "live",
    hasArchive: s.tv_archive === 1,
    archiveDurationDays: s.tv_archive_duration,
    number: parseChannelNumber(s.num),
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
    name: cleanTitle(s.name),
    logoUrl: s.stream_icon,
    groupTitle: s.category_id,
    streamUrl: buildXtreamStreamUrl(credentials, "movie", s.stream_id, s.container_extension || "mp4"),
    kind: "movie",
  };
}

export function mapSeriesEntry(s: XtreamSeriesRaw): Pick<SeriesInfo, "id" | "name" | "posterUrl" | "groupTitle" | "genre"> {
  const genre = typeof s.genre === "string" ? s.genre.trim() : "";
  return {
    id: String(s.series_id),
    name: cleanTitle(s.name),
    posterUrl: s.cover,
    groupTitle: s.category_id,
    ...(genre ? { genre } : {}),
  };
}

/**
 * Xtream's get_epg/get_short_epg base64-encodes title/description — atob
 * handles the ASCII-range payloads these listings actually contain; a
 * malformed/non-base64 value (seen on a few misbehaving panels) falls back
 * to the raw string rather than throwing, so one bad listing doesn't blank
 * out an entire channel's guide.
 */
function decodeEpgText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return atob(value);
  } catch {
    return value;
  }
}

/** Maps one get_epg/get_short_epg listing into the app's shared EpgProgramme shape — the same type parse-xmltv.ts produces, so callers (EpgGrid, the Guide screen) don't need to know which source an EpgProgramme came from. */
export function mapEpgListing(raw: XtreamEpgListingRaw): EpgProgramme {
  return {
    channelId: raw.channel_id,
    title: decodeEpgText(raw.title) ?? "",
    description: decodeEpgText(raw.description),
    start: new Date(raw.start_timestamp * 1000),
    stop: new Date(raw.stop_timestamp * 1000),
  };
}
