import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistSource } from "@core";
import { clearAllCachedContent } from "../content-cache.js";
import { useFocusStore } from "../ui/focus/focus-store.js";
import { ManagePlaylistsScreen } from "./ManagePlaylistsScreen.js";

vi.mock("../content-loader.js", () => ({
  loadPlaylistInfo: vi.fn().mockResolvedValue({ name: "", expiresAt: null }),
}));

const sources: PlaylistSource[] = [
  { kind: "xtream", id: "a", name: "My Provider", baseUrl: "http://a", username: "u", password: "p" },
  { kind: "m3u-url", id: "b", name: "Sports Playlist", url: "http://b/list.m3u" },
];

function press(key: string): void {
  act(() => {
    fireEvent.keyDown(document, { key });
    fireEvent.keyUp(document, { key });
  });
}
const focusedId = () => useFocusStore.getState().focusedId;

function renderScreen(overrides: Partial<{ sources: PlaylistSource[]; onRemoveSource: (id: string) => void; onSetActiveSource: (id: string) => void }> = {}) {
  return render(
    <ManagePlaylistsScreen
      sources={overrides.sources ?? sources}
      activeSourceId="a"
      platform="web"
      onBack={() => {}}
      onAddSource={() => {}}
      onRemoveSource={overrides.onRemoveSource ?? (() => {})}
      onSetActiveSource={overrides.onSetActiveSource ?? (() => {})}
    />,
  );
}

describe("ManagePlaylistsScreen", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => {};
    clearAllCachedContent();
  });
  afterEach(() => {
    useFocusStore.getState().clearGraph("manage-playlists");
    useFocusStore.getState().clearGraph("manage-playlists-confirm");
  });

  it("starts on the active playlist; OK on a row makes it active", () => {
    const onSetActiveSource = vi.fn();
    renderScreen({ onSetActiveSource });
    expect(focusedId()).toBe("manage-playlists-card:a");
    press("ArrowDown");
    press("Enter");
    expect(onSetActiveSource).toHaveBeenCalledWith("b");
  });

  it("Right walks the row's actions; Up/Down keep the same action column; Up from the top reaches Add Playlist", () => {
    renderScreen();
    press("ArrowRight");
    expect(focusedId()).toBe("manage-playlists-refresh:a");
    press("ArrowRight");
    expect(focusedId()).toBe("manage-playlists-clear-cache:a");
    press("ArrowDown");
    expect(focusedId()).toBe("manage-playlists-clear-cache:b");
    press("ArrowUp");
    press("ArrowUp");
    expect(focusedId()).toBe("manage-playlists-add");
  });

  it("Refresh shows a confirmation on the row", () => {
    renderScreen();
    press("ArrowRight");
    press("Enter");
    expect(screen.getByText("✓ Refreshed")).toBeDefined();
  });

  it("Delete asks first; Keep returns focus to Delete, and confirming removes the playlist", () => {
    const onRemoveSource = vi.fn();
    renderScreen({ onRemoveSource });
    act(() => useFocusStore.getState().focus("manage-playlists-delete:b"));
    press("Enter");
    expect(screen.getByText("Delete “Sports Playlist”?")).toBeDefined();
    expect(focusedId()).toBe("manage-playlists-confirm-keep");

    press("Enter");
    expect(screen.queryByText("Delete “Sports Playlist”?")).toBeNull();
    expect(focusedId()).toBe("manage-playlists-delete:b");
    expect(onRemoveSource).not.toHaveBeenCalled();

    press("Enter");
    press("ArrowRight");
    press("Enter");
    expect(onRemoveSource).toHaveBeenCalledWith("b");
  });

  it("the only playlist can't be deleted — Delete is shown disabled and can't be reached", () => {
    renderScreen({ sources: [sources[0]] });
    press("ArrowRight");
    press("ArrowRight");
    press("ArrowRight");
    expect(focusedId()).toBe("manage-playlists-clear-cache:a");
    expect((screen.getByRole("button", { name: /Delete/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
