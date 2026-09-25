import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel, PlaylistSource } from "@core";
import { useCacheInvalidationStore } from "./cache-invalidation-store.js";
import { __clearEpgDbForTests, __resetEpgDbForTests } from "./core/storage/epg-db.js";
import { __resetEpgCacheForTests, loadChannelGuide } from "./epg-cache.js";
import { epgVersionKey } from "./epg-store.js";
import { __resetEpgSyncForTests, clearEpgForSource, epgUrlFor, isEpgSyncDue, syncEpg, syncEpgIfDue, EPG_STALE_AFTER_MS } from "./epg-sync.js";

const { loadStreamEpgMock } = vi.hoisted(() => ({ loadStreamEpgMock: vi.fn() }));
vi.mock("./content-loader.js", () => ({ loadStreamEpg: loadStreamEpgMock }));

const xtream: PlaylistSource = { kind: "xtream", id: "src-x", name: "X", baseUrl: "http://tv.example:8080/", username: "me", password: "p&ss" };
const m3uNoGuide: PlaylistSource = { kind: "m3u-url", id: "src-m", name: "M", url: "http://tv.example/list.m3u" };
const bbc: Channel = { id: "101", name: "BBC One", streamUrl: "http://tv.example/101.ts", kind: "live", epgChannelId: "bbc.uk" };

function guideXml(title: string): string {
  const start = new Date(Date.now() - 30 * 60_000);
  const stop = new Date(Date.now() + 30 * 60_000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:T]/g, "").slice(0, 14) + " +0000";
  return `<tv><programme start="${fmt(start)}" stop="${fmt(stop)}" channel="bbc.uk"><title>${title}</title></programme></tv>`;
}

describe("epg-sync (main-thread path — jsdom has no Worker)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    __resetEpgSyncForTests({ workerAvailable: false });
    __resetEpgCacheForTests();
    __resetEpgDbForTests();
    await __clearEpgDbForTests();
    loadStreamEpgMock.mockReset().mockResolvedValue([]);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("builds the XMLTV URL from Xtream credentials, and has none for an M3U without an EPG URL", () => {
    expect(epgUrlFor(xtream)).toBe("http://tv.example:8080/xmltv.php?username=me&password=p%26ss");
    expect(epgUrlFor(m3uNoGuide)).toBeUndefined();
    expect(epgUrlFor({ ...m3uNoGuide, epgUrl: "http://guide.example/epg.xml" })).toBe("http://guide.example/epg.xml");
  });

  it("stores the guide, tells screens, and serves lookups from it without a per-channel request", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => guideXml("Six O'Clock News") });
    const before = useCacheInvalidationStore.getState().versions[epgVersionKey(xtream.id)] ?? 0;

    await expect(syncEpg(xtream)).resolves.toEqual({ programmeCount: 1, channelCount: 1 });

    expect(useCacheInvalidationStore.getState().versions[epgVersionKey(xtream.id)]).toBe(before + 1);
    const programmes = await loadChannelGuide(xtream, bbc);
    expect(programmes.map((p) => p.title)).toEqual(["Six O'Clock News"]);
    expect(programmes[0].start).toBeInstanceOf(Date);
    expect(loadStreamEpgMock).not.toHaveBeenCalled();
  });

  it("falls back to Xtream's per-channel EPG for a channel the stored guide doesn't cover", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => guideXml("Other channel") });
    await syncEpg(xtream);
    loadStreamEpgMock.mockResolvedValue([{ channelId: "202", title: "From short EPG", start: new Date(), stop: new Date() }]);

    const programmes = await loadChannelGuide(xtream, { ...bbc, id: "202", epgChannelId: "itv.uk" });
    expect(programmes.map((p) => p.title)).toEqual(["From short EPG"]);
  });

  it("shares one download between concurrent syncs of the same source", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => guideXml("Once") });
    await Promise.all([syncEpg(xtream), syncEpg(xtream), syncEpgIfDue(xtream)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("is due when never synced or stale, not when fresh, and never for a source without a guide", async () => {
    expect(await isEpgSyncDue(xtream)).toBe(true);
    expect(await isEpgSyncDue(m3uNoGuide)).toBe(false);

    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => guideXml("Fresh") });
    await syncEpg(xtream);
    expect(await isEpgSyncDue(xtream)).toBe(false);

    const realNow = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(realNow + EPG_STALE_AFTER_MS + 1);
    expect(await isEpgSyncDue(xtream)).toBe(true);
  });

  it("syncEpgIfDue swallows provider failures", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(syncEpgIfDue(xtream)).resolves.toBeUndefined();
  });

  it("clearEpgForSource drops the stored guide", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => guideXml("Soon gone") });
    await syncEpg(xtream);
    await clearEpgForSource(xtream.id);

    expect(await isEpgSyncDue(xtream)).toBe(true);
    expect(await loadChannelGuide(xtream, bbc)).toEqual([]);
    expect(loadStreamEpgMock).toHaveBeenCalled(); // nothing local any more, so Xtream asks per channel
  });
});
