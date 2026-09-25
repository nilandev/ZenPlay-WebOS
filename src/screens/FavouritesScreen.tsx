import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Channel, FavoriteEntry, PlatformId, PlaylistSource, SeriesInfo } from "@core";
import {
  BROWSE_SIDE_PADDING,
  buildShelfFocusGraph,
  Focusable,
  FocusCard,
  MeshBackground,
  POSTER_WIDTH,
  SECTION_ICONS,
  Shelf,
  TV_TEXT,
  useFocusStore,
  useIsFocused,
  useRemoteInput,
  type FocusNode,
} from "@ui";
import { Check, Heart, Pencil } from "lucide-react";
import { getRecordsByIds } from "../catalog-store.js";
import { loadFavorites, toggleFavorite } from "../profile-store.js";
import { syncSource } from "../sync/sync-manager.js";
import { useLocalCatalogReady } from "../use-local-catalog-ready.js";
import { withChannelNumbers, type ChannelLineup } from "../channel-lineup.js";
import { PASS_THROUGH_POLICY, type ContentPolicy } from "../content-policy.js";
import { useKidsAllowedKeys } from "../use-kids-allowed.js";
import { usePolicyLiveChannels } from "../use-policy-live-channels.js";
import { ChannelTile, RemoveBadge } from "./ListTiles.js";
import { useFavoritesRevision } from "../use-favorites-revision.js";

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
  /** The lineup (My List's channels) lets the player change channel with CH+/CH− and number keys. */
  onPlayChannel: (channel: Channel, lineup: ChannelLineup) => void;
  onPlayMovie: (movie: Channel) => void;
  onOpenSeries: (seriesId: string) => void;
  /** True while PlayerScreen is open on top of this screen — disables this screen's own useRemoteInput so a single Back press doesn't both close the player and navigate this screen away. */
  isPlaybackOpen?: boolean;
  /** The profile's content policy — a Kids profile's list only shows what's still allowed (docs/kids-profile.md §6). */
  policy?: ContentPolicy;
}

interface ListItem {
  entry: FavoriteEntry;
  title: string;
  imageUrl?: string;
  channel?: Channel;
  movie?: Channel;
}

/**
 * Resolves saved movie/series ids to titles and artwork with an indexed
 * lookup of just these ids in the local catalog table. A source whose
 * table hasn't been built yet asks the sync manager for it (the row fills
 * in when it lands) rather than downloading the whole provider list here.
 */
function useSavedRecords<T>(source: PlaylistSource, kind: "vod" | "series", ids: string[], empty: T[]): T[] {
  const status = useLocalCatalogReady(source.id, kind);
  const [local, setLocal] = useState<T[] | null>(null);
  const idsKey = ids.join("|");

  useEffect(() => {
    if (status !== "not-synced" || ids.length === 0) return;
    // An M3U playlist's movies come from its live stage; it has no series.
    if (source.kind !== "xtream" && kind === "series") return;
    void syncSource(source, { trigger: "first-run", stages: [source.kind === "xtream" ? kind : "live"] });
    // idsKey stands in for ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, source, kind, idsKey]);

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

  return local ?? empty;
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
  policy = PASS_THROUGH_POLICY,
}: FavouritesScreenProps): JSX.Element {
  // Bumped whenever an item is removed so the list re-reads localStorage.
  const [favoritesVersion, setFavoritesVersion] = useState(0);
  const favoritesRevision = useFavoritesRevision(); // My List changed elsewhere (e.g. from the player)
  const [isEditing, setIsEditing] = useState(false);

  const favorites = useMemo(() => {
    void favoritesVersion;
    // Newest first.
    return loadFavorites(profileId)
      .filter((f) => f.sourceId === source.id)
      .reverse();
  }, [profileId, source.id, favoritesVersion, favoritesRevision]);

  const liveIds = favorites.filter((f) => f.contentKind === "live");
  const movieIds = useMemo(() => favorites.filter((f) => f.contentKind === "movie").map((f) => f.contentId), [favorites]);
  const seriesIds = useMemo(() => favorites.filter((f) => f.contentKind === "series").map((f) => f.contentId), [favorites]);

  const { channels: liveChannels } = usePolicyLiveChannels(source, policy, { enabled: liveIds.length > 0 });
  const savedItems = useMemo(() => favorites.map((f) => ({ kind: f.contentKind, id: f.contentId })), [favorites]);
  // null for a standard profile: everything saved is shown.
  const allowedKeys = useKidsAllowedKeys(source, policy, savedItems);
  const movies = useSavedRecords(source, "vod", movieIds, EMPTY_CHANNELS);
  const series = useSavedRecords<SeriesSummary>(source, "series", seriesIds, EMPTY_SERIES);

  const rows = useMemo(() => {
    const liveById = new Map(liveChannels.map((c) => [c.id, c]));
    const movieById = new Map(movies.map((c) => [c.id, c]));
    const seriesById = new Map(series.map((s) => [s.id, s]));
    const channels: ListItem[] = [];
    const movieItems: ListItem[] = [];
    const seriesItems: ListItem[] = [];
    for (const entry of favorites) {
      if (allowedKeys && !allowedKeys.has(`${entry.contentKind}:${entry.contentId}`)) continue;
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
  }, [favorites, liveChannels, movies, series, allowedKeys]);

  // For the player's CH+/CH− (My List's channels, in order) and number keys (every channel, numbered as Live TV shows them).
  const numberedLive = useMemo(() => withChannelNumbers(liveChannels), [liveChannels]);
  const favoriteChannels = useMemo(
    () => rows.find((row) => row.key === "live")?.items.flatMap((item) => (item.channel ? [item.channel] : [])) ?? [],
    [rows],
  );

  const itemCount = rows.reduce((sum, row) => sum + row.items.length, 0);

  // Leave edit mode once there's nothing left to remove.
  useEffect(() => {
    if (itemCount === 0) setIsEditing(false);
  }, [itemCount]);

  const open = useCallback(
    (item: ListItem) => {
      if (item.channel) {
        const byId = new Map(numberedLive.map((c) => [c.id, c]));
        const lineup = favoriteChannels.map((c) => byId.get(c.id) ?? c);
        onPlayChannel(byId.get(item.channel.id) ?? item.channel, { lineup, directory: numberedLive });
      }
      else if (item.movie) onPlayMovie(item.movie);
      else onOpenSeries(item.entry.contentId);
    },
    [onPlayChannel, onPlayMovie, onOpenSeries, numberedLive, favoriteChannels],
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
                    <ChannelTile
                      id={itemId(item.entry)}
                      title={item.title}
                      imageUrl={item.imageUrl}
                      seed={item.entry.contentId}
                      isEditing={isEditing}
                      onSelect={() => activate(item)}
                    />
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
