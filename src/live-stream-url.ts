import { liveStreamFormatOf, withLiveStreamFormat, type Channel, type LiveStreamFormat } from "@core";
import { loadSettings } from "./settings-store.js";

export const LIVE_STREAM_FORMAT_LABELS: Record<LiveStreamFormat, string> = { m3u8: "HLS", ts: "MPEG-TS" };

const WORKING_FORMAT_KEY = "iptv.live-format-by-source.v1";

function readWorkingFormats(): Record<string, LiveStreamFormat> {
  try {
    const raw = localStorage.getItem(WORKING_FORMAT_KEY);
    return raw ? (JSON.parse(raw) as Record<string, LiveStreamFormat>) : {};
  } catch {
    return {};
  }
}

function writeWorkingFormats(formats: Record<string, LiveStreamFormat>): void {
  try {
    localStorage.setItem(WORKING_FORMAT_KEY, JSON.stringify(formats));
  } catch {
    // Storage full or unavailable — Auto just starts from HLS again next time.
  }
}

/**
 * The format a playlist's live channels last started in. A panel's HLS
 * output tends to work for all of its channels or none, so Auto starts the
 * next channel in this format and channel changes play on the first try.
 */
export function workingLiveStreamFormat(sourceId: string): LiveStreamFormat | undefined {
  const format = readWorkingFormats()[sourceId];
  return format === "m3u8" || format === "ts" ? format : undefined;
}

export function rememberWorkingLiveStreamFormat(sourceId: string, format: LiveStreamFormat): void {
  const formats = readWorkingFormats();
  if (formats[sourceId] === format) return;
  writeWorkingFormats({ ...formats, [sourceId]: format });
}

/** The playlist is being removed. */
export function forgetWorkingLiveStreamFormat(sourceId: string): void {
  const formats = readWorkingFormats();
  if (!(sourceId in formats)) return;
  delete formats[sourceId];
  writeWorkingFormats(formats);
}

/**
 * The URL to start a live channel with. Stored channel URLs are always HLS
 * (see mapLiveStream), so the format is applied at play time: on Auto, the
 * one that last worked for this playlist (HLS until something has played);
 * otherwise the fixed format from App Settings. Anything that isn't an
 * Xtream live URL (M3U entries) plays as it is.
 */
export function liveStreamUrl(channel: Pick<Channel, "streamUrl">, sourceId: string): string {
  const setting = loadSettings().liveStreamFormat;
  const format = setting === "auto" ? (workingLiveStreamFormat(sourceId) ?? "m3u8") : setting;
  return withLiveStreamFormat(channel.streamUrl, format) ?? channel.streamUrl;
}

/** The same Xtream live stream in the other format — what Auto switches to when one fails. undefined when there's no alternative. */
export function alternateLiveStream(url: string): { url: string; format: LiveStreamFormat; label: string } | undefined {
  const current = liveStreamFormatOf(url);
  if (!current) return undefined;
  const format: LiveStreamFormat = current === "m3u8" ? "ts" : "m3u8";
  const alternate = withLiveStreamFormat(url, format);
  return alternate ? { url: alternate, format, label: LIVE_STREAM_FORMAT_LABELS[format] } : undefined;
}
