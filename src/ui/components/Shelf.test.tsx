import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useFocusStore } from "../focus/focus-store.js";
import { Shelf } from "./Shelf.js";

const items = ["a", "b", "c", "d"];

describe("Shelf", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => {};
    useFocusStore.getState().setGraph(
      "test",
      items.map((id, i) => ({ id, neighbors: { left: items[i - 1], right: items[i + 1] } })),
      "a",
    );
  });

  afterEach(() => {
    useFocusStore.getState().clearGraph("test");
  });

  it("does not re-render its items when focus moves between them", () => {
    let renderCount = 0;
    render(
      <Shelf
        title="Row"
        items={items}
        getId={(id) => id}
        renderItem={(id) => {
          renderCount++;
          return <div data-focus-id={id}>{id}</div>;
        }}
      />,
    );
    const afterMount = renderCount;

    act(() => useFocusStore.getState().move("right"));
    act(() => useFocusStore.getState().move("right"));

    expect(useFocusStore.getState().focusedId).toBe("c");
    expect(renderCount).toBe(afterMount);
  });
});
