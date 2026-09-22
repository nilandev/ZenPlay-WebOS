import { useCallback, useEffect, useRef, useState } from "react";
import type { PlatformId } from "@core";
import type { AudioTrackInfo, PlaybackProgress, PlayerEngine, SubtitleTrackInfo } from "@player";
import { PlaybackControls, VideoSurface, useRemoteInput } from "@ui";
import { upsertContinueWatching } from "../profile-store.js";

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
  /** Live TV playback: hides the scrubbable seek bar and shows a "LIVE" badge instead — see PlaybackControls' isLive prop. */
  isLive?: boolean;
}

/** How often a timeupdate tick is allowed to write to localStorage — timeupdate fires several times a second, far more often than resume position needs to be durable. */
const PROGRESS_WRITE_INTERVAL_MS = 5000;

/** Controls fade out after this long without any D-pad/remote activity — matches Netflix/YouTube TV conventions for an unobtrusive overlay. */
const AUTO_HIDE_MS = 5000;

/**
 * Fullscreen playback overlay for VOD/series/catch-up streams, dismissed
 * with back. Renders a Netflix-style D-pad-driven control overlay — a top
 * bar (back + title/episode) and a bottom bar (play/pause, scrubbable
 * progress row, audio & subtitles) — on top of the video, auto-hiding after
 * inactivity. No on-screen volume control: TV playback relies on the
 * device's own hardware volume, not an app-level one (see
 * PlaybackControls.tsx's doc comment).
 */
export function PlayerScreen({ streamUrl, platform, onClose, identity, title, subtitle, onNextEpisode, isLive }: PlayerScreenProps): JSX.Element {
  const lastWriteRef = useRef(0);
  const engineRef = useRef<PlayerEngine | null>(null);

  const [isPlaying, setIsPlaying] = useState(true);
  const [positionSeconds, setPositionSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(NaN);
  const [audioTracks, setAudioTracks] = useState<AudioTrackInfo[]>([]);
  const [activeAudioTrackId, setActiveAudioTrackId] = useState<number | null>(null);
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrackInfo[]>([]);
  const [activeSubtitleTrackId, setActiveSubtitleTrackId] = useState<number | null>(null);
  const [areControlsVisible, setAreControlsVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showControls = useCallback(() => {
    setAreControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setAreControlsVisible(false), AUTO_HIDE_MS);
  }, []);

  useEffect(() => {
    showControls();
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [showControls]);

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
      if (didEnd && onNextEpisode) onNextEpisode();
    },
    [onNextEpisode],
  );

  // A fresh stream (channel/episode change) starts with no known tracks
  // until the new engine reports in via onEngineReady — reset here so the
  // Audio & Subtitles menu doesn't briefly show the previous stream's tracks.
  useEffect(() => {
    setActiveAudioTrackId(null);
    setActiveSubtitleTrackId(null);
    setDurationSeconds(NaN);
    setPositionSeconds(0);
  }, [streamUrl]);

  useRemoteInput(platform, {
    onBack: onClose,
    onPlayPause: () => {
      showControls();
      togglePlayPause();
    },
  });

  // Any D-pad press at all counts as activity, even when it lands on the
  // page underneath a hidden overlay (e.g. the first press that's meant to
  // just bring the controls back) — a plain document-level listener here is
  // simpler than threading "activity" through every possible input path,
  // and harmless since it only ever resets a visibility timer.
  useEffect(() => {
    function onAnyKeyDown(): void {
      showControls();
    }
    document.addEventListener("keydown", onAnyKeyDown);
    return () => document.removeEventListener("keydown", onAnyKeyDown);
  }, [showControls]);

  function togglePlayPause(): void {
    const engine = engineRef.current;
    if (!engine) return;
    if (isPlaying) engine.pause();
    else void engine.play();
  }

  function seekBy(deltaSeconds: number): void {
    const engine = engineRef.current;
    if (!engine || !Number.isFinite(durationSeconds)) return;
    const next = Math.min(durationSeconds, Math.max(0, positionSeconds + deltaSeconds));
    engine.seekTo(next);
    setPositionSeconds(next);
  }

  function seekTo(seconds: number): void {
    const engine = engineRef.current;
    if (!engine || !Number.isFinite(durationSeconds)) return;
    const next = Math.min(durationSeconds, Math.max(0, seconds));
    engine.seekTo(next);
    setPositionSeconds(next);
  }

  function selectAudioTrack(id: number): void {
    engineRef.current?.setAudioTrack(id);
    setActiveAudioTrackId(id);
  }

  function selectSubtitleTrack(id: number | null): void {
    engineRef.current?.setSubtitleTrack(id);
    setActiveSubtitleTrackId(id);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 50 }}>
      <VideoSurface
        streamUrl={streamUrl}
        onProgress={handleProgress}
        onEngineReady={handleEngineReady}
        onPlayStateChange={handlePlayStateChange}
      />
      <div
        style={{
          opacity: areControlsVisible ? 1 : 0,
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
          audioTracks={audioTracks}
          activeAudioTrackId={activeAudioTrackId}
          subtitleTracks={subtitleTracks}
          activeSubtitleTrackId={activeSubtitleTrackId}
          hasNextEpisode={Boolean(onNextEpisode)}
          onBack={onClose}
          onTogglePlayPause={togglePlayPause}
          onSeekBy={seekBy}
          onSeekTo={seekTo}
          onSelectAudioTrack={selectAudioTrack}
          onSelectSubtitleTrack={selectSubtitleTrack}
          onNextEpisode={() => onNextEpisode?.()}
          onActivity={showControls}
        />
      </div>
    </div>
  );
}
