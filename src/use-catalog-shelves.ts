import { useEffect, useState } from "react";
import type { Category } from "@core";
import { useCacheInvalidationStore } from "./cache-invalidation-store.js";
import { catalogVersionKey, type CatalogKind } from "./catalog-sync.js";

/** Matches Shelf's own card count expectations — a shelf row is a horizontally-scrolling preview, not the full category, so this stays a fixed page rather than growing (opening the category from the dropdown gives the full paginated list via use-catalog-page.ts instead). */
const SHELF_SIZE = 20;

export interface CatalogShelf<T> {
  id: string;
  title: string;
  items: T[];
}

/**
 * Builds the "All Categories" browse view's shelves directly from the local
 * catalog table, one bounded query per category, instead of loading the
 * entire catalog into memory and grouping it client-side (VodScreen's old
 * groupByCategory over a full useCachedContent fetch). Requires categories
 * to already be known (from the cheap get_*_categories call) since a shelf
 * needs a category to query against.
 */
export function useCatalogShelves<T>(
  sourceId: string,
  kind: CatalogKind,
  categories: Category[],
  mapPage: (categoryId: string, limit: number) => Promise<T[]>,
  enabled: boolean,
): { shelves: Array<CatalogShelf<T>>; isLoading: boolean } {
  const [shelves, setShelves] = useState<Array<CatalogShelf<T>>>([]);
  const [isLoading, setIsLoading] = useState(enabled);
  const version = useCacheInvalidationStore((state) => state.versions[catalogVersionKey(sourceId, kind)]);

  useEffect(() => {
    let cancelled = false;
    if (!enabled || categories.length === 0) {
      setShelves([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    Promise.all(categories.map((c) => mapPage(c.id, SHELF_SIZE).then((items) => ({ id: c.id, title: c.name, items }))))
      .then((results) => {
        if (cancelled) return;
        setShelves(results.filter((shelf) => shelf.items.length > 0));
        setIsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setShelves([]);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, kind, categories, enabled, version]);

  return { shelves, isLoading };
}
