export interface AudioTrackInfo {
  id: number;
  label: string;
  language?: string;
}

export interface PlayerStats {
  bitrateBps: number | null;
  droppedFrames: number;
  bufferSeconds: number;
}

export type PlayerErrorKind = "network" | "media" | "manifest" | "unknown";

export interface PlayerError {
  kind: PlayerErrorKind;
  fatal: boolean;
  message: string;
  raw?: unknown;
}

/**
 * Common playback interface every platform-specific engine implements
 * (web engine backed by hls.js/shaka, or a native ExoPlayer bridge on
 * Android TV via Capacitor). UI code depends only on this interface so it
 * never branches on platform.
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

  getStats(): PlayerStats;

  onError(callback: (error: PlayerError) => void): () => void;
}
