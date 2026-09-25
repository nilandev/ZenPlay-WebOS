import { useCallback, useEffect, useMemo, useState } from "react";
import { getDefaultKidsRules, type Category, type Channel, type EpgProgramme, type PlaylistSource } from "@core";
import { useCacheInvalidationStore } from "./cache-invalidation-store.js";
import { withChannelNumbers } from "./channel-lineup.js";
import { loadLiveCategories } from "./content-loader.js";
import type { ContentPolicy } from "./content-policy.js";
import { getLocalChannelProgrammes, epgVersionKey } from "./epg-store.js";
import { useCachedContent } from "./use-cached-content.js";
import { useLiveChannels } from "./use-live-channels.js";

const EMPTY_CATEGORIES: Category[] = [];
const EMPTY_IDS: ReadonlySet<string> = new Set();
/** Re-check at least this often even with no programme boundary coming up (e.g. a guide that just landed). */
const MAX_RECHECK_MS = 60_000;
/** Guides read in parallel at once — keeps a large allowed list from queueing hundreds of IndexedDB reads together. */
const READ_CONCURRENCY = 16;

export interface PolicyLiveChannelsState {
  /** The channels this profile may see right now, numbered as in the full list. */
  channels: Channel[];
  /** Provider categories (Xtream) that hold at least one of those channels; empty for M3U (group the channels instead). */
  fetchedCategories: Category[];
  isInitialLoading: boolean;
  isCategoriesLoading: boolean;
  error: string | null;
  /** Channels hidden right now because what's on is mature (Kids only). */
  matureNowIds: ReadonlySet<string>;
}

/**
 * Live channels through the content policy — what Live TV, the Guide and
 * My List show (docs/kids-profile.md §6). A standard profile gets the list
 * untouched. A Kids profile gets only allowed channels, numbered from the
 * full list first so they keep the provider's numbers, minus any channel
 * whose current programme is mature (§3.6).
 */
export function usePolicyLiveChannels(source: PlaylistSource, policy: ContentPolicy, options: { enabled?: boolean } = {}): PolicyLiveChannelsState {
  const { channels: allChannels, isInitialLoading, error } = useLiveChannels(source, options);

  const loadCategories = useCallback(() => loadLiveCategories(source), [source]);
  const { data: allCategories, isInitialLoading: isCategoriesLoading } = useCachedContent(
    `live-categories:${source.id}`,
    "category",
    loadCategories,
    EMPTY_CATEGORIES,
    { enabled: options.enabled ?? true },
  );

  const allowed = useMemo(() => {
    if (!policy.isKids) return allChannels;
    return policy.filterLiveChannels(withChannelNumbers(allChannels), allCategories);
  }, [policy, allChannels, allCategories]);

  const matureNowIds = useMatureNowChannelIds(source.id, allowed, policy.isKids);

  const channels = useMemo(() => (matureNowIds.size === 0 ? allowed : allowed.filter((c) => !matureNowIds.has(c.id))), [allowed, matureNowIds]);
  const fetchedCategories = useMemo(() => {
    if (!policy.isKids) return allCategories;
    const used = new Set(channels.map((c) => c.groupTitle));
    return allCategories.filter((category) => used.has(category.id));
  }, [policy.isKids, allCategories, channels]);

  return { channels, fetchedCategories, isInitialLoading, isCategoriesLoading, error, matureNowIds };
}

/**
 * The ids of `channels` whose current programme is mature (a mature
 * keyword in its title, description or categories, or an adult rating) —
 * docs/kids-profile.md §3.6. Reads only the local guide table (no
 * per-channel network requests), re-reads when a guide sync lands, and
 * re-evaluates at each programme boundary so a channel comes back as soon
 * as its next programme starts. A channel with no guide data is never
 * hidden by this.
 */
export function useMatureNowChannelIds(sourceId: string, channels: Channel[], enabled: boolean): ReadonlySet<string> {
  const epgVersion = useCacheInvalidationStore((state) => state.versions[epgVersionKey(sourceId)]);
  const [guides, setGuides] = useState<Map<string, EpgProgramme[]>>(() => new Map());
  const [now, setNow] = useState(() => Date.now());
  const guideIds = useMemo(() => Array.from(new Set(channels.map((c) => c.epgChannelId ?? c.id))), [channels]);
  const guideIdsKey = guideIds.join("\u0000");

  useEffect(() => {
    if (!enabled || guideIds.length === 0) {
      setGuides((prev) => (prev.size === 0 ? prev : new Map()));
      return;
    }
    let cancelled = false;
    void (async () => {
      const next = new Map<string, EpgProgramme[]>();
      for (let i = 0; i < guideIds.length && !cancelled; i += READ_CONCURRENCY) {
        const batch = guideIds.slice(i, i + READ_CONCURRENCY);
        const results = await Promise.all(batch.map((id) => getLocalChannelProgrammes(sourceId, id)));
        batch.forEach((id, index) => {
          const programmes = results[index];
          if (programmes && programmes.length > 0) next.set(id, programmes);
        });
      }
      if (!cancelled) {
        setGuides(next);
        setNow(Date.now());
      }
    })();
    return () => {
      cancelled = true;
    };
    // guideIdsKey stands in for guideIds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, guideIdsKey, enabled, epgVersion]);

  const { matureIds, nextBoundary } = useMemo(() => {
    const rules = getDefaultKidsRules();
    const ids = new Set<string>();
    let boundary = Infinity;
    if (!enabled) return { matureIds: EMPTY_IDS, nextBoundary: boundary };
    for (const channel of channels) {
      const programmes = guides.get(channel.epgChannelId ?? channel.id);
      if (!programmes) continue;
      for (const programme of programmes) {
        const start = programme.start.getTime();
        const stop = programme.stop.getTime();
        if (start > now) boundary = Math.min(boundary, start);
        if (start <= now && now < stop) {
          boundary = Math.min(boundary, stop);
          if (rules.matureProgrammeReason(programme)) ids.add(channel.id);
        }
      }
    }
    return { matureIds: ids.size === 0 ? EMPTY_IDS : ids, nextBoundary: boundary };
  }, [enabled, channels, guides, now]);

  useEffect(() => {
    if (!enabled) return;
    const delay = Math.min(MAX_RECHECK_MS, Math.max(1000, nextBoundary - Date.now() + 500));
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [enabled, nextBoundary, now]);

  return matureIds;
}
