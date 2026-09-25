import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFocusStore } from "../ui/focus/focus-store.js";
import { loadSettings } from "../settings-store.js";
import type { PlaylistSource } from "@core";
import { SettingsScreen, type SettingsScreenProps } from "./SettingsScreen.js";

vi.mock("../content-loader.js", () => ({ loadPlaylistInfo: vi.fn().mockResolvedValue({ name: "", expiresAt: null }) }));

const sources: PlaylistSource[] = [
  { kind: "xtream", id: "a", name: "My Provider", baseUrl: "http://a", username: "u", password: "p" },
  { kind: "m3u-url", id: "b", name: "Sports Playlist", url: "http://b/list.m3u" },
];

function renderSettings(overrides: Partial<SettingsScreenProps> = {}) {
  return render(
    <SettingsScreen
      platform="web"
      sources={sources}
      activeSourceId="a"
      onAddSource={() => {}}
      onRemoveSource={() => {}}
      onSetActiveSource={() => {}}
      onBack={() => {}}
      {...overrides}
    />,
  );
}

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
  afterEach(() => {
    for (const scope of ["settings", "settings-playlists", "settings-playlists-confirm", "add-source"]) useFocusStore.getState().clearGraph(scope);
  });

  it("is one page: a Playlist section (the cards, then the update settings) and Playback — no Manage Playlists row or side pane", () => {
    renderSettings();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Playlist", "Playback", "Parental Controls"]);
    expect(screen.getByText("My Provider")).toBeDefined();
    expect(screen.getByText("Sports Playlist")).toBeDefined();
    expect(screen.queryByText("Manage Playlists")).toBeNull();
    // The Playlist section holds the four update settings under the cards, in order.
    const section = screen.getByRole("heading", { name: "Playlist" }).parentElement!;
    const labels = ["Sports Playlist", "Automatic Refresh", "Update Playlist on Launch", "Guide Sync Interval", "Days of Guide to Keep"];
    const positions = labels.map((label) => section.textContent!.indexOf(label));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("starts on the active playlist, and moves from the cards into the settings below and back", () => {
    renderSettings();
    expect(focusedId()).toBe("settings-playlists-card:a");
    press("ArrowDown");
    expect(focusedId()).toBe("settings-playlists-refresh:a");
    press("ArrowDown");
    expect(focusedId()).toBe("settings-auto-refresh"); // one row of cards (two playlists + Add)
    press("ArrowUp");
    expect(focusedId()).toBe("settings-playlists-refresh:a");
  });

  it("OK on a playlist card makes it active", () => {
    const onSetActiveSource = vi.fn();
    renderSettings({ onSetActiveSource });
    press("ArrowRight");
    press("Enter");
    expect(onSetActiveSource).toHaveBeenCalledWith("b");
  });

  it("Back closes a Delete dialog first, then leaves Settings", () => {
    const onBack = vi.fn();
    renderSettings({ onBack });
    act(() => useFocusStore.getState().focus("settings-playlists-delete:b"));
    press("Enter");
    expect(screen.getByRole("dialog")).toBeDefined();

    press("Escape");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(focusedId()).toBe("settings-playlists-delete:b");
    expect(onBack).not.toHaveBeenCalled();

    press("Escape");
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("Add Playlist opens the full-screen form; cancelling comes back to Settings", () => {
    renderSettings();
    act(() => useFocusStore.getState().focus("settings-playlists-add"));
    press("Enter");
    expect(screen.getByText("Add a Playlist")).toBeDefined();
    expect(screen.queryByText("App Settings")).toBeNull();

    act(() => useFocusStore.getState().focus("add-source-cancel"));
    press("Enter");
    expect(screen.getByText("App Settings")).toBeDefined();
    expect(focusedId()).toBe("settings-playlists-card:a");
  });

  it("toggles Automatic Refresh with OK", () => {
    renderSettings();
    const before = loadSettings().automaticRefresh;
    act(() => useFocusStore.getState().focus("settings-auto-refresh"));
    press("Enter");
    expect(loadSettings().automaticRefresh).toBe(!before);
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(String(!before));
  });

  it("walks the rows in order, keeping the column between option rows", () => {
    renderSettings();
    act(() => useFocusStore.getState().focus("settings-auto-refresh"));
    press("ArrowDown");
    expect(focusedId()).toBe("settings-update-on-launch:off");
    press("ArrowRight");
    press("ArrowRight");
    expect(focusedId()).toBe("settings-update-on-launch:always");
    press("ArrowDown");
    expect(focusedId()).toBe("settings-guide-refresh:24");
    press("ArrowDown");
    expect(focusedId()).toBe("settings-guide-days:7");
    press("ArrowDown");
    expect(focusedId()).toBe("settings-live-format:ts"); // two options: the column clamps to the last
    press("ArrowDown");
    expect(focusedId()).toBe("settings-playback-speed:1"); // …and stays clamped going down
    press("ArrowUp");
    press("ArrowUp");
    expect(focusedId()).toBe("settings-guide-days:3");
    press("ArrowUp");
    press("ArrowUp");
    press("ArrowUp");
    expect(focusedId()).toBe("settings-auto-refresh");
    press("ArrowUp");
    expect(focusedId()).toBe("settings-playlists-refresh:a"); // back into the playlist cards
  });

  it("has no Video Quality setting, and plays live channels as HLS by default", () => {
    renderSettings();
    expect(screen.queryByText("Video Quality")).toBeNull();
    expect(screen.getByRole("button", { name: "HLS (.m3u8)", pressed: true })).toBeDefined();
    act(() => useFocusStore.getState().focus("settings-live-format:ts"));
    press("Enter");
    expect(loadSettings().liveStreamFormat).toBe("ts");
  });

  it("starts with the defaults: update when out of date, guide every 6 hours, 3 days kept", () => {
    renderSettings();
    expect(screen.getByRole("button", { name: "When out of date", pressed: true })).toBeDefined();
    expect(screen.getByRole("button", { name: "6 hours", pressed: true })).toBeDefined();
    expect(screen.getByRole("button", { name: "3 days", pressed: true })).toBeDefined();
  });

  it("saves the playlist and guide update choices", () => {
    renderSettings();
    for (const id of ["settings-update-on-launch:always", "settings-guide-refresh:12", "settings-guide-days:7"]) {
      act(() => useFocusStore.getState().focus(id));
      press("Enter");
    }
    expect(loadSettings()).toMatchObject({ updateOnLaunch: "always", guideRefreshHours: 12, guideDaysToKeep: 7 });
    expect(screen.getByRole("button", { name: "Always", pressed: true })).toBeDefined();
  });

  it("shows version and build ID as plain read-only text — no heading, nothing to focus or press, no developer credit", () => {
    renderSettings();
    const about = screen.getByRole("region", { name: "About" });
    expect(about.querySelectorAll("button, [tabindex], [data-focus-id]")).toHaveLength(0);
    expect(about.querySelector("dl")?.textContent).toContain("Version");
    expect(about.querySelector("dl")?.textContent).toContain("Build ID");
    expect(about.querySelector("h2, h3, [role=heading]")).toBeNull();
    expect(screen.queryByRole("heading", { name: "About" })).toBeNull();
    expect(screen.queryByText("Developer")).toBeNull();
    expect(Object.keys(useFocusStore.getState().scopes.settings ?? {}).some((id) => id.includes("about") || id.includes("version"))).toBe(false);
  });

  it("OK on an option selects it and marks it chosen", () => {
    renderSettings();
    act(() => useFocusStore.getState().focus("settings-playback-speed:1.5"));
    press("Enter");
    expect(loadSettings().playbackSpeed).toBe(1.5);
    expect(screen.getByRole("button", { name: "1.5x", pressed: true })).toBeDefined();
  });

  it("labels the guide interval as Guide Sync Interval", () => {
    renderSettings();
    expect(screen.getByText("Guide Sync Interval")).toBeDefined();
    expect(screen.queryByText("Update Guide Every")).toBeNull();
  });
});
