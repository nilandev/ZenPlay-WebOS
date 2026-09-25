import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistSource, Profile } from "@core";
import { addPlaylistSource, setActivePlaylistSourceId } from "./playlist-store.js";
import { addProfile } from "./profile-store.js";
import { App } from "./App.js";

/**
 * App-level wiring only: the screens are stand-ins that show which profile
 * and playlist App handed them, and expose the callbacks as buttons.
 */
vi.mock("./screens/ProfilesScreen.js", () => ({
  ProfilesScreen: ({ profiles, onSelectProfile }: { profiles: Profile[]; onSelectProfile: (p: Profile) => void }) => (
    <div>
      {profiles.map((p) => (
        <button key={p.id} type="button" onClick={() => onSelectProfile(p)}>
          pick {p.name}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("./screens/HomeScreen.js", () => ({
  HomeScreen: ({
    source,
    sources,
    onSelectSource,
    onSelectTile,
    onOpenProfiles,
  }: {
    source: PlaylistSource;
    sources: PlaylistSource[];
    onSelectSource: (id: string) => void;
    onSelectTile: (id: string) => void;
    onOpenProfiles: () => void;
  }) => (
    <div>
      <p>home on {source.name}</p>
      {sources.map((s) => (
        <button key={s.id} type="button" onClick={() => onSelectSource(s.id)}>
          switch to {s.name}
        </button>
      ))}
      <button type="button" onClick={() => onSelectTile("favourites")}>
        my list
      </button>
      <button type="button" onClick={() => onSelectTile("history")}>
        recently watched
      </button>
      <button type="button" onClick={onOpenProfiles}>
        profiles
      </button>
    </div>
  ),
}));
vi.mock("./screens/FavouritesScreen.js", () => ({
  FavouritesScreen: ({ profileId, source }: { profileId: string; source: PlaylistSource }) => <p>my list of {profileId} on {source.name}</p>,
}));
vi.mock("./screens/HistoryScreen.js", () => ({
  HistoryScreen: ({ profileId, source }: { profileId: string; source: PlaylistSource }) => <p>history of {profileId} on {source.name}</p>,
}));
vi.mock("./sync/sync-scheduler.js", () => ({ startSyncScheduler: () => () => {} }));
// Every playlist counts as already downloaded, so the first-sync screen never gets in the way.
vi.mock("./live-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./live-store.js")>()),
  getLocalLiveMeta: vi.fn().mockResolvedValue({ sourceId: "x", lastSyncedAt: Date.now(), generation: 1, channelCount: 1 }),
}));

const providerA: PlaylistSource = { kind: "m3u-url", id: "a", name: "Provider A", url: "http://a/list.m3u" };
const providerB: PlaylistSource = { kind: "m3u-url", id: "b", name: "Provider B", url: "http://b/list.m3u" };
const mum: Profile = { id: "mum", name: "Mum", avatarUrl: "avatar/toon_1.png" };
const kid: Profile = { id: "kid", name: "Kid", avatarUrl: "avatar/toon_2.png" };

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

async function pickProfile(name: string): Promise<void> {
  click(`pick ${name}`);
  await screen.findByText(/^home on /);
}

describe("App: playlists per profile", () => {
  beforeEach(() => {
    localStorage.clear();
    addPlaylistSource(providerA);
    addPlaylistSource(providerB);
    setActivePlaylistSourceId("a");
    addProfile(mum);
    addProfile(kid);
  });

  it("each profile gets back the playlist it last used, with its own My List and Recently Watched", async () => {
    render(<App />);

    await pickProfile("Mum");
    expect(screen.getByText("home on Provider A")).toBeTruthy();

    click("profiles");
    await pickProfile("Kid");
    expect(screen.getByText("home on Provider A")).toBeTruthy(); // nothing remembered yet: keeps the active one
    click("switch to Provider B");
    expect(await screen.findByText("home on Provider B")).toBeTruthy();

    click("profiles");
    await pickProfile("Mum");
    expect(await screen.findByText("home on Provider A")).toBeTruthy();
    click("my list");
    expect(screen.getByText("my list of mum on Provider A")).toBeTruthy();
  });

  it("switching profile switches My List and Recently Watched with it", async () => {
    render(<App />);
    await pickProfile("Kid");
    click("switch to Provider B");
    await screen.findByText("home on Provider B");
    click("recently watched");
    expect(screen.getByText("history of kid on Provider B")).toBeTruthy();
  });

  it("the profile restored at start-up opens on its own playlist", async () => {
    const first = render(<App />);
    await pickProfile("Kid");
    click("switch to Provider B");
    await screen.findByText("home on Provider B");
    first.unmount();

    setActivePlaylistSourceId("a"); // whatever was active app-wide…
    render(<App />);
    expect(await screen.findByText("home on Provider B")).toBeTruthy(); // …Kid comes back to theirs
  });

  it("a removed playlist is forgotten — the profile falls back to what's active", async () => {
    const { removePlaylistSource } = await import("./playlist-store.js");
    const first = render(<App />);
    await pickProfile("Kid");
    click("switch to Provider B");
    await screen.findByText("home on Provider B");
    first.unmount();

    await act(async () => {
      removePlaylistSource("b");
    });
    setActivePlaylistSourceId("a");
    render(<App />);
    expect(await screen.findByText("home on Provider A")).toBeTruthy();
  });
});
