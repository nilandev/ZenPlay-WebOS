import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistSource } from "@core";
import { getCatalogCategories } from "./catalog-store.js";
import { __clearCatalogDbForTests, __resetCatalogDbForTests, getSyncMeta, openCatalogDb, queryPage } from "./core/storage/catalog-db.js";
import { __clearLiveDbForTests, __resetLiveDbForTests, getLiveSyncMeta, getSourceChannels, openLiveDb } from "./core/storage/live-db.js";
import { LiveEmptyError, runLiveSync } from "./live-sync-core.js";

const xtream: PlaylistSource = { kind: "xtream", id: "src-x", name: "X", baseUrl: "http://tv.example:8080", username: "me", password: "pw" };
const m3uUrl: PlaylistSource = { kind: "m3u-url", id: "src-m", name: "M", url: "http://tv.example/list.m3u" };

const jsonResponse = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
const textResponse = (body: string) => ({ ok: true, status: 200, text: async () => body }) as Response;
const stream = (id: number, name: string, extra: Record<string, unknown> = {}) => ({ stream_id: id, name, category_id: "1", ...extra });

async function stored(sourceId: string) {
  return getSourceChannels(await openLiveDb(), sourceId);
}

describe("runLiveSync", () => {
  beforeEach(async () => {
    __resetLiveDbForTests();
    await __clearLiveDbForTests();
    __resetCatalogDbForTests();
    await __clearCatalogDbForTests();
  });

  it("stores an Xtream live list in provider order, mapped to channels, and records the count", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([stream(7, "BBC One", { num: "101", tv_archive: 1 }), stream(3, "ITV")]));
    await expect(runLiveSync({ source: xtream }, { fetchImpl })).resolves.toEqual({ channelCount: 2 });

    expect(fetchImpl.mock.calls[0][0]).toContain("action=get_live_streams");
    const rows = await stored(xtream.id);
    expect(rows.map((r) => [r.position, r.id, r.name])).toEqual([
      [0, "7", "BBC One"],
      [1, "3", "ITV"],
    ]);
    expect(rows[0]).toMatchObject({ kind: "live", number: 101, hasArchive: true, streamUrl: expect.stringContaining("/live/me/pw/7.m3u8") });
    expect(await getLiveSyncMeta(await openLiveDb(), xtream.id)).toMatchObject({ channelCount: 2 });
  });

  it("a shorter re-sync overwrites in place and drops the tail", async () => {
    await runLiveSync({ source: xtream }, { fetchImpl: vi.fn().mockResolvedValue(jsonResponse([stream(1, "A"), stream(2, "B"), stream(3, "C")])) });
    await runLiveSync({ source: xtream }, { fetchImpl: vi.fn().mockResolvedValue(jsonResponse([stream(9, "Z")])) });
    expect((await stored(xtream.id)).map((r) => r.name)).toEqual(["Z"]);
  });

  it("keeps only live entries from an M3U playlist, including repeated tvg-ids", async () => {
    const playlist = [
      "#EXTM3U",
      '#EXTINF:-1 tvg-id="bbc.uk" group-title="UK",BBC One HD',
      "http://tv.example/bbc-hd.ts",
      '#EXTINF:-1 tvg-id="bbc.uk" group-title="UK",BBC One SD',
      "http://tv.example/bbc-sd.ts",
      '#EXTINF:-1 group-title="Movies",Some Film',
      "http://tv.example/movie/film.mp4",
    ].join("\n");
    await runLiveSync({ source: m3uUrl }, { fetchImpl: vi.fn().mockResolvedValue(textResponse(playlist)) });
    expect((await stored(m3uUrl.id)).map((r) => r.name)).toEqual(["BBC One HD", "BBC One SD"]);
  });

  it("reads an imported M3U file without any request", async () => {
    const fetchImpl = vi.fn();
    const file: PlaylistSource = { kind: "m3u-file", id: "src-f", name: "F", content: "#EXTM3U\n#EXTINF:-1,Local News\nhttp://tv.example/1.ts" };
    await runLiveSync({ source: file }, { fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await stored(file.id)).map((r) => r.name)).toEqual(["Local News"]);
  });

  it("keeps the previous list when a refresh comes back empty, fails, or isn't a list", async () => {
    await runLiveSync({ source: xtream }, { fetchImpl: vi.fn().mockResolvedValue(jsonResponse([stream(1, "Keep me")])) });

    await expect(runLiveSync({ source: xtream }, { fetchImpl: vi.fn().mockResolvedValue(jsonResponse([])) })).rejects.toBeInstanceOf(LiveEmptyError);
    await expect(runLiveSync({ source: xtream }, { fetchImpl: vi.fn().mockResolvedValue(jsonResponse({}, 503)) })).rejects.toThrow(/HTTP 503/);
    await expect(runLiveSync({ source: xtream }, { fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ user_info: { auth: 0 } })) })).rejects.toThrow(
      /didn't return a channel list/,
    );

    expect((await stored(xtream.id)).map((r) => r.name)).toEqual(["Keep me"]);
  });

  it("writes in batches with progress, yielding between them when asked", async () => {
    const onProgress = vi.fn();
    const yieldBetweenBatches = vi.fn().mockResolvedValue(undefined);
    const list = Array.from({ length: 5 }, (_, i) => stream(i + 1, `Ch ${i + 1}`));
    await runLiveSync({ source: xtream }, { fetchImpl: vi.fn().mockResolvedValue(jsonResponse(list)), batchSize: 2, onProgress, yieldBetweenBatches });
    expect(onProgress.mock.calls.map(([n]) => n)).toEqual([2, 4, 5]);
    expect(yieldBetweenBatches).toHaveBeenCalledTimes(3);
  });

  it("writes an M3U playlist's movies into the VOD catalog from the same download, with their groups as categories", async () => {
    const playlist = [
      "#EXTM3U",
      '#EXTINF:-1 group-title="UK",BBC One',
      "http://tv.example/bbc.ts",
      '#EXTINF:-1 group-title="Movies: Action",Heat',
      "http://tv.example/movie/heat.mp4",
      "#EXTINF:-1,Ungrouped Film",
      "http://tv.example/movie/film.mkv",
    ].join("\n");
    const fetchImpl = vi.fn().mockResolvedValue(textResponse(playlist));

    await expect(runLiveSync({ source: m3uUrl }, { fetchImpl })).resolves.toEqual({ channelCount: 1, movieCount: 2 });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const catalogDb = await openCatalogDb();
    const movies = await queryPage(catalogDb, "vod", { sourceId: m3uUrl.id, offset: 0, limit: 10 });
    expect(movies.map((r) => r.name).sort()).toEqual(["Heat", "Ungrouped Film"]);
    expect(await getSyncMeta(catalogDb, `vod:${m3uUrl.id}`)).toMatchObject({ recordCount: 2 });
    expect((await getCatalogCategories(m3uUrl.id, "vod")).map((c) => c.name)).toEqual(["Movies: Action", "Uncategorized"]);
  });

  it("a VOD-only M3U (no live channels) still refreshes its movies", async () => {
    const withMovies = (title: string) => ["#EXTM3U", '#EXTINF:-1 group-title="Movies",' + title, "http://tv.example/movie/x.mp4"].join("\n");
    await runLiveSync({ source: m3uUrl }, { fetchImpl: vi.fn().mockResolvedValue(textResponse(withMovies("First Cut"))) });
    await runLiveSync({ source: m3uUrl }, { fetchImpl: vi.fn().mockResolvedValue(textResponse(withMovies("Director's Cut"))) });

    const movies = await queryPage(await openCatalogDb(), "vod", { sourceId: m3uUrl.id, offset: 0, limit: 10 });
    expect(movies.map((r) => r.name)).toEqual(["Director's Cut"]);
  });
});
