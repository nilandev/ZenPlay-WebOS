import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetSyncWorkerClientForTests } from "./workers/sync-worker-client.js";
import { updateSettings } from "./settings-store.js";
import { getCachedContent, setCachedContent } from "./content-cache.js";
import type { XtreamCredentials } from "@core";
import { __resetRequestDedupeCacheForTests } from "./core/xtream/xtream-client.js";
import { __clearCatalogDbForTests, __resetCatalogDbForTests, getSyncMeta, openCatalogDb, queryPage } from "./core/storage/catalog-db.js";

const { isCatalogSyncDue, hasCompletedSync, syncCatalog, refreshCatalogCategory, getCategoryRefreshedAt, __resetCatalogSyncForTests } = await import("./catalog-sync.js");

const xtreamSource: XtreamCredentials = {
  kind: "xtream",
  id: "source-1",
  name: "Test",
  baseUrl: "http://example.com",
  username: "user",
  password: "pass",
};

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as Response;
}

const AUTH_OK = jsonResponse({ user_info: { auth: 1, status: "Active", exp_date: null }, server_info: {} });
const vod = (id: number, name: string, categoryId = "action") => ({ stream_id: id, name, category_id: categoryId, container_extension: "mp4" });

describe("catalog-sync", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    __resetRequestDedupeCacheForTests();
    __resetCatalogSyncForTests();
    __resetCatalogDbForTests();
    // No Worker in the test environment: the job runs on the main-thread fallback, same code as in the worker.
    __resetSyncWorkerClientForTests({ workerAvailable: false });
    localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // Clear any records/meta left over from a previous test in this file
    // against the shared fake-indexeddb instance.
    await __clearCatalogDbForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("isCatalogSyncDue", () => {
    it("is due when no sync has ever completed", async () => {
      await expect(isCatalogSyncDue("source-1", "vod")).resolves.toBe(true);
    });

    it("is not due right after a completed sync", async () => {
      fetchMock.mockResolvedValueOnce(AUTH_OK);
      fetchMock.mockResolvedValueOnce(jsonResponse([vod(1, "Movie")]));

      await syncCatalog(xtreamSource, "vod");

      await expect(isCatalogSyncDue("source-1", "vod")).resolves.toBe(false);
    });
  });

  describe("catalog refresh interval", () => {
    it("follows the Movies & Series Sync Interval setting", async () => {
      fetchMock.mockResolvedValueOnce(AUTH_OK).mockResolvedValueOnce(jsonResponse([vod(1, "Movie")]));
      await syncCatalog(xtreamSource, "vod");
      const later = Date.now() + 30 * 60 * 60 * 1000; // 30h on
      vi.spyOn(Date, "now").mockReturnValue(later);
      try {
        await expect(isCatalogSyncDue("source-1", "vod")).resolves.toBe(false); // default 48h
        updateSettings({ catalogRefreshHours: 24 });
        await expect(isCatalogSyncDue("source-1", "vod")).resolves.toBe(true);
      } finally {
        vi.restoreAllMocks();
      }
    });
  });

  describe("refreshCatalogCategory", () => {
    it("updates one category only, leaving the rest of the catalog and its sync time alone", async () => {
      fetchMock.mockResolvedValueOnce(AUTH_OK).mockResolvedValueOnce(jsonResponse([vod(1, "Action One"), vod(2, "Action Two"), vod(3, "Comedy", "comedy")]));
      await syncCatalog(xtreamSource, "vod");
      const catalogDb = await openCatalogDb();
      const before = await getSyncMeta(catalogDb, "vod:source-1");

      __resetRequestDedupeCacheForTests();
      fetchMock.mockResolvedValueOnce(AUTH_OK).mockResolvedValueOnce(jsonResponse([vod(2, "Action Two"), vod(4, "Action Four")]));
      await expect(refreshCatalogCategory(xtreamSource, "vod", "action")).resolves.toMatchObject({ recordCount: 3, written: 1, deleted: 1 });

      expect(String(fetchMock.mock.calls[3][0])).toContain("category_id%3Daction");
      const page = await queryPage(catalogDb, "vod", { sourceId: "source-1", offset: 0, limit: 10 });
      expect(page.map((r) => r.name)).toEqual(["Action Four", "Comedy", "Action Two"]);
      expect(await getSyncMeta(catalogDb, "vod:source-1")).toEqual({ ...before, recordCount: 3 });
      expect(getCategoryRefreshedAt("source-1", "vod", "action")).toBeTypeOf("number");
    });

    it("refuses a catalog that has never been fully synced", async () => {
      fetchMock.mockResolvedValueOnce(AUTH_OK).mockResolvedValueOnce(jsonResponse([vod(1, "Alpha")]));
      await expect(refreshCatalogCategory(xtreamSource, "vod", "action")).rejects.toThrow();
      expect(await queryPage(await openCatalogDb(), "vod", { sourceId: "source-1", offset: 0, limit: 10 })).toEqual([]);
    });
  });

  describe("hasCompletedSync", () => {
    it("is false before any sync", async () => {
      await expect(hasCompletedSync("source-1", "vod")).resolves.toBe(false);
    });

    it("is true after a sync completes", async () => {
      fetchMock.mockResolvedValueOnce(AUTH_OK);
      fetchMock.mockResolvedValueOnce(jsonResponse([vod(1, "Movie")]));

      await syncCatalog(xtreamSource, "vod");

      await expect(hasCompletedSync("source-1", "vod")).resolves.toBe(true);
    });
  });

  describe("syncCatalog", () => {
    it("authenticates before delegating to the worker, surfacing a bad login as XtreamAuthError", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ user_info: { auth: 0 }, server_info: {} }));

      await expect(syncCatalog(xtreamSource, "vod")).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1); // the catalog was never requested
    });

    it("writes the downloaded catalog into the local table", async () => {
      fetchMock.mockResolvedValueOnce(AUTH_OK).mockResolvedValueOnce(jsonResponse([vod(1, "Alpha"), vod(2, "Beta", "comedy"), vod(3, "Gamma")]));

      await expect(syncCatalog(xtreamSource, "vod")).resolves.toMatchObject({ recordCount: 3, written: 3, deleted: 0 });

      const catalogDb = await openCatalogDb();
      const page = await queryPage(catalogDb, "vod", { sourceId: "source-1", offset: 0, limit: 10 });
      expect(page.map((r) => r.name).sort()).toEqual(["Alpha", "Beta", "Gamma"]);
      expect(String(fetchMock.mock.calls[1][0])).toContain("get_vod_streams");
    });

    it("frees the fallback path's cached VOD blobs once the table holds the catalog", async () => {
      setCachedContent("vod:source-1", [{ id: "old" }], "catalog");
      setCachedContent("vod:source-1:cat:7", [{ id: "old" }], "catalog");
      setCachedContent("vod-categories:source-1", [{ id: "7" }], "category");
      fetchMock.mockResolvedValueOnce(AUTH_OK).mockResolvedValueOnce(jsonResponse([vod(1, "Alpha")]));

      await syncCatalog(xtreamSource, "vod");

      expect(getCachedContent("vod:source-1")).toBeUndefined();
      expect(getCachedContent("vod:source-1:cat:7")).toBeUndefined();
      expect(getCachedContent("vod-categories:source-1")).toEqual([{ id: "7" }]); // categories are still needed
    });

    it("a second sync keeps the generation, writes only what changed and removes what's gone", async () => {
      fetchMock.mockResolvedValueOnce(AUTH_OK).mockResolvedValueOnce(jsonResponse([vod(1, "Old Only"), vod(2, "Kept")]));
      await syncCatalog(xtreamSource, "vod");

      __resetRequestDedupeCacheForTests(); // a real second sync is hours later — sign in again
      fetchMock.mockResolvedValueOnce(AUTH_OK).mockResolvedValueOnce(jsonResponse([vod(2, "Kept"), vod(3, "New Only")]));
      await expect(syncCatalog(xtreamSource, "vod")).resolves.toMatchObject({ recordCount: 2, written: 1, deleted: 1 });

      const catalogDb = await openCatalogDb();
      const page = await queryPage(catalogDb, "vod", { sourceId: "source-1", offset: 0, limit: 10 });
      expect(page.map((r) => r.name)).toEqual(["New Only", "Kept"]);
      expect(await getSyncMeta(catalogDb, "vod:source-1")).toMatchObject({ recordCount: 2, generation: 1 });
    });

    it("keeps the stored catalog when a refresh comes back empty", async () => {
      fetchMock.mockResolvedValueOnce(AUTH_OK).mockResolvedValueOnce(jsonResponse([vod(1, "Alpha")]));
      await syncCatalog(xtreamSource, "vod");

      __resetRequestDedupeCacheForTests();
      fetchMock.mockResolvedValueOnce(AUTH_OK).mockResolvedValueOnce(jsonResponse([]));
      await expect(syncCatalog(xtreamSource, "vod")).rejects.toMatchObject({ name: "CatalogEmptyError" });

      const page = await queryPage(await openCatalogDb(), "vod", { sourceId: "source-1", offset: 0, limit: 10 });
      expect(page.map((r) => r.name)).toEqual(["Alpha"]);
    });

    it("does nothing for a non-Xtream source", async () => {
      const m3uSource = { kind: "m3u-file" as const, id: "m3u-1", name: "M3U", content: "" };
      await syncCatalog(m3uSource, "vod");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("dedupes overlapping calls for the same source+kind into one in-flight sync", async () => {
      fetchMock.mockResolvedValueOnce(AUTH_OK).mockResolvedValueOnce(jsonResponse([vod(1, "Alpha")]));

      const first = syncCatalog(xtreamSource, "vod");
      const second = syncCatalog(xtreamSource, "vod");
      await Promise.all([first, second]);

      expect(fetchMock).toHaveBeenCalledTimes(2); // one authenticate() call, one download
    });
  });
});
