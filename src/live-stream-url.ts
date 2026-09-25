import { liveStreamFormatOf, withLiveStreamFormat, type Channel, type LiveStreamFormat } from "@core";
import { loadSettings } from "./settings-store.js";

export const LIVE_STREAM_FORMAT_LABELS: Record<LiveStreamFormat, string> = { m3u8: "HLS", ts: "MPEG-TS" };

/**
 * The URL to play a live channel with, in the Live Stream Format chosen in
 * App Settings. Stored channel URLs are always HLS (see mapLiveStream), so
 * the format is applied at play time — changing the setting needs no
 * re-download. Anything that isn't an Xtream live URL (M3U entries) plays
 * as it is.
 */
export function liveStreamUrl(channel: Pick<Channel, "streamUrl">, format: LiveStreamFormat = loadSettings().liveStreamFormat): string {
  return withLiveStreamFormat(channel.streamUrl, format) ?? channel.streamUrl;
}

/** The same Xtream live stream in the other format — what the player offers when one fails. undefined when there's no alternative. */
export function alternateLiveStream(url: string): { url: string; format: LiveStreamFormat; label: string } | undefined {
  const current = liveStreamFormatOf(url);
  if (!current) return undefined;
  const format: LiveStreamFormat = current === "m3u8" ? "ts" : "m3u8";
  const alternate = withLiveStreamFormat(url, format);
  return alternate ? { url: alternate, format, label: LIVE_STREAM_FORMAT_LABELS[format] } : undefined;
}
