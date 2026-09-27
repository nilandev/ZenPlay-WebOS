import type { Channel } from "../models/channel.js";
import { cleanTitle } from "../text/clean-title.js";

const ATTR_RE = /([a-zA-Z0-9_-]+)="([^"]*)"/g;

function parseAttributes(extinfLine: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let match: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((match = ATTR_RE.exec(extinfLine)) !== null) {
    attrs[match[1].toLowerCase()] = match[2];
  }
  return attrs;
}

/** The display name is whatever trails the last comma on an #EXTINF line. */
function parseDisplayName(extinfLine: string): string {
  const commaIndex = extinfLine.lastIndexOf(",");
  return commaIndex >= 0 ? extinfLine.slice(commaIndex + 1).trim() : "Unnamed";
}

function detectKind(url: string, groupTitle: string | undefined): Channel["kind"] {
  const haystack = `${url} ${groupTitle ?? ""}`.toLowerCase();
  if (haystack.includes("series") || /s\d{1,2}e\d{1,2}/i.test(haystack)) return "series";
  if (haystack.includes("movie") || haystack.includes("vod") || /\.(mp4|mkv)(\?|$)/.test(haystack)) {
    return "movie";
  }
  return "live";
}

/**
 * Parses M3U/M3U8 playlist text into channel entries.
 * Tolerant of malformed lines (missing attributes, stray whitespace, CRLF)
 * since real-world IPTV provider playlists are rarely spec-clean.
 */
export function parseM3u(content: string): Channel[] {
  const lines = content.split(/\r?\n/);
  const channels: Channel[] = [];
  let pendingExtinf: string | null = null;
  let autoId = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF")) {
      pendingExtinf = line;
      continue;
    }

    if (line.startsWith("#")) {
      // Other directives (#EXTM3U, #EXTGRP, #EXTVLCOPT, ...) are ignored for v1.
      continue;
    }

    // Any non-comment, non-empty line following an #EXTINF is the stream URL.
    if (pendingExtinf) {
      const attrs = parseAttributes(pendingExtinf);
      const name = cleanTitle(attrs["tvg-name"] || parseDisplayName(pendingExtinf));
      const groupTitle = attrs["group-title"];
      const parsedNumber = Number.parseInt(attrs["tvg-chno"] ?? "", 10);
      const channelNumber = Number.isInteger(parsedNumber) && parsedNumber > 0 ? parsedNumber : undefined;

      channels.push({
        id: attrs["tvg-id"] || `m3u-${autoId++}`,
        name,
        logoUrl: attrs["tvg-logo"],
        groupTitle,
        streamUrl: line,
        epgChannelId: attrs["tvg-id"] || undefined,
        kind: detectKind(line, groupTitle),
        ...(channelNumber ? { number: channelNumber } : {}),
      });

      pendingExtinf = null;
    }
  }

  return channels;
}
