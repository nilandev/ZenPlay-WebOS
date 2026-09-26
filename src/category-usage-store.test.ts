import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  frequentCategoryIds,
  recordCategoryUse,
  removeProfileCategoryUsage,
  removeSourceCategoryUsage,
  splitByFrequency,
} from "./category-usage-store.js";

describe("category usage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it("ranks by how often a category is opened, the more recent first on a tie, capped at the limit", () => {
    vi.useFakeTimers();
    for (const [id, times] of [["action", 3], ["drama", 1], ["comedy", 3], ["kids", 2]] as const) {
      for (let i = 0; i < times; i++) {
        vi.advanceTimersByTime(1000);
        recordCategoryUse("p1", "s1", "vod", id);
      }
    }
    expect(frequentCategoryIds("p1", "s1", "vod")).toEqual(["comedy", "action", "kids", "drama"]);
    expect(frequentCategoryIds("p1", "s1", "vod", 2)).toEqual(["comedy", "action"]);
  });

  it("keeps profiles, playlists and Movies/Series apart", () => {
    recordCategoryUse("p1", "s1", "vod", "action");
    expect(frequentCategoryIds("p2", "s1", "vod")).toEqual([]);
    expect(frequentCategoryIds("p1", "s2", "vod")).toEqual([]);
    expect(frequentCategoryIds("p1", "s1", "series")).toEqual([]);
  });

  it("forgets a removed playlist's or profile's usage only", () => {
    recordCategoryUse("p1", "s1", "vod", "a");
    recordCategoryUse("p1", "s2", "vod", "b");
    recordCategoryUse("p2", "s2", "series", "c");

    removeSourceCategoryUsage("s1");
    expect(frequentCategoryIds("p1", "s1", "vod")).toEqual([]);
    expect(frequentCategoryIds("p1", "s2", "vod")).toEqual(["b"]);

    removeProfileCategoryUsage("p1");
    expect(frequentCategoryIds("p1", "s2", "vod")).toEqual([]);
    expect(frequentCategoryIds("p2", "s2", "series")).toEqual(["c"]);
  });

  it("splits categories into the frequent ones (usage order) and the rest (original order), skipping ids that no longer exist", () => {
    const categories = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    expect(splitByFrequency(categories, ["c", "gone", "a"])).toEqual({ frequent: [{ id: "c" }, { id: "a" }], rest: [{ id: "b" }, { id: "d" }] });
  });
});
