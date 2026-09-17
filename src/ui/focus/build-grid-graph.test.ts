import { describe, expect, it } from "vitest";
import { buildGridFocusGraph, buildListFocusGraph } from "./build-grid-graph.js";

describe("buildGridFocusGraph", () => {
  it("builds correct neighbors for a full 3x3 grid", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    const graph = buildGridFocusGraph(ids, 3);
    const byId = Object.fromEntries(graph.map((n) => [n.id, n]));

    expect(byId.e.neighbors).toEqual({ up: "b", down: "h", left: "d", right: "f" });
    expect(byId.a.neighbors).toEqual({ down: "d", right: "b" });
    expect(byId.i.neighbors).toEqual({ up: "f", left: "h" });
  });

  it("does not wrap right-edge movement to the next row", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const graph = buildGridFocusGraph(ids, 3);
    const byId = Object.fromEntries(graph.map((n) => [n.id, n]));
    expect(byId.c.neighbors.right).toBeUndefined();
    expect(byId.d.neighbors.left).toBeUndefined();
  });

  it("handles a ragged final row with fewer items than columns", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const graph = buildGridFocusGraph(ids, 3);
    const byId = Object.fromEntries(graph.map((n) => [n.id, n]));
    // Row 2 has only "d", "e" — "d" should have no right-neighbor beyond "e",
    // and no down-neighbor since there's no row 3.
    expect(byId.d.neighbors.right).toBe("e");
    expect(byId.d.neighbors.down).toBeUndefined();
    expect(byId.a.neighbors.down).toBe("d");
  });

  it("handles a single row", () => {
    const graph = buildGridFocusGraph(["a", "b"], 5);
    const byId = Object.fromEntries(graph.map((n) => [n.id, n]));
    expect(byId.a.neighbors).toEqual({ right: "b" });
    expect(byId.b.neighbors).toEqual({ left: "a" });
  });
});

describe("buildListFocusGraph", () => {
  it("builds a simple vertical chain", () => {
    const graph = buildListFocusGraph(["a", "b", "c"]);
    const byId = Object.fromEntries(graph.map((n) => [n.id, n]));
    expect(byId.a.neighbors).toEqual({ up: undefined, down: "b" });
    expect(byId.b.neighbors).toEqual({ up: "a", down: "c" });
    expect(byId.c.neighbors).toEqual({ up: "b", down: undefined });
  });
});
