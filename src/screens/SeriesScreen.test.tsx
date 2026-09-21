import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistSource, Profile } from "@core";
import { clearAllCachedContent, getCachedContent } from "../content-cache.js";
import { useFocusStore } from "../ui/focus/focus-store.js";
import { SeriesScreen } from "./SeriesScreen.js";

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
});

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
  beforeEach(() => {
    clearAllCachedContent();
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
    await flush();

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
    await flush();

    (loadSeriesList as ReturnType<typeof vi.fn>).mockClear();

    fireEvent.click(screen.getByText("All Categories"));
    await flush();
    fireEvent.click(screen.getByText("Drama"));
    await flush();

    expect(loadSeriesList).toHaveBeenCalledWith(source, "cat-1");
    expect(loadSeriesList).not.toHaveBeenCalledWith(source);
    expect(getCachedContent(`series-list:${source.id}:cat:cat-1`)).toEqual([
      { id: "s1", name: "Drama Show", groupTitle: "cat-1" },
    ]);
    expect(await screen.findByText("Drama Show")).not.toBeNull();
  });
});
