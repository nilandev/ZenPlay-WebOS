import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFocusStore } from "./focus-store.js";
import { useRemoteInput, type RemoteInputHandlers } from "./use-remote-input.js";

function Harness({ handlers = {} }: { handlers?: RemoteInputHandlers }): null {
  useRemoteInput("web", handlers);
  return null;
}

function registerRow(count: number): void {
  const ids = Array.from({ length: count }, (_, i) => `n${i}`);
  useFocusStore.getState().setGraph(
    "test",
    ids.map((id, i) => ({ id, neighbors: { left: ids[i - 1], right: ids[i + 1] } })),
    "n0",
  );
}

describe("useRemoteInput", () => {
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    frames = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    registerRow(10);
  });

  afterEach(() => {
    useFocusStore.getState().clearGraph("test");
    vi.restoreAllMocks();
  });

  it("moves immediately on every non-repeat press", () => {
    render(<Harness />);
    fireEvent.keyDown(document, { key: "ArrowRight" });
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(useFocusStore.getState().focusedId).toBe("n2");
  });

  it("caps held-key auto-repeat at one move per frame, applying only the latest queued direction", () => {
    render(<Harness />);
    fireEvent.keyDown(document, { key: "ArrowRight", repeat: true });
    fireEvent.keyDown(document, { key: "ArrowRight", repeat: true });
    fireEvent.keyDown(document, { key: "ArrowRight", repeat: true });
    expect(useFocusStore.getState().focusedId).toBe("n1");

    frames.shift()?.(0);
    expect(useFocusStore.getState().focusedId).toBe("n2");
  });

  it("passes the focused id at release time to onSelect, using the latest handlers", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Harness handlers={{ onSelect: first }} />);
    rerender(<Harness handlers={{ onSelect: second }} />);
    fireEvent.keyDown(document, { key: "ArrowRight" });
    fireEvent.keyUp(document, { key: "Enter" });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("n1");
  });
});
