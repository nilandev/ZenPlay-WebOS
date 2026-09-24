import type { ReactNode } from "react";
import { LITE_EFFECTS } from "../perf-tier.js";

interface MeshBlob {
  /** Keyframes name for this blob's drift. */
  name: string;
  color: string;
  /** Size and resting position, in viewport units so the mesh scales with the screen. */
  width: string;
  height: string;
  left: string;
  top: string;
  /** Where the drift carries it (alternating back and forth) — translate + scale only. */
  to: string;
  durationS: number;
}

/**
 * The three colour washes of the mesh — blue upper-left, violet upper-right,
 * teal low-centre — each drifting on its own slow cycle so the combined
 * lighting keeps shifting without ever visibly repeating.
 */
const BLOBS: MeshBlob[] = [
  { name: "mesh-blob-blue", color: "rgba(59,90,220,0.3)", width: "75vw", height: "65vw", left: "-12vw", top: "-22vw", to: "translate(14vw, 10vh) scale(1.15)", durationS: 23 },
  { name: "mesh-blob-violet", color: "rgba(130,60,200,0.24)", width: "70vw", height: "60vw", left: "40vw", top: "-20vw", to: "translate(-12vw, 14vh) scale(1.1)", durationS: 29 },
  { name: "mesh-blob-teal", color: "rgba(20,140,140,0.24)", width: "72vw", height: "55vw", left: "14vw", top: "45vh", to: "translate(8vw, -16vh) scale(1.2)", durationS: 34 },
];

export interface MeshBackgroundProps {
  children: ReactNode;
  /**
   * Whether the lighting drifts. Defaults to on everywhere except
   * LITE_EFFECTS devices (webOS TVs), where screens stay static unless they
   * opt in — Home does, since it has nothing else on screen competing for
   * the GPU (unlike e.g. Live TV, which is also decoding a video preview).
   */
  animate?: boolean;
  /** Base colour under the washes. */
  baseColor?: string;
}

/**
 * Shared dark-charcoal backdrop with slowly drifting colour washes
 * ("dynamic lighting"), used across Home, Live TV, Guide, Favourites and
 * the profile/settings screens so they read as one app.
 *
 * Each wash is its own element holding a soft radial gradient, rasterised
 * once and then moved and scaled with `transform` — which the compositor
 * animates on its own thread without repainting anything. (The previous
 * version animated background-position, which repainted three
 * viewport-sized gradients on the main thread every frame; that's why it
 * had been frozen on TVs.) Respects prefers-reduced-motion.
 */
export function MeshBackground({ children, animate = !LITE_EFFECTS, baseColor = "#08090b" }: MeshBackgroundProps): JSX.Element {
  return (
    <div style={{ minHeight: "100vh", position: "relative", backgroundColor: baseColor }}>
      <div aria-hidden style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
        {BLOBS.map((blob) => (
          <div
            key={blob.name}
            className="mesh-background-blob"
            style={{
              position: "absolute",
              left: blob.left,
              top: blob.top,
              width: blob.width,
              height: blob.height,
              background: `radial-gradient(closest-side, ${blob.color}, rgba(0,0,0,0))`,
              animation: animate ? `${blob.name} ${blob.durationS}s ease-in-out infinite alternate` : "none",
            }}
          />
        ))}
      </div>
      {animate && (
        <style>{`
          ${BLOBS.map((blob) => `@keyframes ${blob.name} { from { transform: translate(0, 0) scale(1); } to { transform: ${blob.to}; } }`).join("\n")}
          @media (prefers-reduced-motion: reduce) { .mesh-background-blob { animation: none !important; } }
        `}</style>
      )}
      <div style={{ position: "relative" }}>{children}</div>
    </div>
  );
}
