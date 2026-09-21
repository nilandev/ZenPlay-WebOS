import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCacheInvalidationStore } from "./cache-invalidation-store.js";
import { clearAllCachedContent, getCachedContent, setCachedContent } from "./content-cache.js";
import { revalidateStaleTargets, startBackgroundRevalidation, type RevalidationTarget } from "./cache-revalidator.js";

describe("revalidateStaleTargets", () => {
  beforeEach(() => {
    clearAllCachedContent();
  });

  it("fetches a target with no cached value and writes the result", async () => {
    const load = vi.fn().mockResolvedValue(["item"]);
    const targets: RevalidationTarget[] = [{ key: "k1", kind: "catalog", load }];

    await revalidateStaleTargets(targets);

    expect(load).toHaveBeenCalledTimes(1);
    expect(getCachedContent("k1")).toEqual(["item"]);
  });

  it("does not fetch a target that's already fresh", async () => {
    setCachedContent("k1", ["cached"], "catalog");
    const load = vi.fn().mockResolvedValue(["new"]);

    await revalidateStaleTargets([{ key: "k1", kind: "catalog", load }]);

    expect(load).not.toHaveBeenCalled();
    expect(getCachedContent("k1")).toEqual(["cached"]);
  });

  it("force option fetches even a fresh target", async () => {
    setCachedContent("k1", ["cached"], "catalog");
    const load = vi.fn().mockResolvedValue(["new"]);

    await revalidateStaleTargets([{ key: "k1", kind: "catalog", load }], { force: true });

    expect(load).toHaveBeenCalledTimes(1);
    expect(getCachedContent("k1")).toEqual(["new"]);
  });

  it("bumps the invalidation version only for a successfully revalidated key", async () => {
    const succeed = vi.fn().mockResolvedValue("ok");
    const before = useCacheInvalidationStore.getState().versions["success-key"] ?? 0;

    await revalidateStaleTargets([{ key: "success-key", kind: "catalog", load: succeed }]);

    expect(useCacheInvalidationStore.getState().versions["success-key"]).toBe(before + 1);
  });

  describe("with fake timers (retry backoff involves real delays)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("one target's failure does not stop other targets from revalidating", async () => {
      const failing = vi.fn().mockRejectedValue(new Error("boom"));
      const succeeding = vi.fn().mockResolvedValue("fine");

      const done = revalidateStaleTargets([
        { key: "failing", kind: "catalog", load: failing },
        { key: "succeeding", kind: "catalog", load: succeeding },
      ]);
      await vi.runAllTimersAsync();
      await done;

      expect(getCachedContent("succeeding")).toBe("fine");
      expect(getCachedContent("failing")).toBeUndefined();
    });

    it("leaves the previously-cached value in place when a revalidation fails", async () => {
      setCachedContent("stable", ["old"], "catalog");
      const dateSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 4 * 60 * 60 * 1000); // force staleness
      const failing = vi.fn().mockRejectedValue(new Error("network blip"));

      const done = revalidateStaleTargets([{ key: "stable", kind: "catalog", load: failing }]);
      await vi.runAllTimersAsync();
      await done;

      expect(getCachedContent("stable")).toEqual(["old"]);
      dateSpy.mockRestore();
    });

    it("retries a target that fails before eventually succeeding", async () => {
      const load = vi
        .fn()
        .mockRejectedValueOnce(new Error("first failure"))
        .mockResolvedValueOnce("succeeded");

      const done = revalidateStaleTargets([{ key: "flaky", kind: "catalog", load }]);
      await vi.runAllTimersAsync();
      await done;

      expect(load).toHaveBeenCalledTimes(2);
      expect(getCachedContent("flaky")).toBe("succeeded");
    });
  });
});

describe("startBackgroundRevalidation", () => {
  beforeEach(() => {
    clearAllCachedContent();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls getTargets fresh on every tick rather than capturing it once", async () => {
    const getTargets = vi.fn().mockReturnValue([]);
    const stop = startBackgroundRevalidation(getTargets, 1000);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(getTargets.mock.calls.length).toBeGreaterThanOrEqual(2);
    stop();
  });

  it("stops ticking once the returned stop function is called", async () => {
    const load = vi.fn().mockResolvedValue("x");
    const getTargets = () => [{ key: "stoppable", kind: "catalog" as const, load }];
    const stop = startBackgroundRevalidation(getTargets, 1000);

    await vi.advanceTimersByTimeAsync(1000);
    const callsBeforeStop = load.mock.calls.length;
    stop();
    await vi.advanceTimersByTimeAsync(5000);

    expect(load.mock.calls.length).toBe(callsBeforeStop);
  });
});
