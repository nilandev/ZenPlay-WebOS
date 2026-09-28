import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Channel, PlatformId, PlaylistSource, Profile, WatchHistoryEntry } from "@core";
import type { LucideIcon } from "lucide-react";
import {
  BROWSE_SIDE_PADDING,
  buildShelfFocusGraph,
  Clock,
  Focusable,
  FocusCard,
  MeshBackground,
  POSTER_WIDTH,
  ProfileSwitcher,
  PROFILE_SWITCHER_FOCUS_ID,
  SECTION_ICONS,
  Shelf,
  ShelfRowSkeleton,
  TV_TEXT,
  useFocusStore,
  useIsFocused,
  useRemoteInput,
  type FocusNode,
} from "@ui";
import type { ChannelLineup } from "../channel-lineup.js";
import type { ContentPolicy } from "../content-policy.js";
import { useKidsHomeRails, type KidsHomeItem } from "../use-kids-home-rails.js";
import { PLAYLIST_CHIP_ID, PlaylistChip, PlaylistPicker } from "./PlaylistPicker.js";

const SCOPE = "kids-home";
const BACK_TO_EXIT_GRACE_MS = 500;
const cardId = (railId: string, item: KidsHomeItem) => `kids-rail:${railId}:${item.kind}:${item.id}`;

interface NavTile {
  id: string;
  label: string;
  icon: LucideIcon;
}

/** The Kids profile's sections — Home's destinations without App Settings or Refresh Playlist, with Search first. */
const NAV_TILES: NavTile[] = [
  { id: "search", label: "Search", icon: SECTION_ICONS.search },
  { id: "live", label: "Live TV", icon: SECTION_ICONS.live },
  { id: "movies", label: "Movies", icon: SECTION_ICONS.movies },
  { id: "series", label: "Series", icon: SECTION_ICONS.series },
  { id: "guide", label: "Guide", icon: SECTION_ICONS.guide },
  { id: "favourites", label: "My List", icon: SECTION_ICONS.favourites },
  { id: "history", label: "Recently Watched", icon: SECTION_ICONS.history },
];
const navId = (id: string) => `kids-nav:${id}`;

export interface KidsHomeScreenProps {
  source: PlaylistSource;
  sources?: PlaylistSource[];
  onSelectSource?: (sourceId: string) => void;
  platform: PlatformId;
  profile: Profile;
  policy: ContentPolicy;
  onSelectTile: (tileId: string) => void;
  onOpenProfiles: () => void;
  onPlayMovie: (movie: Channel, options?: { resume?: boolean }) => void;
  onPlayChannel: (channel: Channel, lineup: ChannelLineup) => void;
  onContinueSeries: (entry: WatchHistoryEntry) => void;
  onOpenSeries: (seriesId: string) => void;
  /** Bumped when the player closes, so Continue Watching re-reads. */
  refreshKey?: number;
  isPlaybackOpen?: boolean;
}

/**
 * Home for a Kids profile (docs/kids-profile.md §3.5): the section pills
 * (no App Settings — parents manage everything from their own profile)
 * over the recommendation rails — Continue Watching, Picked by Parent,
 * Because you watched…, one rail per tag ranked by what this child
 * watches, and Kids Live Now. Everything shown has passed the content
 * policy. Back exits the app, like the standard Home.
 */
export function KidsHomeScreen({
  source,
  sources = [],
  onSelectSource,
  platform,
  profile,
  policy,
  onSelectTile,
  onOpenProfiles,
  onPlayMovie,
  onPlayChannel,
  onContinueSeries,
  onOpenSeries,
  refreshKey = 0,
  isPlaybackOpen = false,
}: KidsHomeScreenProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const { rails, isLoading } = useKidsHomeRails(source, profile, policy, refreshKey);

  const canSwitchPlaylist = sources.length > 1 && onSelectSource !== undefined;
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const liveLineup = useMemo(() => {
    const live = rails.find((rail) => rail.id === "live-now")?.items.flatMap((item) => (item.channel ? [item.channel] : [])) ?? [];
    return { lineup: live, directory: live };
  }, [rails]);

  const open = useCallback(
    (item: KidsHomeItem) => {
      if (item.historyEntry) {
        const entry = item.historyEntry;
        if (entry.kind === "movie") onPlayMovie({ id: entry.contentId, name: entry.title, streamUrl: entry.streamUrl ?? "", logoUrl: entry.imageUrl, kind: "movie" }, { resume: true });
        else onContinueSeries(entry);
      } else if (item.movie) {
        onPlayMovie(item.movie);
      } else if (item.channel) {
        onPlayChannel(item.channel, liveLineup.lineup.some((c) => c.id === item.channel!.id) ? liveLineup : { lineup: [item.channel], directory: [item.channel] });
      } else if (item.kind === "series") {
        onOpenSeries(item.id);
      }
    },
    [onPlayMovie, onPlayChannel, onContinueSeries, onOpenSeries, liveLineup],
  );
  const openRef = useRef(open);
  openRef.current = open;
  const latestRef = useRef({ onSelectTile, onOpenProfiles });
  latestRef.current = { onSelectTile, onOpenProfiles };

  const railsKey = rails.map((rail) => `${rail.id}=${rail.items.map((item) => item.id).join(",")}`).join("|");
  useEffect(() => {
    if (isPickerOpen) {
      setGraph(SCOPE, []);
      return;
    }
    const navIds = NAV_TILES.map((tile) => navId(tile.id));
    const rows = rails.map((rail) => rail.items.map((item) => cardId(rail.id, item)));
    const itemById = new Map(rails.flatMap((rail) => rail.items.map((item) => [cardId(rail.id, item), item] as const)));
    const header: FocusNode[] = [
      { id: PROFILE_SWITCHER_FOCUS_ID, neighbors: { down: navIds[0], right: canSwitchPlaylist ? PLAYLIST_CHIP_ID : undefined }, onSelect: () => latestRef.current.onOpenProfiles() },
      ...(canSwitchPlaylist
        ? [{ id: PLAYLIST_CHIP_ID, neighbors: { left: PROFILE_SWITCHER_FOCUS_ID, down: navIds[navIds.length - 1] }, onSelect: () => setIsPickerOpen(true) }]
        : []),
    ];
    const nav: FocusNode[] = navIds.map((id, index) => ({
      id,
      neighbors: { left: navIds[index - 1], right: navIds[index + 1], up: PROFILE_SWITCHER_FOCUS_ID, down: rows[0]?.[Math.min(index, (rows[0]?.length ?? 1) - 1)] },
      onSelect: () => latestRef.current.onSelectTile(NAV_TILES[index].id),
    }));
    const railNodes: FocusNode[] =
      rows.length > 0
        ? buildShelfFocusGraph(rows).map((node, index) => ({
            ...node,
            neighbors: { ...node.neighbors, up: index < rows[0].length ? navIds[0] : node.neighbors.up },
            onSelect: () => {
              const item = itemById.get(node.id);
              if (item) openRef.current(item);
            },
          }))
        : [];
    setGraph(SCOPE, [...header, ...nav, ...railNodes], rows[0]?.[0] ?? navIds[0]);
    // railsKey stands in for rails.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setGraph, railsKey, canSwitchPlaylist, isPickerOpen]);
  useEffect(() => () => clearGraph(SCOPE), [clearGraph]);

  const mountedAtRef = useRef(Date.now());
  useRemoteInput(
    platform,
    {
      onBack: () => {
        if (isPickerOpen) {
          setIsPickerOpen(false);
          return;
        }
        if (Date.now() - mountedAtRef.current < BACK_TO_EXIT_GRACE_MS) return;
        window.close();
      },
    },
    // Stays on while the playlist picker is open — the picker relies on its owner's remote input (as on Home).
    !isPlaybackOpen,
  );

  return (
    <MeshBackground>
      <div style={{ minHeight: "100vh", padding: "2.5vh 0 3rem", boxSizing: "border-box" }}>
        <header style={{ position: "relative", display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: `0 ${BROWSE_SIDE_PADDING}` }}>
          <Focusable id={PROFILE_SWITCHER_FOCUS_ID} style={{ width: "auto", height: "auto" }}>
            <ProfileSwitcher profile={profile} onOpen={onOpenProfiles} />
          </Focusable>
          <div style={{ position: "absolute", left: "50%", top: 0, transform: "translateX(-50%)" }}>
            <Clock />
          </div>
          {canSwitchPlaylist && (
            <Focusable id={PLAYLIST_CHIP_ID} style={{ width: "auto", height: "auto" }}>
              <PlaylistChip source={source} onOpen={() => setIsPickerOpen(true)} />
            </Focusable>
          )}
        </header>

        <nav style={{ display: "flex", gap: "1rem", flexWrap: "wrap", padding: `2rem ${BROWSE_SIDE_PADDING} 1rem` }}>
          {NAV_TILES.map((tile) => (
            <NavPill key={tile.id} tile={tile} onSelect={() => onSelectTile(tile.id)} />
          ))}
        </nav>

        {isLoading ? (
          <ShelfRowSkeleton />
        ) : rails.length === 0 ? (
          <p style={{ padding: `1rem ${BROWSE_SIDE_PADDING}`, fontSize: TV_TEXT, color: "var(--text-dim)" }}>
            Nothing to show yet — ask a parent to choose what you can watch.
          </p>
        ) : (
          rails.map((rail) => (
            <Shelf
              key={rail.id}
              title={rail.title}
              items={rail.items}
              getId={(item) => cardId(rail.id, item)}
              leftInset={BROWSE_SIDE_PADDING}
              renderItem={(item) => (
                <FocusCard
                  id={cardId(rail.id, item)}
                  width={POSTER_WIDTH}
                  aspectRatio={item.kind === "live" ? "16 / 9" : undefined}
                  title={item.name}
                  subtitle={item.subtitle}
                  imageUrl={item.imageUrl}
                  progress={item.progress}
                  placeholderIcon={item.kind === "live" ? SECTION_ICONS.live : item.kind === "vod" ? SECTION_ICONS.movies : SECTION_ICONS.series}
                  onSelect={() => open(item)}
                />
              )}
            />
          ))
        )}
      </div>
      {isPickerOpen && onSelectSource && (
        <PlaylistPicker
          sources={sources}
          activeSourceId={source.id}
          onSelect={(id) => {
            setIsPickerOpen(false);
            onSelectSource(id);
          }}
          onClose={() => setIsPickerOpen(false)}
        />
      )}
    </MeshBackground>
  );
}

function NavPill({ tile, onSelect }: { tile: NavTile; onSelect: () => void }): JSX.Element {
  const id = navId(tile.id);
  const isFocused = useIsFocused(id);
  const Icon = tile.icon;
  return (
    <Focusable id={id} style={{ width: "auto", height: "auto" }}>
      <button
        type="button"
        onClick={onSelect}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.875rem 1.5rem",
          border: "none",
          borderRadius: 999,
          fontSize: TV_TEXT,
          fontWeight: 700,
          background: isFocused ? "#ffffff" : "rgba(255,255,255,0.1)",
          color: isFocused ? "#0b0c10" : "#ffffff",
          transform: isFocused ? "scale(1.06)" : "scale(1)",
          transition: "transform 200ms cubic-bezier(0.2, 0.9, 0.3, 1)",
          cursor: "pointer",
        }}
      >
        <Icon size="1.75rem" aria-hidden />
        {tile.label}
      </button>
    </Focusable>
  );
}
