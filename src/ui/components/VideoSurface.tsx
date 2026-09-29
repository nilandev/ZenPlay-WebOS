import { useEffect, useRef, useState } from "react";
import { Tv } from "lucide-react";
import { HlsPlayerEngine, type PlaybackProgress, type PlayerEngine, type PlayerError } from "@player";
import { registerVideoDonor, takeParkedVideo } from "../video-handoff.js";

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
  /** Where to start the stream (resume) — read when the stream loads. */
  startPositionSeconds?: number;
  /** Speed the stream starts at (1 = normal) — read when the stream loads. */
  playbackRate?: number;
  /** Mirrors the buffering indicator — used by PlayerScreen to give up on a stream that never recovers. */
  onBufferingChange?: (isBuffering: boolean) => void;
  /**
   * Lets handOffVideo take this surface's stream while it's playing (Live
   * TV's preview → the fullscreen player). The surface is left empty and
   * starts a fresh player the next time it gets a URL.
   */
  canHandOff?: boolean;
  /** Fires instead of a load when this surface adopts a stream another surface handed off — it's already playing. */
  onStreamAdopted?: () => void;
}

/** A mid-stream stall shorter than this doesn't show the indicator — brief hiccups would otherwise flash it. */
const STALL_INDICATOR_DELAY_MS = 400;

interface ActivePlayer {
  engine: PlayerEngine;
  video: HTMLVideoElement;
  /** The URL loaded (or adopted) into it — what a hand-off must match. */
  streamUrl: string | null;
  /** Taken over already playing from another surface — never loaded here. */
  isAdopted: boolean;
  unbind: () => void;
}

function createVideoElement(): HTMLVideoElement {
  const video = document.createElement("video");
  video.playsInline = true;
  video.autoplay = true;
  video.style.width = "100%";
  video.style.height = "100%";
  video.style.display = "block";
  return video;
}

/**
 * Owns a PlayerEngine and its <video> and reloads the stream whenever
 * streamUrl changes (e.g. the user switches channels). engineFactory lets
 * a host app inject an alternative engine instead of the default
 * hls.js-backed one, though webOS TV's own Chromium <video> + MSE is
 * expected to be sufficient without a native playback bridge.
 *
 * The <video> is created here rather than rendered by React so a playing
 * one can move to another surface (see video-handoff.ts): the engine and
 * element travel together and the stream never restarts.
 */
export function VideoSurface({
  streamUrl,
  engineFactory,
  onError,
  onProgress,
  onEngineReady,
  onPlayStateChange,
  startPositionSeconds,
  playbackRate,
  onBufferingChange,
  canHandOff = false,
  onStreamAdopted,
}: VideoSurfaceProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<ActivePlayer | null>(null);
  const [isBuffering, setIsBuffering] = useState(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const onEngineReadyRef = useRef(onEngineReady);
  onEngineReadyRef.current = onEngineReady;
  const onPlayStateChangeRef = useRef(onPlayStateChange);
  onPlayStateChangeRef.current = onPlayStateChange;
  const startPositionRef = useRef(startPositionSeconds);
  startPositionRef.current = startPositionSeconds;
  const playbackRateRef = useRef(playbackRate);
  playbackRateRef.current = playbackRate;
  const onBufferingChangeRef = useRef(onBufferingChange);
  onBufferingChangeRef.current = onBufferingChange;
  const onStreamAdoptedRef = useRef(onStreamAdopted);
  onStreamAdoptedRef.current = onStreamAdopted;
  // engineFactory is read once per player: it should be a stable reference
  // supplied once by the platform shell, not recreated per render.
  const engineFactoryRef = useRef(engineFactory);
  engineFactoryRef.current = engineFactory;

  useEffect(() => {
    onBufferingChangeRef.current?.(isBuffering);
  }, [isBuffering]);

  /** Wires an engine and its element to this surface's callbacks and buffering state; returns the unwiring. */
  function bind(engine: PlayerEngine, video: HTMLVideoElement): () => void {
    const unsubscribeError = engine.onError((error) => onErrorRef.current?.(error));
    const unsubscribeProgress = engine.onTimeUpdate((progress) => onProgressRef.current?.(progress));
    onEngineReadyRef.current?.(engine);

    const handlePlay = () => onPlayStateChangeRef.current?.({ isPlaying: true, didEnd: false });
    const handlePause = () => onPlayStateChangeRef.current?.({ isPlaying: false, didEnd: false });
    const handleEnded = () => onPlayStateChangeRef.current?.({ isPlaying: false, didEnd: true });

    // Mid-stream stalls: the element fires "waiting" when it runs out of
    // data and "playing" once it resumes.
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    const clearStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = null;
    };
    const handleWaiting = () => {
      clearStallTimer();
      stallTimer = setTimeout(() => setIsBuffering(true), STALL_INDICATOR_DELAY_MS);
    };
    const handleResumed = () => {
      clearStallTimer();
      setIsBuffering(false);
    };
    const listeners: [string, () => void][] = [
      ["play", handlePlay],
      ["pause", handlePause],
      ["ended", handleEnded],
      ["waiting", handleWaiting],
      ["playing", handleResumed],
      ["pause", clearStallTimer],
      ["ended", handleResumed],
      ["error", handleResumed],
    ];
    for (const [type, listener] of listeners) video.addEventListener(type, listener);

    return () => {
      clearStallTimer();
      for (const [type, listener] of listeners) video.removeEventListener(type, listener);
      unsubscribeError();
      unsubscribeProgress();
      onEngineReadyRef.current?.(null);
    };
  }

  function install(engine: PlayerEngine, video: HTMLVideoElement, url: string | null, isAdopted = false): ActivePlayer {
    // appendChild moves an adopted element in one step, so it never leaves the document and keeps playing.
    containerRef.current?.appendChild(video);
    const player = { engine, video, streamUrl: url, isAdopted, unbind: bind(engine, video) };
    playerRef.current = player;
    return player;
  }

  function destroyPlayer(): void {
    const player = playerRef.current;
    if (!player) return;
    playerRef.current = null;
    player.unbind();
    player.engine.destroy();
    player.video.remove();
  }

  function ensurePlayer(): ActivePlayer {
    if (playerRef.current) return playerRef.current;
    const engine = (engineFactoryRef.current ?? (() => new HlsPlayerEngine()))();
    const video = createVideoElement();
    engine.attach(video);
    return install(engine, video, null);
  }

  // Torn down a microtask after unmount, so StrictMode's dev-only
  // unmount-and-remount keeps the player (and a stream it just adopted)
  // instead of destroying it and loading the channel again.
  const isMountedRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      queueMicrotask(() => {
        if (!isMountedRef.current) destroyPlayer();
      });
    };
  }, []);

  useEffect(() => {
    if (!canHandOff) return;
    return registerVideoDonor((url) => {
      const player = playerRef.current;
      // Only a stream that's actually playing is worth handing on; one still loading just loads again over there.
      if (!player || player.streamUrl !== url || player.video.paused || player.video.readyState < HAVE_FUTURE_DATA) return null;
      playerRef.current = null;
      player.unbind();
      return { streamUrl: url, engine: player.engine, video: player.video };
    });
  }, [canHandOff]);

  useEffect(() => {
    if (!streamUrl) {
      // A null URL means "nothing should be playing here" (e.g. LiveTvScreen
      // suspending its preview under a fullscreen player) — release the
      // decoder rather than leaving the previous stream running unseen.
      const player = playerRef.current;
      if (player) {
        player.engine.unload();
        player.streamUrl = null;
        player.isAdopted = false;
      }
      setIsBuffering(false);
      return;
    }

    const adopted = takeParkedVideo(streamUrl);
    if (adopted) {
      destroyPlayer();
      install(adopted.engine, adopted.video, streamUrl, true);
      setIsBuffering(false);
      if (adopted.video.paused) adopted.video.play().catch(() => {});
      onStreamAdoptedRef.current?.();
      return;
    }

    // StrictMode's dev-only second run, right after adopting: it's still playing — don't load it again.
    if (playerRef.current?.isAdopted && playerRef.current.streamUrl === streamUrl) return;

    const player = ensurePlayer();
    const { engine } = player;
    player.streamUrl = streamUrl;
    player.isAdopted = false;
    let cancelled = false;
    setIsBuffering(true);
    engine
      .load(streamUrl, { startPositionSeconds: startPositionRef.current, playbackRate: playbackRateRef.current })
      .then(() => {
        if (!cancelled) return engine.play();
      })
      .catch((error: unknown) => {
        // AbortError: a newer load interrupted this one. NotAllowedError: the
        // browser blocked autoplay — the viewer can still press Play.
        const name = error instanceof DOMException ? error.name : "";
        if (!cancelled && name !== "AbortError" && name !== "NotAllowedError") {
          onError?.({ kind: "unknown", fatal: true, message: String(error), raw: error });
        }
      })
      .finally(() => {
        if (!cancelled) setIsBuffering(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamUrl, onError]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
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

/** HTMLMediaElement.HAVE_FUTURE_DATA — enough buffered to keep playing. */
const HAVE_FUTURE_DATA = 3;

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
