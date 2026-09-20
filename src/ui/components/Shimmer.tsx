import type { CSSProperties } from "react";

export interface ShimmerProps {
  width?: number | string;
  height?: number | string;
  borderRadius?: number;
  style?: CSSProperties;
}

/**
 * Base skeleton-loading block: an animated gradient sweep, GPU-composited
 * (background-position only, no layout-triggering properties) so it stays
 * smooth on weak TV CPUs per PLAN.md's performance principles. Screens
 * compose this into layout-matching skeletons (see ChannelGridSkeleton,
 * ShelfRowSkeleton, EpgGridSkeleton) so the shimmer-to-content swap doesn't
 * visibly jump.
 *
 * The sweep's highlight band is deliberately much lighter than
 * --surface-raised (the two are only ~10 points apart in lightness, which
 * measured out as barely perceptible against this app's near-black --bg —
 * a real user reported a long IPTV catalog load looking "stuck" because
 * this shimmer wasn't legible enough to register as a loading indicator
 * rather than a static dark grid; see conversation history) so the motion
 * actually reads as "loading" at a glance, including from 10-foot TV
 * viewing distance.
 */
export function Shimmer({ width = "100%", height = 16, borderRadius = 6, style }: ShimmerProps): JSX.Element {
  return (
    <div
      style={{
        width,
        height,
        borderRadius,
        background: "linear-gradient(100deg, var(--surface, #1a1a20) 30%, var(--shimmer-highlight, #4a4a58) 50%, var(--surface, #1a1a20) 70%)",
        backgroundSize: "200% 100%",
        animation: "iptv-shimmer 1.4s ease-in-out infinite",
        ...style,
      }}
    />
  );
}

/**
 * Injects the shimmer keyframes once. Called by every skeleton component's
 * module scope isn't reliable across bundlers, so screens/skeletons should
 * mount this once near the app root instead — see src/App.tsx.
 */
export function ShimmerStyles(): JSX.Element {
  return (
    <style>{`
      @keyframes iptv-shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
    `}</style>
  );
}
