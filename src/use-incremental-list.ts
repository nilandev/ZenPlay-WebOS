import { useCallback, useMemo, useState } from "react";

/** Same page size as the local-table path (see use-catalog-page.ts), so both paths grow a grid the same way. */
export const INCREMENTAL_PAGE_SIZE = 60;

export interface IncrementalList<T> {
  /** The first N items — what should actually be rendered. */
  visible: T[];
  hasMore: boolean;
  loadMore: () => void;
}

/**
 * Pages an already-in-memory array the way use-catalog-page.ts pages the
 * local table: render the first page, and grow by a page each time
 * loadMore() is called (screens call it as focus nears the end of what's
 * rendered). Used by VodScreen/SeriesScreen's legacy fallback path, which
 * has the whole catalog in hand but must not mount thousands of cards at
 * once. Returns null when `items` is null (nothing to page).
 *
 * Resets to one page whenever `items` changes (a new category or search) —
 * during render rather than in an effect, so the first render of a new list
 * never briefly mounts however many pages the previous list had grown to.
 */
export function useIncrementalList<T>(items: T[] | null, pageSize = INCREMENTAL_PAGE_SIZE): IncrementalList<T> | null {
  const [paging, setPaging] = useState({ items, count: pageSize });
  if (paging.items !== items) setPaging({ items, count: pageSize });
  const count = paging.items === items ? paging.count : pageSize;

  const loadMore = useCallback(() => setPaging((current) => ({ ...current, count: current.count + pageSize })), [pageSize]);
  const visible = useMemo(() => (items ? items.slice(0, count) : null), [items, count]);

  if (!items || !visible) return null;
  return { visible, hasMore: count < items.length, loadMore };
}
