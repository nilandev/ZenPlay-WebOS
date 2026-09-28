import { describe, expect, it } from "vitest";
import { catalogRecordId, getRecordsByIds, openCatalogDb, queryPage, type CatalogRecord } from "./catalog-db.js";

// Its own file so the hand-built v2 database below is the first thing this
// file's (fresh) fake-indexeddb sees — no connection from another test is
// left open to block the upgrade.

function v2Record(streamId: string): CatalogRecord {
  return { id: `source-1:${streamId}`, sourceId: "source-1", streamId, name: `Movie ${streamId}`, nameLower: `movie ${streamId}`, generation: 1 };
}

function createV2Database(records: CatalogRecord[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("iptv-catalog-v1", 2);
    open.onupgradeneeded = () => {
      for (const kind of ["vod", "series"]) {
        const store = open.result.createObjectStore(kind, { keyPath: "id" });
        store.createIndex("by_source", "sourceId");
        store.createIndex("by_source_category", ["sourceId", "groupTitle"]);
        store.createIndex("by_source_name", ["sourceId", "nameLower"]);
        store.createIndex("by_tag_key", "tagKeys", { multiEntry: true });
      }
      open.result.createObjectStore("sync_meta", { keyPath: "key" });
      const vod = open.transaction!.objectStore("vod");
      for (const record of records) vod.put(record);
    };
    open.onsuccess = () => {
      open.result.close();
      resolve();
    };
    open.onerror = () => reject(open.error);
  });
}

describe("catalog-db upgrades", () => {
  it("re-keys a v2 database's rows to padded ids in place, so they read newest first with no re-sync", async () => {
    await createV2Database(["7", "12", "m3u-1"].map(v2Record));

    const catalogDb = await openCatalogDb();

    const all = await queryPage(catalogDb, "vod", { sourceId: "source-1", offset: 0, limit: 10 });
    expect(all.map((r) => r.id)).toEqual(["source-1:m3u-1", "source-1:000000000000012", "source-1:000000000000007"]);
    const [favourite] = await getRecordsByIds(catalogDb, "vod", [catalogRecordId("source-1", "12")]);
    expect(favourite?.name).toBe("Movie 12");

    // v5: the search index's stores exist, empty — nothing was rewritten to create them.
    expect([...catalogDb.db.objectStoreNames]).toEqual(expect.arrayContaining(["search_tokens", "search_index_meta"]));
    expect(catalogDb.db.version).toBe(5);
  });
});
