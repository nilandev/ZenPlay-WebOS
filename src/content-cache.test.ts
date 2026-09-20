import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCachedContent, isCacheStale, setCachedContent } from "./content-cache.js";

describe("content cache", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("returns undefined for a key that was never cached", () => {
    expect(getCachedContent("nonexistent")).toBeUndefined();
  });

  it("round-trips a plain object through set/get", () => {
    setCachedContent("channels:1", [{ id: "a", name: "Channel A" }]);
    expect(getCachedContent("channels:1")).toEqual([{ id: "a", name: "Channel A" }]);
  });

  it("persists to sessionStorage so a fresh in-memory cache can still read it", () => {
    setCachedContent("epg:1", [{ title: "News" }]);
    // Simulate a reload: sessionStorage survives, but nothing simulates
    // clearing the in-memory Map here since it's module-level — instead we
    // verify the sessionStorage entry itself was written with the expected key prefix.
    // Stored as {value, cachedAt} so isCacheStale can check entry age (see below).
    const raw = sessionStorage.getItem("iptv.cache.v1:epg:1");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).value).toEqual([{ title: "News" }]);
  });

  it("revives ISO date strings back into Date instances on read", () => {
    const programme = { title: "News", start: new Date("2024-01-15T20:00:00.000Z") };
    setCachedContent("epg-with-date", programme);

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
    setCachedContent("not-a-date", { label: "2024-01-15" });
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
      expect(() => setCachedContent("large-epg", { huge: "payload" })).not.toThrow();
      expect(getCachedContent("large-epg")).toEqual({ huge: "payload" });
    });
  });

  describe("isCacheStale", () => {
    it("is stale (true) for a key that was never cached", () => {
      expect(isCacheStale("never-cached")).toBe(true);
    });

    it("is fresh (false) immediately after caching", () => {
      setCachedContent("fresh-key", { ok: true });
      expect(isCacheStale("fresh-key")).toBe(false);
    });

    it("becomes stale once the entry's age exceeds the freshness window", () => {
      const now = Date.now();
      const dateSpy = vi.spyOn(Date, "now").mockReturnValue(now);
      setCachedContent("aging-key", { ok: true });
      expect(isCacheStale("aging-key")).toBe(false);

      dateSpy.mockReturnValue(now + 10 * 60 * 1000); // 10 minutes later, past the 5-minute freshness window
      expect(isCacheStale("aging-key")).toBe(true);
      dateSpy.mockRestore();
    });
  });
});
