import type { ReactNode } from "react";
import { Focusable } from "../focus/Focusable.js";
import { useFocusStore } from "../focus/focus-store.js";
import { LiftSurface } from "./LiftSurface.js";
import { URLImage } from "./URLImage.js";

const CARD_RADIUS = "0.75rem";

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
 * Apple TV-style poster/tile card. Unfocused it sits flat; focused it rises
 * toward the viewer via LiftSurface (scale, soft drop shadow, glossy sheen,
 * drawn above its neighbours) with no outline ring — driven by the focus
 * store, not native :focus. Only transform and opacity animate, so a focus
 * change runs on the compositor; no will-change either, since pinning a GPU
 * layer on every card in a grid exhausts TV GPU memory. See PLAN.md
 * "Performance principles".
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

  return (
    <Focusable id={id} className="focus-card">
      <LiftSurface
        isFocused={isFocused}
        radius={CARD_RADIUS}
        width={width}
        role="button"
        tabIndex={-1}
        onClick={onSelect}
        shadow="0 1.25rem 2rem -0.5rem rgba(0,0,0,0.75), 0 0.375rem 0.75rem rgba(0,0,0,0.45)"
        faceStyle={{ aspectRatio, background: "#1c1c22" }}
      >
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
      </LiftSurface>
    </Focusable>
  );
}
