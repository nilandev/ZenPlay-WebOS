import { describe, expect, it } from "vitest";
import type { Channel, ContinueWatchingEntry, FavoriteEntry } from "@core";
import { ChannelGuide } from "@core";
import { pickHeroCandidate, pickHeroRotation, pickRecentlyAdded, resolveFavorites } from "./home-curation.js";

function liveChannel(overrides: Partial<Channel> & Pick<Channel, "id" | "name">): Channel {
  return { streamUrl: "http://x/live", kind: "live", ...overrides };
}

describe("pickHeroCandidate", () => {
  it("returns null when every input is empty", () => {
    const result = pickHeroCandidate({
      continueWatching: [],
      continueWatchingContent: new Map(),
      liveChannels: [],
      epgGuides: new Map(),
      recentVod: [],
    });
    expect(result).toBeNull();
  });

  it("prefers the most recently updated Continue Watching entry when its content resolves", () => {
    const older: ContinueWatchingEntry = {
      profileId: "p1",
      contentId: "movie-1",
      contentKind: "movie",
      positionSeconds: 10,
      durationSeconds: 100,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const newer: ContinueWatchingEntry = {
      profileId: "p1",
      contentId: "movie-2",
      contentKind: "movie",
      positionSeconds: 10,
      durationSeconds: 100,
      updatedAt: "2026-02-01T00:00:00.000Z",
    };

    const result = pickHeroCandidate({
      continueWatching: [older, newer],
      continueWatchingContent: new Map([
        ["movie-1", { title: "Older Movie" }],
        ["movie-2", { title: "Newer Movie" }],
      ]),
      liveChannels: [],
      epgGuides: new Map(),
      recentVod: [],
    });

    expect(result).toEqual({ kind: "continue-watching", contentKind: "movie", id: "movie-2", title: "Newer Movie", backdropUrl: undefined });
  });

  it("falls through to a live channel currently airing a highlight-worthy programme", () => {
    const channel = liveChannel({ id: "c1", name: "ESPN HD", groupTitle: "Sports" });
    const guide = new ChannelGuide([
      { channelId: "c1", title: "Big Match", start: new Date(Date.now() - 1000), stop: new Date(Date.now() + 1000 * 60 * 60) },
    ]);

    const result = pickHeroCandidate({
      continueWatching: [],
      continueWatchingContent: new Map(),
      liveChannels: [channel],
      epgGuides: new Map([["c1", guide]]),
      recentVod: [],
    });

    expect(result?.kind).toBe("live-now");
    expect(result?.nowPlayingTitle).toBe("Big Match");
  });

  it("skips a live channel that doesn't match the highlight keywords", () => {
    const channel = liveChannel({ id: "c1", name: "Local Access", groupTitle: "General" });
    const guide = new ChannelGuide([
      { channelId: "c1", title: "Whatever", start: new Date(Date.now() - 1000), stop: new Date(Date.now() + 1000 * 60 * 60) },
    ]);

    const result = pickHeroCandidate({
      continueWatching: [],
      continueWatchingContent: new Map(),
      liveChannels: [channel],
      epgGuides: new Map([["c1", guide]]),
      recentVod: [],
    });

    expect(result).toBeNull();
  });

  it("falls back to the first recently-added VOD item when nothing else matches", () => {
    const result = pickHeroCandidate({
      continueWatching: [],
      continueWatchingContent: new Map(),
      liveChannels: [],
      epgGuides: new Map(),
      recentVod: [{ id: "v1", name: "Fresh Movie", streamUrl: "http://x/v1", kind: "movie" }],
    });

    expect(result).toEqual({ kind: "recently-added", contentKind: "movie", id: "v1", title: "Fresh Movie", backdropUrl: undefined });
  });

  it("drops a Continue Watching entry whose content can't be resolved rather than throwing", () => {
    const entry: ContinueWatchingEntry = {
      profileId: "p1",
      contentId: "removed-movie",
      contentKind: "movie",
      positionSeconds: 10,
      durationSeconds: 100,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const result = pickHeroCandidate({
      continueWatching: [entry],
      continueWatchingContent: new Map(),
      liveChannels: [],
      epgGuides: new Map(),
      recentVod: [{ id: "v1", name: "Fallback Movie", streamUrl: "http://x/v1", kind: "movie" }],
    });

    expect(result?.id).toBe("v1");
  });
});

describe("pickHeroRotation", () => {
  it("returns an empty array when every input is empty", () => {
    expect(pickHeroRotation({ continueWatching: [], continueWatchingContent: new Map(), liveChannels: [], epgGuides: new Map(), recentVod: [] })).toEqual([]);
  });

  it("caps results at the requested count across mixed sources", () => {
    const recentVod: Channel[] = Array.from({ length: 10 }, (_, i) => ({
      id: `v${i}`,
      name: `Movie ${i}`,
      streamUrl: "http://x",
      kind: "movie" as const,
    }));

    const result = pickHeroRotation(
      { continueWatching: [], continueWatchingContent: new Map(), liveChannels: [], epgGuides: new Map(), recentVod },
      3,
    );

    expect(result).toHaveLength(3);
  });
});

describe("pickRecentlyAdded", () => {
  it("passes through an empty page without error", () => {
    expect(pickRecentlyAdded([])).toEqual([]);
  });
});

describe("resolveFavorites", () => {
  it("returns an empty array when there are no favorites", () => {
    expect(resolveFavorites([], new Map())).toEqual([]);
  });

  it("drops favorites whose content no longer resolves, keeping the rest", () => {
    const favorites: FavoriteEntry[] = [
      { profileId: "p1", sourceId: "s1", contentKind: "movie", contentId: "gone", addedAt: "2026-01-01T00:00:00.000Z" },
      { profileId: "p1", sourceId: "s1", contentKind: "movie", contentId: "here", addedAt: "2026-01-01T00:00:00.000Z" },
    ];
    const content = new Map([["here", { title: "Still Here" }]]);

    const result = resolveFavorites(favorites, content);

    expect(result).toEqual([{ entry: favorites[1], title: "Still Here", imageUrl: undefined }]);
  });
});
