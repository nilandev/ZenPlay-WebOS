import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveDigitKey, resolveRemoteAction, type Channel, type PlatformId, type PlaylistSource, type SeriesEpisode } from "@core";
import type { AudioTrackInfo, PlaybackProgress, PlayerEngine, PlayerError, SubtitleTrackInfo } from "@player";
import {
  BROWSE_SIDE_PADDING,
  NEXT_EPISODE_WINDOW_SECONDS,
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
  hasParkedVideo,
} from "@ui";
import { ArrowLeft, Play, RotateCcw, TriangleAlert, VolumeX } from "lucide-react";
import { isFavorite, toggleFavorite, upsertContinueWatching, type ResumePoint } from "../profile-store.js";
import { loadSettings } from "../settings-store.js";
import { alternateLiveStream, LIVE_STREAM_FORMAT_LABELS, rememberWorkingLiveStreamFormat } from "../live-stream-url.js";
import { liveStreamFormatOf, withLiveStreamFormat, type LiveStreamFormat } from "@core";
import { useFavoritesRevision } from "../use-favorites-revision.js";
import type { ChannelLineup } from "../channel-lineup.js";
import { useNowNext } from "../use-now-next.js";
import { subscribeTvMute } from "../tv-audio.js";
import { useWatchHistoryRecorder, type WatchTarget } from "../use-watch-history-recorder.js";
import { PlayerEpisodesPanel } from "./PlayerEpisodesPanel.js";
import { ChannelBanner, ChannelNumberEntry, NextUpCard, PausedInfoOverlay, PlayerLoadingScreen, type PlaybackInfo } from "./PlayerOverlays.js";

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
  /** The episode onNextEpisode plays — shown on the end-of-episode countdown card. */
  upNextEpisode?: SeriesEpisode | null;
  /** Live TV playback: no seek bar or scrubbing; the channel number and what's on now instead — see PlaybackControls' isLive prop. */
  isLive?: boolean;
  /** Live TV: the channel playing, and the source to read its guide from, for "On Now". */
  liveChannel?: Channel;
  guideSource?: PlaylistSource | null;
  /** Live TV: the channels CH+/CH− and number keys can move to. */
  channelLineup?: ChannelLineup | null;
  /** Live TV: switch the player to another channel. */
  onTuneChannel?: (channel: Channel) => void;
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
  /** What's playing, for Recently Watched (omitted for catch-up). */
  watchTarget?: WatchTarget;
  /**
   * Live TV: the playlist the channel belongs to. On the Auto live stream
   * format, the format a channel starts in is remembered for it (see
   * live-stream-url.ts), so the next channel starts in it too.
   */
  liveSourceId?: string;
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

/** Auto live format: a channel that hasn't started after this long is tried in the other format (HLS ↔ MPEG-TS). */
const FORMAT_SWITCH_AFTER_MS = 12_000;

/** A live channel that was playing and stalls this long is reconnected (in the same format)… */
const LIVE_RECONNECT_STALL_MS = 15_000;
/** …up to this many times in a row before the error is shown. */
const MAX_LIVE_RECONNECTS = 2;
/** Playing this long since the last reconnect makes the next drop a fresh one, with its reconnects available again. */
const RECONNECT_RESET_MS = 60_000;

/** How long the channel banner stays up after changing channel. */
const CHANNEL_BANNER_MS = 5000;

/** Typed channel digits are tuned this long after the last one (or at once on OK / the 4th digit). */
const CHANNEL_ENTRY_MS = 1500;

/** "No channel 105" stays up this long. */
const CHANNEL_NOT_FOUND_MS = 2000;

/** Paused this long, the picture dims and "You're watching" takes over (Netflix's timing is similar). */
const PAUSED_INFO_DELAY_MS = 10_000;

type Panel = "none" | "menu" | "episodes" | "next-up";

/** The next-episode card appears with this much of the episode left… */
const NEXT_UP_REMAINING_SECONDS = 30;
/** …and counts down this long before playing it. */
const NEXT_UP_COUNTDOWN_SECONDS = 10;

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
 * - Mute toggles the player's sound (kept across episodes and channels),
 *   on TVs that pass the key to the app; on those that mute themselves, the
 *   TV's mute state is followed instead (see tv-audio.ts). Either shows "Muted".
 * - Back closes an open panel (Audio & Subtitles, Episodes) first, then the player.
 * - Series: Up from the seek bar (or the Episodes button) opens the Episodes panel.
 * - Live TV: CH+/CH− step through the lineup the viewer came from; number
 *   keys tune by channel number. Either shows a channel banner (instead of
 *   the full loading screen, which is only for the first channel).
 *
 * Until the stream starts, a loading screen (artwork, title) covers the
 * black video. After PAUSED_INFO_DELAY_MS paused, "You're watching" dims
 * the picture; any key brings the controls back, OK also resumes.
 *
 * Before playback it may ask Resume / Start Over; if the stream fails (an
 * engine error, or buffering for STALL_TIMEOUT_MS) it shows an error with
 * Try Again, which reloads from where playback got to.
 *
 * Xtream live channels come as HLS or MPEG-TS. On the Auto format setting,
 * a channel that fails before its first frame is quietly tried in the
 * other format behind the loading screen, and the error only shows if that
 * fails too. A channel that drops after it was playing is reconnected in
 * the same format (MAX_LIVE_RECONNECTS times) — a drop mid-stream is
 * usually the network, not the format. The Audio & Subtitles menu also
 * lets the viewer switch format by hand.
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
  upNextEpisode,
  isLive = false,
  liveSourceId,
  liveChannel,
  guideSource,
  channelLineup,
  onTuneChannel,
  resumeFrom,
  autoResume = false,
  info,
  episodes,
  currentEpisodeId,
  onPlayEpisode,
  watchTarget,
  engineFactory,
}: PlayerScreenProps): JSX.Element {
  const lastWriteRef = useRef(0);
  const engineRef = useRef<PlayerEngine | null>(null);

  // Where focus was on the screen underneath when the player opened —
  // handed back on close, so the viewer lands on the card they played
  // instead of on nothing (the player's own elements are gone by then).
  const [focusBeforePlayer] = useState(() => useFocusStore.getState().focusedId);
  useEffect(
    () => () => {
      setTimeout(() => {
        const { focusedId, nodes, focus } = useFocusStore.getState();
        if (focusBeforePlayer && (!focusedId || !nodes[focusedId])) focus(focusBeforePlayer);
      }, 0);
    },
    [focusBeforePlayer],
  );

  // Both are keyed by stream URL, so Next Episode (a new URL, same mounted
  // player) asks again and never inherits the previous episode's start.
  const [resumeAnsweredFor, setResumeAnsweredFor] = useState<string | null>(null);
  const [startAt, setStartAt] = useState<{ streamUrl: string; seconds: number } | null>(null);
  const isChoosingResume = Boolean(resumeFrom) && !autoResume && resumeAnsweredFor !== streamUrl;
  const startPositionSeconds =
    startAt?.streamUrl === streamUrl ? startAt.seconds : autoResume && resumeFrom ? resumeFrom.positionSeconds : undefined;
  const [attempt, setAttempt] = useState(0);
  // An Xtream live channel playing in the other format than it was opened
  // in (Auto's fallback, or the viewer's pick) — tied to the URL it
  // replaces, so a channel change drops it.
  const [formatSwitch, setFormatSwitch] = useState<{ from: string; url: string } | null>(null);
  const activeUrl = formatSwitch?.from === streamUrl ? formatSwitch.url : streamUrl;
  const currentFormat = liveStreamFormatOf(activeUrl);
  // App Settings → Playback, read for each stream (and each retry) so a change applies to the next thing played.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const playbackPrefs = useMemo(() => loadSettings(), [streamUrl, attempt]);
  // Auto may switch format once per channel open (a manual pick counts as the switch).
  const autoAlternate =
    isLive && playbackPrefs.liveStreamFormat === "auto" && formatSwitch?.from !== streamUrl ? alternateLiveStream(activeUrl) : undefined;
  const [failure, setFailure] = useState<PlaybackFailure | null>(null);
  // The URL that has shown a frame since this channel opened: a failure
  // before that is a startup failure (try the other format), after it a
  // drop (reconnect in the same one).
  const startedUrlRef = useRef<string | null>(null);
  const reconnectsRef = useRef({ count: 0, lastAt: 0 });

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
  // A channel handed over from Live TV's preview is already playing — no loading screen, not even for a frame.
  const [hasStarted, setHasStarted] = useState(() => hasParkedVideo(streamUrl));
  const [isMuted, setIsMuted] = useState(false);
  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;
  // The TV's own mute (its Mute key usually never reaches the app) — shown with the same badge.
  const [isTvMuted, setIsTvMuted] = useState(false);
  useEffect(() => subscribeTvMute(setIsTvMuted), []);
  const [isPausedInfoShown, setIsPausedInfoShown] = useState(false);
  const [pausedInfoCycle, setPausedInfoCycle] = useState(0);
  const sawBufferingRef = useRef(false);

  const { nowNext } = useNowNext(guideSource ?? null, isLive ? (liveChannel ?? null) : null);
  // Live TV's "You're watching" describes the programme on now, from the guide.
  const pausedSubtitle = isLive && nowNext?.now ? `On Now: ${nowNext.now.title}` : subtitle;
  const pausedInfo = isLive && nowNext?.now ? { ...info, plot: nowNext.now.description ?? info?.plot } : info;

  // Channel changes after the first one show a banner, not the full loading screen.
  const [hasEverStarted, setHasEverStarted] = useState(false);
  useEffect(() => {
    if (hasStarted) setHasEverStarted(true);
  }, [hasStarted]);
  const isChangingChannel = isLive && hasEverStarted;

  const [isBannerShown, setIsBannerShown] = useState(false);
  const previousChannelIdRef = useRef(liveChannel?.id);
  useEffect(() => {
    const id = liveChannel?.id;
    if (id === previousChannelIdRef.current) return;
    previousChannelIdRef.current = id;
    if (!id) return;
    setIsBannerShown(true);
    const timer = setTimeout(() => setIsBannerShown(false), CHANNEL_BANNER_MS);
    return () => clearTimeout(timer);
  }, [liveChannel?.id]);

  const [typedDigits, setTypedDigits] = useState("");
  const [isNumberNotFound, setIsNumberNotFound] = useState(false);
  const typedDigitsRef = useRef("");
  const numberEntryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The key handler is registered once; it reads the latest channel props through this.
  const liveRef = useRef({ liveChannel, channelLineup, onTuneChannel });
  liveRef.current = { liveChannel, channelLineup, onTuneChannel };

  useWatchHistoryRecorder(watchTarget, { hasStarted, isPlaying, positionSeconds, durationSeconds });

  // "My List" in the controls: the channel, film or series that's playing
  // (a series is saved as a whole, as on its page). The revision re-reads
  // it after any change, here or elsewhere.
  const favoritesRevision = useFavoritesRevision();
  const myListItem = watchTarget
    ? { profileId: watchTarget.profileId, sourceId: watchTarget.sourceId, kind: watchTarget.kind, contentId: watchTarget.contentId }
    : null;
  const isInMyList = useMemo(
    () => (myListItem ? isFavorite(myListItem.profileId, myListItem.sourceId, myListItem.kind, myListItem.contentId) : false),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [myListItem?.profileId, myListItem?.sourceId, myListItem?.kind, myListItem?.contentId, favoritesRevision],
  );
  const myList = myListItem
    ? {
        isAdded: isInMyList,
        onToggle: () => {
          toggleFavorite(myListItem.profileId, myListItem.sourceId, myListItem.kind, myListItem.contentId);
          showControls();
        },
      }
    : undefined;

  // End-of-episode countdown card: shown once per episode in its last
  // NEXT_UP_REMAINING_SECONDS, unless the viewer chose Watch Credits.
  const [nextUpDismissedFor, setNextUpDismissedFor] = useState<string | null>(null);
  const remainingSeconds = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds - positionSeconds : Infinity;
  const isNextUpDue =
    Boolean(upNextEpisode && onNextEpisode) &&
    hasStarted &&
    failure === null &&
    remainingSeconds <= NEXT_UP_REMAINING_SECONDS &&
    pendingSeekSeconds === null &&
    nextUpDismissedFor !== streamUrl;
  useEffect(() => {
    if (!isNextUpDue || panelRef.current !== "none") return; // don't pull the viewer out of a menu
    setReturnFocusId(useFocusStore.getState().focusedId);
    setPanel("next-up");
    // The card sits on the controls, which stay up while it's open (the hide timer skips an open panel); it takes focus on Play Now.
    showControls();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNextUpDue]);

  // The controls' Next Episode button: when it appears, bring the controls
  // up so it's seen (PlaybackControls focuses it).
  const isNextEpisodeButtonDue = Boolean(onNextEpisode) && hasStarted && remainingSeconds <= NEXT_EPISODE_WINDOW_SECONDS;
  useEffect(() => {
    if (isNextEpisodeButtonDue) showControls();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNextEpisodeButtonDue]);

  function closeNextUp(): void {
    setNextUpDismissedFor(streamUrl);
    setPanel("none");
    showControls();
  }

  function playNextNow(): void {
    setNextUpDismissedFor(streamUrl);
    setPanel("none");
    onNextEpisode?.();
  }

  const isMenuOpen = panel === "menu";
  const isShowingVideo = !isChoosingResume && failure === null;
  const hasEpisodes = Boolean(onPlayEpisode && episodes && episodes.length > 1);

  // Mirrors of state for the key handler and timers, which live outside React's render cycle.
  const isPanelOpen = panel !== "none";
  const panelRef = useRef(panel);
  panelRef.current = panel;
  const stateRef = useRef({ isPlaying, isPanelOpen, areControlsVisible, positionSeconds, durationSeconds, pendingSeekSeconds, isShowingVideo, isPausedInfoShown, hasEpisodes });
  stateRef.current = { isPlaying, isPanelOpen, areControlsVisible, positionSeconds, durationSeconds, pendingSeekSeconds, isShowingVideo, isPausedInfoShown, hasEpisodes };
  const streamRef = useRef({ activeUrl, autoAlternate, isAutoFormat: playbackPrefs.liveStreamFormat === "auto", liveSourceId });
  streamRef.current = { activeUrl, autoAlternate, isAutoFormat: playbackPrefs.liveStreamFormat === "auto", liveSourceId };

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
    // Each stream (episode, channel, reconnect) gets a fresh engine — carry the viewer's mute over.
    if (isMutedRef.current) engine.setMuted(true);
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

  /** A fresh engine on the current (or a switched-to) URL, behind the loading screen or banner. */
  const reloadStream = useCallback(() => {
    clearStallTimer();
    setFailure(null);
    setHasStarted(false);
    sawBufferingRef.current = false;
    setAttempt((n) => n + 1);
  }, [clearStallTimer]);

  /**
   * A fatal error or a stall. Live channels get two chances before the
   * error shows: before the first frame, Auto tries the other format; after
   * it, the same stream is reconnected a couple of times.
   */
  const handleFailure = useCallback(
    (failed: PlaybackFailure) => {
      clearStallTimer();
      const { activeUrl: url, autoAlternate: alternate } = streamRef.current;
      const hasPlayed = startedUrlRef.current === url;
      if (!hasPlayed && alternate) {
        setFormatSwitch({ from: streamUrl, url: alternate.url });
        reloadStream();
        return;
      }
      if (hasPlayed && isLive) {
        const reconnects = reconnectsRef.current;
        const now = Date.now();
        if (now - reconnects.lastAt > RECONNECT_RESET_MS) reconnects.count = 0;
        if (reconnects.count < MAX_LIVE_RECONNECTS) {
          reconnects.count += 1;
          reconnects.lastAt = now;
          reloadStream();
          return;
        }
      }
      setFailure(failed);
    },
    [clearStallTimer, reloadStream, streamUrl, isLive],
  );
  const handleFailureRef = useRef(handleFailure);
  handleFailureRef.current = handleFailure;

  // Stable identity: VideoSurface reloads the stream when onError changes.
  const handleError = useCallback((error: PlayerError) => {
    if (!error.fatal) return; // the engine is recovering; buffering covers it
    handleFailureRef.current({ kind: error.kind });
  }, []);

  const markStarted = useCallback(() => {
    setHasStarted(true);
    // A live channel that starts on Auto: remember its format for the playlist, so the next channel starts in it.
    const { activeUrl: url, isAutoFormat, liveSourceId: sourceId } = streamRef.current;
    startedUrlRef.current = url;
    const format = liveStreamFormatOf(url);
    if (isLive && isAutoFormat && format && sourceId) rememberWorkingLiveStreamFormat(sourceId, format);
  }, [isLive]);

  const handleBufferingChange = useCallback(
    (isBuffering: boolean) => {
      clearStallTimer();
      if (isBuffering) {
        sawBufferingRef.current = true;
        // A channel not yet started is given less time when Auto has another format to try; a dropped one is reconnected sooner.
        const { activeUrl: url, autoAlternate: alternate } = streamRef.current;
        const hasPlayed = startedUrlRef.current === url;
        const timeout = !hasPlayed && alternate ? FORMAT_SWITCH_AFTER_MS : hasPlayed && isLive ? LIVE_RECONNECT_STALL_MS : STALL_TIMEOUT_MS;
        stallTimerRef.current = setTimeout(() => handleFailureRef.current({ kind: "network", stalled: true }), timeout);
      } else if (sawBufferingRef.current) {
        markStarted(); // the first load finished — the stream is playing
      }
    },
    [clearStallTimer, markStarted],
  );

  // Adopted from Live TV's preview: it's already playing, so it has started.
  const handleStreamAdopted = useCallback(() => {
    clearStallTimer();
    markStarted();
  }, [clearStallTimer, markStarted]);

  /** Stream Format in the menu: the same channel in the chosen format, now. */
  function selectStreamFormat(format: LiveStreamFormat): void {
    setPanel("none");
    if (format === currentFormat) return;
    const url = withLiveStreamFormat(streamUrl, format);
    if (!url) return;
    setFormatSwitch(url === streamUrl ? null : { from: streamUrl, url });
    reloadStream();
    showControls();
  }

  // A fresh stream (channel/episode change) starts with no known tracks
  // until the new engine reports in — reset so the Audio & Subtitles panel
  // doesn't briefly show the previous stream's tracks. Only on an actual
  // change: on mount everything is already fresh, and a reset there would
  // run after (and undo) VideoSurface adopting an already-playing stream.
  const resetForUrlRef = useRef(streamUrl);
  useEffect(() => {
    if (resetForUrlRef.current === streamUrl) return;
    resetForUrlRef.current = streamUrl;
    setActiveAudioTrackId(null);
    setActiveSubtitleTrackId(null);
    setDurationSeconds(NaN);
    setPositionSeconds(0);
    setPendingSeekSeconds(null);
    setFailure(null);
    setPanel("none");
    setHasStarted(false);
    sawBufferingRef.current = false;
    startedUrlRef.current = null;
    reconnectsRef.current = { count: 0, lastAt: 0 };
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
    // A fresh start: the channel's first format again, with Auto's switch and the reconnects available.
    setFormatSwitch(null);
    startedUrlRef.current = null;
    reconnectsRef.current = { count: 0, lastAt: 0 };
    reloadStream();
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

  /** CH+ / CH−: the next or previous channel in the lineup, wrapping around. */
  function changeChannel(step: 1 | -1): void {
    const { liveChannel: current, channelLineup: channels, onTuneChannel: tune } = liveRef.current;
    const lineup = channels?.lineup ?? [];
    if (!isLive || !tune || lineup.length === 0) return;
    const index = lineup.findIndex((c) => c.id === current?.id);
    const next = index < 0 ? lineup[step > 0 ? 0 : lineup.length - 1] : lineup[(index + step + lineup.length) % lineup.length];
    if (next && next.id !== current?.id) tune(next);
  }

  function clearNumberEntry(): void {
    if (numberEntryTimerRef.current) clearTimeout(numberEntryTimerRef.current);
    numberEntryTimerRef.current = null;
    typedDigitsRef.current = "";
    setTypedDigits("");
    setIsNumberNotFound(false);
  }

  function tuneTypedNumber(): void {
    const digits = typedDigitsRef.current;
    if (numberEntryTimerRef.current) clearTimeout(numberEntryTimerRef.current);
    if (!digits) return;
    const { liveChannel: current, channelLineup: channels, onTuneChannel: tune } = liveRef.current;
    const wanted = Number(digits);
    const match = channels?.directory.find((c) => c.number === wanted) ?? channels?.lineup.find((c) => c.number === wanted);
    if (!match) {
      setIsNumberNotFound(true);
      numberEntryTimerRef.current = setTimeout(clearNumberEntry, CHANNEL_NOT_FOUND_MS);
      return;
    }
    clearNumberEntry();
    if (match.id !== current?.id) tune?.(match);
  }

  function typeDigit(digit: number): void {
    // Starting again after "No channel …" begins a fresh number.
    const base = isNumberNotFoundRef.current ? "" : typedDigitsRef.current;
    const digits = (base + String(digit)).replace(/^0+(?=\d)/, "").slice(0, 4);
    typedDigitsRef.current = digits;
    setTypedDigits(digits);
    setIsNumberNotFound(false);
    if (numberEntryTimerRef.current) clearTimeout(numberEntryTimerRef.current);
    if (digits.length >= 4) tuneTypedNumber();
    else numberEntryTimerRef.current = setTimeout(tuneTypedNumber, CHANNEL_ENTRY_MS);
  }
  const isNumberNotFoundRef = useRef(isNumberNotFound);
  isNumberNotFoundRef.current = isNumberNotFound;

  useEffect(
    () => () => {
      if (numberEntryTimerRef.current) clearTimeout(numberEntryTimerRef.current);
    },
    [],
  );

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

  function toggleMute(): void {
    const muted = !isMutedRef.current;
    isMutedRef.current = muted; // a quick double press can outrun the re-render
    setIsMuted(muted);
    engineRef.current?.setMuted(muted);
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

      // Live TV number keys (checked first: digits aren't a remote "action").
      if (isLive && showing && !panelOpen) {
        const digit = resolveDigitKey(event);
        if (digit !== null) {
          event.preventDefault();
          event.stopPropagation();
          typeDigit(digit);
          return;
        }
        if (typedDigitsRef.current && (action === "select" || action === "back")) {
          // OK tunes the number now; Back abandons it.
          event.preventDefault();
          event.stopPropagation();
          if (action === "select") {
            swallowNextKeyUp();
            tuneTypedNumber();
          } else clearNumberEntry();
          return;
        }
      }
      // CH+/CH− and Mute are handled below (useRemoteInput) without waking the controls.
      if (action === "channel-up" || action === "channel-down" || action === "mute") return;

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
      if (panelRef.current === "next-up") closeNextUp();
      else if (stateRef.current.isPanelOpen) setPanel("none");
      else onClose();
    },
    onPlayPause: togglePlayPause,
    onPlay: play,
    onPause: pause,
    onStop: onClose,
    onChannelUp: () => changeChannel(1),
    onChannelDown: () => changeChannel(-1),
    onRewind: () => scrubFromMediaKey(-1),
    onFastForward: () => scrubFromMediaKey(1),
    onMute: toggleMute,
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
          streamUrl={activeUrl}
          engineFactory={engineFactory}
          startPositionSeconds={startPositionSeconds}
          playbackRate={isLive ? 1 : playbackPrefs.playbackSpeed}
          onProgress={handleProgress}
          onEngineReady={handleEngineReady}
          onPlayStateChange={handlePlayStateChange}
          onError={handleError}
          onBufferingChange={handleBufferingChange}
          onStreamAdopted={handleStreamAdopted}
        />
      )}
      {failure === null && (
        <PlayerLoadingScreen title={title} subtitle={subtitle} info={info} isLive={isLive} isVisible={!hasStarted && !isChangingChannel} />
      )}
      {failure === null && isBannerShown && liveChannel && <ChannelBanner channel={liveChannel} programme={nowNext?.now} />}
      {failure === null && (isMuted || isTvMuted) && <MutedBadge />}
      {typedDigits && <ChannelNumberEntry digits={typedDigits} notFound={isNumberNotFound} />}
      {failure === null && isPausedInfoShown && <PausedInfoOverlay title={title} subtitle={pausedSubtitle} info={pausedInfo} />}
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
            channelNumber={liveChannel?.number}
            nowNext={isLive ? nowNext : null}
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
            aboveControls={
              panel === "next-up" && upNextEpisode ? (
                <NextUpCard episode={upNextEpisode} seconds={NEXT_UP_COUNTDOWN_SECONDS} isPlaying={isPlaying} onPlayNow={playNextNow} onWatchCredits={closeNextUp} />
              ) : undefined
            }
            onOpenMenu={() => openPanel("menu")}
            onOpenEpisodes={hasEpisodes ? () => openPanel("episodes") : undefined}
            myList={myList}
            onTogglePlayPause={togglePlayPause}
            onSelectAudioTrack={selectAudioTrack}
            onSelectSubtitleTrack={selectSubtitleTrack}
            onNextEpisode={() => onNextEpisode?.()}
            streamFormat={
              isLive && currentFormat
                ? {
                    options: (["m3u8", "ts"] as const).map((format) => ({ id: format, label: LIVE_STREAM_FORMAT_LABELS[format] })),
                    activeId: currentFormat,
                    onSelect: (id) => selectStreamFormat(id as LiveStreamFormat),
                  }
                : undefined
            }
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
        <PlaybackError
          title={title}
          message={describeFailure(failure, isLive)}
          hint={isLive && currentFormat && playbackPrefs.liveStreamFormat !== "auto" ? LIVE_FORMAT_HINT : undefined}
          onRetry={retry}
          onBack={onClose}
        />
      )}
    </div>
  );
}

/** Top-right reminder that the player's sound is off (Mute on the remote). */
function MutedBadge(): JSX.Element {
  return (
    <div
      role="status"
      aria-label="Muted"
      style={{
        position: "absolute",
        top: "3rem",
        right: BROWSE_SIDE_PADDING,
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        gap: "0.625rem",
        padding: "0.75rem 1.25rem",
        borderRadius: 999,
        background: "rgba(10,11,15,0.8)",
        color: "#fff",
        fontSize: TV_TEXT,
        fontWeight: 600,
      }}
    >
      <VolumeX size="1.75rem" />
      Muted
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

/** Shown under a live channel's error when the format is fixed in App Settings — Auto would have tried the other one. */
const LIVE_FORMAT_HINT = "Your Live Stream Format is fixed in App Settings. Set it to Auto to try the other format automatically.";

/** A failed stream: Try Again (focused) or Back. */
function PlaybackError({
  title,
  message,
  hint,
  onRetry,
  onBack,
}: {
  title?: string;
  message: string;
  hint?: string;
  onRetry: () => void;
  onBack: () => void;
}): JSX.Element {
  useTwoButtonGraph(ERROR_SCOPE, RETRY_ID, ERROR_BACK_ID, onRetry, onBack);

  return (
    <PlayerMessage>
      <div role="alert">
        <TriangleAlert size="3.5rem" strokeWidth={1.75} color="#ffb347" />
        <h1 style={{ fontSize: "3rem", fontWeight: 800, color: "#fff", margin: "1.25rem 0 0.75rem" }}>Can't play {title ? `“${title}”` : "this"}</h1>
        <p style={{ fontSize: "1.625rem", color: "rgba(255,255,255,0.8)", margin: "0 0 1rem", lineHeight: 1.45, maxWidth: "52rem" }}>{message}</p>
        {hint && <p style={{ fontSize: "1.375rem", color: "rgba(255,255,255,0.65)", margin: "0 0 1rem", lineHeight: 1.45, maxWidth: "52rem" }}>{hint}</p>}
        <div style={{ display: "flex", gap: "1.25rem", marginTop: "2rem" }}>
          <TvButton id={RETRY_ID} label="Try Again" icon={RotateCcw} variant="primary" onSelect={onRetry} />
          <TvButton id={ERROR_BACK_ID} label="Back" icon={ArrowLeft} onSelect={onBack} />
        </div>
      </div>
    </PlayerMessage>
  );
}
