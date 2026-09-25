import { describe, expect, it } from "vitest";
import { buildKidsRails, itemKey, MAX_PER_CATEGORY, rankTags, tagAffinity, type RecHistoryEntry, type RecItem } from "./recommend.js";

const NOW = Date.parse("2026-09-25T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

function item(id: string, categoryId: string, tags: RecItem["tags"]): RecItem {
  return { kind: "vod", id, name: `Title ${id}`, categoryId, tags };
}

function watched(id: string, categoryId: string, tags: RecItem["tags"], days: number, completion = 1): RecHistoryEntry {
  return { kind: "vod", id, title: `Title ${id}`, categoryId, tags, updatedAt: daysAgo(days), completion, finished: completion >= 1 };
}

describe("tag affinity", () => {
  it("weighs recent, completed watching more", () => {
    const affinity = tagAffinity([watched("1", "c", ["learning"], 0), watched("2", "c", ["animation"], 14)], NOW);
    expect(affinity.learning).toBeCloseTo(1);
    expect(affinity.animation).toBeCloseTo(0.25);
    expect(rankTags(affinity)[0]).toBe("learning");
  });

  it("falls back to Animation → Family → Learning with no history", () => {
    expect(rankTags(tagAffinity([], NOW))).toEqual(["animation", "family", "learning", "kids"]);
  });
});

describe("buildKidsRails", () => {
  const cartoons = Array.from({ length: 10 }, (_, i) => item(`a${i}`, "vod:cartoons", ["animation"]));
  const family = Array.from({ length: 3 }, (_, i) => item(`f${i}`, "vod:family", ["family"]));

  it("orders the rails and drops empty ones", () => {
    const rails = buildKidsRails({
      now: NOW,
      history: [],
      continueWatching: [],
      parentPicks: [item("p1", "vod:other", [])],
      byCategory: new Map([
        ["vod:cartoons", cartoons],
        ["vod:family", family],
      ]),
      liveNow: [{ kind: "live", id: "ch1", name: "Nick Jr", tags: [] }],
    });
    expect(rails.map((r) => r.id)).toEqual(["parent-picks", "tag:animation", "tag:family", "live-now"]);
  });

  it("takes at most MAX_PER_CATEGORY from one category in a rail, and shows a title only once", () => {
    const rails = buildKidsRails({
      now: NOW,
      history: [],
      continueWatching: [],
      parentPicks: [],
      byCategory: new Map([
        ["vod:cartoons", cartoons],
        ["vod:family", family],
      ]),
      liveNow: [],
    });
    const animation = rails.find((r) => r.id === "tag:animation")!;
    expect(animation.items.filter((i) => i.categoryId === "vod:cartoons")).toHaveLength(MAX_PER_CATEGORY);
    const keys = rails.flatMap((r) => r.items.map(itemKey));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("adds Because you watched from the latest title's category, skipping what was finished", () => {
    const rails = buildKidsRails({
      now: NOW,
      history: [watched("a0", "vod:cartoons", ["animation"], 1)],
      continueWatching: [],
      parentPicks: [],
      byCategory: new Map([["vod:cartoons", cartoons]]),
      liveNow: [],
    });
    const because = rails.find((r) => r.id === "because")!;
    expect(because.title).toBe("Because you watched Title a0");
    expect(because.items.map((i) => i.id)).not.toContain("a0");
  });
});
