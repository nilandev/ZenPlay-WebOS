import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFocusStore } from "./focus-store.js";
import { buildGridFocusGraph } from "./build-grid-graph.js";

describe("useFocusStore", () => {
  beforeEach(() => {
    useFocusStore.getState().clearGraph("content");
    useFocusStore.getState().clearGraph("chrome");
  });

  it("defaults focus to the first node when no initial id is given", () => {
    useFocusStore.getState().setGraph("content", buildGridFocusGraph(["a", "b", "c"], 3));
    expect(useFocusStore.getState().focusedId).toBe("a");
  });

  it("respects an explicit initial focus id", () => {
    useFocusStore.getState().setGraph("content", buildGridFocusGraph(["a", "b", "c"], 3), "b");
    expect(useFocusStore.getState().focusedId).toBe("b");
  });

  it("moves focus in the requested direction when a neighbor exists", () => {
    useFocusStore.getState().setGraph("content", buildGridFocusGraph(["a", "b", "c", "d"], 2));
    useFocusStore.getState().move("right");
    expect(useFocusStore.getState().focusedId).toBe("b");
    useFocusStore.getState().move("down");
    expect(useFocusStore.getState().focusedId).toBe("d");
  });

  it("does nothing when moving past the edge of the graph", () => {
    useFocusStore.getState().setGraph("content", buildGridFocusGraph(["a", "b"], 2));
    useFocusStore.getState().move("left");
    expect(useFocusStore.getState().focusedId).toBe("a");
  });

  it("ignores move() calls when no graph is set", () => {
    expect(() => useFocusStore.getState().move("up")).not.toThrow();
    expect(useFocusStore.getState().focusedId).toBeNull();
  });

  it("focus() only succeeds for ids present in the current graph", () => {
    useFocusStore.getState().setGraph("content", buildGridFocusGraph(["a", "b"], 2));
    useFocusStore.getState().focus("b");
    expect(useFocusStore.getState().focusedId).toBe("b");
    useFocusStore.getState().focus("nonexistent");
    expect(useFocusStore.getState().focusedId).toBe("b");
  });

  it("clearGraph resets focus only when the cleared scope held the focused node", () => {
    useFocusStore.getState().setGraph("content", buildGridFocusGraph(["a", "b"], 2));
    useFocusStore.getState().clearGraph("content");
    expect(useFocusStore.getState().focusedId).toBeNull();
    expect(useFocusStore.getState().scopes.content).toBeUndefined();
  });

  it("keeps two scopes independent: setting one does not clobber the other", () => {
    useFocusStore.getState().setGraph("chrome", buildGridFocusGraph(["nav-a", "nav-b"], 2), "nav-a");
    useFocusStore.getState().setGraph("content", buildGridFocusGraph(["c-a", "c-b"], 2));
    // content's setGraph ran after chrome's and has no matching initial id
    // overlap, so focus moves to content's first node — but chrome's nodes
    // must still be reachable via move()/focus().
    useFocusStore.getState().focus("nav-b");
    expect(useFocusStore.getState().focusedId).toBe("nav-b");
    useFocusStore.getState().focus("c-a");
    expect(useFocusStore.getState().focusedId).toBe("c-a");
  });

  it("clearing one scope leaves the other scope's focus intact", () => {
    useFocusStore.getState().setGraph("chrome", buildGridFocusGraph(["nav-a"], 1), "nav-a");
    useFocusStore.getState().setGraph("content", buildGridFocusGraph(["c-a"], 1));
    useFocusStore.getState().focus("nav-a");
    useFocusStore.getState().clearGraph("content");
    expect(useFocusStore.getState().focusedId).toBe("nav-a");
  });

  it("select() invokes the focused node's onSelect callback", () => {
    const onSelect = vi.fn();
    useFocusStore.getState().setGraph("content", [{ id: "a", neighbors: {}, onSelect }], "a");
    useFocusStore.getState().select();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("select() is a no-op when the focused node has no onSelect callback", () => {
    useFocusStore.getState().setGraph("content", buildGridFocusGraph(["a"], 1));
    expect(() => useFocusStore.getState().select()).not.toThrow();
  });
});
