import { useEffect, useMemo, useState } from "react";
import type { Channel, PlatformId, PlaylistSource } from "@iptv/core";
import { FocusBackdrop, FocusCard, Shelf, buildShelfFocusGraph, useFocusStore, useRemoteInput } from "@iptv/ui";
import { loadChannelsByKind } from "../content-loader.js";

export interface VodScreenProps {
  source: PlaylistSource;
  platform: PlatformId;
  onPlay: (movie: Channel) => void;
}

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

export function VodScreen({ source, platform, onPlay }: VodScreenProps): JSX.Element {
  const [movies, setMovies] = useState<Channel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focusedId = useFocusStore((state) => state.focusedId);

  useEffect(() => {
    let cancelled = false;
    loadChannelsByKind(source, "movie")
      .then((loaded) => !cancelled && setMovies(loaded))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [source]);

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
  });

  const focusedMovie = movies.find((m) => m.id === focusedId);

  if (error) return <div role="alert">Failed to load movies: {error}</div>;

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
            <FocusCard id={item.id} title={item.name} imageUrl={item.logoUrl} onSelect={() => onPlay(item)} />
          )}
        />
      ))}
    </div>
  );
}
