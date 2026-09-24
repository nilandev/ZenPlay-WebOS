import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadOptions, PlayerEngine, PlayerError } from "@player";
import { useFocusStore } from "../ui/focus/focus-store.js";
import { PlayerScreen } from "./PlayerScreen.js";

function press(key: string): void {
  act(() => {
    fireEvent.keyDown(document, { key });
    fireEvent.keyUp(document, { key });
  });
}
const focusedId = () => useFocusStore.getState().focusedId;

function makeEngine(durationSeconds: number, { hangOnLoad = false } = {}) {
  let progress: ((p: { positionSeconds: number; durationSeconds: number }) => void) | null = null;
  let errorCallback: ((e: PlayerError) => void) | null = null;
  const engine = {
    attach: vi.fn(),
    load: vi.fn((_url: string, _options?: LoadOptions) => (hangOnLoad ? new Promise<void>(() => {}) : Promise.resolve())),
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    seekTo: vi.fn(),
    unload: vi.fn(),
    destroy: vi.fn(),
    getAudioTracks: () => [{ id: 0, label: "English" }, { id: 1, label: "Hindi" }],
    setAudioTrack: vi.fn(),
    getSubtitleTracks: () => [{ id: 0, label: "English" }],
    setSubtitleTrack: vi.fn(),
    setVolume: vi.fn(),
    setMuted: vi.fn(),
    getStats: () => ({ bitrateBps: null, droppedFrames: 0, bufferSeconds: 0 }),
    onError: (cb: (e: PlayerError) => void) => {
      errorCallback = cb;
      return () => {};
    },
    onTimeUpdate: (cb: typeof progress) => {
      progress = cb;
      return () => {};
    },
  } satisfies PlayerEngine;
  return {
    engine,
    tick: (positionSeconds: number) => act(() => progress?.({ positionSeconds, durationSeconds })),
    fail: (error: PlayerError) => act(() => errorCallback?.(error)),
  };
}

describe("PlayerScreen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Element.prototype.scrollIntoView = () => {};
  });
  afterEach(() => {
    vi.useRealTimers();
    for (const scope of ["player-controls", "player-menu", "player-resume", "player-error"]) useFocusStore.getState().clearGraph(scope);
  });

  it("starts on the seek bar; Left/Right presses collect into one seek", () => {
    const { engine, tick } = makeEngine(3600);
    render(<PlayerScreen streamUrl="s" platform="web" onClose={() => {}} title="Film" engineFactory={() => engine} />);
    tick(600);
    expect(focusedId()).toBe("seek-bar");

    press("ArrowRight");
    press("ArrowRight");
    press("ArrowRight");
    expect(screen.getByText("+30s")).toBeDefined();
    expect(engine.seekTo).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(800));
    expect(engine.seekTo).toHaveBeenCalledTimes(1);
    expect(engine.seekTo).toHaveBeenCalledWith(630);
    expect(screen.queryByText("+30s")).toBeNull();
  });

  it("Left/Right move between buttons (not seek) once focus is on the button row", () => {
    const { engine, tick } = makeEngine(3600);
    render(<PlayerScreen streamUrl="s" platform="web" onClose={() => {}} title="Film" engineFactory={() => engine} />);
    tick(600);
    press("ArrowDown");
    expect(focusedId()).toBe("play-pause");
    press("ArrowRight");
    expect(focusedId()).toBe("audio-subtitles");
    act(() => vi.advanceTimersByTime(1000));
    expect(engine.seekTo).not.toHaveBeenCalled();
  });

  it("while the controls are hidden, OK only brings them back — it doesn't pause", () => {
    const { engine, tick } = makeEngine(3600);
    const { container } = render(<PlayerScreen streamUrl="s" platform="web" onClose={() => {}} title="Film" engineFactory={() => engine} />);
    tick(600);
    const overlay = () => (container.querySelector("[role=slider]")!.closest("div[style*='opacity']") as HTMLElement).style.opacity;
    act(() => vi.advanceTimersByTime(5000));
    expect(overlay()).toBe("0");

    press("Enter");
    expect(overlay()).toBe("1");
    expect(engine.pause).not.toHaveBeenCalled();

    press("Enter"); // now visible: OK on the seek bar pauses
    expect(engine.pause).toHaveBeenCalledTimes(1);
  });

  it("Back closes Audio & Subtitles first (focus returns to its button), then the player", () => {
    const { engine, tick } = makeEngine(3600);
    const onClose = vi.fn();
    render(<PlayerScreen streamUrl="s" platform="web" onClose={onClose} title="Film" engineFactory={() => engine} />);
    tick(600);
    press("ArrowDown");
    press("ArrowRight");
    press("Enter");
    expect(screen.getByRole("dialog", { name: "Audio & Subtitles" })).toBeDefined();
    expect(focusedId()).toBe("player-subtitle:off");

    press("ArrowLeft");
    press("ArrowDown");
    press("Enter");
    expect(engine.setAudioTrack).toHaveBeenCalledWith(1);

    press("Escape");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(focusedId()).toBe("audio-subtitles");

    press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("live playback has no seek bar and starts on Play/Pause", () => {
    const { engine, tick } = makeEngine(NaN);
    render(<PlayerScreen streamUrl="s" platform="web" onClose={() => {}} title="News" isLive engineFactory={() => engine} />);
    tick(10);
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.getByText("LIVE")).toBeDefined();
    expect(focusedId()).toBe("play-pause");
    press("ArrowRight");
    expect(focusedId()).toBe("audio-subtitles");
  });

  it("offers Resume / Start Over before loading, and starts the stream where chosen", async () => {
    const { engine } = makeEngine(3600);
    const view = render(
      <PlayerScreen streamUrl="s" platform="web" onClose={() => {}} title="Film" resumeFrom={{ positionSeconds: 2832, durationSeconds: 3600 }} engineFactory={() => engine} />,
    );
    expect(screen.getByRole("button", { name: /Resume from 47:12/ })).toBeDefined();
    expect(engine.load).not.toHaveBeenCalled();
    expect(focusedId()).toBe("player-resume-continue");

    press("Enter");
    await act(async () => {});
    expect(engine.load).toHaveBeenCalledWith("s", { startPositionSeconds: 2832 });
    view.unmount();

    const second = makeEngine(3600);
    render(
      <PlayerScreen streamUrl="s" platform="web" onClose={() => {}} title="Film" resumeFrom={{ positionSeconds: 2832, durationSeconds: 3600 }} engineFactory={() => second.engine} />,
    );
    press("ArrowRight");
    press("Enter"); // Start Over
    await act(async () => {});
    expect(second.engine.load).toHaveBeenCalledWith("s", { startPositionSeconds: undefined });
  });

  it("shows an error for a fatal failure (not a recovering one); Try Again reloads from where it got to", async () => {
    const engines = [makeEngine(3600), makeEngine(3600)];
    let created = 0;
    const onClose = vi.fn();
    render(<PlayerScreen streamUrl="s" platform="web" onClose={onClose} title="Film" engineFactory={() => engines[created++].engine} />);
    await act(async () => {});
    engines[0].tick(1500);

    engines[0].fail({ kind: "network", fatal: false, message: "retrying" });
    expect(screen.queryByRole("alert")).toBeNull();

    engines[0].fail({ kind: "network", fatal: true, message: "gone" });
    expect(screen.getByText("Can't play “Film”")).toBeDefined();
    expect(focusedId()).toBe("player-error-retry");

    press("Enter");
    await act(async () => {});
    expect(created).toBe(2);
    expect(engines[1].engine.load).toHaveBeenCalledWith("s", { startPositionSeconds: 1500 });
    expect(screen.queryByText("Can't play “Film”")).toBeNull();

    engines[1].fail({ kind: "media", fatal: true, message: "codec" });
    press("ArrowRight");
    press("Enter"); // Back
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("gives up with an error after buffering for 30 seconds", async () => {
    const { engine } = makeEngine(3600, { hangOnLoad: true });
    render(<PlayerScreen streamUrl="s" platform="web" onClose={() => {}} title="News" isLive engineFactory={() => engine} />);
    await act(async () => {});
    act(() => vi.advanceTimersByTime(29_000));
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByRole("alert").textContent).toContain("The channel stopped responding");
  });

  it("handles the remote's media keys: Fast-forward/Rewind scrub, Pause/Play, Stop closes", () => {
    const { engine, tick } = makeEngine(3600);
    const onClose = vi.fn();
    render(<PlayerScreen streamUrl="s" platform="web" onClose={onClose} title="Film" engineFactory={() => engine} />);
    tick(600);
    press("ArrowDown"); // focus on the buttons — media keys still scrub
    press("MediaFastForward");
    press("MediaFastForward");
    expect(screen.getByText("+20s")).toBeDefined();
    expect(focusedId()).toBe("seek-bar");
    act(() => vi.advanceTimersByTime(800));
    expect(engine.seekTo).toHaveBeenCalledWith(620);

    press("MediaRewind");
    act(() => vi.advanceTimersByTime(800));
    expect(engine.seekTo).toHaveBeenLastCalledWith(610);

    press("MediaPause");
    expect(engine.pause).toHaveBeenCalledTimes(1);
    const playsBefore = engine.play.mock.calls.length;
    press("MediaPlay");
    expect(engine.play).toHaveBeenCalledTimes(playsBefore + 1);
    press("MediaStop");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
