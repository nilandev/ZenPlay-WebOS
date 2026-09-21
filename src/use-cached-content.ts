import { useEffect, useRef, useState } from "react";
import { useCacheInvalidationStore } from "./cache-invalidation-store.js";
import { getCachedContent, isCacheStale, setCachedContent, type CacheKind } from "./content-cache.js";

export interface CachedContentState<T> {
  data: T;
  /** True only until the first successful load for this cache key ever completes — never true again on background refreshes. */
  isInitialLoading: boolean;
  error: string | null;
  /**
   * True when `error` is set but `data` still holds a previously-good
   * (possibly stale) cached value — a screen should keep showing that
   * content (optionally with a small "couldn't refresh" affordance) rather
   * than falling back to a hard error state. False whenever there was never
   * any good data to fall back on (error and isInitialLoading both true) —
   * that's the only case worth a full error screen.
   */
  isStale: boolean;
}

export interface UseCachedContentOptions {
  /**
   * When false, this hook neither reads staleness nor triggers a fetch —
   * it still returns whatever's already cached under cacheKey (so a
   * temporarily-disabled consumer doesn't flash empty), it just won't cause
   * a network call. Used by screens that conditionally need one of several
   * cache keys depending on UI state (e.g. VodScreen only needs its
   * per-category key while a category is selected) but still call this hook
   * unconditionally, as React's rules require.
   */
  enabled?: boolean;
}

/**
 * Loads content behind a cache key: if a cached value exists (this session,
 * possibly from before a reload, or restored from IndexedDB at boot — see
 * content-cache.ts), it's returned synchronously on mount so the screen
 * renders real content immediately instead of an empty state.
 * `isInitialLoading` is only ever true when there's truly nothing to show
 * yet, which is what screens use to decide whether to render a loading
 * shimmer instead of content.
 *
 * A fetch only actually runs when the cached entry is missing or stale (see
 * isCacheStale/content-cache.ts's per-kind thresholds) — a fresh cache hit
 * is served as-is with no network call at all, which is what makes
 * revisiting a screen (tab switch, back-navigation) instant instead of
 * re-fetching from the IPTV source every time it remounts.
 *
 * Also re-runs whenever cache-invalidation-store bumps this cacheKey's
 * version — that's how a background revalidation (cache-revalidator.ts), a
 * manual Refresh (HomeScreen), an idle prefetch (idle-prefetch.ts), or the
 * IndexedDB boot warm-up (content-cache.ts's initContentCacheFromIdb) can
 * update an already-mounted screen without it needing to remount, which is
 * the one thing ManagePlaylistsScreen's older refreshTick-in-the-cache-key
 * workaround had to fake by forcing a remount-shaped re-fetch instead.
 */
export function useCachedContent<T>(
  cacheKey: string,
  kind: CacheKind,
  load: () => Promise<T>,
  emptyValue: T,
  options: UseCachedContentOptions = {},
): CachedContentState<T> {
  const { enabled = true } = options;
  const cached = getCachedContent<T>(cacheKey);
  const [data, setData] = useState<T>(cached ?? emptyValue);
  const [isInitialLoading, setIsInitialLoading] = useState(enabled && cached === undefined);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const version = useCacheInvalidationStore((state) => state.versions[cacheKey]);

  useEffect(() => {
    let cancelled = false;
    const cachedForKey = getCachedContent<T>(cacheKey);
    setData(cachedForKey ?? emptyValue);
    setIsInitialLoading(enabled && cachedForKey === undefined);
    setError(null);

    if (!enabled) return;
    if (!isCacheStale(cacheKey)) return;

    loadRef
      .current()
      .then((loaded) => {
        if (cancelled) return;
        setCachedContent(cacheKey, loaded, kind);
        setData(loaded);
        setIsInitialLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        // Only a load that actually had nothing cached to fall back on
        // should keep isInitialLoading true (there's truly nothing to show,
        // which is what screens use to decide whether to render a loading
        // shimmer vs. their content) — a failed background refresh of an
        // already-good cache hit was never "initial loading" in the first
        // place, so it has nothing to revert here.
        setIsInitialLoading((wasLoading) => wasLoading);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, enabled, version]);

  const isStale = error !== null && !isInitialLoading;

  return { data, isInitialLoading, error, isStale };
}
