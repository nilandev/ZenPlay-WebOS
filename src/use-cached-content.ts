import { useEffect, useRef, useState } from "react";
import { getCachedContent, isCacheStale, setCachedContent } from "./content-cache.js";

export interface CachedContentState<T> {
  data: T;
  /** True only until the first successful load for this cache key ever completes — never true again on background refreshes. */
  isInitialLoading: boolean;
  error: string | null;
}

/**
 * Loads content behind a cache key: if a cached value exists (this session,
 * possibly from before a reload — see content-cache.ts), it's returned
 * synchronously on mount so the screen renders real content immediately
 * instead of an empty state. `isInitialLoading` is only ever true when
 * there's truly nothing to show yet, which is what screens use to decide
 * whether to render a loading shimmer instead of content.
 *
 * A fetch only actually runs when the cached entry is missing or stale (see
 * isCacheStale/STALE_AFTER_MS in content-cache.ts) — a fresh cache hit is
 * served as-is with no network call at all, which is what makes revisiting a
 * screen (tab switch, back-navigation) instant instead of re-fetching from
 * the IPTV source every time it remounts. Manual refresh affordances
 * (ManagePlaylistsScreen's Refresh/Delete Cache, HomeScreen's Refresh tile)
 * bypass this by clearing the cache entry first, which makes it look stale
 * again and forces a real fetch on the next mount.
 */
export function useCachedContent<T>(cacheKey: string, load: () => Promise<T>, emptyValue: T): CachedContentState<T> {
  const cached = getCachedContent<T>(cacheKey);
  const [data, setData] = useState<T>(cached ?? emptyValue);
  const [isInitialLoading, setIsInitialLoading] = useState(cached === undefined);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    const cachedForKey = getCachedContent<T>(cacheKey);
    setData(cachedForKey ?? emptyValue);
    setIsInitialLoading(cachedForKey === undefined);
    setError(null);

    if (!isCacheStale(cacheKey)) return;

    loadRef.current()
      .then((loaded) => {
        if (cancelled) return;
        setCachedContent(cacheKey, loaded);
        setData(loaded);
        setIsInitialLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setIsInitialLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  return { data, isInitialLoading, error };
}
