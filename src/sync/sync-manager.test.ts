import { beforeEach, describe, expect, it, vi } from "vitest";
import { XtreamAuthError, type PlaylistSource } from "@core";
import { __resetMemoryCacheForTests, clearAllCachedContent, getCachedContent } from "../content-cache.js";
import { __resetSyncManagerForTests, cancelSync, isSyncRunning, syncSource } from "./sync-manager.js";
import { __resetSyncStoreForTests, getSourceSyncState } from "./sync-store.js";

const m = vi.hoisted(() => ({
  events: [] as string[],
  accountInfo: vi.fn(),
  isLiveSyncDue: vi.fn(),
  syncLiveChannels: vi.fn(),
  isCatalogSyncDue: vi.fn(),
  syncCatalog: vi.fn(),
  isEpgSyncDue: vi.fn(),
  syncEpg: vi.fn(),
  epgUrlFor: vi.fn(),
}));

vi.mock("@core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@core")>();
  return {
    ...actual,
    XtreamClient: class {
      getAccountInfo = m.accountInfo;
    },
  };
});
vi.mock("../live-sync.js", () => ({ isLiveSyncDue: m.isLiveSyncDue, syncLiveChannels: m.syncLiveChannels }));
vi.mock("../catalog-sync.js", () => ({
  isCatalogSyncDue: m.isCatalogSyncDue,
  syncCatalog: m.syncCatalog,
  catalogVersionKey: (sourceId: string, kind: string) => `local-catalog:${sourceId}:${kind}`,
}));
vi.mock("../epg-sync.js", () => ({ isEpgSyncDue: m.isEpgSyncDue, syncEpg: m.syncEpg, epgUrlFor: m.epgUrlFor }));
vi.mock("../content-loader.js", () => ({
  loadLiveCategories: vi.fn().mockResolvedValue([{ id: "1", name: "News", kind: "live" }]),
  loadVodCategories: vi.fn().mockResolvedValue([]),
  loadSeriesCategories: vi.fn().mockResolvedValue([]),
}));

const xtream: PlaylistSource = { kind: "xtream", id: "src-x", name: "Provider", baseUrl: "http://tv.example", username: "u", password: "p" };
const m3u: PlaylistSource = { kind: "m3u-url", id: "src-m", name: "Playlist", url: "http://tv.example/list.m3u" };

/** A controllable promise, for holding a stage open mid-test. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Records the start and end of a stage around `result`. */
function tracked<T>(name: string, result: () => Promise<T>) {
  return async () => {
    m.events.push(`${name}:start`);
    const value = await result();
    m.events.push(`${name}:end`);
    return value;
  };
}

describe("sync manager", () => {
  beforeEach(() => {
    m.events.length = 0;
    vi.clearAllMocks();
    __resetSyncManagerForTests({ retries: 0 });
    __resetSyncStoreForTests();
    clearAllCachedContent();
    __resetMemoryCacheForTests();

    m.accountInfo.mockImplementation(tracked("auth", async () => ({ status: "Active", expiresAt: null })));
    m.isLiveSyncDue.mockResolvedValue(true);
    m.isCatalogSyncDue.mockResolvedValue(true);
    m.isEpgSyncDue.mockResolvedValue(true);
    m.epgUrlFor.mockReturnValue("http://tv.example/xmltv.php");
    m.syncLiveChannels.mockImplementation(tracked("live", async () => ({ channelCount: 10 })));
    m.syncCatalog.mockImplementation((_source: PlaylistSource, kind: string) => tracked(kind, async () => undefined)());
    m.syncEpg.mockImplementation(tracked("epg", async () => ({ programmeCount: 500, channelCount: 5 })));
  });

  it("signs in first, then runs Live TV, Series, Movies and the guide one at a time", async () => {
    const outcome = await syncSource(xtream, { trigger: "launch" });

    expect(outcome.stages).toEqual({ auth: "synced", live: "synced", vod: "synced", series: "synced", epg: "synced" });
    expect(m.events).toEqual([
      "auth:start", "auth:end",
      "live:start", "live:end",
      "series:start", "series:end",
      "vod:start", "vod:end",
      "epg:start", "epg:end",
    ]);
    expect(getCachedContent(`playlist-info:${xtream.id}`)).toEqual({ name: "Provider", expiresAt: null });
    expect(getCachedContent(`live-categories:${xtream.id}`)).toEqual([{ id: "1", name: "News", kind: "live" }]);
  });

  it("skips fresh stages, and doesn't sign in when nothing is due and account info is fresh", async () => {
    m.isLiveSyncDue.mockResolvedValue(false);
    m.isCatalogSyncDue.mockResolvedValue(false);
    m.isEpgSyncDue.mockResolvedValue(false);
    await syncSource(xtream, { trigger: "manual", stages: [] }); // signs in once, caching account info

    vi.clearAllMocks();
    const outcome = await syncSource(xtream, { trigger: "interval" });

    expect(outcome.stages).toEqual({ live: "fresh", vod: "fresh", series: "fresh", epg: "fresh" });
    expect(m.accountInfo).not.toHaveBeenCalled();
    expect(m.syncLiveChannels).not.toHaveBeenCalled();
    expect(m.syncCatalog).not.toHaveBeenCalled();
  });

  it("force runs every stage even when fresh", async () => {
    m.isLiveSyncDue.mockResolvedValue(false);
    m.isCatalogSyncDue.mockResolvedValue(false);
    m.isEpgSyncDue.mockResolvedValue(false);

    const outcome = await syncSource(xtream, { trigger: "manual", force: true });
    expect(outcome.stages).toMatchObject({ live: "synced", vod: "synced", series: "synced", epg: "synced" });
  });

  it("a rejected sign-in stops the job without retrying, marking every stage skipped with the reason", async () => {
    __resetSyncManagerForTests({ retries: 3, baseDelayMs: 0 });
    m.accountInfo.mockRejectedValue(new XtreamAuthError());

    const outcome = await syncSource(xtream, { trigger: "launch" });

    expect(m.accountInfo).toHaveBeenCalledTimes(1);
    expect(outcome.stages).toEqual({ auth: "failed", live: "skipped", vod: "skipped", series: "skipped", epg: "skipped" });
    expect(outcome.errors.live).toBe("Xtream authentication failed");
    expect(m.syncLiveChannels).not.toHaveBeenCalled();
  });

  it("a failing stage is retried, and doesn't stop the others", async () => {
    __resetSyncManagerForTests({ retries: 1, baseDelayMs: 0 });
    m.syncCatalog.mockImplementation((_source: PlaylistSource, kind: string) =>
      kind === "vod" ? Promise.reject(new Error("HTTP 503")) : Promise.resolve(undefined),
    );

    const outcome = await syncSource(xtream, { trigger: "launch" });

    expect(m.syncCatalog.mock.calls.filter(([, kind]) => kind === "vod")).toHaveLength(2);
    expect(outcome.stages).toMatchObject({ vod: "failed", live: "synced", series: "synced", epg: "synced" });
    expect(outcome.errors.vod).toBe("HTTP 503");
    expect(getSourceSyncState(xtream.id).stages.vod).toMatchObject({ status: "failed", error: "HTTP 503" });
  });

  it("a request the running job already covers joins it instead of starting another", async () => {
    const live = deferred<{ channelCount: number }>();
    m.syncLiveChannels.mockReturnValue(live.promise);

    const first = syncSource(xtream, { trigger: "launch" });
    const second = syncSource(xtream, { trigger: "first-run", stages: ["live"] });
    expect(second).toBe(first);
    expect(isSyncRunning(xtream.id)).toBe(true);

    live.resolve({ channelCount: 1 });
    await first;
    expect(m.syncLiveChannels).toHaveBeenCalledTimes(1);
    expect(isSyncRunning(xtream.id)).toBe(false);
  });

  it("a forced refresh during a running sync follows it, skipping what it synced after the request", async () => {
    m.isCatalogSyncDue.mockResolvedValue(false);
    m.isEpgSyncDue.mockResolvedValue(false);
    const live = deferred<{ channelCount: number }>();
    m.syncLiveChannels.mockReturnValueOnce(live.promise);

    const launch = syncSource(xtream, { trigger: "launch" }); // only live is due
    await vi.waitFor(() => expect(m.syncLiveChannels).toHaveBeenCalledTimes(1));
    const manual = syncSource(xtream, { trigger: "manual", force: true });
    expect(manual).not.toBe(launch);

    live.resolve({ channelCount: 1 });
    const outcome = await manual;

    expect(m.syncLiveChannels).toHaveBeenCalledTimes(1); // synced after the refresh was asked for — not downloaded twice
    expect(m.syncCatalog.mock.calls.map(([, kind]) => kind).sort()).toEqual(["series", "vod"]);
    expect(m.syncEpg).toHaveBeenCalledTimes(1);
    expect(outcome.stages).toMatchObject({ vod: "synced", series: "synced", epg: "synced" });
  });

  it("cancelling stops the stages that haven't started yet", async () => {
    const auth = deferred<{ status: string; expiresAt: null }>();
    m.accountInfo.mockReturnValue(auth.promise);

    const job = syncSource(xtream, { trigger: "launch" });
    await vi.waitFor(() => expect(m.accountInfo).toHaveBeenCalled());
    cancelSync(xtream.id);
    auth.resolve({ status: "Active", expiresAt: null });
    const outcome = await job;

    expect(outcome.stages).toMatchObject({ auth: "synced", live: "skipped", vod: "skipped", series: "skipped", epg: "skipped" });
    expect(m.syncLiveChannels).not.toHaveBeenCalled();
  });

  it("for an M3U playlist: no sign-in, movies come with the live stage, no series, no guide without an EPG URL", async () => {
    m.epgUrlFor.mockReturnValue(undefined);
    const outcome = await syncSource(m3u, { trigger: "launch" });

    expect(outcome.stages).toEqual({ live: "synced", vod: "not-applicable", series: "not-applicable", epg: "not-applicable" });
    expect(m.accountInfo).not.toHaveBeenCalled();
    expect(m.syncCatalog).not.toHaveBeenCalled();
  });

  it("reports progress to the sync store while a stage runs", async () => {
    const live = deferred<{ channelCount: number }>();
    m.syncLiveChannels.mockImplementation((_source: PlaylistSource, { onProgress }: { onProgress: (n: number) => void }) => {
      onProgress(2000);
      return live.promise;
    });

    const job = syncSource(xtream, { trigger: "launch", stages: ["live"] });
    await vi.waitFor(() => expect(getSourceSyncState(xtream.id).stages.live).toEqual({ status: "running", done: 2000 }));
    expect(getSourceSyncState(xtream.id).isRunning).toBe(true);

    live.resolve({ channelCount: 4321 });
    await job;
    expect(getSourceSyncState(xtream.id).stages.live).toMatchObject({ status: "synced", count: 4321 });
    expect(getSourceSyncState(xtream.id).isRunning).toBe(false);
  });
});
