import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistSource, Profile } from "@core";
import { clearAllCachedContent, getCachedContent } from "../content-cache.js";
import { __clearCatalogDbForTests, __resetCatalogDbForTests, openCatalogDb, putRecordsBatch, putSyncMeta } from "../core/storage/catalog-db.js";
import { __resetSyncStoreForTests, useSyncStore } from "../sync/sync-store.js";
import { useFocusStore } from "../ui/focus/focus-store.js";
import { __resetCategoryMemoryForTests, VodScreen } from "./VodScreen.js";

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
});

// The screen asks the sync manager to build its table when it's missing;
// these tests cover what the screen shows and reads, not the sync itself.
vi.mock("../sync/sync-manager.js", () => ({ syncSource: vi.fn().mockResolvedValue({ stages: {}, errors: {} }) }));

vi.mock("../content-loader.js", () => ({
  loadChannelsByKind: vi.fn(),
  loadVodCategories: vi.fn().mockResolvedValue([
    { id: "cat-1", name: "Action", kind: "movie" },
    { id: "cat-2", name: "Comedy", kind: "movie" },
  ]),
}));

const source: PlaylistSource = {
  kind: "xtream",
  id: "src-1",
  name: "My Source",
  baseUrl: "http://example.com",
  username: "u",
  password: "p",
};

const profile: Profile = { id: "profile-1", name: "Alex", avatarUrl: "avatar/toon_1.png" };

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function resetScreenState(): Promise<void> {
  clearAllCachedContent();
  __resetCategoryMemoryForTests();
  __resetSyncStoreForTests();
  __resetCatalogDbForTests();
  await __clearCatalogDbForTests();
  useFocusStore.getState().clearGraph("content");
  useFocusStore.getState().clearGraph("chrome:vod-search");
  useFocusStore.getState().clearGraph("chrome:category-dropdown-trigger");
  useFocusStore.getState().clearGraph("chrome:category-dropdown-panel");
  vi.clearAllMocks();
}

describe("VodScreen while the movie table is still being built", () => {
  beforeEach(resetScreenState);

  it("asks the sync manager for the movie table and says it's on its way, without a row count — never downloading the catalog itself", async () => {
    const { loadChannelsByKind } = await import("../content-loader.js");
    const { syncSource } = await import("../sync/sync-manager.js");

    render(<VodScreen source={source} platform="web" profile={profile} onPlay={() => {}} onBack={() => {}} />);
    await vi.waitFor(() => expect(syncSource).toHaveBeenCalledWith(source, { trigger: "first-run", stages: ["vod"] }));
    expect(await screen.findByText("Getting your movies ready…")).not.toBeNull();

    act(() => useSyncStore.getState().setStage(source.id, "vod", { status: "running", done: 12400 }));
    expect(screen.queryByText(/12,?400/)).toBeNull();
    expect(screen.getByText("Getting your movies ready…")).not.toBeNull();
    expect(loadChannelsByKind).not.toHaveBeenCalled();
  });

  it("says why when the sync failed", async () => {
    render(<VodScreen source={source} platform="web" profile={profile} onPlay={() => {}} onBack={() => {}} />);
    await screen.findByText("Getting your movies ready…");

    act(() => useSyncStore.getState().setStage(source.id, "vod", { status: "failed", error: "The provider didn't respond within 120 seconds." }));
    expect(screen.getByText("Couldn't load your movies")).not.toBeNull();
    expect(screen.getByText(/didn't respond within 120 seconds\. We'll try again automatically\./)).not.toBeNull();
  });

  it("lets the rail hold focus while there's nothing to browse", async () => {
    render(<VodScreen source={source} platform="web" profile={profile} onPlay={() => {}} onBack={() => {}} />);
    await screen.findByText("Getting your movies ready…");
    await vi.waitFor(() => expect(useFocusStore.getState().focusedId).toBe("rail:__all__"));
  });

  it("picking a category meanwhile fetches just that category from the provider", async () => {
    const { loadChannelsByKind } = await import("../content-loader.js");
    (loadChannelsByKind as ReturnType<typeof vi.fn>).mockImplementation((_source: PlaylistSource, _kind: string, categoryId?: string) =>
      Promise.resolve(categoryId === "cat-1" ? [{ id: "m1", name: "Action Movie", streamUrl: "x", kind: "movie" as const, groupTitle: "cat-1" }] : []),
    );

    render(<VodScreen source={source} platform="web" profile={profile} onPlay={() => {}} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Action" })); // the category rail row

    expect(await screen.findByText("Action Movie")).not.toBeNull();
    expect(loadChannelsByKind).toHaveBeenCalledWith(source, "movie", "cat-1");
    expect(loadChannelsByKind).not.toHaveBeenCalledWith(source, "movie");
    expect(getCachedContent(`vod:${source.id}:cat:cat-1`)).toEqual([{ id: "m1", name: "Action Movie", streamUrl: "x", kind: "movie", groupTitle: "cat-1" }]);
  });

  it("for an M3U playlist, asks for the live stage — its movies come from the same download", async () => {
    const { syncSource } = await import("../sync/sync-manager.js");
    const m3u: PlaylistSource = { kind: "m3u-url", id: "src-m3u", name: "M3U", url: "http://example.com/list.m3u" };

    render(<VodScreen source={m3u} platform="web" profile={profile} onPlay={() => {}} onBack={() => {}} />);
    await vi.waitFor(() => expect(syncSource).toHaveBeenCalledWith(m3u, { trigger: "first-run", stages: ["live"] }));
  });
});

describe("VodScreen with a synced local catalog", () => {
  beforeEach(resetScreenState);

  it("renders shelves from the local table and never calls the live full-catalog fetch", async () => {
    const catalogDb = await openCatalogDb();
    await putRecordsBatch(catalogDb, "vod", [
      { id: `${source.id}:1`, sourceId: source.id, streamId: "1", name: "Action Movie", nameLower: "action movie", groupTitle: "cat-1", streamUrl: "x", generation: 1 },
    ]);
    await putSyncMeta(catalogDb, { key: `vod:${source.id}`, lastSyncedAt: Date.now(), recordCount: 1, generation: 1 });

    const { loadChannelsByKind } = await import("../content-loader.js");
    const { syncSource } = await import("../sync/sync-manager.js");

    render(<VodScreen source={source} platform="web" profile={profile} onPlay={() => {}} onBack={() => {}} />);
    await flush();

    expect(await screen.findByText("Action Movie")).not.toBeNull();
    expect(loadChannelsByKind).not.toHaveBeenCalled();
    expect(syncSource).not.toHaveBeenCalled(); // keeping it fresh is the scheduler's job
  });

  it("search reads a prefix match from the local table", async () => {
    const catalogDb = await openCatalogDb();
    await putRecordsBatch(catalogDb, "vod", [
      { id: `${source.id}:1`, sourceId: source.id, streamId: "1", name: "Matrix Reloaded", nameLower: "matrix reloaded", generation: 1 },
      { id: `${source.id}:2`, sourceId: source.id, streamId: "2", name: "Inception", nameLower: "inception", generation: 1 },
    ]);
    await putSyncMeta(catalogDb, { key: `vod:${source.id}`, lastSyncedAt: Date.now(), recordCount: 2, generation: 1 });

    render(<VodScreen source={source} platform="web" profile={profile} onPlay={() => {}} onBack={() => {}} />);
    const searchInput = await screen.findByPlaceholderText("Search movies");

    fireEvent.change(searchInput, { target: { value: "matrix" } });
    await flush();

    expect(await screen.findByText("Matrix Reloaded")).not.toBeNull();
    expect(screen.queryByText("Inception")).toBeNull();
  });
});

describe("VodScreen at catalog scale", () => {
  beforeEach(resetScreenState);

  it("caps each Browse shelf at 20 cards instead of mounting the whole category", async () => {
    const catalogDb = await openCatalogDb();
    await putRecordsBatch(
      catalogDb,
      "vod",
      // Ids descend so movie 000 is the newest, which pages list first.
      Array.from({ length: 300 }, (_, i) => ({
        id: `${source.id}:m${999 - i}`,
        sourceId: source.id,
        streamId: `m${999 - i}`,
        name: `Movie ${String(i).padStart(3, "0")}`,
        nameLower: `movie ${String(i).padStart(3, "0")}`,
        groupTitle: "cat-1",
        streamUrl: "x",
        generation: 1,
      })),
    );
    await putSyncMeta(catalogDb, { key: `vod:${source.id}`, lastSyncedAt: Date.now(), recordCount: 300, generation: 1 });

    const { container } = render(<VodScreen source={source} platform="web" profile={profile} onPlay={() => {}} onBack={() => {}} />);
    await screen.findByText("Movie 000");

    const posters = Array.from(container.querySelectorAll('[role="button"]')).filter((el) => !el.textContent?.startsWith("See all"));
    expect(posters).toHaveLength(20);
  });
});

describe("VodScreen in a Kids profile", () => {
  beforeEach(() => {
    localStorage.clear();
    return resetScreenState();
  });

  const kid: Profile = { id: "kid-1", name: "Mia", avatarUrl: "avatar/toon_2.png", kind: "kids" };

  it("shows only allowed categories and titles (AC3, AC4)", async () => {
    const { loadVodCategories } = await import("../content-loader.js");
    (loadVodCategories as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: "cat-1", name: "Action", kind: "movie" },
      { id: "cat-kids", name: "Kids Movies", kind: "movie" },
    ]);
    const catalogDb = await openCatalogDb();
    await putRecordsBatch(catalogDb, "vod", [
      { id: `${source.id}:1`, sourceId: source.id, streamId: "1", name: "Action Movie", nameLower: "action movie", groupTitle: "cat-1", streamUrl: "x", generation: 1 },
      { id: `${source.id}:2`, sourceId: source.id, streamId: "2", name: "Frozen", nameLower: "frozen", groupTitle: "cat-kids", streamUrl: "x", generation: 1 },
      { id: `${source.id}:3`, sourceId: source.id, streamId: "3", name: "Christmas Horror", nameLower: "christmas horror", groupTitle: "cat-kids", streamUrl: "x", generation: 1 },
    ]);
    await putSyncMeta(catalogDb, { key: `vod:${source.id}`, lastSyncedAt: Date.now(), recordCount: 3, generation: 1 });

    render(<VodScreen source={source} platform="web" profile={kid} onPlay={() => {}} onBack={() => {}} />);
    expect(await screen.findByText("Frozen")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Kids Movies" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Action" })).toBeNull();
    expect(screen.queryByText("Action Movie")).toBeNull();
    expect(screen.queryByText("Christmas Horror")).toBeNull();
  });

  it("never falls back to an unfiltered provider fetch while the table is being built", async () => {
    const { loadChannelsByKind } = await import("../content-loader.js");
    render(<VodScreen source={source} platform="web" profile={kid} onPlay={() => {}} onBack={() => {}} />);
    await screen.findByText("Getting your movies ready…");
    await flush();
    expect(loadChannelsByKind).not.toHaveBeenCalled();
  });
});
