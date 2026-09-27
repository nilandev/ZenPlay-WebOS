import { ArrowRight } from "lucide-react";
import { Focusable } from "../focus/Focusable.js";
import { useIsFocused } from "../focus/focus-store.js";
import { POSTER_WIDTH, TV_TEXT } from "../tv-metrics.js";
import { LiftSurface } from "./LiftSurface.js";

export interface SeeAllCardProps {
  id: string;
  /** Category name, shown under "See all". */
  label: string;
  onSelect: () => void;
  /** Defaults to POSTER_WIDTH; screens with a narrower content area pass their own card width. */
  width?: number | string;
  /** "poster" (2:3) matches a poster row; "wide" (16:9) matches a row of channel tiles, with its contents side by side. */
  shape?: "poster" | "wide";
}

/**
 * Last card of a browse shelf: opens the shelf's full category. Shelves only
 * show a category's first few titles, so without this the row just ends and
 * there's no way to reach the rest from where you are. Sized like the row's
 * cards (a poster, or a wide channel tile) and lifted on focus exactly like
 * a FocusCard, so it reads as part of the row.
 */
export function SeeAllCard({ id, label, onSelect, width = POSTER_WIDTH, shape = "poster" }: SeeAllCardProps): JSX.Element {
  const isFocused = useIsFocused(id);
  const wide = shape === "wide";

  return (
    <Focusable id={id}>
      <LiftSurface
        isFocused={isFocused}
        radius="1rem"
        width={width}
        role="button"
        tabIndex={-1}
        onClick={onSelect}
        faceStyle={{
          aspectRatio: wide ? "16 / 9" : "2 / 3",
          display: "flex",
          flexDirection: wide ? "row" : "column",
          alignItems: "center",
          justifyContent: "center",
          gap: wide ? "1rem" : "1.25rem",
          padding: wide ? "1rem 1.25rem" : "1.5rem",
          textAlign: wide ? "left" : "center",
          background: isFocused
            ? "linear-gradient(160deg, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0.17) 100%)"
            : "linear-gradient(160deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.035) 100%)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.14), inset 0 0 0 1px rgba(255,255,255,0.08)",
          color: isFocused ? "#ffffff" : "rgba(235,236,242,0.75)",
        }}
      >
        <div
          style={{
            width: wide ? "3.5rem" : "4.5rem",
            height: wide ? "3.5rem" : "4.5rem",
            flexShrink: 0,
            borderRadius: 999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "2px solid currentColor",
          }}
        >
          <ArrowRight size={wide ? "1.75rem" : "2rem"} strokeWidth={2} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: wide ? "0.25rem" : "1.25rem", minWidth: 0, maxWidth: "100%", alignItems: wide ? "flex-start" : "center" }}>
          <div style={{ fontSize: wide ? "1.5rem" : "1.75rem", fontWeight: 800 }}>See all</div>
          <div style={{ fontSize: TV_TEXT, fontWeight: 500, opacity: 0.8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>{label}</div>
        </div>
      </LiftSurface>
    </Focusable>
  );
}
