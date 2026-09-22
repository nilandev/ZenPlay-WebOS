import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Channel, SeriesInfo } from "@core";
import { useCacheInvalidationStore } from "./cache-invalidation-store.js";
import { catalogVersionKey } from "./catalog-sync.js";
import { getCatalogCount, getCatalogPage, type CatalogPageQuery } from "./catalog-store.js";

/** One "screenful" of growth per loadMore() call — a few grid rows' worth, matched loosely to how many cards actually fit on screen (see VodScreen/SeriesScreen's computeGridColumns). */
const PAGE_SIZE = 60;

export interface UseCatalogPageOptions {
  categoryId?: string;
  namePrefix?: string;
  enabled?: boolean;
}

export interface CatalogPageState<T> {
  items: T[];
  isInitialLoading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  error: string | null;
}

type SeriesSummary = Pick<SeriesInfo, "id" | "name" | "posterUrl" | "groupTitle">;

/**
 * Paginated read from the local catalog table (see catalog-store.ts), grown
 * in fixed PAGE_SIZE increments rather than a virtualized/windowed list —
 * spatial navigation (buildGridFocusGraph) needs a concrete, finite id list
 * up front, so "load everything so far, append more on demand" is what
 * stays compatible with it, unlike a true windowed scroll that would evict
 * off-screen items from the graph.
 *
 * Re-runs from scratch whenever categoryId/namePrefix change (a new filter
 * is a new result set, not more of the same one) or whenever
 * catalog-sync.ts bumps this source+kind's version (a background sync
 * completed — see catalogVersionKey), which is also how a screen that
 * mounted before any sync existed picks up the local table once one lands,
 * without needing to remount.
 */
export function useVodCatalogPage(sourceId: string, options: UseCatalogPageOptions = {}): CatalogPageState<Channel> {
  return useCatalogPageImpl(sourceId, "vod", (query) => getCatalogPage(sourceId, "vod", query), options);
}

/** Series counterpart to useVodCatalogPage — identical growth/invalidation behavior, see its doc comment. */
export function useSeriesCatalogPage(sourceId: string, options: UseCatalogPageOptions = {}): CatalogPageState<SeriesSummary> {
  return useCatalogPageImpl(sourceId, "series", (query) => getCatalogPage(sourceId, "series", query), options);
}

function useCatalogPageImpl<T>(
  sourceId: string,
  kind: "vod" | "series",
  fetchPage: (query: CatalogPageQuery) => Promise<T[]>,
  options: UseCatalogPageOptions,
): CatalogPageState<T> {
  const { categoryId, namePrefix, enabled = true } = options;
  const [items, setItems] = useState<T[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(enabled);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const offsetRef = useRef(0);
  const isLoadingMoreRef = useRef(false);
  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;

  const version = useCacheInvalidationStore((state) => state.versions[catalogVersionKey(sourceId, kind)]);

  const filter: Omit<CatalogPageQuery, "offset" | "limit"> = useMemo(() => ({ categoryId, namePrefix }), [categoryId, namePrefix]);

  useEffect(() => {
    let cancelled = false;
    offsetRef.current = 0;
    setError(null);

    if (!enabled) {
      setItems([]);
      setIsInitialLoading(false);
      setHasMore(false);
      return;
    }

    setIsInitialLoading(true);
    Promise.all([fetchPageRef.current({ ...filter, offset: 0, limit: PAGE_SIZE }), getCatalogCount(sourceId, kind, filter)])
      .then(([page, total]) => {
        if (cancelled) return;
        offsetRef.current = page.length;
        setItems(page);
        setHasMore(page.length < total);
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
  }, [sourceId, kind, filter, enabled, version]);

  const loadMore = useCallback(() => {
    if (isLoadingMoreRef.current || !hasMore || !enabled) return;
    isLoadingMoreRef.current = true;
    const offset = offsetRef.current;

    fetchPageRef
      .current({ ...filter, offset, limit: PAGE_SIZE })
      .then((page) => {
        offsetRef.current = offset + page.length;
        setItems((prev) => [...prev, ...page]);
        if (page.length < PAGE_SIZE) setHasMore(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        isLoadingMoreRef.current = false;
      });
  }, [filter, hasMore, enabled]);

  return { items, isInitialLoading, hasMore, loadMore, error };
}
