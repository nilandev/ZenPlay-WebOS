import { act, fireEvent, render, screen } from "@testing-library/react";
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
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    useFocusStore.getState().clearGraph("home-grid");
  });

  it("clicking Refresh revalidates the source's caches without reloading the page", async () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload: reloadSpy },
      writable: true,
    });

    const { loadChannelsByKind } = await import("../content-loader.js");

    render(
      <HomeScreen source={source} platform="web" profile={profile} onSelectTile={() => {}} onOpenProfiles={() => {}} />,
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
      <HomeScreen source={source} platform="web" profile={profile} onSelectTile={() => {}} onOpenProfiles={() => {}} />,
    );
    unmount();

    expect(reloadSpy).not.toHaveBeenCalled();
  });
});
