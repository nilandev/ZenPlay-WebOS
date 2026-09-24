import { memo, useCallback, useEffect, useRef } from "react";
import { ChevronRight, LayoutList } from "lucide-react";
import { Focusable } from "../focus/Focusable.js";
import { buildListFocusGraph } from "../focus/build-grid-graph.js";
import { useFocusStore, useIsFocused } from "../focus/focus-store.js";
import { CATEGORY_RAIL_COLLAPSED_WIDTH, CATEGORY_RAIL_EXPANDED_WIDTH, TV_HEADING, TV_TEXT } from "../tv-metrics.js";

export interface CategoryRailItem {
  id: string;
  label: string;
  count?: number;
}

export interface CategoryRailProps {
  /** Screen name shown at the top of the expanded rail, e.g. "Movies". */
  title: string;
  /** Rows in order. Typically a "Browse" entry first, then the provider's categories. */
  items: CategoryRailItem[];
  activeId: string;
  /** Commits a category (Select on a row). */
  onSelect: (id: string) => void;
  /** Where Right goes from any row — the content's entry point. */
  rightEntryId?: string;
  /** Rows before this index are "fixed" entries (e.g. Browse); a "Categories" label separates them from the rest. */
  sectionBreakAt?: number;
}

const SCOPE = "chrome:category-rail";
const RAIL_PREFIX = "rail:";
const RAIL_TRANSITION = "280ms cubic-bezier(0.2, 0.9, 0.3, 1)";

/** Focus id of a rail row — prefixed so a category id can never collide with a content item's id. */
export function categoryRailItemId(categoryId: string): string {
  return `${RAIL_PREFIX}${categoryId}`;
}

/**
 * Left-edge category navigation for the poster browse screens (Movies,
 * Series), Netflix/Prime Video TV-style: a thin always-visible strip while
 * focus is on the content, expanding over the content (with the rest of the
 * screen dimmed) the moment focus enters it — Left from the first content
 * column, or Back. Up/Down move through categories, Select opens one, Right
 * returns to the content.
 *
 * Expanding never re-lays out the content underneath: the panel is a fixed
 * overlay that slides in with `transform` and the dimming is an `opacity`
 * change, both compositor-only. The component re-renders only when focus
 * enters or leaves the rail (a boolean selector), and each row subscribes to
 * its own focus state, so moving through a long category list re-renders
 * two rows per press.
 */
export function CategoryRail({ title, items, activeId, onSelect, rightEntryId, sectionBreakAt }: CategoryRailProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const isExpanded = useFocusStore((state) => state.focusedId?.startsWith(RAIL_PREFIX) ?? false);

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const handleSelect = useCallback((id: string) => onSelectRef.current(id), []);

  useEffect(() => {
    const ids = items.map((item) => categoryRailItemId(item.id));
    const nodes = buildListFocusGraph(ids).map((node, index) => ({
      ...node,
      neighbors: { ...node.neighbors, right: rightEntryId },
      onSelect: () => onSelectRef.current(items[index].id),
    }));
    // Passive: the rail is reachable (Left/Back) but never takes the
    // screen's initial focus away from the content.
    setGraph(SCOPE, nodes, undefined, { passive: true });
  }, [items, rightEntryId, setGraph, clearGraph]);
  // Rebuilds above replace the scope in place (setGraph is atomic); clearing
  // it on every rebuild would drop focus for an instant and snap it back to
  // the first node. Clear only when this component goes away.
  useEffect(() => () => clearGraph(SCOPE), [clearGraph]);


  return (
    <>
      {/* Collapsed strip: always visible, hints that categories live to the left. */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          bottom: 0,
          width: CATEGORY_RAIL_COLLAPSED_WIDTH,
          zIndex: 30,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: "1.75rem",
          gap: "1rem",
          background: "#08090c",
          boxShadow: "inset -1px 0 0 rgba(255,255,255,0.06)",
          color: "rgba(235,236,242,0.7)",
        }}
      >
        <div
          style={{
            width: "3.25rem",
            height: "3.25rem",
            borderRadius: 999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(255,255,255,0.08)",
          }}
        >
          <LayoutList size="1.625rem" strokeWidth={1.75} />
        </div>
        <ChevronRight size="1.5rem" strokeWidth={1.75} style={{ marginTop: "auto", marginBottom: "50vh", opacity: 0.6 }} />
      </div>

      {/* Dims the content while the rail is open. */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 31,
          background: "rgba(0,0,0,0.55)",
          opacity: isExpanded ? 1 : 0,
          transition: `opacity ${RAIL_TRANSITION}`,
          pointerEvents: "none",
        }}
      />

      <nav
        aria-label={`${title} categories`}
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          bottom: 0,
          width: CATEGORY_RAIL_EXPANDED_WIDTH,
          zIndex: 32,
          display: "flex",
          flexDirection: "column",
          padding: "1.75rem 1rem 1.5rem 1.5rem",
          boxSizing: "border-box",
          background: "#101117",
          boxShadow: "2rem 0 4rem rgba(0,0,0,0.5)",
          transform: isExpanded ? "translateX(0)" : "translateX(-100%)",
          transition: `transform ${RAIL_TRANSITION}`,
        }}
      >
        <div style={{ fontSize: TV_HEADING, fontWeight: 800, color: "#fff", padding: "0 1.25rem 1.25rem" }}>{title}</div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: "0.5rem" }}>
          {items.map((item, index) => (
            <div key={item.id}>
              {sectionBreakAt !== undefined && index === sectionBreakAt && (
                <div
                  style={{
                    fontSize: "1rem",
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "rgba(235,236,242,0.45)",
                    padding: "1.25rem 1.25rem 0.5rem",
                  }}
                >
                  Categories
                </div>
              )}
              <CategoryRailRow item={item} isActive={item.id === activeId} onSelect={handleSelect} />
            </div>
          ))}
        </div>
      </nav>
    </>
  );
}

/**
 * One rail row. Focused: a bright, solid row (the tvOS list focus
 * convention — unmistakable from across the room). Active (the category
 * currently shown): white bold text with an accent bar, so it's findable
 * even when focus is elsewhere in the list.
 */
const CategoryRailRow = memo(function CategoryRailRow({
  item,
  isActive,
  onSelect,
}: {
  item: CategoryRailItem;
  isActive: boolean;
  onSelect: (id: string) => void;
}): JSX.Element {
  const isFocused = useIsFocused(categoryRailItemId(item.id));

  return (
    <Focusable id={categoryRailItemId(item.id)} style={{ height: "auto" }}>
      <button
        type="button"
        onClick={() => onSelect(item.id)}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          width: "100%",
          padding: "0.875rem 1.25rem",
          marginBottom: "0.25rem",
          border: "none",
          borderRadius: "0.875rem",
          textAlign: "left",
          fontSize: TV_TEXT,
          fontWeight: isActive || isFocused ? 700 : 500,
          background: isFocused ? "rgba(255,255,255,0.94)" : "transparent",
          color: isFocused ? "#0b0c10" : isActive ? "#ffffff" : "rgba(235,236,242,0.7)",
          cursor: "pointer",
        }}
      >
        {isActive && !isFocused && (
          <span
            aria-hidden
            style={{ position: "absolute", left: 0, top: "25%", bottom: "25%", width: "0.25rem", borderRadius: 999, background: "var(--accent, #38bdf8)" }}
          />
        )}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
        {item.count !== undefined && <span style={{ fontSize: "1.125rem", fontWeight: 600, opacity: 0.6, flexShrink: 0 }}>{item.count}</span>}
      </button>
    </Focusable>
  );
});
