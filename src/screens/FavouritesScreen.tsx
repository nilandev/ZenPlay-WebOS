import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Channel, FavoriteEntry, PlatformId, PlaylistSource, SeriesInfo } from "@core";
import {
  BROWSE_SIDE_PADDING,
  buildShelfFocusGraph,
  Focusable,
  FocusCard,
  LiftSurface,
  MeshBackground,
  POSTER_WIDTH,
  SECTION_ICONS,
  Shelf,
  TV_TEXT,
  URLImage,
  useFocusStore,
  useIsFocused,
  useRemoteInput,
  type FocusNode,
} from "@ui";
import { Check, Heart, Pencil, X } from "lucide-react";
import { getRecordsByIds } from "../catalog-store.js";
import { loadChannelsByKind, loadSeriesList } from "../content-loader.js";
import { loadFavorites, toggleFavorite } from "../profile-store.js";
import { useCachedContent } from "../use-cached-content.js";
import { useLocalCatalogReady } from "../use-local-catalog-ready.js";

const SCOPE = "favourites";
const EDIT_BUTTON_ID = "favourites-edit";
const itemId = (entry: FavoriteEntry) => `favourites-item:${entry.contentKind}:${entry.contentId}`;

const EMPTY_CHANNELS: Channel[] = [];
const EMPTY_SERIES: SeriesInfo[] = [];
type SeriesSummary = Pick<SeriesInfo, "id" | "name" | "posterUrl" | "groupTitle">;

export interface FavouritesScreenProps {
  source: PlaylistSource;
  profileId: string;
  platform: PlatformId;
  onBack: () => void;
  onPlayChannel: (channel: Channel) => void;
  onPlayMovie: (movie: Channel) => void;
  onOpenSeries: (seriesId: string) => void;
  /** True while PlayerScreen is open on top of this screen — disables this screen's own useRemoteInput so a single Back press doesn't both close the player and navigate this screen away. */
  isPlaybackOpen?: boolean;
}

interface ListItem {
  entry: FavoriteEntry;
  title: string;
  imageUrl?: string;
  channel?: Channel;
  movie?: Channel;
}

/**
 * Resolves saved movie/series ids to titles and artwork. Uses the local
 * catalog table (an indexed lookup of just these ids) once it has synced;
 * only a source that has never synced falls back to the full provider list
 * — and only for a type that actually has saved items.
 */
function useSavedRecords<T>(
  source: PlaylistSource,
  kind: "vod" | "series",
  ids: string[],
  loadFull: () => Promise<T[]>,
  empty: T[],
): T[] {
  const status = useLocalCatalogReady(source.id, kind);
  const [local, setLocal] = useState<T[] | null>(null);
  const idsKey = ids.join("|");

  useEffect(() => {
    if (status !== "ready" || ids.length === 0) {
      setLocal(null);
      return;
    }
    let cancelled = false;
    (getRecordsByIds(source.id, kind as "vod", ids) as Promise<unknown> as Promise<T[]>)
      .then((records) => {
        if (!cancelled) setLocal(records);
      })
      .catch(() => {
        if (!cancelled) setLocal(null);
      });
    return () => {
      cancelled = true;
    };
    // idsKey stands in for ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, source.id, kind, idsKey]);

  const { data: full } = useCachedContent(`${kind === "vod" ? "vod" : "series-list"}:${source.id}`, "catalog", loadFull, empty, {
    enabled: status === "not-synced" && ids.length > 0,
  });
  return local ?? full;
}

/**
 * My List, sized for TV: one row per type — Channels (logo tiles), Movies
 * and Series (posters) — newest first, with each row's count. Types with
 * nothing saved don't show, so there's nothing to switch between.
 *
 * Removing: "Edit My List" puts every card in remove mode (a red ✕); OK
 * then removes the focused item and focus moves to its neighbour. "Done" or
 * Back leaves edit mode. Long-press OK removes an item at any time.
 */
export function FavouritesScreen({
  source,
  profileId,
  platform,
  onBack,
  onPlayChannel,
  onPlayMovie,
  onOpenSeries,
  isPlaybackOpen = false,
}: FavouritesScreenProps): JSX.Element {
  // Bumped whenever an item is removed so the list re-reads localStorage.
  const [favoritesVersion, setFavoritesVersion] = useState(0);
  const [isEditing, setIsEditing] = useState(false);

  const favorites = useMemo(() => {
    void favoritesVersion;
    // Newest first.
    return loadFavorites(profileId)
      .filter((f) => f.sourceId === source.id)
      .reverse();
  }, [profileId, source.id, favoritesVersion]);

  const liveIds = favorites.filter((f) => f.contentKind === "live");
  const movieIds = useMemo(() => favorites.filter((f) => f.contentKind === "movie").map((f) => f.contentId), [favorites]);
  const seriesIds = useMemo(() => favorites.filter((f) => f.contentKind === "series").map((f) => f.contentId), [favorites]);

  const loadLive = useCallback(() => loadChannelsByKind(source, "live"), [source]);
  const { data: liveChannels } = useCachedContent(`live:${source.id}`, "catalog", loadLive, EMPTY_CHANNELS, { enabled: liveIds.length > 0 });
  const loadMovies = useCallback(() => loadChannelsByKind(source, "movie"), [source]);
  const movies = useSavedRecords(source, "vod", movieIds, loadMovies, EMPTY_CHANNELS);
  const loadSeries = useCallback(() => loadSeriesList(source), [source]);
  const series = useSavedRecords<SeriesSummary>(source, "series", seriesIds, loadSeries, EMPTY_SERIES);

  const rows = useMemo(() => {
    const liveById = new Map(liveChannels.map((c) => [c.id, c]));
    const movieById = new Map(movies.map((c) => [c.id, c]));
    const seriesById = new Map(series.map((s) => [s.id, s]));
    const channels: ListItem[] = [];
    const movieItems: ListItem[] = [];
    const seriesItems: ListItem[] = [];
    for (const entry of favorites) {
      if (entry.contentKind === "live") {
        const channel = liveById.get(entry.contentId);
        if (channel) channels.push({ entry, title: channel.name, imageUrl: channel.logoUrl, channel });
      } else if (entry.contentKind === "movie") {
        const movie = movieById.get(entry.contentId);
        if (movie) movieItems.push({ entry, title: movie.name, imageUrl: movie.logoUrl, movie });
      } else {
        const info = seriesById.get(entry.contentId);
        if (info) seriesItems.push({ entry, title: info.name, imageUrl: info.posterUrl });
      }
    }
    return [
      { key: "live", title: "Channels", items: channels },
      { key: "movie", title: "Movies", items: movieItems },
      { key: "series", title: "Series", items: seriesItems },
    ].filter((row) => row.items.length > 0);
  }, [favorites, liveChannels, movies, series]);

  const itemCount = rows.reduce((sum, row) => sum + row.items.length, 0);

  // Leave edit mode once there's nothing left to remove.
  useEffect(() => {
    if (itemCount === 0) setIsEditing(false);
  }, [itemCount]);

  const open = useCallback(
    (item: ListItem) => {
      if (item.channel) onPlayChannel(item.channel);
      else if (item.movie) onPlayMovie(item.movie);
      else onOpenSeries(item.entry.contentId);
    },
    [onPlayChannel, onPlayMovie, onOpenSeries],
  );

  // Where focus goes after a removal — the removed card's neighbour — applied
  // by the graph effect below once the list has re-rendered without it.
  const pendingFocusRef = useRef<string | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const remove = useCallback(
    (entry: FavoriteEntry) => {
      const id = itemId(entry);
      const currentRows = rowsRef.current;
      const rowIndex = currentRows.findIndex((row) => row.items.some((item) => itemId(item.entry) === id));
      const row = currentRows[rowIndex];
      if (row) {
        const index = row.items.findIndex((item) => itemId(item.entry) === id);
        const neighbour = row.items[index + 1] ?? row.items[index - 1];
        const otherRow = currentRows[rowIndex + 1] ?? currentRows[rowIndex - 1];
        pendingFocusRef.current = neighbour ? itemId(neighbour.entry) : otherRow ? itemId(otherRow.items[0].entry) : EDIT_BUTTON_ID;
      }
      toggleFavorite(profileId, entry.sourceId, entry.contentKind, entry.contentId);
      setFavoritesVersion((v) => v + 1);
    },
    [profileId],
  );

  const isEditingRef = useRef(isEditing);
  isEditingRef.current = isEditing;
  const activate = useCallback((item: ListItem) => (isEditingRef.current ? remove(item.entry) : open(item)), [remove, open]);

  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);

  useEffect(() => {
    // Nothing to navigate (still loading, or the list is empty — the Edit
    // button isn't shown then either). Registering the Edit node alone would
    // let it take the screen's initial focus ahead of the first item.
    if (rows.length === 0) {
      setGraph(SCOPE, []);
      return;
    }
    const idRows = rows.map((row) => row.items.map((item) => itemId(item.entry)));
    const itemById = new Map(rows.flatMap((row) => row.items.map((item) => [itemId(item.entry), item] as const)));
    const firstItemId = idRows[0]?.[0];
    const shelfNodes: FocusNode[] = idRows.length
      ? buildShelfFocusGraph(idRows).map((node, index) => ({
          ...node,
          neighbors: { ...node.neighbors, up: index < idRows[0].length ? EDIT_BUTTON_ID : node.neighbors.up },
          onSelect: () => {
            const item = itemById.get(node.id);
            if (item) activate(item);
          },
        }))
      : [];
    const editNode: FocusNode = {
      id: EDIT_BUTTON_ID,
      neighbors: { down: firstItemId },
      onSelect: () => setIsEditing((editing) => !editing),
    };
    const initial = pendingFocusRef.current ?? firstItemId ?? EDIT_BUTTON_ID;
    pendingFocusRef.current = null;
    setGraph(SCOPE, [editNode, ...shelfNodes], initial);
  }, [rows, activate, setGraph]);

  // Rebuilds replace the scope in place; clear it only when leaving the screen.
  useEffect(() => () => clearGraph(SCOPE), [clearGraph]);

  useRemoteInput(
    platform,
    {
      onLongSelect: (focusedId) => {
        const item = rows.flatMap((row) => row.items).find((candidate) => itemId(candidate.entry) === focusedId);
        if (item) remove(item.entry);
      },
      onBack: () => {
        if (isEditingRef.current) setIsEditing(false);
        else onBack();
      },
    },
    !isPlaybackOpen,
  );

  return (
    <MeshBackground>
      <div style={{ minHeight: "100vh", paddingBottom: "3rem" }}>
        <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "2rem", padding: `3rem ${BROWSE_SIDE_PADDING} 0` }}>
          <div>
            <h1 style={{ fontSize: "3rem", fontWeight: 800, color: "#fff", margin: 0 }}>My List</h1>
            <p style={{ fontSize: TV_TEXT, color: isEditing ? "#ff8a8a" : "var(--text-dim)", margin: "0.5rem 0 0" }}>
              {isEditing
                ? "Select an item to remove it"
                : itemCount > 0
                  ? `${itemCount} ${itemCount === 1 ? "item" : "items"} · long-press OK on any item to remove it`
                  : "Nothing saved yet"}
            </p>
          </div>
          {itemCount > 0 && <EditButton isEditing={isEditing} onClick={() => setIsEditing((editing) => !editing)} />}
        </header>

        {itemCount === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ marginTop: "1.5rem" }}>
            {rows.map((row) => (
              <Shelf
                key={row.key}
                title={`${row.title} · ${row.items.length}`}
                items={row.items}
                getId={(item) => itemId(item.entry)}
                leftInset={BROWSE_SIDE_PADDING}
                renderItem={(item) =>
                  item.entry.contentKind === "live" ? (
                    <ChannelTile item={item} isEditing={isEditing} onSelect={() => activate(item)} />
                  ) : (
                    <FocusCard
                      id={itemId(item.entry)}
                      title={item.title}
                      imageUrl={item.imageUrl}
                      width={POSTER_WIDTH}
                      placeholderIcon={item.entry.contentKind === "movie" ? SECTION_ICONS.movies : SECTION_ICONS.series}
                      badge={isEditing ? <RemoveBadge /> : undefined}
                      onSelect={() => activate(item)}
                    />
                  )
                }
              />
            ))}
          </div>
        )}
      </div>
    </MeshBackground>
  );
}

/** "Edit My List" / "Done" — same pill style as the app's other primary action buttons. */
function EditButton({ isEditing, onClick }: { isEditing: boolean; onClick: () => void }): JSX.Element {
  const isFocused = useIsFocused(EDIT_BUTTON_ID);
  const Icon = isEditing ? Check : Pencil;
  return (
    <Focusable id={EDIT_BUTTON_ID} style={{ width: "auto", height: "auto" }}>
      <button
        type="button"
        onClick={onClick}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "1rem 2rem",
          border: "none",
          borderRadius: 999,
          fontSize: TV_TEXT,
          fontWeight: 700,
          whiteSpace: "nowrap",
          background: isFocused ? "#ffffff" : isEditing ? "rgba(224,51,47,0.25)" : "rgba(255,255,255,0.14)",
          color: isFocused ? "#0b0c10" : "#ffffff",
          boxShadow: isFocused ? "0 1rem 2rem -0.5rem rgba(0,0,0,0.6)" : "inset 0 0 0 1px rgba(255,255,255,0.1)",
          transform: isFocused ? "scale(1.06)" : "scale(1)",
          transition: "transform 200ms cubic-bezier(0.2, 0.9, 0.3, 1)",
          cursor: "pointer",
        }}
      >
        <Icon size="1.5rem" strokeWidth={2.25} />
        {isEditing ? "Done" : "Edit My List"}
      </button>
    </Focusable>
  );
}

/** Red ✕ shown on every card in edit mode. */
function RemoveBadge(): JSX.Element {
  return (
    <span
      aria-label="Remove"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "2.5rem",
        height: "2.5rem",
        borderRadius: 999,
        background: "#e0332f",
        color: "#fff",
        boxShadow: "0 0.25rem 0.75rem rgba(0,0,0,0.5)",
      }}
    >
      <X size="1.5rem" strokeWidth={3} />
    </span>
  );
}

/** A saved channel: a wide tile with the channel's logo and name, lifting on focus like every other card. */
function ChannelTile({ item, isEditing, onSelect }: { item: ListItem; isEditing: boolean; onSelect: () => void }): JSX.Element {
  const id = itemId(item.entry);
  const isFocused = useIsFocused(id);
  return (
    <Focusable id={id}>
      <LiftSurface
        isFocused={isFocused}
        radius="1rem"
        width="24rem"
        role="button"
        tabIndex={-1}
        onClick={onSelect}
        faceStyle={{
          aspectRatio: "16 / 9",
          display: "flex",
          flexDirection: "column",
          background: isFocused ? "linear-gradient(160deg, #3a3d48 0%, #262830 100%)" : "linear-gradient(160deg, #23252d 0%, #17181d 100%)",
        }}
      >
        <div style={{ flex: 1, minHeight: 0, padding: "1.25rem 2.5rem 0.5rem" }}>
          <URLImage src={item.imageUrl} alt="" seed={item.entry.contentId} objectFit="contain" placeholderIcon={SECTION_ICONS.live} />
        </div>
        <div style={{ padding: "0 1.25rem 1rem", fontSize: TV_TEXT, fontWeight: 700, color: "#fff", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {item.title}
        </div>
        {isEditing && (
          <div style={{ position: "absolute", top: "0.75rem", right: "0.75rem" }}>
            <RemoveBadge />
          </div>
        )}
      </LiftSurface>
    </Focusable>
  );
}

function EmptyState(): JSX.Element {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1.25rem", minHeight: "60vh", padding: `0 ${BROWSE_SIDE_PADDING}` }}>
      <Heart size="5rem" strokeWidth={1.5} color="var(--text-dim)" />
      <h2 style={{ fontSize: "2.25rem", fontWeight: 800, color: "#fff", margin: 0 }}>Your list is empty</h2>
      <p style={{ fontSize: TV_TEXT, color: "var(--text-dim)", textAlign: "center", maxWidth: "48rem", lineHeight: 1.5, margin: 0 }}>
        Add channels with + My List in Live TV, series with + My List on their page, or long-press OK on any movie or series poster.
      </p>
    </div>
  );
}
