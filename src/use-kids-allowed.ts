import { useCallback, useEffect, useMemo, useState } from "react";
import type { Category, PlaylistSource } from "@core";
import { getRecordsByIds } from "./catalog-store.js";
import { loadLiveCategories, loadSeriesCategories, loadVodCategories } from "./content-loader.js";
import type { ContentPolicy } from "./content-policy.js";
import { useCachedContent } from "./use-cached-content.js";
import { usePolicyLiveChannels } from "./use-policy-live-channels.js";

const EMPTY_CATEGORIES: Category[] = [];

export type SavedKind = "live" | "movie" | "series";

/**
 * A source's categories for one content kind, from the same cache the
 * browse screens fill (so usually no request at all). Only loads when
 * `enabled` — standard profiles never need them for filtering.
 */
export function useCatalogCategories(source: PlaylistSource, kind: "live" | "vod" | "series", enabled: boolean): Category[] {
  const load = useCallback(
    () => (kind === "live" ? loadLiveCategories(source) : kind === "vod" ? loadVodCategories(source) : loadSeriesCategories(source)),
    [source, kind],
  );
  const { data } = useCachedContent(`${kind}-categories:${source.id}`, "category", load, EMPTY_CATEGORIES, { enabled });
  return data;
}

/**
 * Which saved items (My List, Recently Watched, Kids Home) a Kids profile
 * may still see — `${kind}:${id}` keys, or null for a standard profile
 * (everything). Decided afresh from the catalog each time, since a parent
 * may have revoked something after it was saved. Unknown items (not
 * loaded yet, or gone from the provider) are left out.
 */
export function useKidsAllowedKeys(source: PlaylistSource, policy: ContentPolicy, items: Array<{ kind: SavedKind; id: string }>): ReadonlySet<string> | null {
  const isKids = policy.isKids;
  const movieIds = useMemo(() => items.filter((i) => i.kind === "movie").map((i) => i.id), [items]);
  const seriesIds = useMemo(() => items.filter((i) => i.kind === "series").map((i) => i.id), [items]);
  const hasLive = items.some((i) => i.kind === "live");

  const { channels: liveChannels } = usePolicyLiveChannels(source, policy, { enabled: isKids && hasLive });
  const vodCategories = useCatalogCategories(source, "vod", isKids && movieIds.length > 0);
  const seriesCategories = useCatalogCategories(source, "series", isKids && seriesIds.length > 0);

  const [allowedCatalogKeys, setAllowedCatalogKeys] = useState<ReadonlySet<string>>(() => new Set());
  const idsKey = `${movieIds.join("|")}\u0000${seriesIds.join("|")}`;
  useEffect(() => {
    if (!isKids || (movieIds.length === 0 && seriesIds.length === 0)) {
      setAllowedCatalogKeys(new Set());
      return;
    }
    let cancelled = false;
    const vodById = new Map(vodCategories.map((c) => [c.id, c]));
    const seriesById = new Map(seriesCategories.map((c) => [c.id, c]));
    Promise.all([
      movieIds.length > 0 ? getRecordsByIds(source.id, "vod", movieIds) : Promise.resolve([]),
      seriesIds.length > 0 ? getRecordsByIds(source.id, "series", seriesIds) : Promise.resolve([]),
    ])
      .then(([movies, series]) => {
        if (cancelled) return;
        const keys = new Set<string>();
        for (const movie of movies) if (policy.isItemAllowed("vod", movie, vodById)) keys.add(`movie:${movie.id}`);
        for (const show of series) if (policy.isItemAllowed("series", show, seriesById)) keys.add(`series:${show.id}`);
        setAllowedCatalogKeys(keys);
      })
      .catch(() => {
        if (!cancelled) setAllowedCatalogKeys(new Set());
      });
    return () => {
      cancelled = true;
    };
    // idsKey stands in for movieIds/seriesIds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isKids, source.id, idsKey, policy, vodCategories, seriesCategories]);

  return useMemo(() => {
    if (!isKids) return null;
    const keys = new Set(allowedCatalogKeys);
    for (const channel of liveChannels) keys.add(`live:${channel.id}`);
    return keys;
  }, [isKids, allowedCatalogKeys, liveChannels]);
}
