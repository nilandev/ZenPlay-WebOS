import { useCallback, useEffect, useMemo, useState } from "react";
import type { Channel, FavoriteEntry, FavoriteKind, PlatformId, PlaylistSource, SeriesInfo } from "@core";
import { buildGridFocusGraph, FavoriteHeart, Focusable, FocusCard, MeshBackground, useFocusStore, useRemoteInput, type FocusNode } from "@ui";
import { Heart } from "lucide-react";
import { loadChannelsByKind, loadSeriesList } from "../content-loader.js";
import { loadFavorites, toggleFavorite } from "../profile-store.js";
import { useCachedContent } from "../use-cached-content.js";

const GRID_COLUMNS = 5;

const FILTERS: { value: FavoriteKind | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "live", label: "Live TV" },
  { value: "movie", label: "Movies" },
  { value: "series", label: "Series" },
];

const filterId = (value: FavoriteKind | "all") => `favourites-filter:${value}`;
const itemId = (entry: FavoriteEntry) => `favourites-item:${entry.contentKind}:${entry.contentId}`;

const EMPTY_CHANNELS: Channel[] = [];
const EMPTY_SERIES: SeriesInfo[] = [];

function useIsFocused(id: string): boolean {
  return useFocusStore((state) => state.focusedId === id);
}

export interface FavouritesScreenProps {
  source: PlaylistSource;
  profileId: string;
  platform: PlatformId;
  onBack: () => void;
  onPlayChannel: (channel: Channel) => void;
  onPlayMovie: (movie: Channel) => void;
  onOpenSeries: (seriesId: string) => void;
}

/**
 * My Favourite: a pill-tab filter (All/Live TV/Movies/Series) over whatever
 * the active profile has favourited on the active playlist source. Loads
 * the same full live/movie/series lists the main tabs already load (and
 * shares their cache keys via useCachedContent) since favourites only store
 * an id + kind — there's no "get content by id" lookup, so the full lists
 * are loaded and filtered down to favourited ids client-side.
 */
export function FavouritesScreen({ source, profileId, platform, onBack, onPlayChannel, onPlayMovie, onOpenSeries }: FavouritesScreenProps): JSX.Element {
  const [filter, setFilter] = useState<FavoriteKind | "all">("all");

  // Bumped whenever a favourite is removed from this screen so the list
  // re-filters immediately instead of showing a now-stale entry.
  const [favoritesVersion, setFavoritesVersion] = useState(0);
  const favorites = useMemo(() => {
    void favoritesVersion;
    return loadFavorites(profileId).filter((f) => f.sourceId === source.id);
  }, [profileId, source.id, favoritesVersion]);

  const loadLive = useCallback(() => loadChannelsByKind(source, "live"), [source]);
  const { data: liveChannels } = useCachedContent(`live:${source.id}`, "catalog", loadLive, EMPTY_CHANNELS);

  const loadMovies = useCallback(() => loadChannelsByKind(source, "movie"), [source]);
  const { data: movies } = useCachedContent(`vod:${source.id}`, "catalog", loadMovies, EMPTY_CHANNELS);

  const loadSeries = useCallback(() => loadSeriesList(source), [source]);
  const { data: series } = useCachedContent(`series-list:${source.id}`, "catalog", loadSeries, EMPTY_SERIES);

  const items = useMemo(() => {
    const liveById = new Map(liveChannels.map((c) => [c.id, c]));
    const movieById = new Map(movies.map((c) => [c.id, c]));
    const seriesById = new Map(series.map((s) => [s.id, s]));

    return favorites
      .filter((f) => filter === "all" || f.contentKind === filter)
      .map((entry) => {
        if (entry.contentKind === "live") {
          const channel = liveById.get(entry.contentId);
          return channel ? { entry, title: channel.name, imageUrl: channel.logoUrl, aspectRatio: "1 / 1" } : null;
        }
        if (entry.contentKind === "movie") {
          const movie = movieById.get(entry.contentId);
          return movie ? { entry, title: movie.name, imageUrl: movie.logoUrl, aspectRatio: "2 / 3" } : null;
        }
        const seriesInfo = seriesById.get(entry.contentId);
        return seriesInfo ? { entry, title: seriesInfo.name, imageUrl: seriesInfo.posterUrl, aspectRatio: "2 / 3" } : null;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [favorites, filter, liveChannels, movies, series]);

  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);

  useEffect(() => {
    const filterIds = FILTERS.map((f) => filterId(f.value));
    const itemIds = items.map((item) => itemId(item.entry));

    const filterNodes: FocusNode[] = filterIds.map((id, index) => ({
      id,
      neighbors: {
        left: index > 0 ? filterIds[index - 1] : undefined,
        right: index < filterIds.length - 1 ? filterIds[index + 1] : undefined,
        down: itemIds[0],
      },
      onSelect: () => setFilter(FILTERS[index].value),
    }));

    const itemNodes: FocusNode[] = buildGridFocusGraph(itemIds, GRID_COLUMNS).map((node, index) => ({
      ...node,
      neighbors: { ...node.neighbors, up: node.neighbors.up ?? filterIds[0] },
      onSelect: () => {
        const item = items[index];
        if (!item) return;
        if (item.entry.contentKind === "live") {
          const channel = liveChannels.find((c) => c.id === item.entry.contentId);
          if (channel) onPlayChannel(channel);
        } else if (item.entry.contentKind === "movie") {
          const movie = movies.find((c) => c.id === item.entry.contentId);
          if (movie) onPlayMovie(movie);
        } else {
          onOpenSeries(item.entry.contentId);
        }
      },
    }));

    setGraph("favourites", [...filterNodes, ...itemNodes], filterIds[0]);
    return () => clearGraph("favourites");
    // items/favorites are derived fresh each render; only rebuild when the actual visible set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, filter, setGraph, clearGraph, onPlayChannel, onPlayMovie, onOpenSeries]);

  useRemoteInput(platform, {
    onLongSelect: (focusedId) => {
      const entry = items.find((item) => itemId(item.entry) === focusedId)?.entry;
      if (!entry) return;
      toggleFavorite(profileId, entry.sourceId, entry.contentKind, entry.contentId);
      setFavoritesVersion((v) => v + 1);
    },
    onBack,
  });

  return (
    <MeshBackground>
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", padding: "48px 56px 64px" }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, color: "var(--text)", marginBottom: 24 }}>My Favourite</h1>

        <div style={{ display: "flex", gap: 10, marginBottom: 36 }}>
          {FILTERS.map((f) => (
            <Focusable key={f.value} id={filterId(f.value)}>
              <FilterPill id={filterId(f.value)} label={f.label} isSelected={filter === f.value} onClick={() => setFilter(f.value)} />
            </Focusable>
          ))}
        </div>

        {items.length === 0 ? (
          <EmptyFavouritesState />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${GRID_COLUMNS}, 1fr)`, gap: 24 }}>
            {items.map((item) => (
              <FocusCard
                key={itemId(item.entry)}
                id={itemId(item.entry)}
                title={item.title}
                imageUrl={item.imageUrl}
                aspectRatio={item.aspectRatio}
                onSelect={() => {
                  if (item.entry.contentKind === "live") {
                    const channel = liveChannels.find((c) => c.id === item.entry.contentId);
                    if (channel) onPlayChannel(channel);
                  } else if (item.entry.contentKind === "movie") {
                    const movie = movies.find((c) => c.id === item.entry.contentId);
                    if (movie) onPlayMovie(movie);
                  } else {
                    onOpenSeries(item.entry.contentId);
                  }
                }}
                badge={<FavoriteHeart isFavorite />}
              />
            ))}
          </div>
        )}
      </div>
    </MeshBackground>
  );
}

function FilterPill({ id, label, isSelected, onClick }: { id: string; label: string; isSelected: boolean; onClick: () => void }): JSX.Element {
  const isFocused = useIsFocused(id);

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "10px 22px",
        borderRadius: 999,
        border: isSelected ? "1px solid var(--accent)" : isFocused ? "1px solid rgba(255,255,255,0.6)" : "1px solid rgba(255,255,255,0.14)",
        background: isSelected ? "rgba(56,189,248,0.18)" : isFocused ? "rgba(255,255,255,0.1)" : "transparent",
        color: isSelected ? "var(--accent)" : isFocused ? "var(--text)" : "var(--text-dim)",
        fontSize: 15,
        fontWeight: 600,
        boxShadow: isFocused ? "0 0 0 3px var(--accent)" : "none",
        transform: isFocused ? "scale(1.06)" : "scale(1)",
        transition: "transform 160ms ease-out, box-shadow 160ms ease-out, background 160ms ease-out, border-color 160ms ease-out",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function EmptyFavouritesState(): JSX.Element {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, minHeight: 360 }}>
      <Heart size={48} strokeWidth={1.5} color="var(--text-dim)" />
      <h2 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)" }}>No Favourite</h2>
      <p style={{ fontSize: 15, color: "var(--text-dim)", textAlign: "center", maxWidth: 420, lineHeight: 1.5 }}>
        Press and hold Select on a channel, movie, or series to add it to your favourites — they'll show up here.
      </p>
    </div>
  );
}
