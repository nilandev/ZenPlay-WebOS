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

/** Hero row: primary content destinations, the reason someone opens the app. */
const PRIMARY_TILES: HomeTile[] = [
  { id: "live", label: "Live TV", icon: RadioTower },
  { id: "movies", label: "Movies", icon: Clapperboard },
  { id: "series", label: "Series", icon: Tv },
];

/** Slim rail under the hero row: secondary content destinations. */
const SECONDARY_TILES: HomeTile[] = [
  { id: "guide", label: "Guide", icon: ListVideo },
  { id: "favourites", label: "My Favourite", icon: Heart },
  { id: "history", label: "History", icon: HistoryIcon },
];

/** Header icon cluster: system-level actions, not content — kept out of the content grid entirely. */
const SYSTEM_TILES: HomeTile[] = [
  { id: "settings", label: "Settings", icon: SettingsIcon },
  { id: "refresh", label: "Refresh", icon: RefreshCw },
  { id: "exit", label: "Exit", icon: Power },
];

const EMPTY_PLAYLIST_INFO = { name: "", expiresAt: null as Date | null };

const SCOPE = "home-grid";

/**
 * Home hub shown after profile selection. Symmetric grid: Live TV/Movies/
 * Series form one row of equal-width cards, and Guide/My Favourite/History
 * sit directly beneath in a second row of equal width spanning the same
 * total width. A header icon cluster for system-level actions (Settings/
 * Refresh/Exit) sits above the grid, deliberately kept out of the content
 * grid itself.
 */
function buildHomeFocusGraph(onOpenProfiles: () => void, onSystemAction: (id: string) => void): FocusNode[] {
  const primaryIds = PRIMARY_TILES.map((t) => t.id);
  const secondaryIds = SECONDARY_TILES.map((t) => t.id);
  const systemIds = SYSTEM_TILES.map((t) => t.id);

  const profileNode: FocusNode = {
    id: PROFILE_SWITCHER_FOCUS_ID,
    neighbors: { right: systemIds[0], down: primaryIds[0] },
    onSelect: onOpenProfiles,
  };

  const systemNodes: FocusNode[] = systemIds.map((id, index) => ({
    id,
    neighbors: {
      left: index > 0 ? systemIds[index - 1] : PROFILE_SWITCHER_FOCUS_ID,
      right: index < systemIds.length - 1 ? systemIds[index + 1] : undefined,
      down: primaryIds[Math.min(index, primaryIds.length - 1)],
    },
    onSelect: () => onSystemAction(id),
  }));

  const primaryNodes: FocusNode[] = primaryIds.map((id, index) => ({
    id,
    neighbors: {
      left: index > 0 ? primaryIds[index - 1] : undefined,
      right: index < primaryIds.length - 1 ? primaryIds[index + 1] : undefined,
      up: index === 0 ? PROFILE_SWITCHER_FOCUS_ID : systemIds[Math.min(index, systemIds.length - 1)],
      down: secondaryIds[index],
    },
  }));

  const secondaryNodes: FocusNode[] = secondaryIds.map((id, index) => ({
    id,
    neighbors: {
      left: index > 0 ? secondaryIds[index - 1] : undefined,
      right: index < secondaryIds.length - 1 ? secondaryIds[index + 1] : undefined,
      up: primaryIds[index],
    },
  }));

  return [profileNode, ...systemNodes, ...primaryNodes, ...secondaryNodes];
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

  const handleRefresh = useCallback(() => {
    clearAllCachedContent();
    window.location.reload();
  }, []);

  const handleExit = useCallback(() => {
    window.close();
  }, []);

  const handleSystemAction = useCallback(
    (tileId: string) => {
      if (tileId === "refresh") return handleRefresh();
      if (tileId === "exit") return handleExit();
      onSelectTile(tileId);
    },
    [handleRefresh, handleExit, onSelectTile],
  );

  useEffect(() => {
    setGraph(SCOPE, buildHomeFocusGraph(onOpenProfiles, handleSystemAction), PRIMARY_TILES[0].id);
    return () => clearGraph(SCOPE);
  }, [setGraph, clearGraph, onOpenProfiles, handleSystemAction]);

  useRemoteInput(platform, {
    onSelect: (focusedId) => {
      if (!focusedId || focusedId === PROFILE_SWITCHER_FOCUS_ID) return;
      // System-tile nodes carry their own onSelect (see buildHomeFocusGraph)
      // and are invoked by useFocusStore's select(); only content tiles are
      // routed through the caller-supplied onSelectTile here.
      const isSystemTile = SYSTEM_TILES.some((t) => t.id === focusedId);
      if (!isSystemTile) onSelectTile(focusedId);
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
      {/*
       * Scoped scaling root: every size below this point is in rem, and this
       * font-size ties 1rem to viewport width (1rem = 16px at a 1920px-wide
       * viewport, 1rem = 32px at 3840px/4K, and so on — proportional at any
       * width, not capped early). The min/max bounds only guard truly
       * pathological window sizes (a sliver-thin browser window, or a
       * multi-monitor-spanning one), not real TV resolutions. This makes the
       * entire layout — cards, gaps, icons, text — scale together as one
       * unit at any resolution, instead of just the outer margins being
       * relative while everything inside stayed fixed-px (which looked wrong
       * at both small and very large viewports — see conversation history).
       */}
      <div
        style={{
          minHeight: "100vh",
          fontSize: "clamp(12px, 0.833vw, 40px)",
          padding: "2rem 4.5rem 1.75rem",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header style={{ position: "relative", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <Focusable id={PROFILE_SWITCHER_FOCUS_ID}>
            <ProfileSwitcher profile={profile} onOpen={onOpenProfiles} />
          </Focusable>
          <div style={{ position: "absolute", left: "50%", top: 0, transform: "translateX(-50%)" }}>
            <Clock />
          </div>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            {SYSTEM_TILES.map((tile) => (
              <SystemIconButton key={tile.id} tile={tile} onSelect={() => handleSystemAction(tile.id)} />
            ))}
          </div>
        </header>

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "0.5rem 2rem",
            margin: "12rem",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${PRIMARY_TILES.length}, 1fr)`, gap: "1.75rem" }}>
              {PRIMARY_TILES.map((tile) => (
                <HeroTileCard
                  key={tile.id}
                  tile={tile}
                  collageImages={collageByTile[tile.id as keyof typeof collageByTile]}
                  onSelect={() => onSelectTile(tile.id)}
                />
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: `repeat(${SECONDARY_TILES.length}, 1fr)`, gap: "1.25rem" }}>
              {SECONDARY_TILES.map((tile) => (
                <SecondaryRailItem key={tile.id} tile={tile} onSelect={() => onSelectTile(tile.id)} />
              ))}
            </div>
          </div>
        </div>

        <footer style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--text-dim)", lineHeight: 1.6 }}>
            <div>Current Playlist: {playlistInfo.name || "—"}</div>
            <div>Current playlist expires: {formatExpiry(playlistInfo.expiresAt)}</div>
          </div>
          <div style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--text-dim)" }}>v{__APP_VERSION__}</div>
        </footer>
      </div>
    </MeshBackground>
  );
}

function formatExpiry(expiresAt: Date | null): string {
  if (expiresAt === null) return "Unlimited";
  return expiresAt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Hero card for the primary row (Live TV/Movies/Series). Icon+label are
 * centered rather than bottom-anchored. The content collage (when
 * logos/posters loaded) sits behind them as a faint, blurred texture rather
 * than the card's primary focus — IPTV-provided logo/poster URLs are
 * frequently missing or dead, so the card can't depend on them to look
 * intentional; the centered icon+label is what carries the card regardless
 * of whether any images loaded.
 */
function HeroTileCard({
  tile,
  collageImages,
  onSelect,
}: {
  tile: HomeTile;
  collageImages?: string[];
  onSelect: () => void;
}): JSX.Element {
  const isFocused = useFocusStore((state) => state.focusedId === tile.id);
  const Icon = tile.icon;
  const [brokenUrls, setBrokenUrls] = useState<Set<string>>(new Set());

  // IPTV logo/poster URLs are frequently dead — drop broken images from the
  // collage individually rather than showing a broken-image icon or falling
  // back to nothing; if every image fails, the card still stands on its own
  // (flat gradient + icon + label), so there's no error state to render here.
  const visibleImages = (collageImages ?? []).filter((url) => !brokenUrls.has(url));

  return (
    <Focusable id={tile.id}>
      <div style={{ position: "relative", height: "100%" }}>
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: "-3.75rem",
            borderRadius: "3.75rem",
            background: "radial-gradient(closest-side, rgba(130,190,255,0.85) 0%, rgba(130,190,255,0.35) 45%, rgba(130,190,255,0) 75%)",
            filter: "blur(1.25rem)",
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
            aspectRatio: "0.82 / 1",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.875rem",
            border: isFocused ? "1px solid rgba(255,255,255,0.55)" : "1px solid rgba(255,255,255,0.08)",
            borderRadius: "1.75rem",
            background: "linear-gradient(160deg, rgba(40,42,48,0.6) 0%, rgba(14,15,18,0.7) 100%)",
            boxShadow: isFocused
              ? "inset 0 1px 0 rgba(255,255,255,0.4), 0 0 0 0.1875rem var(--accent), 0 1.875rem 3.75rem -0.75rem rgba(0,0,0,0.65)"
              : "inset 0 1px 0 rgba(255,255,255,0.1), 0 0.625rem 1.5rem -0.5rem rgba(0,0,0,0.5)",
            transform: isFocused ? "scale(1.045) translateY(-0.375rem)" : "scale(1)",
            transition: "transform 220ms cubic-bezier(0.2, 0.8, 0.3, 1), box-shadow 220ms ease-out, border-color 220ms ease-out",
            cursor: "pointer",
            overflow: "hidden",
            padding: 0,
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
                opacity: 0.65,
                filter: "blur(0.375rem) brightness(0.65) saturate(120%)",
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
                    height: "33.34%",
                    objectFit: "cover",
                  }}
                />
              ))}
            </div>
          )}
          <Icon
            size="3.25rem"
            strokeWidth={1.25}
            color={isFocused ? "var(--accent)" : "var(--text)"}
            style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.35))", position: "relative" }}
          />
          <span
            style={{
              fontSize: "1.5rem",
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
 * Secondary rail item (Guide/My Favourite/History): a wide rectangular card
 * with icon+label inline side-by-side rather than stacked — reads as a
 * lighter-weight nav row beneath the hero cards rather than a smaller
 * version of them. Deliberately no content collage or color identity; this
 * row is about navigation, not content preview, so it stays visually
 * quieter than the hero row.
 */
function SecondaryRailItem({ tile, onSelect }: { tile: HomeTile; onSelect: () => void }): JSX.Element {
  const isFocused = useFocusStore((state) => state.focusedId === tile.id);
  const Icon = tile.icon;

  return (
    <Focusable id={tile.id}>
      <div style={{ position: "relative", height: "100%" }}>
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: "-1.25rem",
            borderRadius: "2rem",
            background: "radial-gradient(closest-side, rgba(130,190,255,0.6) 0%, rgba(130,190,255,0.2) 45%, rgba(130,190,255,0) 75%)",
            filter: "blur(0.875rem)",
            opacity: isFocused ? 1 : 0,
            transform: isFocused ? "scale(1)" : "scale(0.9)",
            transition: "opacity 220ms ease-out, transform 220ms ease-out",
            pointerEvents: "none",
          }}
        />
        <button
          type="button"
          onClick={onSelect}
          style={{
            position: "relative",
            width: "100%",
            height: "6rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.875rem",
            border: isFocused ? "1px solid rgba(255,255,255,0.45)" : "1px solid rgba(255,255,255,0.08)",
            borderRadius: "1.125rem",
            background: isFocused
              ? "linear-gradient(160deg, rgba(52,54,60,0.7) 0%, rgba(20,21,25,0.75) 100%)"
              : "linear-gradient(160deg, rgba(28,29,34,0.55) 0%, rgba(12,13,16,0.6) 100%)",
            backdropFilter: "blur(16px) saturate(120%)",
            WebkitBackdropFilter: "blur(16px) saturate(120%)",
            boxShadow: isFocused
              ? "inset 0 1px 0 rgba(255,255,255,0.3), 0 0 0 0.1875rem var(--accent), 0 1rem 2rem -0.625rem rgba(0,0,0,0.55)"
              : "inset 0 1px 0 rgba(255,255,255,0.08), 0 0.375rem 1rem -0.375rem rgba(0,0,0,0.4)",
            transform: isFocused ? "scale(1.03)" : "scale(1)",
            transition: "transform 200ms cubic-bezier(0.2, 0.8, 0.3, 1), box-shadow 200ms ease-out, border-color 200ms ease-out, background 200ms ease-out",
            cursor: "pointer",
          }}
        >
          <Icon size="1.5rem" strokeWidth={1.6} color={isFocused ? "var(--accent)" : "var(--text-dim)"} />
          <span style={{ fontSize: "1rem", fontWeight: 600, color: isFocused ? "var(--text)" : "var(--text-dim)", whiteSpace: "nowrap" }}>
            {tile.label}
          </span>
        </button>
      </div>
    </Focusable>
  );
}

/**
 * Header icon cluster (Settings/Refresh/Exit): system-level actions kept
 * out of the content grid entirely so the grid stays purely about content
 * destinations — see buildHomeFocusGraph's doc comment. Small circular
 * icon-only buttons, matching the header's own scale rather than the grid's.
 */
function SystemIconButton({ tile, onSelect }: { tile: HomeTile; onSelect: () => void }): JSX.Element {
  const isFocused = useFocusStore((state) => state.focusedId === tile.id);
  const Icon = tile.icon;

  return (
    <Focusable id={tile.id}>
      <button
        type="button"
        onClick={onSelect}
        aria-label={tile.label}
        title={tile.label}
        style={{
          width: "2.75rem",
          height: "2.75rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: isFocused ? "1px solid rgba(255,255,255,0.55)" : "1px solid rgba(255,255,255,0.1)",
          borderRadius: 999,
          background: isFocused
            ? "linear-gradient(160deg, rgba(52,54,60,0.75) 0%, rgba(20,21,25,0.8) 100%)"
            : "linear-gradient(160deg, rgba(30,31,36,0.5) 0%, rgba(12,13,16,0.55) 100%)",
          backdropFilter: "blur(16px) saturate(120%)",
          WebkitBackdropFilter: "blur(16px) saturate(120%)",
          boxShadow: isFocused
            ? "inset 0 1px 0 rgba(255,255,255,0.35), 0 0 0 0.1875rem var(--accent), 0 0.625rem 1.25rem -0.5rem rgba(0,0,0,0.55)"
            : "inset 0 1px 0 rgba(255,255,255,0.1), 0 0.25rem 0.75rem -0.375rem rgba(0,0,0,0.4)",
          transform: isFocused ? "scale(1.1)" : "scale(1)",
          transition: "transform 180ms ease-out, box-shadow 180ms ease-out, border-color 180ms ease-out, background 180ms ease-out",
          cursor: "pointer",
        }}
      >
        <Icon size="1.1875rem" strokeWidth={1.75} color={isFocused ? "var(--accent)" : "var(--text)"} />
      </button>
    </Focusable>
  );
}
