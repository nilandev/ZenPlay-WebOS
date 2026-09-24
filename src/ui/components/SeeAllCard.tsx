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
}

/**
 * Last card of a browse shelf: opens the shelf's full category. Shelves only
 * show a category's first few titles, so without this the row just ends and
 * there's no way to reach the rest from where you are. Poster-sized and
 * lifted on focus exactly like a FocusCard, so it reads as part of the row.
 */
export function SeeAllCard({ id, label, onSelect }: SeeAllCardProps): JSX.Element {
  const isFocused = useIsFocused(id);

  return (
    <Focusable id={id}>
      <LiftSurface
        isFocused={isFocused}
        radius="1rem"
        width={POSTER_WIDTH}
        role="button"
        tabIndex={-1}
        onClick={onSelect}
        faceStyle={{
          aspectRatio: "2 / 3",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1.25rem",
          padding: "1.5rem",
          textAlign: "center",
          background: isFocused
            ? "linear-gradient(160deg, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0.17) 100%)"
            : "linear-gradient(160deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.035) 100%)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.14), inset 0 0 0 1px rgba(255,255,255,0.08)",
          color: isFocused ? "#ffffff" : "rgba(235,236,242,0.75)",
        }}
      >
        <div
          style={{
            width: "4.5rem",
            height: "4.5rem",
            borderRadius: 999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "2px solid currentColor",
          }}
        >
          <ArrowRight size="2rem" strokeWidth={2} />
        </div>
        <div style={{ fontSize: "1.75rem", fontWeight: 800 }}>See all</div>
        <div style={{ fontSize: TV_TEXT, fontWeight: 500, opacity: 0.8, overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{label}</div>
      </LiftSurface>
    </Focusable>
  );
}
