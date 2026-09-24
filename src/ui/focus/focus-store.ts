import { create } from "zustand";

export type FocusDirection = "up" | "down" | "left" | "right";

export interface FocusNode {
  id: string;
  /** Precomputed neighbor ids per direction. Undefined means "no neighbor / edge of grid". */
  neighbors: Partial<Record<FocusDirection, string>>;
  /** Optional: invoked when this node is selected, instead of the screen inspecting focusedId itself. */
  onSelect?: () => void;
}

interface FocusState {
  /**
   * Node maps keyed by scope, merged into one flat lookup for move()/focus().
   * Scopes let persistent chrome (e.g. a top nav bar) and the current
   * screen's content coexist without one's setGraph() call wiping out the
   * other — each owner registers under its own scope key and clears only
   * that scope on unmount.
   */
  scopes: Record<string, Record<string, FocusNode>>;
  /**
   * Every scope's nodes merged into one lookup — rebuilt only when a graph
   * is set/cleared, never per key press, so move()/focus()/select() stay
   * O(1) even with thousand-row channel lists registered. (Re-flattening
   * inside move() used to allocate a full copy of every node on every
   * D-pad press, which on TV-class CPUs showed up as input lag.)
   */
  nodes: Record<string, FocusNode>;
  focusedId: string | null;

  setGraph: (scope: string, nodes: FocusNode[], initialFocusId?: string) => void;
  clearGraph: (scope: string) => void;
  move: (direction: FocusDirection) => void;
  focus: (id: string) => void;
  select: () => void;
}

function flattenNodes(scopes: Record<string, Record<string, FocusNode>>): Record<string, FocusNode> {
  const flat: Record<string, FocusNode> = {};
  for (const scopeNodes of Object.values(scopes)) {
    Object.assign(flat, scopeNodes);
  }
  return flat;
}

/**
 * Central focus graph store. Screens register a precomputed set of nodes
 * (e.g. a channel grid's rows/columns) up front via setGraph(), so that
 * every arrow-key press is an O(1) lookup instead of a DOM geometry scan.
 * This is what keeps D-pad navigation feeling instant on weak TV CPUs.
 */
export const useFocusStore = create<FocusState>((set, get) => ({
  scopes: {},
  nodes: {},
  focusedId: null,

  setGraph: (scope, nodes, initialFocusId) => {
    const byId: Record<string, FocusNode> = {};
    for (const node of nodes) byId[node.id] = node;

    set((state) => {
      const scopes = { ...state.scopes, [scope]: byId };
      const flat = flattenNodes(scopes);
      const currentStillValid = state.focusedId && flat[state.focusedId];
      const initial = initialFocusId && byId[initialFocusId] ? initialFocusId : (nodes[0]?.id ?? null);
      return { scopes, nodes: flat, focusedId: currentStillValid ? state.focusedId : initial };
    });
  },

  clearGraph: (scope) => {
    set((state) => {
      const scopes = { ...state.scopes };
      delete scopes[scope];
      const flat = flattenNodes(scopes);
      const currentStillValid = state.focusedId && flat[state.focusedId];
      return { scopes, nodes: flat, focusedId: currentStillValid ? state.focusedId : null };
    });
  },

  move: (direction) => {
    const { nodes, focusedId } = get();
    if (!focusedId) return;
    const nextId = nodes[focusedId]?.neighbors[direction];
    if (nextId && nodes[nextId]) {
      set({ focusedId: nextId });
    }
  },

  focus: (id) => {
    if (get().nodes[id]) set({ focusedId: id });
  },

  select: () => {
    const { nodes, focusedId } = get();
    if (!focusedId) return;
    nodes[focusedId]?.onSelect?.();
  },
}));
