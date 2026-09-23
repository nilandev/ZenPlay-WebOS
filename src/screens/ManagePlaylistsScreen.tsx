import { useCallback, useEffect, useState } from "react";
import type { PlatformId, PlaylistSource } from "@core";
import { Focusable, MeshBackground, PillButton, useFocusStore, useRemoteInput, type FocusNode } from "@ui";
import { Check, DatabaseZap, Plus, Radio, RefreshCw, Trash2 } from "lucide-react";
import { clearCachedContent, clearCachedContentForSource } from "../content-cache.js";
import { loadPlaylistInfo } from "../content-loader.js";
import { useCachedContent } from "../use-cached-content.js";
import { AddSourceScreen } from "./AddSourceScreen.js";

const GRID_COLUMNS = 2;
const ADD_ID = "manage-playlists-add";
const BACK_ID = "manage-playlists-back";
const CONFIRM_KEEP_ID = "manage-playlists-confirm-keep";
const CONFIRM_DELETE_ID = "manage-playlists-confirm-delete";
const cardId = (sourceId: string) => `manage-playlists-card:${sourceId}`;
const refreshId = (sourceId: string) => `manage-playlists-refresh:${sourceId}`;
const clearCacheId = (sourceId: string) => `manage-playlists-clear-cache:${sourceId}`;
const deleteId = (sourceId: string) => `manage-playlists-delete:${sourceId}`;

const EMPTY_PLAYLIST_INFO = { name: "", expiresAt: null as Date | null };

function useIsFocused(id: string): boolean {
  return useFocusStore((state) => state.focusedId === id);
}

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
 * Playlist source grid, reached from Settings → Manage Playlists. Delegates
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

  // Delete always asks for confirmation (see conversation history) — same
  // confirm-dialog pattern as ProfileForm's "Delete profile": a separate
  // focus scope forced into focus via focus(), since the grid scope
  // underneath still holds a valid focused id and wouldn't otherwise cede
  // focus to a newly-registered scope.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const confirmingSource = sources.find((s) => s.id === confirmingDeleteId) ?? null;

  // Per-source refresh-tick: bumping a source's counter changes the cache
  // key useCachedContent keys off of, forcing that card's effect to re-run
  // and re-fetch instead of serving the value already cached under the
  // pre-bump key (clearing the cache alone doesn't re-trigger a mounted
  // useCachedContent call).
  const [refreshTick, setRefreshTick] = useState<Record<string, number>>({});

  const handleRefresh = useCallback((sourceId: string) => {
    clearCachedContent(`playlist-info:${sourceId}`);
    setRefreshTick((prev) => ({ ...prev, [sourceId]: (prev[sourceId] ?? 0) + 1 }));
  }, []);

  const handleClearCache = useCallback(
    (sourceId: string) => {
      clearCachedContentForSource(sourceId);
      handleRefresh(sourceId);
    },
    [handleRefresh],
  );

  const rowIds = sources.map((s) => s.id);
  const columns = Math.max(1, Math.min(GRID_COLUMNS, rowIds.length + 1));

  useEffect(() => {
    if (confirmingDeleteId) return;

    const nodes: FocusNode[] = [];
    const allIds = [...rowIds, ADD_ID];
    // Each source tile occupies one grid cell but is really two focus rows
    // internally (the card body, then its Refresh/Delete Cache/Delete
    // strip) — up/down between grid cells has to land on the matching
    // internal row (card→card, actions→actions) for vertical movement to
    // stay visually aligned, not just "the tile above/below."
    const aboveTileId = (index: number): string | undefined => (index - columns >= 0 ? allIds[index - columns] : undefined);
    const belowTileId = (index: number): string | undefined => (index + columns < allIds.length ? allIds[index + columns] : undefined);
    const cardOrAdd = (id: string | undefined) => (id === undefined ? undefined : id === ADD_ID ? ADD_ID : cardId(id));
    const actionsOrAdd = (id: string | undefined) => (id === undefined ? undefined : id === ADD_ID ? ADD_ID : refreshId(id));

    allIds.forEach((id, index) => {
      const isAddTile = id === ADD_ID;
      const col = index % columns;
      const above = aboveTileId(index);
      const below = belowTileId(index);
      const left = col > 0 ? allIds[index - 1] : undefined;
      const right = col < columns - 1 && index + 1 < allIds.length ? allIds[index + 1] : undefined;

      if (isAddTile) {
        nodes.push({ id: ADD_ID, neighbors: { up: cardOrAdd(above), left }, onSelect: onAdd });
        return;
      }

      const sourceId = id;
      nodes.push({
        id: cardId(sourceId),
        neighbors: { up: cardOrAdd(above), down: refreshId(sourceId), left: cardOrAdd(left), right: cardOrAdd(right) },
        onSelect: () => onSetActiveSource(sourceId),
      });
      nodes.push({
        id: refreshId(sourceId),
        neighbors: { up: cardId(sourceId), down: actionsOrAdd(below), right: clearCacheId(sourceId) },
        onSelect: () => handleRefresh(sourceId),
      });
      nodes.push({
        id: clearCacheId(sourceId),
        neighbors: { up: cardId(sourceId), down: actionsOrAdd(below), left: refreshId(sourceId), right: deleteId(sourceId) },
        onSelect: () => handleClearCache(sourceId),
      });
      nodes.push({
        id: deleteId(sourceId),
        neighbors: { up: cardId(sourceId), down: actionsOrAdd(below), left: clearCacheId(sourceId) },
        onSelect: () => setConfirmingDeleteId(sourceId),
      });
    });

    const lastRowFirstIndex = Math.floor((allIds.length - 1) / columns) * columns;
    const lastRowFirstId = allIds[lastRowFirstIndex];
    nodes.push({ id: BACK_ID, neighbors: { up: actionsOrAdd(lastRowFirstId) }, onSelect: onBack });

    setGraph("manage-playlists", nodes, rowIds[0] ? cardId(rowIds[0]) : ADD_ID);
    return () => clearGraph("manage-playlists");
    // rowIds is derived fresh each render from sources; only re-run when the actual source set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources.length, columns, confirmingDeleteId, setGraph, clearGraph, onAdd, onBack, onSetActiveSource, handleRefresh, handleClearCache]);

  useEffect(() => {
    if (!confirmingDeleteId) return;
    const nodes: FocusNode[] = [
      { id: CONFIRM_KEEP_ID, neighbors: { right: CONFIRM_DELETE_ID }, onSelect: () => setConfirmingDeleteId(null) },
      {
        id: CONFIRM_DELETE_ID,
        neighbors: { left: CONFIRM_KEEP_ID },
        onSelect: () => {
          onRemoveSource(confirmingDeleteId);
          setConfirmingDeleteId(null);
        },
      },
    ];
    setGraph("manage-playlists-confirm", nodes, CONFIRM_KEEP_ID);
    focus(CONFIRM_KEEP_ID);
    return () => clearGraph("manage-playlists-confirm");
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
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 48 }}>
          <div style={{ textAlign: "center", maxWidth: 560 }}>
            <h1 style={{ fontSize: 32, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Delete "{confirmingSource.name}"?</h1>
            <p style={{ fontSize: 16, color: "var(--text-dim)", marginBottom: 40, lineHeight: 1.5 }}>
              This removes the playlist and its cached content. This can't be undone.
            </p>
            <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
              <Focusable id={CONFIRM_KEEP_ID}>
                <ConfirmButton id={CONFIRM_KEEP_ID} label="Keep playlist" onClick={() => setConfirmingDeleteId(null)} />
              </Focusable>
              <Focusable id={CONFIRM_DELETE_ID}>
                <ConfirmButton
                  id={CONFIRM_DELETE_ID}
                  label="Delete"
                  danger
                  onClick={() => {
                    onRemoveSource(confirmingSource.id);
                    setConfirmingDeleteId(null);
                  }}
                />
              </Focusable>
            </div>
          </div>
        </div>
      </MeshBackground>
    );
  }

  return (
    <MeshBackground>
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", padding: "56px 64px", gap: 8 }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, color: "var(--text)" }}>Manage Playlists</h1>
        <p style={{ marginBottom: 36, color: "var(--text-dim)" }}>Set your active playlist, refresh its details, or remove one you no longer use.</p>

        <div style={{ width: "100%", maxWidth: 760, display: "grid", gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 20 }}>
          {sources.map((source) => (
            <PlaylistCard
              key={source.id}
              source={source}
              isActive={source.id === activeSourceId}
              canDelete={sources.length > 1}
              refreshTick={refreshTick[source.id] ?? 0}
              onActivate={() => onSetActiveSource(source.id)}
              onRefresh={() => handleRefresh(source.id)}
              onClearCache={() => handleClearCache(source.id)}
              onRequestDelete={() => setConfirmingDeleteId(source.id)}
            />
          ))}

          <Focusable id={ADD_ID}>
            <AddPlaylistCard onClick={onAdd} />
          </Focusable>
        </div>

        <div style={{ marginTop: 32 }}>
          <Focusable id={BACK_ID}>
            <BackButton onClick={onBack} />
          </Focusable>
        </div>
      </div>
    </MeshBackground>
  );
}

function PlaylistCard({
  source,
  isActive,
  canDelete,
  refreshTick,
  onActivate,
  onRefresh,
  onClearCache,
  onRequestDelete,
}: {
  source: PlaylistSource;
  isActive: boolean;
  canDelete: boolean;
  refreshTick: number;
  onActivate: () => void;
  onRefresh: () => void;
  onClearCache: () => void;
  onRequestDelete: () => void;
}): JSX.Element {
  const isCardFocused = useIsFocused(cardId(source.id));

  // Only Xtream accounts expose expiry via the provider API (see
  // content-loader.ts). refreshTick is appended to the cache key so the
  // Refresh action (which clears this key) also forces this effect to
  // re-run instead of being a no-op once the key is already registered.
  const loadInfo = useCallback(() => loadPlaylistInfo(source), [source]);
  const { data: playlistInfo, isInitialLoading } = useCachedContent(
    `playlist-info:${source.id}:${refreshTick}`,
    "playlist-info",
    loadInfo,
    EMPTY_PLAYLIST_INFO,
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Focusable id={cardId(source.id)}>
        <button
          type="button"
          onClick={onActivate}
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: "20px 22px",
            borderRadius: 16,
            border: isCardFocused ? "1px solid rgba(255,255,255,0.6)" : "1px solid rgba(255,255,255,0.12)",
            background: isCardFocused
              ? "linear-gradient(160deg, rgba(70,74,84,0.75) 0%, rgba(38,40,48,0.8) 100%)"
              : "linear-gradient(160deg, rgba(55,58,68,0.5) 0%, rgba(28,30,36,0.55) 100%)",
            backdropFilter: "blur(16px) saturate(140%)",
            WebkitBackdropFilter: "blur(16px) saturate(140%)",
            boxShadow: isCardFocused ? "0 0 0 3px var(--accent), 0 12px 28px -8px rgba(0,0,0,0.5)" : "none",
            transform: isCardFocused ? "scale(1.01)" : "scale(1)",
            transition: "transform 160ms ease-out, box-shadow 160ms ease-out, background 160ms ease-out",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
            <Radio size={22} strokeWidth={1.75} color={isActive ? "var(--accent)" : "var(--text-dim)"} style={{ flexShrink: 0, marginTop: 2 }} />

            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span
                  style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                >
                  {source.name}
                </span>
                {isActive && <ActivePill />}
              </div>
              <KindBadge kind={source.kind} />
              <span style={{ fontSize: 13, color: "var(--text-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {serverDetail(source)}
              </span>
              {source.kind === "xtream" && (
                <span style={{ fontSize: 13, color: "var(--text-dim)" }}>
                  Username: <span style={{ color: "var(--text)" }}>{source.username}</span>
                </span>
              )}
              {source.kind === "xtream" && (
                <span style={{ fontSize: 13, color: "var(--text-dim)" }}>
                  Expires: <span style={{ color: "var(--text)", fontWeight: 600 }}>{isInitialLoading ? "Checking…" : formatExpiry(playlistInfo.expiresAt)}</span>
                </span>
              )}
            </div>
          </div>
        </button>
      </Focusable>

      <div style={{ display: "flex", gap: 8 }}>
        <Focusable id={refreshId(source.id)}>
          <RowActionButton id={refreshId(source.id)} icon={RefreshCw} label="Refresh" onClick={onRefresh} />
        </Focusable>
        <Focusable id={clearCacheId(source.id)}>
          <RowActionButton id={clearCacheId(source.id)} icon={DatabaseZap} label="Delete Cache" onClick={onClearCache} />
        </Focusable>
        <Focusable id={deleteId(source.id)}>
          <RowActionButton id={deleteId(source.id)} icon={Trash2} label="Delete" danger disabled={!canDelete} onClick={onRequestDelete} />
        </Focusable>
      </div>
    </div>
  );
}

function RowActionButton({
  id,
  icon: Icon,
  label,
  danger,
  disabled,
  onClick,
}: {
  id: string;
  icon: typeof RefreshCw;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}): JSX.Element {
  const isFocused = useIsFocused(id);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "10px 8px",
        borderRadius: 12,
        border: isFocused
          ? `1px solid ${danger ? "rgba(255,107,107,0.7)" : "rgba(255,255,255,0.6)"}`
          : `1px solid ${danger ? "rgba(255,107,107,0.22)" : "rgba(255,255,255,0.1)"}`,
        background: danger
          ? isFocused
            ? "rgba(255,107,107,0.18)"
            : "rgba(255,107,107,0.08)"
          : isFocused
            ? "linear-gradient(160deg, rgba(70,74,84,0.75) 0%, rgba(38,40,48,0.8) 100%)"
            : "linear-gradient(160deg, rgba(30,31,36,0.5) 0%, rgba(12,13,16,0.55) 100%)",
        boxShadow: isFocused ? `0 0 0 3px ${danger ? "rgba(255,107,107,0.4)" : "var(--accent)"}` : "none",
        transform: isFocused ? "scale(1.04)" : "scale(1)",
        transition: "transform 160ms ease-out, box-shadow 160ms ease-out, background 160ms ease-out",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Icon size={15} strokeWidth={2} color={danger ? "var(--danger)" : "var(--text)"} />
      <span style={{ fontSize: 11, fontWeight: 600, color: danger ? "var(--danger)" : "var(--text)", whiteSpace: "nowrap" }}>{label}</span>
    </button>
  );
}

function KindBadge({ kind }: { kind: PlaylistSource["kind"] }): JSX.Element {
  return (
    <span
      style={{
        alignSelf: "flex-start",
        padding: "2px 9px",
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.14)",
        color: "var(--text-dim)",
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 0.4,
      }}
    >
      {kindLabel(kind)}
    </span>
  );
}

function ActivePill(): JSX.Element {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 999,
        background: "rgba(74,222,128,0.15)",
        border: "1px solid rgba(74,222,128,0.4)",
        color: "#4ade80",
        fontSize: 11,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      <Check size={12} strokeWidth={2.5} />
      Active
    </span>
  );
}

function AddPlaylistCard({ onClick }: { onClick: () => void }): JSX.Element {
  const isFocused = useIsFocused(ADD_ID);

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        height: "100%",
        minHeight: 140,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: "20px 22px",
        borderRadius: 16,
        border: isFocused ? "1px solid rgba(255,255,255,0.6)" : "1px dashed rgba(255,255,255,0.2)",
        background: isFocused ? "linear-gradient(160deg, rgba(70,74,84,0.75) 0%, rgba(38,40,48,0.8) 100%)" : "transparent",
        boxShadow: isFocused ? "0 0 0 3px var(--accent), 0 12px 28px -8px rgba(0,0,0,0.5)" : "none",
        transform: isFocused ? "scale(1.01)" : "scale(1)",
        transition: "transform 160ms ease-out, box-shadow 160ms ease-out, background 160ms ease-out",
        color: isFocused ? "var(--text)" : "var(--text-dim)",
        fontSize: 15,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      <Plus size={18} strokeWidth={2.25} />
      Add playlist
    </button>
  );
}

function BackButton({ onClick }: { onClick: () => void }): JSX.Element {
  const isFocused = useIsFocused(BACK_ID);
  return (
    <PillButton onClick={onClick} isFocused={isFocused}>
      Back
    </PillButton>
  );
}

function ConfirmButton({ id: _id, label, onClick, danger }: { id: string; label: string; onClick: () => void; danger?: boolean }): JSX.Element {
  const isFocused = useIsFocused(_id);

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        minWidth: 160,
        padding: "14px 28px",
        borderRadius: 999,
        border: danger ? "none" : isFocused ? "1px solid rgba(255,255,255,0.6)" : "1px solid rgba(255,255,255,0.16)",
        background: danger
          ? "var(--danger)"
          : isFocused
            ? "linear-gradient(160deg, rgba(70,74,84,0.75) 0%, rgba(38,40,48,0.8) 100%)"
            : "linear-gradient(160deg, rgba(55,58,68,0.5) 0%, rgba(28,30,36,0.55) 100%)",
        backdropFilter: danger ? undefined : "blur(16px) saturate(140%)",
        WebkitBackdropFilter: danger ? undefined : "blur(16px) saturate(140%)",
        color: danger ? "#2a0a0a" : "var(--text)",
        fontSize: 15,
        fontWeight: 700,
        boxShadow: isFocused ? "0 0 0 3px var(--accent)" : "none",
        transform: isFocused ? "scale(1.05)" : "scale(1)",
        transition: "transform 160ms ease-out, box-shadow 160ms ease-out, background 160ms ease-out",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
