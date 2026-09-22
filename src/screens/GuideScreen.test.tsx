import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel, EpgProgramme, PlaylistSource } from "@core";
import { clearAllCachedContent } from "../content-cache.js";
import { useFocusStore } from "../ui/focus/focus-store.js";
import { GuideScreen } from "./GuideScreen.js";

// jsdom doesn't implement scrollIntoView; Focusable calls it whenever a node becomes focused.
beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
});

const { channels, loadStreamEpg } = vi.hoisted(() => {
  const channels: Channel[] = [
    { id: "ch-1", name: "News One", groupTitle: "News", streamUrl: "http://example.com/news1.m3u8", kind: "live" },
    { id: "ch-2", name: "Sports One", groupTitle: "Sports", streamUrl: "http://example.com/sports1.m3u8", kind: "live" },
  ];

  const programmesByStreamId: Record<string, EpgProgramme[]> = {
    "ch-1": [
      {
        channelId: "ch-1",
        title: "Morning News",
        description: "The day's top stories.",
        start: new Date(Date.now() - 3600_000),
        stop: new Date(Date.now() + 3600_000),
      },
    ],
    "ch-2": [
      {
        channelId: "ch-2",
        title: "Match Highlights",
        start: new Date(Date.now() + 3600_000),
        stop: new Date(Date.now() + 7200_000),
      },
    ],
  };

  const loadStreamEpg = vi.fn((_source: unknown, streamId: string) => Promise.resolve(programmesByStreamId[streamId] ?? []));

  return { channels, programmesByStreamId, loadStreamEpg };
});

vi.mock("../content-loader.js", () => ({
  loadChannelsByKind: vi.fn().mockResolvedValue(channels),
  loadLiveCategories: vi.fn().mockResolvedValue([]),
  loadEpg: vi.fn().mockResolvedValue([]),
  loadStreamEpg,
}));

const source: PlaylistSource = {
  kind: "xtream",
  id: "src-1",
  name: "My Source",
  baseUrl: "http://example.com",
  username: "u",
  password: "p",
};

function flush(): Promise<void> {
  return act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("GuideScreen", () => {
  beforeEach(() => {
    clearAllCachedContent();
    loadStreamEpg.mockClear();
    useFocusStore.getState().clearGraph("chrome:category-sidebar");
    useFocusStore.getState().clearGraph("content:channel-sidebar");
    useFocusStore.getState().clearGraph("content:epg-programme-list");
  });

  afterEach(() => {
    useFocusStore.getState().clearGraph("chrome:category-sidebar");
    useFocusStore.getState().clearGraph("content:channel-sidebar");
    useFocusStore.getState().clearGraph("content:epg-programme-list");
  });

  it("renders categories and channels in the two left sidebars", async () => {
    render(<GuideScreen source={source} platform="web" onPlay={() => {}} onBack={() => {}} />);
    await flush();

    expect(screen.getByText("All Channels")).toBeDefined();
    expect(screen.getByText("News")).toBeDefined();
    expect(screen.getByText("Sports")).toBeDefined();
    expect(screen.getAllByText("News One").length).toBeGreaterThan(0);
  });

  it("loads and displays the first visible channel's guide on mount", async () => {
    render(<GuideScreen source={source} platform="web" onPlay={() => {}} onBack={() => {}} />);
    await flush();

    expect(loadStreamEpg).toHaveBeenCalledWith(source, "ch-1");
    expect(screen.getByText("Morning News")).toBeDefined();
    expect(screen.getByText("The day's top stories.")).toBeDefined();
  });

  it("selecting a currently-airing programme plays the channel live", async () => {
    const onPlay = vi.fn();
    render(<GuideScreen source={source} platform="web" onPlay={onPlay} onBack={() => {}} />);
    await flush();

    useFocusStore.getState().focus("epg-item:0");
    await act(async () => {
      useFocusStore.getState().select();
    });

    expect(onPlay).toHaveBeenCalledWith("http://example.com/news1.m3u8");
  });
});
