import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel, PlaylistSource } from "@core";
import { clearAllCachedContent } from "../content-cache.js";
import { __clearCatalogDbForTests, __resetCatalogDbForTests, openCatalogDb, putRecordsBatch, putSyncMeta } from "../core/storage/catalog-db.js";
import { loadFavorites, toggleFavorite } from "../profile-store.js";
import { useFocusStore } from "../ui/focus/focus-store.js";
import { FavouritesScreen } from "./FavouritesScreen.js";

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
});

const { live, movies, series } = vi.hoisted(() => ({
  live: [
    { id: "ch-1", name: "News One", streamUrl: "http://x/1.m3u8", kind: "live" },
    { id: "ch-2", name: "Sports One", streamUrl: "http://x/2.m3u8", kind: "live" },
  ] as Channel[],
  movies: [{ id: "m-1", name: "Inception", streamUrl: "http://x/m1.mp4", kind: "movie" }] as Channel[],
  series: [{ id: "s-1", name: "The Night Agent" }],
}));

vi.mock("../use-live-channels.js", () => ({
  useLiveChannels: () => ({ channels: live, isInitialLoading: false, error: null }),
}));

// Saved movies/series resolve from the local catalog table (seeded below); a
// missing table is requested from the sync manager — see the last test.
vi.mock("../sync/sync-manager.js", () => ({ syncSource: vi.fn().mockResolvedValue({ stages: {}, errors: {} }) }));

const source: PlaylistSource = { kind: "xtream", id: "src-1", name: "My Source", baseUrl: "http://x", username: "u", password: "p" };
const PROFILE = "profile-1";

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
    });
  }
}

function press(key: string): void {
  act(() => {
    fireEvent.keyDown(document, { key });
    fireEvent.keyUp(document, { key });
  });
}

const focusedId = () => useFocusStore.getState().focusedId;
const savedIds = () => loadFavorites(PROFILE).map((f) => f.contentId);

describe("FavouritesScreen (My List)", () => {
  beforeEach(async () => {
    clearAllCachedContent();
    localStorage.clear();
    __resetCatalogDbForTests();
    await __clearCatalogDbForTests();
    useFocusStore.getState().clearGraph("favourites");
    vi.clearAllMocks();
    const catalogDb = await openCatalogDb();
    await putRecordsBatch(
      catalogDb,
      "vod",
      movies.map((m) => ({ id: `${source.id}:${m.id}`, sourceId: source.id, streamId: m.id, name: m.name, nameLower: m.name.toLowerCase(), streamUrl: m.streamUrl, generation: 1 })),
    );
    await putRecordsBatch(
      catalogDb,
      "series",
      series.map((x) => ({ id: `${source.id}:${x.id}`, sourceId: source.id, streamId: x.id, name: x.name, nameLower: x.name.toLowerCase(), generation: 1 })),
    );
    await putSyncMeta(catalogDb, { key: `vod:${source.id}`, lastSyncedAt: Date.now(), recordCount: movies.length, generation: 1 });
    await putSyncMeta(catalogDb, { key: `series:${source.id}`, lastSyncedAt: Date.now(), recordCount: series.length, generation: 1 });
  });

  afterEach(() => {
    useFocusStore.getState().clearGraph("favourites");
  });

  function renderList(handlers: Partial<{ onPlayChannel: (c: Channel) => void; onPlayMovie: (c: Channel) => void; onOpenSeries: (id: string) => void; onBack: () => void }> = {}) {
    return render(
      <FavouritesScreen
        source={source}
        profileId={PROFILE}
        platform="web"
        onBack={handlers.onBack ?? (() => {})}
        onPlayChannel={handlers.onPlayChannel ?? (() => {})}
        onPlayMovie={handlers.onPlayMovie ?? (() => {})}
        onOpenSeries={handlers.onOpenSeries ?? (() => {})}
      />,
    );
  }

  function saveAll(): void {
    toggleFavorite(PROFILE, source.id, "live", "ch-1");
    toggleFavorite(PROFILE, source.id, "live", "ch-2");
    toggleFavorite(PROFILE, source.id, "movie", "m-1");
    toggleFavorite(PROFILE, source.id, "series", "s-1");
  }

  it("shows one row per type with counts — no tabs — newest first", async () => {
    saveAll();
    renderList();
    await settle();

    expect(screen.getByText("Channels · 2")).toBeDefined();
    expect(screen.getByText("Movies · 1")).toBeDefined();
    expect(screen.getByText("Series · 1")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Live TV" })).toBeNull();
    expect(screen.getByText(/4 items/)).toBeDefined();
    expect(focusedId()).toBe("favourites-item:live:ch-2"); // most recently saved channel first
  });

  it("OK opens or plays the focused item", async () => {
    saveAll();
    const onPlayChannel = vi.fn();
    const onOpenSeries = vi.fn();
    renderList({ onPlayChannel, onOpenSeries });
    await settle();

    press("Enter");
    // With My List's channels as the lineup, for CH+/CH− in the player.
    expect(onPlayChannel).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ch-2" }),
      expect.objectContaining({ lineup: [expect.objectContaining({ id: "ch-2" }), expect.objectContaining({ id: "ch-1" })] }),
    );

    act(() => useFocusStore.getState().focus("favourites-item:series:s-1"));
    press("Enter");
    expect(onOpenSeries).toHaveBeenCalledWith("s-1");
  });

  it("Edit My List: OK removes the focused item and focus moves to its neighbour; Back leaves edit mode first", async () => {
    saveAll();
    const onBack = vi.fn();
    const onPlayChannel = vi.fn();
    renderList({ onBack, onPlayChannel });
    await settle();

    act(() => useFocusStore.getState().focus("favourites-edit"));
    press("Enter");
    expect(screen.getByText("Select an item to remove it")).toBeDefined();

    act(() => useFocusStore.getState().focus("favourites-item:live:ch-2"));
    press("Enter");
    await settle();

    expect(onPlayChannel).not.toHaveBeenCalled();
    expect(savedIds()).not.toContain("ch-2");
    expect(screen.getByText("Channels · 1")).toBeDefined();
    expect(focusedId()).toBe("favourites-item:live:ch-1");

    press("Escape");
    expect(screen.queryByText("Select an item to remove it")).toBeNull();
    expect(onBack).not.toHaveBeenCalled();
    press("Escape");
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("long-press OK removes an item without entering edit mode", async () => {
    saveAll();
    renderList();
    await settle();

    act(() => useFocusStore.getState().focus("favourites-item:movie:m-1"));
    act(() => {
      fireEvent.keyDown(document, { key: "Enter" });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 550));
    });
    act(() => {
      fireEvent.keyUp(document, { key: "Enter" });
    });
    await settle();

    expect(savedIds()).not.toContain("m-1");
    expect(screen.queryByText(/^Movies/)).toBeNull();
  });

  it("shows an empty state when nothing is saved", async () => {
    renderList();
    await settle();
    expect(screen.getByText("Your list is empty")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Edit My List/ })).toBeNull();
  });

  it("asks the sync manager for a movie table that hasn't been built yet, instead of downloading the catalog", async () => {
    __resetCatalogDbForTests();
    await __clearCatalogDbForTests(); // no synced tables at all
    toggleFavorite(PROFILE, source.id, "movie", "m-1");
    const { syncSource } = await import("../sync/sync-manager.js");

    renderList();
    await vi.waitFor(() => expect(syncSource).toHaveBeenCalledWith(source, { trigger: "first-run", stages: ["vod"] }));
    expect(screen.queryByText("Inception")).toBeNull();
  });
});
