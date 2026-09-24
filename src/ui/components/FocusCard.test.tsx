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
  it("lifts Apple TV-style on focus: scales to 1.1 and fades in its shadow and sheen, with no outline ring", () => {
    const { container } = render(<FocusCard id="card-1" title="Some Movie" />);
    act(() => {
      useFocusStore.getState().setGraph("test", [{ id: "card-1", neighbors: {} }], "card-1");
    });

    const card = container.querySelector('[role="button"]') as HTMLElement;
    expect(card.style.transform).toBe("scale(1.1)");
    expect(card.style.transition).toBe("transform 300ms cubic-bezier(0.2, 0.9, 0.3, 1)");
    const shadow = container.querySelector('[data-testid="lift-shadow"]') as HTMLElement;
    const sheen = container.querySelector('[data-testid="lift-sheen"]') as HTMLElement;
    expect(shadow.style.opacity).toBe("1");
    expect(sheen.style.opacity).toBe("1");
    // Only compositor-friendly properties animate — no paint-triggering box-shadow/border transitions, no pinned layers.
    expect(shadow.style.transition).toBe("opacity 300ms cubic-bezier(0.2, 0.9, 0.3, 1)");
    expect(card.style.willChange).toBe("");
  });

  it("sits flat when unfocused", () => {
    const { container } = render(<FocusCard id="card-2" title="Some Movie" />);
    const card = container.querySelector('[role="button"]') as HTMLElement;
    expect(card.style.transform).toBe("scale(1)");
    expect((container.querySelector('[data-testid="lift-shadow"]') as HTMLElement).style.opacity).toBe("0");
    expect((container.querySelector('[data-testid="lift-sheen"]') as HTMLElement).style.opacity).toBe("0");
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
