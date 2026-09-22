import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Category } from "@core";
import { bumpCacheVersion } from "./cache-invalidation-store.js";
import { catalogVersionKey } from "./catalog-sync.js";
import { useCatalogShelves } from "./use-catalog-shelves.js";

function category(id: string, name: string): Category {
  return { id, name, kind: "movie" };
}

/**
 * Flushes pending microtasks. Real timers throughout this file (not
 * vi.useFakeTimers()) — the hook under test schedules real setTimeouts for
 * its staggering behavior, and mixing that with fake timers across several
 * renderHook instances in one file proved to hang the Vitest worker (a
 * harness interaction, not a product bug) rather than reliably advancing
 * timers per test. Real timers plus STAGGER_MS-aware waits keep each test
 * fast (STAGGER_MS is 120ms) while avoiding that combination entirely.
 */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("useCatalogShelves", () => {
  it("reveals shelves as each category's query resolves rather than waiting for all of them", async () => {
    const categories = [category("a", "A"), category("b", "B")];
    let resolveB: (value: string[]) => void = () => {};
    const mapPage = vi.fn((categoryId: string) => {
      if (categoryId === "a") return Promise.resolve(["item-a"]);
      return new Promise<string[]>((resolve) => {
        resolveB = resolve;
      });
    });

    const { result, unmount } = renderHook(() => useCatalogShelves("source-1", "vod", categories, mapPage, true));
    await flush();

    expect(result.current.shelves.map((s) => s.id)).toEqual(["a"]);
    expect(result.current.isLoading).toBe(false);

    await act(async () => {
      resolveB(["item-b"]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.shelves.map((s) => s.id)).toEqual(["a", "b"]);
    unmount();
  });

  it("keeps shelves in category order even when a later category resolves first", async () => {
    const categories = [category("a", "A"), category("b", "B")];
    let resolveA: (value: string[]) => void = () => {};
    const mapPage = vi.fn((categoryId: string) => {
      if (categoryId === "b") return Promise.resolve(["item-b"]);
      return new Promise<string[]>((resolve) => {
        resolveA = resolve;
      });
    });

    const { result, unmount } = renderHook(() => useCatalogShelves("source-1", "vod", categories, mapPage, true));
    await flush();

    expect(result.current.shelves.map((s) => s.id)).toEqual(["b"]);

    await act(async () => {
      resolveA(["item-a"]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.shelves.map((s) => s.id)).toEqual(["a", "b"]);
    unmount();
  });

  it("filters out a category with no items once its query resolves", async () => {
    const categories = [category("a", "A"), category("b", "B")];
    const mapPage = vi.fn((categoryId: string) => Promise.resolve(categoryId === "a" ? ["item-a"] : []));

    const { result, unmount } = renderHook(() => useCatalogShelves("source-1", "vod", categories, mapPage, true));
    await flush();

    expect(result.current.shelves.map((s) => s.id)).toEqual(["a"]);
    unmount();
  });

  it("only queries the initial-burst categories up front, staggering the rest", async () => {
    const categories = Array.from({ length: 6 }, (_, i) => category(`c${i}`, `Cat ${i}`));
    const mapPage = vi.fn().mockResolvedValue(["item"]);

    const { unmount } = renderHook(() => useCatalogShelves("source-1", "vod", categories, mapPage, true));
    await flush();

    // Only the initial-burst categories should have queried synchronously on mount.
    expect(mapPage.mock.calls.length).toBeLessThan(categories.length);

    // The remaining categories are staggered STAGGER_MS apart starting after
    // the burst — waiting comfortably past the last one's scheduled delay
    // (well under a second total) confirms they do eventually all query.
    await act(() => wait(800));

    expect(mapPage).toHaveBeenCalledTimes(categories.length);
    unmount();
  }, 10000);

  it("one category's rejected query doesn't block the others from resolving", async () => {
    const categories = [category("a", "A"), category("b", "B")];
    const mapPage = vi.fn((categoryId: string) =>
      categoryId === "a" ? Promise.reject(new Error("boom")) : Promise.resolve(["item-b"]),
    );

    const { result, unmount } = renderHook(() => useCatalogShelves("source-1", "vod", categories, mapPage, true));
    await flush();

    expect(result.current.shelves.map((s) => s.id)).toEqual(["b"]);
    unmount();
  });

  it("does nothing when disabled", async () => {
    const mapPage = vi.fn();
    const { result, unmount } = renderHook(() => useCatalogShelves("source-1", "vod", [category("a", "A")], mapPage, false));
    await flush();

    expect(result.current.shelves).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(mapPage).not.toHaveBeenCalled();
    unmount();
  });

  it("re-queries when catalog-sync bumps this source+kind's version", async () => {
    const mapPage = vi.fn().mockResolvedValue(["item"]);
    const categories = [category("a", "A")];

    const { result, unmount } = renderHook(() => useCatalogShelves("source-1", "vod", categories, mapPage, true));
    await flush();
    expect(result.current.shelves).toHaveLength(1);

    mapPage.mockClear();
    await act(async () => {
      bumpCacheVersion(catalogVersionKey("source-1", "vod"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mapPage).toHaveBeenCalled();
    unmount();
  });
});
