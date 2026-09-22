import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { XtreamCredentials } from "@core";
import { __resetRequestDedupeCacheForTests } from "./core/xtream/xtream-client.js";
import { __clearCatalogDbForTests, __resetCatalogDbForTests, getSyncMeta, openCatalogDb, queryPage } from "./core/storage/catalog-db.js";

const syncCatalogMock = vi.fn();

// Same rationale as content-loader.test.ts: the worker protocol itself has
// its own dedicated coverage in catalog-worker-client.test.ts, so here only
// catalog-sync.ts's own responsibility (auth-first, batching writes,
// generation swap, due-check gating) is under test.
vi.mock("./workers/catalog-worker-client.js", () => ({
  createCatalogWorkerClient: () => ({ fetchCatalog: vi.fn(), syncCatalog: syncCatalogMock, terminate: vi.fn() }),
}));

const { isCatalogSyncDue, hasCompletedSync, syncCatalog, __resetCatalogSyncForTests } = await import("./catalog-sync.js");

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

describe("catalog-sync", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    __resetRequestDedupeCacheForTests();
    __resetCatalogSyncForTests();
    __resetCatalogDbForTests();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    syncCatalogMock.mockReset();
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
      syncCatalogMock.mockImplementation(async (_req, onBatch) => {
        onBatch([{ id: "1", name: "Movie", groupTitle: "action", streamUrl: "http://x/1", kind: "movie" }]);
        return { total: 1 };
      });

      await syncCatalog(xtreamSource, "vod");

      await expect(isCatalogSyncDue("source-1", "vod")).resolves.toBe(false);
    });
  });

  describe("hasCompletedSync", () => {
    it("is false before any sync", async () => {
      await expect(hasCompletedSync("source-1", "vod")).resolves.toBe(false);
    });

    it("is true after a sync completes", async () => {
      fetchMock.mockResolvedValueOnce(AUTH_OK);
      syncCatalogMock.mockImplementation(async (_req, onBatch) => {
        onBatch([{ id: "1", name: "Movie", groupTitle: "action", streamUrl: "http://x/1", kind: "movie" }]);
        return { total: 1 };
      });

      await syncCatalog(xtreamSource, "vod");

      await expect(hasCompletedSync("source-1", "vod")).resolves.toBe(true);
    });
  });

  describe("syncCatalog", () => {
    it("authenticates before delegating to the worker, surfacing a bad login as XtreamAuthError", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ user_info: { auth: 0 }, server_info: {} }));

      await expect(syncCatalog(xtreamSource, "vod")).rejects.toThrow();
      expect(syncCatalogMock).not.toHaveBeenCalled();
    });

    it("writes every batch into the local table under a new generation", async () => {
      fetchMock.mockResolvedValueOnce(AUTH_OK);
      syncCatalogMock.mockImplementation(async (_req, onBatch) => {
        onBatch([
          { id: "1", name: "Alpha", groupTitle: "action", streamUrl: "http://x/1", kind: "movie" },
          { id: "2", name: "Beta", groupTitle: "comedy", streamUrl: "http://x/2", kind: "movie" },
        ]);
        onBatch([{ id: "3", name: "Gamma", groupTitle: "action", streamUrl: "http://x/3", kind: "movie" }]);
        return { total: 3 };
      });

      await syncCatalog(xtreamSource, "vod");

      const catalogDb = await openCatalogDb();
      const page = await queryPage(catalogDb, "vod", { sourceId: "source-1", offset: 0, limit: 10 });
      expect(page.map((r) => r.name).sort()).toEqual(["Alpha", "Beta", "Gamma"]);
    });

    it("records sync_meta with the total count and a bumped generation", async () => {
      fetchMock.mockResolvedValueOnce(AUTH_OK);
      syncCatalogMock.mockImplementation(async (_req, onBatch) => {
        onBatch([{ id: "1", name: "Alpha", streamUrl: "http://x/1", kind: "movie" }]);
        return { total: 1 };
      });

      await syncCatalog(xtreamSource, "vod");

      const catalogDb = await openCatalogDb();
      const meta = await getSyncMeta(catalogDb, "vod:source-1");
      expect(meta).toMatchObject({ recordCount: 1, generation: 1 });
    });

    it("a second sync bumps the generation and removes the previous generation's records that are gone from the new fetch", async () => {
      fetchMock.mockResolvedValueOnce(AUTH_OK);
      syncCatalogMock.mockImplementationOnce(async (_req, onBatch) => {
        onBatch([{ id: "1", name: "Old Only", streamUrl: "http://x/1", kind: "movie" }]);
        return { total: 1 };
      });
      await syncCatalog(xtreamSource, "vod");

      fetchMock.mockResolvedValueOnce(AUTH_OK);
      syncCatalogMock.mockImplementationOnce(async (_req, onBatch) => {
        onBatch([{ id: "2", name: "New Only", streamUrl: "http://x/2", kind: "movie" }]);
        return { total: 1 };
      });
      await syncCatalog(xtreamSource, "vod");

      const catalogDb = await openCatalogDb();
      const page = await queryPage(catalogDb, "vod", { sourceId: "source-1", offset: 0, limit: 10 });
      expect(page.map((r) => r.name)).toEqual(["New Only"]);

      const meta = await getSyncMeta(catalogDb, "vod:source-1");
      expect(meta?.generation).toBe(2);
    });

    it("does nothing for a non-Xtream source", async () => {
      const m3uSource = { kind: "m3u-file" as const, id: "m3u-1", name: "M3U", content: "" };
      await syncCatalog(m3uSource, "vod");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(syncCatalogMock).not.toHaveBeenCalled();
    });

    it("dedupes overlapping calls for the same source+kind into one in-flight sync", async () => {
      fetchMock.mockResolvedValueOnce(AUTH_OK);
      syncCatalogMock.mockImplementation(async (_req, onBatch) => {
        onBatch([{ id: "1", name: "Alpha", streamUrl: "http://x/1", kind: "movie" }]);
        return { total: 1 };
      });

      const first = syncCatalog(xtreamSource, "vod");
      const second = syncCatalog(xtreamSource, "vod");
      await Promise.all([first, second]);

      expect(fetchMock).toHaveBeenCalledTimes(1); // only one authenticate() call
      expect(syncCatalogMock).toHaveBeenCalledTimes(1);
    });
  });
});
