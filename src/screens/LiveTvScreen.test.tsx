import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel, PlaylistSource, Profile } from "@core";
import { clearAllCachedContent } from "../content-cache.js";
import { useFocusStore } from "../ui/focus/focus-store.js";
import { __resetLiveCategoryMemoryForTests, LiveTvScreen } from "./LiveTvScreen.js";
import { __resetNowNextCacheForTests } from "../use-now-next.js";

// jsdom doesn't implement scrollIntoView; Focusable calls it whenever a node becomes focused.
beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
});

vi.mock("../content-loader.js", () => ({
  loadChannelsByKind: vi.fn().mockResolvedValue([
    { id: "ch-1", name: "News One", groupTitle: "News", streamUrl: "http://example.com/news1.m3u8", kind: "live" },
    { id: "ch-2", name: "News Two", groupTitle: "News", streamUrl: "http://example.com/news2.m3u8", kind: "live" },
    { id: "ch-3", name: "Sports One", groupTitle: "Sports", streamUrl: "http://example.com/sports1.m3u8", kind: "live" },
  ] satisfies Channel[]),
  loadLiveCategories: vi.fn().mockResolvedValue([]),
  loadStreamEpg: vi.fn((_source: unknown, streamId: string) => {
    if (streamId !== "ch-1") return Promise.resolve([]);
    const hour = 60 * 60 * 1000;
    const now = Date.now();
    return Promise.resolve([
      { channelId: "ch-1", title: "Morning Headlines", description: "The top stories.", start: new Date(now - hour), stop: new Date(now + hour) },
      { channelId: "ch-1", title: "Business Hour", start: new Date(now + hour), stop: new Date(now + 2 * hour) },
    ]);
  }),
}));

vi.mock("@player", () => ({
  HlsPlayerEngine: class {
    attach(): void {}
    load(): Promise<void> {
      return Promise.resolve();
    }
    play(): Promise<void> {
      return Promise.resolve();
    }
    pause(): void {}
    seekTo(): void {}
    unload(): void {}
    getAudioTracks(): unknown[] {
      return [];
    }
    getSubtitleTracks(): unknown[] {
      return [];
    }
    setAudioTrack(): void {}
    setSubtitleTrack(): void {}
    onTimeUpdate(): () => void {
      return () => {};
    }
    onError(): () => void {
      return () => {};
    }
    destroy(): void {}
  },
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

function flush(): Promise<void> {
  return act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function press(key: string): void {
  act(() => {
    fireEvent.keyDown(document, { key });
    fireEvent.keyUp(document, { key });
  });
}

describe("LiveTvScreen", () => {
  beforeEach(() => {
    clearAllCachedContent();
    localStorage.clear();
    __resetLiveCategoryMemoryForTests();
    __resetNowNextCacheForTests();
    for (const scope of ["chrome:category-rail", "content:channel-sidebar", "content:live-favorite"]) useFocusStore.getState().clearGraph(scope);
  });

  afterEach(() => {
    for (const scope of ["chrome:category-rail", "content:channel-sidebar", "content:live-favorite"]) useFocusStore.getState().clearGraph(scope);
  });

  it("lists every channel with its number under All Channels, with the provider's categories in the rail", async () => {
    render(<LiveTvScreen source={source} platform="web" profile={profile} onBack={() => {}} onPlay={() => {}} />);
    await flush();

    expect(screen.getByRole("button", { name: "News" })).toBeDefined(); // rail rows
    expect(screen.getByRole("button", { name: "Sports" })).toBeDefined();
    expect(screen.getByText("3 channels")).toBeDefined();
    expect(screen.getByText("Sports One")).toBeDefined();
    expect(screen.getAllByText("3").length).toBeGreaterThan(0); // channel number (position fallback)
    expect(useFocusStore.getState().focusedId).toBe("ch-1");
  });

  it("selecting a rail category filters the channel list and moves focus into it", async () => {
    render(<LiveTvScreen source={source} platform="web" profile={profile} onBack={() => {}} onPlay={() => {}} />);
    await flush();

    await act(async () => {
      screen.getByRole("button", { name: "Sports" }).click();
    });

    expect(screen.getAllByText("Sports One").length).toBeGreaterThan(0);
    expect(screen.queryByText("News One")).toBeNull();
    expect(useFocusStore.getState().focusedId).toBe("ch-3");
  });

  it("OK on a channel plays it full screen in one press", async () => {
    const onPlay = vi.fn();
    render(<LiveTvScreen source={source} platform="web" profile={profile} onBack={() => {}} onPlay={onPlay} />);
    await flush();

    press("ArrowDown");
    press("Enter");

    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ id: "ch-2" }));
  });

  it("marks the preview LIVE TV", async () => {
    render(<LiveTvScreen source={source} platform="web" profile={profile} onBack={() => {}} onPlay={() => {}} />);
    await flush();
    expect(screen.getByText("LIVE TV")).toBeDefined();
  });

  it("shows what's on now and next for the previewed channel", async () => {
    render(<LiveTvScreen source={source} platform="web" profile={profile} onBack={() => {}} onPlay={() => {}} />);
    expect(await screen.findByText("Morning Headlines")).toBeDefined();
    expect(screen.getByText("Business Hour")).toBeDefined();
    expect(screen.getByText("NOW")).toBeDefined();
    expect(screen.getByText("NEXT")).toBeDefined();
  });

  it("Back goes channel list → category rail → leaves Live TV", async () => {
    const onBack = vi.fn();
    render(<LiveTvScreen source={source} platform="web" profile={profile} onBack={onBack} onPlay={() => {}} />);
    await flush();

    press("Escape");
    expect(useFocusStore.getState().focusedId).toBe("rail:__all__");
    expect(onBack).not.toHaveBeenCalled();
    press("Escape");
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("lists favourite channels under the My List rail entry, with its heart icon", async () => {
    const { toggleFavorite } = await import("../profile-store.js");
    toggleFavorite(profile.id, source.id, "live", "ch-3");
    render(<LiveTvScreen source={source} platform="web" profile={profile} onBack={() => {}} onPlay={() => {}} />);
    await flush();

    const myList = screen.getByRole("button", { name: "My List 1" });
    expect(myList.querySelector("svg")?.getAttribute("class")).toContain("lucide-heart");
    await act(async () => {
      myList.click();
    });
    expect(screen.getAllByText("My List").length).toBeGreaterThan(0); // header title

    expect(screen.getByText("1 channel")).toBeDefined();
    expect(screen.queryByText("News One")).toBeNull();
    expect(screen.getAllByText("Sports One").length).toBeGreaterThan(0);
  });

  it("Right from a channel reaches the favourite button, which adds and removes the channel", async () => {
    render(<LiveTvScreen source={source} platform="web" profile={profile} onBack={() => {}} onPlay={() => {}} />);
    await flush();

    press("ArrowRight");
    expect(useFocusStore.getState().focusedId).toBe("live-preview-favorite");
    expect(screen.getByRole("button", { name: "My List", pressed: false })).toBeDefined();

    press("Enter");
    expect(screen.getByRole("button", { name: "My List", pressed: true })).toBeDefined();
    expect(screen.getByRole("button", { name: "My List 1" })).toBeDefined();

    press("Enter");
    expect(screen.getByRole("button", { name: "My List", pressed: false })).toBeDefined();

    press("ArrowLeft");
    expect(useFocusStore.getState().focusedId).toBe("ch-1");
  });

  it("favourites the channel just left even if the preview hadn't caught up yet, and Back returns to it", async () => {
    const { loadFavorites } = await import("../profile-store.js");
    render(<LiveTvScreen source={source} platform="web" profile={profile} onBack={() => {}} onPlay={() => {}} />);
    await flush();

    press("ArrowDown"); // highlight ch-2; the preview is still on ch-1 (debounced)
    press("ArrowRight");
    await flush();
    press("Enter");

    expect(loadFavorites(profile.id).map((f) => f.contentId)).toEqual(["ch-2"]);
    press("Escape");
    expect(useFocusStore.getState().focusedId).toBe("ch-2");
  });
});
