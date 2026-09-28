import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistSource, Profile } from "@core";
import { clearAllCachedContent } from "../content-cache.js";
import { __clearCatalogDbForTests, __resetCatalogDbForTests, openCatalogDb, putRecordsBatch, putSyncMeta, type CatalogRecord } from "../core/storage/catalog-db.js";
import { __clearLiveDbForTests, __resetLiveDbForTests, openLiveDb, putChannels, putLiveSyncMeta } from "../core/storage/live-db.js";
import { __resetLiveStoreForTests } from "../live-store.js";
import { recordWatchHistory } from "../profile-store.js";
import { loadRecentSearches } from "../search/recent-searches.js";
import { useFocusStore } from "../ui/focus/focus-store.js";
import { runIndexJobs } from "../search/search-indexer.js";
import { __resetSearchMemoryForTests, SearchScreen } from "./SearchScreen.js";

vi.mock("../content-loader.js", () => ({
  loadVodCategories: vi.fn().mockResolvedValue([
    { id: "cat-1", name: "Action", kind: "movie" },
    { id: "cat-kids", name: "Kids Movies", kind: "movie" },
  ]),
  loadSeriesCategories: vi.fn().mockResolvedValue([{ id: "cat-s", name: "Drama", kind: "series" }]),
  loadLiveCategories: vi.fn().mockResolvedValue([]),
}));
// A playlist with no live list asks the sync manager for one; these tests cover what Search shows, not syncing.
vi.mock("../sync/sync-manager.js", () => ({ syncSource: vi.fn().mockResolvedValue({ stages: {}, errors: {} }) }));
const nowNext = vi.hoisted(() => ({ byChannel: new Map<string, string>() }));
vi.mock("../use-now-next.js", () => ({
  useNowNext: (_source: unknown, channel: { id: string } | null) => {
    const title = channel ? nowNext.byChannel.get(channel.id) : undefined;
    return { nowNext: title ? { now: { title } } : null, isLoading: false };
  },
}));

const source: PlaylistSource = { kind: "xtream", id: "src-1", name: "My Source", baseUrl: "http://example.com", username: "u", password: "p" };
const profile: Profile = { id: "profile-1", name: "Alex", avatarUrl: "avatar/toon_1.png" };

function record(kind: "vod" | "series", streamId: string, name: string, groupTitle: string): CatalogRecord {
  return { id: `${source.id}:${streamId}`, sourceId: source.id, streamId, name, nameLower: name.toLowerCase(), groupTitle, streamUrl: kind === "vod" ? "x" : undefined, generation: 1 };
}

async function seed(movies: CatalogRecord[], series: CatalogRecord[]): Promise<void> {
  const catalogDb = await openCatalogDb();
  await putRecordsBatch(catalogDb, "vod", movies);
  await putRecordsBatch(catalogDb, "series", series);
  await putSyncMeta(catalogDb, { key: `vod:${source.id}`, lastSyncedAt: Date.now(), recordCount: movies.length, generation: 1 });
  await putSyncMeta(catalogDb, { key: `series:${source.id}`, lastSyncedAt: Date.now(), recordCount: series.length, generation: 1 });
}

async function seedChannels(names: string[]): Promise<void> {
  const liveDb = await openLiveDb();
  await putChannels(
    liveDb,
    names.map((name, position) => ({ id: `ch-${position}`, name, streamUrl: `http://x/${position}`, kind: "live" as const, sourceId: source.id, position, generation: 1 })),
  );
  await putLiveSyncMeta(liveDb, { sourceId: source.id, lastSyncedAt: Date.now(), generation: 1, channelCount: names.length });
}

function press(key: string): void {
  act(() => {
    fireEvent.keyDown(document, { key });
    fireEvent.keyUp(document, { key });
  });
}
/** Types on a physical keyboard, which goes straight into the query. */
function type(text: string): void {
  for (const key of text) press(key);
}
const focusedId = () => useFocusStore.getState().focusedId;

function renderSearch(overrides: Partial<Parameters<typeof SearchScreen>[0]> = {}) {
  const props = { source, platform: "web" as const, profile, onPlayMovie: vi.fn(), onPlayChannel: vi.fn(), onOpenSeries: vi.fn(), onContinueSeries: vi.fn(), onBack: vi.fn(), ...overrides };
  return { ...render(<SearchScreen {...props} />), props };
}

beforeEach(async () => {
  Element.prototype.scrollIntoView = () => {};
  localStorage.clear();
  clearAllCachedContent();
  __resetSearchMemoryForTests();
  __resetCatalogDbForTests();
  await __clearCatalogDbForTests();
  __resetLiveStoreForTests();
  __resetLiveDbForTests();
  await __clearLiveDbForTests();
  nowNext.byChannel.clear();
  for (const scope of ["content", "search-keyboard"]) useFocusStore.getState().clearGraph(scope);
  act(() => useFocusStore.setState({ focusedId: null }));
  vi.clearAllMocks();
});

describe("SearchScreen", () => {
  it("opens on the keyboard, says which playlist it searches, and prompts before anything is typed", async () => {
    await seed([], []);
    renderSearch();
    await vi.waitFor(() => expect(focusedId()).toBe("kb:a"));
    expect(screen.getByText("Searching “My Source”")).toBeTruthy();
    expect(screen.getByText("Search channels, movies and series by title.")).toBeTruthy();
  });

  it("searches Movies and Series across every category — one row each — as the user types", async () => {
    await seed(
      [record("vod", "1", "Matrix Reloaded", "cat-1"), record("vod", "2", "Inception", "cat-1")],
      [record("series", "3", "Matrix Chronicles", "cat-s"), record("series", "4", "Breaking Bad", "cat-s")],
    );
    renderSearch();
    await vi.waitFor(() => expect(focusedId()).toBe("kb:a"));

    type("m");
    expect(await screen.findByText("Keep typing…")).toBeTruthy(); // one letter doesn't search yet
    type("at");

    expect(await screen.findByText("Matrix Reloaded")).toBeTruthy();
    expect(screen.getByText("Matrix Chronicles")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Movies" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Series" })).toBeTruthy();
    expect(screen.queryByText("Inception")).toBeNull();
    expect(screen.queryByText("Breaking Bad")).toBeNull();
  });

  it("types with the on-screen keyboard, and Right from its edge reaches the results", async () => {
    await seed([record("vod", "1", "Up", "cat-1")], []);
    renderSearch();
    await vi.waitFor(() => expect(focusedId()).toBe("kb:a"));

    act(() => useFocusStore.getState().focus("kb:u"));
    press("Enter");
    act(() => useFocusStore.getState().focus("kb:p"));
    press("Enter");
    expect(screen.getByRole("searchbox").textContent).toBe("up");
    await screen.findByText("Up");

    act(() => useFocusStore.getState().focus("kb:r")); // right-hand column
    press("ArrowRight");
    expect(focusedId()).toBe("search:vod:1");
    press("ArrowLeft");
    expect(focusedId()).toBe("kb:f");

    act(() => useFocusStore.getState().focus("kb:delete"));
    press("Enter");
    expect(screen.getByRole("searchbox").textContent).toBe("u");
  });

  it("once the background index has run, any word of a title finds it, best match first", async () => {
    await seed([record("vod", "1", "EN | The Matrix", "cat-1"), record("vod", "2", "Matrix Reloaded", "cat-1"), record("vod", "3", "Inception", "cat-1")], []);
    await runIndexJobs(await openCatalogDb(), [{ sourceId: source.id, kind: "vod" }], { paceMs: 0, shouldStop: () => false, sleep: () => Promise.resolve() });
    renderSearch();
    type("matrix");
    await screen.findByText("EN | The Matrix");
    const titles = Array.from(document.querySelectorAll('[data-focus-id^="search:vod:"]')).map((el) => el.textContent);
    expect(titles).toEqual(["EN | The Matrix", "Matrix Reloaded"]);
  });

  it("says so when nothing matches", async () => {
    await seed([record("vod", "1", "Inception", "cat-1")], []);
    renderSearch();
    type("xyz");
    expect(await screen.findByText("No matches for “xyz” in My Source. Check the spelling or try fewer letters.")).toBeTruthy();
  });

  it("a movie plays; a series opens — and coming back restores the query and the focused result", async () => {
    await seed([record("vod", "1", "Matrix Reloaded", "cat-1")], [record("series", "3", "Matrix Chronicles", "cat-s")]);
    const { props, unmount } = renderSearch();
    type("mat");
    await screen.findByText("Matrix Chronicles");

    act(() => useFocusStore.getState().focus("search:vod:1"));
    press("Enter");
    expect(props.onPlayMovie).toHaveBeenCalledWith(expect.objectContaining({ id: "1", name: "Matrix Reloaded" }));

    act(() => useFocusStore.getState().focus("search:series:3"));
    press("Enter");
    expect(props.onOpenSeries).toHaveBeenCalledWith("3");

    unmount();
    renderSearch();
    expect(screen.getByRole("searchbox").textContent).toBe("mat");
    await screen.findByText("Matrix Chronicles");
    await vi.waitFor(() => expect(focusedId()).toBe("search:series:3"));
  });

  it("a row with more than 20 matches ends in See all, which opens every match; Back returns to the rows", async () => {
    await seed(
      Array.from({ length: 25 }, (_, i) => record("vod", String(100 + i), `Star ${i}`, "cat-1")),
      [],
    );
    const { props } = renderSearch();
    type("star");
    await screen.findByText("Star 24"); // equally good matches: newest first
    expect(screen.queryByText("Star 0")).toBeNull(); // the 21st onwards are behind See all
    expect(document.querySelectorAll('[data-focus-id^="search:vod:"]')).toHaveLength(20);

    act(() => useFocusStore.getState().focus("search:see-all:vod"));
    press("Enter");
    expect(await screen.findByText("25 matches for “star”")).toBeTruthy();
    await vi.waitFor(() => expect(document.querySelectorAll('[data-focus-id^="search-grid:vod:"]')).toHaveLength(25));

    press("Escape");
    await vi.waitFor(() => expect(focusedId()).toBe("search:see-all:vod"));
    expect(props.onBack).not.toHaveBeenCalled();
    press("Escape");
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  it("Backspace deletes a character while there's a query, and goes Back once it's empty", async () => {
    await seed([], []);
    const { props } = renderSearch();
    type("ab");
    press("Backspace");
    expect(screen.getByRole("searchbox").textContent).toBe("a");
    press("Backspace");
    expect(props.onBack).not.toHaveBeenCalled();
    press("Backspace");
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  it("a Kids profile only finds what it's allowed to browse", async () => {
    await seed(
      [record("vod", "1", "Frozen", "cat-kids"), record("vod", "2", "Fright Night", "cat-1")],
      [],
    );
    renderSearch({ profile: { id: "kid-1", name: "Mia", avatarUrl: "avatar/toon_2.png", kind: "kids" } });
    type("fr");
    expect(await screen.findByText("Frozen")).toBeTruthy();
    expect(screen.queryByText("Fright Night")).toBeNull();
  });

  it("leaves out what hasn't downloaded yet, and says so when nothing has", async () => {
    renderSearch();
    expect(await screen.findByText("Your playlist is still downloading. You can search it once it's ready.")).toBeTruthy();
  });

  it("finds live channels too — with what's on now — and a channel plays with the matches as its lineup", async () => {
    await seed([], []);
    await seedChannels(["BBC One", "Sky News", "BBC Two"]);
    nowNext.byChannel.set("ch-0", "The News at Six");
    const { props } = renderSearch();
    type("bbc");

    expect(await screen.findByText("BBC One")).toBeTruthy();
    expect(screen.getByText("BBC Two")).toBeTruthy();
    expect(screen.queryByText("Sky News")).toBeNull();
    expect(screen.getByRole("heading", { name: "Live TV" })).toBeTruthy();
    expect(screen.getByText("CH 1 · Now: The News at Six")).toBeTruthy();

    act(() => useFocusStore.getState().focus("search:live:ch-2"));
    press("Enter");
    const [channel, lineup] = (props.onPlayChannel as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(channel).toMatchObject({ id: "ch-2", name: "BBC Two", number: 3 });
    expect(lineup.lineup.map((c: { name: string }) => c.name)).toEqual(["BBC One", "BBC Two"]);
    expect(lineup.directory).toHaveLength(3);
  });

  it("orders the rows by their best match", async () => {
    await seed([record("vod", "1", "News Of The World", "cat-1")], [record("series", "2", "Newsroom", "cat-s")]);
    await seedChannels(["Sky News HD"]);
    await runIndexJobs(await openCatalogDb(), [{ sourceId: source.id, kind: "live" }], { paceMs: 0, shouldStop: () => false, sleep: () => Promise.resolve() });
    renderSearch();
    type("news of");
    await screen.findByText("News Of The World");
    // Movies has the only title starting with the query; Series and Live TV don't match at all.
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Movies"]);

    act(() => useFocusStore.getState().focus("kb:clear"));
    press("Enter");
    type("news");
    await screen.findByText("Sky News HD"); // found by its second word, once indexed
    // Movies and Series start with "news"; the channel only has it as a later word.
    await vi.waitFor(() => expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Movies", "Series", "Live TV"]));
  });

  it("remembers what was searched once a result is opened, and offers it again before anything is typed", async () => {
    await seed([record("vod", "1", "Matrix Reloaded", "cat-1")], []);
    const first = renderSearch();
    type("mat");
    await screen.findByText("Matrix Reloaded");
    expect(loadRecentSearches(profile.id, source.id)).toEqual([]); // typing alone records nothing

    act(() => useFocusStore.getState().focus("search:vod:1"));
    press("Enter");
    expect(loadRecentSearches(profile.id, source.id)).toEqual(["mat"]);
    first.unmount();
    __resetSearchMemoryForTests();

    renderSearch();
    expect(screen.getByRole("heading", { name: "Recent searches" })).toBeTruthy();
    act(() => useFocusStore.getState().focus("search:recent:0"));
    press("Enter");
    expect(screen.getByRole("searchbox").textContent).toBe("mat");
    expect(await screen.findByText("Matrix Reloaded")).toBeTruthy();
  });

  it("shows Recently Watched before anything is typed, and opens from it", async () => {
    await seed([], []);
    recordWatchHistory({ profileId: profile.id, sourceId: source.id, kind: "movie", contentId: "9", title: "Heat", streamUrl: "http://x/9", positionSeconds: 60, durationSeconds: 600 });
    const { props } = renderSearch();
    expect(await screen.findByRole("heading", { name: "Recently Watched" })).toBeTruthy();

    act(() => useFocusStore.getState().focus("search:history:movie:9"));
    press("Enter");
    expect(props.onPlayMovie).toHaveBeenCalledWith(expect.objectContaining({ id: "9", name: "Heat" }), { resume: true });
  });
});
