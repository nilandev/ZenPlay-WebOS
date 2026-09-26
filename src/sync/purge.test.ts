import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistSource } from "@core";
import { __resetMemoryCacheForTests, clearAllCachedContent, setCachedContent } from "../content-cache.js";
import {
  __clearCatalogDbForTests,
  __resetCatalogDbForTests,
  catalogSyncMetaKey,
  getSyncMeta,
  openCatalogDb,
  putRecordsBatch,
  putSyncMeta,
  queryPage,
} from "../core/storage/catalog-db.js";
import { __clearEpgDbForTests, __resetEpgDbForTests, getChannelProgrammes, getEpgSyncMeta, openEpgDb, putEpgSyncMeta, putProgrammes } from "../core/storage/epg-db.js";
import { getAllKeys, openIdbStore, clearStore } from "../core/storage/indexeddb-store.js";
import { __clearLiveDbForTests, __resetLiveDbForTests, getLiveSyncMeta, getSourceChannels, openLiveDb, putChannels, putLiveSyncMeta } from "../core/storage/live-db.js";
import { __resetLiveStoreForTests } from "../live-store.js";
import { loadFavorites, loadWatchHistory, recordWatchHistory, toggleFavorite } from "../profile-store.js";
import { purgeSourceData, resetSourceData } from "./purge.js";
import { __resetSyncStoreForTests, getSourceSyncState, useSyncStore } from "./sync-store.js";

const m = vi.hoisted(() => ({ order: [] as string[], cancelSync: vi.fn(), whenIdle: vi.fn(), syncSource: vi.fn() }));
vi.mock("./sync-manager.js", () => ({ cancelSync: m.cancelSync, whenIdle: m.whenIdle, syncSource: m.syncSource }));

const GONE = "src-gone";
const KEPT = "src-kept";

async function seed(sourceId: string): Promise<void> {
  const liveDb = await openLiveDb();
  await putChannels(liveDb, [{ id: "1", name: "News", streamUrl: "x", kind: "live", sourceId, position: 0, generation: 1 }]);
  await putLiveSyncMeta(liveDb, { sourceId, lastSyncedAt: 1, generation: 1, channelCount: 1 });

  const catalogDb = await openCatalogDb();
  for (const kind of ["vod", "series"] as const) {
    await putRecordsBatch(catalogDb, kind, [{ id: `${sourceId}:9`, sourceId, streamId: "9", name: "Title", nameLower: "title", groupTitle: "7", generation: 1 }]);
    await putSyncMeta(catalogDb, { key: catalogSyncMetaKey(sourceId, kind), lastSyncedAt: 1, recordCount: 1, generation: 1 });
  }

  const epgDb = await openEpgDb();
  await putProgrammes(epgDb, [{ sourceId, channelId: "bbc", start: 1, stop: 2, title: "Show", generation: 1 }]);
  await putEpgSyncMeta(epgDb, { sourceId, lastSyncedAt: 1, generation: 1, programmeCount: 1, channelCount: 1 });

  setCachedContent(`vod-categories:${sourceId}`, [], "category");
  setCachedContent(`vod:${sourceId}:cat:7`, [], "catalog");
  setCachedContent(`series-details:${sourceId}:9`, {}, "catalog");
  toggleFavorite("profile-1", sourceId, "movie", "9");
  toggleFavorite("profile-2", sourceId, "live", "1");
  recordWatchHistory({ profileId: "profile-1", sourceId, kind: "movie", contentId: "9", title: "Title" } as Parameters<typeof recordWatchHistory>[0]);
  useSyncStore.getState().setStage(sourceId, "live", { status: "synced", count: 1 });
}

async function storedFor(sourceId: string) {
  const [liveDb, catalogDb, epgDb] = await Promise.all([openLiveDb(), openCatalogDb(), openEpgDb()]);
  return {
    channels: (await getSourceChannels(liveDb, sourceId)).length,
    liveMeta: await getLiveSyncMeta(liveDb, sourceId),
    movies: (await queryPage(catalogDb, "vod", { sourceId, offset: 0, limit: 10 })).length,
    series: (await queryPage(catalogDb, "series", { sourceId, offset: 0, limit: 10 })).length,
    catalogMeta: [await getSyncMeta(catalogDb, catalogSyncMetaKey(sourceId, "vod")), await getSyncMeta(catalogDb, catalogSyncMetaKey(sourceId, "series"))].filter(Boolean).length,
    programmes: (await getChannelProgrammes(epgDb, sourceId, "bbc")).length,
    epgMeta: await getEpgSyncMeta(epgDb, sourceId),
    cacheKeys: (await getAllKeys(await openIdbStore())).filter((key) => key.includes(sourceId)),
    favourites: [...loadFavorites("profile-1"), ...loadFavorites("profile-2")].filter((f) => f.sourceId === sourceId).length,
    history: loadWatchHistory("profile-1", sourceId).length,
    syncStatus: Object.keys(getSourceSyncState(sourceId).stages).length,
  };
}

describe("purge", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    m.order.length = 0;
    m.cancelSync.mockImplementation(() => m.order.push("cancel"));
    m.whenIdle.mockImplementation(async () => void m.order.push("idle"));
    m.syncSource.mockImplementation(async () => {
      m.order.push("sync");
      return { stages: {}, errors: {} };
    });
    localStorage.clear();
    __resetSyncStoreForTests();
    __resetLiveStoreForTests();
    clearAllCachedContent();
    __resetMemoryCacheForTests();
    await clearStore(await openIdbStore());
    __resetLiveDbForTests();
    await __clearLiveDbForTests();
    __resetCatalogDbForTests();
    await __clearCatalogDbForTests();
    __resetEpgDbForTests();
    await __clearEpgDbForTests();
    await seed(GONE);
    await seed(KEPT);
    await vi.waitFor(async () => expect((await storedFor(GONE)).cacheKeys).toHaveLength(3)); // cache writes are fire-and-forget
  });

  it("removing a playlist leaves nothing with its id in any store — and doesn't touch another playlist", async () => {
    await purgeSourceData(GONE);

    await vi.waitFor(async () =>
      expect(await storedFor(GONE)).toEqual({
        channels: 0,
        liveMeta: undefined,
        movies: 0,
        series: 0,
        catalogMeta: 0,
        programmes: 0,
        epgMeta: undefined,
        cacheKeys: [],
        favourites: 0,
        history: 0,
        syncStatus: 0,
      }),
    );
    expect(await storedFor(KEPT)).toMatchObject({ channels: 1, movies: 1, series: 1, catalogMeta: 2, programmes: 1, favourites: 2, history: 1, syncStatus: 1 });
    expect((await storedFor(KEPT)).cacheKeys).toHaveLength(3);
    expect(m.order.slice(0, 2)).toEqual(["cancel", "idle"]); // stopped before anything was deleted
  });

  it("reset re-syncs everything without deleting the current data first, keeping favourites and history", async () => {
    const source: PlaylistSource = { kind: "xtream", id: GONE, name: "P", baseUrl: "http://tv.example", username: "u", password: "p" };
    const before = await storedFor(GONE);
    m.syncSource.mockImplementation(async () => {
      m.order.push("sync");
      // Still there while the sync runs — the write-then-swap replaces it in place.
      expect(await storedFor(GONE)).toMatchObject({ channels: before.channels, movies: before.movies, series: before.series, programmes: before.programmes });
      return { stages: {}, errors: {} };
    });

    await resetSourceData(source);

    expect(await storedFor(GONE)).toMatchObject({ favourites: 2, history: 1 });
    expect(m.syncSource).toHaveBeenCalledWith(source, { trigger: "manual", force: true });
    expect(m.order).toEqual(["cancel", "idle", "sync"]);
  });
});
