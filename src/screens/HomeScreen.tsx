import { useCallback, useEffect, useRef, useState } from "react";
import { ListVideo, RefreshCw, type LucideIcon } from "lucide-react";
import type { PlatformId, PlaylistSource, Profile } from "@core";
import {
  Clock,
  Focusable,
  LiftSurface,
  MeshBackground,
  ProfileSwitcher,
  PROFILE_SWITCHER_FOCUS_ID,
  SECTION_ICONS,
  useFocusStore,
  useRemoteInput,
  useIsFocused,
  Toast,
} from "@ui";
import type { FocusNode } from "@ui";
import { loadPlaylistInfo } from "../content-loader.js";
import { syncSource } from "../sync/sync-manager.js";
import { PLAYLIST_CHIP_ID, PlaylistChip, PlaylistPicker } from "./PlaylistPicker.js";
import { getSourceSyncState, useSourceSyncState } from "../sync/sync-store.js";
import { describeRunningSync, describeSyncFailure, formatCounts, formatSyncedAgo, readSyncSummary, useSyncSummary } from "../sync/sync-summary.js";
import { useCachedContent } from "../use-cached-content.js";

export interface HomeTile {
  id: string;
  label: string;
  icon: LucideIcon;
}

const REFRESH_TILE_ID = "refresh";

/**
 * The menu's tiles. Destination ids match App.tsx's TabId values, so
 * selecting one is just onSelectTile(id); the one exception is Refresh
 * (REFRESH_TILE_ID), an action rather than a destination. The four content
 * destinations are the tall primary row; utilities sit in a shorter
 * secondary row beneath them.
 */
const PRIMARY_TILES: HomeTile[] = [
  { id: "live", label: "Live TV", icon: SECTION_ICONS.live },
  { id: "movies", label: "Movies", icon: SECTION_ICONS.movies },
  { id: "series", label: "Series", icon: SECTION_ICONS.series },
  { id: "guide", label: "Guide", icon: SECTION_ICONS.guide },
];
const SECONDARY_TILES: HomeTile[] = [
  { id: "favourites", label: "My List", icon: SECTION_ICONS.favourites },
  { id: "history", label: "Recently Watched", icon: SECTION_ICONS.history },
  { id: REFRESH_TILE_ID, label: "Refresh Playlist", icon: RefreshCw },
  { id: "settings", label: "App Settings", icon: SECTION_ICONS.settings },
];

/**
 * Back on Home closes the app — Home is the root, so there's nowhere left
 * to go back to (appinfo.json's disableBackHistoryAPI hands the Back key to
 * the app, and window.close() is how a webOS web app exits itself). Back
 * presses within this long of Home appearing are ignored: Home is usually
 * reached by pressing Back on another screen, and a slightly-long press
 * shouldn't carry through and close the app too.
 */
const BACK_TO_EXIT_GRACE_MS = 500;


/** Shared by both tile rows so their columns line up on the same outer width. */
const MENU_MAX_WIDTH = "84rem";
const MENU_GAP = "2rem";
const SCOPE = "home-grid";
/**
 * Base colour under Home's mesh lighting. Lighter than the app-wide near
 * black (on a TV that reads as an empty void), and paired with the tile
 * faces in tileFaceStyle: unfocused tiles sit a clear step above it, focused
 * tiles a clear step above those.
 */
const HOME_BASE_COLOR = "#13151b";

const EMPTY_PLAYLIST_INFO = { name: "", expiresAt: null as Date | null };

/**
 * The tile last opened from Home, so coming back (Home remounts on every tab
 * switch — see App.tsx) lands focus on the tile the user just left rather
 * than always resetting to the first one. Module-level on purpose: it only
 * needs to outlive HomeScreen's own mount, not an app restart.
 */
let lastSelectedTileId: string = PRIMARY_TILES[0].id;

/** Test-only: forgets the remembered tile so each test starts from a fresh Home. */
export function __resetHomeFocusMemoryForTests(): void {
  lastSelectedTileId = PRIMARY_TILES[0].id;
}

/**
 * Header (profile chip, and the playlist chip when there's more than one
 * playlist) and both tile rows as one focus graph. Left/Right move within
 * a row, Up/Down move between rows within the same column; Up from the
 * primary row reaches the header chip on that side (the playlist chip sits
 * over the right half) and Down from either chip reaches the tiles.
 */
function buildHomeFocusGraph(
  onOpenProfiles: () => void,
  onRefresh: () => void,
  onSelectTile: (id: string) => void,
  onOpenPlaylists: (() => void) | null,
): FocusNode[] {
  // Both rows are the same width with the same column count, so Up/Down
  // simply link the tiles in the same column.
  const primaryIds = PRIMARY_TILES.map((tile) => tile.id);
  const secondaryIds = SECONDARY_TILES.map((tile) => tile.id);

  const hasPlaylistChip = onOpenPlaylists !== null;
  const profileNode: FocusNode = {
    id: PROFILE_SWITCHER_FOCUS_ID,
    neighbors: { down: primaryIds[0], right: hasPlaylistChip ? PLAYLIST_CHIP_ID : undefined },
    onSelect: onOpenProfiles,
  };
  const headerNodes: FocusNode[] = hasPlaylistChip
    ? [profileNode, { id: PLAYLIST_CHIP_ID, neighbors: { left: PROFILE_SWITCHER_FOCUS_ID, down: primaryIds[primaryIds.length - 1] }, onSelect: onOpenPlaylists }]
    : [profileNode];
  // Up from a tile reaches the header chip above its half of the screen.
  const headerAbove = (index: number) => (hasPlaylistChip && index >= primaryIds.length / 2 ? PLAYLIST_CHIP_ID : PROFILE_SWITCHER_FOCUS_ID);

  const primaryNodes: FocusNode[] = primaryIds.map((id, index) => ({
    id,
    neighbors: { left: primaryIds[index - 1], right: primaryIds[index + 1], up: headerAbove(index), down: secondaryIds[index] },
    onSelect: () => onSelectTile(id),
  }));

  const secondaryNodes: FocusNode[] = secondaryIds.map((id, index) => ({
    id,
    neighbors: { left: secondaryIds[index - 1], right: secondaryIds[index + 1], up: primaryIds[index] },
    onSelect: () => (id === REFRESH_TILE_ID ? onRefresh() : onSelectTile(id)),
  }));

  return [...headerNodes, ...primaryNodes, ...secondaryNodes];
}

export interface HomeScreenProps {
  source: PlaylistSource;
  /** Every configured playlist — the header offers switching between them when there's more than one. */
  sources?: PlaylistSource[];
  onSelectSource?: (sourceId: string) => void;
  platform: PlatformId;
  profile: Profile;
  onSelectTile: (tileId: string) => void;
  onOpenProfiles: () => void;
}

/**
 * Home hub shown after profile selection: a static menu grid of every app
 * destination under a header (profile switcher, clock). Back exits the app.
 *
 * Deliberately does no content work — no hero, no recommendation shelves,
 * and no background fetch/sync/prefetch jobs (those
 * previously ran from here). On TV hardware the old Home spent its first
 * seconds competing with its own data loading; this version renders a
 * fixed set of tiles and nothing else, so it's instant and D-pad input is
 * never starved. The one network call it can make is the user-initiated
 * Refresh action.
 *
 * The footer's playlist name/expiry comes from the cache the sync
 * manager's sign-in stage keeps, and its sync line ("Updated 2h ago",
 * "Syncing Movies…", a failure) from sync-store.ts and the tables' own sync
 * records — local reads only; Home never triggers a fetch of its own.
 */
export function HomeScreen({ source, sources = [], onSelectSource, platform, profile, onSelectTile, onOpenProfiles }: HomeScreenProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);

  // Set while a manual refresh is in flight so the Refresh icon can show a
  // spinning affordance instead of looking like a no-op click.
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);

  // A forced sync of every stage (see sync/sync-manager.ts) — real work
  // regardless of freshness, never a page reload. Joins a sync that's
  // already running rather than downloading everything twice. The result is
  // reported in a toast: what's now stored, or what failed and why.
  const isRefreshingRef = useRef(false);
  const handleRefresh = useCallback(() => {
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;
    setIsRefreshing(true);
    setToast(null);
    void syncSource(source, { trigger: "manual", force: true })
      .then(async (outcome) => {
        const failure = describeSyncFailure(getSourceSyncState(source.id), source);
        const anySynced = Object.values(outcome.stages).some((status) => status === "synced");
        if (failure && !anySynced) {
          setToast({ tone: "error", message: `Refresh failed: ${failure.message} Press Refresh Playlist to try again.` });
          return;
        }
        if (failure) {
          setToast({ tone: "error", message: `Updated, except ${failure.message}` });
          return;
        }
        const counts = formatCounts(await readSyncSummary(source));
        setToast({ tone: "success", message: counts ? `Playlist updated · ${counts}` : "Playlist updated" });
      })
      .finally(() => {
        isRefreshingRef.current = false;
        setIsRefreshing(false);
      });
  }, [source]);

  // Footer status: what's syncing right now, why the last sync failed, or how fresh the data is.
  const syncState = useSourceSyncState(source.id);
  const syncSummary = useSyncSummary(source);
  const runningLabel = describeRunningSync(syncState);
  const failure = describeSyncFailure(syncState, source);
  const syncStatus = runningLabel
    ? runningLabel
    : failure
      ? "Last refresh failed · press Refresh Playlist to retry"
      : syncSummary.lastSyncedAt !== null
        ? `Updated ${formatSyncedAgo(syncSummary.lastSyncedAt)}`
        : null;

  const mountedAtRef = useRef(Date.now());
  const handleBack = useCallback(() => {
    if (Date.now() - mountedAtRef.current < BACK_TO_EXIT_GRACE_MS) return;
    window.close();
  }, []);

  const loadInfo = useCallback(() => loadPlaylistInfo(source), [source]);
  const { data: playlistInfo } = useCachedContent(`playlist-info:${source.id}`, "playlist-info", loadInfo, EMPTY_PLAYLIST_INFO, {
    enabled: false,
  });

  const handleSelectTile = useCallback(
    (id: string) => {
      lastSelectedTileId = id;
      onSelectTile(id);
    },
    [onSelectTile],
  );

  // Playlist switching: a header chip, shown only when there's something to switch to.
  const canSwitchPlaylist = sources.length > 1 && onSelectSource !== undefined;
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const openPicker = useCallback(() => setIsPickerOpen(true), []);
  // Back on the chip once the picker closes — applied after the graph is rebuilt (focus() ignores ids not in it).
  const refocusChipRef = useRef(false);
  const closePicker = useCallback(() => {
    refocusChipRef.current = true;
    setIsPickerOpen(false);
  }, []);
  const selectPlaylist = useCallback(
    (sourceId: string) => {
      setIsPickerOpen(false);
      onSelectSource?.(sourceId);
    },
    [onSelectSource],
  );

  useEffect(() => {
    // The picker takes the D-pad while open: nothing behind it is reachable.
    if (isPickerOpen) {
      setGraph(SCOPE, []);
      return;
    }
    setGraph(SCOPE, buildHomeFocusGraph(onOpenProfiles, handleRefresh, handleSelectTile, canSwitchPlaylist ? openPicker : null), lastSelectedTileId);
    if (refocusChipRef.current) {
      refocusChipRef.current = false;
      useFocusStore.getState().focus(PLAYLIST_CHIP_ID);
    }
  }, [setGraph, onOpenProfiles, handleRefresh, handleSelectTile, canSwitchPlaylist, openPicker, isPickerOpen]);
  useEffect(() => () => clearGraph(SCOPE), [clearGraph]);

  // Tiles and the profile switcher carry their own node onSelect (see
  // buildHomeFocusGraph), which the focus store's select() invokes — so the
  // only screen-level handler is Back, which exits the app.
  useRemoteInput(platform, { onBack: () => (isPickerOpen ? closePicker() : handleBack()) });

  return (
    // Animated even on TVs: the mesh drifts on the compositor only (see
    // MeshBackground), and Home has nothing else competing for the GPU.
    <MeshBackground animate baseColor={HOME_BASE_COLOR}>
    <div
      style={{
        height: "100vh",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        // TV-safe-area inset: most TVs overscan (crop) a few percent at each
        // edge, so 2.5% keeps the header and footer inside the visible area.
        padding: "2.5vh 2.5vw",
        boxSizing: "border-box",
      }}
    >
      <header
        style={{
          position: "relative",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        {/* Sized to the chip, not Focusable's default 100% — otherwise the wrapper spans the whole header. */}
        <Focusable id={PROFILE_SWITCHER_FOCUS_ID} style={{ width: "auto", height: "auto" }}>
          <ProfileSwitcher profile={profile} onOpen={onOpenProfiles} />
        </Focusable>
        <div style={{ position: "absolute", left: "50%", top: 0, transform: "translateX(-50%)" }}>
          <Clock />
        </div>
        {canSwitchPlaylist && (
          <Focusable id={PLAYLIST_CHIP_ID} style={{ width: "auto", height: "auto" }}>
            <PlaylistChip source={source} onOpen={openPicker} />
          </Focusable>
        )}
      </header>

      <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: MENU_GAP }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${PRIMARY_TILES.length}, 1fr)`, gap: MENU_GAP, width: "100%", maxWidth: MENU_MAX_WIDTH }}>
          {PRIMARY_TILES.map((tile) => (
            <PrimaryTile key={tile.id} tile={tile} onSelect={() => handleSelectTile(tile.id)} />
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${SECONDARY_TILES.length}, 1fr)`, gap: MENU_GAP, width: "100%", maxWidth: MENU_MAX_WIDTH }}>
          {SECONDARY_TILES.map((tile) => (
            <SecondaryTile
              key={tile.id}
              tile={tile}
              isSpinning={tile.id === REFRESH_TILE_ID && isRefreshing}
              onSelect={() => (tile.id === REFRESH_TILE_ID ? handleRefresh() : handleSelectTile(tile.id))}
            />
          ))}
        </div>
      </main>

      <footer style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "2rem", flexShrink: 0 }}>
        <PlaylistStatusBar
          // Only when there's no playlist chip in the header to show it.
          name={canSwitchPlaylist ? undefined : playlistInfo.name || source.name || undefined}
          expiresAt={playlistInfo.name ? playlistInfo.expiresAt : undefined}
          syncStatus={syncStatus}
          syncTone={runningLabel ? "running" : failure ? "failed" : "ok"}
        />
        <div style={{ fontSize: "1.125rem", fontWeight: 500, color: "rgba(235,236,242,0.4)" }}>Version: {__APP_VERSION__}</div>
      </footer>
    </div>
    {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={dismissToast} />}
    {isPickerOpen && <PlaylistPicker sources={sources} activeSourceId={source.id} onSelect={selectPlaylist} onClose={closePicker} />}
    </MeshBackground>
  );
}

const DAY_MS = 86_400_000;
/** Within this many days of expiry the chip turns amber, so there's time to renew. */
const EXPIRY_WARNING_DAYS = 30;

type ExpiryTone = "ok" | "soon" | "expired" | "unknown";

/** The expiry chip's wording and tone — "Expires Sep 15, 2027", "Expires in 12 days", "Expired Sep 1, 2026", "No expiry". */
export function describeExpiry(expiresAt: Date | null | undefined, now = Date.now()): { label: string; tone: ExpiryTone } {
  if (expiresAt === undefined) return { label: "Expiry unknown", tone: "unknown" };
  if (expiresAt === null) return { label: "No expiry", tone: "ok" };
  const date = expiresAt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const daysLeft = Math.ceil((expiresAt.getTime() - now) / DAY_MS);
  if (daysLeft <= 0) return { label: `Expired ${date}`, tone: "expired" };
  if (daysLeft <= EXPIRY_WARNING_DAYS) return { label: daysLeft === 1 ? "Expires tomorrow" : `Expires in ${daysLeft} days`, tone: "soon" };
  return { label: `Expires ${date}`, tone: "ok" };
}

/** Plain text while the expiry is fine; a pulsing dot and coloured text only when it needs attention (amber in the last month, red once expired). */
const EXPIRY_STYLES: Record<ExpiryTone, { dot?: string; text?: string }> = {
  ok: {},
  soon: { dot: "#f5b83d", text: "#f5c46b" },
  expired: { dot: "#ff5c5c", text: "#ff8a8a" },
  unknown: {},
};

/**
 * Home's footer: the current playlist as one quiet, informational line —
 * expiry · sync status, each led by a small status dot. The playlist's
 * name leads the line only when there's a single playlist — otherwise it's
 * already in the header's playlist chip. Colour is kept to the dots unless
 * something needs attention (expiry within a month or past, a failed
 * refresh); a sync in progress shows a small spinning icon instead of a
 * dot. No surface or glow, so it never competes with the tiles above it.
 */
function PlaylistStatusBar({
  name,
  expiresAt,
  syncStatus,
  syncTone,
}: {
  /** Set only when the header has no playlist chip (a single playlist). */
  name?: string;
  expiresAt: Date | null | undefined;
  syncStatus: string | null;
  syncTone: "running" | "failed" | "ok";
}): JSX.Element {
  const expiry = describeExpiry(expiresAt);
  const expiryStyle = EXPIRY_STYLES[expiry.tone];

  return (
    <div
      role="status"
      aria-label="Current playlist"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.875rem",
        minWidth: 0,
        maxWidth: "75vw",
        fontSize: "1.125rem",
        fontWeight: 500,
        color: "rgba(235,236,242,0.55)",
        whiteSpace: "nowrap",
      }}
    >
      <style>{`
        @keyframes home-status-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes home-status-pulse { 0% { transform: scale(1); opacity: 0.55; } 70%, 100% { transform: scale(2.6); opacity: 0; } }
      `}</style>
      {name && (
        <>
          <StatusItem indicator={<ListVideo size="1.125rem" strokeWidth={2} aria-hidden style={{ flexShrink: 0, opacity: 0.8 }} />}>
            <span style={{ color: "rgba(235,236,242,0.8)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
          </StatusItem>
          <Dot />
        </>
      )}
      <StatusItem indicator={expiryStyle.dot ? <StatusDot color={expiryStyle.dot} pulse /> : null} color={expiryStyle.text}>
        {expiry.label}
      </StatusItem>
      {syncStatus && (
        <>
          <Dot />
          <StatusItem
            indicator={
              syncTone === "running" ? (
                <RefreshCw size="1.125rem" strokeWidth={2} aria-hidden style={{ flexShrink: 0, opacity: 0.8, animation: "home-status-spin 1.1s linear infinite" }} />
              ) : (
                <StatusDot color={syncTone === "failed" ? "#ff5c5c" : "#2ecc8a"} pulse={syncTone === "ok"} />
              )
            }
            color={syncTone === "failed" ? "#ff8a8a" : undefined}
          >
            {syncStatus}
          </StatusItem>
        </>
      )}
    </div>
  );
}

function StatusItem({ indicator, color, children }: { indicator: React.ReactNode; color?: string; children: React.ReactNode }): JSX.Element {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: "0.625rem", minWidth: 0, color }}>
      {indicator}
      {children}
    </span>
  );
}

/** A small coloured dot; `pulse` adds a soft expanding ring (transform/opacity only — cheap on TV GPUs). */
function StatusDot({ color, pulse }: { color: string; pulse: boolean }): JSX.Element {
  return (
    <span aria-hidden style={{ position: "relative", width: "0.625rem", height: "0.625rem", flexShrink: 0 }}>
      {pulse && <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: color, animation: "home-status-pulse 2.4s ease-out infinite" }} />}
      <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: color }} />
    </span>
  );
}

function Dot(): JSX.Element {
  return <span aria-hidden style={{ flexShrink: 0, opacity: 0.5 }}>·</span>;
}

/**
 * Face styling shared by both tile kinds, Apple TV-style: unfocused tiles
 * are faint glass — a translucent white tint with a light top edge — so
 * MeshBackground's drifting colour washes show through them and the
 * lighting moves across the cards rather than only in the gaps between
 * opaque slabs. The focused tile turns brighter, more solid glass with a
 * white icon and label while LiftSurface raises it with a shadow and sheen.
 * No outline ring. Plain alpha blending only (no backdrop-filter blur), so
 * this costs the TV GPU essentially nothing.
 */
function tileFaceStyle(isFocused: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: isFocused
      ? "linear-gradient(160deg, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0.17) 100%)"
      : "linear-gradient(160deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.035) 100%)",
    boxShadow: isFocused
      ? "inset 0 1px 0 rgba(255,255,255,0.35), inset 0 0 0 1px rgba(255,255,255,0.14)"
      : "inset 0 1px 0 rgba(255,255,255,0.12), inset 0 0 0 1px rgba(255,255,255,0.06)",
    color: isFocused ? "#ffffff" : "rgba(235,236,242,0.72)",
  };
}

const TILE_RADIUS = "1.5rem";

/** Primary destination: a tall portrait card, large icon over a label. */
function PrimaryTile({ tile, onSelect }: { tile: HomeTile; onSelect: () => void }): JSX.Element {
  const isFocused = useIsFocused(tile.id);
  const Icon = tile.icon;

  return (
    <Focusable id={tile.id}>
      <LiftSurface
        as="button"
        isFocused={isFocused}
        radius={TILE_RADIUS}
        onClick={onSelect}
        shadow="0 2.5rem 4rem -1rem rgba(0,0,0,0.75), 0 1rem 2rem rgba(0,0,0,0.45)"
        faceStyle={{ ...tileFaceStyle(isFocused), aspectRatio: "2 / 3", flexDirection: "column", gap: "1.75rem" }}
      >
        <Icon size="6rem" strokeWidth={1.25} color="currentColor" />
        <span style={{ fontSize: "2.25rem", fontWeight: 700 }}>{tile.label}</span>
      </LiftSurface>
    </Focusable>
  );
}

/** Secondary tile: short and wide, icon beside its label. isSpinning rotates the icon (Refresh while a refresh is in flight). */
function SecondaryTile({ tile, isSpinning, onSelect }: { tile: HomeTile; isSpinning?: boolean; onSelect: () => void }): JSX.Element {
  const isFocused = useIsFocused(tile.id);
  const Icon = tile.icon;

  return (
    <Focusable id={tile.id}>
      <LiftSurface
        as="button"
        isFocused={isFocused}
        radius={TILE_RADIUS}
        onClick={onSelect}
        faceStyle={{ ...tileFaceStyle(isFocused), height: "7rem", gap: "1.25rem" }}
      >
        <Icon size="2.75rem" strokeWidth={1.5} color="currentColor" style={isSpinning ? { animation: "iptv-spin 900ms linear infinite" } : undefined} />
        <span style={{ fontSize: "1.5rem", fontWeight: 700, whiteSpace: "nowrap" }}>{tile.label}</span>
      </LiftSurface>
      {isSpinning && <style>{`@keyframes iptv-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>}
    </Focusable>
  );
}
