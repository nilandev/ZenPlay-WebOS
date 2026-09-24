import { useEffect, useMemo, useRef, useState } from "react";
import type { SeriesEpisode } from "@core";
import { BROWSE_SIDE_PADDING, Focusable, FocusScrollManagedContext, SECTION_ICONS, TV_TEXT, URLImage, useFocusStore, useIsFocused, type FocusNode } from "@ui";

const SCOPE = "player-episodes";
const seasonChipId = (season: number) => `player-season:${season}`;
const episodeCardId = (episodeId: string) => `player-episode:${episodeId}`;

/**
 * The season's episodes as a row of thumbnails along the bottom of the
 * player (Netflix's in-player Episodes view). Left/Right walk the row, OK
 * plays an episode; with several seasons, Up reaches a row of season
 * chips (OK switches season). Back closes (PlayerScreen handles that).
 */
export function PlayerEpisodesPanel({
  episodes,
  currentEpisodeId,
  onPlayEpisode,
}: {
  episodes: SeriesEpisode[];
  currentEpisodeId?: string;
  onPlayEpisode: (episode: SeriesEpisode) => void;
}): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focus = useFocusStore((state) => state.focus);

  const seasons = useMemo(() => [...new Set(episodes.map((ep) => ep.season))].sort((a, b) => a - b), [episodes]);
  const currentEpisode = episodes.find((ep) => ep.id === currentEpisodeId);
  const [season, setSeason] = useState(currentEpisode?.season ?? seasons[0]);
  const seasonEpisodes = useMemo(() => episodes.filter((ep) => ep.season === season).sort((a, b) => a.episode - b.episode), [episodes, season]);

  const latestRef = useRef({ seasonEpisodes, onPlayEpisode });
  latestRef.current = { seasonEpisodes, onPlayEpisode };
  const hasSeasonRow = seasons.length > 1;

  useEffect(() => {
    const cardIds = seasonEpisodes.map((ep) => episodeCardId(ep.id));
    const chipIds = hasSeasonRow ? seasons.map(seasonChipId) : [];
    const nodes: FocusNode[] = [
      ...chipIds.map((id, index) => ({
        id,
        neighbors: { left: chipIds[index - 1], right: chipIds[index + 1], down: cardIds[0] },
        onSelect: () => setSeason(seasons[index]),
      })),
      ...cardIds.map((id, index) => ({
        id,
        neighbors: { left: cardIds[index - 1], right: cardIds[index + 1], up: hasSeasonRow ? seasonChipId(season) : undefined },
        onSelect: () => latestRef.current.onPlayEpisode(latestRef.current.seasonEpisodes[index]),
      })),
    ];
    setGraph(SCOPE, nodes);
  }, [seasonEpisodes, seasons, season, hasSeasonRow, setGraph]);

  // Open on the episode that's playing (or the season's first).
  useEffect(() => {
    focus(episodeCardId(currentEpisode?.id ?? seasonEpisodes[0]?.id ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => clearGraph(SCOPE), [clearGraph]);

  return (
    <FocusScrollManagedContext.Provider value={false}>
      <div
        role="dialog"
        aria-label="Episodes"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 60,
          paddingTop: "12rem",
          background: "linear-gradient(0deg, rgba(5,6,9,0.97) 0%, rgba(5,6,9,0.9) 60%, rgba(5,6,9,0) 100%)",
          animation: "player-episodes-in 260ms cubic-bezier(0.2, 0.8, 0.3, 1)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", padding: `0 ${BROWSE_SIDE_PADDING}`, marginBottom: "1.25rem" }}>
          <span style={{ fontSize: "2rem", fontWeight: 800, color: "#fff", marginRight: "1rem" }}>Episodes</span>
          {hasSeasonRow ? (
            seasons.map((n) => <SeasonChip key={n} season={n} isActive={n === season} onClick={() => setSeason(n)} />)
          ) : (
            <span style={{ fontSize: TV_TEXT, color: "var(--text-dim)" }}>Season {season}</span>
          )}
        </div>
        <div style={{ display: "flex", gap: "1.75rem", overflowX: "hidden", padding: `1rem ${BROWSE_SIDE_PADDING} 3rem` }}>
          {seasonEpisodes.map((episode) => (
            <EpisodeThumb key={episode.id} episode={episode} isCurrent={episode.id === currentEpisodeId} onClick={() => onPlayEpisode(episode)} />
          ))}
        </div>
        <style>{`
          @keyframes player-episodes-in {
            from { opacity: 0; transform: translateY(2rem); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>
    </FocusScrollManagedContext.Provider>
  );
}

function SeasonChip({ season, isActive, onClick }: { season: number; isActive: boolean; onClick: () => void }): JSX.Element {
  const id = seasonChipId(season);
  const isFocused = useIsFocused(id);
  return (
    <Focusable id={id} style={{ width: "auto", height: "auto", flexShrink: 0 }}>
      <button
        type="button"
        aria-pressed={isActive}
        onClick={onClick}
        style={{
          padding: "0.625rem 1.25rem",
          border: "none",
          borderRadius: 999,
          fontSize: TV_TEXT,
          fontWeight: 700,
          whiteSpace: "nowrap",
          background: isFocused ? "#fff" : isActive ? "rgba(255,255,255,0.2)" : "transparent",
          color: isFocused ? "#0b0c10" : isActive ? "#fff" : "rgba(255,255,255,0.6)",
          boxShadow: isActive && !isFocused ? "inset 0 0 0 1px rgba(255,255,255,0.3)" : "none",
          cursor: "pointer",
        }}
      >
        Season {season}
      </button>
    </Focusable>
  );
}

function EpisodeThumb({ episode, isCurrent, onClick }: { episode: SeriesEpisode; isCurrent: boolean; onClick: () => void }): JSX.Element {
  const id = episodeCardId(episode.id);
  const isFocused = useIsFocused(id);
  const minutes = episode.durationSeconds ? Math.round(episode.durationSeconds / 60) : null;
  return (
    <Focusable id={id} style={{ width: "22rem", height: "auto", flexShrink: 0 }}>
      <button type="button" onClick={onClick} style={{ display: "block", width: "100%", padding: 0, border: "none", background: "transparent", textAlign: "left", cursor: "pointer" }}>
        <div
          style={{
            position: "relative",
            aspectRatio: "16 / 9",
            borderRadius: "0.875rem",
            overflow: "hidden",
            background: "rgba(255,255,255,0.06)",
            boxShadow: isFocused ? "0 0 0 0.25rem #fff, 0 1.25rem 2.5rem -0.75rem rgba(0,0,0,0.8)" : "none",
            transform: isFocused ? "scale(1.05)" : "scale(1)",
            transition: "transform 200ms cubic-bezier(0.2, 0.9, 0.3, 1)",
          }}
        >
          <URLImage src={episode.posterUrl} alt="" seed={episode.id} placeholderIcon={SECTION_ICONS.series} />
          {isCurrent && (
            <span
              style={{
                position: "absolute",
                left: "0.75rem",
                top: "0.75rem",
                padding: "0.25rem 0.75rem",
                borderRadius: "0.5rem",
                background: "var(--accent)",
                color: "#062028",
                fontSize: "1rem",
                fontWeight: 800,
              }}
            >
              Now playing
            </span>
          )}
        </div>
        <div
          style={{
            marginTop: "0.875rem",
            fontSize: TV_TEXT,
            fontWeight: 700,
            color: isFocused ? "#fff" : "rgba(255,255,255,0.8)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {episode.episode}. {episode.title}
        </div>
        {minutes !== null && <div style={{ fontSize: "1.125rem", color: "var(--text-dim)", marginTop: "0.25rem" }}>{minutes} min</div>}
      </button>
    </Focusable>
  );
}
