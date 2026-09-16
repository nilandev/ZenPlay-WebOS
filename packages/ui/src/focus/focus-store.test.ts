import { beforeEach, describe, expect, it } from "vitest";
import { useFocusStore } from "./focus-store.js";
import { buildGridFocusGraph } from "./build-grid-graph.js";

describe("useFocusStore", () => {
  beforeEach(() => {
    useFocusStore.getState().clearGraph();
  });

  it("defaults focus to the first node when no initial id is given", () => {
    useFocusStore.getState().setGraph(buildGridFocusGraph(["a", "b", "c"], 3));
    expect(useFocusStore.getState().focusedId).toBe("a");
  });

  it("respects an explicit initial focus id", () => {
    useFocusStore.getState().setGraph(buildGridFocusGraph(["a", "b", "c"], 3), "b");
    expect(useFocusStore.getState().focusedId).toBe("b");
  });

  it("moves focus in the requested direction when a neighbor exists", () => {
    useFocusStore.getState().setGraph(buildGridFocusGraph(["a", "b", "c", "d"], 2));
    useFocusStore.getState().move("right");
    expect(useFocusStore.getState().focusedId).toBe("b");
    useFocusStore.getState().move("down");
    expect(useFocusStore.getState().focusedId).toBe("d");
  });

  it("does nothing when moving past the edge of the graph", () => {
    useFocusStore.getState().setGraph(buildGridFocusGraph(["a", "b"], 2));
    useFocusStore.getState().move("left");
    expect(useFocusStore.getState().focusedId).toBe("a");
  });

  it("ignores move() calls when no graph is set", () => {
    expect(() => useFocusStore.getState().move("up")).not.toThrow();
    expect(useFocusStore.getState().focusedId).toBeNull();
  });

  it("focus() only succeeds for ids present in the current graph", () => {
    useFocusStore.getState().setGraph(buildGridFocusGraph(["a", "b"], 2));
    useFocusStore.getState().focus("b");
    expect(useFocusStore.getState().focusedId).toBe("b");
    useFocusStore.getState().focus("nonexistent");
    expect(useFocusStore.getState().focusedId).toBe("b");
  });

  it("clearGraph resets nodes and focus", () => {
    useFocusStore.getState().setGraph(buildGridFocusGraph(["a", "b"], 2));
    useFocusStore.getState().clearGraph();
    expect(useFocusStore.getState().focusedId).toBeNull();
    expect(useFocusStore.getState().nodes).toEqual({});
  });
});
