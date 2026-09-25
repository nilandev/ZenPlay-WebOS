import { create } from "zustand";

/**
 * Lets a background process (revalidation, manual Refresh, a completed
 * catalog/live/guide sync — see sync/sync-manager.ts, catalog-sync.ts,
 * live-sync.ts, epg-sync.ts) tell an *already-mounted* consumer that its
 * data changed, without either side needing a direct reference to the
 * other. Consumers (useCachedContent, useLiveChannels, the catalog/guide
 * hooks) subscribe to versions[key] and re-read whenever it bumps.
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

/** Non-hook helper for plain-function callers (the sync modules) that aren't React components. */
export function bumpCacheVersion(key: string): void {
  useCacheInvalidationStore.getState().bumpVersion(key);
}
