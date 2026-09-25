import type { Channel, EpgProgramme, PlaylistSource } from "@core";
import { loadStreamEpg } from "./content-loader.js";
import { getLocalChannelProgrammes } from "./epg-store.js";

/** How long a channel's looked-up guide is reused before looking again. */
const GUIDE_TTL_MS = 10 * 60 * 1000;

const cache = new Map<string, { programmes: EpgProgramme[]; fetchedAt: number }>();
const inFlight = new Map<string, Promise<EpgProgramme[]>>();

const keyFor = (source: PlaylistSource, channel: Channel) => `${source.id}:${channel.id}`;

/** Test-only: forgets every looked-up guide. */
export function __resetEpgCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}

/** Drops one source's looked-up guides — epg-sync.ts calls this when a fresh guide lands, so the next lookup reads the new data. */
export function forgetSourceGuides(sourceId: string): void {
  const prefix = `${sourceId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/**
 * One channel's programmes if they were looked up recently, without any
 * I/O. Undefined when loadChannelGuide is needed.
 */
export function peekChannelGuide(source: PlaylistSource, channel: Channel): EpgProgramme[] | undefined {
  const cached = cache.get(keyFor(source, channel));
  if (cached && Date.now() - cached.fetchedAt < GUIDE_TTL_MS) return cached.programmes;
  return undefined;
}

/**
 * One channel's programmes, shared by Live TV's Now & Next panel and the
 * Program Guide grid. Looks in the local guide table first (filled by
 * epg-sync.ts from the source's XMLTV); when that has nothing for this
 * channel, Xtream sources fall back to the provider's per-channel short
 * EPG (the bulk XMLTV and get_short_epg can disagree — see
 * XtreamClient.getShortEpg). Deduped while in flight and cached for
 * GUIDE_TTL_MS. Never rejects — a failed lookup is "no guide".
 */
export function loadChannelGuide(source: PlaylistSource, channel: Channel): Promise<EpgProgramme[]> {
  const known = peekChannelGuide(source, channel);
  if (known) return Promise.resolve(known);

  const key = keyFor(source, channel);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = lookUp(source, channel)
    .catch(() => [] as EpgProgramme[])
    .then((programmes) => {
      cache.set(key, { programmes, fetchedAt: Date.now() });
      return programmes;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

async function lookUp(source: PlaylistSource, channel: Channel): Promise<EpgProgramme[]> {
  const local = await getLocalChannelProgrammes(source.id, channel.epgChannelId ?? channel.id);
  if (local && local.length > 0) return local;
  // M3U sources have no per-channel EPG request — the local guide is all there is.
  if (source.kind !== "xtream") return local ?? [];
  return loadStreamEpg(source, channel.id);
}
