import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistSource, Profile } from "@core";
import { clearAllCachedContent, getCachedContent } from "../content-cache.js";
import { __clearCatalogDbForTests, __resetCatalogDbForTests, openCatalogDb, putRecordsBatch, putSyncMeta } from "../core/storage/catalog-db.js";
import { __resetSyncStoreForTests, useSyncStore } from "../sync/sync-store.js";
import { useFocusStore } from "../ui/focus/focus-store.js";
import { __resetCategoryMemoryForTests, SeriesScreen } from "./SeriesScreen.js";

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
});

// The screen asks the sync manager to build its table when it's missing;
// these tests cover what the screen shows and reads, not the sync itself.
vi.mock("../sync/sync-manager.js", () => ({ syncSource: vi.fn().mockResolvedValue({ stages: {}, errors: {} }) }));

vi.mock("../content-loader.js", () => ({
  loadSeriesList: vi.fn(),
  loadSeriesCategories: vi.fn().mockResolvedValue([
    { id: "cat-1", name: "Drama", kind: "series" },
    { id: "cat-2", name: "Comedy", kind: "series" },
  ]),
  loadSeriesDetails: vi.fn().mockResolvedValue({ details: {}, episodes: [] }),
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

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Writes series into the local table as a completed sync would — the only place the screen reads from. */
async function seedSeries(list: Array<{ id: string; name: string; groupTitle?: string }>): Promise<void> {
  const catalogDb = await openCatalogDb();
  await putRecordsBatch(
    catalogDb,
    "series",
    list.map((item) => ({ id: `${source.id}:${item.id}`, sourceId: source.id, streamId: item.id, name: item.name, nameLower: item.name.toLowerCase(), groupTitle: item.groupTitle, generation: 1 })),
  );
  await putSyncMeta(catalogDb, { key: `series:${source.id}`, lastSyncedAt: Date.now(), recordCount: list.length, generation: 1 });
}

async function resetScreenState(): Promise<void> {
  clearAllCachedContent();
  __resetCategoryMemoryForTests();
  __resetSyncStoreForTests();
  __resetCatalogDbForTests();
  await __clearCatalogDbForTests();
  for (const scope of ["content", "chrome:series-search", "chrome:category-rail", "chrome:category-dropdown-trigger", "chrome:category-dropdown-panel"]) {
    useFocusStore.getState().clearGraph(scope);
  }
  vi.clearAllMocks();
}

describe("SeriesScreen while the series table is still being built", () => {
  beforeEach(resetScreenState);

  it("asks the sync manager for the series table and shows its progress — never downloading the catalog itself", async () => {
    const { loadSeriesList } = await import("../content-loader.js");
    const { syncSource } = await import("../sync/sync-manager.js");

    render(<SeriesScreen source={source} platform="web" profile={profile} onPlayEpisode={() => {}} onBack={() => {}} />);
    await vi.waitFor(() => expect(syncSource).toHaveBeenCalledWith(source, { trigger: "first-run", stages: ["series"] }));
    expect(await screen.findByText("Getting your series ready…")).not.toBeNull();

    act(() => useSyncStore.getState().setStage(source.id, "series", { status: "running", done: 800 }));
    expect(screen.getByText("800 so far")).not.toBeNull();
    expect(loadSeriesList).not.toHaveBeenCalled();
  });

  it("picking a category meanwhile fetches just that category from the provider", async () => {
    const { loadSeriesList } = await import("../content-loader.js");
    (loadSeriesList as ReturnType<typeof vi.fn>).mockImplementation((_source: PlaylistSource, categoryId?: string) =>
      Promise.resolve(categoryId === "cat-1" ? [{ id: "s1", name: "Drama Show", groupTitle: "cat-1" }] : []),
    );

    render(<SeriesScreen source={source} platform="web" profile={profile} onPlayEpisode={() => {}} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Drama" })); // the category rail row

    expect(await screen.findByText("Drama Show")).not.toBeNull();
    expect(loadSeriesList).toHaveBeenCalledWith(source, "cat-1");
    expect(loadSeriesList).not.toHaveBeenCalledWith(source);
    expect(getCachedContent(`series-list:${source.id}:cat:cat-1`)).toEqual([{ id: "s1", name: "Drama Show", groupTitle: "cat-1" }]);
  });

  it("an M3U playlist has no series — it says so instead of waiting for a sync", async () => {
    const { syncSource } = await import("../sync/sync-manager.js");
    const m3u: PlaylistSource = { kind: "m3u-url", id: "src-m3u", name: "M3U", url: "http://example.com/list.m3u" };

    render(<SeriesScreen source={m3u} platform="web" profile={profile} onPlayEpisode={() => {}} onBack={() => {}} />);
    expect(await screen.findByText("This playlist has no series.")).not.toBeNull();
    expect(syncSource).not.toHaveBeenCalled();
  });
});

describe("SeriesScreen with a synced local catalog", () => {
  beforeEach(resetScreenState);

  it("renders shelves from the local table and never calls the live full-catalog fetch", async () => {
    const catalogDb = await openCatalogDb();
    await putRecordsBatch(catalogDb, "series", [
      { id: `${source.id}:1`, sourceId: source.id, streamId: "1", name: "Drama Show", nameLower: "drama show", groupTitle: "cat-1", generation: 1 },
    ]);
    await putSyncMeta(catalogDb, { key: `series:${source.id}`, lastSyncedAt: Date.now(), recordCount: 1, generation: 1 });

    const { loadSeriesList } = await import("../content-loader.js");

    render(
      <SeriesScreen source={source} platform="web" profile={profile} onPlayEpisode={() => {}} onBack={() => {}} />,
    );

    expect(await screen.findByText("Drama Show")).not.toBeNull();
    expect(loadSeriesList).not.toHaveBeenCalled();
  });

  it("search reads a prefix match from the local table", async () => {
    const catalogDb = await openCatalogDb();
    await putRecordsBatch(catalogDb, "series", [
      { id: `${source.id}:1`, sourceId: source.id, streamId: "1", name: "Breaking News", nameLower: "breaking news", generation: 1 },
      { id: `${source.id}:2`, sourceId: source.id, streamId: "2", name: "Comedy Hour", nameLower: "comedy hour", generation: 1 },
    ]);
    await putSyncMeta(catalogDb, { key: `series:${source.id}`, lastSyncedAt: Date.now(), recordCount: 2, generation: 1 });

    render(
      <SeriesScreen source={source} platform="web" profile={profile} onPlayEpisode={() => {}} onBack={() => {}} />,
    );
    const searchInput = await screen.findByPlaceholderText("Search series");

    fireEvent.change(searchInput, { target: { value: "break" } });
    await flush();

    expect(await screen.findByText("Breaking News")).not.toBeNull();
    expect(screen.queryByText("Comedy Hour")).toBeNull();
  });
});

describe("SeriesScreen at catalog scale", () => {
  // Zero-padded ids: the table returns rows in key order, and "s10" would otherwise sort before "s2".
  const manySeries = Array.from({ length: 500 }, (_, i) => ({ id: `s${String(i).padStart(3, "0")}`, name: i % 2 ? `Drama Show ${i}` : `Comedy Hour ${i}`, groupTitle: "cat-1" }));

  beforeEach(async () => {
    await resetScreenState();
    await seedSeries(manySeries);
  });

  /** Poster cards only — each shelf also ends with a "See all" card. */
  const cardCount = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('[role="button"]')).filter((el) => !el.textContent?.startsWith("See all")).length;

  it("caps each All Categories shelf at 20 cards instead of mounting the whole catalog", async () => {
    const { container } = render(<SeriesScreen source={source} platform="web" profile={profile} onPlayEpisode={() => {}} onBack={() => {}} />);
    await screen.findByText("Comedy Hour 0");
    expect(cardCount(container)).toBe(20);
  });

  it("renders a picked category a page (60) at a time", async () => {
    const { container } = render(<SeriesScreen source={source} platform="web" profile={profile} onPlayEpisode={() => {}} onBack={() => {}} />);
    await screen.findByText("Comedy Hour 0");

    fireEvent.click(await screen.findByRole("button", { name: "Drama" })); // the category rail row (categories may land after the list)
    await vi.waitFor(() => expect(cardCount(container)).toBe(60));
  });

  it("keeps focus where it is when the next page of a category loads", async () => {
    const { container } = render(<SeriesScreen source={source} platform="web" profile={profile} onPlayEpisode={() => {}} onBack={() => {}} />);
    await screen.findByText("Comedy Hour 0");
    fireEvent.click(await screen.findByRole("button", { name: "Drama" }));
    await vi.waitFor(() => expect(cardCount(container)).toBe(60));

    // The last row of the first page is the "load more" trigger zone.
    act(() => useFocusStore.getState().focus("series-grid:s057"));
    await vi.waitFor(() => expect(cardCount(container)).toBe(120));
    expect(useFocusStore.getState().focusedId).toBe("series-grid:s057");
  });

  it("debounces search and ignores single-character queries", async () => {
    const { container } = render(<SeriesScreen source={source} platform="web" profile={profile} onPlayEpisode={() => {}} onBack={() => {}} />);
    await screen.findByText("Comedy Hour 0");
    const input = container.querySelector("input") as HTMLInputElement;
    const shelfCount = () => container.querySelectorAll("section").length;

    fireEvent.change(input, { target: { value: "d" } });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(shelfCount()).toBe(1); // one letter: still browsing shelves, no search ran

    fireEvent.change(input, { target: { value: "dr" } });
    expect(shelfCount()).toBe(1); // not yet — waits for typing to pause
    await vi.waitFor(() => expect(shelfCount()).toBe(0));
    expect(await screen.findByText("Drama Show 1")).toBeTruthy(); // read from the table's name index
    expect(screen.queryByText("Comedy Hour 0")).toBeNull();
    await vi.waitFor(() => expect(cardCount(container)).toBe(60)); // 250 matches, first page only
  });
});

describe("SeriesScreen category rail", () => {
  const manySeries = Array.from({ length: 100 }, (_, i) => ({ id: `s${i}`, name: `Drama Show ${i}`, groupTitle: "cat-1" }));

  beforeEach(async () => {
    await resetScreenState();
    await seedSeries(manySeries);
  });

  function press(key: string): void {
    act(() => {
      fireEvent.keyDown(document, { key });
      fireEvent.keyUp(document, { key });
    });
  }
  const focusedId = () => useFocusStore.getState().focusedId;
  const posterCount = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('[role="button"]')).filter((el) => !el.textContent?.startsWith("See all")).length;

  it("opens with focus on the content, not the rail", async () => {
    render(<SeriesScreen source={source} platform="web" profile={profile} onPlayEpisode={() => {}} onBack={() => {}} />);
    await screen.findByText("Drama Show 0");
    await vi.waitFor(() => expect(focusedId()).toBe("s0"));
  });

  it("Left from the first column opens the rail; Back goes content → rail → leaves the screen", async () => {
    const onBack = vi.fn();
    render(<SeriesScreen source={source} platform="web" profile={profile} onPlayEpisode={() => {}} onBack={onBack} />);
    await screen.findByText("Drama Show 0");
    await vi.waitFor(() => expect(focusedId()).toBe("s0"));

    press("ArrowLeft");
    expect(focusedId()).toBe("rail:__all__");
    press("ArrowRight");
    expect(focusedId()).toBe("s0");

    press("Escape");
    expect(focusedId()).toBe("rail:__all__");
    expect(onBack).not.toHaveBeenCalled();
    press("Escape");
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("ends each shelf with a See all card that opens the category and moves focus into it", async () => {
    const { container } = render(<SeriesScreen source={source} platform="web" profile={profile} onPlayEpisode={() => {}} onBack={() => {}} />);
    await screen.findByText("Drama Show 0");
    expect(screen.getByRole("button", { name: /^See all/ })).toBeTruthy();

    act(() => useFocusStore.getState().focus("seeall:cat-1"));
    press("Enter");

    await vi.waitFor(() => expect(posterCount(container)).toBe(60));
    await vi.waitFor(() => expect(focusedId()).toBe("series-grid:s0"));
    expect(screen.getByText("100 titles")).toBeTruthy();
  });

  it("remembers the chosen category when the screen is opened again", async () => {
    const first = render(<SeriesScreen source={source} platform="web" profile={profile} onPlayEpisode={() => {}} onBack={() => {}} />);
    await screen.findByText("Drama Show 0");
    fireEvent.click(await screen.findByRole("button", { name: "Drama" }));
    await vi.waitFor(() => expect(posterCount(first.container)).toBe(60));
    first.unmount();

    const second = render(<SeriesScreen source={source} platform="web" profile={profile} onPlayEpisode={() => {}} onBack={() => {}} />);
    await vi.waitFor(() => expect(posterCount(second.container)).toBe(60));
    expect(second.container.querySelectorAll("section")).toHaveLength(0); // category grid, not Browse shelves
  });
});

describe("SeriesScreen detail page", () => {
  const browseSeries = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, name: `Drama Show ${i}`, groupTitle: "cat-1" }));
  const episodes = [1, 2].flatMap((season) =>
    Array.from({ length: 6 }, (_, i) => ({ id: `ep-${season}-${i + 1}`, seriesId: "s0", season, episode: i + 1, title: `Ep ${i + 1}`, streamUrl: "x" })),
  );

  beforeEach(async () => {
    await resetScreenState();
    await seedSeries(browseSeries);
    const loader = await import("../content-loader.js");
    (loader.loadSeriesDetails as ReturnType<typeof vi.fn>).mockResolvedValue({ details: {}, episodes });
  });

  function press(key: string): void {
    act(() => {
      fireEvent.keyDown(document, { key });
      fireEvent.keyUp(document, { key });
    });
  }
  const focusedId = () => useFocusStore.getState().focusedId;

  it("starts on Play and chains Down/Up through actions → season tabs → episodes", async () => {
    render(<SeriesScreen source={source} platform="web" profile={profile} onPlayEpisode={() => {}} onBack={() => {}} initialSelectedId="s0" />);
    await screen.findByRole("button", { name: "Play S1 E1" });
    await vi.waitFor(() => expect(focusedId()).toBe("series-hero-play"));

    press("ArrowDown");
    expect(focusedId()).toBe("season-tab:1");
    press("ArrowDown");
    expect(focusedId()).toBe("ep-1-1");
    press("ArrowRight");
    expect(focusedId()).toBe("ep-1-2");
    press("ArrowUp");
    expect(focusedId()).toBe("season-tab:1");
    press("ArrowUp");
    expect(focusedId()).toBe("series-hero-play");
  });

  it("switching season updates the episode row and Up from it returns to that season's tab", async () => {
    render(<SeriesScreen source={source} platform="web" profile={profile} onPlayEpisode={() => {}} onBack={() => {}} initialSelectedId="s0" />);
    await screen.findByRole("button", { name: "Play S1 E1" });

    act(() => useFocusStore.getState().focus("season-tab:2"));
    press("Enter");
    await vi.waitFor(() => expect(useFocusStore.getState().nodes["ep-2-1"]).toBeDefined());
    press("ArrowDown");
    expect(focusedId()).toBe("ep-2-1");
    press("ArrowUp");
    expect(focusedId()).toBe("season-tab:2");
  });

  it("Back from the detail page returns focus to the series card that opened it", async () => {
    render(<SeriesScreen source={source} platform="web" profile={profile} onPlayEpisode={() => {}} onBack={() => {}} />);
    await screen.findByText("Drama Show 3");
    act(() => useFocusStore.getState().focus("s3"));
    press("Enter");
    await screen.findByRole("button", { name: "Play S1 E1" });

    press("Escape");
    await screen.findByText("Drama Show 3");
    await vi.waitFor(() => expect(focusedId()).toBe("s3"));
  });
});
