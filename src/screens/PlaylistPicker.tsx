import { useEffect, useRef } from "react";
import type { PlaylistSource } from "@core";
import { Check, ChevronDown, ListVideo } from "lucide-react";
import { Focusable, TV_TEXT, useFocusStore, useIsFocused, type FocusNode } from "@ui";
import { loadPlaylistInfo } from "../content-loader.js";
import { useSourceSyncState } from "../sync/sync-store.js";
import { describeRunningSync, formatCounts, formatSyncedAgo, useSyncSummary } from "../sync/sync-summary.js";
import { useCachedContent } from "../use-cached-content.js";

export const PLAYLIST_CHIP_ID = "home-playlist-chip";
const SCOPE = "home-playlist-picker";
const optionId = (sourceId: string) => `home-playlist-option:${sourceId}`;

const EMPTY_PLAYLIST_INFO = { name: "", expiresAt: null as Date | null };

function kindLabel(kind: PlaylistSource["kind"]): string {
  if (kind === "xtream") return "Xtream Codes";
  if (kind === "m3u-url") return "M3U URL";
  return "M3U File";
}

/**
 * Home header chip (top right, opposite the profile chip) naming the
 * active playlist — shown only when there's more than one to switch
 * between. Same glass look and lift as the profile chip.
 */
export function PlaylistChip({ source, onOpen }: { source: PlaylistSource; onOpen: () => void }): JSX.Element {
  const isFocused = useIsFocused(PLAYLIST_CHIP_ID);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={`Playlist: ${source.name}. Switch playlist`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        maxWidth: "28rem",
        border: "none",
        borderRadius: 999,
        background: isFocused
          ? "linear-gradient(160deg, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0.17) 100%)"
          : "linear-gradient(160deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.035) 100%)",
        boxShadow: isFocused
          ? "inset 0 1px 0 rgba(255,255,255,0.35), inset 0 0 0 1px rgba(255,255,255,0.14), 0 1rem 2rem -0.5rem rgba(0,0,0,0.6)"
          : "inset 0 1px 0 rgba(255,255,255,0.12), inset 0 0 0 1px rgba(255,255,255,0.06)",
        color: isFocused ? "#ffffff" : "rgba(235,236,242,0.85)",
        padding: "1.125rem 1.5rem",
        transform: isFocused ? "scale(1.08)" : "scale(1)",
        transition: "transform 300ms cubic-bezier(0.2, 0.9, 0.3, 1)",
        cursor: "pointer",
      }}
    >
      <ListVideo size="1.75rem" style={{ flexShrink: 0 }} />
      <span style={{ fontSize: "1.375rem", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{source.name}</span>
      <ChevronDown size="1.5rem" style={{ flexShrink: 0, opacity: 0.7 }} />
    </button>
  );
}

export interface PlaylistPickerProps {
  sources: PlaylistSource[];
  activeSourceId: string;
  onSelect: (sourceId: string) => void;
  /** Closes without switching — Home routes Back here while the picker is open. */
  onClose: () => void;
}

/**
 * The list the playlist chip opens: one row per playlist with its type, a
 * ✓ on the active one, and how its data stands ("Updated 2h ago · 12,430
 * channels", syncing, not downloaded yet, account expired). OK switches
 * (a playlist that has never downloaded goes through the first-sync
 * screen); OK on the active one just closes. Focus starts on the active
 * row and stays in the picker — Home withdraws its own nodes meanwhile.
 */
export function PlaylistPicker({ sources, activeSourceId, onSelect, onClose }: PlaylistPickerProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focus = useFocusStore((state) => state.focus);
  const latest = useRef({ onSelect, onClose });
  latest.current = { onSelect, onClose };
  const idsKey = sources.map((s) => s.id).join("|");

  useEffect(() => {
    const ids = sources.map((s) => optionId(s.id));
    const nodes: FocusNode[] = sources.map((source, index) => ({
      id: ids[index],
      neighbors: { up: ids[index - 1], down: ids[index + 1] },
      onSelect: () => (source.id === activeSourceId ? latest.current.onClose() : latest.current.onSelect(source.id)),
    }));
    setGraph(SCOPE, nodes, optionId(activeSourceId));
    focus(optionId(activeSourceId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, activeSourceId, setGraph, focus]);
  useEffect(() => () => clearGraph(SCOPE), [clearGraph]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Switch playlist"
      style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "flex-end", background: "rgba(5,6,8,0.6)", padding: "9vh 2.5vw" }}
    >
      <div
        style={{
          width: "min(46rem, 100%)",
          maxHeight: "80vh",
          overflowY: "auto",
          padding: "1.5rem",
          borderRadius: "1.75rem",
          background: "rgba(16,17,23,0.96)",
          boxShadow: "0 2rem 4rem rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,255,255,0.08)",
        }}
      >
        <h2 style={{ fontSize: "1.75rem", fontWeight: 800, color: "#fff", margin: "0.25rem 0.5rem 1.25rem" }}>Switch playlist</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
          {sources.map((source) => (
            <PlaylistOption
              key={source.id}
              source={source}
              isActive={source.id === activeSourceId}
              onSelect={() => (source.id === activeSourceId ? onClose() : onSelect(source.id))}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PlaylistOption({ source, isActive, onSelect }: { source: PlaylistSource; isActive: boolean; onSelect: () => void }): JSX.Element {
  const id = optionId(source.id);
  const isFocused = useIsFocused(id);
  const syncState = useSourceSyncState(source.id);
  const summary = useSyncSummary(source);
  // Account info the sync manager's sign-in stage keeps cached — read only, never fetched from here.
  const loadInfo = () => loadPlaylistInfo(source);
  const { data: info } = useCachedContent(`playlist-info:${source.id}`, "playlist-info", loadInfo, EMPTY_PLAYLIST_INFO, { enabled: false });

  const running = describeRunningSync(syncState);
  const expired = info.expiresAt !== null && info.expiresAt.getTime() < Date.now();
  const counts = formatCounts(summary);
  const status = expired
    ? "Account expired"
    : (running ?? (summary.lastSyncedAt !== null ? [`Updated ${formatSyncedAgo(summary.lastSyncedAt)}`, counts].filter(Boolean).join(" · ") : "Not downloaded yet"));

  return (
    <Focusable id={id} style={{ height: "auto" }}>
      <button
        type="button"
        onClick={onSelect}
        aria-current={isActive || undefined}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          width: "100%",
          padding: "1rem 1.25rem",
          border: "none",
          borderRadius: "1.125rem",
          textAlign: "left",
          color: "#fff",
          background: isFocused ? "rgba(255,255,255,0.1)" : "transparent",
          boxShadow: isFocused ? "inset 0 0 0 2px var(--accent, #38bdf8)" : undefined,
          cursor: "pointer",
        }}
      >
        <span style={{ width: "1.75rem", flexShrink: 0, display: "flex", justifyContent: "center" }}>
          {isActive && <Check size="1.625rem" strokeWidth={3} color="#4ade80" />}
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: "0.25rem", minWidth: 0 }}>
          <span style={{ fontSize: TV_TEXT, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{source.name}</span>
          <span style={{ fontSize: "1.125rem", color: expired ? "#fbbf24" : "rgba(235,236,242,0.65)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {kindLabel(source.kind)} · {status}
          </span>
        </span>
      </button>
    </Focusable>
  );
}
