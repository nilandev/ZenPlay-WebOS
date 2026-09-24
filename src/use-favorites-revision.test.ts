import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { toggleFavorite } from "./profile-store.js";
import { useFavoritesRevision } from "./use-favorites-revision.js";

describe("useFavoritesRevision", () => {
  it("changes whenever My List changes, so other screens re-read it", () => {
    const { result } = renderHook(() => useFavoritesRevision());
    const before = result.current;
    act(() => {
      toggleFavorite("p", "s", "movie", "m1");
    });
    expect(result.current).toBe(before + 1);
  });
});
