import { useEffect, useMemo, useRef, useState } from "react";
import type { Channel, EpgProgramme, PlaylistSource } from "@core";
import { loadChannelGuide, peekChannelGuide } from "./epg-cache.js";

/** Parallel per-channel guide requests — enough to fill a screen quickly without flooding the provider. */
const CONCURRENCY = 4;
/** Results landing within this window are applied together, so the grid rebuilds once per batch, not once per channel. */
const FLUSH_MS = 60;

/**
 * Guides for the channels the Program Guide grid is currently showing.
 * Returns programmes per channel id; a channel missing from the map is
 * still loading. Anything already known (fetched earlier, or in a cached
 * bulk XMLTV guide) is filled in immediately; the rest is fetched a few at
 * a time via epg-cache.ts, which also dedupes and caches for Live TV.
 *
 * `bulkVersion` should change when a bulk guide for the source finishes
 * loading, so channels resolved to "no data" before it arrived are looked
 * up again.
 */
export function useGuideProgrammes(source: PlaylistSource, channels: Channel[], bulkVersion: unknown): Map<string, EpgProgramme[]> {
  const knownRef = useRef(new Map<string, EpgProgramme[]>());
  const [version, setVersion] = useState(0);

  useEffect(() => {
    knownRef.current = new Map();
    setVersion((v) => v + 1);
  }, [source, bulkVersion]);

  useEffect(() => {
    let cancelled = false;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleFlush = () => {
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        if (!cancelled) setVersion((v) => v + 1);
      }, FLUSH_MS);
    };

    const known = knownRef.current;
    let changed = false;
    const toFetch: Channel[] = [];
    for (const channel of channels) {
      if (known.has(channel.id)) continue;
      const peeked = peekChannelGuide(source, channel);
      if (peeked) {
        known.set(channel.id, peeked);
        changed = true;
      } else {
        toFetch.push(channel);
      }
    }
    if (changed) setVersion((v) => v + 1);

    let next = 0;
    const worker = async (): Promise<void> => {
      while (!cancelled && next < toFetch.length) {
        const channel = toFetch[next++];
        const programmes = await loadChannelGuide(source, channel);
        if (cancelled) return;
        known.set(channel.id, programmes);
        scheduleFlush();
      }
    };
    for (let i = 0; i < CONCURRENCY; i++) void worker();

    return () => {
      cancelled = true;
      if (flushTimer) clearTimeout(flushTimer);
    };
    // bulkVersion: the reset effect above just emptied knownRef, so look everything up again.
  }, [source, channels, bulkVersion]);

  // A fresh Map per batch so memoised consumers see the change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => new Map(knownRef.current), [version]);
}
