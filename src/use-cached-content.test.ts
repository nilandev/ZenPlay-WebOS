import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bumpCacheVersion } from "./cache-invalidation-store.js";
import { __resetMemoryCacheForTests, clearAllCachedContent, setCachedContent } from "./content-cache.js";
import { openIdbStore, putEntry } from "./core/storage/indexeddb-store.js";
import { useCachedContent } from "./use-cached-content.js";

describe("useCachedContent", () => {
  beforeEach(() => {
    clearAllCachedContent();
  });

  it("returns the empty value and isInitialLoading=true on first mount with nothing cached", () => {
    const load = vi.fn().mockResolvedValue(["loaded"]);
    const { result } = renderHook(() => useCachedContent("key-1", "catalog", load, []));

    expect(result.current.data).toEqual([]);
    expect(result.current.isInitialLoading).toBe(true);
  });

  it("returns a fresh cache hit synchronously without calling load", () => {
    setCachedContent("key-2", ["cached"], "catalog");
    const load = vi.fn().mockResolvedValue(["new"]);

    const { result } = renderHook(() => useCachedContent("key-2", "catalog", load, []));

    expect(result.current.data).toEqual(["cached"]);
    expect(result.current.isInitialLoading).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it("fetches and caches when nothing is cached yet", async () => {
    const load = vi.fn().mockResolvedValue(["loaded"]);
    const { result } = renderHook(() => useCachedContent("key-3", "catalog", load, []));

    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));

    expect(result.current.data).toEqual(["loaded"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps the last-good value and does not revert isInitialLoading when a background reload fails", async () => {
    // Force staleness (rather than an empty cache) so the hook's own retry
    // path runs and fails, exercising the same "reload fails after a good
    // initial load" scenario the sync manager's retries guard against.
    setCachedContent("key-4", ["good-data"], "catalog");
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 4 * 60 * 60 * 1000); // past catalog's freshness window
    const load = vi.fn().mockRejectedValue(new Error("network blip"));

    const { result } = renderHook(() => useCachedContent("key-4", "catalog", load, []));
    expect(result.current.data).toEqual(["good-data"]);
    expect(result.current.isInitialLoading).toBe(false);

    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.data).toEqual(["good-data"]);
    expect(result.current.isInitialLoading).toBe(false);
    expect(result.current.isStale).toBe(true);
    dateSpy.mockRestore();
  });

  it("isStale is false when there was never any good data to fall back on", async () => {
    const load = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useCachedContent("key-5", "catalog", load, []));

    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.isInitialLoading).toBe(true);
    expect(result.current.isStale).toBe(false);
  });

  it("picks up externally-written cache data once cache-invalidation-store bumps this key's version, without remounting", async () => {
    // Mirrors the real call pattern (the sync manager refreshing
    // categories): the writer calls setCachedContent
    // *then* bumpCacheVersion — the bump is a "re-read the cache" signal for
    // an already-mounted consumer, not a "go fetch" signal, since the
    // writer already has fresh data by the time it bumps.
    setCachedContent("key-6", ["v1"], "catalog");
    const load = vi.fn().mockResolvedValue(["should not be used"]);

    const { result } = renderHook(() => useCachedContent("key-6", "catalog", load, []));
    expect(result.current.data).toEqual(["v1"]);

    act(() => {
      setCachedContent("key-6", ["v2"], "catalog");
      bumpCacheVersion("key-6");
    });

    await waitFor(() => expect(result.current.data).toEqual(["v2"]));
    expect(load).not.toHaveBeenCalled();
  });

  it("does not fetch while enabled is false, but still returns cached data", () => {
    setCachedContent("key-7", ["cached"], "catalog");
    const load = vi.fn().mockResolvedValue(["new"]);

    const { result } = renderHook(() => useCachedContent("key-7", "catalog", load, [], { enabled: false }));

    expect(result.current.data).toEqual(["cached"]);
    expect(load).not.toHaveBeenCalled();
  });

  it("starts fetching once enabled flips from false to true", async () => {
    const load = vi.fn().mockResolvedValue(["loaded"]);
    const { result, rerender } = renderHook(({ enabled }) => useCachedContent("key-8", "catalog", load, [], { enabled }), {
      initialProps: { enabled: false },
    });

    expect(load).not.toHaveBeenCalled();

    rerender({ enabled: true });

    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    expect(result.current.data).toEqual(["loaded"]);
  });

  describe("cold start (value only in IndexedDB)", () => {
    async function storeOnly(key: string, value: unknown, cachedAt: number): Promise<void> {
      await putEntry(await openIdbStore(), key, { value, cachedAt, kind: "category" });
      __resetMemoryCacheForTests(); // as if webOS had killed the app: nothing in memory
    }

    it("shows a still-fresh stored value without fetching", async () => {
      await storeOnly("cold-fresh", ["stored"], Date.now());
      const load = vi.fn().mockResolvedValue(["network"]);
      const { result } = renderHook(() => useCachedContent("cold-fresh", "category", load, [] as string[]));

      await waitFor(() => expect(result.current.data).toEqual(["stored"]));
      expect(result.current.isInitialLoading).toBe(false);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(load).not.toHaveBeenCalled();
    });

    it("shows a stale stored value straight away, then refreshes it", async () => {
      await storeOnly("cold-stale", ["stored"], Date.now() - 7 * 60 * 60 * 1000); // past category's 6h
      const load = vi.fn(() => new Promise<string[]>((resolve) => setTimeout(() => resolve(["network"]), 20))); // a real request takes a moment
      const seen: string[] = [];
      const { result } = renderHook(() => {
        const state = useCachedContent("cold-stale", "category", load, [] as string[]);
        const value = state.data.join(",");
        if (value && seen[seen.length - 1] !== value) seen.push(value);
        return state;
      });

      await waitFor(() => expect(result.current.data).toEqual(["network"]));
      expect(seen).toEqual(["stored", "network"]);
      expect(load).toHaveBeenCalledTimes(1);
    });

    it("reads the stored value even while disabled, but never fetches", async () => {
      await storeOnly("cold-disabled", ["stored"], 0);
      const load = vi.fn().mockResolvedValue(["network"]);
      const { result } = renderHook(() => useCachedContent("cold-disabled", "category", load, [] as string[], { enabled: false }));

      await waitFor(() => expect(result.current.data).toEqual(["stored"]));
      expect(load).not.toHaveBeenCalled();
    });
  });
});
