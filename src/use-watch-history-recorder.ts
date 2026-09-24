import { useEffect, useRef } from "react";
import type { WatchHistoryEntry } from "@core";
import { recordWatchHistory } from "./profile-store.js";

/** What's playing, described for Recently Watched — everything the page needs to show and replay it. */
export type WatchTarget = Omit<WatchHistoryEntry, "positionSeconds" | "durationSeconds" | "finished" | "updatedAt"> & {
  /** Series: the episode after this one — what Recently Watched offers once this one is finished. */
  nextEpisode?: Required<Pick<WatchHistoryEntry, "episodeId" | "season" | "episode">> & Pick<WatchHistoryEntry, "subtitle" | "streamUrl">;
};

/** A film or episode joins Recently Watched after this much actual playback, not on a click or a failed start. */
export const HISTORY_MIN_WATCH_SECONDS = 30;
/** A channel joins after this long on it, so flicking through with CH+/CH− doesn't fill the list. */
export const HISTORY_MIN_LIVE_MS = 60_000;
/** Progress updates are written at most this often. */
const WRITE_INTERVAL_MS = 5000;
/** Within this much of the end (or past 95%) counts as finished — the credits. */
const FINISHED_MARGIN_SECONDS = 90;

function isFinished(positionSeconds: number, durationSeconds: number): boolean {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return false;
  return positionSeconds >= durationSeconds - FINISHED_MARGIN_SECONDS || positionSeconds / durationSeconds >= 0.95;
}

/**
 * Keeps Recently Watched up to date from the player:
 *
 * - Films and episodes are recorded once they've actually played for
 *   HISTORY_MIN_WATCH_SECONDS (seeking doesn't count), then their position
 *   is refreshed every few seconds.
 * - Finishing a film marks it finished; finishing an episode moves the
 *   series on to the next episode at 0:00 (or marks it finished if it was
 *   the last).
 * - Channels are recorded after HISTORY_MIN_LIVE_MS of continuous playing.
 */
export function useWatchHistoryRecorder(
  target: WatchTarget | undefined,
  playback: { hasStarted: boolean; isPlaying: boolean; positionSeconds: number; durationSeconds: number },
): void {
  const { hasStarted, isPlaying, positionSeconds, durationSeconds } = playback;
  const targetRef = useRef(target);
  targetRef.current = target;
  const key = target ? `${target.kind}:${target.contentId}:${target.episodeId ?? ""}:${target.streamUrl ?? ""}` : "";

  const watchedSecondsRef = useRef(0);
  const lastPositionRef = useRef<number | null>(null);
  const lastWriteRef = useRef(0);
  const finishedRef = useRef(false);

  useEffect(() => {
    watchedSecondsRef.current = 0;
    lastPositionRef.current = null;
    lastWriteRef.current = 0;
    finishedRef.current = false;
  }, [key]);

  // Films and episodes.
  useEffect(() => {
    const current = targetRef.current;
    if (!current || current.kind === "live" || !hasStarted) return;

    const last = lastPositionRef.current;
    lastPositionRef.current = positionSeconds;
    // Only natural playback counts — a seek jumps by more than a few seconds.
    if (last !== null) {
      const delta = positionSeconds - last;
      if (delta > 0 && delta < 5) watchedSecondsRef.current += delta;
    }
    if (watchedSecondsRef.current < HISTORY_MIN_WATCH_SECONDS || finishedRef.current) return;

    const { nextEpisode, ...entry } = current;
    if (isFinished(positionSeconds, durationSeconds)) {
      finishedRef.current = true;
      if (current.kind === "series" && nextEpisode) {
        recordWatchHistory({ ...entry, ...nextEpisode, positionSeconds: 0, durationSeconds: undefined, finished: false });
      } else {
        recordWatchHistory({ ...entry, positionSeconds, durationSeconds, finished: true });
      }
      return;
    }

    const now = Date.now();
    if (now - lastWriteRef.current < WRITE_INTERVAL_MS) return;
    lastWriteRef.current = now;
    recordWatchHistory({ ...entry, positionSeconds, durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : undefined, finished: false });
  }, [positionSeconds, durationSeconds, hasStarted, key]);

  // Channels.
  useEffect(() => {
    const current = targetRef.current;
    if (!current || current.kind !== "live" || !hasStarted || !isPlaying) return;
    const timer = setTimeout(() => {
      const { nextEpisode: _unused, ...entry } = current;
      recordWatchHistory(entry);
    }, HISTORY_MIN_LIVE_MS);
    return () => clearTimeout(timer);
  }, [hasStarted, isPlaying, key]);
}
