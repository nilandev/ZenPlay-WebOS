import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Clapperboard, Film, type LucideIcon } from "lucide-react";
import { LITE_EFFECTS } from "../perf-tier.js";

export interface URLImageProps {
  src?: string;
  alt?: string;
  /** Seeds which placeholder gradient/icon variant is used when the image is missing or fails to load, so the same title always gets the same placeholder instead of it changing on every re-render. Defaults to `alt`. */
  seed?: string;
  loading?: "lazy" | "eager";
  style?: React.CSSProperties;
  className?: string;
  /**
   * "cover" (default) fills the box and crops — right for poster/cover art
   * where the aspect ratio is expected to vary and filling the tile matters
   * more than showing every pixel. "contain" fits the whole image without
   * cropping — use for channel logos, where clipping a broadcaster's mark
   * (often off-center or non-square) reads as broken art.
   */
  objectFit?: "cover" | "contain";
  /**
   * Icon shown on the placeholder when there's no artwork — pass the
   * section's icon (see section-icons.ts) so it matches where the user is.
   * Without it the placeholder alternates between generic film icons.
   */
  placeholderIcon?: LucideIcon;
}

/**
 * A couple of generic, movie-poster-friendly placeholder looks (gradient +
 * accent icon), cycled by `seed` so a grid of missing artwork reads as
 * varied tiles rather than the same flat box repeated dozens of times.
 * Colors are deliberately in the same dark/desaturated family as the rest
 * of the chrome (FocusCard's own #1c1c22 fallback, TvButton, etc.) so a
 * placeholder never sticks out as an error state — it should read as
 * "content with no art yet", not "something broke".
 */
const PLACEHOLDER_VARIANTS: Array<{ gradient: string; icon: typeof Film }> = [
  { gradient: "linear-gradient(160deg, #2a2438 0%, #171720 55%, #100f14 100%)", icon: Film },
  { gradient: "linear-gradient(160deg, #1f2b38 0%, #161e28 55%, #0e1216 100%)", icon: Clapperboard },
  { gradient: "linear-gradient(160deg, #33241f 0%, #201715 55%, #120e0d 100%)", icon: Film },
  { gradient: "linear-gradient(160deg, #1f2e28 0%, #17211c 55%, #0f1512 100%)", icon: Clapperboard },
];

/** Extra tries for an image that failed to load; the waits are 3s, then 6s. */
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 3000;

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

function pickVariant(seed: string): (typeof PLACEHOLDER_VARIANTS)[number] {
  return PLACEHOLDER_VARIANTS[hashSeed(seed) % PLACEHOLDER_VARIANTS.length];
}

/**
 * Drop-in `<img>` replacement for poster/cover art loaded from a
 * potentially unreliable third-party (IPTV provider) server: no `src` at
 * all, a broken URL, or one that 404s/times out mid-session all fall back
 * to the same generic placeholder tile instead of a broken-image icon or a
 * blank box. Used anywhere card artwork comes from provider-supplied URLs —
 * FocusCard being the main one — so this fallback behavior only needs to
 * be right in one place.
 *
 * Status is kept per `src` (rather than reset by an effect when it
 * changes): a poster served from the browser's cache can fire `load` before
 * a post-mount effect runs, and a reset landing after it would hide an
 * image that's already there — the "loads once, blank the next time" bug.
 * An image the browser already has decoded is also caught at mount via
 * `complete`/`naturalWidth`. A failed load is retried a couple of times
 * after a short wait (a provider throttling a burst of poster requests
 * fails some of them transiently) before settling on the placeholder.
 *
 * The loaded image crossfades in over the placeholder (opacity + a slight
 * scale-in) rather than popping in the instant it decodes — a hard swap
 * reads as a flash/flicker once dozens of provider images finish loading
 * independently across a shelf. Both layers stay stacked via `position:
 * absolute` throughout (nothing moves from absolute to static on load), so
 * only opacity animates. Each `<img>` still downloads fully in parallel
 * (the browser's own request scheduling, nothing queued/throttled here) —
 * only the reveal is slowed down, to ~550ms, so the crossfade itself reads
 * clearly per-card instead of looking like an instant swap when a fast or
 * cached response resolves within a frame or two of the others.
 */
export function URLImage({ src, alt = "", seed, loading = "lazy", style, className, objectFit = "cover", placeholderIcon }: URLImageProps): JSX.Element {
  const [state, setState] = useState<{ src?: string; status: "loading" | "loaded" | "error"; attempt: number }>({ src, status: "loading", attempt: 0 });
  // A different src starts over; the state only ever describes the src it was set for.
  const current = state.src === src ? state : { src, status: "loading" as const, attempt: 0 };
  const status = src ? current.status : "error";
  const imgRef = useRef<HTMLImageElement>(null);

  // Already in the browser's cache and decoded: no need to wait for (or risk missing) `load`.
  useLayoutEffect(() => {
    const img = imgRef.current;
    if (src && img?.complete && img.naturalWidth > 0) setState((prev) => (prev.src === src && prev.status === "loaded" ? prev : { src, status: "loaded", attempt: current.attempt }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, current.attempt]);

  // A failed load gets another try after a pause, remounting the <img> so the browser requests it again.
  useEffect(() => {
    if (!src || current.status !== "error" || current.attempt >= MAX_RETRIES) return;
    const timer = setTimeout(() => setState({ src, status: "loading", attempt: current.attempt + 1 }), RETRY_DELAY_MS * (current.attempt + 1));
    return () => clearTimeout(timer);
  }, [src, current.status, current.attempt]);

  const isLoaded = status === "loaded";
  const variant = pickVariant(seed ?? alt ?? src ?? "placeholder");
  const Icon = placeholderIcon ?? variant.icon;

  return (
    <div className={className} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", ...style }}>
      <div
        aria-hidden={Boolean(src)}
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: variant.gradient,
          // Fades out from underneath once the real image is in, instead of
          // unmounting outright — an instant unmount is exactly the kind of
          // hard cut this crossfade is meant to avoid.
          opacity: isLoaded ? 0 : 1,
          transition: "opacity 550ms ease-out",
        }}
      >
        <Icon size="34%" strokeWidth={1.25} color="rgba(255,255,255,0.28)" style={{ filter: LITE_EFFECTS ? undefined : "drop-shadow(0 2px 6px rgba(0,0,0,0.4))" }} />
      </div>
      {src && (
        <img
          key={current.attempt}
          ref={imgRef}
          src={src}
          alt={alt}
          loading={loading}
          decoding="async"
          onLoad={() => setState({ src, status: "loaded", attempt: current.attempt })}
          onError={() => setState({ src, status: "error", attempt: current.attempt })}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit,
            display: "block",
            opacity: isLoaded ? 1 : 0,
            transform: isLoaded ? "scale(1)" : "scale(1.03)",
            transition: "opacity 550ms ease-out, transform 550ms ease-out",
          }}
        />
      )}
    </div>
  );
}
