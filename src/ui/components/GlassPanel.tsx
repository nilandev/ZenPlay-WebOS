import type { CSSProperties, ReactNode } from "react";
import { glassBlur, LITE_EFFECTS } from "../perf-tier.js";

export interface GlassPanelProps {
  children: ReactNode;
  visible: boolean;
  style?: CSSProperties;
}

/**
 * "Liquid glass" translucent panel (iOS-26-style): a blurred, faintly
 * tinted surface with a subtle top highlight and soft shadow, so whatever
 * sits behind it (the playing video) stays visible through it. Fades and
 * slides on visibility toggle rather than mounting/unmounting instantly,
 * so dismissal reads as a deliberate motion rather than a hard cut.
 *
 * Under LITE_EFFECTS (webOS TVs) the blur is dropped — blurring live video
 * behind the panel is an extra full-panel render pass every video frame on
 * TV GPUs — and the fill is made denser instead so text stays legible over
 * the picture.
 */
export function GlassPanel({ children, visible, style }: GlassPanelProps): JSX.Element {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        padding: "20px 40px 28px",
        background: LITE_EFFECTS
          ? "linear-gradient(180deg, rgba(24,24,30,0.82) 0%, rgba(16,16,20,0.9) 100%)"
          : "linear-gradient(180deg, rgba(30,30,36,0.35) 0%, rgba(20,20,26,0.55) 100%)",
        ...glassBlur("blur(28px) saturate(160%)"),
        borderTop: "1px solid rgba(255,255,255,0.18)",
        boxShadow: "0 -12px 40px rgba(0,0,0,0.4)",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(24px)",
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 220ms ease-out, transform 220ms ease-out",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
