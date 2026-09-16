import { useEffect, useMemo, useState } from "react";
import type { PlatformId, PlaylistSource, SeriesEpisode } from "@iptv/core";
import { FocusBackdrop, FocusCard, Shelf, buildGridFocusGraph, buildShelfFocusGraph, useFocusStore, useRemoteInput } from "@iptv/ui";
import { loadSeriesEpisodes, loadSeriesList } from "../content-loader.js";

export interface SeriesScreenProps {
  source: PlaylistSource;
  platform: PlatformId;
  onPlayEpisode: (episode: SeriesEpisode) => void;
}

type SeriesSummary = Awaited<ReturnType<typeof loadSeriesList>>[number];

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

export function SeriesScreen({ source, platform, onPlayEpisode }: SeriesScreenProps): JSX.Element {
  const [seriesList, setSeriesList] = useState<SeriesSummary[]>([]);
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<SeriesEpisode[]>([]);
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focusedId = useFocusStore((state) => state.focusedId);

  useEffect(() => {
    loadSeriesList(source).then(setSeriesList);
  }, [source]);

  useEffect(() => {
    if (!selectedSeriesId) return;
    let cancelled = false;
    loadSeriesEpisodes(source, selectedSeriesId).then((loaded) => !cancelled && setEpisodes(loaded));
    return () => {
      cancelled = true;
    };
  }, [source, selectedSeriesId]);

  const shelves = useMemo(() => groupByCategory(seriesList), [seriesList]);

  useEffect(() => {
    if (selectedSeriesId) return;
    const rows = shelves.map((shelf) => shelf.items.map((item) => item.id));
    if (rows.length === 0 || rows.every((r) => r.length === 0)) return;
    setGraph("content", buildShelfFocusGraph(rows), rows[0][0]);
    return () => clearGraph("content");
  }, [shelves, selectedSeriesId, setGraph, clearGraph]);

  useEffect(() => {
    if (!selectedSeriesId || episodes.length === 0) return;
    const ids = episodes.map((ep) => ep.id);
    setGraph("content", buildGridFocusGraph(ids, 4), ids[0]);
    return () => clearGraph("content");
  }, [selectedSeriesId, episodes, setGraph, clearGraph]);

  useRemoteInput(platform, {
    onSelect: (id) => {
      if (!id) return;
      if (selectedSeriesId) {
        const episode = episodes.find((ep) => ep.id === id);
        if (episode) onPlayEpisode(episode);
        return;
      }
      const series = seriesList.find((s) => s.id === id);
      if (series) setSelectedSeriesId(series.id);
    },
    onBack: () => {
      if (selectedSeriesId) setSelectedSeriesId(null);
    },
  });

  if (selectedSeriesId) {
    const series = seriesList.find((s) => s.id === selectedSeriesId);
    const bySeasonEntries = groupEpisodesBySeason(episodes);
    return (
      <div style={{ padding: "24px 40px" }}>
        <h1>{series?.name}</h1>
        {bySeasonEntries.map(([season, seasonEpisodes]) => (
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
        ))}
      </div>
    );
  }

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
            <FocusCard id={item.id} title={item.name} imageUrl={item.posterUrl} onSelect={() => setSelectedSeriesId(item.id)} />
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
