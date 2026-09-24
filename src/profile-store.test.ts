import { beforeEach, describe, expect, it } from "vitest";
import { getResumePoint, upsertContinueWatching } from "./profile-store.js";

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
