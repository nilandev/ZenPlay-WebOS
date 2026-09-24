import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFocusStore } from "../ui/focus/focus-store.js";
import { loadSettings } from "../settings-store.js";
import { SettingsScreen } from "./SettingsScreen.js";

function press(key: string): void {
  act(() => {
    fireEvent.keyDown(document, { key });
    fireEvent.keyUp(document, { key });
  });
}
const focusedId = () => useFocusStore.getState().focusedId;

describe("SettingsScreen (App Settings)", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => {};
    localStorage.clear();
  });
  afterEach(() => useFocusStore.getState().clearGraph("settings"));

  it("starts on Manage Playlists, which opens the playlists screen", () => {
    const onManagePlaylists = vi.fn();
    render(<SettingsScreen platform="web" onManagePlaylists={onManagePlaylists} onBack={() => {}} />);
    expect(screen.getByText("App Settings")).toBeDefined();
    expect(focusedId()).toBe("settings-manage-playlists");
    press("Enter");
    expect(onManagePlaylists).toHaveBeenCalledTimes(1);
  });

  it("toggles Automatic Refresh with OK", () => {
    render(<SettingsScreen platform="web" onManagePlaylists={() => {}} onBack={() => {}} />);
    const before = loadSettings().automaticRefresh;
    press("ArrowDown");
    press("Enter");
    expect(loadSettings().automaticRefresh).toBe(!before);
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(String(!before));
  });

  it("moves between the two picker rows keeping the column, and Up from any quality option reaches the toggle", () => {
    render(<SettingsScreen platform="web" onManagePlaylists={() => {}} onBack={() => {}} />);
    press("ArrowDown");
    press("ArrowDown");
    press("ArrowRight");
    press("ArrowRight");
    expect(focusedId()).toBe("settings-video-quality:medium");
    press("ArrowDown");
    expect(focusedId()).toBe("settings-playback-speed:1.25");
    press("ArrowUp");
    expect(focusedId()).toBe("settings-video-quality:medium");
    press("ArrowUp");
    expect(focusedId()).toBe("settings-auto-refresh");
  });

  it("OK on an option selects it and marks it chosen", () => {
    render(<SettingsScreen platform="web" onManagePlaylists={() => {}} onBack={() => {}} />);
    act(() => useFocusStore.getState().focus("settings-video-quality:high"));
    press("Enter");
    expect(loadSettings().videoQuality).toBe("high");
    expect(screen.getByRole("button", { name: "High", pressed: true })).toBeDefined();
  });
});
