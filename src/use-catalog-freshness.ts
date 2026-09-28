import { useCallback, useEffect, useRef, useState } from "react";
import type { PlaylistSource } from "@core";
import { useCacheInvalidationStore } from "./cache-invalidation-store.js";
import { catalogVersionKey, getCatalogSyncedAt, getCategoryRefreshedAt, refreshCatalogCategory, type CatalogKind } from "./catalog-sync.js";
import { formatSyncedAgo } from "./sync/sync-summary.js";

export interface CatalogFreshness {
  /** "Updated 3h ago" — undefined until the catalog has synced. */
  updatedLabel?: string;
  /** Whether the shown category can be refreshed on its own (an Xtream catalog that has synced, one category on screen). */
  canRefresh: boolean;
  isRefreshing: boolean;
  refresh: () => void;
  /** The last refresh's result, for a Toast — cleared by dismissResult. */
  result: { message: string; tone: "success" | "error" } | null;
  dismissResult: () => void;
}

/**
 * How fresh the catalog a Movies/Series screen shows is, and its "Refresh"
 * for the one category on screen (catalog-sync.ts's refreshCatalogCategory)
 * — new titles in a category without waiting for the next full sync.
 * Re-reads whenever the catalog changes (a sync or a refresh finished).
 */
export function useCatalogFreshness(source: PlaylistSource, kind: CatalogKind, categoryId: string | undefined, isCatalogReady: boolean): CatalogFreshness {
  const version = useCacheInvalidationStore((state) => state.versions[catalogVersionKey(source.id, kind)]);
  const [syncedAt, setSyncedAt] = useState<number | undefined>(undefined);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [result, setResult] = useState<CatalogFreshness["result"]>(null);

  useEffect(() => {
    if (!isCatalogReady) return;
    let cancelled = false;
    void getCatalogSyncedAt(source.id, kind).then((at) => {
      if (!cancelled) setSyncedAt(at);
    });
    return () => {
      cancelled = true;
    };
  }, [source.id, kind, isCatalogReady, version]);

  const categoryAt = categoryId !== undefined ? getCategoryRefreshedAt(source.id, kind, categoryId) : undefined;
  const updatedAt = syncedAt !== undefined || categoryAt !== undefined ? Math.max(syncedAt ?? 0, categoryAt ?? 0) : undefined;

  // Selects arrive through the focus graph's onSelect, which may be a render behind.
  const busyRef = useRef(false);
  const refresh = useCallback(() => {
    if (busyRef.current || categoryId === undefined) return;
    busyRef.current = true;
    setIsRefreshing(true);
    refreshCatalogCategory(source, kind, categoryId)
      .then(({ written, deleted }) =>
        setResult({ message: written + deleted === 0 ? "Already up to date" : `Updated · ${written} new or changed, ${deleted} removed`, tone: "success" }),
      )
      .catch((err: unknown) => setResult({ message: `Couldn't refresh: ${err instanceof Error ? err.message : String(err)}`, tone: "error" }))
      .finally(() => {
        busyRef.current = false;
        setIsRefreshing(false);
      });
  }, [source, kind, categoryId]);
  const dismissResult = useCallback(() => setResult(null), []);

  return {
    updatedLabel: isCatalogReady && updatedAt !== undefined ? `Updated ${formatSyncedAgo(updatedAt)}` : undefined,
    canRefresh: isCatalogReady && source.kind === "xtream" && categoryId !== undefined,
    isRefreshing,
    refresh,
    result,
    dismissResult,
  };
}
