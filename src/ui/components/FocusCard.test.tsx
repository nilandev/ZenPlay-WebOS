import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useFocusStore } from "../focus/focus-store.js";
import { FocusCard } from "./FocusCard.js";

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  useFocusStore.getState().clearGraph("test");
});

describe("FocusCard", () => {
  it("scales to 1.05 and transitions transform/border-color/box-shadow over 250ms with the spec'd easing on focus gain", () => {
    const { container } = render(<FocusCard id="card-1" title="Some Movie" />);
    act(() => {
      useFocusStore.getState().setGraph("test", [{ id: "card-1", neighbors: {} }], "card-1");
    });

    const card = container.querySelector('[role="button"]') as HTMLElement;
    expect(card.style.transform).toBe("scale(1.05)");
    expect(card.style.transition).toContain("transform 250ms cubic-bezier(0.25, 1, 0.5, 1)");
    expect(card.style.transition).toContain("border-color 250ms cubic-bezier(0.25, 1, 0.5, 1)");
    expect(card.style.transition).toContain("box-shadow 250ms cubic-bezier(0.25, 1, 0.5, 1)");
  });

  it("renders no scale/border highlight when unfocused", () => {
    const { container } = render(<FocusCard id="card-2" title="Some Movie" />);
    const card = container.querySelector('[role="button"]') as HTMLElement;
    expect(card.style.transform).toBe("scale(1)");
  });

  it("renders a progress bar filled to the given fraction when progress is set", () => {
    const { container } = render(<FocusCard id="card-3" title="Some Movie" progress={0.4} />);
    const filledBar = Array.from(container.querySelectorAll("div")).find((el) => el.style.width === "40%");
    expect(filledBar).toBeTruthy();
  });

  it("renders no progress bar when progress is omitted", () => {
    const { container } = render(<FocusCard id="card-4" title="Some Movie" />);
    const filledBar = Array.from(container.querySelectorAll("div")).find((el) => el.style.width.endsWith("%") && el.style.width !== "100%");
    expect(filledBar).toBeUndefined();
  });
});
