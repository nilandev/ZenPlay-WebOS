import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFocusStore } from "../ui/focus/focus-store.js";
import { AddSourceScreen } from "./AddSourceScreen.js";

function press(key: string, target: Document | Element = document): void {
  act(() => {
    fireEvent.keyDown(target, { key });
    fireEvent.keyUp(target, { key });
  });
}
const focusedId = () => useFocusStore.getState().focusedId;
const input = (label: string) => screen.getByLabelText(label, { exact: false, selector: "input" }) as HTMLInputElement;

describe("AddSourceScreen", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => {};
  });
  afterEach(() => useFocusStore.getState().clearGraph("add-source"));

  it("picking a playlist type moves straight on to the form", () => {
    render(<AddSourceScreen platform="web" onSourceAdded={() => {}} />);
    expect(focusedId()).toBe("add-source-tab-xtream");
    press("ArrowDown");
    press("Enter");
    expect(screen.getByRole("radio", { name: /M3U Playlist/ }).getAttribute("aria-checked")).toBe("true");
    expect(focusedId()).toBe("add-source-field-name");
    expect(screen.getByText("Playlist URL")).toBeDefined();
  });

  it("OK on a field opens it for typing; OK while typing moves to the next field without opening it", () => {
    render(<AddSourceScreen platform="web" onSourceAdded={() => {}} />);
    act(() => useFocusStore.getState().focus("add-source-field-url"));
    press("Enter");
    const url = input("Server URL");
    expect(document.activeElement).toBe(url);

    press("Enter", url);
    expect(document.activeElement).not.toBe(url);
    expect(focusedId()).toBe("add-source-field-username");
    expect(document.activeElement).not.toBe(input("Username"));
  });

  it("Back while typing closes the keyboard but stays on the form; Backspace doesn't go back", () => {
    const onCancel = vi.fn();
    render(<AddSourceScreen platform="web" onSourceAdded={() => {}} onCancel={onCancel} />);
    act(() => useFocusStore.getState().focus("add-source-field-name"));
    press("Enter");
    const name = input("Playlist name");
    press("Backspace", name);
    expect(document.activeElement).toBe(name);
    press("Escape", name);
    expect(document.activeElement).not.toBe(name);
    expect(onCancel).not.toHaveBeenCalled();

    press("Escape");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("explains a missing field instead of saving, and focuses it", () => {
    const onSourceAdded = vi.fn();
    render(<AddSourceScreen platform="web" onSourceAdded={onSourceAdded} />);
    act(() => useFocusStore.getState().focus("add-source-submit"));
    press("Enter");
    expect(onSourceAdded).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Enter your provider's server URL.");
    expect(focusedId()).toBe("add-source-field-url");
  });

  it("saves a trimmed Xtream source", () => {
    const onSourceAdded = vi.fn();
    render(<AddSourceScreen platform="web" onSourceAdded={onSourceAdded} />);
    fireEvent.change(input("Server URL"), { target: { value: "  http://tv.example:8080 " } });
    fireEvent.change(input("Username"), { target: { value: "me " } });
    fireEvent.change(input("Password"), { target: { value: "secret" } });
    act(() => useFocusStore.getState().focus("add-source-submit"));
    press("Enter");
    expect(onSourceAdded).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "xtream", name: "My Provider", baseUrl: "http://tv.example:8080", username: "me", password: "secret" }),
    );
  });
});
