import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSearchQuery } from "./use-debounced-value.js";

describe("useSearchQuery", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("only updates once typing pauses for 300ms, normalised to trimmed lowercase", () => {
    const { result, rerender } = renderHook(({ raw }) => useSearchQuery(raw), { initialProps: { raw: "" } });
    rerender({ raw: "Dr" });
    act(() => vi.advanceTimersByTime(200));
    rerender({ raw: "Dra " });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe("");
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe("dra");
  });

  it("treats a single character as no search", () => {
    const { result, rerender } = renderHook(({ raw }) => useSearchQuery(raw), { initialProps: { raw: "" } });
    rerender({ raw: "d" });
    act(() => vi.advanceTimersByTime(500));
    expect(result.current).toBe("");
  });

  it("clears immediately when the box is emptied", () => {
    const { result, rerender } = renderHook(({ raw }) => useSearchQuery(raw), { initialProps: { raw: "drama" } });
    act(() => vi.advanceTimersByTime(300));
    expect(result.current).toBe("drama");
    rerender({ raw: "" });
    act(() => vi.advanceTimersByTime(0));
    expect(result.current).toBe("");
  });
});
