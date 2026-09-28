import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistSource, Profile } from "@core";
import { PASS_THROUGH_POLICY } from "../content-policy.js";
import { useFocusStore } from "../ui/focus/focus-store.js";
import { KidsHomeScreen } from "./KidsHomeScreen.js";

// The rails read the local tables; this covers the section tiles only.
vi.mock("../use-kids-home-rails.js", () => ({ useKidsHomeRails: () => ({ rails: [], isLoading: false }) }));

const source: PlaylistSource = { kind: "m3u-url", id: "src-1", name: "My Source", url: "http://example.com/list.m3u" };
const kid: Profile = { id: "kid-1", name: "Mia", avatarUrl: "avatar/toon_2.png", kind: "kids" };

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
});

describe("KidsHomeScreen", () => {
  it("has Search as its first tile, and it opens Search", () => {
    const onSelectTile = vi.fn();
    render(
      <KidsHomeScreen
        source={source}
        platform="web"
        profile={kid}
        policy={PASS_THROUGH_POLICY}
        onSelectTile={onSelectTile}
        onOpenProfiles={() => {}}
        onPlayMovie={() => {}}
        onPlayChannel={() => {}}
        onContinueSeries={() => {}}
        onOpenSeries={() => {}}
      />,
    );
    const tiles = screen.getAllByRole("button").map((b) => b.textContent);
    expect(tiles.indexOf("Search")).toBeLessThan(tiles.indexOf("Live TV"));

    act(() => useFocusStore.getState().focus("kids-nav:search"));
    act(() => {
      fireEvent.keyDown(document, { key: "Enter" });
      fireEvent.keyUp(document, { key: "Enter" });
    });
    expect(onSelectTile).toHaveBeenCalledWith("search");
  });
});
