import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { bumpCacheVersion } from "./cache-invalidation-store.js";
import { catalogVersionKey } from "./catalog-sync.js";
import { __clearCatalogDbForTests, __resetCatalogDbForTests, openCatalogDb, putRecordsBatch, type CatalogRecord } from "./core/storage/catalog-db.js";
import { useVodCatalogPage } from "./use-catalog-page.js";

function vodRecord(streamId: string, name: string, groupTitle?: string): CatalogRecord {
  return { id: `source-1:${streamId}`, sourceId: "source-1", streamId, name, nameLower: name.toLowerCase(), groupTitle, generation: 1 };
}

describe("useVodCatalogPage", () => {
  beforeEach(async () => {
    __resetCatalogDbForTests();
    await __clearCatalogDbForTests();
  });

  it("loads the first page on mount", async () => {
    const catalogDb = await openCatalogDb();
    await putRecordsBatch(
      catalogDb,
      "vod",
      Array.from({ length: 5 }, (_, i) => vodRecord(String(i), `Movie ${i}`)),
    );

    const { result } = renderHook(() => useVodCatalogPage("source-1"));

    expect(result.current.isInitialLoading).toBe(true);
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));

    expect(result.current.items).toHaveLength(5);
    expect(result.current.hasMore).toBe(false);
  });

  it("hasMore is true when more records exist beyond the first page", async () => {
    const catalogDb = await openCatalogDb();
    await putRecordsBatch(
      catalogDb,
      "vod",
      Array.from({ length: 90 }, (_, i) => vodRecord(String(i), `Movie ${i}`)),
    );

    const { result } = renderHook(() => useVodCatalogPage("source-1"));
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));

    expect(result.current.items).toHaveLength(60); // PAGE_SIZE
    expect(result.current.hasMore).toBe(true);
  });

  it("loadMore appends the next page without duplicating already-loaded items", async () => {
    const catalogDb = await openCatalogDb();
    await putRecordsBatch(
      catalogDb,
      "vod",
      Array.from({ length: 90 }, (_, i) => vodRecord(String(i), `Movie ${i}`)),
    );

    const { result } = renderHook(() => useVodCatalogPage("source-1"));
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(90));

    expect(result.current.hasMore).toBe(false);
    expect(new Set(result.current.items.map((i) => i.id)).size).toBe(90);
  });

  it("filters by categoryId and re-fetches when it changes", async () => {
    const catalogDb = await openCatalogDb();
    await putRecordsBatch(catalogDb, "vod", [vodRecord("1", "Action Movie", "action"), vodRecord("2", "Comedy Movie", "comedy")]);

    const { result, rerender } = renderHook(({ categoryId }: { categoryId?: string }) => useVodCatalogPage("source-1", { categoryId }), {
      initialProps: { categoryId: "action" as string | undefined },
    });
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));
    expect(result.current.items.map((i) => i.name)).toEqual(["Action Movie"]);

    rerender({ categoryId: "comedy" });
    await waitFor(() => expect(result.current.items.map((i) => i.name)).toEqual(["Comedy Movie"]));
  });

  it("does not fetch when disabled, and clears items", async () => {
    const catalogDb = await openCatalogDb();
    await putRecordsBatch(catalogDb, "vod", [vodRecord("1", "Movie")]);

    const { result } = renderHook(() => useVodCatalogPage("source-1", { enabled: false }));

    expect(result.current.isInitialLoading).toBe(false);
    expect(result.current.items).toEqual([]);
  });

  it("re-fetches when catalog-sync bumps this source's version (a background sync completed)", async () => {
    const { result } = renderHook(() => useVodCatalogPage("source-1"));
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));
    expect(result.current.items).toEqual([]);

    const catalogDb = await openCatalogDb();
    await putRecordsBatch(catalogDb, "vod", [vodRecord("1", "Newly Synced Movie")]);
    act(() => bumpCacheVersion(catalogVersionKey("source-1", "vod")));

    await waitFor(() => expect(result.current.items.map((i) => i.name)).toEqual(["Newly Synced Movie"]));
  });
});
