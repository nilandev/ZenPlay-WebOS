import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCacheInvalidationStore } from "./cache-invalidation-store.js";
import { __resetIdbStoreForTests, clearStore, getAllEntries, openIdbStore, putEntry } from "./core/storage/indexeddb-store.js";
import {
  clearAllCachedContent,
  clearCachedContent,
  clearCachedContentForSource,
  getCachedContent,
  initContentCacheFromIdb,
  isCacheStale,
  setCachedContent,
} from "./content-cache.js";

/** Lets IDB's fire-and-forget writes/reads (see content-cache.ts's writeToIdbStore) settle before assertions that depend on them. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("content cache", () => {
  beforeEach(async () => {
    sessionStorage.clear();
    __resetIdbStoreForTests();
    // fake-indexeddb's underlying database persists across openIdbStore()
    // calls within this file (only the module-level connection cache is
    // reset above) — clear its contents too so one test's writes can't leak
    // into another's assertions about "every entry"/"only these keys".
    const store = await openIdbStore();
    await clearStore(store);
  });

  it("returns undefined for a key that was never cached", () => {
    expect(getCachedContent("nonexistent")).toBeUndefined();
  });

  it("round-trips a plain object through set/get", () => {
    setCachedContent("channels:1", [{ id: "a", name: "Channel A" }], "catalog");
    expect(getCachedContent("channels:1")).toEqual([{ id: "a", name: "Channel A" }]);
  });

  it("persists to sessionStorage so a fresh in-memory cache can still read it", () => {
    setCachedContent("epg:1", [{ title: "News" }], "epg");
    // Simulate a reload: sessionStorage survives, but nothing simulates
    // clearing the in-memory Map here since it's module-level — instead we
    // verify the sessionStorage entry itself was written with the expected key prefix.
    // Stored as {value, cachedAt, kind} so isCacheStale can check entry age against its kind's threshold (see below).
    const raw = sessionStorage.getItem("iptv.cache.v1:epg:1");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).value).toEqual([{ title: "News" }]);
    expect(JSON.parse(raw!).kind).toBe("epg");
  });

  it("revives ISO date strings back into Date instances on read", () => {
    const programme = { title: "News", start: new Date("2024-01-15T20:00:00.000Z") };
    setCachedContent("epg-with-date", programme, "epg");

    // Force a sessionStorage-backed read path by using a cache key that
    // hasn't been touched by this test's in-memory cache yet is not
    // possible directly (module-level Map persists across it() calls in
    // the same file) — instead, confirm the *stored* JSON round-trips
    // correctly through JSON.parse + the reviver used internally.
    const raw = sessionStorage.getItem("iptv.cache.v1:epg-with-date");
    const revived = JSON.parse(raw!, (_key, value) =>
      typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ? new Date(value) : value,
    );
    expect(revived.value.start).toBeInstanceOf(Date);
    expect(revived.value.start.toISOString()).toBe("2024-01-15T20:00:00.000Z");
  });

  it("does not mistake an arbitrary string for a date", () => {
    setCachedContent("not-a-date", { label: "2024-01-15" }, "catalog");
    expect(getCachedContent<{ label: string }>("not-a-date")?.label).toBe("2024-01-15");
  });

  it("treats a corrupt sessionStorage entry as a cache miss instead of throwing", () => {
    sessionStorage.setItem("iptv.cache.v1:corrupt", "{not valid json");
    expect(() => getCachedContent("corrupt")).not.toThrow();
  });

  describe("when sessionStorage.setItem throws (quota exceeded)", () => {
    let setItemSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    });

    afterEach(() => {
      setItemSpy.mockRestore();
    });

    it("still serves the value from the in-memory tier without throwing", () => {
      expect(() => setCachedContent("large-epg", { huge: "payload" }, "epg")).not.toThrow();
      expect(getCachedContent("large-epg")).toEqual({ huge: "payload" });
    });
  });

  describe("isCacheStale", () => {
    it("is stale (true) for a key that was never cached", () => {
      expect(isCacheStale("never-cached")).toBe(true);
    });

    it("is fresh (false) immediately after caching", () => {
      setCachedContent("fresh-key", { ok: true }, "catalog");
      expect(isCacheStale("fresh-key")).toBe(false);
    });

    it("becomes stale once a catalog entry's age exceeds its multi-hour freshness window", () => {
      const now = Date.now();
      const dateSpy = vi.spyOn(Date, "now").mockReturnValue(now);
      setCachedContent("aging-catalog", { ok: true }, "catalog");
      expect(isCacheStale("aging-catalog")).toBe(false);

      dateSpy.mockReturnValue(now + 10 * 60 * 1000); // 10 minutes later — well within catalog's hours-long window
      expect(isCacheStale("aging-catalog")).toBe(false);

      dateSpy.mockReturnValue(now + 4 * 60 * 60 * 1000); // 4 hours later — past catalog's 3-hour window
      expect(isCacheStale("aging-catalog")).toBe(true);
      dateSpy.mockRestore();
    });

    it("uses a much shorter freshness window for epg than for catalog entries", () => {
      const now = Date.now();
      const dateSpy = vi.spyOn(Date, "now").mockReturnValue(now);
      setCachedContent("aging-epg", { ok: true }, "epg");

      dateSpy.mockReturnValue(now + 25 * 60 * 1000); // 25 minutes later — past epg's 20-minute window, well within catalog's
      expect(isCacheStale("aging-epg")).toBe(true);
      dateSpy.mockRestore();
    });
  });

  describe("IndexedDB persistent tier", () => {
    it("writes through to IndexedDB when content is cached", async () => {
      setCachedContent("idb-key", { ok: true }, "catalog");
      await flushMicrotasks();

      const store = await openIdbStore();
      const entries = await getAllEntries<{ value: unknown }>(store);
      expect(entries.find(([key]) => key === "idb-key")?.[1].value).toEqual({ ok: true });
    });

    it("removes the IndexedDB entry when the key is cleared", async () => {
      setCachedContent("to-clear", { ok: true }, "catalog");
      await flushMicrotasks();
      clearCachedContent("to-clear");
      await flushMicrotasks();

      const store = await openIdbStore();
      const entries = await getAllEntries(store);
      expect(entries.find(([key]) => key === "to-clear")).toBeUndefined();
    });

    it("removes every key for a source when clearCachedContentForSource is called", async () => {
      setCachedContent("live:source-9", [], "catalog");
      setCachedContent("vod:source-9", [], "catalog");
      setCachedContent("live:source-other", [], "catalog");
      await flushMicrotasks();

      clearCachedContentForSource("source-9");
      await flushMicrotasks();

      const store = await openIdbStore();
      const keys = (await getAllEntries(store)).map(([key]) => key);
      expect(keys).not.toContain("live:source-9");
      expect(keys).not.toContain("vod:source-9");
      expect(keys).toContain("live:source-other");
    });

    it("clears every IndexedDB entry when clearAllCachedContent is called", async () => {
      setCachedContent("a", 1, "catalog");
      setCachedContent("b", 2, "epg");
      await flushMicrotasks();

      clearAllCachedContent();
      await flushMicrotasks();

      const store = await openIdbStore();
      expect(await getAllEntries(store)).toEqual([]);
    });
  });

  describe("initContentCacheFromIdb", () => {
    it("warms the in-memory tier from a value that only exists in IndexedDB (simulating a cold start after sessionStorage was wiped)", async () => {
      const store = await openIdbStore();
      await putEntry(store, "cold-start-key", { value: { restored: true }, cachedAt: Date.now(), kind: "catalog" });

      expect(getCachedContent("cold-start-key")).toBeUndefined();

      await initContentCacheFromIdb();

      expect(getCachedContent("cold-start-key")).toEqual({ restored: true });
    });

    it("bumps the invalidation version for each key it restores, so a mounted screen can react", async () => {
      const store = await openIdbStore();
      await putEntry(store, "notify-me", { value: 42, cachedAt: Date.now(), kind: "catalog" });

      const before = useCacheInvalidationStore.getState().versions["notify-me"] ?? 0;
      await initContentCacheFromIdb();
      const after = useCacheInvalidationStore.getState().versions["notify-me"] ?? 0;

      expect(after).toBe(before + 1);
    });

    it("does not overwrite a value the in-memory tier already has this session", async () => {
      setCachedContent("already-fresh", { fromMemory: true }, "catalog");

      const store = await openIdbStore();
      await putEntry(store, "already-fresh", { value: { fromIdb: true }, cachedAt: Date.now(), kind: "catalog" });

      await initContentCacheFromIdb();

      expect(getCachedContent("already-fresh")).toEqual({ fromMemory: true });
    });
  });
});
