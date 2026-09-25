import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { XtreamClient, type Category, type Channel, type PlatformId, type PlaylistSource, type Profile } from "@core";
import {
  CATEGORY_RAIL_COLLAPSED_WIDTH,
  CategoryRail,
  categoryRailItemId,
  ChannelGridSkeleton,
  MeshBackground,
  ProgramGuideGrid,
  SECTION_ICONS,
  TV_TEXT,
  URLImage,
  useFocusStore,
  useRemoteInput,
  type GuideSelection,
} from "@ui";
import { useCacheInvalidationStore } from "../cache-invalidation-store.js";
import { loadChannelsByKind, loadLiveCategories } from "../content-loader.js";
import { epgVersionKey } from "../epg-store.js";
import { loadFavorites } from "../profile-store.js";
import { useCachedContent } from "../use-cached-content.js";
import { useGuideProgrammes } from "../use-guide-programmes.js";
import { useFavoritesRevision } from "../use-favorites-revision.js";

export interface GuideScreenProps {
  source: PlaylistSource;
  platform: PlatformId;
  /** For the My List category (the profile's favourite channels). */
  profile?: Profile;
  /** Live playback (programme is currently airing, or no guide data) or catch-up (past programme with an archive URL). */
  onPlay: (streamUrl: string) => void;
  onBack: () => void;
  /** True while PlayerScreen is open on top of this screen — disables this screen's own useRemoteInput so a single Back press doesn't both close the player and navigate this screen away. */
  isPlaybackOpen?: boolean;
}

const EMPTY_CHANNELS: Channel[] = [];
const EMPTY_CATEGORIES: Category[] = [];
const ALL_CATEGORY_ID = "__all__";
const MY_LIST_CATEGORY_ID = "__favourites__";

/** The category each source was last browsed in — module-level so it outlives the screen, not an app restart. */
const lastCategoryBySource = new Map<string, string>();

/** Test-only: forgets remembered categories. */
export function __resetGuideCategoryMemoryForTests(): void {
  lastCategoryBySource.clear();
}

/** Client-side category grouping for M3U sources, which have no separate category API — same approach as LiveTvScreen. */
function groupByCategory(channels: Channel[]): Category[] {
  const seen = new Map<string, Category>();
  for (const channel of channels) {
    const key = channel.groupTitle ?? "Uncategorized";
    if (!seen.has(key)) seen.set(key, { id: key, name: key, kind: "live" });
  }
  return Array.from(seen.values());
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h${rest > 0 ? ` ${rest}m` : ""}` : `${rest}m`;
}

/**
 * Program Guide: a TV timeline grid (channels down, time across — see
 * ProgramGuideGrid) under a details panel for the focused programme, with
 * the app's category rail on the left. OK plays a programme that's on now
 * (or a channel with no guide data) live, and a past programme as catch-up
 * where the channel supports it.
 */
export function GuideScreen({ source, platform, profile, onPlay, onBack, isPlaybackOpen = false }: GuideScreenProps): JSX.Element {
  const loadChannels = useCallback(() => loadChannelsByKind(source, "live"), [source]);
  const { data: channels, isInitialLoading: isChannelsLoading, error: loadError } = useCachedContent(
    `guide-channels:${source.id}`,
    "catalog",
    loadChannels,
    EMPTY_CHANNELS,
  );

  const loadCategories = useCallback(() => loadLiveCategories(source), [source]);
  const { data: fetchedCategories, isInitialLoading: isCategoriesLoading } = useCachedContent(
    `guide-categories:${source.id}`,
    "category",
    loadCategories,
    EMPTY_CATEGORIES,
  );

  // The source's XMLTV guide lives in the local EPG table, kept fresh in a
  // worker by epg-sync.ts (started from App). This version bumps when a sync
  // lands, so rows already looked up re-read the new guide.
  const epgVersion = useCacheInvalidationStore((state) => state.versions[epgVersionKey(source.id)]);

  const categories = useMemo(
    () => (fetchedCategories.length > 0 ? fetchedCategories : groupByCategory(channels)),
    [fetchedCategories, channels],
  );
  const numberById = useMemo(() => new Map(channels.map((channel, index) => [channel.id, channel.number ?? index + 1])), [channels]);

  const favoritesRevision = useFavoritesRevision(); // My List changed elsewhere (e.g. from the player)
  const favoriteChannels = useMemo(() => {
    if (!profile) return EMPTY_CHANNELS;
    const ids = new Set(
      loadFavorites(profile.id)
        .filter((f) => f.sourceId === source.id && f.contentKind === "live")
        .map((f) => f.contentId),
    );
    return channels.filter((c) => ids.has(c.id));
  }, [profile, source.id, channels, favoritesRevision]);

  const categoryItems = useMemo(
    () => [
      ...(profile ? [{ id: MY_LIST_CATEGORY_ID, label: "My List", icon: SECTION_ICONS.favourites, count: favoriteChannels.length }] : []),
      { id: ALL_CATEGORY_ID, label: "All Channels", count: channels.length },
      ...categories.map((c) => ({ id: c.id, label: c.name })),
    ],
    [profile, favoriteChannels.length, channels.length, categories],
  );

  const [activeCategoryId, setActiveCategoryId] = useState(() => lastCategoryBySource.get(source.id) ?? ALL_CATEGORY_ID);
  useEffect(() => {
    lastCategoryBySource.set(source.id, activeCategoryId);
  }, [source.id, activeCategoryId]);

  const visibleChannels = useMemo(() => {
    if (activeCategoryId === ALL_CATEGORY_ID) return channels;
    if (activeCategoryId === MY_LIST_CATEGORY_ID) return favoriteChannels;
    return channels.filter((c) => (c.groupTitle ?? "Uncategorized") === activeCategoryId || c.groupTitle === activeCategoryId);
  }, [activeCategoryId, channels, favoriteChannels]);

  const [renderedChannels, setRenderedChannels] = useState<Channel[]>(EMPTY_CHANNELS);
  const programmesByChannel = useGuideProgrammes(source, renderedChannels, epgVersion);

  const [selection, setSelection] = useState<GuideSelection | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const handleFocusChange = useCallback((next: GuideSelection) => {
    setSelection(next);
    setNotice(null);
  }, []);

  const handleSelect = useCallback(
    ({ channel, programme }: GuideSelection) => {
      const now = Date.now();
      if (!programme || (programme.start.getTime() <= now && now < programme.stop.getTime())) {
        onPlay(channel.streamUrl);
        return;
      }
      if (programme.start.getTime() > now) {
        setNotice(`Starts at ${formatTime(programme.start)}`);
        return;
      }
      if (source.kind === "xtream" && channel.hasArchive) {
        const client = new XtreamClient(source);
        const durationMinutes = Math.round((programme.stop.getTime() - programme.start.getTime()) / 60000);
        onPlay(client.buildCatchupUrl(channel.id, Math.floor(programme.start.getTime() / 1000), durationMinutes));
        return;
      }
      setNotice("Catch-up isn't available for this channel");
    },
    [onPlay, source],
  );

  const [gridEntryId, setGridEntryId] = useState<string | undefined>(undefined);
  const activeCategoryIdRef = useRef(activeCategoryId);
  activeCategoryIdRef.current = activeCategoryId;
  const selectCategory = useCallback((id: string) => {
    if (id === activeCategoryIdRef.current) {
      if (gridEntryIdRef.current) useFocusStore.getState().focus(gridEntryIdRef.current);
      return;
    }
    // The grid moves focus into the new channel list when it arrives.
    setActiveCategoryId(id);
  }, []);
  const gridEntryIdRef = useRef(gridEntryId);
  gridEntryIdRef.current = gridEntryId;

  useRemoteInput(
    platform,
    {
      // Back from the grid opens the category rail; Back from the rail leaves the guide.
      onBack: () => {
        const { focusedId, focus } = useFocusStore.getState();
        if (focusedId?.startsWith("rail:")) onBack();
        else focus(categoryRailItemId(activeCategoryIdRef.current));
      },
    },
    !isPlaybackOpen,
  );

  const isInitialLoading = isChannelsLoading || isCategoriesLoading;

  if (loadError && isInitialLoading) {
    return (
      <MeshBackground>
        <div role="alert" style={{ padding: "2.5rem", fontSize: TV_TEXT, color: "var(--text, #f4f4f6)" }}>
          Failed to load channels: {loadError}
        </div>
      </MeshBackground>
    );
  }

  if (isInitialLoading) {
    return (
      <MeshBackground>
        <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <ChannelGridSkeleton columns={5} rows={2} />
        </div>
      </MeshBackground>
    );
  }

  return (
    <MeshBackground>
      <CategoryRail
        title="Program Guide"
        items={categoryItems}
        activeId={activeCategoryId}
        onSelect={selectCategory}
        rightEntryId={gridEntryId}
        sectionBreakAt={profile ? 2 : 1}
      />
      <div style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden", paddingLeft: CATEGORY_RAIL_COLLAPSED_WIDTH, boxSizing: "border-box" }}>
        <ProgrammeDetails selection={selection} channelNumber={selection ? numberById.get(selection.channel.id) : undefined} notice={notice} />
        <div style={{ flex: 1, minHeight: 0, paddingBottom: "1.5rem" }}>
          {visibleChannels.length === 0 ? (
            <p style={{ padding: "0 1.5rem", fontSize: TV_TEXT, color: "var(--text-dim)" }}>
              {activeCategoryId === MY_LIST_CATEGORY_ID ? "Your list is empty — add channels from Live TV with + My List." : "No channels in this category."}
            </p>
          ) : (
            <ProgramGuideGrid
              channels={visibleChannels}
              numberById={numberById}
              programmesByChannel={programmesByChannel}
              onRenderedChannelsChange={setRenderedChannels}
              onFocusChange={handleFocusChange}
              onSelect={handleSelect}
              onEntryIdChange={setGridEntryId}
              leftEntryId={categoryRailItemId(activeCategoryId)}
            />
          )}
        </div>
      </div>
    </MeshBackground>
  );
}

/**
 * The focused programme, large: channel line, title, time and length with a
 * ON NOW / CATCH-UP / UPCOMING badge ("on now", not "live" — most of what
 * airs is recorded, and the guide can't tell which), a progress bar while it's on, and the
 * synopsis. Fixed height, so moving focus never shifts the grid below.
 */
function ProgrammeDetails({ selection, channelNumber, notice }: { selection: GuideSelection | null; channelNumber?: number; notice: string | null }): JSX.Element {
  const now = Date.now();
  const programme = selection?.programme ?? null;
  const isLive = programme ? programme.start.getTime() <= now && now < programme.stop.getTime() : false;
  const isPast = programme ? programme.stop.getTime() <= now : false;
  const badge = !programme ? null : isLive ? "ON NOW" : isPast ? (selection?.channel.hasArchive ? "CATCH-UP" : "ENDED") : "UPCOMING";
  const progress = programme && isLive ? (now - programme.start.getTime()) / (programme.stop.getTime() - programme.start.getTime()) : null;

  return (
    <div style={{ height: "17rem", flexShrink: 0, boxSizing: "border-box", padding: "2rem 3.5rem 1.5rem 1.5rem", display: "flex", flexDirection: "column" }}>
      {selection && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "0.875rem", fontSize: "1.25rem", color: "rgba(235,236,242,0.75)" }}>
            <div style={{ width: "2.5rem", height: "2.5rem", borderRadius: "0.5rem", overflow: "hidden", background: "rgba(255,255,255,0.06)", flexShrink: 0 }}>
              <URLImage src={selection.channel.logoUrl} alt="" seed={selection.channel.id} objectFit="contain" placeholderIcon={SECTION_ICONS.live} />
            </div>
            {channelNumber !== undefined && <span style={{ fontWeight: 700, opacity: 0.7 }}>{channelNumber}</span>}
            <span style={{ fontWeight: 600 }}>{selection.channel.name}</span>
          </div>
          <div style={{ fontSize: "2.5rem", fontWeight: 800, color: "#fff", margin: "0.75rem 0 0.5rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {programme ? programme.title : selection.channel.name}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", fontSize: TV_TEXT, color: "rgba(235,236,242,0.8)" }}>
            {programme ? (
              <>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                  {formatTime(programme.start)} – {formatTime(programme.stop)} · {formatDuration(programme.stop.getTime() - programme.start.getTime())}
                </span>
                {badge && (
                  <span
                    style={{
                      fontSize: "1rem",
                      fontWeight: 800,
                      letterSpacing: "0.06em",
                      padding: "0.25rem 0.75rem",
                      borderRadius: "0.375rem",
                      background: isLive ? "var(--accent)" : "rgba(255,255,255,0.14)",
                      color: isLive ? "#062028" : "#fff",
                    }}
                  >
                    {badge}
                  </span>
                )}
                {progress !== null && (
                  <span style={{ width: "12rem", height: "0.375rem", borderRadius: 999, background: "rgba(255,255,255,0.15)", overflow: "hidden" }}>
                    <span style={{ display: "block", width: `${Math.min(1, Math.max(0, progress)) * 100}%`, height: "100%", background: "var(--accent, #38bdf8)" }} />
                  </span>
                )}
              </>
            ) : (
              <span>No programme information — OK to watch live</span>
            )}
            {notice && <span style={{ color: "#f5c518", fontWeight: 600 }}>{notice}</span>}
          </div>
          {programme?.description && (
            <p
              style={{
                margin: "0.75rem 0 0",
                maxWidth: "70rem",
                fontSize: "1.25rem",
                lineHeight: 1.45,
                color: "rgba(235,236,242,0.7)",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {programme.description}
            </p>
          )}
        </>
      )}
    </div>
  );
}
