import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetIdbStoreForTests, clearStore, getAllKeys, getEntry, openIdbStore, putEntry } from "./core/storage/indexeddb-store.js";
import {
  __resetMemoryCacheForTests,
  clearAllCachedContent,
  clearCachedContent,
  clearCachedContentForSource,
  clearCachedContentMatching,
  getCachedContent,
  isCacheStale,
  loadCachedEntry,
  purgeLegacyCacheEntries,
  setCachedContent,
} from "./content-cache.js";

async function storedKeys(): Promise<string[]> {
  return getAllKeys(await openIdbStore());
}
/** Writes/deletes to IndexedDB are fire-and-forget — wait until the stored keys settle into the expected set. */
async function expectStoredKeys(expected: string[]): Promise<void> {
  await vi.waitFor(async () => expect((await storedKeys()).sort()).toEqual([...expected].sort()));
}

describe("content cache", () => {
  beforeEach(async () => {
    sessionStorage.clear();
    __resetMemoryCacheForTests();
    __resetIdbStoreForTests();
    await clearStore(await openIdbStore());
  });

  it("returns undefined for a key that was never cached", () => {
    expect(getCachedContent("nonexistent")).toBeUndefined();
  });

  it("round-trips a value through set/get synchronously", () => {
    setCachedContent("live-categories:1", [{ id: "a", name: "News" }], "category");
    expect(getCachedContent("live-categories:1")).toEqual([{ id: "a", name: "News" }]);
  });

  it("never writes to sessionStorage", () => {
    setCachedContent("playlist-info:1", { name: "Provider" }, "playlist-info");
    expect(sessionStorage.length).toBe(0);
  });

  describe("lazy IndexedDB reads (cold start)", () => {
    it("reads a value that only exists in IndexedDB, keeping Dates as Dates, then serves it from memory", async () => {
      const expiresAt = new Date("2027-05-01T00:00:00.000Z");
      await putEntry(await openIdbStore(), "playlist-info:1", { value: { name: "Provider", expiresAt }, cachedAt: Date.now(), kind: "playlist-info" });
      expect(getCachedContent("playlist-info:1")).toBeUndefined(); // memory-only until loaded

      const entry = await loadCachedEntry<{ name: string; expiresAt: Date }>("playlist-info:1");
      expect(entry?.value.expiresAt).toBeInstanceOf(Date);
      expect(entry?.value.expiresAt.getTime()).toBe(expiresAt.getTime());
      expect(getCachedContent("playlist-info:1")).toEqual({ name: "Provider", expiresAt });
      expect(isCacheStale("playlist-info:1")).toBe(false);
    });

    it("resolves undefined for a key stored nowhere", async () => {
      await expect(loadCachedEntry("missing")).resolves.toBeUndefined();
    });

    it("doesn't let a read already in flight undo a clear", async () => {
      await putEntry(await openIdbStore(), "vod-categories:1", { value: ["old"], cachedAt: Date.now(), kind: "category" });
      const read = loadCachedEntry("vod-categories:1");
      clearCachedContent("vod-categories:1");
      await expect(read).resolves.toBeUndefined();
      expect(getCachedContent("vod-categories:1")).toBeUndefined();
    });

    it("doesn't let a read already in flight overwrite a newer write", async () => {
      await putEntry(await openIdbStore(), "vod-categories:1", { value: ["old"], cachedAt: Date.now(), kind: "category" });
      const read = loadCachedEntry("vod-categories:1");
      setCachedContent("vod-categories:1", ["new"], "category");
      await expect(read).resolves.toMatchObject({ value: ["new"] });
      expect(getCachedContent("vod-categories:1")).toEqual(["new"]);
    });
  });

  describe("isCacheStale", () => {
    afterEach(() => vi.restoreAllMocks());

    it("is stale for a key that isn't in memory", () => {
      expect(isCacheStale("never-cached")).toBe(true);
    });

    it("is fresh immediately after caching", () => {
      setCachedContent("fresh", { ok: true }, "catalog");
      expect(isCacheStale("fresh")).toBe(false);
    });

    it("uses each kind's own freshness window", () => {
      const now = 1_700_000_000_000;
      const dateSpy = vi.spyOn(Date, "now").mockReturnValue(now);
      setCachedContent("aging-epg", { ok: true }, "epg");
      setCachedContent("aging-catalog", { ok: true }, "catalog");

      dateSpy.mockReturnValue(now + 25 * 60 * 1000); // past epg's 20 minutes, well within catalog's hours
      expect(isCacheStale("aging-epg")).toBe(true);
      expect(isCacheStale("aging-catalog")).toBe(false);

      dateSpy.mockReturnValue(now + 3 * 60 * 60 * 1000 + 1);
      expect(isCacheStale("aging-catalog")).toBe(true);
    });
  });

  describe("IndexedDB tier", () => {
    it("writes through when content is cached", async () => {
      setCachedContent("series-categories:1", ["a"], "category");
      await expectStoredKeys(["series-categories:1"]);
      expect(await getEntry(await openIdbStore(), "series-categories:1")).toMatchObject({ value: ["a"], kind: "category" });
    });

    it("removes the entry when the key is cleared", async () => {
      setCachedContent("drop-me", 1, "category");
      await expectStoredKeys(["drop-me"]);
      clearCachedContent("drop-me");
      expect(getCachedContent("drop-me")).toBeUndefined();
      await expectStoredKeys([]);
    });

    it("clears every key for one source, and only that source", async () => {
      setCachedContent("vod-categories:source-1", 1, "category");
      setCachedContent("playlist-info:source-1", 2, "playlist-info");
      setCachedContent("vod-categories:source-2", 3, "category");
      setCachedContent("vod:source-1:cat:7", 4, "catalog");
      setCachedContent("series-details:source-1:42", 5, "catalog");
      await expectStoredKeys(["vod-categories:source-1", "playlist-info:source-1", "vod-categories:source-2", "vod:source-1:cat:7", "series-details:source-1:42"]);

      clearCachedContentForSource("source-1");
      expect(getCachedContent("vod-categories:source-1")).toBeUndefined();
      expect(getCachedContent("vod-categories:source-2")).toBe(3);
      await expectStoredKeys(["vod-categories:source-2"]);
    });

    it("clears by predicate, including keys only in IndexedDB", async () => {
      const store = await openIdbStore();
      await putEntry(store, "vod:1", { value: [], cachedAt: 0, kind: "catalog" });
      await putEntry(store, "vod:1:cat:7", { value: [], cachedAt: 0, kind: "catalog" });
      await putEntry(store, "vod-categories:1", { value: [], cachedAt: 0, kind: "category" });

      clearCachedContentMatching((key) => key === "vod:1" || key.startsWith("vod:1:cat:"));
      await expectStoredKeys(["vod-categories:1"]);
    });

    it("clears everything on clearAllCachedContent", async () => {
      setCachedContent("a", 1, "category");
      setCachedContent("b", 2, "category");
      await expectStoredKeys(["a", "b"]);
      clearAllCachedContent();
      expect(getCachedContent("a")).toBeUndefined();
      await expectStoredKeys([]);
    });
  });

  describe("purgeLegacyCacheEntries", () => {
    it("deletes pre-table blobs and the old sessionStorage tier, keeping everything else", async () => {
      const store = await openIdbStore();
      for (const key of ["live:1", "guide-channels:1", "guide-epg:1", "live-categories:1", "playlist-info:1"]) {
        await putEntry(store, key, { value: key, cachedAt: 0, kind: "category" });
      }
      sessionStorage.setItem("iptv.cache.v1:live:1", "{}");
      sessionStorage.setItem("unrelated", "keep");

      await purgeLegacyCacheEntries();

      expect((await storedKeys()).sort()).toEqual(["live-categories:1", "playlist-info:1"]);
      expect(sessionStorage.getItem("iptv.cache.v1:live:1")).toBeNull();
      expect(sessionStorage.getItem("unrelated")).toBe("keep");
    });
  });
});
