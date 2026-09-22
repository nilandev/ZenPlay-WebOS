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
 * How many of the first shelves are allowed to query/mount together up
 * front, before the rest trickle in one at a time — see the module doc
 * comment for why this staggering exists at all. A handful is enough to
 * fill the first screenful (nothing below the fold benefits from mounting
 * immediately anyway) without reproducing the "every category's shelf
 * appears in the same instant" burst this hook used to cause.
 */
const INITIAL_BURST = 3;
/** Delay between starting each subsequent shelf's query once past INITIAL_BURST — small enough that browsing still feels like everything showed up quickly, large enough to spread each shelf's ~20 image requests into distinct bursts instead of one single spike. */
const STAGGER_MS = 120;

/**
 * Builds the "All Categories" browse view's shelves directly from the local
 * catalog table, one bounded query per category, instead of loading the
 * entire catalog into memory and grouping it client-side (VodScreen's old
 * groupByCategory over a full useCachedContent fetch). Requires categories
 * to already be known (from the cheap get_*_categories call) since a shelf
 * needs a category to query against.
 *
 * Shelves are revealed progressively (the first few immediately, the rest
 * staggered) rather than gated behind one `Promise.all` over every
 * category — waiting for every category's query to settle before setting
 * any shelf state meant every shelf (and every one of its ~20 poster/logo
 * images) mounted in the exact same React commit. On a real IndexedDB
 * (unlike fake-indexeddb in tests) with tens of categories, that produced a
 * single sharp burst of a few hundred concurrent image requests — enough to
 * exceed the browser's per-host connection limit and the provider's own
 * rate limiting, which is what made artwork load inconsistently ("some
 * cards never get their image") once this feature's background sync
 * completed, versus the old full-catalog-fetch flow where shelves were
 * usually already warm from a previous session's cache and rarely all
 * appeared at once like this. Revealing shelves incrementally spreads that
 * same total image load out over time instead of firing it all in one
 * instant, while still keeping shelves in the same order as `categories`
 * regardless of which query happens to resolve first.
 */
export function useCatalogShelves<T>(
  sourceId: string,
  kind: CatalogKind,
  categories: Category[],
  mapPage: (categoryId: string, limit: number) => Promise<T[]>,
  enabled: boolean,
): { shelves: Array<CatalogShelf<T>>; isLoading: boolean } {
  // One slot per category, filled in as each resolves — undefined means
  // "not resolved yet" (distinct from an empty shelf, which is filtered out
  // at the end). Rendering derives the visible shelf list from this array
  // (in `categories` order) rather than accumulating an unordered list, so
  // out-of-order resolution never reshuffles what's already on screen.
  const [slots, setSlots] = useState<Array<CatalogShelf<T> | undefined>>([]);
  const [isLoading, setIsLoading] = useState(enabled);
  const version = useCacheInvalidationStore((state) => state.versions[catalogVersionKey(sourceId, kind)]);

  useEffect(() => {
    let cancelled = false;

    if (!enabled || categories.length === 0) {
      // Guard against setting state that's already in this shape: a plain
      // `setSlots([])` here would create a *new* empty array every run,
      // which React treats as a real change (Object.is on state, not deep
      // equality) — that triggers a re-render, which (if `categories` isn't
      // a stable reference across renders) re-runs this very effect again,
      // forever. `categories` really is stable for every real caller here
      // (VodScreen/SeriesScreen source it from useCachedContent's memoized
      // state), but the hook shouldn't rely on every future caller getting
      // that right — see this file's test suite for the exact loop an
      // unmemoized `categories` array reproduces.
      setSlots((prev) => (prev.length === 0 ? prev : []));
      setIsLoading((prev) => (prev ? false : prev));
      return;
    }

    setIsLoading(true);
    setSlots(new Array(categories.length).fill(undefined));

    const timeouts: ReturnType<typeof setTimeout>[] = [];

    function fillSlot(category: Category, index: number): void {
      mapPage(category.id, SHELF_SIZE)
        .then((items) => {
          if (cancelled) return;
          setSlots((prev) => {
            const next = [...prev];
            next[index] = { id: category.id, title: category.name, items };
            return next;
          });
        })
        .catch(() => {
          // One category's query failing shouldn't blank the rest — leave its slot unresolved (filtered out below) rather than surfacing an error nobody asked to see.
        })
        .finally(() => {
          if (!cancelled && index === 0) setIsLoading(false);
        });
    }

    categories.forEach((category, index) => {
      if (index < INITIAL_BURST) {
        fillSlot(category, index);
        return;
      }
      const handle = setTimeout(() => fillSlot(category, index), (index - INITIAL_BURST + 1) * STAGGER_MS);
      timeouts.push(handle);
    });

    return () => {
      cancelled = true;
      for (const handle of timeouts) clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, kind, categories, enabled, version]);

  const shelves = slots.filter((shelf): shelf is CatalogShelf<T> => Boolean(shelf && shelf.items.length > 0));

  return { shelves, isLoading };
}
