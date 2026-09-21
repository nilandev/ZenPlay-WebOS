export interface AudioTrackInfo {
  id: number;
  label: string;
  language?: string;
}

export interface SubtitleTrackInfo {
  id: number;
  label: string;
  language?: string;
}

export interface PlayerStats {
  bitrateBps: number | null;
  droppedFrames: number;
  bufferSeconds: number;
}

export interface PlaybackProgress {
  positionSeconds: number;
  /** NaN for a live stream with no known length — callers should treat that as "don't persist progress". */
  durationSeconds: number;
}

export type PlayerErrorKind = "network" | "media" | "manifest" | "unknown";

export interface PlayerError {
  kind: PlayerErrorKind;
  fatal: boolean;
  message: string;
  raw?: unknown;
}

/**
 * Common playback interface every engine implementation satisfies
 * (currently just the hls.js-backed one). UI code depends only on this
 * interface so it never branches on platform.
 */
export interface PlayerEngine {
  attach(videoElement: HTMLVideoElement): void;
  load(streamUrl: string): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seekTo(seconds: number): void;
  destroy(): void;

  getAudioTracks(): AudioTrackInfo[];
  setAudioTrack(id: number): void;

  /** Empty when the current stream carries no text tracks, or on a direct-play file whose container the browser doesn't expose sidecar tracks for. */
  getSubtitleTracks(): SubtitleTrackInfo[];
  /** null disables subtitles entirely. */
  setSubtitleTrack(id: number | null): void;

  /** 0–1. Independent of setMuted — a provider-remembered volume level survives an unmute. */
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;

  getStats(): PlayerStats;

  onError(callback: (error: PlayerError) => void): () => void;
  /** Fires on the underlying media element's native timeupdate — used to persist resume position for VOD/series (see profile-store's upsertContinueWatching). */
  onTimeUpdate(callback: (progress: PlaybackProgress) => void): () => void;
}
