import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistSource } from "@core";
import { clearAllCachedContent, setCachedContent } from "../content-cache.js";
import { __resetSyncStoreForTests, useSyncStore } from "../sync/sync-store.js";
import { useFocusStore } from "../ui/focus/focus-store.js";
import { dismissPlaylistDialog, PlaylistCards, playlistsEntryFromBelow } from "./PlaylistCards.js";

vi.mock("../content-loader.js", () => ({
  loadPlaylistInfo: vi.fn().mockResolvedValue({ name: "", expiresAt: null }),
}));
vi.mock("../sync/sync-manager.js", () => ({ syncSource: vi.fn() }));
vi.mock("../sync/purge.js", () => ({ resetSourceData: vi.fn() }));

const four: PlaylistSource[] = [
  { kind: "xtream", id: "a", name: "My Provider", baseUrl: "http://a", username: "u", password: "p" },
  { kind: "m3u-url", id: "b", name: "Sports Playlist", url: "http://b/list.m3u" },
  { kind: "m3u-url", id: "c", name: "Kids", url: "http://c/list.m3u" },
  { kind: "m3u-url", id: "d", name: "News", url: "http://d/list.m3u" },
];
const EXIT = "settings-auto-refresh";

const focusedId = () => useFocusStore.getState().focusedId;
const nodeOf = (id: string) => useFocusStore.getState().nodes[id];

/** The cards don't own the remote (Settings does) — route arrows and OK through the focus store the way it would. */
function move(direction: "left" | "right" | "up" | "down"): void {
  act(() => useFocusStore.getState().move(direction));
}
function select(): void {
  act(() => useFocusStore.getState().select());
}

function renderCards(overrides: Partial<{ sources: PlaylistSource[]; onRemoveSource: (id: string) => void; onSetActiveSource: (id: string) => void; onAdd: () => void }> = {}) {
  const result = render(
    <PlaylistCards
      sources={overrides.sources ?? four}
      activeSourceId="a"
      exitDownId={EXIT}
      onAdd={overrides.onAdd ?? (() => {})}
      onRemoveSource={overrides.onRemoveSource ?? (() => {})}
      onSetActiveSource={overrides.onSetActiveSource ?? (() => {})}
    />,
  );
  act(() => useFocusStore.getState().focus("settings-playlists-card:a"));
  return result;
}

describe("PlaylistCards", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => {};
    clearAllCachedContent();
    __resetSyncStoreForTests();
    vi.clearAllMocks();
  });
  afterEach(() => {
    useFocusStore.getState().clearGraph("settings-playlists");
    useFocusStore.getState().clearGraph("settings-playlists-confirm");
  });

  it("lays playlists out three to a row, then an Add Playlist tile", () => {
    renderCards();
    for (const name of ["My Provider", "Sports Playlist", "Kids", "News"]) expect(screen.getByText(name)).toBeDefined();
    expect(screen.getByRole("button", { name: /Add Playlist/ })).toBeDefined();
    expect(screen.getByText("Active")).toBeDefined();
  });

  it("moves across cards, down to a card's buttons, and down to the next row", () => {
    renderCards();
    move("right");
    expect(focusedId()).toBe("settings-playlists-card:b");
    move("right");
    move("right");
    expect(focusedId()).toBe("settings-playlists-card:c"); // end of the row

    move("down");
    expect(focusedId()).toBe("settings-playlists-refresh:c");
    move("left");
    expect(focusedId()).toBe("settings-playlists-delete:b"); // along the buttons into the neighbouring card's
    move("down");
    expect(focusedId()).toBe("settings-playlists-add"); // the tile below: row 2 is News, Add
    move("up");
    expect(focusedId()).toBe("settings-playlists-refresh:b");
    move("up");
    expect(focusedId()).toBe("settings-playlists-card:b");
  });

  it("leaves the section downwards from the last row, and comes back to its first tile's buttons", () => {
    renderCards();
    act(() => useFocusStore.getState().focus("settings-playlists-card:d"));
    move("down");
    expect(focusedId()).toBe("settings-playlists-refresh:d");
    expect(nodeOf("settings-playlists-refresh:d")?.neighbors.down).toBe(EXIT); // the Settings rows (not mounted here)
    expect(playlistsEntryFromBelow(four)).toBe("settings-playlists-refresh:d");
    expect(nodeOf("settings-playlists-add")?.neighbors.down).toBe(EXIT);
  });

  it("OK on a card makes it active; OK on Add Playlist opens the form", () => {
    const onSetActiveSource = vi.fn();
    const onAdd = vi.fn();
    renderCards({ onSetActiveSource, onAdd });
    move("right");
    select();
    expect(onSetActiveSource).toHaveBeenCalledWith("b");
    act(() => useFocusStore.getState().focus("settings-playlists-add"));
    select();
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("Refresh forces a sync of that playlist and reports the real result on its card", async () => {
    const { syncSource } = await import("../sync/sync-manager.js");
    let finish!: (outcome: Awaited<ReturnType<typeof syncSource>>) => void;
    vi.mocked(syncSource).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderCards();
    move("down");
    select();
    expect(syncSource).toHaveBeenCalledWith(four[0], { trigger: "manual", force: true });

    act(() => {
      useSyncStore.getState().beginRun("a", "manual");
      useSyncStore.getState().setStage("a", "vod", { status: "running", done: 1200 });
    });
    expect(screen.getByText(`Syncing Movies… ${(1200).toLocaleString()}`)).toBeDefined();

    await act(async () => {
      useSyncStore.getState().setStage("a", "vod", { status: "synced", count: 1200 });
      useSyncStore.getState().endRun("a");
      finish({ stages: { vod: "synced" }, errors: {} });
    });
    expect(screen.getByText("✓ Updated")).toBeDefined();
  });

  it("Reset data and Delete ask first, over the whole screen; Back (dismissPlaylistDialog) cancels", async () => {
    const { resetSourceData } = await import("../sync/purge.js");
    vi.mocked(resetSourceData).mockResolvedValue({ stages: { live: "synced" }, errors: {} });
    const onRemoveSource = vi.fn();
    renderCards({ onRemoveSource });

    act(() => useFocusStore.getState().focus("settings-playlists-delete:b"));
    select();
    expect(screen.getByRole("dialog", { name: "Delete Sports Playlist" })).toBeDefined();
    expect(focusedId()).toBe("settings-playlists-confirm-cancel");
    act(() => {
      expect(dismissPlaylistDialog()).toBe(true);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(focusedId()).toBe("settings-playlists-delete:b");
    expect(dismissPlaylistDialog()).toBe(false); // nothing open

    select();
    move("right");
    select();
    expect(onRemoveSource).toHaveBeenCalledWith("b");

    act(() => useFocusStore.getState().focus("settings-playlists-reset:c"));
    select();
    expect(screen.getByRole("dialog", { name: "Reset data for Kids" })).toBeDefined();
    move("right");
    await act(async () => select());
    expect(resetSourceData).toHaveBeenCalledWith(four[2]);
    expect(await screen.findByText("✓ Data reset and downloaded again")).toBeDefined();
  });

  it("the only playlist can't be deleted", () => {
    renderCards({ sources: [four[0]] });
    move("down");
    move("right");
    expect(focusedId()).toBe("settings-playlists-reset:a");
    move("right");
    expect(focusedId()).toBe("settings-playlists-add"); // Delete is skipped — straight on to the next tile
    expect((screen.getByRole("button", { name: /Delete/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("warns when an account expires within a week", () => {
    setCachedContent("playlist-info:a", { name: "My Provider", expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) }, "playlist-info");
    renderCards();
    expect(screen.getByText(/renew soon/)).toBeDefined();
  });
});
