import type { FocusNode } from "./focus-store.js";

/**
 * Builds a rectangular grid focus graph from a row-major list of ids.
 * `columns` controls wrapping: moving right off the last column of a row
 * does not wrap to the next row (matches expected TV grid behavior).
 * Ragged final rows (fewer items than `columns`) are supported.
 */
export function buildGridFocusGraph(ids: string[], columns: number): FocusNode[] {
  return ids.map((id, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    const neighbors: FocusNode["neighbors"] = {};

    if (col > 0) neighbors.left = ids[index - 1];
    if (col < columns - 1 && index + 1 < ids.length) neighbors.right = ids[index + 1];

    const upIndex = index - columns;
    if (upIndex >= 0) neighbors.up = ids[upIndex];

    const downIndex = index + columns;
    if (downIndex < ids.length) neighbors.down = ids[downIndex];

    return { id, neighbors };
  });
}

/** Builds a single-column (vertical list) focus graph, e.g. a sidebar or settings menu. */
export function buildListFocusGraph(ids: string[]): FocusNode[] {
  return buildGridFocusGraph(ids, 1).map((node, index) => ({
    ...node,
    neighbors: {
      up: index > 0 ? ids[index - 1] : undefined,
      down: index < ids.length - 1 ? ids[index + 1] : undefined,
    },
  }));
}
