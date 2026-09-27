import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFocusStore } from "../focus/focus-store.js";
import { SearchKeyboard, searchKeyId } from "./SearchKeyboard.js";

afterEach(() => useFocusStore.getState().clearGraph("search-keyboard"));

const neighbors = (key: string) => useFocusStore.getState().nodes[searchKeyId(key)]?.neighbors;

describe("SearchKeyboard", () => {
  it("lays out A–Z and 0–9 six to a row, then Space, Delete and Clear", () => {
    const { getAllByRole } = render(<SearchKeyboard onInput={() => {}} onDelete={() => {}} onClear={() => {}} />);
    const labels = getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(labels.slice(0, 6)).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(labels.slice(-3)).toEqual(["Space", "Delete", "Clear"]);
    expect(labels).toHaveLength(39);
  });

  it("moves in a grid; the bottom row's wide keys sit under two columns each", () => {
    render(<SearchKeyboard onInput={() => {}} onDelete={() => {}} onClear={() => {}} rightExitId="first-result" />);
    expect(neighbors("a")).toMatchObject({ right: searchKeyId("b"), down: searchKeyId("g"), up: undefined, left: undefined });
    expect(neighbors("f")?.right).toBe("first-result");
    expect(neighbors("5")?.down).toBe(searchKeyId("space")); // the last row is 4–9, so "5" is its second column
    expect(neighbors("6")?.down).toBe(searchKeyId("delete")); // third column
    expect(neighbors("delete")).toMatchObject({ up: searchKeyId("6"), left: searchKeyId("space"), right: searchKeyId("clear") });
    expect(neighbors("clear")?.right).toBe("first-result");
  });

  it("keys type, Delete deletes and Clear clears", () => {
    const onInput = vi.fn();
    const onDelete = vi.fn();
    const onClear = vi.fn();
    const { getByRole } = render(<SearchKeyboard onInput={onInput} onDelete={onDelete} onClear={onClear} />);
    fireEvent.click(getByRole("button", { name: "Q" }));
    fireEvent.click(getByRole("button", { name: "Space" }));
    act(() => useFocusStore.getState().nodes[searchKeyId("delete")]?.onSelect?.());
    fireEvent.click(getByRole("button", { name: "Clear" }));
    expect(onInput.mock.calls).toEqual([["q"], [" "]]);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
