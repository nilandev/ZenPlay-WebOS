import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistSource } from "@core";
import { __resetSyncStoreForTests, useSyncStore, type StageState, type SyncStage } from "../sync/sync-store.js";
import { useFocusStore } from "../ui/focus/focus-store.js";
import { FirstSyncScreen } from "./FirstSyncScreen.js";

vi.mock("../sync/sync-manager.js", () => ({ syncSource: vi.fn().mockResolvedValue({ stages: {}, errors: {} }) }));

const xtream: PlaylistSource = { kind: "xtream", id: "src-1", name: "My Provider", baseUrl: "http://tv.example", username: "u", password: "p" };
const m3u: PlaylistSource = { kind: "m3u-url", id: "src-2", name: "My Playlist", url: "http://tv.example/list.m3u" };

function press(key: string): void {
  act(() => {
    fireEvent.keyDown(document, { key });
    fireEvent.keyUp(document, { key });
  });
}
function setStage(sourceId: string, stage: SyncStage, state: StageState): void {
  act(() => useSyncStore.getState().setStage(sourceId, stage, state));
}
const focusedId = () => useFocusStore.getState().focusedId;

describe("FirstSyncScreen", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => {}; // jsdom has none; Focusable calls it on focus
    vi.clearAllMocks();
    __resetSyncStoreForTests();
  });
  afterEach(() => useFocusStore.getState().clearGraph("first-sync"));

  it("starts the first sync and lists every part of the playlist with its progress", async () => {
    const { syncSource } = await import("../sync/sync-manager.js");
    render(<FirstSyncScreen source={xtream} platform="web" onContinue={() => {}} />);

    expect(syncSource).toHaveBeenCalledWith(xtream, { trigger: "first-run" });
    for (const label of ["Channels", "Movies", "Series", "TV guide"]) expect(screen.getByRole("group", { name: label })).toBeDefined();

    act(() => useSyncStore.getState().beginRun(xtream.id, "first-run"));
    setStage(xtream.id, "vod", { status: "running", done: 18400 });
    expect(screen.getByText(`${(18400).toLocaleString()} so far`)).toBeDefined();
    expect(screen.queryByRole("button", { name: /Continue/ })).toBeNull(); // not until live TV is in
  });

  it("unlocks Continue as soon as live channels are in, while the rest keeps downloading", () => {
    const onContinue = vi.fn();
    render(<FirstSyncScreen source={xtream} platform="web" onContinue={onContinue} />);
    act(() => useSyncStore.getState().beginRun(xtream.id, "first-run"));
    setStage(xtream.id, "live", { status: "synced", count: 12430 });
    setStage(xtream.id, "vod", { status: "running", done: 500 });

    expect(screen.getByText("Live TV is ready. The rest keeps downloading in the background.")).toBeDefined();
    expect(focusedId()).toBe("first-sync-continue");
    press("Enter");
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("shows why a part failed, with Retry for just that part and Continue anyway", async () => {
    const { syncSource } = await import("../sync/sync-manager.js");
    const onContinue = vi.fn();
    render(<FirstSyncScreen source={xtream} platform="web" onContinue={onContinue} />);
    act(() => useSyncStore.getState().beginRun(xtream.id, "first-run"));
    setStage(xtream.id, "live", { status: "failed", error: "The provider didn't respond within 120 seconds." });
    setStage(xtream.id, "vod", { status: "synced", count: 10 });
    act(() => useSyncStore.getState().endRun(xtream.id));

    expect(screen.getByText("The provider didn't respond within 120 seconds.")).toBeDefined();
    expect(focusedId()).toBe("first-sync-retry");
    press("Enter");
    expect(syncSource).toHaveBeenLastCalledWith(xtream, { trigger: "manual", stages: ["live"], force: true });

    press("ArrowRight");
    expect(focusedId()).toBe("first-sync-continue-anyway");
    press("Enter");
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("says so when sign-in fails", () => {
    render(<FirstSyncScreen source={xtream} platform="web" onContinue={() => {}} />);
    setStage(xtream.id, "auth", { status: "failed", error: "Xtream authentication failed" });
    setStage(xtream.id, "live", { status: "skipped", error: "Xtream authentication failed" });
    expect(screen.getByText("Couldn't sign in: Xtream authentication failed")).toBeDefined();
  });

  it("Back continues in the background at any time", () => {
    const onContinue = vi.fn();
    render(<FirstSyncScreen source={xtream} platform="web" onContinue={onContinue} />);
    press("Escape");
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("moves on by itself once everything has downloaded", () => {
    vi.useFakeTimers();
    try {
      const onContinue = vi.fn();
      render(<FirstSyncScreen source={m3u} platform="web" onContinue={onContinue} />);
      expect(screen.getByRole("group", { name: "Channels & movies" })).toBeDefined();
      expect(screen.queryByRole("group", { name: "Series" })).toBeNull(); // M3U: no series, no guide without an EPG URL

      act(() => useSyncStore.getState().beginRun(m3u.id, "first-run"));
      setStage(m3u.id, "live", { status: "synced", count: 300 });
      act(() => useSyncStore.getState().endRun(m3u.id));
      expect(screen.getByText("All set")).toBeDefined();

      act(() => vi.advanceTimersByTime(1200));
      expect(onContinue).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
