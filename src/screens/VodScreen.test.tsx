import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistSource, Profile } from "@core";
import { clearAllCachedContent, getCachedContent } from "../content-cache.js";
import { __clearCatalogDbForTests, __resetCatalogDbForTests, openCatalogDb, putRecordsBatch, putSyncMeta } from "../core/storage/catalog-db.js";
import { useFocusStore } from "../ui/focus/focus-store.js";
import { __resetCategoryMemoryForTests, VodScreen } from "./VodScreen.js";

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
});

// The screen starts a background catalog sync on mount (see catalog-sync.ts),
// which would otherwise hit the network through a real XtreamClient. These
// tests cover the screen's legacy/local read paths, not the sync itself.
vi.mock("../catalog-sync.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../catalog-sync.js")>()),
  startCatalogBackgroundSync: vi.fn(() => () => {}),
}));

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

describe("VodScreen category-lazy fetching", () => {
  beforeEach(async () => {
    clearAllCachedContent();
    __resetCategoryMemoryForTests();
    __resetCatalogDbForTests();
    await __clearCatalogDbForTests();
    useFocusStore.getState().clearGraph("content");
    useFocusStore.getState().clearGraph("chrome:vod-search");
    useFocusStore.getState().clearGraph("chrome:category-dropdown-trigger");
    useFocusStore.getState().clearGraph("chrome:category-dropdown-panel");
    vi.clearAllMocks();
  });

  it("fetches the full catalog for the default All Categories view", async () => {
    const { loadChannelsByKind, loadVodCategories } = await import("../content-loader.js");
    (loadChannelsByKind as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    render(<VodScreen source={source} platform="web" profile={profile} onPlay={() => {}} onBack={() => {}} />);
    await vi.waitFor(() => expect(loadChannelsByKind).toHaveBeenCalled());

    expect(loadVodCategories).toHaveBeenCalledTimes(1);
    expect(loadChannelsByKind).toHaveBeenCalledWith(source, "movie");
  });

  it("selecting a category fetches only that category, not the full catalog again", async () => {
    const { loadChannelsByKind } = await import("../content-loader.js");
    (loadChannelsByKind as ReturnType<typeof vi.fn>).mockImplementation(
      (_source: PlaylistSource, _kind: string, categoryId?: string) =>
        Promise.resolve(
          categoryId === "cat-1" ? [{ id: "m1", name: "Action Movie", streamUrl: "x", kind: "movie" as const, groupTitle: "cat-1" }] : [],
        ),
    );

    render(<VodScreen source={source} platform="web" profile={profile} onPlay={() => {}} onBack={() => {}} />);
    await vi.waitFor(() => expect(loadChannelsByKind).toHaveBeenCalledWith(source, "movie"));

    (loadChannelsByKind as ReturnType<typeof vi.fn>).mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Action" })); // the category rail row
    await flush();

    expect(loadChannelsByKind).toHaveBeenCalledWith(source, "movie", "cat-1");
    expect(loadChannelsByKind).not.toHaveBeenCalledWith(source, "movie");
    expect(getCachedContent(`vod:${source.id}:cat:cat-1`)).toEqual([
      { id: "m1", name: "Action Movie", streamUrl: "x", kind: "movie", groupTitle: "cat-1" },
    ]);
    expect(await screen.findByText("Action Movie")).not.toBeNull();
  });
});

describe("VodScreen with a synced local catalog", () => {
  beforeEach(async () => {
    clearAllCachedContent();
    __resetCategoryMemoryForTests();
    __resetCatalogDbForTests();
    await __clearCatalogDbForTests();
    useFocusStore.getState().clearGraph("content");
    useFocusStore.getState().clearGraph("chrome:vod-search");
    useFocusStore.getState().clearGraph("chrome:category-dropdown-trigger");
    useFocusStore.getState().clearGraph("chrome:category-dropdown-panel");
    vi.clearAllMocks();
  });

  it("renders shelves from the local table and never calls the live full-catalog fetch", async () => {
    const catalogDb = await openCatalogDb();
    await putRecordsBatch(catalogDb, "vod", [
      { id: `${source.id}:1`, sourceId: source.id, streamId: "1", name: "Action Movie", nameLower: "action movie", groupTitle: "cat-1", streamUrl: "x", generation: 1 },
    ]);
    await putSyncMeta(catalogDb, { key: `vod:${source.id}`, lastSyncedAt: Date.now(), recordCount: 1, generation: 1 });

    const { loadChannelsByKind } = await import("../content-loader.js");

    render(<VodScreen source={source} platform="web" profile={profile} onPlay={() => {}} onBack={() => {}} />);
    await flush();

    expect(await screen.findByText("Action Movie")).not.toBeNull();
    expect(loadChannelsByKind).not.toHaveBeenCalled();
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

describe("VodScreen at catalog scale (legacy path)", () => {
  beforeEach(async () => {
    clearAllCachedContent();
    __resetCategoryMemoryForTests();
    __resetCatalogDbForTests();
    await __clearCatalogDbForTests();
    useFocusStore.getState().clearGraph("content");
    useFocusStore.getState().clearGraph("chrome:vod-search");
    useFocusStore.getState().clearGraph("chrome:category-dropdown-trigger");
    useFocusStore.getState().clearGraph("chrome:category-dropdown-panel");
    vi.clearAllMocks();
  });

  it("starts only the movie catalog sync, and caps each shelf at 20 cards", async () => {
    const { loadChannelsByKind } = await import("../content-loader.js");
    (loadChannelsByKind as ReturnType<typeof vi.fn>).mockResolvedValue(
      Array.from({ length: 300 }, (_, i) => ({ id: `m${i}`, name: `Movie ${i}`, streamUrl: "x", kind: "movie" as const, groupTitle: "cat-1" })),
    );
    const { startCatalogBackgroundSync } = await import("../catalog-sync.js");

    const { container } = render(<VodScreen source={source} platform="web" profile={profile} onPlay={() => {}} onBack={() => {}} />);
    await screen.findByText("Movie 0");

    expect(startCatalogBackgroundSync).toHaveBeenCalledWith(expect.any(Function), ["vod"]);
    const posters = Array.from(container.querySelectorAll('[role="button"]')).filter((el) => !el.textContent?.startsWith("See all"));
    expect(posters).toHaveLength(20);
  });
});
