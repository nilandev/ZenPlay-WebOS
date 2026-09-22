import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel, PlaylistSource, Profile } from "@core";
import { clearAllCachedContent } from "../content-cache.js";
import { useFocusStore } from "../ui/focus/focus-store.js";
import { LiveTvScreen } from "./LiveTvScreen.js";

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
}));

vi.mock("@player", () => ({
  ChannelPreloader: class {
    warm(): void {}
    dispose(): void {}
  },
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

describe("LiveTvScreen", () => {
  beforeEach(() => {
    clearAllCachedContent();
    useFocusStore.getState().clearGraph("chrome:category-sidebar");
    useFocusStore.getState().clearGraph("content:channel-sidebar");
    useFocusStore.getState().clearGraph("content:live-preview");
  });

  afterEach(() => {
    useFocusStore.getState().clearGraph("chrome:category-sidebar");
    useFocusStore.getState().clearGraph("content:channel-sidebar");
    useFocusStore.getState().clearGraph("content:live-preview");
  });

  it("renders categories derived from channel groupTitles and lists all channels under 'All Channels'", async () => {
    render(<LiveTvScreen source={source} platform="web" profile={profile} onBack={() => {}} onPlay={() => {}} />);
    await flush();

    expect(screen.getByText("All Channels")).toBeDefined();
    expect(screen.getByText("News")).toBeDefined();
    expect(screen.getByText("Sports")).toBeDefined();
    expect(screen.getAllByText("News One").length).toBeGreaterThan(0); // sidebar row + preview label (first channel overall)
    expect(screen.getByText("Sports One")).toBeDefined();
  });

  it("selecting a category filters the channel column to that category's channels", async () => {
    render(<LiveTvScreen source={source} platform="web" profile={profile} onBack={() => {}} onPlay={() => {}} />);
    await flush();

    await act(async () => {
      screen.getByText("Sports").click();
    });

    expect(screen.getAllByText("Sports One").length).toBeGreaterThan(0); // sidebar row + preview label (category switch sets preview immediately, not debounced)
    expect(screen.queryByText("News One")).toBeNull();
  });

  it("selecting the preview panel plays the currently previewed channel", async () => {
    const onPlay = vi.fn();
    render(<LiveTvScreen source={source} platform="web" profile={profile} onBack={() => {}} onPlay={onPlay} />);
    await flush();

    useFocusStore.getState().focus("live-preview");
    await act(async () => {
      useFocusStore.getState().select();
    });

    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ id: "ch-1" }));
  });
});
