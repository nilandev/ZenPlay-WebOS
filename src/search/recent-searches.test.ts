import { beforeEach, describe, expect, it } from "vitest";
import { deleteProfile, removeSourceUserData } from "../profile-store.js";
import { loadRecentSearches, recordRecentSearch, RECENT_SEARCH_LIMIT } from "./recent-searches.js";

beforeEach(() => localStorage.clear());

describe("recent searches", () => {
  it("keeps the newest first, without repeats, up to the limit", () => {
    recordRecentSearch("p1", "s1", "Matrix");
    recordRecentSearch("p1", "s1", "news");
    recordRecentSearch("p1", "s1", " matrix ");
    expect(loadRecentSearches("p1", "s1")).toEqual(["matrix", "news"]);

    for (let i = 0; i < RECENT_SEARCH_LIMIT + 5; i++) recordRecentSearch("p1", "s1", `q${i}`);
    expect(loadRecentSearches("p1", "s1")).toHaveLength(RECENT_SEARCH_LIMIT);
    expect(loadRecentSearches("p1", "s1")[0]).toBe(`q${RECENT_SEARCH_LIMIT + 4}`);
  });

  it("keeps profiles and playlists apart, and is cleared with them", () => {
    recordRecentSearch("p1", "s1", "a");
    recordRecentSearch("p1", "s2", "b");
    recordRecentSearch("p2", "s1", "c");
    expect(loadRecentSearches("p2", "s2")).toEqual([]);

    removeSourceUserData("s2");
    expect(loadRecentSearches("p1", "s2")).toEqual([]);
    expect(loadRecentSearches("p1", "s1")).toEqual(["a"]);

    deleteProfile("p1");
    expect(loadRecentSearches("p1", "s1")).toEqual([]);
    expect(loadRecentSearches("p2", "s1")).toEqual(["c"]);
  });
});
