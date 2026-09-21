import type { CSSProperties, ReactNode } from "react";
import { Focusable } from "../focus/Focusable.js";
import { useFocusStore } from "../focus/focus-store.js";
import { URLImage } from "./URLImage.js";

export interface FocusCardProps {
  id: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  width?: number;
  aspectRatio?: string;
  onSelect?: () => void;
  badge?: ReactNode;
}

/**
 * Apple TV-style poster/tile card: scales up and lifts with a glow ring on
 * focus (driven by the focus store, not native :focus), animated purely via
 * CSS transform/box-shadow so it stays GPU-composited on weak TV hardware —
 * see PLAN.md "Performance principles".
 *
 * The title renders on top of the artwork itself, anchored to the bottom
 * behind a gradient scrim (Netflix/Apple TV poster-tile style), rather than
 * in a caption strip below it — a fixed-height caption either clips long
 * titles or reserves enough height to look empty for short ones. Anchoring
 * from the bottom with flexbox instead of a fixed height lets the text
 * block grow upward for longer titles without a fixed cap, and without
 * pushing the card's own layout height around (it's positioned over the
 * image, not stacked after it).
 */
export function FocusCard({
  id,
  title,
  subtitle,
  imageUrl,
  width = 220,
  aspectRatio = "2 / 3",
  onSelect,
  badge,
}: FocusCardProps): JSX.Element {
  const isFocused = useFocusStore((state) => state.focusedId === id);

  const style: CSSProperties = {
    width,
    transform: isFocused ? "scale(1.08) translateY(-4px)" : "scale(1)",
    transition: "transform 160ms ease-out, box-shadow 160ms ease-out",
    boxShadow: isFocused
      ? "0 12px 28px rgba(0,0,0,0.55), 0 0 0 3px rgba(255,255,255,0.9)"
      : "0 4px 10px rgba(0,0,0,0.35)",
    borderRadius: 12,
    overflow: "hidden",
    cursor: "pointer",
    background: "#1c1c22",
    willChange: "transform",
  };

  return (
    <Focusable id={id} className="focus-card">
      <div style={style} onClick={onSelect} role="button" tabIndex={-1}>
        <div style={{ position: "relative", width: "100%", aspectRatio }}>
          <URLImage src={imageUrl} alt="" seed={id} loading="lazy" />
          {badge && <div style={{ position: "absolute", top: 8, right: 8 }}>{badge}</div>}
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              background: "linear-gradient(180deg, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 80%, rgba(0,0,0,0.85) 100%)",
              padding: "16px 10px 8px",
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", lineHeight: 1.3, textShadow: "0 1px 4px rgba(0,0,0,0.85)" }}>
              {title}
            </div>
            {subtitle && (
              <div style={{ fontSize: 14, color: "rgba(255,255,255,0.8)", marginTop: 3, textShadow: "0 1px 4px rgba(0,0,0,0.85)" }}>
                {subtitle}
              </div>
            )}
          </div>
        </div>
      </div>
    </Focusable>
  );
}
