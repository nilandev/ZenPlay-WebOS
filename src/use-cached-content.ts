import { useEffect, useRef, useState } from "react";
import { useCacheInvalidationStore } from "./cache-invalidation-store.js";
import { getCachedContent, isCacheStale, loadCachedEntry, setCachedContent, type CacheKind } from "./content-cache.js";

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
   * When false, this hook never triggers a fetch — it still returns
   * whatever's cached under cacheKey (in memory, or read from IndexedDB),
   * so a temporarily-disabled consumer doesn't flash empty; it just won't
   * cause a network call. Used by screens that conditionally need one of several
   * cache keys depending on UI state (e.g. VodScreen only needs its
   * per-category key while a category is selected) but still call this hook
   * unconditionally, as React's rules require.
   */
  enabled?: boolean;
}

/**
 * Loads content behind a cache key. A value already in memory (this
 * session) is returned synchronously on mount, so a revisit renders real
 * content immediately. On a memory miss the stored IndexedDB value is read
 * first (a cold start after webOS killed the app — see content-cache.ts),
 * and only then is staleness decided, so a still-fresh stored value is
 * shown without any network call. `isInitialLoading` is only true while
 * there's truly nothing to show yet.
 *
 * A fetch only runs when the entry is missing or stale (see content-cache.ts's
 * per-kind thresholds).
 *
 * Also re-runs whenever cache-invalidation-store bumps this cacheKey's
 * version — that's how the sync manager (refreshing categories/account info
 * with its stages) updates an already-mounted screen without a remount.
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
    const inMemory = getCachedContent<T>(cacheKey);
    setData(inMemory ?? emptyValue);
    setIsInitialLoading(enabled && inMemory === undefined);
    setError(null);

    void (async () => {
      if (inMemory === undefined) {
        const stored = await loadCachedEntry<T>(cacheKey);
        if (cancelled) return;
        if (stored) {
          setData(stored.value);
          setIsInitialLoading(false);
        }
      }
      if (!enabled || !isCacheStale(cacheKey)) return;

      try {
        const loaded = await loadRef.current();
        if (cancelled) return;
        setCachedContent(cacheKey, loaded, kind);
        setData(loaded);
        setIsInitialLoading(false);
      } catch (err: unknown) {
        if (cancelled) return;
        // isInitialLoading stays as it was: true only if there was nothing to fall back on.
        setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, enabled, version]);

  const isStale = error !== null && !isInitialLoading;

  return { data, isInitialLoading, error, isStale };
}
