import { useCallback, useEffect, useMemo, useState } from "react";
import type { Channel, PlatformId, PlaylistSource, Profile } from "@core";
import { FavoriteHeart, FocusBackdrop, FocusCard, Shelf, ShelfRowSkeleton, buildShelfFocusGraph, useFocusStore, useRemoteInput } from "@ui";
import { loadChannelsByKind } from "../content-loader.js";
import { toggleFavorite, isFavorite as checkIsFavorite } from "../profile-store.js";
import { useCachedContent } from "../use-cached-content.js";

export interface VodScreenProps {
  source: PlaylistSource;
  platform: PlatformId;
  profile: Profile;
  onPlay: (movie: Channel) => void;
  onBack: () => void;
}

const EMPTY_MOVIES: Channel[] = [];

/** Groups a flat movie list into shelves by groupTitle, Apple TV browse-page style. */
function groupByCategory(movies: Channel[]): Array<{ title: string; items: Channel[] }> {
  const byGroup = new Map<string, Channel[]>();
  for (const movie of movies) {
    const key = movie.groupTitle ?? "Movies";
    const list = byGroup.get(key);
    if (list) list.push(movie);
    else byGroup.set(key, [movie]);
  }
  return Array.from(byGroup.entries()).map(([title, items]) => ({ title, items }));
}

export function VodScreen({ source, platform, profile, onPlay, onBack }: VodScreenProps): JSX.Element {
  const load = useCallback(() => loadChannelsByKind(source, "movie"), [source]);
  const { data: movies, isInitialLoading, error } = useCachedContent(`vod:${source.id}`, load, EMPTY_MOVIES);

  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focusedId = useFocusStore((state) => state.focusedId);

  // Bumped on every favourite toggle to force each FocusCard's heart badge
  // to re-render — see LiveTvScreen's identical comment for why this is
  // needed (toggleFavorite persists to localStorage but isn't itself
  // reactive state).
  const [favoritesVersion, setFavoritesVersion] = useState(0);

  const shelves = useMemo(() => groupByCategory(movies), [movies]);

  useEffect(() => {
    const rows = shelves.map((shelf) => shelf.items.map((item) => item.id));
    if (rows.length === 0 || rows.every((r) => r.length === 0)) return;
    setGraph("content", buildShelfFocusGraph(rows), rows[0][0]);
    return () => clearGraph("content");
  }, [shelves, setGraph, clearGraph]);

  useRemoteInput(platform, {
    onSelect: (id) => {
      const movie = movies.find((m) => m.id === id);
      if (movie) onPlay(movie);
    },
    onLongSelect: (id) => {
      const movie = movies.find((m) => m.id === id);
      if (!movie) return;
      toggleFavorite(profile.id, source.id, "movie", movie.id);
      setFavoritesVersion((v) => v + 1);
    },
    onBack,
  });

  const focusedMovie = movies.find((m) => m.id === focusedId);

  if (error) return <div role="alert">Failed to load movies: {error}</div>;

  if (isInitialLoading) return <ShelfRowSkeleton />;

  return (
    <div style={{ paddingTop: 24, paddingBottom: 40 }}>
      <FocusBackdrop imageUrl={focusedMovie?.logoUrl} />
      {shelves.map((shelf) => (
        <Shelf
          key={shelf.title}
          title={shelf.title}
          items={shelf.items}
          getId={(item) => item.id}
          renderItem={(item) => (
            <FocusCard
              id={item.id}
              title={item.name}
              imageUrl={item.logoUrl}
              onSelect={() => onPlay(item)}
              badge={
                <FavoriteHeart
                  isFavorite={(() => {
                    void favoritesVersion; // re-evaluate on every toggle — see favoritesVersion's declaration
                    return checkIsFavorite(profile.id, source.id, "movie", item.id);
                  })()}
                />
              }
            />
          )}
        />
      ))}
    </div>
  );
}
