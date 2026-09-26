import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Channel, SeriesInfo } from "@core";
import { useCacheInvalidationStore } from "./cache-invalidation-store.js";
import { catalogVersionKey } from "./catalog-sync.js";
import { getCatalogCount, getCatalogPage, type CatalogPageQuery } from "./catalog-store.js";
import type { CatalogFilter } from "./content-policy.js";

/** One "screenful" of growth per loadMore() call — a few grid rows' worth, matched loosely to how many cards actually fit on screen (see VodScreen/SeriesScreen's computeGridColumns). */
const PAGE_SIZE = 60;

export interface UseCatalogPageOptions {
  categoryId?: string;
  namePrefix?: string;
  /** A Kids profile's filter (content-policy.ts); undefined reads everything. */
  filter?: CatalogFilter;
  enabled?: boolean;
}

export interface CatalogPageState<T> {
  items: T[];
  isInitialLoading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  error: string | null;
  /** Total matching records (all pages), or null until the first page has loaded — for "412 titles"-style headers. */
  total: number | null;
}

const EMPTY: never[] = [];

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
  const { categoryId, namePrefix, filter: kidsFilter, enabled = true } = options;
  const [items, setItems] = useState<T[]>([]);
  const [isFetching, setIsFetching] = useState(enabled);
  // Which query `items` answers. Until the current one has loaded, the hook
  // reports loading with no items — otherwise the render between a filter
  // change (or `enabled` turning on) and the effect below would show the
  // previous result, or an empty one ("No series in this category"), for a
  // moment. A background sync's version bump isn't part of the key: the
  // existing items stay up while the refreshed ones load.
  const queryKey = enabled ? JSON.stringify([sourceId, kind, categoryId ?? null, namePrefix ?? null, kidsFilter?.key ?? null]) : null;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const offsetRef = useRef(0);
  const isLoadingMoreRef = useRef(false);
  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;

  const version = useCacheInvalidationStore((state) => state.versions[catalogVersionKey(sourceId, kind)]);

  // Keyed on the Kids filter's key, not its identity — it's rebuilt on every render of the policy's owner.
  const kidsFilterRef = useRef(kidsFilter);
  kidsFilterRef.current = kidsFilter;
  const kidsFilterKey = kidsFilter?.key;
  const filter: Omit<CatalogPageQuery, "offset" | "limit"> = useMemo(
    () => ({ categoryId, namePrefix, filter: kidsFilterRef.current }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [categoryId, namePrefix, kidsFilterKey],
  );

  useEffect(() => {
    let cancelled = false;
    offsetRef.current = 0;
    setError(null);
    setTotal(null);

    if (!enabled) {
      setItems([]);
      setIsFetching(false);
      setHasMore(false);
      setLoadedKey(null);
      return;
    }

    setIsFetching(true);
    Promise.all([fetchPageRef.current({ ...filter, offset: 0, limit: PAGE_SIZE }), getCatalogCount(sourceId, kind, filter)])
      .then(([page, total]) => {
        if (cancelled) return;
        offsetRef.current = page.length;
        setItems(page);
        setTotal(total);
        setHasMore(page.length < total);
        setLoadedKey(queryKey);
        setIsFetching(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoadedKey(queryKey);
        setIsFetching(false);
      });

    return () => {
      cancelled = true;
    };
    // queryKey is derived from these same inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const isCurrent = enabled && loadedKey === queryKey;
  const isInitialLoading = enabled && (!isCurrent || (isFetching && items.length === 0));
  return { items: isCurrent ? items : (EMPTY as T[]), isInitialLoading, hasMore: isCurrent && hasMore, loadMore, error, total: isCurrent ? total : null };
}
