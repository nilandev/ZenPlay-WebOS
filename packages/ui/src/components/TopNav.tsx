import { useEffect } from "react";
import { buildListFocusGraph } from "../focus/build-grid-graph.js";
import { useFocusStore } from "../focus/focus-store.js";

export interface TopNavItem {
  id: string;
  label: string;
}

export interface TopNavProps {
  items: readonly TopNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
}

const SCOPE = "chrome:top-nav";

/**
 * Apple TV-style top tab bar: a slim row of section labels, active one
 * underlined, focus indicated by a subtle scale + brightness bump rather
 * than a heavy outline (kept minimal since it's persistent chrome, not the
 * primary content). Registers under the "chrome" focus scope so it
 * survives screen navigation without being clobbered by the active
 * screen's own setGraph() call (see focus-store.ts scopes).
 */
export function TopNav({ items, activeId, onSelect }: TopNavProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focusedId = useFocusStore((state) => state.focusedId);

  useEffect(() => {
    const ids = items.map((item) => item.id);
    const nodes = buildListFocusGraph(ids).map((node, index) => ({
      ...node,
      // Tabs are laid out horizontally, so left/right (not up/down) move between them.
      neighbors: { left: ids[index - 1], right: ids[index + 1] },
      onSelect: () => onSelect(items[index].id),
    }));
    setGraph(SCOPE, nodes);
    return () => clearGraph(SCOPE);
    // Re-registering on every onSelect identity change would thrash the
    // graph; items/onSelect are expected to be stable references from App.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, setGraph, clearGraph]);

  return (
    <nav style={{ display: "flex", gap: 28, padding: "20px 40px 0" }}>
      {items.map((item) => {
        const isFocused = focusedId === item.id;
        const isActive = activeId === item.id;
        return (
          <button
            key={item.id}
            type="button"
            data-focus-id={item.id}
            onClick={() => onSelect(item.id)}
            style={{
              background: "transparent",
              border: "none",
              padding: "6px 2px",
              fontSize: 17,
              fontWeight: isActive ? 700 : 500,
              color: isActive ? "#fff" : "#a0a0a8",
              transform: isFocused ? "scale(1.08)" : "scale(1)",
              borderBottom: isActive ? "2px solid #fff" : "2px solid transparent",
              transition: "transform 140ms ease-out, color 140ms ease-out",
            }}
          >
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
