import { useEffect, useRef, useState } from "react";
import { HlsPlayerEngine, type PlayerEngine, type PlayerError } from "@iptv/player";

export interface VideoSurfaceProps {
  streamUrl: string | null;
  engineFactory?: () => PlayerEngine;
  onError?: (error: PlayerError) => void;
}

/**
 * Owns a PlayerEngine instance for its lifetime and reloads it whenever
 * streamUrl changes (e.g. the user switches channels). engineFactory lets
 * a host app inject an alternative engine instead of the default
 * hls.js-backed one, though webOS TV's own Chromium <video> + MSE is
 * expected to be sufficient without a native playback bridge.
 */
export function VideoSurface({ streamUrl, engineFactory, onError }: VideoSurfaceProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<PlayerEngine | null>(null);
  const [isBuffering, setIsBuffering] = useState(false);

  useEffect(() => {
    const engine = (engineFactory ?? (() => new HlsPlayerEngine()))();
    engineRef.current = engine;
    if (videoRef.current) engine.attach(videoRef.current);

    const unsubscribe = engine.onError((error) => onError?.(error));

    return () => {
      unsubscribe();
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
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#000" }}>
      <video ref={videoRef} style={{ width: "100%", height: "100%" }} playsInline autoPlay />
      {isBuffering && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          Buffering…
        </div>
      )}
    </div>
  );
}
