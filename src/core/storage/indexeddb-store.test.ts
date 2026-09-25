import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetIdbStoreForTests,
  clearStore,
  deleteKey,
  deleteKeysMatching,
  getAllKeys,
  getEntry,
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

  it("round-trips a value through put/get, keeping Dates as Dates", async () => {
    const store = await openIdbStore();
    const expiresAt = new Date("2027-01-01T00:00:00.000Z");
    await putEntry(store, "key-1", { value: { hello: "world", expiresAt }, cachedAt: 123, kind: "catalog" });

    expect(await getEntry(store, "key-1")).toEqual({ value: { hello: "world", expiresAt }, cachedAt: 123, kind: "catalog" });
    expect(((await getEntry<{ value: { expiresAt: unknown } }>(store, "key-1"))!.value.expiresAt)).toBeInstanceOf(Date);
    expect(await getEntry(store, "missing")).toBeUndefined();
  });

  it("overwrites an existing key on a second put", async () => {
    const store = await openIdbStore();
    await putEntry(store, "key-1", { value: "first" });
    await putEntry(store, "key-1", { value: "second" });

    expect(await getEntry(store, "key-1")).toEqual({ value: "second" });
  });

  it("deletes a single key", async () => {
    const store = await openIdbStore();
    await putEntry(store, "keep", { value: 1 });
    await putEntry(store, "drop", { value: 2 });

    await deleteKey(store, "drop");

    const keys = await getAllKeys(store);
    expect(keys).toEqual(["keep"]);
  });

  it("deletes every key a predicate matches", async () => {
    const store = await openIdbStore();
    await putEntry(store, "live:source-1", { value: 1 });
    await putEntry(store, "vod:source-1", { value: 2 });
    await putEntry(store, "live:source-2", { value: 3 });

    await deleteKeysMatching(store, (key) => key.endsWith(":source-1"));

    const keys = await getAllKeys(store);
    expect(keys).toEqual(["live:source-2"]);
  });

  it("clears every entry", async () => {
    const store = await openIdbStore();
    await putEntry(store, "a", { value: 1 });
    await putEntry(store, "b", { value: 2 });

    await clearStore(store);

    expect(await getAllKeys(store)).toEqual([]);
  });

  it("reuses the same open connection across calls until reset", async () => {
    const first = await openIdbStore();
    const second = await openIdbStore();
    expect(first).toBe(second);
  });
});
