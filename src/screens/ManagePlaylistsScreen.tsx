import { useCallback, useEffect, useRef, useState } from "react";
import type { PlatformId, PlaylistSource } from "@core";
import { BROWSE_SIDE_PADDING, Focusable, MeshBackground, TV_TEXT, TvButton, useFocusStore, useIsFocused, useRemoteInput, type FocusNode } from "@ui";
import { Check, DatabaseZap, Plus, RefreshCw, Trash2 } from "lucide-react";
import { clearCachedContent, clearCachedContentForSource } from "../content-cache.js";
import { loadPlaylistInfo } from "../content-loader.js";
import { clearEpgForSource } from "../epg-sync.js";
import { clearLiveForSource } from "../live-sync.js";
import { useCachedContent } from "../use-cached-content.js";
import { AddSourceScreen } from "./AddSourceScreen.js";

const SCOPE = "manage-playlists";
const CONFIRM_SCOPE = "manage-playlists-confirm";
const ADD_ID = "manage-playlists-add";
/** How long "Refreshed" / "Cache cleared" stays on a row. */
const STATUS_MS = 3000;
const CONFIRM_KEEP_ID = "manage-playlists-confirm-keep";
const CONFIRM_DELETE_ID = "manage-playlists-confirm-delete";
const cardId = (sourceId: string) => `manage-playlists-card:${sourceId}`;
const refreshId = (sourceId: string) => `manage-playlists-refresh:${sourceId}`;
const clearCacheId = (sourceId: string) => `manage-playlists-clear-cache:${sourceId}`;
const deleteId = (sourceId: string) => `manage-playlists-delete:${sourceId}`;

const EMPTY_PLAYLIST_INFO = { name: "", expiresAt: null as Date | null };

function kindLabel(kind: PlaylistSource["kind"]): string {
  if (kind === "xtream") return "Xtream Codes";
  if (kind === "m3u-url") return "M3U URL";
  return "M3U File";
}

/** Server URL / file origin shown under the playlist name — the one identifying detail each source kind actually has. */
function serverDetail(source: PlaylistSource): string {
  if (source.kind === "xtream") return source.baseUrl;
  if (source.kind === "m3u-url") return source.url;
  return "Imported file";
}

function formatExpiry(expiresAt: Date | null): string {
  if (expiresAt === null) return "Unlimited";
  return expiresAt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export interface ManagePlaylistsScreenProps {
  sources: PlaylistSource[];
  activeSourceId: string | undefined;
  platform: PlatformId;
  onBack: () => void;
  onAddSource: (source: PlaylistSource) => void;
  onRemoveSource: (sourceId: string) => void;
  onSetActiveSource: (sourceId: string) => void;
}

/**
 * Playlist management, reached from App Settings → Manage Playlists. Delegates
 * entirely to either AddSourceScreen or the grid view — same
 * single-input-owner split as ManageProfilesScreen, since a parent and
 * child screen both calling useRemoteInput at once double-fires every
 * D-pad select (see conversation history).
 */
export function ManagePlaylistsScreen({
  sources,
  activeSourceId,
  platform,
  onBack,
  onAddSource,
  onRemoveSource,
  onSetActiveSource,
}: ManagePlaylistsScreenProps): JSX.Element {
  const [isAdding, setIsAdding] = useState(false);

  if (isAdding) {
    return (
      <AddSourceScreen
        onSourceAdded={(source) => {
          onAddSource(source);
          setIsAdding(false);
        }}
        onCancel={() => setIsAdding(false)}
        platform={platform}
      />
    );
  }

  return (
    <ManagePlaylistsGrid
      sources={sources}
      activeSourceId={activeSourceId}
      platform={platform}
      onBack={onBack}
      onAdd={() => setIsAdding(true)}
      onRemoveSource={onRemoveSource}
      onSetActiveSource={onSetActiveSource}
    />
  );
}

/**
 * Playlist list for TV: one wide row per playlist — name, Active badge, and
 * type · server · username · expiry — with Refresh / Clear Cache / Delete
 * buttons on the same row (Right from the row). OK on the row makes that
 * playlist active; "+ Add Playlist" sits in the header. Up/Down between
 * rows keep the same column (row → row, Refresh → Refresh, …).
 */
function ManagePlaylistsGrid({
  sources,
  activeSourceId,
  platform,
  onBack,
  onAdd,
  onRemoveSource,
  onSetActiveSource,
}: {
  sources: PlaylistSource[];
  activeSourceId: string | undefined;
  platform: PlatformId;
  onBack: () => void;
  onAdd: () => void;
  onRemoveSource: (sourceId: string) => void;
  onSetActiveSource: (sourceId: string) => void;
}): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focus = useFocusStore((state) => state.focus);

  // Delete always asks for confirmation, in its own focus scope.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const confirmingSource = sources.find((s) => s.id === confirmingDeleteId) ?? null;

  // Per-source refresh tick: bumping it changes the playlist-info cache key,
  // forcing that row's lookup to re-run (clearing the cache alone doesn't
  // re-trigger an already-mounted useCachedContent).
  const [refreshTick, setRefreshTick] = useState<Record<string, number>>({});
  // Short confirmation shown on a row after an action.
  const [statusBySource, setStatusBySource] = useState<Record<string, string>>({});
  const statusTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = statusTimers.current;
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, []);
  const flashStatus = useCallback((sourceId: string, message: string) => {
    setStatusBySource((prev) => ({ ...prev, [sourceId]: message }));
    const timers = statusTimers.current;
    const existing = timers.get(sourceId);
    if (existing) clearTimeout(existing);
    timers.set(
      sourceId,
      setTimeout(() => setStatusBySource((prev) => ({ ...prev, [sourceId]: "" })), STATUS_MS),
    );
  }, []);

  const handleRefresh = useCallback(
    (sourceId: string) => {
      clearCachedContent(`playlist-info:${sourceId}`);
      setRefreshTick((prev) => ({ ...prev, [sourceId]: (prev[sourceId] ?? 0) + 1 }));
      flashStatus(sourceId, "Refreshed");
    },
    [flashStatus],
  );

  const handleClearCache = useCallback(
    (sourceId: string) => {
      clearCachedContentForSource(sourceId);
      clearCachedContent(`playlist-info:${sourceId}`);
      void clearEpgForSource(sourceId);
      void clearLiveForSource(sourceId);
      setRefreshTick((prev) => ({ ...prev, [sourceId]: (prev[sourceId] ?? 0) + 1 }));
      flashStatus(sourceId, "Cache cleared — content reloads next time you open it");
    },
    [flashStatus],
  );

  const canDelete = sources.length > 1;
  // Where focus returns after the delete dialog closes.
  const pendingFocusRef = useRef<string | null>(null);
  const latest = useRef({ onSetActiveSource, onAdd, handleRefresh, handleClearCache });
  latest.current = { onSetActiveSource, onAdd, handleRefresh, handleClearCache };
  const sourceIdsKey = sources.map((s) => s.id).join("|");

  useEffect(() => {
    if (confirmingDeleteId) {
      setGraph(SCOPE, []);
      return;
    }
    const ids = sources.map((s) => s.id);
    const columns = (sourceId: string) => [cardId(sourceId), refreshId(sourceId), clearCacheId(sourceId), ...(canDelete ? [deleteId(sourceId)] : [])];
    const nodes: FocusNode[] = [{ id: ADD_ID, neighbors: { down: ids[0] ? cardId(ids[0]) : undefined }, onSelect: () => latest.current.onAdd() }];

    ids.forEach((sourceId, row) => {
      const cols = columns(sourceId);
      const above = row > 0 ? columns(ids[row - 1]) : null;
      const below = row < ids.length - 1 ? columns(ids[row + 1]) : null;
      const actions = [
        () => latest.current.onSetActiveSource(sourceId),
        () => latest.current.handleRefresh(sourceId),
        () => latest.current.handleClearCache(sourceId),
        () => {
          pendingFocusRef.current = deleteId(sourceId);
          setConfirmingDeleteId(sourceId);
        },
      ];
      cols.forEach((id, col) => {
        nodes.push({
          id,
          neighbors: {
            left: cols[col - 1],
            right: cols[col + 1],
            up: above ? above[Math.min(col, above.length - 1)] : ADD_ID,
            down: below ? below[Math.min(col, below.length - 1)] : undefined,
          },
          onSelect: actions[col],
        });
      });
    });

    const activeCard = activeSourceId && ids.includes(activeSourceId) ? cardId(activeSourceId) : ids[0] ? cardId(ids[0]) : ADD_ID;
    const pending = pendingFocusRef.current;
    pendingFocusRef.current = null;
    const nodeIds = new Set(nodes.map((n) => n.id));
    setGraph(SCOPE, nodes, pending && nodeIds.has(pending) ? pending : activeCard);
    if (pending) focus(nodeIds.has(pending) ? pending : activeCard);
    // latest.current carries the callbacks; rebuild only when the rows change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceIdsKey, canDelete, confirmingDeleteId, setGraph]);

  useEffect(() => () => clearGraph(SCOPE), [clearGraph]);

  useEffect(() => {
    if (!confirmingDeleteId) return;
    const nodes: FocusNode[] = [
      { id: CONFIRM_KEEP_ID, neighbors: { right: CONFIRM_DELETE_ID }, onSelect: () => setConfirmingDeleteId(null) },
      {
        id: CONFIRM_DELETE_ID,
        neighbors: { left: CONFIRM_KEEP_ID },
        onSelect: () => {
          pendingFocusRef.current = null;
          onRemoveSource(confirmingDeleteId);
          setConfirmingDeleteId(null);
        },
      },
    ];
    setGraph(CONFIRM_SCOPE, nodes, CONFIRM_KEEP_ID);
    focus(CONFIRM_KEEP_ID);
    return () => clearGraph(CONFIRM_SCOPE);
  }, [confirmingDeleteId, setGraph, clearGraph, focus, onRemoveSource]);

  useRemoteInput(platform, {
    onBack: () => {
      if (confirmingDeleteId) setConfirmingDeleteId(null);
      else onBack();
    },
  });

  if (confirmingSource) {
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
            <h1 style={{ fontSize: "2.5rem", fontWeight: 800, color: "#fff", margin: "1.25rem 0 1rem" }}>Delete “{confirmingSource.name}”?</h1>
            <p style={{ fontSize: TV_TEXT, color: "var(--text-dim)", margin: "0 0 2.5rem", lineHeight: 1.5 }}>
              This removes the playlist and everything cached for it. You can add it again later.
            </p>
            <div style={{ display: "flex", gap: "1.25rem", justifyContent: "center" }}>
              <TvButton id={CONFIRM_KEEP_ID} label="Keep Playlist" onSelect={() => setConfirmingDeleteId(null)} />
              <TvButton
                id={CONFIRM_DELETE_ID}
                label="Delete"
                icon={Trash2}
                variant="danger"
                onSelect={() => {
                  pendingFocusRef.current = null;
                  onRemoveSource(confirmingSource.id);
                  setConfirmingDeleteId(null);
                }}
              />
            </div>
          </div>
        </div>
      </MeshBackground>
    );
  }

  return (
    <MeshBackground>
      <div style={{ minHeight: "100vh", padding: `3rem ${BROWSE_SIDE_PADDING} 4rem`, boxSizing: "border-box" }}>
        <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "2rem", marginBottom: "2.5rem" }}>
          <div>
            <h1 style={{ fontSize: "3rem", fontWeight: 800, color: "#fff", margin: 0 }}>Manage Playlists</h1>
            <p style={{ fontSize: TV_TEXT, color: "var(--text-dim)", margin: "0.5rem 0 0" }}>
              OK on a playlist to make it active · Right for refresh and delete
            </p>
          </div>
          <TvButton id={ADD_ID} label="Add Playlist" icon={Plus} onSelect={onAdd} />
        </header>

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {sources.map((source) => (
            <PlaylistRow
              key={source.id}
              source={source}
              isActive={source.id === activeSourceId}
              canDelete={canDelete}
              refreshTick={refreshTick[source.id] ?? 0}
              status={statusBySource[source.id] ?? ""}
              onActivate={() => onSetActiveSource(source.id)}
              onRefresh={() => handleRefresh(source.id)}
              onClearCache={() => handleClearCache(source.id)}
              onRequestDelete={() => {
                pendingFocusRef.current = deleteId(source.id);
                setConfirmingDeleteId(source.id);
              }}
            />
          ))}
        </div>
      </div>
    </MeshBackground>
  );
}

function PlaylistRow({
  source,
  isActive,
  canDelete,
  refreshTick,
  status,
  onActivate,
  onRefresh,
  onClearCache,
  onRequestDelete,
}: {
  source: PlaylistSource;
  isActive: boolean;
  canDelete: boolean;
  refreshTick: number;
  status: string;
  onActivate: () => void;
  onRefresh: () => void;
  onClearCache: () => void;
  onRequestDelete: () => void;
}): JSX.Element {
  const isFocused = useIsFocused(cardId(source.id));

  // Only Xtream accounts expose expiry via the provider API. refreshTick is
  // part of the key so Refresh re-runs the lookup.
  const loadInfo = useCallback(() => loadPlaylistInfo(source), [source]);
  const { data: playlistInfo, isInitialLoading } = useCachedContent(
    `playlist-info:${source.id}:${refreshTick}`,
    "playlist-info",
    loadInfo,
    EMPTY_PLAYLIST_INFO,
  );

  const details = [
    kindLabel(source.kind),
    serverDetail(source),
    source.kind === "xtream" ? `User ${source.username}` : null,
    source.kind === "xtream" ? `Expires ${isInitialLoading ? "…" : formatExpiry(playlistInfo.expiresAt)}` : null,
  ].filter(Boolean);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "1.25rem",
        padding: "0.75rem",
        borderRadius: "1.5rem",
        background: isActive ? "rgba(74,222,128,0.06)" : "rgba(255,255,255,0.04)",
        boxShadow: isActive ? "inset 0 0 0 1px rgba(74,222,128,0.25)" : "inset 0 0 0 1px rgba(255,255,255,0.06)",
      }}
    >
      <Focusable id={cardId(source.id)} style={{ flex: 1, minWidth: 0, width: "auto", height: "auto" }}>
        <button
          type="button"
          onClick={onActivate}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.375rem",
            width: "100%",
            padding: "1.125rem 1.5rem",
            border: "none",
            borderRadius: "1.125rem",
            textAlign: "left",
            background: isFocused ? "rgba(255,255,255,0.95)" : "transparent",
            color: isFocused ? "#0b0c10" : "#ffffff",
            boxShadow: isFocused ? "0 1rem 2rem -0.75rem rgba(0,0,0,0.6)" : undefined,
            cursor: "pointer",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "1rem", minWidth: 0 }}>
            <span style={{ fontSize: "1.75rem", fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{source.name}</span>
            {isActive && <ActivePill />}
          </span>
          <span
            style={{
              fontSize: "1.125rem",
              color: isFocused ? "rgba(11,12,16,0.65)" : "rgba(235,236,242,0.6)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {details.join("  ·  ")}
          </span>
          {status && <span style={{ fontSize: "1.125rem", fontWeight: 700, color: isFocused ? "#15803d" : "#4ade80" }}>✓ {status}</span>}
        </button>
      </Focusable>
      <TvButton id={refreshId(source.id)} label="Refresh" icon={RefreshCw} onSelect={onRefresh} />
      <TvButton id={clearCacheId(source.id)} label="Clear Cache" icon={DatabaseZap} onSelect={onClearCache} />
      <TvButton id={deleteId(source.id)} label="Delete" icon={Trash2} variant="danger" disabled={!canDelete} onSelect={onRequestDelete} />
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
