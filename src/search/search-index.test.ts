import { beforeEach, describe, expect, it } from "vitest";
import {
  __clearCatalogDbForTests,
  __resetCatalogDbForTests,
  catalogSyncMetaKey,
  deleteStaleGeneration,
  openCatalogDb,
  putRecordsBatch,
  putSyncMeta,
  queryPage,
  SEARCH_TOKENS_STORE,
  type CatalogDb,
  type CatalogRecord,
} from "../core/storage/catalog-db.js";
import { __clearLiveDbForTests, __resetLiveDbForTests, deleteStaleChannels, openLiveDb, putChannels, putLiveSyncMeta } from "../core/storage/live-db.js";
import { deleteSearchIndexForSource, getSearchIndexMeta, searchIndexMetaKey } from "../core/storage/search-index-db.js";
import type { Channel } from "@core";
import { searchCatalog, searchChannels } from "./search-index.js";
import { runIndexJobs, runIndexUnit } from "./search-indexer.js";

const SOURCE = "src-1";
const OTHER = "src-2";

function movie(streamId: string, name: string, generation = 1, sourceId = SOURCE, groupTitle = "cat-1"): CatalogRecord {
  return { id: `${sourceId}:${streamId.padStart(15, "0")}`, sourceId, streamId, name, nameLower: name.toLowerCase(), groupTitle, streamUrl: "x", generation };
}

async function seed(catalogDb: CatalogDb, records: CatalogRecord[], generation = 1, sourceId = SOURCE): Promise<void> {
  await putRecordsBatch(catalogDb, "vod", records);
  await putSyncMeta(catalogDb, { key: catalogSyncMetaKey(sourceId, "vod"), lastSyncedAt: Date.now(), recordCount: records.length, generation });
}

const noSleep = () => Promise.resolve();
async function indexAll(catalogDb: CatalogDb, sourceId = SOURCE): Promise<void> {
  await runIndexJobs(catalogDb, [{ sourceId, kind: "vod" }], { paceMs: 0, shouldStop: () => false, sleep: noSleep, unitSize: 2 });
}
async function names(query: string, limit = 20): Promise<string[]> {
  return (await searchCatalog(SOURCE, "vod", query, { limit })).items.map((m) => m.name);
}
function countSearchRows(catalogDb: CatalogDb): Promise<number> {
  return new Promise((resolve) => {
    const request = catalogDb.db.transaction(SEARCH_TOKENS_STORE, "readonly").objectStore(SEARCH_TOKENS_STORE).count();
    request.onsuccess = () => resolve(request.result);
  });
}

beforeEach(async () => {
  __resetCatalogDbForTests();
  await __clearCatalogDbForTests();
  __resetLiveDbForTests();
  await __clearLiveDbForTests();
});

describe("search index", () => {
  it("before indexing, search still finds titles by their start", async () => {
    const catalogDb = await openCatalogDb();
    await seed(catalogDb, [movie("1", "Matrix Reloaded"), movie("2", "The Matrix")]);
    expect(await names("mat")).toEqual(["Matrix Reloaded"]);
  });

  it("once indexed, any word finds a title — provider tags and articles don't get in the way — best match first", async () => {
    const catalogDb = await openCatalogDb();
    await seed(catalogDb, [
      movie("1", "Matrix Reloaded"),
      movie("2", "The Matrix"),
      movie("3", "EN | Breaking Bad"),
      movie("4", "Bad Boys"),
      movie("5", "Inception"),
    ]);
    await indexAll(catalogDb);

    expect(await names("matrix")).toEqual(["The Matrix", "Matrix Reloaded"]); // exact before starts-with
    expect(await names("breaking bad")).toEqual(["EN | Breaking Bad"]);
    expect(await names("bad")).toEqual(["Bad Boys", "EN | Breaking Bad"]); // starts-with before a later word
    expect(await names("zzz")).toEqual([]);
  });

  it("shows a title listed several times (under different ids) once — its best-ranked, newest entry", async () => {
    const catalogDb = await openCatalogDb();
    await seed(catalogDb, [movie("1", "The Matrix"), movie("7", "The  matrix"), movie("3", "The Matrix Reloaded"), movie("5", "EN | The Matrix")]);
    await indexAll(catalogDb);
    const result = await searchCatalog(SOURCE, "vod", "matrix", { limit: 20 });
    expect(result.items.map((m) => `${m.id} ${m.name}`)).toEqual(["7 The  matrix", "5 EN | The Matrix", "3 The Matrix Reloaded"]);
    expect(result.hasMore).toBe(false);
  });

  it("reports when there are more matches than asked for", async () => {
    const catalogDb = await openCatalogDb();
    await seed(catalogDb, [movie("1", "Star A"), movie("2", "Star B"), movie("3", "Star C")]);
    await indexAll(catalogDb);
    const result = await searchCatalog(SOURCE, "vod", "star", { limit: 2 });
    expect(result.items).toHaveLength(2);
    expect(result.hasMore).toBe(true);
  });

  it("applies a Kids filter", async () => {
    const catalogDb = await openCatalogDb();
    await seed(catalogDb, [movie("1", "Frozen", 1, SOURCE, "kids"), movie("2", "Fright Night", 1, SOURCE, "adult")]);
    await indexAll(catalogDb);
    const filter = { key: "k", accepts: (r: CatalogRecord) => r.groupTitle === "kids", isCategoryAllowed: () => true, pickedIds: [], moreForKids: false };
    const result = await searchCatalog(SOURCE, "vod", "fr", { limit: 20, filter });
    expect(result.items.map((m) => m.name)).toEqual(["Frozen"]);
  });

  it("works in small units, stops at a unit boundary and resumes from where it stopped", async () => {
    const catalogDb = await openCatalogDb();
    await seed(catalogDb, ["1", "2", "3", "4", "5"].map((id) => movie(id, `Film ${id}`)));

    let units = 0;
    const result = await runIndexJobs(catalogDb, [{ sourceId: SOURCE, kind: "vod" }], {
      paceMs: 0,
      sleep: noSleep,
      unitSize: 2,
      shouldStop: () => units++ >= 2, // two units, then stop
    });
    expect(result).toBe("stopped");
    const meta = await getSearchIndexMeta(catalogDb, searchIndexMetaKey(SOURCE, "vod"));
    expect(meta).toMatchObject({ phase: "index", lastKey: movie("4", "").id }); // exactly four records written, no partial unit
    expect(await countSearchRows(catalogDb)).toBe(4);

    await indexAll(catalogDb);
    expect(await countSearchRows(catalogDb)).toBe(5);
    expect(await getSearchIndexMeta(catalogDb, searchIndexMetaKey(SOURCE, "vod"))).toMatchObject({ phase: "done" });
    expect(await runIndexUnit(catalogDb, { sourceId: SOURCE, kind: "vod" })).toBe("done");
  });

  it("a new catalog generation re-indexes from the start and sweeps rows for titles that went away", async () => {
    const catalogDb = await openCatalogDb();
    await seed(catalogDb, [movie("1", "Old Film"), movie("2", "Kept Film")]);
    await indexAll(catalogDb);

    // A sync writes generation 2 without "Old Film", then sweeps the old catalog rows.
    await seed(catalogDb, [movie("2", "Kept Film", 2), movie("3", "New Film", 2)], 2);
    await deleteStaleGeneration(catalogDb, "vod", SOURCE, 2);
    // Until re-indexed: Kept Film is still found through its old row, Old Film's row points at nothing and is dropped,
    // and New Film isn't indexed yet (nor does it start with "film").
    expect(await names("film")).toEqual(["Kept Film"]);

    await indexAll(catalogDb);
    expect(await names("film")).toEqual(["New Film", "Kept Film"]);
    expect(await countSearchRows(catalogDb)).toBe(2); // Old Film's row swept
  });

  it("indexing another playlist doesn't touch this one's, and removing a playlist deletes only its rows", async () => {
    const catalogDb = await openCatalogDb();
    await seed(catalogDb, [movie("1", "The Matrix")]);
    await seed(catalogDb, [movie("1", "The Matrix", 1, OTHER)], 1, OTHER);
    await indexAll(catalogDb);
    await indexAll(catalogDb, OTHER);
    expect(await countSearchRows(catalogDb)).toBe(2);

    await deleteSearchIndexForSource(catalogDb, OTHER);
    expect(await countSearchRows(catalogDb)).toBe(1);
    expect(await getSearchIndexMeta(catalogDb, searchIndexMetaKey(OTHER, "vod"))).toBeUndefined();
    expect(await names("matrix")).toEqual(["The Matrix"]);
  });

  it("indexing never blocks reads of the movie table (its own store)", async () => {
    const catalogDb = await openCatalogDb();
    await seed(catalogDb, [movie("1", "Heat")]);
    // Hold a write transaction open on the search store, as a unit in flight would.
    let released = false;
    const tx = catalogDb.db.transaction(SEARCH_TOKENS_STORE, "readwrite");
    const store = tx.objectStore(SEARCH_TOKENS_STORE);
    const spin = () => {
      if (!released) store.count().onsuccess = spin;
    };
    spin();

    const page = await queryPage(catalogDb, "vod", { sourceId: SOURCE, offset: 0, limit: 10 });
    expect(page.map((r) => r.name)).toEqual(["Heat"]);
    released = true;
  });
});

describe("live channel search", () => {
  const list: Channel[] = [
    { id: "a", name: "EN | Sky News HD", streamUrl: "x", kind: "live", number: 1 },
    { id: "b", name: "News 24", streamUrl: "x", kind: "live", number: 2 },
    { id: "c", name: "BBC One", streamUrl: "x", kind: "live", number: 3 },
    { id: "b", name: "News 24", streamUrl: "y", kind: "live", number: 4 }, // an M3U's second entry for the same channel
  ];

  async function seedLive(generation = 1, channels = list): Promise<void> {
    const liveDb = await openLiveDb();
    await putChannels(liveDb, channels.map((channel, position) => ({ ...channel, sourceId: SOURCE, position, generation })));
    await putLiveSyncMeta(liveDb, { sourceId: SOURCE, lastSyncedAt: Date.now(), generation, channelCount: channels.length });
  }
  const channelNames = async (query: string) => (await searchChannels(SOURCE, list, query, { limit: 20 })).items.map((c) => `${c.number} ${c.name}`);

  it("before indexing, finds channels by the start of their name — once each", async () => {
    await seedLive();
    expect(await channelNames("news")).toEqual(["2 News 24"]);
  });

  it("once indexed, any word finds a channel; the best match first, then channel order", async () => {
    await seedLive();
    await runIndexJobs(await openCatalogDb(), [{ sourceId: SOURCE, kind: "live" }], { paceMs: 0, shouldStop: () => false, sleep: noSleep, unitSize: 2 });
    expect(await channelNames("news")).toEqual(["2 News 24", "1 EN | Sky News HD"]);
    expect(await channelNames("sky")).toEqual(["1 EN | Sky News HD"]);
    expect((await searchChannels(SOURCE, list, "news", { limit: 20 })).bestScore).toBe(80);
  });

  it("a channel name listed twice under different ids appears once", async () => {
    const twice: Channel[] = [
      { id: "x1", name: "BBC One", streamUrl: "x", kind: "live", number: 1 },
      { id: "x2", name: "BBC One", streamUrl: "y", kind: "live", number: 2 },
    ];
    const result = await searchChannels(SOURCE, twice, "bbc", { limit: 20 });
    expect(result.items.map((c) => c.id)).toEqual(["x1"]);
  });

  it("only channels in the list it's given are returned — a Kids-filtered list stays filtered", async () => {
    await seedLive();
    await runIndexJobs(await openCatalogDb(), [{ sourceId: SOURCE, kind: "live" }], { paceMs: 0, shouldStop: () => false, sleep: noSleep });
    const allowed = list.filter((c) => c.id !== "a");
    const result = await searchChannels(SOURCE, allowed, "news", { limit: 20 });
    expect(result.items.map((c) => c.id)).toEqual(["b"]);
  });

  it("a new live list is re-indexed and channels that went away are swept", async () => {
    await seedLive();
    const catalogDb = await openCatalogDb();
    await runIndexJobs(catalogDb, [{ sourceId: SOURCE, kind: "live" }], { paceMs: 0, shouldStop: () => false, sleep: noSleep });
    expect(await countSearchRows(catalogDb)).toBe(4);

    await seedLive(2, list.slice(0, 2)); // a shorter list: positions 0–1 rewritten…
    await deleteStaleChannels(await openLiveDb(), SOURCE, 2); // …and 2–3 swept from the live table, as the live sync does
    await runIndexJobs(catalogDb, [{ sourceId: SOURCE, kind: "live" }], { paceMs: 0, shouldStop: () => false, sleep: noSleep });
    expect(await countSearchRows(catalogDb)).toBe(2);
  });
});
