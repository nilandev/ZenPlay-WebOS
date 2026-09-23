import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistSource, Profile } from "@core";
import { clearAllCachedContent, getCachedContent } from "../content-cache.js";
import { useFocusStore } from "../ui/focus/focus-store.js";
import { HomeScreen } from "./HomeScreen.js";

// jsdom doesn't implement scrollIntoView; Focusable calls it whenever a node becomes focused.
beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
});

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

describe("HomeScreen", () => {
  beforeEach(() => {
    clearAllCachedContent();
    useFocusStore.getState().clearGraph("home-grid");
    useFocusStore.getState().clearGraph("home-shelves");
    useFocusStore.getState().clearGraph("home-sidebar");
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    useFocusStore.getState().clearGraph("home-grid");
    useFocusStore.getState().clearGraph("home-shelves");
    useFocusStore.getState().clearGraph("home-sidebar");
  });

  it("clicking Refresh revalidates the source's caches without reloading the page", async () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload: reloadSpy },
      writable: true,
    });

    const { loadChannelsByKind } = await import("../content-loader.js");

    render(
      <HomeScreen
        source={source}
        platform="web"
        profile={profile}
        onSelectTile={() => {}}
        onOpenProfiles={() => {}}
        onPlayMovie={() => {}}
        onPlayChannel={() => {}}
        onOpenSeries={() => {}}
      />,
    );

    const refreshButton = screen.getByRole("button", { name: "Refresh" });
    // Bounded advance rather than runAllTimersAsync — startBackgroundRevalidation's
    // setInterval (also running once HomeScreen mounts) never stops on its
    // own, so draining "all" timers here would spin forever. The refresh
    // click itself only needs its in-flight promises to settle, and
    // waitFor's real-timer polling doesn't work under fake timers, so this
    // awaits the click's effects directly instead.
    await act(async () => {
      fireEvent.click(refreshButton);
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getCachedContent(`live:${source.id}`)).toEqual([]);

    expect(loadChannelsByKind).toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it("does not call window.location.reload as part of normal mount/unmount", () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload: reloadSpy },
      writable: true,
    });

    const { unmount } = render(
      <HomeScreen
        source={source}
        platform="web"
        profile={profile}
        onSelectTile={() => {}}
        onOpenProfiles={() => {}}
        onPlayMovie={() => {}}
        onPlayChannel={() => {}}
        onOpenSeries={() => {}}
      />,
    );
    unmount();

    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it("renders the left sidebar with all six destinations", () => {
    render(
      <HomeScreen
        source={source}
        platform="web"
        profile={profile}
        onSelectTile={() => {}}
        onOpenProfiles={() => {}}
        onPlayMovie={() => {}}
        onPlayChannel={() => {}}
        onOpenSeries={() => {}}
      />,
    );

    const sidebar = within(screen.getByRole("navigation"));
    for (const label of ["Home", "Live TV", "Movies", "Series", "Guide", "Favorites", "History", "Settings"]) {
      expect(sidebar.getByText(label)).toBeTruthy();
    }
  });

  it("pressing Left from the header focuses the sidebar, and Right returns to it", () => {
    render(
      <HomeScreen
        source={source}
        platform="web"
        profile={profile}
        onSelectTile={() => {}}
        onOpenProfiles={() => {}}
        onPlayMovie={() => {}}
        onPlayChannel={() => {}}
        onOpenSeries={() => {}}
      />,
    );

    // No hero and no shelves (no catalog data mocked in), so initial focus
    // lands on the profile switcher in the header — see buildHomeFocusGraph.
    expect(useFocusStore.getState().focusedId).toBe("profile-switcher");

    act(() => {
      useFocusStore.getState().move("left");
    });
    expect(useFocusStore.getState().focusedId).toBe("home");

    act(() => {
      useFocusStore.getState().move("right");
    });
    expect(useFocusStore.getState().focusedId).toBe("profile-switcher");
  });

  it("selecting a non-Home sidebar destination calls onSelectTile with its id", () => {
    const onSelectTile = vi.fn();
    render(
      <HomeScreen
        source={source}
        platform="web"
        profile={profile}
        onSelectTile={onSelectTile}
        onOpenProfiles={() => {}}
        onPlayMovie={() => {}}
        onPlayChannel={() => {}}
        onOpenSeries={() => {}}
      />,
    );

    const sidebar = within(screen.getByRole("navigation"));
    fireEvent.click(sidebar.getByText("Movies"));

    expect(onSelectTile).toHaveBeenCalledWith("movies");
  });
});
