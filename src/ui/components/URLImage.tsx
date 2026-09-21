import { useEffect, useState } from "react";
import { Clapperboard, Film } from "lucide-react";

export interface URLImageProps {
  src?: string;
  alt?: string;
  /** Seeds which placeholder gradient/icon variant is used when the image is missing or fails to load, so the same title always gets the same placeholder instead of it changing on every re-render. Defaults to `alt`. */
  seed?: string;
  loading?: "lazy" | "eager";
  style?: React.CSSProperties;
  className?: string;
}

/**
 * A couple of generic, movie-poster-friendly placeholder looks (gradient +
 * accent icon), cycled by `seed` so a grid of missing artwork reads as
 * varied tiles rather than the same flat box repeated dozens of times.
 * Colors are deliberately in the same dark/desaturated family as the rest
 * of the chrome (FocusCard's own #1c1c22 fallback, PillButton, etc.) so a
 * placeholder never sticks out as an error state — it should read as
 * "content with no art yet", not "something broke".
 */
const PLACEHOLDER_VARIANTS: Array<{ gradient: string; icon: typeof Film }> = [
  { gradient: "linear-gradient(160deg, #2a2438 0%, #171720 55%, #100f14 100%)", icon: Film },
  { gradient: "linear-gradient(160deg, #1f2b38 0%, #161e28 55%, #0e1216 100%)", icon: Clapperboard },
  { gradient: "linear-gradient(160deg, #33241f 0%, #201715 55%, #120e0d 100%)", icon: Film },
  { gradient: "linear-gradient(160deg, #1f2e28 0%, #17211c 55%, #0f1512 100%)", icon: Clapperboard },
];

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
 * Resets to "loading" whenever `src` changes (rather than only on mount) so
 * scrolling a recycled/keyed list back onto a different item's URL doesn't
 * keep showing the previous item's error state.
 *
 * The loaded image crossfades in over the placeholder (opacity + a slight
 * scale-in) rather than popping in the instant it decodes — a hard swap
 * reads as a flash/flicker once dozens of provider images finish loading
 * independently across a shelf. Both layers stay stacked via `position:
 * absolute` throughout (nothing moves from absolute to static on load), so
 * only opacity animates.
 */
export function URLImage({ src, alt = "", seed, loading = "lazy", style, className }: URLImageProps): JSX.Element {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(src ? "loading" : "error");

  useEffect(() => {
    setStatus(src ? "loading" : "error");
  }, [src]);

  const isLoaded = status === "loaded";
  const variant = pickVariant(seed ?? alt ?? src ?? "placeholder");
  const Icon = variant.icon;

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
          transition: "opacity 320ms ease-out",
        }}
      >
        <Icon size="34%" strokeWidth={1.25} color="rgba(255,255,255,0.28)" style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.4))" }} />
      </div>
      {src && (
        <img
          src={src}
          alt={alt}
          loading={loading}
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
            opacity: isLoaded ? 1 : 0,
            transform: isLoaded ? "scale(1)" : "scale(1.03)",
            transition: "opacity 320ms ease-out, transform 320ms ease-out",
          }}
        />
      )}
    </div>
  );
}
