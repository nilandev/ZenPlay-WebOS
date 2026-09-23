import type { CSSProperties, ReactNode } from "react";
import { Focusable } from "../focus/Focusable.js";
import { useFocusStore } from "../focus/focus-store.js";
import { URLImage } from "./URLImage.js";

export interface FocusCardProps {
  id: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  /**
   * Defaults to 220 (px) for backward compatibility with callers whose
   * layout math depends on this exact pixel value — VodScreen/SeriesScreen
   * both hardcode a matching GRID_CARD_WIDTH constant that their D-pad grid
   * focus graph (buildGridFocusGraph) needs to stay in sync with the CSS
   * grid's real rendered column count, so changing this default would need
   * to change that column-count math too (out of scope for the Home
   * redesign this prop was touched for — see AC4's scope note in the
   * implementation plan). Home's own shelves pass an explicit rem width
   * instead of relying on this default, so they do scale with the root
   * font-size even though the default itself doesn't.
   */
  width?: number | string;
  aspectRatio?: string;
  onSelect?: () => void;
  badge?: ReactNode;
  /** 0–1 watch progress (e.g. positionSeconds / durationSeconds) — renders a thin filled bar near the card's bottom edge when set. Callers are expected to clamp/guard against NaN (e.g. a zero-length duration) before passing this in. */
  progress?: number;
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
  progress,
}: FocusCardProps): JSX.Element {
  const isFocused = useFocusStore((state) => state.focusedId === id);

  const style: CSSProperties = {
    width,
    transform: isFocused ? "scale(1.05)" : "scale(1)",
    transition: "transform 250ms cubic-bezier(0.25, 1, 0.5, 1), border-color 250ms cubic-bezier(0.25, 1, 0.5, 1), box-shadow 250ms cubic-bezier(0.25, 1, 0.5, 1)",
    border: isFocused ? "0.1875rem solid rgba(255,255,255,0.9)" : "0.1875rem solid transparent",
    boxShadow: isFocused ? "0 0.75rem 1.75rem rgba(0,0,0,0.55)" : "0 0.25rem 0.625rem rgba(0,0,0,0.35)",
    borderRadius: "0.75rem",
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
          {badge && <div style={{ position: "absolute", top: "0.5rem", right: "0.5rem" }}>{badge}</div>}
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              background: "linear-gradient(180deg, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 80%, rgba(0,0,0,0.85) 100%)",
              padding: "1rem 0.625rem 0.5rem",
            }}
          >
            <div style={{ fontSize: "1.125rem", fontWeight: 700, color: "#fff", lineHeight: 1.3, textShadow: "0 1px 4px rgba(0,0,0,0.85)" }}>
              {title}
            </div>
            {subtitle && (
              <div style={{ fontSize: "0.875rem", color: "rgba(255,255,255,0.8)", marginTop: "0.1875rem", textShadow: "0 1px 4px rgba(0,0,0,0.85)" }}>
                {subtitle}
              </div>
            )}
            {progress !== undefined && (
              <div
                aria-hidden
                style={{
                  marginTop: "0.5rem",
                  height: "0.1875rem",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.25)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${Math.min(1, Math.max(0, progress)) * 100}%`,
                    height: "100%",
                    background: "var(--accent, #38bdf8)",
                    borderRadius: 999,
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </Focusable>
  );
}
