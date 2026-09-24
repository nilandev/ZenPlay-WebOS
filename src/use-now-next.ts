import { useEffect, useState } from "react";
import { ChannelGuide, type Channel, type EpgProgramme, type NowNext, type PlaylistSource } from "@core";
import { getCachedContent } from "./content-cache.js";
import { loadStreamEpg } from "./content-loader.js";

/** How long a channel's fetched guide is reused before asking the provider again. */
const GUIDE_TTL_MS = 10 * 60 * 1000;
/** How often "now" is re-evaluated, so the progress bar moves and a finished programme rolls over to the next. */
const TICK_MS = 30 * 1000;

const guideCache = new Map<string, { programmes: EpgProgramme[]; fetchedAt: number }>();

/** Test-only: forgets fetched guides. */
export function __resetNowNextCacheForTests(): void {
  guideCache.clear();
}

export interface NowNextState {
  nowNext: NowNext | null;
  isLoading: boolean;
}

/**
 * What's on now and next for one channel — the Live TV preview's info
 * panel. Pass the channel the preview is actually showing (already
 * debounced while the user scrolls), not every highlighted row, so this
 * makes at most one request per settled channel.
 *
 * Uses the bulk XMLTV guide if Program Guide has already cached one for this
 * source (never fetches it — it can be tens of MB), otherwise the provider's
 * per-channel short EPG (Xtream only). Returns null when there's no guide
 * data at all, which callers treat as "show the channel line only".
 */
export function useNowNext(source: PlaylistSource, channel: Channel | null): NowNextState {
  const [programmes, setProgrammes] = useState<EpgProgramme[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!channel) {
      setProgrammes(null);
      setIsLoading(false);
      return;
    }

    const key = `${source.id}:${channel.id}`;
    const cached = guideCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < GUIDE_TTL_MS) {
      setProgrammes(cached.programmes);
      setIsLoading(false);
      return;
    }

    const bulk = getCachedContent<EpgProgramme[]>(`guide-epg:${source.id}`);
    if (bulk && bulk.length > 0) {
      const epgId = channel.epgChannelId ?? channel.id;
      const forChannel = bulk.filter((p) => p.channelId === epgId);
      guideCache.set(key, { programmes: forChannel, fetchedAt: Date.now() });
      setProgrammes(forChannel);
      setIsLoading(false);
      return;
    }

    if (source.kind !== "xtream") {
      setProgrammes([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setProgrammes(null);
    setIsLoading(true);
    loadStreamEpg(source, channel.id)
      .then((result) => {
        guideCache.set(key, { programmes: result, fetchedAt: Date.now() });
        if (!cancelled) setProgrammes(result);
      })
      .catch(() => {
        if (!cancelled) setProgrammes([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source, channel]);

  if (!programmes || programmes.length === 0) return { nowNext: null, isLoading };
  const nowNext = new ChannelGuide(programmes).getNowNext(new Date(now));
  return { nowNext: nowNext.now || nowNext.next ? nowNext : null, isLoading };
}
