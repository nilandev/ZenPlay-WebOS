import { create } from "zustand";

export type FocusDirection = "up" | "down" | "left" | "right";

export interface FocusNode {
  id: string;
  /** Precomputed neighbor ids per direction. Undefined means "no neighbor / edge of grid". */
  neighbors: Partial<Record<FocusDirection, string>>;
}

interface FocusState {
  /** All focusable nodes for the currently mounted screen, keyed by id. */
  nodes: Record<string, FocusNode>;
  focusedId: string | null;

  setGraph: (nodes: FocusNode[], initialFocusId?: string) => void;
  clearGraph: () => void;
  move: (direction: FocusDirection) => void;
  focus: (id: string) => void;
}

/**
 * Central focus graph store. Screens register a precomputed set of nodes
 * (e.g. a channel grid's rows/columns) up front via setGraph(), so that
 * every arrow-key press is an O(1) lookup instead of a DOM geometry scan.
 * This is what keeps D-pad navigation feeling instant on weak TV CPUs.
 */
export const useFocusStore = create<FocusState>((set, get) => ({
  nodes: {},
  focusedId: null,

  setGraph: (nodes, initialFocusId) => {
    const byId: Record<string, FocusNode> = {};
    for (const node of nodes) byId[node.id] = node;
    const initial = initialFocusId && byId[initialFocusId] ? initialFocusId : (nodes[0]?.id ?? null);
    set({ nodes: byId, focusedId: initial });
  },

  clearGraph: () => set({ nodes: {}, focusedId: null }),

  move: (direction) => {
    const { nodes, focusedId } = get();
    if (!focusedId) return;
    const current = nodes[focusedId];
    if (!current) return;
    const nextId = current.neighbors[direction];
    if (nextId && nodes[nextId]) {
      set({ focusedId: nextId });
    }
  },

  focus: (id) => {
    const { nodes } = get();
    if (nodes[id]) set({ focusedId: id });
  },
}));
