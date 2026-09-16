/**
 * Keeps a hidden <video>+Hls instance warmed up on the channel the user is
 * currently highlighting (but not yet selected) in a channel list, so that
 * committing to a channel change feels instant instead of waiting for a
 * fresh manifest fetch + segment download. Mirrors TiviMate's zap-ahead
 * behavior.
 */
import Hls from "hls.js";

export class ChannelPreloader {
  private hls: Hls | null = null;
  private pendingUrl: string | null = null;
  private debounceHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly debounceMs = 250) {}

  /** Call on every highlight change while browsing; only the last call within debounceMs actually preloads. */
  warm(streamUrl: string): void {
    if (streamUrl === this.pendingUrl) return;

    if (this.debounceHandle) clearTimeout(this.debounceHandle);
    this.debounceHandle = setTimeout(() => {
      this.pendingUrl = streamUrl;
      this.startWarming(streamUrl);
    }, this.debounceMs);
  }

  /** Returns the warmed Hls instance for immediate reuse if it matches the URL being committed to, else null. */
  claim(streamUrl: string): Hls | null {
    if (this.pendingUrl === streamUrl && this.hls) {
      const claimed = this.hls;
      this.hls = null;
      this.pendingUrl = null;
      return claimed;
    }
    return null;
  }

  dispose(): void {
    if (this.debounceHandle) clearTimeout(this.debounceHandle);
    this.hls?.destroy();
    this.hls = null;
    this.pendingUrl = null;
  }

  private startWarming(streamUrl: string): void {
    this.hls?.destroy();
    if (!Hls.isSupported()) return;

    const hls = new Hls({ maxBufferLength: 10 });
    hls.loadSource(streamUrl);
    this.hls = hls;
  }
}
