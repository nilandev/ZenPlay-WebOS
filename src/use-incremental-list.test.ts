import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useIncrementalList } from "./use-incremental-list.js";

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("useIncrementalList", () => {
  it("returns null for a null list", () => {
    const { result } = renderHook(() => useIncrementalList<number>(null, 10));
    expect(result.current).toBeNull();
  });

  it("shows one page, grows a page per loadMore, and reports when everything is shown", () => {
    const items = range(25);
    const { result } = renderHook(() => useIncrementalList(items, 10));
    expect(result.current?.visible).toHaveLength(10);
    expect(result.current?.hasMore).toBe(true);

    act(() => result.current?.loadMore());
    act(() => result.current?.loadMore());
    expect(result.current?.visible).toHaveLength(25);
    expect(result.current?.hasMore).toBe(false);
  });

  it("resets to one page on the very first render of a new list", () => {
    const first = range(100);
    const second = range(100).map((n) => n + 1000);
    const renders: number[] = [];
    const { result, rerender } = renderHook(({ items }) => {
      const list = useIncrementalList(items, 10);
      renders.push(list?.visible.length ?? 0);
      return list;
    }, { initialProps: { items: first } });

    act(() => result.current?.loadMore());
    act(() => result.current?.loadMore());
    expect(result.current?.visible).toHaveLength(30);

    renders.length = 0;
    rerender({ items: second });
    expect(Math.max(...renders)).toBe(10); // never mounts the old page count for the new list
    expect(result.current?.visible[0]).toBe(1000);
  });
});
