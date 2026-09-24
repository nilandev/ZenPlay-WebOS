import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Channel, PlatformId, PlaylistSource, WatchHistoryEntry } from "@core";
import {
  BROWSE_SIDE_PADDING,
  buildShelfFocusGraph,
  FocusCard,
  MeshBackground,
  POSTER_WIDTH,
  SECTION_ICONS,
  Shelf,
  TV_TEXT,
  TvButton,
  useFocusStore,
  useRemoteInput,
  type FocusNode,
} from "@ui";
import { Check, History, Pencil, Trash2 } from "lucide-react";
import type { ChannelLineup } from "../channel-lineup.js";
import { clearWatchHistory, loadWatchHistory, removeWatchHistory } from "../profile-store.js";
import { ChannelTile, RemoveBadge } from "./ListTiles.js";

const SCOPE = "history";
const CONFIRM_SCOPE = "history-confirm";
const EDIT_ID = "history-edit";
const CLEAR_ID = "history-clear";
const CONFIRM_KEEP_ID = "history-confirm-keep";
const CONFIRM_CLEAR_ID = "history-confirm-clear";
const itemId = (entry: WatchHistoryEntry) => `history-item:${entry.kind}:${entry.contentId}`;

export interface HistoryScreenProps {
  source: PlaylistSource;
  profileId: string;
  platform: PlatformId;
  onBack: () => void;
  /** Recently watched channels are the lineup, so CH+/CH− in the player move between them. */
  onPlayChannel: (channel: Channel, lineup: ChannelLineup) => void;
  /** resume: continue where it was left (no Resume/Start Over prompt). */
  onPlayMovie: (movie: Channel, options: { resume: boolean }) => void;
  /** Plays the series' saved episode (continuing it, or the next one). */
  onContinueSeries: (entry: WatchHistoryEntry) => void;
  onOpenSeries: (seriesId: string) => void;
  /** Bumped by the app whenever the player closes, so the list re-reads what was just watched. */
  refreshKey?: number;
  /** True while PlayerScreen is open on top of this screen (see use-remote-input.ts's `enabled`). */
  isPlaybackOpen?: boolean;
}

interface Row {
  key: string;
  title: string;
  items: WatchHistoryEntry[];
}

/** "1h 12m left" / "12 min left". */
function formatTimeLeft(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min left`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m left`;
}

/** "Just now" / "25 min ago" / "3h ago" / "Yesterday" / "4 days ago". */
export function formatWatchedAgo(iso: string, now = Date.now()): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 2) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

function progressOf(entry: WatchHistoryEntry): number | undefined {
  if (!entry.durationSeconds || !entry.positionSeconds) return undefined;
  return Math.min(1, Math.max(0, entry.positionSeconds / entry.durationSeconds));
}

function asChannel(entry: WatchHistoryEntry): Channel {
  return { id: entry.contentId, name: entry.title, streamUrl: entry.streamUrl ?? "", logoUrl: entry.imageUrl, kind: "live", number: entry.channelNumber };
}

/**
 * Recently Watched, per profile and playlist, as rows like My List:
 *
 * - Continue Watching — films and series in progress (or a series' next
 *   episode), with a progress bar and time left. OK continues straight away.
 * - Channels — recently watched live channels. OK tunes; CH+/CH− in the
 *   player move between these.
 * - Watched — finished titles. OK plays a film from the start or opens the series.
 *
 * Removing works like My List: Edit mode, or long-press OK. Clear History
 * asks first. Everything shown comes from the saved history, so the page
 * doesn't need to load any catalog.
 */
export function HistoryScreen({
  source,
  profileId,
  platform,
  onBack,
  onPlayChannel,
  onPlayMovie,
  onContinueSeries,
  onOpenSeries,
  refreshKey = 0,
  isPlaybackOpen = false,
}: HistoryScreenProps): JSX.Element {
  const [version, setVersion] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);

  const history = useMemo(() => {
    void version;
    void refreshKey;
    return loadWatchHistory(profileId, source.id);
  }, [profileId, source.id, version, refreshKey]);

  const rows = useMemo<Row[]>(() => {
    const inProgress = history.filter((e) => e.kind !== "live" && !e.finished);
    const channels = history.filter((e) => e.kind === "live");
    const watched = history.filter((e) => e.kind !== "live" && e.finished);
    return [
      { key: "continue", title: "Continue Watching", items: inProgress },
      { key: "channels", title: "Channels", items: channels },
      { key: "watched", title: "Watched", items: watched },
    ].filter((row) => row.items.length > 0);
  }, [history]);
  const itemCount = history.length;

  useEffect(() => {
    if (itemCount === 0) setIsEditing(false);
  }, [itemCount]);

  const open = useCallback(
    (entry: WatchHistoryEntry) => {
      if (entry.kind === "live") {
        const channels = history.filter((e) => e.kind === "live").map(asChannel);
        onPlayChannel(asChannel(entry), { lineup: channels, directory: channels });
      } else if (entry.kind === "movie") {
        onPlayMovie({ id: entry.contentId, name: entry.title, streamUrl: entry.streamUrl ?? "", logoUrl: entry.imageUrl, kind: "movie" }, { resume: !entry.finished });
      } else if (entry.finished) {
        onOpenSeries(entry.contentId);
      } else {
        onContinueSeries(entry);
      }
    },
    [history, onPlayChannel, onPlayMovie, onOpenSeries, onContinueSeries],
  );

  // After a removal, focus the removed card's neighbour once the list has re-rendered.
  const pendingFocusRef = useRef<string | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const remove = useCallback((entry: WatchHistoryEntry) => {
    const id = itemId(entry);
    const currentRows = rowsRef.current;
    const rowIndex = currentRows.findIndex((row) => row.items.some((item) => itemId(item) === id));
    const row = currentRows[rowIndex];
    if (row) {
      const index = row.items.findIndex((item) => itemId(item) === id);
      const neighbour = row.items[index + 1] ?? row.items[index - 1];
      const otherRow = currentRows[rowIndex + 1] ?? currentRows[rowIndex - 1];
      pendingFocusRef.current = neighbour ? itemId(neighbour) : otherRow ? itemId(otherRow.items[0]) : EDIT_ID;
    }
    removeWatchHistory(entry);
    setVersion((v) => v + 1);
  }, []);

  const isEditingRef = useRef(isEditing);
  isEditingRef.current = isEditing;
  const activate = useCallback((entry: WatchHistoryEntry) => (isEditingRef.current ? remove(entry) : open(entry)), [remove, open]);

  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focus = useFocusStore((state) => state.focus);

  useEffect(() => {
    if (isConfirmingClear || rows.length === 0) {
      setGraph(SCOPE, []);
      return;
    }
    const idRows = rows.map((row) => row.items.map(itemId));
    const entryById = new Map(rows.flatMap((row) => row.items.map((entry) => [itemId(entry), entry] as const)));
    const firstItemId = idRows[0][0];
    const shelfNodes: FocusNode[] = buildShelfFocusGraph(idRows).map((node, index) => ({
      ...node,
      neighbors: { ...node.neighbors, up: index < idRows[0].length ? EDIT_ID : node.neighbors.up },
      onSelect: () => {
        const entry = entryById.get(node.id);
        if (entry) activate(entry);
      },
    }));
    const headerNodes: FocusNode[] = [
      { id: EDIT_ID, neighbors: { right: CLEAR_ID, down: firstItemId }, onSelect: () => setIsEditing((editing) => !editing) },
      { id: CLEAR_ID, neighbors: { left: EDIT_ID, down: firstItemId }, onSelect: () => setIsConfirmingClear(true) },
    ];
    const initial = pendingFocusRef.current ?? firstItemId;
    pendingFocusRef.current = null;
    setGraph(SCOPE, [...headerNodes, ...shelfNodes], initial);
  }, [rows, activate, isConfirmingClear, setGraph]);

  useEffect(() => () => clearGraph(SCOPE), [clearGraph]);

  const clearAll = useCallback(() => {
    clearWatchHistory(profileId, source.id);
    setIsConfirmingClear(false);
    setVersion((v) => v + 1);
  }, [profileId, source.id]);

  useEffect(() => {
    if (!isConfirmingClear) return;
    setGraph(CONFIRM_SCOPE, [
      { id: CONFIRM_KEEP_ID, neighbors: { right: CONFIRM_CLEAR_ID }, onSelect: () => setIsConfirmingClear(false) },
      {
        id: CONFIRM_CLEAR_ID,
        neighbors: { left: CONFIRM_KEEP_ID },
        onSelect: clearAll,
      },
    ]);
    focus(CONFIRM_KEEP_ID);
    return () => {
      clearGraph(CONFIRM_SCOPE);
      pendingFocusRef.current = CLEAR_ID;
    };
  }, [isConfirmingClear, clearAll, setGraph, clearGraph, focus]);

  useRemoteInput(
    platform,
    {
      onLongSelect: (focusedId) => {
        const entry = history.find((candidate) => itemId(candidate) === focusedId);
        if (entry) remove(entry);
      },
      onBack: () => {
        if (isConfirmingClear) setIsConfirmingClear(false);
        else if (isEditingRef.current) setIsEditing(false);
        else onBack();
      },
    },
    !isPlaybackOpen,
  );

  if (isConfirmingClear) {
    return (
      <MeshBackground>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: `3rem ${BROWSE_SIDE_PADDING}` }}>
          <div
            style={{
              textAlign: "center",
              maxWidth: "56rem",
              padding: "3.5rem 4rem",
              borderRadius: "1.75rem",
              background: "rgba(16,17,23,0.92)",
              boxShadow: "0 2rem 4rem rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.08)",
            }}
          >
            <Trash2 size="3.5rem" strokeWidth={1.75} color="#ff8a8a" />
            <h1 style={{ fontSize: "2.5rem", fontWeight: 800, color: "#fff", margin: "1.25rem 0 1rem" }}>Clear Recently Watched?</h1>
            <p style={{ fontSize: TV_TEXT, color: "var(--text-dim)", margin: "0 0 2.5rem", lineHeight: 1.5 }}>
              This removes all {itemCount} {itemCount === 1 ? "title" : "titles"} from this profile's history for this playlist. Where you stopped in each film or episode is kept.
            </p>
            <div style={{ display: "flex", gap: "1.25rem", justifyContent: "center" }}>
              <TvButton id={CONFIRM_KEEP_ID} label="Keep History" onSelect={() => setIsConfirmingClear(false)} />
              <TvButton id={CONFIRM_CLEAR_ID} label="Clear" icon={Trash2} variant="danger" onSelect={clearAll} />
            </div>
          </div>
        </div>
      </MeshBackground>
    );
  }

  return (
    <MeshBackground>
      <div style={{ minHeight: "100vh", paddingBottom: "3rem" }}>
        <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "2rem", padding: `3rem ${BROWSE_SIDE_PADDING} 0` }}>
          <div>
            <h1 style={{ fontSize: "3rem", fontWeight: 800, color: "#fff", margin: 0 }}>Recently Watched</h1>
            <p style={{ fontSize: TV_TEXT, color: isEditing ? "#ff8a8a" : "var(--text-dim)", margin: "0.5rem 0 0" }}>
              {isEditing ? "Select an item to remove it" : itemCount > 0 ? "Pick up where you left off · long-press OK to remove" : "What you watch on this profile"}
            </p>
          </div>
          {itemCount > 0 && (
            <div style={{ display: "flex", gap: "1rem" }}>
              <TvButton id={EDIT_ID} label={isEditing ? "Done" : "Edit"} icon={isEditing ? Check : Pencil} onSelect={() => setIsEditing((editing) => !editing)} />
              <TvButton id={CLEAR_ID} label="Clear History" icon={Trash2} variant="danger" onSelect={() => setIsConfirmingClear(true)} />
            </div>
          )}
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
                getId={itemId}
                leftInset={BROWSE_SIDE_PADDING}
                renderItem={(entry) =>
                  entry.kind === "live" ? (
                    <ChannelTile
                      id={itemId(entry)}
                      title={entry.title}
                      subtitle={[entry.channelNumber !== undefined ? `CH ${entry.channelNumber}` : null, formatWatchedAgo(entry.updatedAt)].filter(Boolean).join(" · ")}
                      imageUrl={entry.imageUrl}
                      seed={entry.contentId}
                      isEditing={isEditing}
                      onSelect={() => activate(entry)}
                    />
                  ) : (
                    <FocusCard
                      id={itemId(entry)}
                      title={entry.title}
                      subtitle={cardSubtitle(entry)}
                      imageUrl={entry.imageUrl}
                      width={POSTER_WIDTH}
                      progress={entry.finished ? undefined : progressOf(entry)}
                      placeholderIcon={entry.kind === "movie" ? SECTION_ICONS.movies : SECTION_ICONS.series}
                      badge={isEditing ? <RemoveBadge /> : undefined}
                      onSelect={() => activate(entry)}
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

function cardSubtitle(entry: WatchHistoryEntry): string | undefined {
  if (entry.finished) return `Watched · ${formatWatchedAgo(entry.updatedAt)}`;
  const left = entry.durationSeconds && entry.positionSeconds !== undefined ? formatTimeLeft(entry.durationSeconds - entry.positionSeconds) : null;
  if (entry.kind === "series") return [entry.subtitle, entry.positionSeconds ? left : null].filter(Boolean).join(" · ") || undefined;
  return left ?? undefined;
}

function EmptyState(): JSX.Element {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1.25rem", minHeight: "60vh", padding: `0 ${BROWSE_SIDE_PADDING}` }}>
      <History size="5rem" strokeWidth={1.5} color="var(--text-dim)" />
      <h2 style={{ fontSize: "2.25rem", fontWeight: 800, color: "#fff", margin: 0 }}>Nothing watched yet</h2>
      <p style={{ fontSize: TV_TEXT, color: "var(--text-dim)", textAlign: "center", maxWidth: "48rem", lineHeight: 1.5, margin: 0 }}>
        Films, episodes and channels you watch show up here, so you can pick up where you left off.
      </p>
    </div>
  );
}
