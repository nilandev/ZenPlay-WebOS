import { useEffect } from "react";
import { ChevronDown } from "lucide-react";
import type { FocusNode } from "../focus/focus-store.js";
import { Focusable } from "../focus/Focusable.js";
import { useFocusStore } from "../focus/focus-store.js";
import { buildListFocusGraph } from "../focus/build-grid-graph.js";
import { glassBlur } from "../perf-tier.js";

export interface CategoryDropdownItem {
  id: string;
  label: string;
  count?: number;
}

export interface CategoryDropdownProps {
  items: CategoryDropdownItem[];
  activeId: string;
  activeLabel: string;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSelect: (id: string) => void;
  /** Focus id to land on when the user presses down from the trigger while the panel is closed — typically the content grid/shelf's first item. */
  contentEntryId?: string;
  /** Focus id to land on when the user presses right from the trigger — e.g. a search field sharing the same top bar. */
  rightEntryId?: string;
}

/** Exported so a caller's own content focus graph can point its top row's "up" neighbor here — see CategoryDropdown's doc comment. */
export const CATEGORY_DROPDOWN_TRIGGER_ID = "category-dropdown:trigger";
const TRIGGER_ID = CATEGORY_DROPDOWN_TRIGGER_ID;
const PANEL_SCOPE = "chrome:category-dropdown-panel";
const itemId = (id: string) => `category-dropdown:item:${id}`;

/**
 * Netflix-style category filter: a pill trigger ("Category ▾") pinned at
 * the top of the content area so it's always the first thing reachable by
 * pressing Up from anywhere in the grid/shelves below, opening a full-width
 * overlay list of every category. Selecting one is the caller's cue to
 * switch from the shelf browser into a single flat grid for that category
 * (see SeriesScreen) — this component only owns the open/closed panel and
 * which id is chosen, not how the results are laid out.
 *
 * The trigger registers in the caller's own content focus scope (so up/down
 * chains naturally with the grid beneath it); the open panel registers its
 * own scope on top, restored to the trigger's scope on close, so back/escape
 * from the panel can't land focus somewhere unrelated in the content grid.
 */
export function CategoryDropdown({
  items,
  activeId,
  activeLabel,
  isOpen,
  onOpen,
  onClose,
  onSelect,
  contentEntryId,
  rightEntryId,
}: CategoryDropdownProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focus = useFocusStore((state) => state.focus);
  const focusedId = useFocusStore((state) => state.focusedId);

  // Trigger's own node lives in the caller's persistent scope (registered
  // here, but under a stable id) so it's reachable from the grid via up
  // even when the panel is closed and this effect's panel-scope isn't set.
  useEffect(() => {
    const node: FocusNode = {
      id: TRIGGER_ID,
      neighbors: { down: !isOpen ? contentEntryId : undefined, right: !isOpen ? rightEntryId : undefined },
      onSelect: () => (isOpen ? onClose() : onOpen()),
    };
    setGraph("chrome:category-dropdown-trigger", [node]);
    return () => clearGraph("chrome:category-dropdown-trigger");
  }, [isOpen, contentEntryId, rightEntryId, onOpen, onClose, setGraph, clearGraph]);

  useEffect(() => {
    if (!isOpen) return;
    const ids = items.map((item) => itemId(item.id));
    const nodes = buildListFocusGraph(ids).map((node, index) => ({
      ...node,
      neighbors: { ...node.neighbors, up: index === 0 ? TRIGGER_ID : node.neighbors.up },
      onSelect: () => onSelect(items[index].id),
    }));
    const activeIndex = items.findIndex((item) => item.id === activeId);
    setGraph(PANEL_SCOPE, nodes, ids[Math.max(activeIndex, 0)]);
    focus(ids[Math.max(activeIndex, 0)] ?? TRIGGER_ID);
    return () => clearGraph(PANEL_SCOPE);
    // items/activeId/onSelect are expected to be stable-ish per open; re-opening remounts this effect via isOpen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const isTriggerFocused = focusedId === TRIGGER_ID;

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <Focusable id={TRIGGER_ID}>
        <button
          type="button"
          onClick={() => (isOpen ? onClose() : onOpen())}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 18px",
            borderRadius: 999,
            border: isTriggerFocused || isOpen ? "1px solid rgba(255,255,255,0.6)" : "1px solid rgba(255,255,255,0.16)",
            background: isTriggerFocused
              ? "linear-gradient(160deg, rgba(70,74,84,0.85) 0%, rgba(38,40,48,0.9) 100%)"
              : "linear-gradient(160deg, rgba(55,58,68,0.6) 0%, rgba(28,30,36,0.65) 100%)",
            ...glassBlur("blur(16px) saturate(140%)"),
            color: "var(--text, #f4f4f6)",
            fontSize: 16,
            fontWeight: 700,
            transform: isTriggerFocused ? "scale(1.05)" : "scale(1)",
            boxShadow: isTriggerFocused
              ? "inset 0 1px 0 rgba(255,255,255,0.3), 0 0 0 3px var(--accent, #38bdf8), 0 12px 28px -8px rgba(0,0,0,0.6)"
              : "inset 0 1px 0 rgba(255,255,255,0.1), 0 6px 16px -6px rgba(0,0,0,0.5)",
            transition: "transform 160ms ease-out, box-shadow 160ms ease-out, background 160ms ease-out",
            whiteSpace: "nowrap",
          }}
        >
          {activeLabel}
          <ChevronDown size={18} style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 160ms ease-out" }} />
        </button>
      </Focusable>

      {isOpen && (
        <>
          <div
            onClick={onClose}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 29 }}
          />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 10px)",
              left: 0,
              zIndex: 30,
              minWidth: 280,
              maxHeight: "60vh",
              overflowY: "auto",
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(24,24,30,0.96)",
              ...glassBlur("blur(24px) saturate(160%)"),
              boxShadow: "0 20px 48px rgba(0,0,0,0.55)",
              padding: 8,
            }}
          >
            {items.map((item) => (
              <CategoryDropdownRow
                key={item.id}
                id={itemId(item.id)}
                item={item}
                isActive={item.id === activeId}
                onSelect={() => onSelect(item.id)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CategoryDropdownRow({
  id,
  item,
  isActive,
  onSelect,
}: {
  id: string;
  item: CategoryDropdownItem;
  isActive: boolean;
  onSelect: () => void;
}): JSX.Element {
  const isFocused = useFocusStore((state) => state.focusedId === id);

  return (
    <Focusable id={id}>
      <div
        role="button"
        tabIndex={-1}
        onClick={onSelect}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "14px 16px",
          borderRadius: 10,
          marginBottom: 2,
          cursor: "pointer",
          background: isFocused ? "var(--accent, #38bdf8)" : isActive ? "var(--surface-raised, #24242c)" : "transparent",
          color: isFocused ? "#062028" : "var(--text, #f4f4f6)",
          fontWeight: isActive || isFocused ? 700 : 500,
          fontSize: 17,
          transition: "background 120ms ease-out",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
        {item.count !== undefined && (
          <span style={{ fontSize: 13, opacity: 0.7, marginLeft: 12 }}>{item.count}</span>
        )}
      </div>
    </Focusable>
  );
}
