import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistSource, Profile } from "@core";
import { clearAllCachedContent } from "../content-cache.js";
import { __clearLiveDbForTests, __resetLiveDbForTests, openLiveDb, putLiveSyncMeta } from "../core/storage/live-db.js";
import { __resetCatalogDbForTests } from "../core/storage/catalog-db.js";
import { __resetEpgDbForTests } from "../core/storage/epg-db.js";
import { __resetSyncStoreForTests, useSyncStore } from "../sync/sync-store.js";
import { useFocusStore } from "../ui/focus/focus-store.js";
import { PROFILE_SWITCHER_FOCUS_ID } from "../ui/components/ProfileSwitcher.js";
import { __resetHomeFocusMemoryForTests, describeExpiry, HomeScreen } from "./HomeScreen.js";

// jsdom doesn't implement scrollIntoView; Focusable calls it whenever a node becomes focused.
beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
});

vi.mock("../sync/sync-manager.js", () => ({ syncSource: vi.fn().mockResolvedValue({ stages: {}, errors: {} }) }));

vi.mock("../content-loader.js", () => ({
  loadPlaylistInfo: vi.fn().mockResolvedValue({ name: "Test Playlist", expiresAt: null }),
  loadChannelsByKind: vi.fn().mockResolvedValue([]),
  loadSeriesList: vi.fn().mockResolvedValue([]),
  loadVodCategories: vi.fn().mockResolvedValue([]),
  loadSeriesCategories: vi.fn().mockResolvedValue([]),
  loadEpg: vi.fn().mockResolvedValue([]),
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

const MENU_LABELS = ["Live TV", "Movies", "Series", "Guide", "My List", "Recently Watched", "Refresh Playlist", "App Settings"];

function renderHome(onSelectTile: (id: string) => void = () => {}) {
  return render(<HomeScreen source={source} platform="web" profile={profile} onSelectTile={onSelectTile} onOpenProfiles={() => {}} />);
}

function press(key: string): void {
  act(() => {
    fireEvent.keyDown(document, { key });
    fireEvent.keyUp(document, { key });
  });
}

describe("HomeScreen", () => {
  beforeEach(() => {
    clearAllCachedContent();
    __resetHomeFocusMemoryForTests();
    useFocusStore.getState().clearGraph("home-grid");
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    useFocusStore.getState().clearGraph("home-grid");
  });

  it("renders a static tile for every destination, with focus starting on the first", () => {
    renderHome();
    for (const label of MENU_LABELS) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(useFocusStore.getState().focusedId).toBe("live");
  });

  it("does no data work on mount — no fetches, no background timers", async () => {
    const loader = await import("../content-loader.js");
    vi.mocked(loader.loadPlaylistInfo).mockClear();
    vi.mocked(loader.loadChannelsByKind).mockClear();

    renderHome();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(loader.loadPlaylistInfo).not.toHaveBeenCalled();
    expect(loader.loadChannelsByKind).not.toHaveBeenCalled();
    // Only the header clock's once-a-minute tick is expected to remain.
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
  });

  it("navigates the grid with the D-pad and opens the focused tile on Select", () => {
    const onSelectTile = vi.fn();
    renderHome(onSelectTile);

    press("ArrowRight");
    expect(useFocusStore.getState().focusedId).toBe("movies");
    press("ArrowDown");
    expect(useFocusStore.getState().focusedId).toBe("history");
    press("Enter");
    expect(onSelectTile).toHaveBeenCalledWith("history");
  });

  it("wires Up from the top row to the profile switcher, and a ragged column's Down to the last tile", () => {
    renderHome();

    press("ArrowUp");
    expect(useFocusStore.getState().focusedId).toBe("profile-switcher");
    press("ArrowDown");
    expect(useFocusStore.getState().focusedId).toBe("live");

    act(() => useFocusStore.getState().focus("guide"));
    press("ArrowDown");
    expect(useFocusStore.getState().focusedId).toBe("settings");
  });

  it("puts Refresh Playlist in the second row below Series, with no Exit button", () => {
    renderHome();
    expect(screen.getAllByRole("button", { name: "Refresh Playlist" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Exit" })).toBeNull();

    act(() => useFocusStore.getState().focus("series"));
    press("ArrowDown");
    expect(useFocusStore.getState().focusedId).toBe("refresh");
    press("ArrowLeft");
    expect(useFocusStore.getState().focusedId).toBe("history");
    press("ArrowUp");
    expect(useFocusStore.getState().focusedId).toBe("movies");
  });

  it("closes the app when Back is pressed on Home", () => {
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => {});
    renderHome();
    act(() => vi.advanceTimersByTime(600));

    press("Escape");

    expect(closeSpy).toHaveBeenCalledTimes(1);
    closeSpy.mockRestore();
  });

  it("ignores Back right after Home appears, and held-Back auto-repeat, so arriving via Back never closes the app", () => {
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => {});
    renderHome();

    press("Escape"); // the tail of the Back press that navigated here
    act(() => vi.advanceTimersByTime(600));
    act(() => {
      fireEvent.keyDown(document, { key: "Escape", repeat: true });
    });

    expect(closeSpy).not.toHaveBeenCalled();
    closeSpy.mockRestore();
  });

  it("restores focus to the last opened tile when Home remounts", () => {
    const first = renderHome();
    act(() => useFocusStore.getState().focus("series"));
    press("Enter");
    first.unmount();

    renderHome();
    expect(useFocusStore.getState().focusedId).toBe("series");
  });

  it("clicking Refresh forces a sync of every stage without reloading the page", async () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload: reloadSpy },
      writable: true,
    });
    const { syncSource } = await import("../sync/sync-manager.js");

    renderHome();

    const refreshButton = screen.getByRole("button", { name: "Refresh Playlist" });
    await act(async () => {
      fireEvent.click(refreshButton);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(syncSource).toHaveBeenCalledWith(source, { trigger: "manual", force: true });
    expect(reloadSpy).not.toHaveBeenCalled();
  });
});

describe("HomeScreen sync status", () => {
  beforeEach(async () => {
    clearAllCachedContent();
    __resetHomeFocusMemoryForTests();
    __resetSyncStoreForTests();
    useFocusStore.getState().clearGraph("home-grid");
    // The fake-timer tests above opened these connections without ever letting them settle — start fresh.
    __resetCatalogDbForTests();
    __resetEpgDbForTests();
    __resetLiveDbForTests();
    await __clearLiveDbForTests();
    vi.clearAllMocks();
  });
  afterEach(() => useFocusStore.getState().clearGraph("home-grid"));

  it("shows how fresh the playlist is, or what's syncing right now", async () => {
    await putLiveSyncMeta(await openLiveDb(), { sourceId: source.id, lastSyncedAt: Date.now() - 2 * 60 * 60 * 1000, generation: 1, channelCount: 5 });
    renderHome();
    expect(await screen.findByText("Updated 2h ago")).toBeTruthy();

    act(() => {
      useSyncStore.getState().beginRun(source.id, "interval");
      useSyncStore.getState().setStage(source.id, "vod", { status: "running", done: 4000 });
    });
    expect(screen.getByText(`Syncing Movies… ${(4000).toLocaleString()}`)).toBeTruthy();
  });

  it("after Refresh, reports what's now stored", async () => {
    await putLiveSyncMeta(await openLiveDb(), { sourceId: source.id, lastSyncedAt: Date.now(), generation: 1, channelCount: 12430 });
    const { syncSource } = await import("../sync/sync-manager.js");
    vi.mocked(syncSource).mockResolvedValue({ stages: { live: "synced" }, errors: {} });
    renderHome();

    fireEvent.click(screen.getByRole("button", { name: "Refresh Playlist" }));
    expect(await screen.findByText(`Playlist updated · ${(12430).toLocaleString()} channels`)).toBeTruthy();
  });

  it("after a failed Refresh, says why and how to retry — without taking focus", async () => {
    const { syncSource } = await import("../sync/sync-manager.js");
    vi.mocked(syncSource).mockImplementation(async () => {
      useSyncStore.getState().setStage(source.id, "auth", { status: "failed", error: "The provider didn't respond within 15 seconds." });
      return { stages: { auth: "failed" }, errors: { auth: "The provider didn't respond within 15 seconds." } };
    });
    renderHome();
    act(() => useFocusStore.getState().focus("refresh"));

    fireEvent.click(screen.getByRole("button", { name: "Refresh Playlist" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Refresh failed: The provider didn't respond within 15 seconds. Press Refresh Playlist to try again.",
    );
    expect(useFocusStore.getState().focusedId).toBe("refresh");
    expect(screen.getByText("Last refresh failed · press Refresh Playlist to retry")).toBeTruthy();
  });
});

describe("HomeScreen playlist switching", () => {
  const second: PlaylistSource = { kind: "m3u-url", id: "src-2", name: "Sports Playlist", url: "http://example.com/list.m3u" };

  beforeEach(() => {
    clearAllCachedContent();
    __resetHomeFocusMemoryForTests();
    useFocusStore.getState().clearGraph("home-grid");
    Element.prototype.scrollIntoView = () => {};
  });
  afterEach(() => {
    useFocusStore.getState().clearGraph("home-grid");
    useFocusStore.getState().clearGraph("home-playlist-picker");
  });

  function renderWithPlaylists(sources: PlaylistSource[], onSelectSource = vi.fn()) {
    render(
      <HomeScreen source={source} sources={sources} onSelectSource={onSelectSource} platform="web" profile={profile} onSelectTile={() => {}} onOpenProfiles={() => {}} />,
    );
    return onSelectSource;
  }

  it("shows no playlist chip with a single playlist", () => {
    renderWithPlaylists([source]);
    expect(screen.queryByRole("button", { name: /Switch playlist/ })).toBeNull();
    expect(useFocusStore.getState().nodes["home-playlist-chip"]).toBeUndefined();
  });

  it("with more than one, the header chip names the active playlist and sits above the right-hand tiles", () => {
    renderWithPlaylists([source, second]);
    expect(screen.getByRole("button", { name: "Playlist: My Source. Switch playlist" })).toBeTruthy();
    act(() => useFocusStore.getState().focus("guide"));
    press("ArrowUp");
    expect(useFocusStore.getState().focusedId).toBe("home-playlist-chip");
    press("ArrowLeft");
    expect(useFocusStore.getState().focusedId).toBe(PROFILE_SWITCHER_FOCUS_ID);
    act(() => useFocusStore.getState().focus("live"));
    press("ArrowUp");
    expect(useFocusStore.getState().focusedId).toBe(PROFILE_SWITCHER_FOCUS_ID); // the left half still goes to the profile chip
  });

  it("the chip opens a picker on the active playlist; OK on another switches to it", () => {
    const onSelectSource = renderWithPlaylists([source, second]);
    act(() => useFocusStore.getState().focus("home-playlist-chip"));
    press("Enter");

    expect(screen.getByRole("dialog", { name: "Switch playlist" })).toBeTruthy();
    expect(useFocusStore.getState().focusedId).toBe(`home-playlist-option:${source.id}`);
    expect(screen.getAllByText(/Not downloaded yet/)).toHaveLength(2);
    expect(useFocusStore.getState().nodes.live).toBeUndefined(); // nothing behind the picker is reachable

    press("ArrowDown");
    press("Enter");
    expect(onSelectSource).toHaveBeenCalledWith("src-2");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Back (or OK on the active playlist) closes the picker without switching, back on the chip", () => {
    const onSelectSource = renderWithPlaylists([source, second]);
    act(() => useFocusStore.getState().focus("home-playlist-chip"));
    press("Enter");
    press("Escape");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useFocusStore.getState().focusedId).toBe("home-playlist-chip");

    press("Enter");
    press("Enter"); // OK on the active row
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onSelectSource).not.toHaveBeenCalled();
  });
});

describe("describeExpiry", () => {
  const now = Date.parse("2026-09-25T12:00:00Z");
  it("reads as a date when far off, a countdown in the last month, and red once expired", () => {
    expect(describeExpiry(new Date("2027-09-15T12:00:00Z"), now)).toMatchObject({ tone: "ok", label: expect.stringMatching(/^Expires /) });
    expect(describeExpiry(new Date("2026-10-07T12:00:00Z"), now)).toEqual({ tone: "soon", label: "Expires in 12 days" });
    expect(describeExpiry(new Date("2026-09-26T12:00:00Z"), now)).toEqual({ tone: "soon", label: "Expires tomorrow" });
    expect(describeExpiry(new Date("2026-09-01T12:00:00Z"), now)).toMatchObject({ tone: "expired", label: expect.stringMatching(/^Expired /) });
    expect(describeExpiry(null, now)).toEqual({ tone: "ok", label: "No expiry" });
    expect(describeExpiry(undefined, now)).toEqual({ tone: "unknown", label: "Expiry unknown" });
  });
});

describe("HomeScreen footer playlist name", () => {
  beforeEach(() => {
    clearAllCachedContent();
    __resetHomeFocusMemoryForTests();
    useFocusStore.getState().clearGraph("home-grid");
  });
  afterEach(() => useFocusStore.getState().clearGraph("home-grid"));

  it("names the playlist in the footer only when there's no playlist chip", () => {
    const status = () => screen.getByRole("status", { name: "Current playlist" });
    const { unmount } = render(<HomeScreen source={source} platform="web" profile={profile} onSelectTile={() => {}} onOpenProfiles={() => {}} />);
    expect(status().textContent).toContain(source.name);
    unmount();

    const other = { ...source, id: "other", name: "Second List" };
    render(
      <HomeScreen source={source} sources={[source, other]} onSelectSource={() => {}} platform="web" profile={profile} onSelectTile={() => {}} onOpenProfiles={() => {}} />,
    );
    expect(status().textContent).not.toContain(source.name);
  });
});
