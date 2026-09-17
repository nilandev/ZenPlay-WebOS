import { useEffect, useRef, useState } from "react";
import { getCachedContent, setCachedContent } from "./content-cache.js";

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
 * instead of an empty state, while a fresh fetch runs in the background and
 * silently replaces it on success. `isInitialLoading` is only ever true when
 * there's truly nothing to show yet, which is what screens use to decide
 * whether to render a loading shimmer instead of content.
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
