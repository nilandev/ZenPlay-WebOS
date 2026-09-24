import type { CSSProperties, ReactNode } from "react";

/** tvOS-like motion: a quick rise that settles softly, rather than a linear ease. */
export const LIFT_TRANSITION = "300ms cubic-bezier(0.2, 0.9, 0.3, 1)";

export interface LiftSurfaceProps {
  isFocused: boolean;
  /** Corner radius shared by the face, its shadow and its sheen. */
  radius: string;
  /** How far the focused card rises toward the viewer. tvOS uses roughly 1.1. */
  focusedScale?: number;
  /** Drop shadow cast while focused — larger for bigger cards. */
  shadow?: string;
  /** Styles for the visible face (size, background, layout of the content). */
  faceStyle?: CSSProperties;
  width?: CSSProperties["width"];
  as?: "button" | "div";
  role?: string;
  tabIndex?: number;
  onClick?: () => void;
  children: ReactNode;
}

const DEFAULT_SHADOW = "0 1.5rem 3rem -0.5rem rgba(0,0,0,0.7), 0 0.5rem 1rem rgba(0,0,0,0.45)";

/**
 * Apple TV-style focus treatment for a card. Unfocused, the card sits flat
 * in the grid. Focused, it rises toward the viewer: it scales up, casts a
 * large soft shadow onto whatever is beneath it, catches a glossy highlight
 * across its top edge, and draws above its neighbours — no outline ring.
 *
 * Every effect is pre-drawn on its own layer and only its opacity or the
 * card's transform animates, so a focus change runs on the compositor
 * instead of repainting shadows and gradients frame by frame (which TV
 * GPUs can't keep up with).
 */
export function LiftSurface({
  isFocused,
  radius,
  focusedScale = 1.1,
  shadow = DEFAULT_SHADOW,
  faceStyle,
  width,
  as: Element = "div",
  role,
  tabIndex,
  onClick,
  children,
}: LiftSurfaceProps): JSX.Element {
  return (
    <Element
      type={Element === "button" ? "button" : undefined}
      role={role}
      tabIndex={tabIndex}
      onClick={onClick}
      style={{
        position: "relative",
        display: "block",
        width: width ?? "100%",
        padding: 0,
        border: "none",
        background: "none",
        color: "inherit",
        font: "inherit",
        textAlign: "inherit",
        cursor: "pointer",
        zIndex: isFocused ? 2 : undefined,
        transform: isFocused ? `scale(${focusedScale})` : "scale(1)",
        transition: `transform ${LIFT_TRANSITION}`,
      }}
    >
      <div
        aria-hidden
        data-testid="lift-shadow"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: radius,
          boxShadow: shadow,
          opacity: isFocused ? 1 : 0,
          transition: `opacity ${LIFT_TRANSITION}`,
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "relative", width: "100%", borderRadius: radius, overflow: "hidden", ...faceStyle }}>
        {children}
        <div
          aria-hidden
          data-testid="lift-sheen"
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(155deg, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.05) 35%, rgba(255,255,255,0) 55%)",
            opacity: isFocused ? 1 : 0,
            transition: `opacity ${LIFT_TRANSITION}`,
            pointerEvents: "none",
          }}
        />
      </div>
    </Element>
  );
}
