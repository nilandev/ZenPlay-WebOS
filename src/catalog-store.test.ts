import { beforeEach, describe, expect, it } from "vitest";
import { __clearCatalogDbForTests, __resetCatalogDbForTests, openCatalogDb, putRecordsBatch, type CatalogRecord } from "./core/storage/catalog-db.js";
import { getCatalogCount, getCatalogPage, hasLocalCatalog } from "./catalog-store.js";

function vodRecord(overrides: Partial<CatalogRecord> & Pick<CatalogRecord, "streamId" | "name">): CatalogRecord {
  return {
    id: `source-1:${overrides.streamId}`,
    sourceId: "source-1",
    nameLower: overrides.name.toLowerCase(),
    generation: 1,
    ...overrides,
  };
}

describe("catalog-store", () => {
  beforeEach(async () => {
    __resetCatalogDbForTests();
    await __clearCatalogDbForTests();
  });

  describe("getCatalogPage", () => {
    it("maps vod records back into Channel shape", async () => {
      const catalogDb = await openCatalogDb();
      await putRecordsBatch(catalogDb, "vod", [
        vodRecord({ streamId: "1", name: "Alpha", groupTitle: "action", streamUrl: "http://x/1.mp4", logoUrl: "http://x/1.png" }),
      ]);

      const page = await getCatalogPage("source-1", "vod", { offset: 0, limit: 10 });

      expect(page).toEqual([
        { id: "1", name: "Alpha", logoUrl: "http://x/1.png", groupTitle: "action", streamUrl: "http://x/1.mp4", kind: "movie" },
      ]);
    });

    it("maps series records back into the browse-grid summary shape", async () => {
      const catalogDb = await openCatalogDb();
      await putRecordsBatch(catalogDb, "series", [
        { id: "source-1:1", sourceId: "source-1", streamId: "1", name: "Show", nameLower: "show", groupTitle: "drama", posterUrl: "http://x/p.png", generation: 1 },
      ]);

      const page = await getCatalogPage("source-1", "series", { offset: 0, limit: 10 });

      expect(page).toEqual([{ id: "1", name: "Show", posterUrl: "http://x/p.png", groupTitle: "drama" }]);
    });

    it("filters by category", async () => {
      const catalogDb = await openCatalogDb();
      await putRecordsBatch(catalogDb, "vod", [
        vodRecord({ streamId: "1", name: "Action Movie", groupTitle: "action" }),
        vodRecord({ streamId: "2", name: "Comedy Movie", groupTitle: "comedy" }),
      ]);

      const page = await getCatalogPage("source-1", "vod", { categoryId: "comedy", offset: 0, limit: 10 });

      expect(page.map((c) => c.name)).toEqual(["Comedy Movie"]);
    });

    it("filters by case-insensitive name prefix", async () => {
      const catalogDb = await openCatalogDb();
      await putRecordsBatch(catalogDb, "vod", [vodRecord({ streamId: "1", name: "Matrix Reloaded" }), vodRecord({ streamId: "2", name: "Inception" })]);

      const page = await getCatalogPage("source-1", "vod", { namePrefix: "MAT", offset: 0, limit: 10 });

      expect(page.map((c) => c.name)).toEqual(["Matrix Reloaded"]);
    });
  });

  describe("getCatalogCount", () => {
    it("counts matching records for the same filter shape as getCatalogPage", async () => {
      const catalogDb = await openCatalogDb();
      await putRecordsBatch(catalogDb, "vod", [
        vodRecord({ streamId: "1", name: "A", groupTitle: "action" }),
        vodRecord({ streamId: "2", name: "B", groupTitle: "action" }),
        vodRecord({ streamId: "3", name: "C", groupTitle: "comedy" }),
      ]);

      await expect(getCatalogCount("source-1", "vod", { categoryId: "action" })).resolves.toBe(2);
      await expect(getCatalogCount("source-1", "vod")).resolves.toBe(3);
    });
  });

  describe("hasLocalCatalog", () => {
    it("is false before any sync has completed for this source+kind", async () => {
      await expect(hasLocalCatalog("source-1", "vod")).resolves.toBe(false);
    });
  });
});
