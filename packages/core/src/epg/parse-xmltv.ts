import type { EpgProgramme } from "../models/epg.js";

/**
 * XMLTV timestamps look like "20240115203000 +0000" or "20240115203000".
 * We parse them manually instead of via Date.parse, which does not
 * reliably understand this format across JS engines (notably older
 * WebKit builds on Tizen/webOS).
 */
export function parseXmltvTimestamp(raw: string): Date {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?$/.exec(raw.trim());
  if (!match) {
    throw new Error(`Invalid XMLTV timestamp: ${raw}`);
  }
  const [, year, month, day, hour, minute, second, offset] = match;
  const isoOffset = offset ? `${offset.slice(0, 3)}:${offset.slice(3)}` : "+00:00";
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}${isoOffset}`;
  return new Date(iso);
}

/**
 * Streaming XMLTV parser: scans for <programme>...</programme> blocks with a
 * regex-driven cursor rather than building a full DOM, since guide files
 * can exceed 50MB and DOMParser on constrained TV hardware chokes on that.
 * Not a general-purpose XML parser — it assumes well-formed, non-nested
 * <programme> elements, which matches every XMLTV generator in practice.
 */
export function* parseXmltv(xml: string): Generator<EpgProgramme> {
  const programmeRe = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
  const attrRe = /(\w[\w-]*)="([^"]*)"/g;
  const titleRe = /<title[^>]*>([\s\S]*?)<\/title>/;
  const descRe = /<desc[^>]*>([\s\S]*?)<\/desc>/;

  let match: RegExpExecArray | null;
  while ((match = programmeRe.exec(xml)) !== null) {
    const [, attrString, body] = match;
    attrRe.lastIndex = 0;
    const attrs: Record<string, string> = {};
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRe.exec(attrString)) !== null) {
      attrs[attrMatch[1]] = attrMatch[2];
    }

    if (!attrs.start || !attrs.stop || !attrs.channel) continue;

    const titleMatch = titleRe.exec(body);
    const descMatch = descRe.exec(body);

    yield {
      channelId: attrs.channel,
      title: decodeXmlEntities(titleMatch?.[1]?.trim() ?? "Untitled"),
      description: descMatch ? decodeXmlEntities(descMatch[1].trim()) : undefined,
      start: parseXmltvTimestamp(attrs.start),
      stop: parseXmltvTimestamp(attrs.stop),
    };
  }
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Convenience wrapper for callers that want a plain array instead of the generator. */
export function parseXmltvToArray(xml: string): EpgProgramme[] {
  return Array.from(parseXmltv(xml));
}
