import { describe, expect, it } from "vitest";
import { bumpCacheVersion, useCacheInvalidationStore } from "./cache-invalidation-store.js";

describe("cache-invalidation-store", () => {
  it("starts a key at no version (undefined) until bumped", () => {
    expect(useCacheInvalidationStore.getState().versions["never-bumped"]).toBeUndefined();
  });

  it("increments a key's version on each bump, independently of other keys", () => {
    bumpCacheVersion("a");
    bumpCacheVersion("a");
    bumpCacheVersion("b");

    const versions = useCacheInvalidationStore.getState().versions;
    expect(versions.a).toBe(2);
    expect(versions.b).toBe(1);
  });
});
