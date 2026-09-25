import { useEffect, useState } from "react";
import { useCacheInvalidationStore } from "./cache-invalidation-store.js";
import { catalogVersionKey, type CatalogKind } from "./catalog-sync.js";
import { hasLocalCatalog } from "./catalog-store.js";

export type LocalCatalogStatus = "checking" | "ready" | "not-synced";

/**
 * Whether a source+kind has at least one completed sync (catalog-sync.ts,
 * or for an M3U's movies live-sync-core.ts) — VodScreen/SeriesScreen/My
 * List gate on this to pick between reading the local, paginated table
 * (use-catalog-page.ts) or asking the sync manager to build it and showing
 * its progress (typically a brand-new source, right after it was added).
 *
 * Starts "checking" (neither path enabled yet) and settles to "ready" or
 * "not-synced" once the IndexedDB check resolves, or flips back to
 * "checking" whenever catalog-sync.ts bumps this source+kind's version (a
 * sync just completed) so the screen re-checks rather than assuming
 * "not-synced" forever. The three-state shape (as opposed to a plain
 * boolean defaulting to false) matters here: a plain false-until-proven-true
 * would flash the "getting your movies ready" state (and request a sync)
 * on every mount before the already-synced case has had a chance to resolve.
 */
export function useLocalCatalogReady(sourceId: string, kind: CatalogKind): LocalCatalogStatus {
  const [status, setStatus] = useState<LocalCatalogStatus>("checking");
  const version = useCacheInvalidationStore((state) => state.versions[catalogVersionKey(sourceId, kind)]);

  useEffect(() => {
    let cancelled = false;
    setStatus("checking");
    hasLocalCatalog(sourceId, kind).then((ready) => {
      if (!cancelled) setStatus(ready ? "ready" : "not-synced");
    });
    return () => {
      cancelled = true;
    };
  }, [sourceId, kind, version]);

  return status;
}
