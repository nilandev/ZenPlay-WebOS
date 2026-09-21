import Hls, { ErrorData, Events, type HlsConfig } from "hls.js";
import type {
  AudioTrackInfo,
  PlaybackProgress,
  PlayerEngine,
  PlayerError,
  PlayerStats,
  SubtitleTrackInfo,
} from "./player-engine.js";

/**
 * hls.js-backed engine used on webOS TV's Chromium-based runtime. Tuned
 * defaults account for how permissive real IPTV provider streams need to
 * be (irregular segment timing, non-strict manifests) versus hls.js's
 * spec-strict defaults.
 */
const IPTV_TUNED_CONFIG: Partial<HlsConfig> = {
  maxBufferLength: 30,
  maxMaxBufferLength: 60,
  liveSyncDurationCount: 3,
  manifestLoadingMaxRetry: 4,
  levelLoadingMaxRetry: 4,
  fragLoadingMaxRetry: 6,
  enableWorker: true,
};

/**
 * True for an actual HLS manifest URL (live channels and catch-up always
 * are — see XtreamClient.getLiveChannels/buildCatchupUrl, both fixed
 * `.m3u8`), false for a direct-play file (VOD/series streams, whose
 * extension mirrors the provider's own container_extension — mp4/mkv/avi/
 * ts/etc., see xtream-mappers.ts). Query strings/fragments are stripped
 * before checking since a provider occasionally appends `?token=...` after
 * the extension.
 */
function isHlsStream(streamUrl: string): boolean {
  const path = streamUrl.split(/[?#]/)[0];
  return path.toLowerCase().endsWith(".m3u8");
}

export class HlsPlayerEngine implements PlayerEngine {
  private hls: Hls | null = null;
  private video: HTMLVideoElement | null = null;
  private errorCallbacks = new Set<(error: PlayerError) => void>();
  private timeUpdateCallbacks = new Set<(progress: PlaybackProgress) => void>();
  private droppedFrames = 0;
  private handleTimeUpdate = (): void => {
    if (!this.video) return;
    const progress: PlaybackProgress = { positionSeconds: this.video.currentTime, durationSeconds: this.video.duration };
    for (const cb of this.timeUpdateCallbacks) cb(progress);
  };

  attach(videoElement: HTMLVideoElement): void {
    this.video = videoElement;
    this.video.addEventListener("timeupdate", this.handleTimeUpdate);
  }

  async load(streamUrl: string): Promise<void> {
    if (!this.video) throw new Error("HlsPlayerEngine.attach() must be called before load()");

    this.destroyHlsInstance();

    if (!isHlsStream(streamUrl)) {
      // Xtream VOD/series streams aren't always .m3u8 — container_extension
      // can be mp4/mkv/avi/etc. (see XtreamClient's stream URL builder),
      // meaning these are direct-play files, not segmented HLS manifests.
      // Handing one of those to hls.js makes it try to parse raw container
      // bytes as an HLS playlist, which fails fatally (surfaced as a
      // manifest-parsing error) — that's why MKV/MP4 VOD playback broke:
      // every stream was being routed through hls.js unconditionally.
      // The <video> element's own native decoding (Chromium's MSE/demuxer
      // pipeline on webOS) is what actually plays these, same as the
      // Hls.isSupported()-false fallback below already does for HLS itself.
      this.video.src = streamUrl;
      return;
    }

    if (!Hls.isSupported()) {
      // Safari/some WebKit builds support HLS natively via <video src>.
      this.video.src = streamUrl;
      return;
    }

    const hls = new Hls(IPTV_TUNED_CONFIG);
    this.hls = hls;

    hls.on(Events.ERROR, (_event, data: ErrorData) => this.handleHlsError(data));
    hls.loadSource(streamUrl);
    hls.attachMedia(this.video);

    await new Promise<void>((resolve, reject) => {
      const onParsed = () => {
        hls.off(Events.ERROR, onFatalDuringLoad);
        resolve();
      };
      const onFatalDuringLoad = (_event: unknown, data: ErrorData) => {
        if (data.fatal) {
          hls.off(Events.MANIFEST_PARSED, onParsed);
          reject(new Error(`Failed to load stream: ${data.details}`));
        }
      };
      hls.once(Events.MANIFEST_PARSED, onParsed);
      hls.once(Events.ERROR, onFatalDuringLoad);
    });
  }

  async play(): Promise<void> {
    await this.video?.play();
  }

  pause(): void {
    this.video?.pause();
  }

  seekTo(seconds: number): void {
    if (this.video) this.video.currentTime = seconds;
  }

  destroy(): void {
    this.destroyHlsInstance();
    this.video?.removeEventListener("timeupdate", this.handleTimeUpdate);
    this.errorCallbacks.clear();
    this.timeUpdateCallbacks.clear();
    this.video = null;
  }

  getAudioTracks(): AudioTrackInfo[] {
    if (!this.hls) return [];
    return this.hls.audioTracks.map((track) => ({
      id: track.id,
      label: track.name || track.lang || `Track ${track.id}`,
      language: track.lang,
    }));
  }

  setAudioTrack(id: number): void {
    if (this.hls) this.hls.audioTrack = id;
  }

  getSubtitleTracks(): SubtitleTrackInfo[] {
    // hls.js only — a direct-play file (MKV/MP4 VOD, see isHlsStream above)
    // relies on the container's own baked-in tracks, which the <video>
    // element's native <track>/TextTrack API doesn't expose for Xtream's
    // provider streams (no sidecar subtitle files are ever supplied), so
    // there's nothing to list in that case.
    if (!this.hls) return [];
    return this.hls.subtitleTracks.map((track) => ({
      id: track.id,
      label: track.name || track.lang || `Subtitle ${track.id}`,
      language: track.lang,
    }));
  }

  setSubtitleTrack(id: number | null): void {
    if (!this.hls) return;
    this.hls.subtitleTrack = id ?? -1;
  }

  setVolume(volume: number): void {
    if (this.video) this.video.volume = Math.min(1, Math.max(0, volume));
  }

  setMuted(muted: boolean): void {
    if (this.video) this.video.muted = muted;
  }

  getStats(): PlayerStats {
    const bufferedSeconds = this.computeBufferedSeconds();
    const level = this.hls && this.hls.currentLevel >= 0 ? this.hls.levels[this.hls.currentLevel] : undefined;
    return {
      bitrateBps: level?.bitrate ?? null,
      droppedFrames: this.droppedFrames,
      bufferSeconds: bufferedSeconds,
    };
  }

  onError(callback: (error: PlayerError) => void): () => void {
    this.errorCallbacks.add(callback);
    return () => this.errorCallbacks.delete(callback);
  }

  onTimeUpdate(callback: (progress: PlaybackProgress) => void): () => void {
    this.timeUpdateCallbacks.add(callback);
    return () => this.timeUpdateCallbacks.delete(callback);
  }

  private computeBufferedSeconds(): number {
    if (!this.video || this.video.buffered.length === 0) return 0;
    const currentTime = this.video.currentTime;
    for (let i = 0; i < this.video.buffered.length; i++) {
      if (this.video.buffered.start(i) <= currentTime && currentTime <= this.video.buffered.end(i)) {
        return this.video.buffered.end(i) - currentTime;
      }
    }
    return 0;
  }

  private handleHlsError(data: ErrorData): void {
    if (this.video) {
      this.droppedFrames = this.video.getVideoPlaybackQuality?.().droppedVideoFrames ?? this.droppedFrames;
    }

    const kind = mapHlsErrorKind(data);

    // Non-fatal errors (dropped fragments, minor buffer stalls) are common
    // on real provider streams and self-recover; only surface fatal ones
    // as something the UI should react to (e.g. show a retry prompt).
    if (!data.fatal) return;

    if (this.hls) {
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        this.hls.startLoad();
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        this.hls.recoverMediaError();
      }
    }

    for (const cb of this.errorCallbacks) {
      cb({ kind, fatal: data.fatal, message: data.details, raw: data });
    }
  }

  private destroyHlsInstance(): void {
    this.hls?.destroy();
    this.hls = null;
  }
}

function mapHlsErrorKind(data: ErrorData): PlayerError["kind"] {
  if (data.type === Hls.ErrorTypes.NETWORK_ERROR) return "network";
  if (data.type === Hls.ErrorTypes.MEDIA_ERROR) return "media";
  if (data.details?.toLowerCase().includes("manifest")) return "manifest";
  return "unknown";
}
