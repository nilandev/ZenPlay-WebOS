import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel } from "@core";
import { useFocusStore } from "../focus/focus-store.js";
import { ChannelSidebar } from "./ChannelSidebar.js";

const channels: Channel[] = Array.from({ length: 500 }, (_, i) => ({
  id: `ch-${i}`,
  name: `Channel ${i}`,
  streamUrl: `http://example.com/${i}.m3u8`,
  kind: "live",
}));

function mountedRowIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-focus-id]")).map((el) => el.dataset.focusId ?? "");
}

describe("ChannelSidebar", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => {};
  });

  afterEach(() => {
    useFocusStore.getState().clearGraph("content:channel-sidebar");
  });

  it("mounts only a window of rows, not the whole list, while registering focus nodes for every channel", () => {
    const { container } = render(<ChannelSidebar channels={channels} onHighlight={() => {}} onSelect={() => {}} />);
    const mounted = mountedRowIds(container);
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThan(50);
    expect(mounted[0]).toBe("ch-0");
    expect(Object.keys(useFocusStore.getState().scopes["content:channel-sidebar"])).toHaveLength(500);
  });

  it("scrolls a far-away focused row into the window and reports it via onHighlight", () => {
    const onHighlight = vi.fn();
    const { container } = render(<ChannelSidebar channels={channels} onHighlight={onHighlight} onSelect={() => {}} />);
    expect(mountedRowIds(container)).not.toContain("ch-300");

    act(() => useFocusStore.getState().focus("ch-300"));

    expect(mountedRowIds(container)).toContain("ch-300");
    expect(mountedRowIds(container)).not.toContain("ch-0");
    expect(onHighlight).toHaveBeenLastCalledWith(channels[300]);
  });
});
