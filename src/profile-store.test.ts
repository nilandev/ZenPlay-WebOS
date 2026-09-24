import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  WATCH_HISTORY_LIMIT,
  clearWatchHistory,
  deleteProfile,
  getResumePoint,
  loadWatchHistory,
  recordWatchHistory,
  removeWatchHistory,
  upsertContinueWatching,
} from "./profile-store.js";

function save(contentId: string, positionSeconds: number, durationSeconds: number, episodeId?: string): void {
  upsertContinueWatching({
    profileId: "p1",
    contentId,
    contentKind: episodeId ? "series-episode" : "movie",
    episodeId,
    positionSeconds,
    durationSeconds,
    updatedAt: new Date().toISOString(),
  });
}

describe("getResumePoint", () => {
  beforeEach(() => localStorage.clear());

  it("offers the saved position for a film part-way through", () => {
    save("m1", 2832, 7200);
    expect(getResumePoint("p1", "m1")).toEqual({ positionSeconds: 2832, durationSeconds: 7200 });
    expect(getResumePoint("p2", "m1")).toBeNull(); // another profile's progress
  });

  it("skips barely-started and practically finished titles", () => {
    save("m1", 12, 7200);
    save("m2", 7150, 7200);
    expect(getResumePoint("p1", "m1")).toBeNull();
    expect(getResumePoint("p1", "m2")).toBeNull();
  });

  it("matches the exact episode of a series", () => {
    save("s1", 600, 2700, "e2");
    expect(getResumePoint("p1", "s1", "e2")).toEqual({ positionSeconds: 600, durationSeconds: 2700 });
    expect(getResumePoint("p1", "s1", "e3")).toBeNull();
    expect(getResumePoint("p1", "s1")).toBeNull();
  });
});

describe("watch history", () => {
  beforeEach(() => localStorage.clear());
  const base = { profileId: "p1", sourceId: "s1", kind: "movie" as const, title: "Film" };

  it("keeps one entry per title, newest first, per profile and playlist", () => {
    recordWatchHistory({ ...base, contentId: "a" });
    recordWatchHistory({ ...base, contentId: "b" });
    recordWatchHistory({ ...base, contentId: "a", positionSeconds: 90 });
    recordWatchHistory({ ...base, sourceId: "s2", contentId: "c" });
    const list = loadWatchHistory("p1", "s1");
    expect(list.map((e) => e.contentId)).toEqual(["a", "b"]);
    expect(list[0].positionSeconds).toBe(90);
    expect(loadWatchHistory("p1", "s2").map((e) => e.contentId)).toEqual(["c"]);
  });

  it(`drops the oldest beyond ${WATCH_HISTORY_LIMIT}`, () => {
    vi.useFakeTimers();
    for (let i = 0; i < WATCH_HISTORY_LIMIT + 5; i++) {
      vi.setSystemTime(new Date(2026, 0, 1, 0, i));
      recordWatchHistory({ ...base, contentId: `m${i}` });
    }
    vi.useRealTimers();
    const list = loadWatchHistory("p1", "s1");
    expect(list).toHaveLength(WATCH_HISTORY_LIMIT);
    expect(list[0].contentId).toBe(`m${WATCH_HISTORY_LIMIT + 4}`);
    expect(list.some((e) => e.contentId === "m0")).toBe(false);
  });

  it("removes one, clears a playlist's history, and forgets a deleted profile's", () => {
    recordWatchHistory({ ...base, contentId: "a" });
    recordWatchHistory({ ...base, contentId: "b" });
    recordWatchHistory({ ...base, profileId: "p2", contentId: "z" });
    removeWatchHistory({ ...base, contentId: "a" });
    expect(loadWatchHistory("p1", "s1").map((e) => e.contentId)).toEqual(["b"]);
    clearWatchHistory("p1", "s1");
    expect(loadWatchHistory("p1", "s1")).toEqual([]);
    deleteProfile("p2");
    expect(loadWatchHistory("p2", "s1")).toEqual([]);
  });
});
