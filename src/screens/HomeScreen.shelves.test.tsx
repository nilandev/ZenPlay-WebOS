import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistSource, Profile } from "@core";
import { clearAllCachedContent } from "../content-cache.js";
import { __clearCatalogDbForTests, __resetCatalogDbForTests, openCatalogDb, putRecordsBatch } from "../core/storage/catalog-db.js";
import { upsertContinueWatching } from "../profile-store.js";
import { useFocusStore } from "../ui/focus/focus-store.js";
import { HomeScreen } from "./HomeScreen.js";

// Separate file from HomeScreen.test.tsx, deliberately never calling
// vi.useFakeTimers() — these tests await real IndexedDB round-trips
// (getCatalogPage/getRecordsByIds), and mixing that with fake timers across
// multiple test instances is a known Vitest-worker hang (see
// use-catalog-shelves.test.ts's identical note), not a product bug.

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
});

vi.mock("../content-loader.js", () => ({
  loadPlaylistInfo: vi.fn().mockResolvedValue({ name: "Test Playlist", expiresAt: null }),
  loadChannelsByKind: vi.fn().mockResolvedValue([]),
  loadSeriesList: vi.fn().mockResolvedValue([]),
  loadVodCategories: vi.fn().mockResolvedValue([]),
  loadSeriesCategories: vi.fn().mockResolvedValue([]),
  loadEpg: vi.fn().mockResolvedValue([]),
}));

// startCatalogBackgroundSync otherwise constructs a real XtreamClient (see
// catalog-sync.ts) that isn't covered by the content-loader.js mock above,
// and fires a genuine network fetch in the background — an unhandled
// rejection once a test actually awaits long enough for it to settle, which
// these shelf tests need to (to let getCatalogPage/getRecordsByIds resolve).
vi.mock("../catalog-sync.js", () => ({
  startCatalogBackgroundSync: vi.fn(() => () => {}),
}));

const source: PlaylistSource = {
  kind: "xtream",
  id: "src-1",
  name: "My Source",
  baseUrl: "http://example.com",
  username: "u",
  password: "p",
};

const profile: Profile = { id: "profile-1", name: "Alex", avatarUrl: "avatar/toon_1.png" };

describe("HomeScreen Continue Watching / Recently Added shelves", () => {
  beforeEach(async () => {
    clearAllCachedContent();
    localStorage.clear();
    __resetCatalogDbForTests();
    await __clearCatalogDbForTests();
    useFocusStore.getState().clearGraph("home-grid");
    useFocusStore.getState().clearGraph("home-shelves");
  });

  afterEach(() => {
    useFocusStore.getState().clearGraph("home-grid");
    useFocusStore.getState().clearGraph("home-shelves");
  });

  it("does not render Continue Watching or Recently Added shelves for a brand-new profile with an empty catalog", async () => {
    render(
      <HomeScreen
        source={source}
        platform="web"
        profile={profile}
        onSelectTile={() => {}}
        onOpenProfiles={() => {}}
        onPlayMovie={() => {}}
        onPlayChannel={() => {}}
        onOpenSeries={() => {}}
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText("Continue Watching")).toBeNull();
    expect(screen.queryByText("Recently Added")).toBeNull();
  });

  it("renders a Recently Added shelf from the local VOD catalog when Continue Watching is empty", async () => {
    const catalogDb = await openCatalogDb();
    await putRecordsBatch(catalogDb, "vod", [
      { id: `${source.id}:1`, sourceId: source.id, streamId: "1", name: "Fresh Movie", nameLower: "fresh movie", generation: 1 },
    ]);

    render(
      <HomeScreen
        source={source}
        platform="web"
        profile={profile}
        onSelectTile={() => {}}
        onOpenProfiles={() => {}}
        onPlayMovie={() => {}}
        onPlayChannel={() => {}}
        onOpenSeries={() => {}}
      />,
    );

    await screen.findByText("Recently Added");
    // A lone catalog item is also this screen's only hero candidate (see
    // home-curation.ts's pickHeroRotation fallback order), so its title
    // legitimately renders twice: once as the hero's <h1>, once as the
    // shelf's FocusCard — getAllByText, not getByText, is correct here.
    expect(screen.getAllByText("Fresh Movie").length).toBeGreaterThan(0);
    expect(screen.queryByText("Continue Watching")).toBeNull();
  });

  it("renders a Continue Watching shelf and plays a movie entry directly on select", async () => {
    const catalogDb = await openCatalogDb();
    await putRecordsBatch(catalogDb, "vod", [
      { id: `${source.id}:1`, sourceId: source.id, streamId: "1", name: "Resume Movie", nameLower: "resume movie", generation: 1 },
    ]);
    upsertContinueWatching({
      profileId: profile.id,
      contentId: "1",
      contentKind: "movie",
      positionSeconds: 30,
      durationSeconds: 600,
      updatedAt: new Date().toISOString(),
    });

    const onPlayMovie = vi.fn();
    render(
      <HomeScreen
        source={source}
        platform="web"
        profile={profile}
        onSelectTile={() => {}}
        onOpenProfiles={() => {}}
        onPlayMovie={onPlayMovie}
        onPlayChannel={() => {}}
        onOpenSeries={() => {}}
      />,
    );

    // "Resume Movie" is both this screen's only hero candidate and its
    // Continue Watching shelf item (see home-curation.ts's pickHeroRotation
    // fallback order) — the shelf card specifically is what's under test
    // here, found by its home-cw:-prefixed focus id (see
    // continueWatchingItemId in HomeScreen.tsx) rather than by title text,
    // which also matches the hero's own <h1>.
    await screen.findByText("Continue Watching");
    const cardContainer = document.querySelector('[data-focus-id="home-cw:1"]');
    const clickableCard = cardContainer?.querySelector('[role="button"]');
    expect(clickableCard).not.toBeNull();
    fireEvent.click(clickableCard!);

    expect(onPlayMovie).toHaveBeenCalledWith(expect.objectContaining({ id: "1", name: "Resume Movie" }));
  });

  it("shows a progress bar on a Continue Watching card sized to positionSeconds/durationSeconds", async () => {
    const catalogDb = await openCatalogDb();
    await putRecordsBatch(catalogDb, "vod", [
      { id: `${source.id}:1`, sourceId: source.id, streamId: "1", name: "Halfway Movie", nameLower: "halfway movie", generation: 1 },
    ]);
    upsertContinueWatching({
      profileId: profile.id,
      contentId: "1",
      contentKind: "movie",
      positionSeconds: 150,
      durationSeconds: 600,
      updatedAt: new Date().toISOString(),
    });

    render(
      <HomeScreen
        source={source}
        platform="web"
        profile={profile}
        onSelectTile={() => {}}
        onOpenProfiles={() => {}}
        onPlayMovie={() => {}}
        onPlayChannel={() => {}}
        onOpenSeries={() => {}}
      />,
    );

    await screen.findByText("Continue Watching");
    const cardContainer = document.querySelector('[data-focus-id="home-cw:1"]');
    // FocusCard renders the filled progress segment as a nested div whose
    // width is set to `${progress * 100}%` (see FocusCard.tsx) — 150/600 = 25%.
    const filledBar = Array.from(cardContainer?.querySelectorAll("div") ?? []).find((el) => el.style.width === "25%");
    expect(filledBar).toBeTruthy();
  });
});
