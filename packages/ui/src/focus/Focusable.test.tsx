import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Focusable } from "./Focusable.js";

describe("Focusable", () => {
  it("stretches to fill its parent instead of collapsing to auto height", () => {
    // Regression test: Focusable's wrapper div previously had no explicit
    // size, so a child button using height: 100% (e.g. EpgGrid's
    // ProgrammeCell inside an absolutely-positioned, top/bottom-inset
    // parent) resolved against an auto-height ancestor and collapsed to
    // 0px, making the button visually present but unclickable.
    render(
      <Focusable id="a">
        <button style={{ width: "100%", height: "100%" }}>Click me</button>
      </Focusable>,
    );

    const wrapper = screen.getByText("Click me").closest("[data-focus-id='a']") as HTMLElement;
    expect(wrapper.style.width).toBe("100%");
    expect(wrapper.style.height).toBe("100%");
  });

  it("still renders children and exposes the focus id as a data attribute", () => {
    render(
      <Focusable id="channel-1">
        <span>BBC One</span>
      </Focusable>,
    );
    expect(screen.getByText("BBC One").closest("[data-focus-id='channel-1']")).not.toBeNull();
  });
});
