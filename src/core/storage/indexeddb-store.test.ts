import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetIdbStoreForTests,
  clearStore,
  deleteAllBySuffix,
  deleteKey,
  getAllEntries,
  openIdbStore,
  putEntry,
} from "./indexeddb-store.js";

describe("indexeddb-store", () => {
  beforeEach(async () => {
    __resetIdbStoreForTests();
    // Each fake-indexeddb "database" persists across openIdbStore() calls
    // within the same test file (only the module-level connection cache is
    // reset above) — clear its contents too so one test's writes can't leak
    // into the next.
    const store = await openIdbStore();
    await clearStore(store);
  });

  it("round-trips a value through put/getAllEntries", async () => {
    const store = await openIdbStore();
    await putEntry(store, "key-1", { value: { hello: "world" }, cachedAt: 123, kind: "catalog" });

    const entries = await getAllEntries<{ value: unknown }>(store);
    expect(entries).toEqual([["key-1", { value: { hello: "world" }, cachedAt: 123, kind: "catalog" }]]);
  });

  it("overwrites an existing key on a second put", async () => {
    const store = await openIdbStore();
    await putEntry(store, "key-1", { value: "first" });
    await putEntry(store, "key-1", { value: "second" });

    const entries = await getAllEntries<{ value: string }>(store);
    expect(entries).toEqual([["key-1", { value: "second" }]]);
  });

  it("deletes a single key", async () => {
    const store = await openIdbStore();
    await putEntry(store, "keep", { value: 1 });
    await putEntry(store, "drop", { value: 2 });

    await deleteKey(store, "drop");

    const keys = (await getAllEntries(store)).map(([key]) => key);
    expect(keys).toEqual(["keep"]);
  });

  it("deletes every key matching a suffix", async () => {
    const store = await openIdbStore();
    await putEntry(store, "live:source-1", { value: 1 });
    await putEntry(store, "vod:source-1", { value: 2 });
    await putEntry(store, "live:source-2", { value: 3 });

    await deleteAllBySuffix(store, ":source-1");

    const keys = (await getAllEntries(store)).map(([key]) => key);
    expect(keys).toEqual(["live:source-2"]);
  });

  it("clears every entry", async () => {
    const store = await openIdbStore();
    await putEntry(store, "a", { value: 1 });
    await putEntry(store, "b", { value: 2 });

    await clearStore(store);

    expect(await getAllEntries(store)).toEqual([]);
  });

  it("reuses the same open connection across calls until reset", async () => {
    const first = await openIdbStore();
    const second = await openIdbStore();
    expect(first).toBe(second);
  });
});
