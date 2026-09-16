import { describe, expect, it } from "vitest";
import { buildShelfFocusGraph } from "./build-shelf-graph.js";

describe("buildShelfFocusGraph", () => {
  it("connects left/right within a single shelf", () => {
    const graph = buildShelfFocusGraph([["a", "b", "c"]]);
    const byId = Object.fromEntries(graph.map((n) => [n.id, n]));
    expect(byId.b.neighbors).toEqual({ left: "a", right: "c" });
    expect(byId.a.neighbors.left).toBeUndefined();
    expect(byId.c.neighbors.right).toBeUndefined();
  });

  it("connects up/down across shelves of equal length by column index", () => {
    const graph = buildShelfFocusGraph([
      ["a1", "a2"],
      ["b1", "b2"],
    ]);
    const byId = Object.fromEntries(graph.map((n) => [n.id, n]));
    expect(byId.a1.neighbors.down).toBe("b1");
    expect(byId.a2.neighbors.down).toBe("b2");
    expect(byId.b1.neighbors.up).toBe("a1");
  });

  it("clamps to the last item when the adjacent shelf is shorter", () => {
    const graph = buildShelfFocusGraph([
      ["a1", "a2", "a3"],
      ["b1"],
    ]);
    const byId = Object.fromEntries(graph.map((n) => [n.id, n]));
    expect(byId.a3.neighbors.down).toBe("b1");
    expect(byId.a2.neighbors.down).toBe("b1");
  });

  it("has no up neighbor for the first shelf and no down neighbor for the last", () => {
    const graph = buildShelfFocusGraph([["a"], ["b"], ["c"]]);
    const byId = Object.fromEntries(graph.map((n) => [n.id, n]));
    expect(byId.a.neighbors.up).toBeUndefined();
    expect(byId.c.neighbors.down).toBeUndefined();
    expect(byId.b.neighbors.up).toBe("a");
    expect(byId.b.neighbors.down).toBe("c");
  });

  it("handles an empty shelves list", () => {
    expect(buildShelfFocusGraph([])).toEqual([]);
  });
});
