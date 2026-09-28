import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadOptions, PlayerEngine, PlayerError } from "@player";
import { useFocusStore } from "../ui/focus/focus-store.js";
import { isFavorite } from "../profile-store.js";
import { PlayerScreen } from "./PlayerScreen.js";
import { updateSettings } from "../settings-store.js";
import { workingLiveStreamFormat } from "../live-stream-url.js";

const guide = vi.hoisted(() => ({ nowNext: null as unknown }));
vi.mock("../use-now-next.js", () => ({
  useNowNext: (_source: unknown, channel: unknown) => ({ nowNext: channel ? guide.nowNext : null, isLoading: false }),
}));

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
    for (const scope of ["player-controls", "player-menu", "player-resume", "player-error", "player-episodes", "player-next-up"]) useFocusStore.getState().clearGraph(scope);
  });

  it("plays a film at the Default Speed from App Settings", async () => {
    localStorage.clear();
    updateSettings({ playbackSpeed: 1.25 });
    const { engine } = makeEngine(3600);
    render(<PlayerScreen streamUrl="s" platform="web" onClose={() => {}} title="Film" engineFactory={() => engine} />);
    await act(async () => {});
    expect(engine.load).toHaveBeenCalledWith("s", expect.objectContaining({ playbackRate: 1.25 }));
    localStorage.clear();
  });

  it("always plays live TV at normal speed, whatever the Default Speed", async () => {
    localStorage.clear();
    updateSettings({ playbackSpeed: 2 });
    const { engine } = makeEngine(NaN);
    render(<PlayerScreen streamUrl="s" platform="web" onClose={() => {}} title="News" isLive engineFactory={() => engine} />);
    await act(async () => {});
    expect(engine.load).toHaveBeenCalledWith("s", expect.objectContaining({ playbackRate: 1 }));
    localStorage.clear();
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

  it("while the controls are hidden, OK only brings them back — it doesn't pause", async () => {
    const { engine, tick } = makeEngine(3600);
    const { container } = render(<PlayerScreen streamUrl="s" platform="web" onClose={() => {}} title="Film" engineFactory={() => engine} />);
    await act(async () => {});
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
    expect(screen.getByText("TV Channel")).toBeDefined();
    expect(screen.queryByText(/LIVE/)).toBeNull();
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
    expect(engine.load).toHaveBeenCalledWith("s", expect.objectContaining({ startPositionSeconds: 2832 }));
    view.unmount();

    const second = makeEngine(3600);
    render(
      <PlayerScreen streamUrl="s" platform="web" onClose={() => {}} title="Film" resumeFrom={{ positionSeconds: 2832, durationSeconds: 3600 }} engineFactory={() => second.engine} />,
    );
    press("ArrowRight");
    press("Enter"); // Start Over
    await act(async () => {});
    expect(second.engine.load).toHaveBeenCalledWith("s", expect.objectContaining({ startPositionSeconds: undefined }));
  });

  describe("live stream formats", () => {
    const hls = "http://tv.example/live/me/pw/42.m3u8";
    const ts = "http://tv.example/live/me/pw/42.ts";
    beforeEach(() => localStorage.clear());

    /** Engines handed out in order; `hang` ones never finish loading (a channel that doesn't start). */
    function engineQueue(...hang: boolean[]) {
      const engines = hang.map((hangOnLoad) => makeEngine(NaN, { hangOnLoad }));
      let created = 0;
      return { engines, factory: () => engines[created++].engine, created: () => created };
    }
    const loadedUrl = (engine: PlayerEngine) => (engine.load as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];

    it("Auto: a channel that fails before its first frame is quietly tried in the other format, which is remembered", async () => {
      const { engines, factory } = engineQueue(true, false);
      render(<PlayerScreen streamUrl={hls} platform="web" onClose={() => {}} title="News" isLive liveSourceId="src-1" engineFactory={factory} />);
      await act(async () => {});

      engines[0].fail({ kind: "manifest", fatal: true, message: "bad playlist" });
      await act(async () => {});

      expect(screen.queryByRole("alert")).toBeNull();
      expect(loadedUrl(engines[1].engine)).toBe(ts);
      expect(workingLiveStreamFormat("src-1")).toBe("ts");
    });

    it("Auto: a channel that hasn't started after 12 seconds is tried in the other format", async () => {
      const { engines, factory } = engineQueue(true, true);
      render(<PlayerScreen streamUrl={hls} platform="web" onClose={() => {}} title="News" isLive liveSourceId="src-1" engineFactory={factory} />);
      await act(async () => {});

      act(() => vi.advanceTimersByTime(11_000));
      expect(engines[1].engine.load).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1_000));
      await act(async () => {});
      expect(loadedUrl(engines[1].engine)).toBe(ts);
    });

    it("Auto: the error shows only once both formats have failed; Try Again starts over in the first", async () => {
      const { engines, factory } = engineQueue(true, true, false);
      render(<PlayerScreen streamUrl={hls} platform="web" onClose={() => {}} title="News" isLive liveSourceId="src-1" engineFactory={factory} />);
      await act(async () => {});
      engines[0].fail({ kind: "network", fatal: true, message: "gone" });
      await act(async () => {});
      engines[1].fail({ kind: "network", fatal: true, message: "gone" });

      expect(screen.getByRole("alert")).toBeDefined();
      expect(screen.queryByRole("button", { name: /Try (HLS|MPEG-TS)/ })).toBeNull();
      expect(screen.queryByText(/fixed in App Settings/)).toBeNull();
      expect(focusedId()).toBe("player-error-retry");
      expect(workingLiveStreamFormat("src-1")).toBeUndefined();

      press("Enter");
      await act(async () => {});
      expect(loadedUrl(engines[2].engine)).toBe(hls);
    });

    it("a fixed format never switches by itself, and the error says where to change it", async () => {
      updateSettings({ liveStreamFormat: "m3u8" });
      const { engines, factory, created } = engineQueue(true, false);
      render(<PlayerScreen streamUrl={hls} platform="web" onClose={() => {}} title="News" isLive liveSourceId="src-1" engineFactory={factory} />);
      await act(async () => {});
      engines[0].fail({ kind: "manifest", fatal: true, message: "bad playlist" });

      expect(screen.getByRole("alert").textContent).toContain("Set it to Auto");
      expect(created()).toBe(1);
    });

    it("a channel that drops after playing is reconnected in the same format, twice, before the error", async () => {
      const { engines, factory } = engineQueue(false, false, false);
      render(<PlayerScreen streamUrl={hls} platform="web" onClose={() => {}} title="News" isLive liveSourceId="src-1" engineFactory={factory} />);
      await act(async () => {});

      for (const index of [0, 1]) {
        engines[index].fail({ kind: "network", fatal: true, message: "dropped" });
        await act(async () => {});
        expect(screen.queryByRole("alert")).toBeNull();
        expect(loadedUrl(engines[index + 1].engine)).toBe(hls);
      }
      engines[2].fail({ kind: "network", fatal: true, message: "dropped" });
      expect(screen.getByRole("alert")).toBeDefined();
    });

    it("the menu's Stream Format switches the channel by hand", async () => {
      const { engines, factory } = engineQueue(false, false);
      render(<PlayerScreen streamUrl={hls} platform="web" onClose={() => {}} title="News" isLive liveSourceId="src-1" engineFactory={factory} />);
      await act(async () => {});
      engines[0].tick(10);
      press("ArrowRight");
      press("Enter");
      expect(screen.getByRole("button", { name: "HLS", pressed: true })).toBeDefined();

      act(() => useFocusStore.getState().focus("player-stream-format:ts"));
      press("Enter");
      await act(async () => {});
      expect(loadedUrl(engines[1].engine)).toBe(ts);
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("offers no format choice for anything that isn't an Xtream live channel", async () => {
      const { engine, tick } = makeEngine(NaN);
      render(<PlayerScreen streamUrl="http://cdn.example/news/index.m3u8" platform="web" onClose={() => {}} title="News" isLive engineFactory={() => engine} />);
      await act(async () => {});
      tick(10);
      press("ArrowRight");
      press("Enter");
      expect(screen.getByRole("dialog", { name: "Audio & Subtitles" })).toBeDefined();
      expect(screen.queryByText("Stream Format")).toBeNull();
    });
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
    expect(engines[1].engine.load).toHaveBeenCalledWith("s", expect.objectContaining({ startPositionSeconds: 1500 }));
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

  it("shows a loading screen with the artwork until the stream starts, then fades it out", async () => {
    const { engine } = makeEngine(3600);
    render(<PlayerScreen streamUrl="s" platform="web" onClose={() => {}} title="Film" info={{ posterUrl: "poster.jpg" }} engineFactory={() => engine} />);
    const loading = screen.getByTestId("player-loading");
    expect(loading.style.opacity).toBe("1");
    expect(screen.getByText("Starting…")).toBeDefined();
    await act(async () => {});
    expect(loading.style.opacity).toBe("0");
  });

  it("keeps the loading screen up while a stream hasn't started", async () => {
    const { engine } = makeEngine(NaN, { hangOnLoad: true });
    render(<PlayerScreen streamUrl="s" platform="web" onClose={() => {}} title="News" isLive info={{ logoUrl: "logo.png" }} engineFactory={() => engine} />);
    await act(async () => {});
    expect(screen.getByTestId("player-loading").style.opacity).toBe("1");
    expect(screen.getByText("Tuning in…")).toBeDefined();
  });

  it("shows \"You're watching\" after 10s paused; any key brings the controls back, OK resumes", async () => {
    const { engine, tick } = makeEngine(3600);
    const { container } = render(
      <PlayerScreen
        streamUrl="s"
        platform="web"
        onClose={() => {}}
        title="The Night Shift"
        subtitle="S2 E4 · Ghosts"
        info={{ plot: "A shift goes wrong.", rating: 8.1, year: 2016 }}
        engineFactory={() => engine}
      />,
    );
    await act(async () => {});
    tick(600);
    act(() => {
      container.querySelector("video")!.dispatchEvent(new Event("pause"));
    });
    act(() => vi.advanceTimersByTime(9_000));
    expect(screen.queryByRole("status", { name: "You're watching" })).toBeNull();
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByRole("status", { name: "You're watching" }).textContent).toContain("A shift goes wrong.");
    expect(screen.getByText("2016")).toBeDefined();

    press("ArrowDown"); // just brings the controls back
    expect(screen.queryByRole("status", { name: "You're watching" })).toBeNull();
    expect(focusedId()).toBe("seek-bar");
    const playsBefore = engine.play.mock.calls.length;

    act(() => vi.advanceTimersByTime(10_000)); // still paused: it returns
    expect(screen.getByRole("status", { name: "You're watching" })).toBeDefined();
    press("Enter");
    expect(engine.play).toHaveBeenCalledTimes(playsBefore + 1);
    expect(engine.pause).not.toHaveBeenCalled();
  });

  it("series: Up from the seek bar opens the Episodes panel on the current episode; OK plays another", async () => {
    const episodes = [1, 2, 3].map((n) => ({ id: `e${n}`, seriesId: "s", season: 1, episode: n, title: `Ep ${n}`, streamUrl: `u${n}` }));
    episodes.push({ id: "e4", seriesId: "s", season: 2, episode: 1, title: "S2 opener", streamUrl: "u4" });
    const onPlayEpisode = vi.fn();
    const { engine, tick } = makeEngine(3600);
    render(
      <PlayerScreen
        streamUrl="u2"
        platform="web"
        onClose={() => {}}
        title="Show"
        episodes={episodes}
        currentEpisodeId="e2"
        onPlayEpisode={onPlayEpisode}
        engineFactory={() => engine}
      />,
    );
    await act(async () => {});
    tick(600);
    press("ArrowUp");
    expect(screen.getByRole("dialog", { name: "Episodes" })).toBeDefined();
    expect(screen.getByText("Now playing")).toBeDefined();
    expect(focusedId()).toBe("player-episode:e2");

    press("ArrowUp"); // season chips
    expect(focusedId()).toBe("player-season:1");
    press("ArrowRight");
    press("Enter"); // switch to season 2
    expect(screen.getByText("1. S2 opener")).toBeDefined();
    press("ArrowDown");
    press("Enter");
    expect(onPlayEpisode).toHaveBeenCalledWith(episodes[3]);
    expect(screen.queryByRole("dialog", { name: "Episodes" })).toBeNull();
  });

  it("Back closes the Episodes panel and returns focus to where it was opened", async () => {
    const episodes = [1, 2].map((n) => ({ id: `e${n}`, seriesId: "s", season: 1, episode: n, title: `Ep ${n}`, streamUrl: `u${n}` }));
    const onClose = vi.fn();
    const { engine, tick } = makeEngine(3600);
    render(
      <PlayerScreen streamUrl="u1" platform="web" onClose={onClose} title="Show" episodes={episodes} currentEpisodeId="e1" onPlayEpisode={() => {}} engineFactory={() => engine} />,
    );
    await act(async () => {});
    tick(600);
    press("ArrowDown");
    press("ArrowRight");
    press("ArrowRight");
    expect(focusedId()).toBe("player-episodes-button");
    press("Enter");
    expect(screen.getByRole("dialog", { name: "Episodes" })).toBeDefined();
    press("Escape");
    expect(screen.queryByRole("dialog", { name: "Episodes" })).toBeNull();
    expect(focusedId()).toBe("player-episodes-button");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("autoResume starts at the saved position without asking", async () => {
    const { engine } = makeEngine(3600);
    render(
      <PlayerScreen streamUrl="s" platform="web" onClose={() => {}} title="Film" resumeFrom={{ positionSeconds: 900, durationSeconds: 3600 }} autoResume engineFactory={() => engine} />,
    );
    await act(async () => {});
    expect(screen.queryByRole("button", { name: /Resume from/ })).toBeNull();
    expect(engine.load).toHaveBeenCalledWith("s", expect.objectContaining({ startPositionSeconds: 900 }));
  });

  it("live TV shows the channel number and what's on now from the guide — never LIVE", async () => {
    const now = Date.now();
    guide.nowNext = {
      now: { channelId: "c", title: "Antiques Roadshow", description: "Treasures from Bath.", start: new Date(now - 20 * 60_000), stop: new Date(now + 40 * 60_000) },
      next: { channelId: "c", title: "Panorama", start: new Date(now + 40 * 60_000), stop: new Date(now + 70 * 60_000) },
    };
    const { engine } = makeEngine(NaN);
    const { container } = render(
      <PlayerScreen
        streamUrl="s"
        platform="web"
        onClose={() => {}}
        title="BBC One HD"
        isLive
        liveChannel={{ id: "c", name: "BBC One HD", streamUrl: "s", kind: "live", number: 101 }}
        guideSource={{ kind: "m3u-url", id: "src", name: "P", url: "u" }}
        engineFactory={() => engine}
      />,
    );
    await act(async () => {});
    // The programme is the heading; the channel moves into the chip.
    expect(screen.getByText("CH 101 · BBC One HD")).toBeDefined();
    expect(screen.getByText("Antiques Roadshow")).toBeDefined();
    expect(screen.getByText("40 min left")).toBeDefined();
    expect(container.textContent).toContain("Panorama");
    expect(screen.queryByText(/LIVE/)).toBeNull();

    // Paused: "You're watching" describes the programme on now.
    act(() => {
      container.querySelector("video")!.dispatchEvent(new Event("pause"));
    });
    act(() => vi.advanceTimersByTime(10_000));
    const paused = screen.getByRole("status", { name: "You're watching" });
    expect(paused.textContent).toContain("On Now: Antiques Roadshow");
    expect(paused.textContent).toContain("Treasures from Bath.");
    guide.nowNext = null;
  });

  describe("changing channel", () => {
    const channels = [101, 102, 105].map((n) => ({ id: `c${n}`, name: `Channel ${n}`, streamUrl: `s${n}`, kind: "live" as const, number: n }));
    const lineup = { lineup: channels, directory: [...channels, { id: "c999", name: "Far away", streamUrl: "s999", kind: "live" as const, number: 999 }] };

    function renderLive(onTuneChannel = vi.fn(), current = channels[0]) {
      const { engine } = makeEngine(NaN);
      const view = render(
        <PlayerScreen
          streamUrl={current.streamUrl}
          platform="web"
          onClose={() => {}}
          title={current.name}
          isLive
          liveChannel={current}
          channelLineup={lineup}
          onTuneChannel={onTuneChannel}
          engineFactory={() => engine}
        />,
      );
      return { view, engine, onTuneChannel };
    }

    it("CH+/CH− step through the lineup, wrapping at the ends", async () => {
      const { onTuneChannel } = renderLive();
      await act(async () => {});
      press("ChannelUp");
      expect(onTuneChannel).toHaveBeenLastCalledWith(channels[1]);
      press("PageDown"); // LG's CH− — from the first channel wraps to the last
      expect(onTuneChannel).toHaveBeenLastCalledWith(channels[2]);
    });

    it("number keys collect digits, then tune after a pause (or at once on OK)", async () => {
      const { onTuneChannel } = renderLive();
      await act(async () => {});
      press("1");
      press("0");
      expect(screen.getByRole("status", { name: "Channel number" }).textContent).toContain("10");
      press("5");
      expect(onTuneChannel).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1500));
      expect(onTuneChannel).toHaveBeenCalledWith(channels[2]);
      expect(screen.queryByRole("status", { name: "Channel number" })).toBeNull();

      press("9");
      press("9");
      press("9");
      press("Enter"); // OK tunes straight away — here, to a channel outside the lineup
      expect(onTuneChannel).toHaveBeenLastCalledWith(lineup.directory[3]);
    });

    it("says so when no channel has the number", async () => {
      const { onTuneChannel } = renderLive();
      await act(async () => {});
      press("4");
      press("4");
      press("Enter");
      expect(screen.getByText("No channel 44")).toBeDefined();
      expect(onTuneChannel).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(2000));
      expect(screen.queryByText("No channel 44")).toBeNull();
    });

    it("after a channel change shows a channel banner (not the full loading screen) for a few seconds", async () => {
      const { view, engine } = renderLive();
      await act(async () => {});
      expect(screen.queryByRole("status", { name: "Channel" })).toBeNull();

      view.rerender(
        <PlayerScreen
          streamUrl={channels[1].streamUrl}
          platform="web"
          onClose={() => {}}
          title={channels[1].name}
          isLive
          liveChannel={channels[1]}
          channelLineup={lineup}
          onTuneChannel={() => {}}
          engineFactory={() => engine}
        />,
      );
      const banner = screen.getByRole("status", { name: "Channel" });
      expect(banner.textContent).toContain("102");
      expect(banner.textContent).toContain("Channel 102");
      expect(screen.getByTestId("player-loading").style.opacity).toBe("0");
      act(() => vi.advanceTimersByTime(5000));
      expect(screen.queryByRole("status", { name: "Channel" })).toBeNull();
    });
  });

  it("takes focus from the screen underneath (which stays mounted) and hands it back on close", async () => {
    // The page the viewer played from keeps its focus graph registered, with focus on the card they pressed.
    act(() => {
      useFocusStore.getState().setGraph("underlying-page", [
        { id: "episode-card", neighbors: { down: "other-card" } },
        { id: "other-card", neighbors: { up: "episode-card" } },
      ]);
      useFocusStore.getState().focus("episode-card");
    });
    const { engine, tick } = makeEngine(3600);
    const view = render(<PlayerScreen streamUrl="s" platform="web" onClose={() => {}} title="Film" engineFactory={() => engine} />);
    await act(async () => {});
    tick(600);
    expect(focusedId()).toBe("seek-bar");

    press("ArrowDown");
    expect(focusedId()).toBe("play-pause");
    press("Enter");
    expect(engine.pause).toHaveBeenCalledTimes(1);

    view.unmount();
    act(() => vi.advanceTimersByTime(0));
    expect(focusedId()).toBe("episode-card");
    useFocusStore.getState().clearGraph("underlying-page");
  });

  describe("next-episode countdown", () => {
    const upNext = { id: "e5", seriesId: "s", season: 2, episode: 5, title: "The Tide", plot: "The storm reaches the town.", streamUrl: "u5", posterUrl: "thumb.jpg" };

    async function renderEpisode(onNextEpisode = vi.fn()) {
      const { engine, tick } = makeEngine(2700);
      const view = render(
        <PlayerScreen streamUrl="u4" platform="web" onClose={() => {}} title="Show" onNextEpisode={onNextEpisode} upNextEpisode={upNext} engineFactory={() => engine} />,
      );
      await act(async () => {});
      return { view, engine, tick, onNextEpisode };
    }

    it("appears in the last 20 seconds with the next episode, and plays it after 10 seconds", async () => {
      const { tick, onNextEpisode } = await renderEpisode();
      tick(2600);
      expect(screen.queryByRole("dialog", { name: "Next episode" })).toBeNull();
      tick(2681);
      const card = screen.getByRole("dialog", { name: "Next episode" });
      expect(card.textContent).toContain("Next episode in 10s");
      expect(card.textContent).toContain("S2 E5 · The Tide");
      expect(card.textContent).toContain("The storm reaches the town.");
      expect(focusedId()).toBe("player-next-up-play");

      act(() => vi.advanceTimersByTime(4000));
      expect(card.textContent).toContain("Next episode in 6s");
      act(() => vi.advanceTimersByTime(6000));
      expect(onNextEpisode).toHaveBeenCalledTimes(1);
    });

    it("holds the countdown while paused; Play Now skips it", async () => {
      const { tick, onNextEpisode, view } = await renderEpisode();
      tick(2690);
      act(() => {
        view.container.querySelector("video")!.dispatchEvent(new Event("pause"));
      });
      act(() => vi.advanceTimersByTime(15_000));
      expect(onNextEpisode).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog", { name: "Next episode" }).textContent).toContain("Next episode in 10s");
      press("Enter"); // Play Now
      expect(onNextEpisode).toHaveBeenCalledTimes(1);
    });

    it("Watch Credits (or Back) dismisses it for this episode", async () => {
      const { tick, onNextEpisode } = await renderEpisode();
      tick(2685);
      press("ArrowRight");
      press("Enter"); // Watch Credits
      expect(screen.queryByRole("dialog", { name: "Next episode" })).toBeNull();
      tick(2690);
      act(() => vi.advanceTimersByTime(15_000));
      expect(screen.queryByRole("dialog", { name: "Next episode" })).toBeNull();
      expect(onNextEpisode).not.toHaveBeenCalled();
    });

    it("Back dismisses it without leaving the player", async () => {
      const onClose = vi.fn();
      const { engine, tick } = makeEngine(2700);
      render(<PlayerScreen streamUrl="u4" platform="web" onClose={onClose} title="Show" onNextEpisode={() => {}} upNextEpisode={upNext} engineFactory={() => engine} />);
      await act(async () => {});
      tick(2690);
      press("Escape");
      expect(screen.queryByRole("dialog", { name: "Next episode" })).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  it("My List in the controls adds and removes what's playing — a series as a whole", async () => {
    localStorage.clear();
    const { engine, tick } = makeEngine(2700);
    render(
      <PlayerScreen
        streamUrl="u4"
        platform="web"
        onClose={() => {}}
        title="Show"
        watchTarget={{ profileId: "p", sourceId: "src", kind: "series", contentId: "show-1", title: "Show", episodeId: "e4" }}
        engineFactory={() => engine}
      />,
    );
    await act(async () => {});
    tick(600);
    press("ArrowDown");
    press("ArrowRight");
    press("ArrowRight");
    expect(focusedId()).toBe("player-my-list");
    press("Enter");
    expect(isFavorite("p", "src", "series", "show-1")).toBe(true);
    press("Enter");
    expect(isFavorite("p", "src", "series", "show-1")).toBe(false);
  });
});
