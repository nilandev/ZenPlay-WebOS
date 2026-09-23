import { useEffect } from "react";
import type { LucideIcon } from "lucide-react";
import { Focusable } from "../focus/Focusable.js";
import { buildListFocusGraph } from "../focus/build-grid-graph.js";
import { useFocusStore } from "../focus/focus-store.js";

export interface SidebarDestination {
  id: string;
  label: string;
  icon: LucideIcon;
}

const SCOPE = "home-sidebar";

export interface HomeSidebarProps {
  destinations: SidebarDestination[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Focus id to jump to when the user presses Right from any sidebar item — whichever content column currently sits leftmost (the hero's Play button when present, else the first content tile). */
  rightEntryId?: string;
}

/**
 * Fixed-width left navigation column for HomeScreen — Home/Live TV/Movies/
 * Series/Favorites/Settings. Deliberately scoped to HomeScreen's own layout
 * (registered/cleared with it, like every other HomeScreen focus scope)
 * rather than persistent app-level chrome shared across screens — see
 * docs/Home Page Redesign.md's updated sidebar requirement. Left from any
 * content column reaches here (via that column's own leftEntryId wiring,
 * same pattern as ChannelSidebar/CategorySidebar); Right from here returns
 * to rightEntryId.
 */
export function HomeSidebar({ destinations, activeId, onSelect, rightEntryId }: HomeSidebarProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focusedId = useFocusStore((state) => state.focusedId);

  // No initialFocusId passed to setGraph — the content column (HomeScreen's
  // own SCOPE, registered separately) should own where focus starts, not
  // this sidebar. setGraph only falls back to nodes[0] as initial focus
  // when focusedId isn't already valid in the merged scopes (see
  // focus-store.ts); since HomeScreen's content registers its own initial
  // focus too, whichever of these two sibling effects fires second would
  // otherwise win that race non-deterministically — omitting it here makes
  // the outcome deterministic regardless of effect order.
  useEffect(() => {
    const ids = destinations.map((d) => d.id);
    const nodes = buildListFocusGraph(ids).map((node, index) => ({
      ...node,
      neighbors: { ...node.neighbors, right: rightEntryId },
      onSelect: () => onSelect(destinations[index].id),
    }));
    setGraph(SCOPE, nodes);
    return () => clearGraph(SCOPE);
    // destinations/onSelect are expected to be stable-enough references from the owning screen, same convention as ChannelSidebar/CategorySidebar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinations, rightEntryId, setGraph, clearGraph]);

  return (
    <nav
      style={{
        width: "17rem",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: "0.625rem",
        padding: "0.5rem 1rem",
      }}
    >
      {destinations.map((destination) => {
        const isFocused = focusedId === destination.id;
        const isActive = activeId === destination.id;
        const Icon = destination.icon;
        return (
          <Focusable key={destination.id} id={destination.id} style={{ height: "auto" }}>
            <button
              type="button"
              onClick={() => onSelect(destination.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.875rem",
                width: "100%",
                textAlign: "left",
                padding: "0.875rem 1.125rem",
                borderRadius: "1rem",
                border: isFocused ? "1px solid rgba(255,255,255,0.55)" : "1px solid transparent",
                background: isFocused
                  ? "linear-gradient(160deg, rgba(52,54,60,0.75) 0%, rgba(20,21,25,0.8) 100%)"
                  : isActive
                    ? "rgba(255,255,255,0.06)"
                    : "transparent",
                color: isFocused || isActive ? "var(--text)" : "var(--text-dim)",
                fontWeight: isFocused || isActive ? 700 : 500,
                fontSize: "1.0625rem",
                transform: isFocused ? "scale(1.05)" : "scale(1)",
                boxShadow: isFocused ? "0 0 0 3px var(--accent), 0 0.5rem 1rem -0.5rem rgba(0,0,0,0.5)" : "none",
                transition:
                  "transform 250ms cubic-bezier(0.25, 1, 0.5, 1), border-color 250ms cubic-bezier(0.25, 1, 0.5, 1), box-shadow 250ms cubic-bezier(0.25, 1, 0.5, 1), background 250ms cubic-bezier(0.25, 1, 0.5, 1)",
                cursor: "pointer",
              }}
            >
              <Icon size="1.5rem" strokeWidth={1.75} />
              {destination.label}
            </button>
          </Focusable>
        );
      })}
    </nav>
  );
}
