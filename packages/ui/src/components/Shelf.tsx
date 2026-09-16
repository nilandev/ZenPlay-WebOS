import { useEffect, useRef } from "react";
import { useFocusStore } from "../focus/focus-store.js";

export interface ShelfProps<T> {
  title: string;
  items: T[];
  getId: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
}

/**
 * A horizontally-scrolling row of focusable cards, Apple TV "shelf" style.
 * The row auto-scrolls to keep the focused card in view; focus-graph wiring
 * (left/right within the row, up/down across rows) is the caller's job via
 * buildShelfFocusGraph, since only the screen composing multiple shelves
 * knows the full cross-row layout.
 */
export function Shelf<T>({ title, items, getId, renderItem }: ShelfProps<T>): JSX.Element {
  const focusedId = useFocusStore((state) => state.focusedId);
  const trackRef = useRef<HTMLDivElement>(null);

  const containsFocus = items.some((item) => getId(item) === focusedId);

  useEffect(() => {
    if (!containsFocus || !trackRef.current) return;
    const focusedEl = trackRef.current.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focusedId ?? "")}"]`);
    focusedEl?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [focusedId, containsFocus]);

  if (items.length === 0) return <></>;

  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 12px 40px" }}>{title}</h2>
      <div
        ref={trackRef}
        style={{
          display: "flex",
          gap: 16,
          overflowX: "auto",
          padding: "12px 40px 24px",
          scrollbarWidth: "none",
        }}
      >
        {items.map((item) => (
          <div key={getId(item)} style={{ flex: "0 0 auto" }}>
            {renderItem(item)}
          </div>
        ))}
      </div>
    </section>
  );
}
