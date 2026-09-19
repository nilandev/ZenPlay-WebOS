import { useCallback, useEffect, useMemo, useState } from "react";
import type { PlatformId, PlaylistSource, Profile, SeriesEpisode } from "@core";
import {
  FavoriteHeart,
  FocusBackdrop,
  FocusCard,
  Shelf,
  ShelfRowSkeleton,
  buildGridFocusGraph,
  buildShelfFocusGraph,
  useFocusStore,
  useRemoteInput,
} from "@ui";
import { loadSeriesEpisodes, loadSeriesList } from "../content-loader.js";
import { toggleFavorite, isFavorite as checkIsFavorite } from "../profile-store.js";
import { useCachedContent } from "../use-cached-content.js";

export interface SeriesScreenProps {
  source: PlaylistSource;
  platform: PlatformId;
  profile: Profile;
  onPlayEpisode: (episode: SeriesEpisode) => void;
  onBack: () => void;
  /** Opens directly into this series' episode list instead of the shelf browser — used when arriving from My Favourite. */
  initialSelectedId?: string;
}

type SeriesSummary = Awaited<ReturnType<typeof loadSeriesList>>[number];

const EMPTY_SERIES: SeriesSummary[] = [];
const EMPTY_EPISODES: SeriesEpisode[] = [];

function groupByCategory(list: SeriesSummary[]): Array<{ title: string; items: SeriesSummary[] }> {
  const byGroup = new Map<string, SeriesSummary[]>();
  for (const series of list) {
    const key = series.groupTitle ?? "Series";
    const items = byGroup.get(key);
    if (items) items.push(series);
    else byGroup.set(key, [series]);
  }
  return Array.from(byGroup.entries()).map(([title, items]) => ({ title, items }));
}

export function SeriesScreen({ source, platform, profile, onPlayEpisode, onBack, initialSelectedId }: SeriesScreenProps): JSX.Element {
  const loadList = useCallback(() => loadSeriesList(source), [source]);
  const { data: seriesList, isInitialLoading: isListLoading } = useCachedContent(`series-list:${source.id}`, loadList, EMPTY_SERIES);

  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focusedId = useFocusStore((state) => state.focusedId);
  const [selected, setSelected] = useState<string | null>(initialSelectedId ?? null);

  // Bumped on every favourite toggle to force each FocusCard's heart badge
  // to re-render — see LiveTvScreen's identical comment for why this is
  // needed (toggleFavorite persists to localStorage but isn't itself
  // reactive state).
  const [favoritesVersion, setFavoritesVersion] = useState(0);

  const loadEpisodes = useCallback(
    () => (selected ? loadSeriesEpisodes(source, selected) : Promise.resolve(EMPTY_EPISODES)),
    [source, selected],
  );
  const { data: episodes, isInitialLoading: isEpisodesLoading } = useCachedContent(
    selected ? `series-episodes:${source.id}:${selected}` : "series-episodes:none",
    loadEpisodes,
    EMPTY_EPISODES,
  );

  const shelves = useMemo(() => groupByCategory(seriesList), [seriesList]);

  useEffect(() => {
    if (selected) return;
    const rows = shelves.map((shelf) => shelf.items.map((item) => item.id));
    if (rows.length === 0 || rows.every((r) => r.length === 0)) return;
    setGraph("content", buildShelfFocusGraph(rows), rows[0][0]);
    return () => clearGraph("content");
  }, [shelves, selected, setGraph, clearGraph]);

  useEffect(() => {
    if (!selected || episodes.length === 0) return;
    const ids = episodes.map((ep) => ep.id);
    setGraph("content", buildGridFocusGraph(ids, 4), ids[0]);
    return () => clearGraph("content");
  }, [selected, episodes, setGraph, clearGraph]);

  useRemoteInput(platform, {
    onSelect: (id) => {
      if (!id) return;
      if (selected) {
        const episode = episodes.find((ep) => ep.id === id);
        if (episode) onPlayEpisode(episode);
        return;
      }
      const series = seriesList.find((s) => s.id === id);
      if (series) setSelected(series.id);
    },
    onLongSelect: (id) => {
      // Favouriting applies to the series as a whole, not individual
      // episodes — only act while browsing the series list.
      if (!id || selected) return;
      const series = seriesList.find((s) => s.id === id);
      if (!series) return;
      toggleFavorite(profile.id, source.id, "series", series.id);
      setFavoritesVersion((v) => v + 1);
    },
    onBack: () => {
      if (selected) setSelected(null);
      else onBack();
    },
  });

  if (selected) {
    const series = seriesList.find((s) => s.id === selected);
    const bySeasonEntries = groupEpisodesBySeason(episodes);
    return (
      <div style={{ padding: "24px 40px" }}>
        <h1>{series?.name}</h1>
        {isEpisodesLoading ? (
          <ShelfRowSkeleton rows={1} cardWidth={280} aspectRatio="16 / 9" />
        ) : (
          bySeasonEntries.map(([season, seasonEpisodes]) => (
            <div key={season} style={{ marginBottom: 24 }}>
              <h3>Season {season}</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
                {seasonEpisodes.map((episode) => (
                  <FocusCard
                    key={episode.id}
                    id={episode.id}
                    title={`E${episode.episode}: ${episode.title}`}
                    imageUrl={episode.posterUrl}
                    aspectRatio="16 / 9"
                    onSelect={() => onPlayEpisode(episode)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    );
  }

  if (isListLoading) return <ShelfRowSkeleton />;

  const focusedSeries = seriesList.find((s) => s.id === focusedId);

  return (
    <div style={{ paddingTop: 24, paddingBottom: 40 }}>
      <FocusBackdrop imageUrl={focusedSeries?.posterUrl} />
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
              imageUrl={item.posterUrl}
              onSelect={() => setSelected(item.id)}
              badge={
                <FavoriteHeart
                  isFavorite={(() => {
                    void favoritesVersion; // re-evaluate on every toggle — see favoritesVersion's declaration
                    return checkIsFavorite(profile.id, source.id, "series", item.id);
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

function groupEpisodesBySeason(episodes: SeriesEpisode[]): Array<[number, SeriesEpisode[]]> {
  const bySeason = new Map<number, SeriesEpisode[]>();
  for (const episode of episodes) {
    const list = bySeason.get(episode.season);
    if (list) list.push(episode);
    else bySeason.set(episode.season, [episode]);
  }
  return Array.from(bySeason.entries()).sort(([a], [b]) => a - b);
}
