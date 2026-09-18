import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Clapperboard,
  Heart,
  History as HistoryIcon,
  ListVideo,
  Power,
  RadioTower,
  RefreshCw,
  Settings as SettingsIcon,
  Tv,
  type LucideIcon,
} from "lucide-react";
import type { Channel, PlatformId, PlaylistSource, Profile, SeriesInfo } from "@core";
import { Clock, Focusable, MeshBackground, ProfileSwitcher, PROFILE_SWITCHER_FOCUS_ID, useFocusStore, useRemoteInput } from "@ui";
import type { FocusNode } from "@ui";
import { clearAllCachedContent } from "../content-cache.js";
import { loadChannelsByKind, loadPlaylistInfo, loadSeriesList } from "../content-loader.js";
import { useCachedContent } from "../use-cached-content.js";

export interface HomeTile {
  id: string;
  label: string;
  icon: LucideIcon;
}

const PRIMARY_TILES: HomeTile[] = [
  { id: "live", label: "Live", icon: RadioTower },
  { id: "movies", label: "Movies", icon: Clapperboard },
  { id: "series", label: "Series", icon: Tv },
];

const SECONDARY_TILES: HomeTile[] = [
  { id: "guide", label: "Guide", icon: ListVideo },
  { id: "favourites", label: "My Favourite", icon: Heart },
  { id: "history", label: "History", icon: HistoryIcon },
];

/** Stacked to the right of the primary/secondary block, spanning both their rows in height — see screenshot in conversation history. */
const SIDE_TILES: HomeTile[] = [
  { id: "settings", label: "Settings", icon: SettingsIcon },
  { id: "refresh", label: "Refresh", icon: RefreshCw },
  { id: "exit", label: "Exit", icon: Power },
];

const EMPTY_PLAYLIST_INFO = { name: "", expiresAt: null as Date | null };

const SCOPE = "home-grid";

/**
 * Home hub shown after profile selection: a Netflix/Apple-TV-style launcher
 * rather than jumping straight into a content tab. Layout is a left block
 * (3 tall primary tiles over 3 short secondary tiles, column-aligned) plus a
 * side column (Settings/Refresh/Exit) stacked to its right spanning both
 * rows — see screenshot in conversation history. The side column sits
 * beside the primary row for left/right movement, but down from it lands on
 * the vertically-nearest side tile by proportional index (3 side tiles vs.
 * 2 rows) rather than a strict row-by-row mapping. The profile switcher
 * chip sits above the grid as its own single-node row so it's reachable by
 * pressing up from the primary row (it previously had no focus-graph entry
 * at all, making it unreachable via remote — see conversation history).
 */
function buildHomeFocusGraph(onOpenProfiles: () => void): FocusNode[] {
  const primaryIds = PRIMARY_TILES.map((t) => t.id);
  const secondaryIds = SECONDARY_TILES.map((t) => t.id);
  const sideIds = SIDE_TILES.map((t) => t.id);

  const profileNode: FocusNode = {
    id: PROFILE_SWITCHER_FOCUS_ID,
    neighbors: { down: primaryIds[0] },
    onSelect: onOpenProfiles,
  };

  const primaryNodes: FocusNode[] = primaryIds.map((id, index) => ({
    id,
    neighbors: {
      left: index > 0 ? primaryIds[index - 1] : undefined,
      right: index < primaryIds.length - 1 ? primaryIds[index + 1] : sideIds[0],
      up: PROFILE_SWITCHER_FOCUS_ID,
      down: secondaryIds[index],
    },
  }));

  const secondaryNodes: FocusNode[] = secondaryIds.map((id, index) => ({
    id,
    neighbors: {
      left: index > 0 ? secondaryIds[index - 1] : undefined,
      right: index < secondaryIds.length - 1 ? secondaryIds[index + 1] : sideIds[sideIds.length - 1],
      up: primaryIds[index],
    },
  }));

  const sideNodes: FocusNode[] = sideIds.map((id, index) => ({
    id,
    neighbors: {
      left: index === 0 ? primaryIds[primaryIds.length - 1] : secondaryIds[secondaryIds.length - 1],
      up: index > 0 ? sideIds[index - 1] : PROFILE_SWITCHER_FOCUS_ID,
      down: index < sideIds.length - 1 ? sideIds[index + 1] : undefined,
    },
  }));

  return [profileNode, ...primaryNodes, ...secondaryNodes, ...sideNodes];
}

const EMPTY_CHANNELS: Channel[] = [];
const EMPTY_SERIES: SeriesInfo[] = [];

export interface HomeScreenProps {
  source: PlaylistSource;
  platform: PlatformId;
  profile: Profile;
  onSelectTile: (tileId: string) => void;
  onOpenProfiles: () => void;
}

export function HomeScreen({ source, platform, profile, onSelectTile, onOpenProfiles }: HomeScreenProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);

  useEffect(() => {
    setGraph(SCOPE, buildHomeFocusGraph(onOpenProfiles), PRIMARY_TILES[0].id);
    return () => clearGraph(SCOPE);
  }, [setGraph, clearGraph, onOpenProfiles]);

  const handleRefresh = useCallback(() => {
    clearAllCachedContent();
    window.location.reload();
  }, []);

  const handleExit = useCallback(() => {
    window.close();
  }, []);

  const handleSelectTile = useCallback(
    (tileId: string) => {
      if (tileId === "refresh") return handleRefresh();
      if (tileId === "exit") return handleExit();
      onSelectTile(tileId);
    },
    [handleRefresh, handleExit, onSelectTile],
  );

  useRemoteInput(platform, {
    onSelect: (focusedId) => {
      if (focusedId && focusedId !== PROFILE_SWITCHER_FOCUS_ID) handleSelectTile(focusedId);
    },
  });

  // Reuses the same cache keys as LiveTvScreen/VodScreen/SeriesScreen so
  // visiting Home doesn't trigger a second fetch of data those screens
  // already loaded (or will load) this session — see use-cached-content.ts.
  const loadLive = useCallback(() => loadChannelsByKind(source, "live"), [source]);
  const { data: liveChannels } = useCachedContent(`live:${source.id}`, loadLive, EMPTY_CHANNELS);

  const loadMovies = useCallback(() => loadChannelsByKind(source, "movie"), [source]);
  const { data: movies } = useCachedContent(`vod:${source.id}`, loadMovies, EMPTY_CHANNELS);

  const loadSeries = useCallback(() => loadSeriesList(source), [source]);
  const { data: series } = useCachedContent(`series-list:${source.id}`, loadSeries, EMPTY_SERIES);

  const loadInfo = useCallback(() => loadPlaylistInfo(source), [source]);
  const { data: playlistInfo } = useCachedContent(`playlist-info:${source.id}`, loadInfo, EMPTY_PLAYLIST_INFO);

  const collageByTile = useMemo(
    () => ({
      live: liveChannels
        .map((c) => c.logoUrl)
        .filter((url): url is string => Boolean(url))
        .slice(0, 6),
      movies: movies
        .map((c) => c.logoUrl)
        .filter((url): url is string => Boolean(url))
        .slice(0, 6),
      series: series
        .map((s) => s.posterUrl)
        .filter((url): url is string => Boolean(url))
        .slice(0, 6),
    }),
    [liveChannels, movies, series],
  );

  return (
    <MeshBackground>
      <div style={{ minHeight: "100vh", padding: "32px 64px 28px", display: "flex", flexDirection: "column" }}>
        <header style={{ position: "relative", display: "flex", alignItems: "flex-start", justifyContent: "flex-start" }}>
          <Focusable id={PROFILE_SWITCHER_FOCUS_ID}>
            <ProfileSwitcher profile={profile} onOpen={onOpenProfiles} />
          </Focusable>
          <div style={{ position: "absolute", left: "50%", top: 0, transform: "translateX(-50%)" }}>
            <Clock />
          </div>
        </header>

        <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", padding: "8px 48px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${PRIMARY_TILES.length + 1}, 1fr)`,
              gridTemplateRows: "360px 140px",
              gap: 20,
              width: "100%",
              maxWidth: 1160,
            }}
          >
            {PRIMARY_TILES.map((tile, index) => (
              <div key={tile.id} style={{ gridColumn: index + 1, gridRow: 1 }}>
                <HomeTileCard
                  tile={tile}
                  height="100%"
                  iconSize={52}
                  labelSize={24}
                  collageImages={collageByTile[tile.id as keyof typeof collageByTile]}
                  onSelect={() => handleSelectTile(tile.id)}
                />
              </div>
            ))}

            {SECONDARY_TILES.map((tile, index) => (
              <div key={tile.id} style={{ gridColumn: index + 1, gridRow: 2 }}>
                <UtilityStripItem tile={tile} height={140} onSelect={() => handleSelectTile(tile.id)} />
              </div>
            ))}

            <div
              style={{
                gridColumn: PRIMARY_TILES.length + 1,
                gridRow: "1 / 3",
                display: "flex",
                flexDirection: "column",
                gap: 20,
              }}
            >
              {SIDE_TILES.map((tile) => (
                <div key={tile.id} style={{ flex: 1 }}>
                  <UtilityStripItem tile={tile} height="100%" onSelect={() => handleSelectTile(tile.id)} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <footer style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-dim)", lineHeight: 1.6 }}>
            <div>Current Playlist: {playlistInfo.name || "—"}</div>
            <div>Current playlist expires: {formatExpiry(playlistInfo.expiresAt)}</div>
          </div>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-dim)" }}>v{__APP_VERSION__}</div>
        </footer>
      </div>
    </MeshBackground>
  );
}

function formatExpiry(expiresAt: Date | null): string {
  if (expiresAt === null) return "Unlimited";
  return expiresAt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function HomeTileCard({
  tile,
  height,
  iconSize,
  labelSize,
  collageImages,
  onSelect,
}: {
  tile: HomeTile;
  height: number | string;
  iconSize: number;
  labelSize: number;
  collageImages?: string[];
  onSelect: () => void;
}): JSX.Element {
  const isFocused = useFocusStore((state) => state.focusedId === tile.id);
  const Icon = tile.icon;
  const [brokenUrls, setBrokenUrls] = useState<Set<string>>(new Set());

  // IPTV logo/poster URLs are frequently dead — drop broken images from the
  // collage individually rather than showing a broken-image icon or falling
  // back to nothing; if every image fails, the tile below still stands on
  // its own (flat icon + label), so there's no error state to render here.
  const visibleImages = (collageImages ?? []).filter((url) => !brokenUrls.has(url));

  return (
    <Focusable id={tile.id}>
      <div style={{ position: "relative", height: "100%" }}>
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: -60,
            borderRadius: 60,
            background: "radial-gradient(closest-side, rgba(130,190,255,0.85) 0%, rgba(130,190,255,0.35) 45%, rgba(130,190,255,0) 75%)",
            filter: "blur(20px)",
            opacity: isFocused ? 1 : 0,
            transform: isFocused ? "scale(1)" : "scale(0.8)",
            transition: "opacity 260ms ease-out, transform 260ms ease-out",
            pointerEvents: "none",
          }}
        />
        <button
          type="button"
          onClick={onSelect}
          style={{
            position: "relative",
            width: "100%",
            height,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            border: isFocused ? "1px solid rgba(255,255,255,0.55)" : "1px solid rgba(255,255,255,0.06)",
            borderRadius: 24,
            background: isFocused
              ? "linear-gradient(160deg, rgba(52,54,60,0.7) 0%, rgba(20,21,25,0.75) 100%)"
              : "linear-gradient(160deg, rgba(30,31,36,0.6) 0%, rgba(12,13,16,0.65) 100%)",
            backdropFilter: "blur(24px) saturate(120%)",
            WebkitBackdropFilter: "blur(24px) saturate(120%)",
            boxShadow: isFocused
              ? "inset 0 1px 0 rgba(255,255,255,0.4), 0 30px 60px -12px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)"
              : "inset 0 1px 0 rgba(255,255,255,0.12), 0 10px 24px -8px rgba(0,0,0,0.5)",
            transform: isFocused ? "scale(1.09) translateY(-6px)" : "scale(1)",
            transition: "transform 220ms cubic-bezier(0.2, 0.8, 0.3, 1), box-shadow 220ms ease-out, border-color 220ms ease-out, background 220ms ease-out",
            cursor: "pointer",
            overflow: "hidden",
          }}
        >
          {visibleImages.length > 0 && (
            <div
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexWrap: "wrap",
                opacity: 0.5,
                filter: "blur(6px) brightness(0.4) saturate(120%)",
                transition: "opacity 400ms ease-out",
              }}
            >
              {visibleImages.map((url) => (
                <img
                  key={url}
                  src={url}
                  alt=""
                  loading="lazy"
                  onError={() => setBrokenUrls((prev) => new Set(prev).add(url))}
                  style={{
                    flex: "1 1 33%",
                    minWidth: "33%",
                    height: "50%",
                    objectFit: "cover",
                  }}
                />
              ))}
            </div>
          )}
          <Icon
            size={iconSize}
            strokeWidth={1.5}
            color="var(--text)"
            style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.35))", position: "relative" }}
          />
          <span
            style={{
              fontSize: labelSize,
              fontWeight: 600,
              color: "var(--text)",
              letterSpacing: 0.2,
              position: "relative",
            }}
          >
            {tile.label}
          </span>
        </button>
      </div>
    </Focusable>
  );
}

/**
 * Smaller sibling of HomeTileCard for utility/secondary nav (Guide,
 * Favourites, History) and the side column (Settings, Refresh, Exit) — same
 * glass-card material and stacked icon+label layout as the primary cards so
 * it still reads as a grid tile on a TV, just visually subordinate via
 * reduced size/weight rather than a different shape entirely (a thin inline
 * strip read as a button/toolbar instead of a tile — see conversation
 * history). `height` accepts "100%" so side-column instances can stretch to
 * fill their flex slot instead of a fixed pixel height.
 */
function UtilityStripItem({ tile, onSelect, height = 140 }: { tile: HomeTile; onSelect: () => void; height?: number | string }): JSX.Element {
  const isFocused = useFocusStore((state) => state.focusedId === tile.id);
  const Icon = tile.icon;

  return (
    <Focusable id={tile.id}>
      <div style={{ position: "relative", height: "100%" }}>
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: -32,
            borderRadius: 40,
            background: "radial-gradient(closest-side, rgba(130,190,255,0.7) 0%, rgba(130,190,255,0.25) 45%, rgba(130,190,255,0) 75%)",
            filter: "blur(14px)",
            opacity: isFocused ? 1 : 0,
            transform: isFocused ? "scale(1)" : "scale(0.8)",
            transition: "opacity 260ms ease-out, transform 260ms ease-out",
            pointerEvents: "none",
          }}
        />
        <button
          type="button"
          onClick={onSelect}
          style={{
            position: "relative",
            width: "100%",
            height,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            border: isFocused ? "1px solid rgba(255,255,255,0.5)" : "1px solid rgba(255,255,255,0.06)",
            borderRadius: 20,
            background: isFocused
              ? "linear-gradient(160deg, rgba(52,54,60,0.7) 0%, rgba(20,21,25,0.75) 100%)"
              : "linear-gradient(160deg, rgba(30,31,36,0.6) 0%, rgba(12,13,16,0.65) 100%)",
            backdropFilter: "blur(20px) saturate(120%)",
            WebkitBackdropFilter: "blur(20px) saturate(120%)",
            boxShadow: isFocused
              ? "inset 0 1px 0 rgba(255,255,255,0.35), 0 16px 32px -10px rgba(0,0,0,0.55)"
              : "inset 0 1px 0 rgba(255,255,255,0.1), 0 6px 16px -6px rgba(0,0,0,0.45)",
            transform: isFocused ? "scale(1.06) translateY(-3px)" : "scale(1)",
            transition: "transform 200ms cubic-bezier(0.2, 0.8, 0.3, 1), box-shadow 200ms ease-out, border-color 200ms ease-out, background 200ms ease-out",
            cursor: "pointer",
          }}
        >
          <Icon size={24} strokeWidth={1.5} color="var(--text)" />
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--text)",
              whiteSpace: "nowrap",
            }}
          >
            {tile.label}
          </span>
        </button>
      </div>
    </Focusable>
  );
}
