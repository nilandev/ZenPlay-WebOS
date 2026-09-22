import { useEffect, useState } from "react";
import { useCacheInvalidationStore } from "./cache-invalidation-store.js";
import { catalogVersionKey, type CatalogKind } from "./catalog-sync.js";
import { hasLocalCatalog } from "./catalog-store.js";

export type LocalCatalogStatus = "checking" | "ready" | "not-synced";

/**
 * Whether a source+kind has at least one completed background sync (see
 * catalog-sync.ts) — VodScreen/SeriesScreen gate on this to pick between
 * reading the local, paginated table (use-catalog-page.ts) or falling back
 * to content-loader.ts's direct full-catalog fetch for a source that's
 * never finished a sync yet (typically a brand-new source, right after it
 * was added — see catalog-sync.ts's doc comment for why blocking on that
 * first sync instead would defeat the point of this whole feature).
 *
 * Starts "checking" (neither path enabled yet) and settles to "ready" or
 * "not-synced" once the IndexedDB check resolves, or flips back to
 * "checking" whenever catalog-sync.ts bumps this source+kind's version (a
 * sync just completed) so the screen re-checks rather than assuming
 * "not-synced" forever. The three-state shape (as opposed to a plain
 * boolean defaulting to false) matters here: a plain false-until-proven-true
 * would make the legacy fallback fire its own fetch on every mount before
 * the already-synced case has had a chance to resolve, which is exactly the
 * wasted round-trip this hook exists to avoid for a source that's already
 * synced.
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
