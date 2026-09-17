import type { CSSProperties, ReactNode } from "react";

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
 * `backdrop-filter: blur` is supported on webOS TV's Chromium-based
 * runtime (Chromium 76+, so webOS TV 6.0+), though LG TV GPUs have
 * historically had inconsistent rendering/performance with it — the solid
 * `background` gradient underneath is a reasonable fallback (still reads
 * as a translucent panel) if it needs to be dropped on real hardware.
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
        background: "linear-gradient(180deg, rgba(30,30,36,0.35) 0%, rgba(20,20,26,0.55) 100%)",
        backdropFilter: "blur(28px) saturate(160%)",
        WebkitBackdropFilter: "blur(28px) saturate(160%)",
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
