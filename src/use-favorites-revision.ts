import { useSyncExternalStore } from "react";
import { getFavoritesRevision, subscribeFavorites } from "./profile-store.js";

/** A number that changes whenever My List changes anywhere in the app — add it to the deps of anything derived from loadFavorites/isFavorite. */
export function useFavoritesRevision(): number {
  return useSyncExternalStore(subscribeFavorites, getFavoritesRevision, getFavoritesRevision);
}
