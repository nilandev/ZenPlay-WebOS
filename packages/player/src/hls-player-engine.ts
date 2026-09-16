import Hls, { ErrorData, Events, type HlsConfig } from "hls.js";
import type { AudioTrackInfo, PlayerEngine, PlayerError, PlayerStats } from "./player-engine.js";

/**
 * hls.js-backed engine used on webOS, Tizen, desktop (Electron/Chromium),
 * and as the Android TV fallback when the native ExoPlayer bridge isn't
 * available. Tuned defaults account for how permissive real IPTV provider
 * streams need to be (irregular segment timing, non-strict manifests)
 * versus hls.js's spec-strict defaults.
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

export class HlsPlayerEngine implements PlayerEngine {
  private hls: Hls | null = null;
  private video: HTMLVideoElement | null = null;
  private errorCallbacks = new Set<(error: PlayerError) => void>();
  private droppedFrames = 0;

  attach(videoElement: HTMLVideoElement): void {
    this.video = videoElement;
  }

  async load(streamUrl: string): Promise<void> {
    if (!this.video) throw new Error("HlsPlayerEngine.attach() must be called before load()");

    this.destroyHlsInstance();

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
    this.errorCallbacks.clear();
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
