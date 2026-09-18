import { useEffect } from "react";
import { Focusable } from "../focus/Focusable.js";
import { buildListFocusGraph } from "../focus/build-grid-graph.js";
import { useFocusStore } from "../focus/focus-store.js";

export interface CategorySidebarItem {
  id: string;
  label: string;
  count?: number;
}

export interface CategorySidebarProps {
  items: CategorySidebarItem[];
  activeId: string;
  onSelect: (id: string) => void;
  width?: number;
  /** Focus id to jump to when the user presses right from any sidebar item — typically the content area's first focusable node. */
  contentEntryId?: string;
}

const SCOPE = "chrome:category-sidebar";

/**
 * Persistent vertical category sub-nav (e.g. EPG "All Channels" / "Sports" /
 * "News"). Registers under its own chrome scope like TopNav, so it survives
 * next to whatever the main content area (channel/programme grid) puts in
 * the "content" scope — see focus-store.ts for how scopes compose.
 */
export function CategorySidebar({ items, activeId, onSelect, width = 200, contentEntryId }: CategorySidebarProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focusedId = useFocusStore((state) => state.focusedId);

  useEffect(() => {
    const ids = items.map((item) => item.id);
    const nodes = buildListFocusGraph(ids).map((node, index) => ({
      ...node,
      neighbors: { ...node.neighbors, right: contentEntryId },
      onSelect: () => onSelect(items[index].id),
    }));
    setGraph(SCOPE, nodes);
    return () => clearGraph(SCOPE);
    // items/onSelect are expected to be stable references from the owning screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, contentEntryId, setGraph, clearGraph]);

  return (
    <div
      style={{
        width,
        flexShrink: 0,
        borderRight: "1px solid var(--border, #313139)",
        overflowY: "auto",
        padding: "12px 8px",
      }}
    >
      {items.map((item) => {
        const isFocused = focusedId === item.id;
        const isActive = activeId === item.id;
        return (
          <Focusable key={item.id} id={item.id}>
            <button
              type="button"
              onClick={() => onSelect(item.id)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                width: "100%",
                textAlign: "left",
                padding: "10px 12px",
                marginBottom: 4,
                borderRadius: 8,
                border: "none",
                background: isFocused ? "var(--accent, #38bdf8)" : isActive ? "var(--surface-raised, #24242c)" : "transparent",
                color: isFocused ? "#062028" : isActive ? "var(--text, #f4f4f6)" : "var(--text-dim, #9a9aa4)",
                fontWeight: isActive || isFocused ? 700 : 500,
                fontSize: 14,
                transform: isFocused ? "scale(1.03)" : "scale(1)",
                transition: "transform 120ms ease-out, background 120ms ease-out",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
              {item.count !== undefined && (
                <span style={{ fontSize: 11, opacity: 0.7, marginLeft: 8 }}>{item.count}</span>
              )}
            </button>
          </Focusable>
        );
      })}
    </div>
  );
}
