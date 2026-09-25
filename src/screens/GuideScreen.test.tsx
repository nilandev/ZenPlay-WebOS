import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel, EpgProgramme, PlaylistSource, Profile } from "@core";
import { clearAllCachedContent } from "../content-cache.js";
import { __resetEpgCacheForTests } from "../epg-cache.js";
import { useFocusStore } from "../ui/focus/focus-store.js";
import { __resetGuideCategoryMemoryForTests, GuideScreen } from "./GuideScreen.js";

// jsdom doesn't implement scrollIntoView; Focusable calls it whenever a node becomes focused.
beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
});

const { channels, programmesByStreamId } = vi.hoisted(() => {
  const hour = 3600_000;
  const now = Date.now();
  const channels: Channel[] = [
    { id: "ch-1", name: "News One", groupTitle: "News", streamUrl: "http://example.com/news1.m3u8", kind: "live" },
    { id: "ch-2", name: "Sports One", groupTitle: "Sports", streamUrl: "http://example.com/sports1.m3u8", kind: "live" },
    { id: "ch-3", name: "Quiet Channel", groupTitle: "Sports", streamUrl: "http://example.com/quiet.m3u8", kind: "live" },
  ];
  const programmesByStreamId: Record<string, EpgProgramme[]> = {
    "ch-1": [{ channelId: "ch-1", title: "Morning News", description: "The day's top stories.", start: new Date(now - hour), stop: new Date(now + hour) }],
    "ch-2": [{ channelId: "ch-2", title: "Match Highlights", start: new Date(now + hour), stop: new Date(now + 2 * hour) }],
  };
  return { channels, programmesByStreamId };
});

vi.mock("../use-live-channels.js", () => ({
  useLiveChannels: () => ({ channels, isInitialLoading: false, error: null }),
}));

vi.mock("../content-loader.js", () => ({
  loadLiveCategories: vi.fn().mockResolvedValue([]),
  loadEpg: vi.fn().mockResolvedValue([]),
  loadStreamEpg: vi.fn((_source: unknown, streamId: string) => Promise.resolve(programmesByStreamId[streamId] ?? [])),
}));

const source: PlaylistSource = { kind: "xtream", id: "src-1", name: "My Source", baseUrl: "http://example.com", username: "u", password: "p" };
const profile: Profile = { id: "profile-1", name: "Alex", avatarUrl: "avatar/toon_1.png" };

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
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
const cellId = (channelId: string) => `epg:${channelId}:${programmesByStreamId[channelId][0].start.getTime()}`;

describe("GuideScreen (timeline grid)", () => {
  beforeEach(() => {
    clearAllCachedContent();
    __resetEpgCacheForTests();
    __resetGuideCategoryMemoryForTests();
    for (const scope of ["chrome:category-rail", "content:program-guide"]) useFocusStore.getState().clearGraph(scope);
  });

  afterEach(() => {
    for (const scope of ["chrome:category-rail", "content:program-guide"]) useFocusStore.getState().clearGraph(scope);
  });

  function renderGuide(overrides: Partial<{ onPlay: (url: string) => void; onBack: () => void }> = {}) {
    return render(
      <GuideScreen source={source} platform="web" profile={profile} onPlay={overrides.onPlay ?? (() => {})} onBack={overrides.onBack ?? (() => {})} />,
    );
  }

  it("lays channels out as rows with their programmes, and categories in the rail", async () => {
    renderGuide();
    await settle();

    expect(screen.getByRole("button", { name: "Sports" })).toBeDefined(); // rail
    expect(screen.getAllByText("News One").length).toBeGreaterThan(0); // row label (+ details panel)
    expect(screen.getByText("Sports One")).toBeDefined();
    expect(screen.getAllByText("Morning News").length).toBeGreaterThan(0);
    expect(screen.getByText("Match Highlights")).toBeDefined();
    expect(screen.getByText("No programme information")).toBeDefined(); // ch-3 has no guide
  });

  it("starts on the programme airing now and shows it in the details panel", async () => {
    renderGuide();
    await settle();

    expect(focusedId()).toBe(cellId("ch-1"));
    expect(screen.getByText("The day's top stories.")).toBeDefined();
    expect(screen.getByText("ON NOW")).toBeDefined();
  });

  it("OK on a programme that's on now plays the channel live", async () => {
    const onPlay = vi.fn();
    renderGuide({ onPlay });
    await settle();

    press("Enter");
    expect(onPlay).toHaveBeenCalledWith("http://example.com/news1.m3u8");
  });

  it("Down moves to the next channel; OK on an upcoming programme says when it starts instead of playing", async () => {
    const onPlay = vi.fn();
    renderGuide({ onPlay });
    await settle();

    press("ArrowDown");
    expect(focusedId()).toBe(cellId("ch-2"));
    expect(screen.getByText("UPCOMING")).toBeDefined();

    press("Enter");
    expect(onPlay).not.toHaveBeenCalled();
    expect(screen.getByText(/^Starts at /)).toBeDefined();
  });

  it("OK on a channel without guide data plays it live", async () => {
    const onPlay = vi.fn();
    renderGuide({ onPlay });
    await settle();

    press("ArrowDown");
    press("ArrowDown");
    expect(focusedId()).toBe("epg:ch-3:none");
    press("Enter");
    expect(onPlay).toHaveBeenCalledWith("http://example.com/quiet.m3u8");
  });

  it("Back goes grid → category rail → leaves the guide; picking a category filters the rows", async () => {
    const onBack = vi.fn();
    renderGuide({ onBack });
    await settle();

    press("Escape");
    expect(focusedId()).toBe("rail:__all__");
    press("Escape");
    expect(onBack).toHaveBeenCalledTimes(1);

    await act(async () => {
      screen.getByRole("button", { name: "Sports" }).click();
    });
    await settle();
    expect(screen.queryByText("News One")).toBeNull();
    expect(focusedId()).toBe(cellId("ch-2"));
  });
});
