import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistSource } from "@core";
import { loadWatchHistory, recordWatchHistory } from "../profile-store.js";
import { useFocusStore } from "../ui/focus/focus-store.js";
import { HistoryScreen } from "./HistoryScreen.js";

const source: PlaylistSource = { kind: "m3u-url", id: "src", name: "P", url: "u" };
const base = { profileId: "p", sourceId: "src" };

function press(key: string): void {
  act(() => {
    fireEvent.keyDown(document, { key });
    fireEvent.keyUp(document, { key });
  });
}
const focusedId = () => useFocusStore.getState().focusedId;

function seed(): void {
  // Oldest first — each record moves to the front.
  recordWatchHistory({ ...base, kind: "movie", contentId: "old-film", title: "Old Film", streamUrl: "f0", positionSeconds: 7000, durationSeconds: 7100, finished: true });
  recordWatchHistory({ ...base, kind: "live", contentId: "c1", title: "News 24", streamUrl: "l1", channelNumber: 5 });
  recordWatchHistory({ ...base, kind: "live", contentId: "c2", title: "Sports", streamUrl: "l2", channelNumber: 9 });
  recordWatchHistory({ ...base, kind: "series", contentId: "show", title: "The Show", subtitle: "S1 E3 · Three", episodeId: "e3", positionSeconds: 600, durationSeconds: 2400 });
  recordWatchHistory({ ...base, kind: "movie", contentId: "film", title: "Film", streamUrl: "f1", positionSeconds: 1800, durationSeconds: 6120 });
}

function renderScreen(overrides: Partial<Parameters<typeof HistoryScreen>[0]> = {}) {
  const props = {
    source,
    profileId: "p",
    platform: "web" as const,
    onBack: vi.fn(),
    onPlayChannel: vi.fn(),
    onPlayMovie: vi.fn(),
    onContinueSeries: vi.fn(),
    onOpenSeries: vi.fn(),
    ...overrides,
  };
  render(<HistoryScreen {...props} />);
  return props;
}

describe("HistoryScreen (Recently Watched)", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => {};
    localStorage.clear();
  });
  afterEach(() => {
    useFocusStore.getState().clearGraph("history");
    useFocusStore.getState().clearGraph("history-confirm");
  });

  it("shows Continue Watching, Recent Channels and You've Completed rows, newest first, with time left", () => {
    seed();
    renderScreen();
    expect(screen.getByText("Continue Watching · 2")).toBeDefined();
    expect(screen.getByText("Recent Channels · 2")).toBeDefined();
    expect(screen.getByText("You've Completed · 1")).toBeDefined();
    expect(screen.getByText(/^Completed · /)).toBeDefined();
    expect(screen.getByLabelText("Completed")).toBeDefined();
    expect(focusedId()).toBe("history-item:movie:film");
    expect(screen.getByText("1h 12m left")).toBeDefined();
    expect(screen.getByText("S1 E3 · Three · 30 min left")).toBeDefined();
  });

  it("OK continues: a film without the resume prompt, a series via its saved episode, a channel with the recent channels as lineup", () => {
    seed();
    const props = renderScreen();
    press("Enter");
    expect(props.onPlayMovie).toHaveBeenCalledWith(expect.objectContaining({ id: "film", streamUrl: "f1" }), { resume: true });

    press("ArrowRight");
    press("Enter");
    expect(props.onContinueSeries).toHaveBeenCalledWith(expect.objectContaining({ contentId: "show", episodeId: "e3" }));

    press("ArrowDown");
    press("ArrowLeft");
    press("Enter");
    expect(props.onPlayChannel).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c2", number: 9 }),
      expect.objectContaining({ lineup: [expect.objectContaining({ id: "c2" }), expect.objectContaining({ id: "c1" })] }),
    );

    press("ArrowDown");
    press("Enter"); // a finished film plays from the start
    expect(props.onPlayMovie).toHaveBeenLastCalledWith(expect.objectContaining({ id: "old-film" }), { resume: false });
  });

  it("Edit mode removes the focused item; long-press removes without it", async () => {
    seed();
    renderScreen();
    act(() => useFocusStore.getState().focus("history-edit"));
    press("Enter");
    expect(screen.getByText("Select an item to remove it")).toBeDefined();
    act(() => useFocusStore.getState().focus("history-item:movie:film"));
    press("Enter");
    expect(loadWatchHistory("p", "src").some((e) => e.contentId === "film")).toBe(false);
    expect(focusedId()).toBe("history-item:series:show");
  });

  it("Clear History asks first; Keep returns to the button, Clear empties the list", () => {
    seed();
    renderScreen();
    act(() => useFocusStore.getState().focus("history-clear"));
    press("Enter");
    expect(screen.getByText("Clear Recently Watched?")).toBeDefined();
    expect(focusedId()).toBe("history-confirm-keep");
    press("Enter");
    expect(screen.queryByText("Clear Recently Watched?")).toBeNull();
    expect(focusedId()).toBe("history-clear");

    press("Enter");
    press("ArrowRight");
    press("Enter");
    expect(loadWatchHistory("p", "src")).toEqual([]);
    expect(screen.getByText("Nothing watched yet")).toBeDefined();
  });

  it("You've Completed lists finished films and fully watched series, most recently completed first", () => {
    recordWatchHistory({ ...base, kind: "series", contentId: "done-show", title: "Done Show", subtitle: "S3 E10 · Finale", finished: true });
    recordWatchHistory({ ...base, kind: "movie", contentId: "done-film", title: "Done Film", finished: true, positionSeconds: 7000, durationSeconds: 7100 });
    recordWatchHistory({ ...base, kind: "series", contentId: "ongoing", title: "Ongoing", subtitle: "Up next: S1 E2 · Two", positionSeconds: 0 });
    const props = renderScreen();
    expect(screen.getByText("You've Completed · 2")).toBeDefined();
    expect(screen.getByText("Continue Watching · 1")).toBeDefined();
    expect(screen.getByText(/^Series completed · /)).toBeDefined();

    act(() => useFocusStore.getState().focus("history-item:series:done-show"));
    press("Enter");
    expect(props.onOpenSeries).toHaveBeenCalledWith("done-show");
  });
});
