import { beforeEach, describe, expect, it } from "vitest";
import type { PlaylistSource } from "@core";
import { __clearCatalogDbForTests, __resetCatalogDbForTests, openCatalogDb, putSyncMeta } from "../core/storage/catalog-db.js";
import { __clearLiveDbForTests, __resetLiveDbForTests, openLiveDb, putLiveSyncMeta } from "../core/storage/live-db.js";
import { __clearEpgDbForTests, __resetEpgDbForTests } from "../core/storage/epg-db.js";
import type { SourceSyncState } from "./sync-store.js";
import { describeRunningSync, describeSyncFailure, formatCounts, formatSyncedAgo, readSyncSummary } from "./sync-summary.js";

const xtream: PlaylistSource = { kind: "xtream", id: "src-1", name: "P", baseUrl: "http://tv.example", username: "u", password: "p" };
const m3u: PlaylistSource = { kind: "m3u-url", id: "src-2", name: "M", url: "http://tv.example/list.m3u" };
const state = (partial: Partial<SourceSyncState>): SourceSyncState => ({ isRunning: false, stages: {}, ...partial });

describe("sync wording", () => {
  it("formats how long ago", () => {
    const now = 1_000_000_000_000;
    expect(formatSyncedAgo(now - 20_000, now)).toBe("just now");
    expect(formatSyncedAgo(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(formatSyncedAgo(now - 2 * 3_600_000, now)).toBe("2h ago");
    expect(formatSyncedAgo(now - 26 * 3_600_000, now)).toBe("1 day ago");
    expect(formatSyncedAgo(now - 80 * 3_600_000, now)).toBe("3 days ago");
  });

  it("names the running stage and its progress", () => {
    expect(describeRunningSync(state({}))).toBeNull();
    expect(describeRunningSync(state({ isRunning: true, stages: { auth: { status: "running" } } }))).toBe("Signing in…");
    expect(describeRunningSync(state({ isRunning: true, stages: { epg: { status: "running", done: 0 } } }))).toBe("Syncing TV guide…");
    expect(describeRunningSync(state({ isRunning: true, stages: { live: { status: "running", done: 300 } } }), m3u)).toBe("Syncing Channels & movies… 300");
  });

  it("explains a failed run — sign-in errors on their own, otherwise naming what failed", () => {
    expect(describeSyncFailure(state({ stages: { live: { status: "synced" } } }))).toBeNull();
    expect(describeSyncFailure(state({ isRunning: true, stages: { vod: { status: "failed", error: "x" } } }))).toBeNull(); // not while still running
    expect(describeSyncFailure(state({ stages: { vod: { status: "failed", error: "HTTP 503" }, series: { status: "failed", error: "HTTP 503" } } }))).toEqual({
      stages: ["vod", "series"],
      message: "Movies, Series: HTTP 503",
    });
    expect(
      describeSyncFailure(state({ stages: { auth: { status: "failed", error: "Xtream authentication failed" }, live: { status: "skipped", error: "Xtream authentication failed" } } })),
    ).toEqual({ stages: ["auth", "live"], message: "Xtream authentication failed" });
    expect(describeSyncFailure(state({ stages: { live: { status: "skipped" }, vod: { status: "skipped" } } }))).toBeNull(); // cancelled isn't failed
  });

  it("lists only the counts it knows", () => {
    expect(formatCounts({ lastSyncedAt: 1, channels: 12430, movies: 48210 })).toBe(`${(12430).toLocaleString()} channels · ${(48210).toLocaleString()} movies`);
    expect(formatCounts({ lastSyncedAt: null })).toBe("");
  });
});

describe("readSyncSummary", () => {
  beforeEach(async () => {
    __resetLiveDbForTests();
    await __clearLiveDbForTests();
    __resetCatalogDbForTests();
    await __clearCatalogDbForTests();
    __resetEpgDbForTests();
    await __clearEpgDbForTests();
  });

  it("is null before anything has synced", async () => {
    await expect(readSyncSummary(xtream)).resolves.toMatchObject({ lastSyncedAt: null });
  });

  it("reports the oldest table's sync time — everything is at least that fresh — and each count", async () => {
    await putLiveSyncMeta(await openLiveDb(), { sourceId: xtream.id, lastSyncedAt: 5000, generation: 1, channelCount: 10 });
    await putSyncMeta(await openCatalogDb(), { key: `vod:${xtream.id}`, lastSyncedAt: 2000, recordCount: 20, generation: 1 });
    await putSyncMeta(await openCatalogDb(), { key: `series:${xtream.id}`, lastSyncedAt: 9000, recordCount: 30, generation: 1 });

    await expect(readSyncSummary(xtream)).resolves.toEqual({ lastSyncedAt: 2000, channels: 10, movies: 20, series: 30, programmes: undefined });
  });
});
