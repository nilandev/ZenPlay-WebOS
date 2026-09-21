import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCacheInvalidationStore } from "./cache-invalidation-store.js";
import { clearAllCachedContent, getCachedContent, setCachedContent } from "./content-cache.js";
import { schedulePrefetch } from "./idle-prefetch.js";
import type { RevalidationTarget } from "./cache-revalidator.js";

describe("schedulePrefetch", () => {
  beforeEach(() => {
    clearAllCachedContent();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not fetch before the delay elapses", async () => {
    const load = vi.fn().mockResolvedValue("data");
    const targets: RevalidationTarget[] = [{ key: "not-yet", kind: "catalog", load }];

    schedulePrefetch(targets, 4000);
    await vi.advanceTimersByTimeAsync(3999);

    expect(load).not.toHaveBeenCalled();
  });

  it("fetches a never-cached target once the delay elapses", async () => {
    const load = vi.fn().mockResolvedValue("data");
    const targets: RevalidationTarget[] = [{ key: "missing-key", kind: "catalog", load }];

    schedulePrefetch(targets, 4000);
    await vi.advanceTimersByTimeAsync(4000);

    expect(load).toHaveBeenCalledTimes(1);
    expect(getCachedContent("missing-key")).toBe("data");
  });

  it("skips a target that already has cached content, even if stale", async () => {
    setCachedContent("already-cached", "old-value", "catalog");
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 4 * 60 * 60 * 1000); // force staleness
    const load = vi.fn().mockResolvedValue("new-value");

    schedulePrefetch([{ key: "already-cached", kind: "catalog", load }], 4000);
    await vi.advanceTimersByTimeAsync(4000);

    expect(load).not.toHaveBeenCalled();
    expect(getCachedContent("already-cached")).toBe("old-value");
    dateSpy.mockRestore();
  });

  it("bumps the invalidation version once a prefetched value is cached", async () => {
    const load = vi.fn().mockResolvedValue("data");
    const before = useCacheInvalidationStore.getState().versions["prefetch-notify"] ?? 0;

    schedulePrefetch([{ key: "prefetch-notify", kind: "catalog", load }], 1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(useCacheInvalidationStore.getState().versions["prefetch-notify"]).toBe(before + 1);
  });

  it("cancel() prevents the scheduled prefetch from running", async () => {
    const load = vi.fn().mockResolvedValue("data");
    const cancel = schedulePrefetch([{ key: "cancelled-key", kind: "catalog", load }], 1000);

    cancel();
    await vi.advanceTimersByTimeAsync(5000);

    expect(load).not.toHaveBeenCalled();
  });

  it("does not throw when a prefetch load rejects", async () => {
    const load = vi.fn().mockRejectedValue(new Error("network blip"));

    schedulePrefetch([{ key: "flaky-prefetch", kind: "catalog", load }], 1000);
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();

    expect(getCachedContent("flaky-prefetch")).toBeUndefined();
  });
});
