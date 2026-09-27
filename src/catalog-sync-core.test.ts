import { beforeEach, describe, expect, it, vi } from "vitest";
import { KIDS_RULES_VERSION, type Channel } from "@core";
import {
  __clearCatalogDbForTests,
  __resetCatalogDbForTests,
  catalogSyncMetaKey,
  getSyncMeta,
  openCatalogDb,
  putSyncMeta,
  queryPage,
  SEARCH_TOKENS_STORE,
  type CatalogDb,
} from "./core/storage/catalog-db.js";
import { runIndexJobs } from "./search/search-indexer.js";
import { searchCatalog } from "./search/search-index.js";
import { CatalogEmptyError, writeCatalog } from "./catalog-sync-core.js";

const SOURCE = "src-1";
const movie = (id: string, name: string, extra: Partial<Channel> = {}): Channel => ({ id, name, groupTitle: "cat-1", streamUrl: `http://x/${id}.mp4`, kind: "movie", ...extra });

async function stored(catalogDb: CatalogDb) {
  return queryPage(catalogDb, "vod", { sourceId: SOURCE, offset: 0, limit: 100 });
}
async function names(query: string): Promise<string[]> {
  return (await searchCatalog(SOURCE, "vod", query, { limit: 20 })).items.map((m) => m.name);
}
function countSearchRows(catalogDb: CatalogDb): Promise<number> {
  return new Promise((resolve) => {
    const request = catalogDb.db.transaction(SEARCH_TOKENS_STORE, "readonly").objectStore(SEARCH_TOKENS_STORE).count();
    request.onsuccess = () => resolve(request.result);
  });
}

describe("writeCatalog", () => {
  beforeEach(async () => {
    __resetCatalogDbForTests();
    await __clearCatalogDbForTests();
  });

  it("rewrites only new and changed titles, and deletes the ones that are gone", async () => {
    const catalogDb = await openCatalogDb();
    await writeCatalog(catalogDb, "vod", SOURCE, [movie("1", "Heat"), movie("2", "Alien"), movie("3", "Gone")]);

    const onProgress = vi.fn();
    const result = await writeCatalog(catalogDb, "vod", SOURCE, [movie("1", "Heat"), movie("2", "Alien", { logoUrl: "http://img/2.jpg" }), movie("4", "Brand New")], {
      batchSize: 2,
      onProgress,
    });

    expect(result).toEqual({ recordCount: 3, written: 2, deleted: 1 });
    expect(onProgress.mock.calls.map(([n]) => n)).toEqual([2, 3]);
    const rows = await stored(catalogDb);
    expect(rows.map((r) => r.name)).toEqual(["Brand New", "Alien", "Heat"]);
    expect(rows.find((r) => r.name === "Alien")?.logoUrl).toBe("http://img/2.jpg");
  });

  it("rewrites every title once when the stored tags came from older Kids rules", async () => {
    const catalogDb = await openCatalogDb();
    await writeCatalog(catalogDb, "vod", SOURCE, [movie("1", "Heat"), movie("2", "Alien")]);
    const meta = await getSyncMeta(catalogDb, catalogSyncMetaKey(SOURCE, "vod"));
    await putSyncMeta(catalogDb, { ...meta!, rulesVersion: KIDS_RULES_VERSION - 1 });

    await expect(writeCatalog(catalogDb, "vod", SOURCE, [movie("1", "Heat"), movie("2", "Alien")])).resolves.toMatchObject({ written: 2 });
    expect(await getSyncMeta(catalogDb, catalogSyncMetaKey(SOURCE, "vod"))).toMatchObject({ rulesVersion: KIDS_RULES_VERSION });
    await expect(writeCatalog(catalogDb, "vod", SOURCE, [movie("1", "Heat"), movie("2", "Alien")])).resolves.toMatchObject({ written: 0 });
  });

  it("keeps an already-built search index current instead of starting it over", async () => {
    const catalogDb = await openCatalogDb();
    await writeCatalog(catalogDb, "vod", SOURCE, [movie("1", "Old Film"), movie("2", "Kept Film"), movie("3", "Wrong Name")]);
    await runIndexJobs(catalogDb, [{ sourceId: SOURCE, kind: "vod" }], { paceMs: 0, shouldStop: () => false, sleep: async () => {} });
    expect((await names("film")).sort()).toEqual(["Kept Film", "Old Film"]);

    await writeCatalog(catalogDb, "vod", SOURCE, [movie("2", "Kept Film"), movie("3", "Right Film"), movie("4", "New Film")]);

    expect((await names("film")).sort()).toEqual(["Kept Film", "New Film", "Right Film"]);
    expect(await names("wrong")).toEqual([]);
    expect(await countSearchRows(catalogDb)).toBe(3);
    expect(await getSyncMeta(catalogDb, catalogSyncMetaKey(SOURCE, "vod"))).toMatchObject({ generation: 1 });
  });

  it("refuses an empty list over a stored catalog, unless told it's real", async () => {
    const catalogDb = await openCatalogDb();
    await writeCatalog(catalogDb, "vod", SOURCE, [movie("1", "Heat")]);

    await expect(writeCatalog(catalogDb, "vod", SOURCE, [])).rejects.toBeInstanceOf(CatalogEmptyError);
    expect(await stored(catalogDb)).toHaveLength(1);

    await writeCatalog(catalogDb, "vod", SOURCE, [], { allowEmpty: true });
    expect(await stored(catalogDb)).toHaveLength(0);
  });
});
