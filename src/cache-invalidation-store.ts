import { create } from "zustand";

/**
 * Lets a background process (revalidation timer, manual Refresh, idle
 * prefetch, IndexedDB boot warm-up — see cache-revalidator.ts/idle-prefetch.ts/
 * content-cache.ts) tell an *already-mounted* useCachedContent consumer that
 * its cache key changed, without either side needing a direct reference to
 * the other. useCachedContent subscribes to versions[cacheKey] and re-runs
 * its "read cache, fetch if stale" effect whenever it bumps.
 *
 * Plain flat-state zustand store, same shape as src/ui/focus/focus-store.ts —
 * no new state-management pattern introduced for this.
 */
interface CacheInvalidationState {
  versions: Record<string, number>;
  bumpVersion: (key: string) => void;
}

export const useCacheInvalidationStore = create<CacheInvalidationState>((set) => ({
  versions: {},
  bumpVersion: (key) =>
    set((state) => ({ versions: { ...state.versions, [key]: (state.versions[key] ?? 0) + 1 } })),
}));

/** Non-hook helper for plain-function callers (cache-revalidator.ts, idle-prefetch.ts, content-cache.ts's IDB warm-up) that aren't React components. */
export function bumpCacheVersion(key: string): void {
  useCacheInvalidationStore.getState().bumpVersion(key);
}
