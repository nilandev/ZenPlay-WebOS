import { useCallback, useEffect, useRef, useState } from "react";
import type { PlaylistSource } from "@core";
import { Focusable, TV_TEXT, TvButton, useFocusStore, useIsFocused, type FocusNode } from "@ui";
import { AlertTriangle, Check, DatabaseZap, Plus, RefreshCw, Trash2 } from "lucide-react";
import { loadPlaylistInfo } from "../content-loader.js";
import { resetSourceData } from "../sync/purge.js";
import { syncSource, type SyncOutcome } from "../sync/sync-manager.js";
import { getSourceSyncState, useSourceSyncState } from "../sync/sync-store.js";
import { describeRunningSync, describeSyncFailure, formatCounts, formatSyncedAgo, useSyncSummary } from "../sync/sync-summary.js";
import { useCachedContent } from "../use-cached-content.js";

const SCOPE = "settings-playlists";
const CONFIRM_SCOPE = "settings-playlists-confirm";
export const ADD_PLAYLIST_ID = "settings-playlists-add";
const CONFIRM_CANCEL_ID = "settings-playlists-confirm-cancel";
const CONFIRM_OK_ID = "settings-playlists-confirm-ok";
/** Cards per row. */
const COLUMNS = 3;
/** How long a refresh/reset result stays on a card. */
const STATUS_MS = 6000;
/** Expiry within this many days is flagged on the card. */
const EXPIRY_WARNING_DAYS = 7;

/**
 * Focus on a card or the Add tile: a slightly brighter glass surface with
 * a thin accent ring and a small lift — visible from across the room
 * without flipping the whole card to solid white (text keeps its colours).
 */
function tileFocusStyle(isFocused: boolean, idle: { background: string; boxShadow?: string }): React.CSSProperties {
  return {
    background: isFocused ? "rgba(255,255,255,0.1)" : idle.background,
    boxShadow: isFocused ? "inset 0 0 0 2px var(--accent, #38bdf8), 0 0.75rem 1.75rem -0.75rem rgba(0,0,0,0.6)" : idle.boxShadow,
    transform: isFocused ? "scale(1.02)" : "scale(1)",
    transition: "transform 200ms cubic-bezier(0.2, 0.9, 0.3, 1), background-color 160ms ease-out",
  };
}

export const playlistCardId = (sourceId: string) => `settings-playlists-card:${sourceId}`;
const refreshId = (sourceId: string) => `settings-playlists-refresh:${sourceId}`;
const resetId = (sourceId: string) => `settings-playlists-reset:${sourceId}`;
const deleteId = (sourceId: string) => `settings-playlists-delete:${sourceId}`;

/**
 * Where focus lands coming up from the section below the cards: the bottom
 * of the last row's first tile — its buttons for a playlist, or the Add
 * Playlist tile itself.
 */
export function playlistsEntryFromBelow(sources: PlaylistSource[]): string {
  const lastRowStart = Math.floor(sources.length / COLUMNS) * COLUMNS; // tiles are the playlists, then Add Playlist
  const tile = sources[lastRowStart];
  return tile ? refreshId(tile.id) : ADD_PLAYLIST_ID;
}

const EMPTY_PLAYLIST_INFO = { name: "", expiresAt: null as Date | null };

function kindLabel(kind: PlaylistSource["kind"]): string {
  if (kind === "xtream") return "Xtream Codes";
  if (kind === "m3u-url") return "M3U URL";
  return "M3U File";
}

/** Server URL / file origin — the one identifying detail each source kind actually has. */
function serverDetail(source: PlaylistSource): string {
  if (source.kind === "xtream") return source.baseUrl;
  if (source.kind === "m3u-url") return source.url;
  return "Imported file";
}

function formatExpiry(expiresAt: Date | null): string {
  if (expiresAt === null) return "Unlimited";
  return expiresAt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

interface CardStatus {
  tone: "success" | "error";
  message: string;
}

export interface PlaylistCardsProps {
  sources: PlaylistSource[];
  activeSourceId: string | undefined;
  /** The focus id below the cards (the first Content Settings row) — Down from the bottom row goes there. */
  exitDownId: string;
  /** Opens the (full-screen) Add Playlist form. */
  onAdd: () => void;
  onRemoveSource: (sourceId: string) => void;
  onSetActiveSource: (sourceId: string) => void;
}

/**
 * The Playlists section of App Settings: every playlist as a card, three to
 * a row, then an "Add Playlist" tile. A card shows the name (with an Active
 * badge), type, server, account and expiry, and when it was last downloaded
 * — or its live sync progress — with Refresh / Reset data / Delete under
 * it. OK on a card makes that playlist active.
 *
 * Focus: Left/Right between cards; Down from a card to its buttons (Left/
 * Right along them, across into the neighbouring card's); Down from the
 * buttons to the card below, or out of the section from the last row.
 * Delete and Reset data confirm in a dialog over the whole screen, in its
 * own focus scope (see dismissPlaylistDialog for how Back reaches it).
 */
export function PlaylistCards({ sources, activeSourceId, exitDownId, onAdd, onRemoveSource, onSetActiveSource }: PlaylistCardsProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focus = useFocusStore((state) => state.focus);

  const [confirming, setConfirming] = useState<{ sourceId: string; action: "delete" | "reset" } | null>(null);
  const confirmingSource = sources.find((s) => s.id === confirming?.sourceId) ?? null;

  // The result of the last Refresh/Reset on a card, shown for STATUS_MS.
  const [statusBySource, setStatusBySource] = useState<Record<string, CardStatus | undefined>>({});
  const statusTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = statusTimers.current;
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, []);
  const flashStatus = useCallback((sourceId: string, status: CardStatus) => {
    setStatusBySource((prev) => ({ ...prev, [sourceId]: status }));
    const timers = statusTimers.current;
    const existing = timers.get(sourceId);
    if (existing) clearTimeout(existing);
    timers.set(
      sourceId,
      setTimeout(() => setStatusBySource((prev) => ({ ...prev, [sourceId]: undefined })), STATUS_MS),
    );
  }, []);

  // Refresh/Reset report what actually happened once their sync finishes — the card shows live progress meanwhile.
  const reportOutcome = useCallback(
    (source: PlaylistSource, outcome: SyncOutcome, successMessage: string) => {
      const failure = describeSyncFailure(getSourceSyncState(source.id), source);
      const anySynced = Object.values(outcome.stages).some((status) => status === "synced");
      if (failure) flashStatus(source.id, { tone: "error", message: anySynced ? `Updated, except ${failure.message}` : `Refresh failed: ${failure.message}` });
      else flashStatus(source.id, { tone: "success", message: successMessage });
    },
    [flashStatus],
  );

  const handleRefresh = useCallback(
    (sourceId: string) => {
      const source = sources.find((s) => s.id === sourceId);
      if (!source) return;
      // Already refreshing: a second press would only queue another full download.
      const current = getSourceSyncState(sourceId);
      if (current.isRunning && current.trigger === "manual") return;
      setStatusBySource((prev) => ({ ...prev, [sourceId]: undefined }));
      void syncSource(source, { trigger: "manual", force: true }).then((outcome) => reportOutcome(source, outcome, "Updated"));
    },
    [sources, reportOutcome],
  );

  const handleReset = useCallback(
    (sourceId: string) => {
      const source = sources.find((s) => s.id === sourceId);
      if (!source) return;
      setStatusBySource((prev) => ({ ...prev, [sourceId]: undefined }));
      void resetSourceData(source).then((outcome) => reportOutcome(source, outcome, "Data reset and downloaded again"));
    },
    [sources, reportOutcome],
  );

  const canDelete = sources.length > 1;
  // Where focus returns after a confirmation dialog closes.
  const pendingFocusRef = useRef<string | null>(null);
  const latest = useRef({ onSetActiveSource, onAdd, handleRefresh });
  latest.current = { onSetActiveSource, onAdd, handleRefresh };
  const sourceIdsKey = sources.map((s) => s.id).join("|");

  useEffect(() => {
    if (confirming) {
      setGraph(SCOPE, []);
      return;
    }
    const ids = sources.map((s) => s.id);
    const buttonsOf = (sourceId: string) => [refreshId(sourceId), resetId(sourceId), ...(canDelete ? [deleteId(sourceId)] : [])];
    // A tile's top (the card, or the Add tile) and its bottom (its buttons' first, or the Add tile).
    const tileCount = ids.length + 1;
    const topOf = (index: number) => (index < ids.length ? playlistCardId(ids[index]) : ADD_PLAYLIST_ID);
    const bottomOf = (index: number) => (index < ids.length ? refreshId(ids[index]) : ADD_PLAYLIST_ID);
    const sameRow = (a: number, b: number) => b >= 0 && b < tileCount && Math.floor(a / COLUMNS) === Math.floor(b / COLUMNS);
    const below = (index: number) => (index + COLUMNS < tileCount ? topOf(index + COLUMNS) : exitDownId);
    const above = (index: number) => (index - COLUMNS >= 0 ? bottomOf(index - COLUMNS) : undefined);

    const nodes: FocusNode[] = [];
    ids.forEach((sourceId, index) => {
      const buttons = buttonsOf(sourceId);
      nodes.push({
        id: playlistCardId(sourceId),
        neighbors: {
          left: sameRow(index, index - 1) ? topOf(index - 1) : undefined,
          right: sameRow(index, index + 1) ? topOf(index + 1) : undefined,
          up: above(index),
          down: buttons[0],
        },
        onSelect: () => latest.current.onSetActiveSource(sourceId),
      });
      const actions = [
        () => latest.current.handleRefresh(sourceId),
        () => {
          pendingFocusRef.current = resetId(sourceId);
          setConfirming({ sourceId, action: "reset" });
        },
        () => {
          pendingFocusRef.current = deleteId(sourceId);
          setConfirming({ sourceId, action: "delete" });
        },
      ];
      buttons.forEach((id, b) => {
        const previousTile = sameRow(index, index - 1) ? index - 1 : null;
        const nextTile = sameRow(index, index + 1) ? index + 1 : null;
        nodes.push({
          id,
          neighbors: {
            // Along the row of buttons, continuing into the neighbouring card's.
            left: buttons[b - 1] ?? (previousTile !== null ? buttonsOf(ids[previousTile]).at(-1) : undefined),
            right: buttons[b + 1] ?? (nextTile !== null ? bottomOf(nextTile) : undefined),
            up: playlistCardId(sourceId),
            down: below(index),
          },
          onSelect: actions[b],
        });
      });
    });
    const addIndex = ids.length;
    nodes.push({
      id: ADD_PLAYLIST_ID,
      neighbors: {
        left: sameRow(addIndex, addIndex - 1) ? topOf(addIndex - 1) : undefined,
        up: above(addIndex),
        down: exitDownId,
      },
      onSelect: () => latest.current.onAdd(),
    });

    const pending = pendingFocusRef.current;
    pendingFocusRef.current = null;
    setGraph(SCOPE, nodes);
    if (pending) {
      const nodeIds = new Set(nodes.map((n) => n.id));
      const activeCard = activeSourceId && ids.includes(activeSourceId) ? playlistCardId(activeSourceId) : topOf(0);
      focus(nodeIds.has(pending) ? pending : activeCard);
    }
    // latest.current carries the callbacks; rebuild only when the cards change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceIdsKey, canDelete, confirming, exitDownId, setGraph]);

  useEffect(() => () => clearGraph(SCOPE), [clearGraph]);

  const confirmAction = useCallback(() => {
    if (!confirming) return;
    if (confirming.action === "delete") {
      pendingFocusRef.current = null;
      onRemoveSource(confirming.sourceId);
    } else {
      handleReset(confirming.sourceId);
    }
    setConfirming(null);
  }, [confirming, onRemoveSource, handleReset]);
  const cancelDialog = useCallback(() => setConfirming(null), []);

  useEffect(() => {
    if (!confirming) return;
    const nodes: FocusNode[] = [
      { id: CONFIRM_CANCEL_ID, neighbors: { right: CONFIRM_OK_ID }, onSelect: () => setConfirming(null) },
      { id: CONFIRM_OK_ID, neighbors: { left: CONFIRM_CANCEL_ID }, onSelect: confirmAction },
    ];
    setGraph(CONFIRM_SCOPE, nodes, CONFIRM_CANCEL_ID);
    focus(CONFIRM_CANCEL_ID);
    return () => clearGraph(CONFIRM_SCOPE);
  }, [confirming, confirmAction, setGraph, clearGraph, focus]);

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`, gap: "1.25rem" }}>
        {sources.map((source) => (
          <PlaylistCard
            key={source.id}
            source={source}
            isActive={source.id === activeSourceId}
            canDelete={canDelete}
            status={statusBySource[source.id]}
            onActivate={() => onSetActiveSource(source.id)}
            onRefresh={() => handleRefresh(source.id)}
            onRequestReset={() => {
              pendingFocusRef.current = resetId(source.id);
              setConfirming({ sourceId: source.id, action: "reset" });
            }}
            onRequestDelete={() => {
              pendingFocusRef.current = deleteId(source.id);
              setConfirming({ sourceId: source.id, action: "delete" });
            }}
          />
        ))}
        <AddPlaylistTile onSelect={onAdd} />
      </div>

      {confirmingSource && confirming && (
        <ConfirmDialog action={confirming.action} name={confirmingSource.name} onCancel={cancelDialog} onConfirm={confirmAction} />
      )}
    </>
  );
}

/**
 * For the Settings screen's Back key (it owns the remote for the whole
 * page): if a Delete/Reset dialog is open, cancels it and returns true.
 */
export function dismissPlaylistDialog(): boolean {
  const { nodes } = useFocusStore.getState();
  const cancel = nodes[CONFIRM_CANCEL_ID];
  if (!cancel) return false;
  cancel.onSelect?.();
  return true;
}

function PlaylistCard({
  source,
  isActive,
  canDelete,
  status,
  onActivate,
  onRefresh,
  onRequestReset,
  onRequestDelete,
}: {
  source: PlaylistSource;
  isActive: boolean;
  canDelete: boolean;
  status: CardStatus | undefined;
  onActivate: () => void;
  onRefresh: () => void;
  onRequestReset: () => void;
  onRequestDelete: () => void;
}): JSX.Element {
  const isFocused = useIsFocused(playlistCardId(source.id));

  // Only Xtream accounts expose expiry via the provider API. The sync
  // manager's sign-in stage refreshes this same key, so a Refresh updates it.
  const loadInfo = useCallback(() => loadPlaylistInfo(source), [source]);
  const { data: playlistInfo, isInitialLoading } = useCachedContent(`playlist-info:${source.id}`, "playlist-info", loadInfo, EMPTY_PLAYLIST_INFO);
  const expiresSoon = playlistInfo.expiresAt !== null && playlistInfo.expiresAt.getTime() - Date.now() <= EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000;

  // What's stored and how fresh — or, while this playlist syncs, its progress.
  const syncState = useSourceSyncState(source.id);
  const summary = useSyncSummary(source);
  const running = describeRunningSync(syncState, source);
  const counts = formatCounts(summary);

  const dim = isFocused ? "rgba(235,236,242,0.8)" : "rgba(235,236,242,0.6)";
  const line: React.CSSProperties = { fontSize: "1.125rem", color: dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        padding: "0.75rem",
        borderRadius: "1.5rem",
        background: isActive ? "rgba(74,222,128,0.06)" : "rgba(255,255,255,0.04)",
        boxShadow: isActive ? "inset 0 0 0 1px rgba(74,222,128,0.25)" : "inset 0 0 0 1px rgba(255,255,255,0.06)",
        minWidth: 0,
      }}
    >
      <Focusable id={playlistCardId(source.id)} style={{ minWidth: 0, height: "auto", flex: 1 }}>
        <button
          type="button"
          onClick={onActivate}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.375rem",
            width: "100%",
            height: "100%",
            padding: "1.125rem 1.25rem",
            border: "none",
            borderRadius: "1.125rem",
            textAlign: "left",
            color: "#ffffff",
            ...tileFocusStyle(isFocused, { background: "transparent" }),
            cursor: "pointer",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "0.75rem", minWidth: 0 }}>
            <span style={{ fontSize: "1.625rem", fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{source.name}</span>
            {isActive && <ActivePill />}
          </span>
          <span style={line}>{kindLabel(source.kind)}</span>
          <span style={line}>{serverDetail(source)}</span>
          {source.kind === "xtream" && (
            <span style={line}>
              User {source.username} · Expires {isInitialLoading ? "…" : formatExpiry(playlistInfo.expiresAt)}
            </span>
          )}
          <span style={line}>{running ?? (summary.lastSyncedAt !== null ? `Updated ${formatSyncedAgo(summary.lastSyncedAt)}` : "Not downloaded yet")}</span>
          {!running && counts && <span style={line}>{counts}</span>}
          {expiresSoon && (
            <span style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "1.125rem", fontWeight: 700, color: "#fbbf24" }}>
              <AlertTriangle size="1.125rem" style={{ flexShrink: 0 }} />
              {playlistInfo.expiresAt!.getTime() < Date.now() ? "This account has expired" : `Expires ${formatExpiry(playlistInfo.expiresAt)} — renew soon`}
            </span>
          )}
          {status && (
            <span
              style={{
                fontSize: "1.125rem",
                fontWeight: 700,
                color: status.tone === "error" ? "#ff8a8a" : "#4ade80",
              }}
            >
              {status.tone === "error" ? "⚠ " : "✓ "}
              {status.message}
            </span>
          )}
        </button>
      </Focusable>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", padding: "0 0.5rem 0.5rem" }}>
        <TvButton id={refreshId(source.id)} label={running ? "Refreshing…" : "Refresh"} icon={RefreshCw} busy={running !== null} onSelect={onRefresh} />
        <TvButton id={resetId(source.id)} label="Reset data" icon={DatabaseZap} onSelect={onRequestReset} />
        <TvButton id={deleteId(source.id)} label="Delete" icon={Trash2} variant="danger" disabled={!canDelete} onSelect={onRequestDelete} />
      </div>
    </div>
  );
}

/** The last tile in the grid: opens the Add Playlist form. */
function AddPlaylistTile({ onSelect }: { onSelect: () => void }): JSX.Element {
  const isFocused = useIsFocused(ADD_PLAYLIST_ID);
  return (
    <Focusable id={ADD_PLAYLIST_ID} style={{ minWidth: 0, height: "auto" }}>
      <button
        type="button"
        onClick={onSelect}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.75rem",
          width: "100%",
          height: "100%",
          minHeight: "14rem",
          border: "none",
          borderRadius: "1.5rem",
          ...tileFocusStyle(isFocused, { background: "rgba(255,255,255,0.03)", boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.14)" }),
          color: isFocused ? "#ffffff" : "rgba(235,236,242,0.8)",
          cursor: "pointer",
        }}
      >
        <Plus size="2.5rem" strokeWidth={2} />
        <span style={{ fontSize: "1.5rem", fontWeight: 700 }}>Add Playlist</span>
      </button>
    </Focusable>
  );
}

/** Delete / Reset data confirmation, over the whole screen. */
function ConfirmDialog({ action, name, onCancel, onConfirm }: { action: "delete" | "reset"; name: string; onCancel: () => void; onConfirm: () => void }): JSX.Element {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={action === "reset" ? `Reset data for ${name}` : `Delete ${name}`}
      style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(5,6,8,0.78)" }}
    >
      <div
        style={{
          textAlign: "center",
          maxWidth: "56rem",
          padding: "3.5rem 4rem",
          borderRadius: "1.75rem",
          background: "rgba(16,17,23,0.96)",
          boxShadow: "0 2rem 4rem rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.08)",
        }}
      >
        {action === "reset" ? (
          <>
            <DatabaseZap size="3.5rem" strokeWidth={1.75} color="var(--accent)" />
            <h1 style={{ fontSize: "2.5rem", fontWeight: 800, color: "#fff", margin: "1.25rem 0 1rem" }}>Reset data for “{name}”?</h1>
            <p style={{ fontSize: TV_TEXT, color: "var(--text-dim)", margin: "0 0 2.5rem", lineHeight: 1.5 }}>
              This deletes the channels, movies, series and guide stored for this playlist and downloads them again. Your favourites and history are kept.
            </p>
            <div style={{ display: "flex", gap: "1.25rem", justifyContent: "center" }}>
              <TvButton id={CONFIRM_CANCEL_ID} label="Cancel" onSelect={onCancel} />
              <TvButton id={CONFIRM_OK_ID} label="Reset data" icon={DatabaseZap} variant="primary" onSelect={onConfirm} />
            </div>
          </>
        ) : (
          <>
            <Trash2 size="3.5rem" strokeWidth={1.75} color="#ff8a8a" />
            <h1 style={{ fontSize: "2.5rem", fontWeight: 800, color: "#fff", margin: "1.25rem 0 1rem" }}>Delete “{name}”?</h1>
            <p style={{ fontSize: TV_TEXT, color: "var(--text-dim)", margin: "0 0 2.5rem", lineHeight: 1.5 }}>
              This removes the playlist, everything downloaded for it, and every profile's favourites and history from it. You can add it again later.
            </p>
            <div style={{ display: "flex", gap: "1.25rem", justifyContent: "center" }}>
              <TvButton id={CONFIRM_CANCEL_ID} label="Keep Playlist" onSelect={onCancel} />
              <TvButton id={CONFIRM_OK_ID} label="Delete" icon={Trash2} variant="danger" onSelect={onConfirm} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ActivePill(): JSX.Element {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.375rem",
        padding: "0.25rem 0.75rem",
        borderRadius: 999,
        background: "#16a34a",
        color: "#ffffff",
        fontSize: "1rem",
        fontWeight: 800,
        flexShrink: 0,
      }}
    >
      <Check size="1rem" strokeWidth={3} />
      Active
    </span>
  );
}
