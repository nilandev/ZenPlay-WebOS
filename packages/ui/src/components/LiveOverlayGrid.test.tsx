import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { Channel } from "@iptv/core";
import { LiveOverlayGrid } from "./LiveOverlayGrid.js";
import { useFocusStore } from "../focus/focus-store.js";

// jsdom doesn't implement scrollIntoView; Focusable calls it whenever a
// node becomes focused, which real browsers all support natively.
beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
});

// This package has no global test setup file wired into vitest.config.ts,
// so React Testing Library's auto-cleanup-after-each-test doesn't run
// implicitly — without this, each test's rendered DOM stacks on top of the
// previous one and text queries start matching multiple elements.
afterEach(() => {
  cleanup();
});

function makeChannels(count: number): Channel[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `ch-${i}`,
    name: `Channel ${i}`,
    streamUrl: `http://example.com/${i}.m3u8`,
    kind: "live" as const,
  }));
}

describe("LiveOverlayGrid", () => {
  beforeEach(() => {
    useFocusStore.getState().clearGraph("content");
  });

  afterEach(() => {
    useFocusStore.getState().clearGraph("content");
  });

  it("renders only the first two rows worth of channels initially", () => {
    // 5 columns, 2 visible rows => 10 channels visible out of 20 total.
    render(<LiveOverlayGrid channels={makeChannels(20)} columns={5} />);
    expect(screen.getByText("Channel 0")).toBeDefined();
    expect(screen.getByText("Channel 9")).toBeDefined();
    expect(screen.queryByText("Channel 10")).toBeNull();
  });

  it("slides the window down when focus moves past the visible rows", () => {
    render(<LiveOverlayGrid channels={makeChannels(20)} columns={5} />);

    // Move focus down twice: row 0 -> row 1 -> row 2. Row 2 is outside the
    // initial [0,1] window, so the window should slide to [1,2]. Store
    // updates triggered outside of a simulated DOM event need an explicit
    // act() so React flushes the resulting re-render before we assert.
    act(() => {
      useFocusStore.getState().move("down");
      useFocusStore.getState().move("down");
    });

    expect(screen.getByText("Channel 5")).toBeDefined(); // row 1, still visible
    expect(screen.getByText("Channel 10")).toBeDefined(); // row 2, now visible after sliding
    expect(screen.queryByText("Channel 0")).toBeNull(); // row 0, scrolled out
  });

  it("slides the window back up when focus moves above it", () => {
    render(<LiveOverlayGrid channels={makeChannels(20)} columns={5} />);
    act(() => {
      useFocusStore.getState().move("down");
      useFocusStore.getState().move("down");
      useFocusStore.getState().move("up");
      useFocusStore.getState().move("up");
    });

    expect(screen.getByText("Channel 0")).toBeDefined();
    expect(screen.queryByText("Channel 10")).toBeNull();
  });

  it("does not attempt to render past the end of a short channel list", () => {
    render(<LiveOverlayGrid channels={makeChannels(3)} columns={5} />);
    expect(screen.getByText("Channel 0")).toBeDefined();
    expect(screen.getByText("Channel 2")).toBeDefined();
  });

  it("calls onSelect with the focused channel when a card is activated", () => {
    let selected: Channel | null = null;
    render(<LiveOverlayGrid channels={makeChannels(5)} columns={5} onSelect={(c) => (selected = c)} />);

    screen.getByText("Channel 2").closest("button")?.click();
    expect(selected).not.toBeNull();
    expect(selected!.id).toBe("ch-2");
  });
});
