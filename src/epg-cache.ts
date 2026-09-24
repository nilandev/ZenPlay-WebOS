import type { Channel, EpgProgramme, PlaylistSource } from "@core";
import { getCachedContent } from "./content-cache.js";
import { loadStreamEpg } from "./content-loader.js";

/** How long a channel's fetched guide is reused before asking the provider again. */
const GUIDE_TTL_MS = 10 * 60 * 1000;

const cache = new Map<string, { programmes: EpgProgramme[]; fetchedAt: number }>();
const inFlight = new Map<string, Promise<EpgProgramme[]>>();

const keyFor = (source: PlaylistSource, channel: Channel) => `${source.id}:${channel.id}`;

/** Test-only: forgets every fetched guide. */
export function __resetEpgCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}

/**
 * One channel's programmes from what's already in hand — a fresh cached
 * fetch, or the bulk XMLTV guide if one is cached for this source — without
 * making a request. Undefined when a fetch would be needed.
 */
export function peekChannelGuide(source: PlaylistSource, channel: Channel): EpgProgramme[] | undefined {
  const cached = cache.get(keyFor(source, channel));
  if (cached && Date.now() - cached.fetchedAt < GUIDE_TTL_MS) return cached.programmes;

  const bulk = getCachedContent<EpgProgramme[]>(`guide-epg:${source.id}`);
  if (bulk && bulk.length > 0) {
    const epgId = channel.epgChannelId ?? channel.id;
    const forChannel = bulk.filter((p) => p.channelId === epgId);
    cache.set(keyFor(source, channel), { programmes: forChannel, fetchedAt: Date.now() });
    return forChannel;
  }

  // M3U sources have no per-channel EPG request — without a bulk guide there's nothing to fetch.
  if (source.kind !== "xtream") return [];
  return undefined;
}

/**
 * One channel's programmes, shared by Live TV's Now & Next panel and the
 * Program Guide grid: peekChannelGuide if possible, otherwise the
 * provider's per-channel short EPG (Xtream), deduped while in flight and
 * cached for GUIDE_TTL_MS. Never rejects — a failed lookup is "no guide".
 */
export function loadChannelGuide(source: PlaylistSource, channel: Channel): Promise<EpgProgramme[]> {
  const known = peekChannelGuide(source, channel);
  if (known) return Promise.resolve(known);

  const key = keyFor(source, channel);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = loadStreamEpg(source, channel.id)
    .catch(() => [] as EpgProgramme[])
    .then((programmes) => {
      cache.set(key, { programmes, fetchedAt: Date.now() });
      return programmes;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}
