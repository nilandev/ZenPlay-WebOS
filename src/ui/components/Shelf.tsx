import { useEffect, useMemo, useRef } from "react";
import { FocusScrollManagedContext } from "../focus/Focusable.js";
import { useFocusStore } from "../focus/focus-store.js";
import { BROWSE_CONTENT_LEFT, BROWSE_GAP, BROWSE_SIDE_PADDING, TV_HEADING } from "../tv-metrics.js";

export interface ShelfProps<T> {
  /** Row heading; omit for a bare row (e.g. the episode row under season tabs). */
  title?: string;
  items: T[];
  getId: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  /** Optional extra card after the items (e.g. SeeAllCard), and its focus id so the row scrolls to it too. */
  trailing?: React.ReactNode;
  trailingId?: string;
  /** Left inset of the row. Defaults to BROWSE_CONTENT_LEFT (clearing the category rail); pages without the rail pass BROWSE_SIDE_PADDING. */
  leftInset?: string;
}

/**
 * A horizontally-scrolling row of focusable cards, Apple TV "shelf" style.
 * The row auto-scrolls to keep the focused card in view; focus-graph wiring
 * (left/right within the row, up/down across rows) is the caller's job via
 * buildShelfFocusGraph, since only the screen composing multiple shelves
 * knows the full cross-row layout.
 *
 * Follows focus via a store subscription rather than subscribing to
 * focusedId as render state: a D-pad press then re-renders only the two
 * cards whose focused state actually changed (each FocusCard subscribes to
 * its own id), not every card in every shelf on screen. Scrolling is also
 * owned entirely here (FocusScrollManagedContext switches off Focusable's
 * own scrollIntoView for the cards inside), so there's exactly one scroll
 * request per press instead of two competing ones.
 */
export function Shelf<T>({ title, items, getId, renderItem, trailing, trailingId, leftInset = BROWSE_CONTENT_LEFT }: ShelfProps<T>): JSX.Element {
  const sectionRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  // getId is typically an inline arrow from the caller — read through a ref
  // so a parent re-render doesn't rebuild the id set and re-subscribe.
  const getIdRef = useRef(getId);
  getIdRef.current = getId;
  const ids = useMemo(() => {
    const set = new Set(items.map((item) => getIdRef.current(item)));
    if (trailingId) set.add(trailingId);
    return set;
  }, [items, trailingId]);

  useEffect(() => {
    function scrollToFocused(focusedId: string | null): void {
      const track = trackRef.current;
      if (!focusedId || !ids.has(focusedId) || !track) return;
      const focusedEl = Array.from(track.querySelectorAll<HTMLElement>("[data-focus-id]")).find((el) => el.dataset.focusId === focusedId);
      if (!focusedEl) return;
      // Centre the card horizontally. The track is position: relative, so
      // offsetLeft is measured against it; setting scrollLeft picks up the
      // track's own scroll-behavior: smooth.
      track.scrollLeft = focusedEl.offsetLeft - (track.clientWidth - focusedEl.offsetWidth) / 2;
      sectionRef.current?.scrollIntoView?.({ block: "nearest" });
    }

    scrollToFocused(useFocusStore.getState().focusedId);
    return useFocusStore.subscribe((state, prev) => {
      if (state.focusedId !== prev.focusedId) scrollToFocused(state.focusedId);
    });
  }, [ids]);

  if (items.length === 0) return <></>;

  return (
    <section ref={sectionRef} style={{ marginBottom: "1rem" }}>
      {title && <h2 style={{ fontSize: TV_HEADING, fontWeight: 700, margin: `0 0 -0.5rem ${leftInset}` }}>{title}</h2>}
      <div
        ref={trackRef}
        style={{
          position: "relative",
          display: "flex",
          gap: BROWSE_GAP,
          overflowX: "auto",
          // overflow-x: auto forces overflow-y to clip too (the two axes
          // can't be independently visible/auto per spec), so the padding
          // has to contain FocusCard's focused-state lift — otherwise it gets
          // cut off by this track. Top: the scale(1.1) growth (~1.3rem on a
          // POSTER_WIDTH card). Bottom: that growth plus the lift shadow
          // falling beneath the card (see FocusCard's shadow).
          padding: `2.25rem ${BROWSE_SIDE_PADDING} 3.5rem ${leftInset}`,
          scrollbarWidth: "none",
          scrollBehavior: "smooth",
        }}
      >
        <FocusScrollManagedContext.Provider value={true}>
          {items.map((item) => (
            <div key={getId(item)} style={{ flex: "0 0 auto" }}>
              {renderItem(item)}
            </div>
          ))}
          {trailing && <div style={{ flex: "0 0 auto" }}>{trailing}</div>}
        </FocusScrollManagedContext.Provider>
      </div>
    </section>
  );
}
