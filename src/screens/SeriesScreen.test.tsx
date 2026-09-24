import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistSource, Profile } from "@core";
import { clearAllCachedContent, getCachedContent } from "../content-cache.js";
import { __clearCatalogDbForTests, __resetCatalogDbForTests, openCatalogDb, putRecordsBatch, putSyncMeta } from "../core/storage/catalog-db.js";
import { useFocusStore } from "../ui/focus/focus-store.js";
import { __resetCategoryMemoryForTests, SeriesScreen } from "./SeriesScreen.js";

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
});

// The screen starts a background catalog sync on mount (see catalog-sync.ts),
// which would otherwise hit the network through a real XtreamClient. These
// tests cover the screen's legacy/local read paths, not the sync itself.
vi.mock("../catalog-sync.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../catalog-sync.js")>()),
  startCatalogBackgroundSync: vi.fn(() => () => {}),
}));

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

describe("SeriesScreen category-lazy fetching", () => {
  beforeEach(async () => {
    clearAllCachedContent();
    __resetCategoryMemoryForTests();
    __resetCatalogDbForTests();
    await __clearCatalogDbForTests();
    useFocusStore.getState().clearGraph("content");
    useFocusStore.getState().clearGraph("chrome:series-search");
    useFocusStore.getState().clearGraph("chrome:category-dropdown-trigger");
    useFocusStore.getState().clearGraph("chrome:category-dropdown-panel");
    vi.clearAllMocks();
  });

  it("fetches the full catalog for the default All Categories view", async () => {
    const { loadSeriesList, loadSeriesCategories } = await import("../content-loader.js");
    (loadSeriesList as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    render(
      <SeriesScreen source={source} platform="web" profile={profile} onPlayEpisode={() => {}} onBack={() => {}} />,
    );
    await vi.waitFor(() => expect(loadSeriesList).toHaveBeenCalled());

    expect(loadSeriesCategories).toHaveBeenCalledTimes(1);
    expect(loadSeriesList).toHaveBeenCalledWith(source);
  });

  it("selecting a category fetches only that category, not the full catalog again", async () => {
    const { loadSeriesList } = await import("../content-loader.js");
    (loadSeriesList as ReturnType<typeof vi.fn>).mockImplementation((_source: PlaylistSource, categoryId?: string) =>
      Promise.resolve(categoryId === "cat-1" ? [{ id: "s1", name: "Drama Show", groupTitle: "cat-1" }] : []),
    );

    render(
      <SeriesScreen source={source} platform="web" profile={profile} onPlayEpisode={() => {}} onBack={() => {}} />,
    );
    await vi.waitFor(() => expect(loadSeriesList).toHaveBeenCalledWith(source));

    (loadSeriesList as ReturnType<typeof vi.fn>).mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Drama" })); // the category rail row
    await flush();

    expect(loadSeriesList).toHaveBeenCalledWith(source, "cat-1");
    expect(loadSeriesList).not.toHaveBeenCalledWith(source);
    expect(getCachedContent(`series-list:${source.id}:cat:cat-1`)).toEqual([
      { id: "s1", name: "Drama Show", groupTitle: "cat-1" },
    ]);
    expect(await screen.findByText("Drama Show")).not.toBeNull();
  });
});

describe("SeriesScreen with a synced local catalog", () => {
  beforeEach(async () => {
    clearAllCachedContent();
    __resetCategoryMemoryForTests();
    __resetCatalogDbForTests();
    await __clearCatalogDbForTests();
    useFocusStore.getState().clearGraph("content");
    useFocusStore.getState().clearGraph("chrome:series-search");
    useFocusStore.getState().clearGraph("chrome:category-dropdown-trigger");
    useFocusStore.getState().clearGraph("chrome:category-dropdown-panel");
    vi.clearAllMocks();
  });

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

describe("SeriesScreen at catalog scale (legacy path)", () => {
  const manySeries = Array.from({ length: 500 }, (_, i) => ({ id: `s${i}`, name: i % 2 ? `Drama Show ${i}` : `Comedy Hour ${i}`, groupTitle: "cat-1" }));

  beforeEach(async () => {
    clearAllCachedContent();
    __resetCategoryMemoryForTests();
    __resetCatalogDbForTests();
    await __clearCatalogDbForTests();
    useFocusStore.getState().clearGraph("content");
    useFocusStore.getState().clearGraph("chrome:series-search");
    useFocusStore.getState().clearGraph("chrome:category-dropdown-trigger");
    useFocusStore.getState().clearGraph("chrome:category-dropdown-panel");
    vi.clearAllMocks();
    const { loadSeriesList } = await import("../content-loader.js");
    (loadSeriesList as ReturnType<typeof vi.fn>).mockImplementation((_source: PlaylistSource, categoryId?: string) =>
      Promise.resolve(categoryId && categoryId !== "cat-1" ? [] : manySeries),
    );
  });

  /** Poster cards only — each shelf also ends with a "See all" card. */
  const cardCount = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('[role="button"]')).filter((el) => !el.textContent?.startsWith("See all")).length;

  it("starts the series catalog sync (and only the series one) while open", async () => {
    const { startCatalogBackgroundSync } = await import("../catalog-sync.js");
    render(<SeriesScreen source={source} platform="web" profile={profile} onPlayEpisode={() => {}} onBack={() => {}} />);
    expect(startCatalogBackgroundSync).toHaveBeenCalledWith(expect.any(Function), ["series"]);
  });

  it("caps each All Categories shelf at 20 cards instead of mounting the whole catalog", async () => {
    const { container } = render(<SeriesScreen source={source} platform="web" profile={profile} onPlayEpisode={() => {}} onBack={() => {}} />);
    await screen.findByText("Comedy Hour 0");
    expect(cardCount(container)).toBe(20);
  });

  it("renders a picked category a page (60) at a time", async () => {
    const { container } = render(<SeriesScreen source={source} platform="web" profile={profile} onPlayEpisode={() => {}} onBack={() => {}} />);
    await screen.findByText("Comedy Hour 0");

    fireEvent.click(screen.getByRole("button", { name: "Drama" })); // the category rail row
    await vi.waitFor(() => expect(cardCount(container)).toBe(60));
  });

  it("keeps focus where it is when the next page of a category loads", async () => {
    const { container } = render(<SeriesScreen source={source} platform="web" profile={profile} onPlayEpisode={() => {}} onBack={() => {}} />);
    await screen.findByText("Comedy Hour 0");
    fireEvent.click(screen.getByRole("button", { name: "Drama" }));
    await vi.waitFor(() => expect(cardCount(container)).toBe(60));

    // The last row of the first page is the "load more" trigger zone.
    act(() => useFocusStore.getState().focus("series-grid:s57"));
    await vi.waitFor(() => expect(cardCount(container)).toBe(120));
    expect(useFocusStore.getState().focusedId).toBe("series-grid:s57");
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
    expect(screen.getByText("Drama Show 1")).toBeTruthy();
    expect(screen.queryByText("Comedy Hour 0")).toBeNull();
    expect(cardCount(container)).toBe(60); // 250 matches, first page only
  });
});

describe("SeriesScreen category rail", () => {
  const manySeries = Array.from({ length: 100 }, (_, i) => ({ id: `s${i}`, name: `Drama Show ${i}`, groupTitle: "cat-1" }));

  beforeEach(async () => {
    clearAllCachedContent();
    __resetCategoryMemoryForTests();
    __resetCatalogDbForTests();
    await __clearCatalogDbForTests();
    for (const scope of ["content", "chrome:series-search", "chrome:category-rail"]) useFocusStore.getState().clearGraph(scope);
    vi.clearAllMocks();
    const { loadSeriesList } = await import("../content-loader.js");
    (loadSeriesList as ReturnType<typeof vi.fn>).mockImplementation((_source: PlaylistSource, categoryId?: string) =>
      Promise.resolve(categoryId && categoryId !== "cat-1" ? [] : manySeries),
    );
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
    fireEvent.click(screen.getByRole("button", { name: "Drama" }));
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
    clearAllCachedContent();
    __resetCategoryMemoryForTests();
    __resetCatalogDbForTests();
    await __clearCatalogDbForTests();
    for (const scope of ["content", "chrome:series-search", "chrome:category-rail"]) useFocusStore.getState().clearGraph(scope);
    vi.clearAllMocks();
    const loader = await import("../content-loader.js");
    (loader.loadSeriesList as ReturnType<typeof vi.fn>).mockResolvedValue(browseSeries);
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
