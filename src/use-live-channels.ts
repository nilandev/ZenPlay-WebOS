import { useEffect, useState } from "react";
import type { Channel, PlaylistSource } from "@core";
import { useCacheInvalidationStore } from "./cache-invalidation-store.js";
import { liveVersionKey, peekLiveChannels, readLiveChannels } from "./live-store.js";
import { syncSource } from "./sync/sync-manager.js";

const EMPTY_CHANNELS: Channel[] = [];

export interface LiveChannelsState {
  channels: Channel[];
  /** True only while there's no list to show at all (first sync still running, or it failed). */
  isInitialLoading: boolean;
  /** Set when the first sync failed — screens show a full error only when isInitialLoading is also true. */
  error: string | null;
}

/**
 * A source's live channel list from the local table (live-store.ts), for
 * Live TV, the Guide and My List. A source that has never synced its list
 * asks the sync manager for it (joining the launch sync if one is already
 * running) and shows loading until it lands; one that has a list shows it
 * straight away — keeping it fresh is the scheduler's job. Re-reads
 * whenever a sync for the source completes.
 */
export function useLiveChannels(source: PlaylistSource, options: { enabled?: boolean } = {}): LiveChannelsState {
  const { enabled = true } = options;
  const version = useCacheInvalidationStore((state) => state.versions[liveVersionKey(source.id)]);
  const [state, setState] = useState<LiveChannelsState>(() => {
    const known = peekLiveChannels(source.id);
    return { channels: known ?? EMPTY_CHANNELS, isInitialLoading: enabled && !known, error: null };
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const known = peekLiveChannels(source.id);
    setState({ channels: known ?? EMPTY_CHANNELS, isInitialLoading: !known, error: null });

    void readLiveChannels(source.id).then((channels) => {
      if (cancelled) return;
      if (channels) {
        setState({ channels, isInitialLoading: false, error: null });
        return;
      }
      // Never synced: build the list now. Success bumps liveVersionKey, which re-runs this effect and reads it.
      void syncSource(source, { trigger: "first-run", stages: ["live"] }).then((outcome) => {
        if (cancelled || outcome.stages.live === "synced") return;
        setState((prev) => ({ ...prev, error: outcome.errors.live ?? "Couldn't load channels." }));
      });
    });

    return () => {
      cancelled = true;
    };
  }, [source, enabled, version]);

  return state;
}
