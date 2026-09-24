import { useCallback, useEffect, useRef, useState } from "react";
import { resolveRemoteAction, type PlatformId, type SeriesEpisode } from "@core";
import type { AudioTrackInfo, PlaybackProgress, PlayerEngine, PlayerError, SubtitleTrackInfo } from "@player";
import {
  BROWSE_SIDE_PADDING,
  PLAYER_SEEK_ID,
  PlaybackControls,
  SEEK_STEP_SECONDS,
  TV_TEXT,
  TvButton,
  VideoSurface,
  formatPlaybackTime,
  swallowNextKeyUp,
  useFocusStore,
  useRemoteInput,
} from "@ui";
import { ArrowLeft, Play, RotateCcw, TriangleAlert } from "lucide-react";
import { upsertContinueWatching, type ResumePoint } from "../profile-store.js";
import { PlayerEpisodesPanel } from "./PlayerEpisodesPanel.js";
import { PausedInfoOverlay, PlayerLoadingScreen, type PlaybackInfo } from "./PlayerOverlays.js";

/** Identifies what's playing for Continue Watching persistence — omitted entirely for content that shouldn't be resumed (live TV, catch-up). */
export interface PlaybackIdentity {
  profileId: string;
  contentId: string;
  contentKind: "movie" | "series-episode";
  /** Required when contentKind is "series-episode" — the episode's own id; contentId is the parent series id. */
  episodeId?: string;
}

export interface PlayerScreenProps {
  streamUrl: string;
  platform: PlatformId;
  onClose: () => void;
  /** VOD/series identity for resume tracking. Left unset for content Continue Watching doesn't apply to (live TV). */
  identity?: PlaybackIdentity;
  /** Shown as the overlay's title — omitted (no title row) for content the caller doesn't have a display name for. */
  title?: string;
  /** e.g. "S2 E4 · Episode title" — shown under the title for series playback. */
  subtitle?: string;
  /** Present only for series playback with another episode after this one — renders the Next Episode control and drives auto-advance on end-of-stream. */
  onNextEpisode?: () => void;
  /** Live TV playback: no seek bar or scrubbing, and a LIVE badge — see PlaybackControls' isLive prop. */
  isLive?: boolean;
  /** Where this profile stopped last time — offers "Resume from …" / "Start Over" before the stream loads. */
  resumeFrom?: ResumePoint | null;
  /** The viewer already chose Resume (e.g. the series page's Resume button) — start at resumeFrom without asking. */
  autoResume?: boolean;
  /** Plot, rating, year and artwork for the loading and "You're watching" screens. */
  info?: PlaybackInfo;
  /** Series playback: every episode of the series, for the in-player Episodes panel. */
  episodes?: SeriesEpisode[];
  currentEpisodeId?: string;
  onPlayEpisode?: (episode: SeriesEpisode) => void;
  /** Test seam — see VideoSurface. */
  engineFactory?: () => PlayerEngine;
}

/** How often a timeupdate tick is allowed to write to localStorage — timeupdate fires several times a second, far more often than resume position needs to be durable. */
const PROGRESS_WRITE_INTERVAL_MS = 5000;

/** Controls fade out after this long without remote activity while playing (paused keeps them up, like Netflix). */
const AUTO_HIDE_MS = 5000;

/** A scrub is committed this long after the last Left/Right press, so a run of presses costs the stream one seek, not one per press. */
const SEEK_COMMIT_MS = 800;

/** Buffering this long without recovering (a dead link, or a stream that stopped) is shown as an error. */
const STALL_TIMEOUT_MS = 30_000;

/** Paused this long, the picture dims and "You're watching" takes over (Netflix's timing is similar). */
const PAUSED_INFO_DELAY_MS = 10_000;

type Panel = "none" | "menu" | "episodes";

const RESUME_SCOPE = "player-resume";
const RESUME_ID = "player-resume-continue";
const START_OVER_ID = "player-resume-start-over";
const ERROR_SCOPE = "player-error";
const RETRY_ID = "player-error-retry";
const ERROR_BACK_ID = "player-error-back";

/** Scrub step grows the longer Left/Right is held or tapped in a row: 10s, then 30s, then 60s. */
function seekStepFor(pressCount: number): number {
  if (pressCount < 6) return SEEK_STEP_SECONDS;
  if (pressCount < 14) return 30;
  return 60;
}

type PlaybackFailure = Pick<PlayerError, "kind"> & { stalled?: boolean };

function describeFailure(failure: PlaybackFailure, isLive: boolean): string {
  if (failure.stalled) return `The ${isLive ? "channel" : "stream"} stopped responding. The provider may be busy — try again in a moment.`;
  switch (failure.kind) {
    case "network":
      return "The stream isn't responding. The provider may be down, or your internet connection dropped.";
    case "media":
      return "This video's format can't be played on this TV.";
    case "manifest":
      return "The provider sent a stream this player can't read.";
    default:
      return "Something went wrong while starting playback.";
  }
}

/**
 * Fullscreen player for VOD, series and live TV. PlaybackControls draws the
 * overlay; this screen owns the engine and routes the remote:
 *
 * - While the controls are hidden, a key press just brings them back
 *   (it doesn't also act) — except Left/Right, which scrub straight away,
 *   and the media keys.
 * - While they're shown, Left/Right scrub only when the seek bar is focused;
 *   elsewhere they move focus between buttons as usual.
 * - Rewind / Fast-forward always scrub; Play, Pause and Stop do what they say.
 * - Back closes an open panel (Audio & Subtitles, Episodes) first, then the player.
 * - Series: Up from the seek bar (or the Episodes button) opens the Episodes panel.
 *
 * Until the stream starts, a loading screen (artwork, title) covers the
 * black video. After PAUSED_INFO_DELAY_MS paused, "You're watching" dims
 * the picture; any key brings the controls back, OK also resumes.
 *
 * Before playback it may ask Resume / Start Over; if the stream fails (an
 * engine error, or buffering for STALL_TIMEOUT_MS) it shows an error with
 * Try Again, which reloads from where playback got to.
 *
 * No on-screen volume control: TV playback uses the TV's own volume.
 */
export function PlayerScreen({
  streamUrl,
  platform,
  onClose,
  identity,
  title,
  subtitle,
  onNextEpisode,
  isLive = false,
  resumeFrom,
  autoResume = false,
  info,
  episodes,
  currentEpisodeId,
  onPlayEpisode,
  engineFactory,
}: PlayerScreenProps): JSX.Element {
  const lastWriteRef = useRef(0);
  const engineRef = useRef<PlayerEngine | null>(null);

  // Both are keyed by stream URL, so Next Episode (a new URL, same mounted
  // player) asks again and never inherits the previous episode's start.
  const [resumeAnsweredFor, setResumeAnsweredFor] = useState<string | null>(null);
  const [startAt, setStartAt] = useState<{ streamUrl: string; seconds: number } | null>(null);
  const isChoosingResume = Boolean(resumeFrom) && !autoResume && resumeAnsweredFor !== streamUrl;
  const startPositionSeconds =
    startAt?.streamUrl === streamUrl ? startAt.seconds : autoResume && resumeFrom ? resumeFrom.positionSeconds : undefined;
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<PlaybackFailure | null>(null);

  const [isPlaying, setIsPlaying] = useState(true);
  const [positionSeconds, setPositionSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(NaN);
  const [pendingSeekSeconds, setPendingSeekSeconds] = useState<number | null>(null);
  const [audioTracks, setAudioTracks] = useState<AudioTrackInfo[]>([]);
  const [activeAudioTrackId, setActiveAudioTrackId] = useState<number | null>(null);
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrackInfo[]>([]);
  const [activeSubtitleTrackId, setActiveSubtitleTrackId] = useState<number | null>(null);
  const [areControlsVisible, setAreControlsVisible] = useState(true);
  const [panel, setPanel] = useState<Panel>("none");
  const [returnFocusId, setReturnFocusId] = useState<string | null>(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [isPausedInfoShown, setIsPausedInfoShown] = useState(false);
  const [pausedInfoCycle, setPausedInfoCycle] = useState(0);
  const sawBufferingRef = useRef(false);

  const isMenuOpen = panel === "menu";
  const isShowingVideo = !isChoosingResume && failure === null;
  const hasEpisodes = Boolean(onPlayEpisode && episodes && episodes.length > 1);

  // Mirrors of state for the key handler and timers, which live outside React's render cycle.
  const isPanelOpen = panel !== "none";
  const stateRef = useRef({ isPlaying, isPanelOpen, areControlsVisible, positionSeconds, durationSeconds, pendingSeekSeconds, isShowingVideo, isPausedInfoShown, hasEpisodes });
  stateRef.current = { isPlaying, isPanelOpen, areControlsVisible, positionSeconds, durationSeconds, pendingSeekSeconds, isShowingVideo, isPausedInfoShown, hasEpisodes };

  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekPressCountRef = useRef(0);

  const showControls = useCallback(() => {
    setAreControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      const { isPlaying: playing, isPanelOpen: panelOpen, pendingSeekSeconds: pending } = stateRef.current;
      if (playing && !panelOpen && pending === null) setAreControlsVisible(false);
    }, AUTO_HIDE_MS);
  }, []);

  const clearStallTimer = useCallback(() => {
    if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
    stallTimerRef.current = null;
  }, []);

  useEffect(() => {
    showControls();
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
      clearStallTimer();
    };
  }, [showControls, clearStallTimer]);

  const handleProgress = (progress: PlaybackProgress): void => {
    setPositionSeconds(progress.positionSeconds);
    setDurationSeconds(progress.durationSeconds);

    if (!identity) return;
    // A live/unknown-length stream has no meaningful "resume position".
    if (!Number.isFinite(progress.durationSeconds) || progress.durationSeconds <= 0) return;

    const now = Date.now();
    if (now - lastWriteRef.current < PROGRESS_WRITE_INTERVAL_MS) return;
    lastWriteRef.current = now;

    upsertContinueWatching({
      profileId: identity.profileId,
      contentId: identity.contentId,
      contentKind: identity.contentKind,
      episodeId: identity.episodeId,
      positionSeconds: progress.positionSeconds,
      durationSeconds: progress.durationSeconds,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleEngineReady = useCallback((engine: PlayerEngine | null) => {
    engineRef.current = engine;
    if (!engine) return;
    setAudioTracks(engine.getAudioTracks());
    setSubtitleTracks(engine.getSubtitleTracks());
  }, []);

  const handlePlayStateChange = useCallback(
    ({ isPlaying: playing, didEnd }: { isPlaying: boolean; didEnd: boolean }) => {
      setIsPlaying(playing);
      if (playing) showControls(); // restart the hide timer that pausing held open
      if (didEnd && onNextEpisode) onNextEpisode();
    },
    [onNextEpisode, showControls],
  );

  // Stable identity: VideoSurface reloads the stream when onError changes.
  const handleError = useCallback(
    (error: PlayerError) => {
      if (!error.fatal) return; // the engine is recovering; buffering covers it
      clearStallTimer();
      setFailure({ kind: error.kind });
    },
    [clearStallTimer],
  );

  const handleBufferingChange = useCallback(
    (isBuffering: boolean) => {
      clearStallTimer();
      if (isBuffering) {
        sawBufferingRef.current = true;
        stallTimerRef.current = setTimeout(() => setFailure({ kind: "network", stalled: true }), STALL_TIMEOUT_MS);
      } else if (sawBufferingRef.current) {
        setHasStarted(true); // the first load finished — the stream is playing
      }
    },
    [clearStallTimer],
  );

  // A fresh stream (channel/episode change) starts with no known tracks
  // until the new engine reports in — reset so the Audio & Subtitles panel
  // doesn't briefly show the previous stream's tracks.
  useEffect(() => {
    setActiveAudioTrackId(null);
    setActiveSubtitleTrackId(null);
    setDurationSeconds(NaN);
    setPositionSeconds(0);
    setPendingSeekSeconds(null);
    setFailure(null);
    setPanel("none");
    setHasStarted(false);
    sawBufferingRef.current = false;
    if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
  }, [streamUrl]);

  function startPlayback(fromSeconds: number | undefined): void {
    setStartAt(fromSeconds !== undefined ? { streamUrl, seconds: fromSeconds } : null);
    setPositionSeconds(fromSeconds ?? 0);
    setResumeAnsweredFor(streamUrl);
    showControls();
  }

  function retry(): void {
    // Pick up where playback got to (live always rejoins the live edge).
    const { positionSeconds: position } = stateRef.current;
    const from = isLive ? undefined : position > 0 ? position : startPositionSeconds;
    setStartAt(from !== undefined ? { streamUrl, seconds: from } : null);
    setFailure(null);
    setHasStarted(false);
    sawBufferingRef.current = false;
    setAttempt((n) => n + 1);
    showControls();
  }

  // "You're watching": after a while paused (with nothing else on screen).
  useEffect(() => {
    if (isPlaying || !hasStarted || !isShowingVideo || isPanelOpen || pendingSeekSeconds !== null) {
      setIsPausedInfoShown(false);
      return;
    }
    const timer = setTimeout(() => setIsPausedInfoShown(true), PAUSED_INFO_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isPlaying, hasStarted, isShowingVideo, isPanelOpen, pendingSeekSeconds, pausedInfoCycle]);

  function dismissPausedInfo(): void {
    setIsPausedInfoShown(false);
    setPausedInfoCycle((n) => n + 1); // still paused: it comes back after another delay
    showControls();
  }

  function openPanel(next: Exclude<Panel, "none">): void {
    setReturnFocusId(useFocusStore.getState().focusedId);
    setPanel(next);
    showControls();
  }

  function togglePlayPause(): void {
    const engine = engineRef.current;
    if (!engine || !stateRef.current.isShowingVideo) return;
    showControls();
    if (stateRef.current.isPlaying) engine.pause();
    else void engine.play();
  }

  function play(): void {
    if (!stateRef.current.isShowingVideo) return;
    showControls();
    void engineRef.current?.play();
  }

  function pause(): void {
    if (!stateRef.current.isShowingVideo) return;
    showControls();
    engineRef.current?.pause();
  }

  function commitSeek(): void {
    const target = stateRef.current.pendingSeekSeconds;
    seekPressCountRef.current = 0;
    if (target === null) return;
    engineRef.current?.seekTo(target);
    setPositionSeconds(target);
    setPendingSeekSeconds(null);
    showControls();
  }

  function scrub(direction: -1 | 1): void {
    const { positionSeconds: position, durationSeconds: duration, pendingSeekSeconds: pending } = stateRef.current;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const step = seekStepFor(seekPressCountRef.current++);
    const target = Math.min(duration, Math.max(0, (pending ?? position) + direction * step));
    stateRef.current.pendingSeekSeconds = target; // key repeat can outrun re-renders
    setPendingSeekSeconds(target);
    if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
    seekTimerRef.current = setTimeout(commitSeek, SEEK_COMMIT_MS);
  }

  /** Rewind / Fast-forward keys: scrub from anywhere, landing focus on the seek bar. */
  function scrubFromMediaKey(direction: -1 | 1): void {
    const { isShowingVideo: showing, isPanelOpen: panelOpen, durationSeconds: duration } = stateRef.current;
    if (!showing || panelOpen || isLive || !Number.isFinite(duration)) return;
    showControls();
    useFocusStore.getState().focus(PLAYER_SEEK_ID);
    scrub(direction);
  }

  // Runs in the capture phase, ahead of the focus graph's own document
  // listener (useRemoteInput), so it can claim a key before it moves focus.
  useEffect(() => {
    function onKeyDownCapture(event: KeyboardEvent): void {
      const action = resolveRemoteAction(platform, event);
      const { isPanelOpen: panelOpen, areControlsVisible: visible, isShowingVideo: showing, isPausedInfoShown: pausedInfo } = stateRef.current;
      if (action === "unknown" || !showing) return;

      if (pausedInfo) {
        // Any key brings the controls back; OK / Play also resume. Stop still exits.
        if (action === "stop") return;
        event.preventDefault();
        event.stopPropagation();
        dismissPausedInfo();
        if (action === "select") swallowNextKeyUp();
        if (action === "select" || action === "play" || action === "play-pause") void engineRef.current?.play();
        return;
      }

      const wasHidden = !visible;
      showControls();
      if (panelOpen || (action !== "up" && action !== "down" && action !== "left" && action !== "right" && action !== "select")) return;

      const canScrub = !isLive && Number.isFinite(stateRef.current.durationSeconds);
      const isLeftRight = action === "left" || action === "right";
      const focusedId = useFocusStore.getState().focusedId;

      if (isLeftRight && canScrub && (wasHidden || focusedId === PLAYER_SEEK_ID)) {
        event.preventDefault();
        event.stopPropagation();
        if (focusedId !== PLAYER_SEEK_ID) useFocusStore.getState().focus(PLAYER_SEEK_ID);
        scrub(action === "left" ? -1 : 1);
        return;
      }
      if (wasHidden) {
        // The first press only wakes the controls up.
        event.preventDefault();
        event.stopPropagation();
        if (action === "select") swallowNextKeyUp();
        return;
      }
      if (action === "up" && focusedId === PLAYER_SEEK_ID && stateRef.current.hasEpisodes) {
        event.preventDefault();
        event.stopPropagation();
        openPanel("episodes");
      }
    }
    document.addEventListener("keydown", onKeyDownCapture, true);
    return () => document.removeEventListener("keydown", onKeyDownCapture, true);
    // scrub/commitSeek only touch refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, isLive, showControls]);

  useRemoteInput(platform, {
    onBack: () => {
      if (stateRef.current.isPanelOpen) setPanel("none");
      else onClose();
    },
    onPlayPause: togglePlayPause,
    onPlay: play,
    onPause: pause,
    onStop: onClose,
    onRewind: () => scrubFromMediaKey(-1),
    onFastForward: () => scrubFromMediaKey(1),
  });

  function selectAudioTrack(id: number): void {
    engineRef.current?.setAudioTrack(id);
    setActiveAudioTrackId(id);
  }

  function selectSubtitleTrack(id: number | null): void {
    engineRef.current?.setSubtitleTrack(id);
    setActiveSubtitleTrackId(id);
  }

  if (isChoosingResume && resumeFrom) {
    return (
      <PlayerMessage>
        <ResumeChoice
          title={title}
          subtitle={subtitle}
          resumeFrom={resumeFrom}
          onResume={() => startPlayback(resumeFrom.positionSeconds)}
          onStartOver={() => startPlayback(undefined)}
        />
      </PlayerMessage>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 50 }}>
      {failure === null && (
        <VideoSurface
          key={attempt}
          streamUrl={streamUrl}
          engineFactory={engineFactory}
          startPositionSeconds={startPositionSeconds}
          onProgress={handleProgress}
          onEngineReady={handleEngineReady}
          onPlayStateChange={handlePlayStateChange}
          onError={handleError}
          onBufferingChange={handleBufferingChange}
        />
      )}
      {failure === null && (
        <PlayerLoadingScreen title={title} subtitle={subtitle} info={info} isLive={isLive} isVisible={!hasStarted} />
      )}
      {failure === null && isPausedInfoShown && <PausedInfoOverlay title={title} subtitle={subtitle} info={info} isLive={isLive} />}
      {failure === null ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: areControlsVisible && hasStarted && !isPausedInfoShown ? 1 : 0,
            pointerEvents: areControlsVisible ? "auto" : "none",
            transition: "opacity 220ms ease-out",
          }}
        >
          <PlaybackControls
            title={title ?? ""}
            subtitle={subtitle}
            isLive={isLive}
            isPlaying={isPlaying}
            positionSeconds={positionSeconds}
            durationSeconds={Number.isFinite(durationSeconds) ? durationSeconds : 0}
            pendingSeekSeconds={pendingSeekSeconds}
            audioTracks={audioTracks}
            activeAudioTrackId={activeAudioTrackId}
            subtitleTracks={subtitleTracks}
            activeSubtitleTrackId={activeSubtitleTrackId}
            hasNextEpisode={Boolean(onNextEpisode)}
            isMenuOpen={isMenuOpen}
            isPanelOpen={isPanelOpen}
            returnFocusId={returnFocusId}
            onOpenMenu={() => openPanel("menu")}
            onOpenEpisodes={hasEpisodes ? () => openPanel("episodes") : undefined}
            onTogglePlayPause={togglePlayPause}
            onSelectAudioTrack={selectAudioTrack}
            onSelectSubtitleTrack={selectSubtitleTrack}
            onNextEpisode={() => onNextEpisode?.()}
          />
          {panel === "episodes" && episodes && (
            <PlayerEpisodesPanel
              episodes={episodes}
              currentEpisodeId={currentEpisodeId}
              onPlayEpisode={(episode) => {
                setPanel("none");
                if (episode.id !== currentEpisodeId) onPlayEpisode?.(episode);
              }}
            />
          )}
        </div>
      ) : (
        <PlaybackError title={title} message={describeFailure(failure, isLive)} onRetry={retry} onBack={onClose} />
      )}
    </div>
  );
}

/** Full-screen black stage for the resume choice and errors, content left-aligned like the controls. */
function PlayerMessage({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        padding: `3rem ${BROWSE_SIDE_PADDING}`,
        background: "radial-gradient(ellipse at 30% 40%, #1a1d2a 0%, #07080b 70%)",
      }}
    >
      <div style={{ maxWidth: "64rem" }}>{children}</div>
    </div>
  );
}

function useTwoButtonGraph(scope: string, firstId: string, secondId: string, onFirst: () => void, onSecond: () => void): void {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focus = useFocusStore((state) => state.focus);
  const latestRef = useRef({ onFirst, onSecond });
  latestRef.current = { onFirst, onSecond };

  useEffect(() => {
    setGraph(scope, [
      { id: firstId, neighbors: { right: secondId }, onSelect: () => latestRef.current.onFirst() },
      { id: secondId, neighbors: { left: firstId }, onSelect: () => latestRef.current.onSecond() },
    ]);
    // Other scopes (the controls) may still hold focus while unmounting.
    focus(firstId);
    return () => clearGraph(scope);
  }, [scope, firstId, secondId, setGraph, clearGraph, focus]);
}

function ResumeChoice({
  title,
  subtitle,
  resumeFrom,
  onResume,
  onStartOver,
}: {
  title?: string;
  subtitle?: string;
  resumeFrom: ResumePoint;
  onResume: () => void;
  onStartOver: () => void;
}): JSX.Element {
  useTwoButtonGraph(RESUME_SCOPE, RESUME_ID, START_OVER_ID, onResume, onStartOver);
  const ratio = Math.min(1, resumeFrom.positionSeconds / resumeFrom.durationSeconds);
  const remaining = Math.max(0, resumeFrom.durationSeconds - resumeFrom.positionSeconds);

  return (
    <>
      <div style={{ fontSize: TV_TEXT, fontWeight: 600, color: "var(--text-dim)", marginBottom: "0.75rem" }}>Continue watching</div>
      {title && <h1 style={{ fontSize: "3.5rem", fontWeight: 800, color: "#fff", margin: 0, lineHeight: 1.1 }}>{title}</h1>}
      {subtitle && <div style={{ fontSize: "1.625rem", color: "rgba(255,255,255,0.8)", marginTop: "0.625rem" }}>{subtitle}</div>}

      <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", margin: "2.5rem 0 3rem", maxWidth: "40rem" }}>
        <div style={{ flex: 1, height: "0.5rem", borderRadius: 999, background: "rgba(255,255,255,0.2)", overflow: "hidden" }}>
          <div style={{ width: `${ratio * 100}%`, height: "100%", background: "var(--accent)" }} />
        </div>
        <span style={{ fontSize: TV_TEXT, color: "rgba(255,255,255,0.75)", whiteSpace: "nowrap" }}>{formatPlaybackTime(remaining)} left</span>
      </div>

      <div style={{ display: "flex", gap: "1.25rem" }}>
        <TvButton id={RESUME_ID} label={`Resume from ${formatPlaybackTime(resumeFrom.positionSeconds)}`} icon={Play} variant="primary" onSelect={onResume} />
        <TvButton id={START_OVER_ID} label="Start Over" icon={RotateCcw} onSelect={onStartOver} />
      </div>
    </>
  );
}

function PlaybackError({ title, message, onRetry, onBack }: { title?: string; message: string; onRetry: () => void; onBack: () => void }): JSX.Element {
  useTwoButtonGraph(ERROR_SCOPE, RETRY_ID, ERROR_BACK_ID, onRetry, onBack);
  return (
    <PlayerMessage>
      <div role="alert">
        <TriangleAlert size="3.5rem" strokeWidth={1.75} color="#ffb347" />
        <h1 style={{ fontSize: "3rem", fontWeight: 800, color: "#fff", margin: "1.25rem 0 0.75rem" }}>Can't play {title ? `“${title}”` : "this"}</h1>
        <p style={{ fontSize: "1.625rem", color: "rgba(255,255,255,0.8)", margin: "0 0 3rem", lineHeight: 1.45, maxWidth: "52rem" }}>{message}</p>
        <div style={{ display: "flex", gap: "1.25rem" }}>
          <TvButton id={RETRY_ID} label="Try Again" icon={RotateCcw} variant="primary" onSelect={onRetry} />
          <TvButton id={ERROR_BACK_ID} label="Back" icon={ArrowLeft} onSelect={onBack} />
        </div>
      </div>
    </PlayerMessage>
  );
}
