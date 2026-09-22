import { beforeEach, describe, expect, it } from "vitest";
import {
  __clearCatalogDbForTests,
  __resetCatalogDbForTests,
  countRecords,
  deleteStaleGeneration,
  getSyncMeta,
  openCatalogDb,
  putRecordsBatch,
  putSyncMeta,
  queryPage,
  type CatalogRecord,
} from "./catalog-db.js";

function record(overrides: Partial<CatalogRecord> & Pick<CatalogRecord, "streamId" | "name">): CatalogRecord {
  return {
    id: `source-1:${overrides.streamId}`,
    sourceId: "source-1",
    nameLower: overrides.name.toLowerCase(),
    generation: 1,
    ...overrides,
  };
}

describe("catalog-db", () => {
  beforeEach(async () => {
    __resetCatalogDbForTests();
    // fake-indexeddb persists the database across openCatalogDb() calls
    // within this test file (only the module-level connection cache is
    // reset above) — clear every store so one test's writes can't leak into
    // the next, same pattern as indexeddb-store.test.ts.
    await __clearCatalogDbForTests();
  });

  it("round-trips a batch write through queryPage", async () => {
    const catalogDb = await openCatalogDb();
    await putRecordsBatch(catalogDb, "vod", [
      record({ streamId: "1", name: "Alpha" }),
      record({ streamId: "2", name: "Beta" }),
    ]);

    const page = await queryPage(catalogDb, "vod", { sourceId: "source-1", offset: 0, limit: 10 });
    expect(page.map((r) => r.name).sort()).toEqual(["Alpha", "Beta"]);
  });

  it("paginates with offset/limit without loading the whole table", async () => {
    const catalogDb = await openCatalogDb();
    const records = Array.from({ length: 25 }, (_, i) => record({ streamId: String(i), name: `Movie ${i}` }));
    await putRecordsBatch(catalogDb, "vod", records);

    const firstPage = await queryPage(catalogDb, "vod", { sourceId: "source-1", offset: 0, limit: 10 });
    const secondPage = await queryPage(catalogDb, "vod", { sourceId: "source-1", offset: 10, limit: 10 });

    expect(firstPage).toHaveLength(10);
    expect(secondPage).toHaveLength(10);
    expect(new Set([...firstPage, ...secondPage].map((r) => r.id)).size).toBe(20);
  });

  it("filters by category via the by_source_category index", async () => {
    const catalogDb = await openCatalogDb();
    await putRecordsBatch(catalogDb, "vod", [
      record({ streamId: "1", name: "Action Movie", groupTitle: "action" }),
      record({ streamId: "2", name: "Comedy Movie", groupTitle: "comedy" }),
    ]);

    const page = await queryPage(catalogDb, "vod", { sourceId: "source-1", categoryId: "action", offset: 0, limit: 10 });
    expect(page.map((r) => r.name)).toEqual(["Action Movie"]);
  });

  it("matches case-insensitive name prefix via the by_source_name index", async () => {
    const catalogDb = await openCatalogDb();
    await putRecordsBatch(catalogDb, "vod", [
      record({ streamId: "1", name: "The Matrix" }),
      record({ streamId: "2", name: "Matrix Reloaded" }),
      record({ streamId: "3", name: "Inception" }),
    ]);

    const page = await queryPage(catalogDb, "vod", { sourceId: "source-1", namePrefixLower: "matrix", offset: 0, limit: 10 });
    expect(page.map((r) => r.name)).toEqual(["Matrix Reloaded"]);
  });

  it("scopes every query to sourceId, ignoring other sources' records", async () => {
    const catalogDb = await openCatalogDb();
    await putRecordsBatch(catalogDb, "vod", [
      record({ streamId: "1", name: "Mine" }),
      { ...record({ streamId: "1", name: "Theirs" }), id: "source-2:1", sourceId: "source-2" },
    ]);

    const page = await queryPage(catalogDb, "vod", { sourceId: "source-1", offset: 0, limit: 10 });
    expect(page.map((r) => r.name)).toEqual(["Mine"]);
  });

  it("counts matching records without reading them all", async () => {
    const catalogDb = await openCatalogDb();
    await putRecordsBatch(catalogDb, "vod", [
      record({ streamId: "1", name: "A" }),
      record({ streamId: "2", name: "B" }),
      record({ streamId: "3", name: "C" }),
    ]);

    await expect(countRecords(catalogDb, "vod", { sourceId: "source-1" })).resolves.toBe(3);
  });

  it("deleteStaleGeneration removes only records older than the given generation", async () => {
    const catalogDb = await openCatalogDb();
    await putRecordsBatch(catalogDb, "vod", [
      record({ streamId: "1", name: "Old", generation: 1 }),
      record({ streamId: "2", name: "New", generation: 2 }),
    ]);

    await deleteStaleGeneration(catalogDb, "vod", "source-1", 2);

    const page = await queryPage(catalogDb, "vod", { sourceId: "source-1", offset: 0, limit: 10 });
    expect(page.map((r) => r.name)).toEqual(["New"]);
  });

  it("round-trips sync_meta", async () => {
    const catalogDb = await openCatalogDb();
    await putSyncMeta(catalogDb, { key: "vod:source-1", lastSyncedAt: 123, recordCount: 2, generation: 1 });

    await expect(getSyncMeta(catalogDb, "vod:source-1")).resolves.toEqual({
      key: "vod:source-1",
      lastSyncedAt: 123,
      recordCount: 2,
      generation: 1,
    });
  });

  it("getSyncMeta returns undefined for a key that was never written", async () => {
    const catalogDb = await openCatalogDb();
    await expect(getSyncMeta(catalogDb, "vod:never-synced")).resolves.toBeUndefined();
  });
});
