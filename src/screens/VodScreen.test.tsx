import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistSource, Profile } from "@core";
import { clearAllCachedContent, getCachedContent } from "../content-cache.js";
import { useFocusStore } from "../ui/focus/focus-store.js";
import { VodScreen } from "./VodScreen.js";

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
});

vi.mock("../content-loader.js", () => ({
  loadChannelsByKind: vi.fn(),
  loadVodCategories: vi.fn().mockResolvedValue([
    { id: "cat-1", name: "Action", kind: "movie" },
    { id: "cat-2", name: "Comedy", kind: "movie" },
  ]),
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

describe("VodScreen category-lazy fetching", () => {
  beforeEach(() => {
    clearAllCachedContent();
    useFocusStore.getState().clearGraph("content");
    useFocusStore.getState().clearGraph("chrome:vod-search");
    useFocusStore.getState().clearGraph("chrome:category-dropdown-trigger");
    useFocusStore.getState().clearGraph("chrome:category-dropdown-panel");
    vi.clearAllMocks();
  });

  it("fetches the full catalog for the default All Categories view", async () => {
    const { loadChannelsByKind, loadVodCategories } = await import("../content-loader.js");
    (loadChannelsByKind as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    render(<VodScreen source={source} platform="web" profile={profile} onPlay={() => {}} onBack={() => {}} />);
    await flush();

    expect(loadVodCategories).toHaveBeenCalledTimes(1);
    expect(loadChannelsByKind).toHaveBeenCalledWith(source, "movie");
  });

  it("selecting a category fetches only that category, not the full catalog again", async () => {
    const { loadChannelsByKind } = await import("../content-loader.js");
    (loadChannelsByKind as ReturnType<typeof vi.fn>).mockImplementation(
      (_source: PlaylistSource, _kind: string, categoryId?: string) =>
        Promise.resolve(
          categoryId === "cat-1" ? [{ id: "m1", name: "Action Movie", streamUrl: "x", kind: "movie" as const, groupTitle: "cat-1" }] : [],
        ),
    );

    render(<VodScreen source={source} platform="web" profile={profile} onPlay={() => {}} onBack={() => {}} />);
    await flush();

    (loadChannelsByKind as ReturnType<typeof vi.fn>).mockClear();

    fireEvent.click(screen.getByText("All Categories"));
    await flush();
    fireEvent.click(screen.getByText("Action"));
    await flush();

    expect(loadChannelsByKind).toHaveBeenCalledWith(source, "movie", "cat-1");
    expect(loadChannelsByKind).not.toHaveBeenCalledWith(source, "movie");
    expect(getCachedContent(`vod:${source.id}:cat:cat-1`)).toEqual([
      { id: "m1", name: "Action Movie", streamUrl: "x", kind: "movie", groupTitle: "cat-1" },
    ]);
    expect(await screen.findByText("Action Movie")).not.toBeNull();
  });
});
