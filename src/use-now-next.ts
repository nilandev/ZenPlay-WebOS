import { useEffect, useState } from "react";
import { ChannelGuide, type Channel, type EpgProgramme, type NowNext, type PlaylistSource } from "@core";
import { __resetEpgCacheForTests, loadChannelGuide, peekChannelGuide } from "./epg-cache.js";

/** How often "now" is re-evaluated, so the progress bar moves and a finished programme rolls over to the next. */
const TICK_MS = 30 * 1000;

/** Test-only: forgets fetched guides (they live in epg-cache.ts, shared with the Program Guide). */
export function __resetNowNextCacheForTests(): void {
  __resetEpgCacheForTests();
}

export interface NowNextState {
  nowNext: NowNext | null;
  isLoading: boolean;
}

/**
 * What's on now and next for one channel — the Live TV preview's info
 * panel. Pass the channel the preview is actually showing (already
 * debounced while the user scrolls), not every highlighted row, so this
 * makes at most one request per settled channel. Guides come from
 * epg-cache.ts, shared with the Program Guide grid.
 *
 * Returns null when there's no guide data at all, which callers treat as
 * "show the channel line only".
 */
export function useNowNext(source: PlaylistSource | null, channel: Channel | null): NowNextState {
  const [programmes, setProgrammes] = useState<EpgProgramme[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!source || !channel) {
      setProgrammes(null);
      setIsLoading(false);
      return;
    }
    const known = peekChannelGuide(source, channel);
    if (known) {
      setProgrammes(known);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setProgrammes(null);
    setIsLoading(true);
    loadChannelGuide(source, channel).then((result) => {
      if (cancelled) return;
      setProgrammes(result);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [source, channel]);

  if (!programmes || programmes.length === 0) return { nowNext: null, isLoading };
  const nowNext = new ChannelGuide(programmes).getNowNext(new Date(now));
  return { nowNext: nowNext.now || nowNext.next ? nowNext : null, isLoading };
}
