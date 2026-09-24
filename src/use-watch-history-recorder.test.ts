import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadWatchHistory } from "./profile-store.js";
import { useWatchHistoryRecorder, type WatchTarget } from "./use-watch-history-recorder.js";

const film: WatchTarget = { profileId: "p", sourceId: "s", kind: "movie", contentId: "m1", title: "Film", streamUrl: "u" };
const history = () => loadWatchHistory("p", "s");

type Playback = { hasStarted: boolean; isPlaying: boolean; positionSeconds: number; durationSeconds: number };

function setup(target: WatchTarget, initial: Partial<Playback> = {}) {
  const playback: Playback = { hasStarted: true, isPlaying: true, positionSeconds: 0, durationSeconds: 3600, ...initial };
  const hook = renderHook((props: { target: WatchTarget; playback: Playback }) => useWatchHistoryRecorder(props.target, props.playback), {
    initialProps: { target, playback },
  });
  /** Plays from `from` to `to` in 1-second ticks, like timeupdate. */
  const play = (from: number, to: number, duration = playback.durationSeconds) => {
    for (let t = from; t <= to; t++) {
      act(() => vi.advanceTimersByTime(1000));
      hook.rerender({ target, playback: { ...playback, positionSeconds: t, durationSeconds: duration } });
    }
  };
  return { hook, play };
}

describe("useWatchHistoryRecorder", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("records a film only after 30 seconds of real playback — seeking doesn't count", () => {
    const { hook, play } = setup(film);
    hook.rerender({ target: film, playback: { hasStarted: true, isPlaying: true, positionSeconds: 1800, durationSeconds: 3600 } }); // a seek
    play(1801, 1825);
    expect(history()).toEqual([]);
    play(1826, 1832);
    expect(history()[0]).toMatchObject({ contentId: "m1", finished: false, durationSeconds: 3600 });
    expect(history()[0].positionSeconds).toBeGreaterThan(1825);
  });

  it("marks a film finished near the end", () => {
    const { play } = setup(film, { positionSeconds: 3460 });
    play(3461, 3515);
    expect(history()[0]).toMatchObject({ contentId: "m1", finished: true });
  });

  it("moves a series on to the next episode when one is finished", () => {
    const episode: WatchTarget = {
      profileId: "p",
      sourceId: "s",
      kind: "series",
      contentId: "show",
      title: "Show",
      subtitle: "S1 E1 · Pilot",
      episodeId: "e1",
      season: 1,
      episode: 1,
      streamUrl: "u1",
      nextEpisode: { episodeId: "e2", season: 1, episode: 2, subtitle: "Up next: S1 E2 · Two", streamUrl: "u2" },
    };
    const { play } = setup(episode, { positionSeconds: 2560, durationSeconds: 2700 });
    play(2561, 2615);
    expect(history()[0]).toMatchObject({ contentId: "show", episodeId: "e2", subtitle: "Up next: S1 E2 · Two", streamUrl: "u2", positionSeconds: 0, finished: false });
  });

  it("records a channel after a minute of continuous playing, not while flicking through", () => {
    const channel: WatchTarget = { profileId: "p", sourceId: "s", kind: "live", contentId: "c1", title: "News", channelNumber: 5 };
    const { hook } = setup(channel, { durationSeconds: NaN });
    act(() => vi.advanceTimersByTime(30_000));
    hook.rerender({ target: channel, playback: { hasStarted: true, isPlaying: false, positionSeconds: 0, durationSeconds: NaN } }); // paused
    act(() => vi.advanceTimersByTime(60_000));
    expect(history()).toEqual([]);
    hook.rerender({ target: channel, playback: { hasStarted: true, isPlaying: true, positionSeconds: 0, durationSeconds: NaN } });
    act(() => vi.advanceTimersByTime(60_000));
    expect(history()[0]).toMatchObject({ kind: "live", contentId: "c1", channelNumber: 5 });
  });
});
