import { beforeEach, describe, expect, it } from "vitest";
import type { Category, Channel } from "@core";
import { channelToRecord, seriesToRecord } from "./catalog-records.js";
import { getCatalogCount, getCatalogPage } from "./catalog-store.js";
import { createKidsPolicy, MORE_FOR_KIDS_CATEGORY_ID, PARENT_PICKS_CATEGORY_ID, PASS_THROUGH_POLICY } from "./content-policy.js";
import { __clearCatalogDbForTests, __resetCatalogDbForTests, openCatalogDb, putRecordsBatch } from "./core/storage/catalog-db.js";

const SOURCE = "src";
const vodCategories: Category[] = [
  { id: "1", name: "Kids Movies", kind: "movie" },
  { id: "2", name: "Comedy", kind: "movie" },
  { id: "3", name: "Horror", kind: "movie" },
];
const movie = (id: string, name: string, groupTitle: string): Channel => ({ id, name, groupTitle, streamUrl: `http://x/${id}.mp4`, kind: "movie" });

describe("PASS_THROUGH_POLICY (standard profiles)", () => {
  it("filters nothing", () => {
    expect(PASS_THROUGH_POLICY.isKids).toBe(false);
    expect(PASS_THROUGH_POLICY.visibleCatalogCategories("vod", vodCategories)).toBe(vodCategories);
    expect(PASS_THROUGH_POLICY.catalogFilter("vod", vodCategories)).toBeUndefined();
    expect(PASS_THROUGH_POLICY.isItemAllowed("vod", { id: "1", name: "Horror Night" })).toBe(true);
  });
});

describe("Kids policy", () => {
  it("lists Picked by Parent, the allowed categories, and More for Kids when enabled", () => {
    const policy = createKidsPolicy({ profileId: "k", sourceId: SOURCE, parent: { items: { vod: { "9": "include" } } }, allowOtherCategories: true });
    expect(policy.visibleCatalogCategories("vod", vodCategories).map((c) => c.id)).toEqual([PARENT_PICKS_CATEGORY_ID, "1", MORE_FOR_KIDS_CATEGORY_ID]);
  });

  it("filters live channels: allowed categories, known kids channels anywhere, never adult ones", () => {
    const policy = createKidsPolicy({ profileId: "k", sourceId: SOURCE, parent: undefined, allowOtherCategories: false });
    const live: Category[] = [
      { id: "10", name: "Kids", kind: "live" },
      { id: "11", name: "USA Entertainment", kind: "live" },
    ];
    const channels: Channel[] = [
      { id: "a", name: "Baby Shark TV", groupTitle: "10", streamUrl: "", kind: "live" },
      { id: "b", name: "US: Nickelodeon HD", groupTitle: "11", streamUrl: "", kind: "live" },
      { id: "c", name: "US: HBO", groupTitle: "11", streamUrl: "", kind: "live" },
      { id: "d", name: "Adult Swim", groupTitle: "10", streamUrl: "", kind: "live" },
    ];
    expect(policy.filterLiveChannels(channels, live).map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("catalog reads through a Kids filter", () => {
  beforeEach(async () => {
    __resetCatalogDbForTests();
    await __clearCatalogDbForTests();
    const db = await openCatalogDb();
    await putRecordsBatch(db, "vod", [
      channelToRecord(SOURCE, 1, movie("1", "Frozen", "1")),
      channelToRecord(SOURCE, 1, movie("2", "Moana", "1")),
      channelToRecord(SOURCE, 1, movie("3", "Christmas Horror", "1")),
      channelToRecord(SOURCE, 1, movie("4", "Cartoon Party", "2")),
      channelToRecord(SOURCE, 1, movie("5", "Adult Comedy", "2")),
      channelToRecord(SOURCE, 1, movie("6", "Night Terror", "3")),
    ]);
  });

  it("returns only allowed titles for a category, search and count", async () => {
    const policy = createKidsPolicy({ profileId: "k", sourceId: SOURCE, parent: undefined, allowOtherCategories: false });
    const filter = policy.catalogFilter("vod", vodCategories);
    const kids = await getCatalogPage(SOURCE, "vod", { categoryId: "1", offset: 0, limit: 10, filter });
    expect(kids.map((m) => m.name)).toEqual(["Frozen", "Moana"]);
    expect(await getCatalogCount(SOURCE, "vod", { categoryId: "1", filter })).toBe(2);
    expect(await getCatalogPage(SOURCE, "vod", { categoryId: "3", offset: 0, limit: 10, filter })).toEqual([]);
    // Search walks the whole playlist but still only yields allowed titles.
    const search = await getCatalogPage(SOURCE, "vod", { namePrefix: "c", offset: 0, limit: 10, filter });
    expect(search.map((m) => m.name)).toEqual([]);
    // Offsets count allowed rows only.
    expect((await getCatalogPage(SOURCE, "vod", { categoryId: "1", offset: 1, limit: 10, filter })).map((m) => m.name)).toEqual(["Moana"]);
  });

  it("serves Picked by Parent from force-included ids, and More for Kids from the tag index", async () => {
    const policy = createKidsPolicy({ profileId: "k", sourceId: SOURCE, parent: { items: { vod: { "6": "include" } } }, allowOtherCategories: true });
    const filter = policy.catalogFilter("vod", vodCategories);
    const picks = await getCatalogPage(SOURCE, "vod", { categoryId: PARENT_PICKS_CATEGORY_ID, offset: 0, limit: 10, filter });
    expect(picks.map((m) => m.name)).toEqual(["Night Terror"]);
    const more = await getCatalogPage(SOURCE, "vod", { categoryId: MORE_FOR_KIDS_CATEGORY_ID, offset: 0, limit: 10, filter });
    expect(more.map((m) => m.name)).toEqual(["Cartoon Party"]);
    expect(await getCatalogCount(SOURCE, "vod", { categoryId: MORE_FOR_KIDS_CATEGORY_ID, filter })).toBe(1);
  });

  it("tags records at write time, including series genre", () => {
    expect(channelToRecord(SOURCE, 1, movie("4", "Cartoon Party", "2"))).toMatchObject({ tags: ["animation"], mature: 0, tagKeys: ["src|animation"] });
    expect(seriesToRecord(SOURCE, 1, { id: "s", name: "Night Shift", groupTitle: "7", genre: "Horror, Thriller" })).toMatchObject({ genre: "Horror, Thriller", mature: 1 });
  });
});
