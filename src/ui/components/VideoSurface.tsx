import { useEffect, useRef, useState } from "react";
import { Tv } from "lucide-react";
import { HlsPlayerEngine, type PlaybackProgress, type PlayerEngine, type PlayerError } from "@player";

export interface VideoSurfaceProps {
  streamUrl: string | null;
  engineFactory?: () => PlayerEngine;
  onError?: (error: PlayerError) => void;
  /** Fires on every native timeupdate tick — opt-in, used by PlayerScreen to persist VOD/series resume position. LiveTvScreen leaves this unset. */
  onProgress?: (progress: PlaybackProgress) => void;
  /**
   * Hands the live engine instance to the caller once it's attached (and
   * again with null on unmount) — opt-in, used by PlayerScreen to drive
   * play/pause/seek/volume/track controls from its overlay without
   * VideoSurface itself needing to know anything about that UI.
   */
  onEngineReady?: (engine: PlayerEngine | null) => void;
  /** Mirrors the underlying <video> element's play/pause/ended state — opt-in, used by PlayerScreen's play/pause icon and next-episode auto-advance. */
  onPlayStateChange?: (state: { isPlaying: boolean; didEnd: boolean }) => void;
}

/**
 * Owns a PlayerEngine instance for its lifetime and reloads it whenever
 * streamUrl changes (e.g. the user switches channels). engineFactory lets
 * a host app inject an alternative engine instead of the default
 * hls.js-backed one, though webOS TV's own Chromium <video> + MSE is
 * expected to be sufficient without a native playback bridge.
 */
export function VideoSurface({
  streamUrl,
  engineFactory,
  onError,
  onProgress,
  onEngineReady,
  onPlayStateChange,
}: VideoSurfaceProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<PlayerEngine | null>(null);
  const [isBuffering, setIsBuffering] = useState(false);
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const onEngineReadyRef = useRef(onEngineReady);
  onEngineReadyRef.current = onEngineReady;
  const onPlayStateChangeRef = useRef(onPlayStateChange);
  onPlayStateChangeRef.current = onPlayStateChange;

  useEffect(() => {
    const engine = (engineFactory ?? (() => new HlsPlayerEngine()))();
    engineRef.current = engine;
    if (videoRef.current) engine.attach(videoRef.current);

    const unsubscribeError = engine.onError((error) => onError?.(error));
    const unsubscribeProgress = engine.onTimeUpdate((progress) => onProgressRef.current?.(progress));
    onEngineReadyRef.current?.(engine);

    const video = videoRef.current;
    const handlePlay = () => onPlayStateChangeRef.current?.({ isPlaying: true, didEnd: false });
    const handlePause = () => onPlayStateChangeRef.current?.({ isPlaying: false, didEnd: false });
    const handleEnded = () => onPlayStateChangeRef.current?.({ isPlaying: false, didEnd: true });
    video?.addEventListener("play", handlePlay);
    video?.addEventListener("pause", handlePause);
    video?.addEventListener("ended", handleEnded);

    return () => {
      unsubscribeError();
      unsubscribeProgress();
      video?.removeEventListener("play", handlePlay);
      video?.removeEventListener("pause", handlePause);
      video?.removeEventListener("ended", handleEnded);
      onEngineReadyRef.current?.(null);
      engine.destroy();
      engineRef.current = null;
    };
    // engineFactory intentionally excluded: it should be a stable reference
    // supplied once by the platform shell, not recreated per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !streamUrl) return;

    let cancelled = false;
    setIsBuffering(true);
    engine
      .load(streamUrl)
      .then(() => {
        if (!cancelled) return engine.play();
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          onError?.({ kind: "unknown", fatal: true, message: String(error), raw: error });
        }
      })
      .finally(() => {
        if (!cancelled) setIsBuffering(false);
      });

    return () => {
      cancelled = true;
    };
  }, [streamUrl, onError]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <video ref={videoRef} style={{ width: "100%", height: "100%" }} playsInline autoPlay />
      {isBuffering && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.35)",
          }}
        >
          <BufferingIcon />
        </div>
      )}
    </div>
  );
}

/**
 * A TV glyph that fills from bottom to top on a loop, like a liquid level
 * rising — replaces a plain "Buffering…" label with something that reads
 * clearly from 10-foot TV viewing distance without needing legible text.
 * Two stacked copies of the same lucide icon: a dim static outline for
 * scale/shape, and a bright copy whose visible portion is driven by an
 * animated inset() clip-path (top inset shrinking 100%→0%, so the reveal
 * rises upward) — GPU-composited (clip-path + opacity only, no layout
 * properties) to stay smooth on weak TV CPUs.
 */
function BufferingIcon(): JSX.Element {
  return (
    <div style={{ position: "relative", width: 64, height: 64 }}>
      <Tv size={64} strokeWidth={1.25} color="rgba(255,255,255,0.18)" style={{ position: "absolute", inset: 0 }} />
      <div style={{ position: "absolute", inset: 0, animation: "video-surface-fill 1.8s ease-in-out infinite" }}>
        <Tv size={64} strokeWidth={1.5} color="rgba(255,255,255,0.95)" />
      </div>
      <style>{`
        @keyframes video-surface-fill {
          0% { clip-path: inset(100% 0 0 0); }
          45% { clip-path: inset(0 0 0 0); }
          55% { clip-path: inset(0 0 0 0); }
          100% { clip-path: inset(100% 0 0 0); }
        }
      `}</style>
    </div>
  );
}
