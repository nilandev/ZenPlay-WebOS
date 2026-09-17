import type { FocusNode } from "./focus-store.js";

/**
 * Builds a focus graph across multiple horizontally-scrolling shelves of
 * possibly different lengths (Apple TV browse-screen layout). Left/right
 * move within a shelf; up/down move to the item in the adjacent shelf at
 * the nearest column index (clamped), matching what people expect when
 * shelves aren't the same length.
 */
export function buildShelfFocusGraph(shelves: string[][]): FocusNode[] {
  const nodes: FocusNode[] = [];

  shelves.forEach((row, rowIndex) => {
    row.forEach((id, colIndex) => {
      const neighbors: FocusNode["neighbors"] = {};

      if (colIndex > 0) neighbors.left = row[colIndex - 1];
      if (colIndex < row.length - 1) neighbors.right = row[colIndex + 1];

      if (rowIndex > 0) {
        const aboveRow = shelves[rowIndex - 1];
        neighbors.up = aboveRow[Math.min(colIndex, aboveRow.length - 1)];
      }
      if (rowIndex < shelves.length - 1) {
        const belowRow = shelves[rowIndex + 1];
        neighbors.down = belowRow[Math.min(colIndex, belowRow.length - 1)];
      }

      nodes.push({ id, neighbors });
    });
  });

  return nodes;
}
