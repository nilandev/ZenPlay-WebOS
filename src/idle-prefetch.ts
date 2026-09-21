import { bumpCacheVersion } from "./cache-invalidation-store.js";
import { getCachedContent, setCachedContent } from "./content-cache.js";
import type { RevalidationTarget } from "./cache-revalidator.js";

const DEFAULT_PREFETCH_DELAY_MS = 4000;

/**
 * Warms whatever targets have genuinely never been fetched this session —
 * not merely stale ones (that's cache-revalidator.ts's job) — a fixed delay
 * after the caller (HomeScreen) settles, so navigating into VOD/Series for
 * the very first time in a session already has a warm cache instead of
 * eating the full fetch cost live, in the critical path of that first click.
 *
 * Strictly filtering to "no cached value at all" keeps this a subset of
 * what the background revalidator would do anyway, so the two can never
 * race each other into a duplicate concurrent fetch of the same key.
 *
 * A fixed delay approximates "after Home has settled" — same reasoning as
 * cache-revalidator.ts's plain setInterval: no idle-detection API
 * (requestIdleCallback) is used elsewhere in this codebase and its
 * reliability across TV WebKit/Chromium builds isn't worth depending on for
 * a task this coarse-grained.
 *
 * Returns a cancel function so the caller can clear the pending prefetch on
 * unmount (e.g. the user navigates away from Home before it fires).
 */
export function schedulePrefetch(targets: RevalidationTarget[], delayMs = DEFAULT_PREFETCH_DELAY_MS): () => void {
  const handle = setTimeout(() => {
    const missing = targets.filter((target) => getCachedContent(target.key) === undefined);
    for (const target of missing) {
      target
        .load()
        .then((value) => {
          setCachedContent(target.key, value, target.kind);
          bumpCacheVersion(target.key);
        })
        .catch(() => {
          // A prefetch nobody explicitly asked for shouldn't surface an
          // error — the screen that actually needs this content will just
          // try its own fetch (and show its own error state) when visited.
        });
    }
  }, delayMs);
  return () => clearTimeout(handle);
}
