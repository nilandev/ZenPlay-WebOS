import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Clapperboard,
  Heart,
  History as HistoryIcon,
  Home as HomeIcon,
  ListVideo,
  Power,
  RadioTower,
  RefreshCw,
  Settings as SettingsIcon,
  Tv,
  type LucideIcon,
} from "lucide-react";
import type { Channel, ContinueWatchingEntry, EpgProgramme, PlatformId, PlaylistSource, Profile, SeriesInfo } from "@core";
import { buildChannelGuides } from "@core";
import {
  buildShelfFocusGraph,
  Clock,
  Focusable,
  FocusCard,
  Hero,
  HERO_PLAY_FOCUS_ID,
  HeroSkeleton,
  HomeSidebar,
  MeshBackground,
  ProfileSwitcher,
  PROFILE_SWITCHER_FOCUS_ID,
  Shelf,
  ShelfRowSkeleton,
  useFocusStore,
  useRemoteInput,
} from "@ui";
import type { FocusNode, HeroContent, SidebarDestination } from "@ui";
import { buildRevalidationTargets, revalidateStaleTargets, startBackgroundRevalidation } from "../cache-revalidator.js";
import { startCatalogBackgroundSync } from "../catalog-sync.js";
import { getCatalogPage, getRecordsByIds } from "../catalog-store.js";
import { getCachedContent } from "../content-cache.js";
import { loadPlaylistInfo } from "../content-loader.js";
import { pickHeroRotation, type HeroCandidate } from "../home-curation.js";
import { schedulePrefetch } from "../idle-prefetch.js";
import { loadContinueWatching } from "../profile-store.js";
import { useCachedContent } from "../use-cached-content.js";

export interface HomeTile {
  id: string;
  label: string;
  icon: LucideIcon;
}

/** Header icon cluster: system-level actions, not content — kept out of the sidebar's content destinations. */
const SYSTEM_TILES: HomeTile[] = [
  { id: "refresh", label: "Refresh", icon: RefreshCw },
  { id: "exit", label: "Exit", icon: Power },
];

/**
 * Left sidebar's app destinations — the sole navigation surface for
 * HomeScreen's content, replacing the previous two-row tile grid (Live
 * TV/Movies/Series/Guide/My Favourite/History) entirely; see
 * docs/Home Page Redesign.md §3 for the sidebar's originally-specified
 * Home/Live TV/Movies/Series/Favorites/Settings set, extended here with
 * Guide and History so every destination the old tile grid offered is
 * still reachable, just from one place instead of two. "home" selects
 * nothing (this screen already is Home) — its onSelect is a no-op, same as
 * clicking a browser's current-page nav item.
 */
const SIDEBAR_DESTINATIONS: SidebarDestination[] = [
  { id: "home", label: "Home", icon: HomeIcon },
  { id: "live", label: "Live TV", icon: RadioTower },
  { id: "movies", label: "Movies", icon: Clapperboard },
  { id: "series", label: "Series", icon: Tv },
  { id: "guide", label: "Guide", icon: ListVideo },
  { id: "favourites", label: "Favorites", icon: Heart },
  { id: "history", label: "History", icon: HistoryIcon },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

const EMPTY_PLAYLIST_INFO = { name: "", expiresAt: null as Date | null };

const SCOPE = "home-grid";
const SHELVES_SCOPE = "home-shelves";
/** HomeScreen's own sidebar destination — its content columns' leftmost nodes always return here, since this screen only ever shows "Home" as active in the sidebar. */
const SIDEBAR_ACTIVE_ID = "home";

/** Continue Watching shelf items are prefixed so a movie id can never collide with the same movie's id if it also happened to appear elsewhere in this screen's focus graph. */
const continueWatchingItemId = (contentId: string) => `home-cw:${contentId}`;
const recentlyAddedItemId = (id: string) => `home-recent:${id}`;

interface ContinueWatchingCard {
  entry: ContinueWatchingEntry;
  title: string;
  imageUrl?: string;
}

/**
 * Home hub shown after profile selection. Header row (profile switcher +
 * Refresh/Exit) sits above the Hero, which sits above the Continue
 * Watching/Recently Added shelves — content destinations (Live TV, Movies,
 * Series, Guide, Favorites, History, Settings) live entirely in the left
 * sidebar now, not in a tile grid here.
 */
function buildHomeFocusGraph(
  onOpenProfiles: () => void,
  onSystemAction: (id: string) => void,
  belowHeaderId: string | undefined,
  sidebarActiveId?: string,
): FocusNode[] {
  const systemIds = SYSTEM_TILES.map((t) => t.id);

  const profileNode: FocusNode = {
    id: PROFILE_SWITCHER_FOCUS_ID,
    neighbors: { left: sidebarActiveId, right: systemIds[0], down: belowHeaderId },
    onSelect: onOpenProfiles,
  };

  const systemNodes: FocusNode[] = systemIds.map((id, index) => ({
    id,
    neighbors: {
      left: index > 0 ? systemIds[index - 1] : PROFILE_SWITCHER_FOCUS_ID,
      right: index < systemIds.length - 1 ? systemIds[index + 1] : undefined,
      down: belowHeaderId,
    },
    onSelect: () => onSystemAction(id),
  }));

  return [profileNode, ...systemNodes];
}

const EMPTY_CHANNELS: Channel[] = [];
const EMPTY_SERIES: SeriesInfo[] = [];
const EMPTY_PROGRAMMES: EpgProgramme[] = [];

function heroCandidateToContent(candidate: HeroCandidate): HeroContent {
  return {
    title: candidate.title,
    backdropUrl: candidate.backdropUrl,
    subtitle: candidate.kind === "live-now" ? candidate.nowPlayingTitle : undefined,
    isLive: candidate.kind === "live-now",
  };
}

export interface HomeScreenProps {
  source: PlaylistSource;
  platform: PlatformId;
  profile: Profile;
  onSelectTile: (tileId: string) => void;
  onOpenProfiles: () => void;
  /** Resumes a Continue Watching movie directly, or plays a hero-curated movie — same callback shape as VodScreen/FavouritesScreen's onPlay. */
  onPlayMovie: (movie: Channel) => void;
  /** Plays a hero-curated live channel directly — same callback shape as FavouritesScreen's onPlayChannel. */
  onPlayChannel: (channel: Channel) => void;
  /** Resumes a Continue Watching series, or opens a hero-curated series, by navigating to the Series tab with this series pre-selected — same pattern as FavouritesScreen's onOpenSeries, since resuming/browsing needs SeriesScreen's own episode-list UI. */
  onOpenSeries: (seriesId: string) => void;
  /** Bumped whenever playback with a Continue Watching identity closes (see App.tsx) — depended on, not read, purely to re-trigger the Continue Watching shelf's load after a fresh watch updates localStorage. Same pattern as SeriesScreen's own continueWatchingVersion prop. */
  continueWatchingVersion?: number;
}

export function HomeScreen({
  source,
  platform,
  profile,
  onSelectTile,
  onOpenProfiles,
  onPlayMovie,
  onPlayChannel,
  onOpenSeries,
  continueWatchingVersion,
}: HomeScreenProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);

  // Bumped while a manual refresh is in flight so the Refresh icon can show
  // a spinning affordance instead of looking like a no-op click.
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Replaces the old clearAllCachedContent() + window.location.reload() —
  // that nuked every cache tier and reloaded the entire SPA shell just to
  // re-sync one source's content, guaranteeing the worst-case full
  // multi-MB refetch cascade right when the user explicitly asked for a
  // quick refresh. In-place revalidation re-fetches the same target list
  // the background revalidator (below) uses, forced regardless of
  // staleness so Refresh always does real work, and writes results back
  // into the cache/notifies mounted screens without ever reloading.
  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    void revalidateStaleTargets(buildRevalidationTargets(source), { force: true }).finally(() => setIsRefreshing(false));
  }, [source]);

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

  // Keeps this source's catalogs/EPG/account info from going stale while the
  // user lingers on Home or elsewhere in the app, so navigating into a tab
  // rarely has to wait on a real fetch — see cache-revalidator.ts. Home is
  // the natural anchor for this: it's the hub every tab returns through, and
  // it fully unmounts/remounts on each tab switch (see App.tsx), so this
  // effectively restarts each time the user comes back here, which is fine
  // given the hours-long TTLs involved (see content-cache.ts's CacheKind
  // thresholds).
  useEffect(() => {
    const stop = startBackgroundRevalidation(() => buildRevalidationTargets(source));
    return stop;
  }, [source]);

  // Warms whatever this source's VOD/series catalogs haven't been fetched at
  // all yet (never a merely-stale one — see idle-prefetch.ts) a few seconds
  // after Home settles, so the very first navigation into Movies/Series this
  // session also feels instant, not just revisits.
  useEffect(() => {
    return schedulePrefetch(buildRevalidationTargets(source));
  }, [source]);

  // Keeps the local VOD/series catalog tables (see catalog-sync.ts) synced
  // once/day in the background — same source-keyed restart-on-tab-switch
  // behavior as startBackgroundRevalidation above, just on catalog-sync.ts's
  // own once-a-day cadence rather than content-cache.ts's hours-scale one.
  // This is what lets VodScreen/SeriesScreen serve a paginated local table
  // instead of ever re-fetching the full catalog on screen mount.
  useEffect(() => {
    return startCatalogBackgroundSync(() => source);
  }, [source]);

  const loadInfo = useCallback(() => loadPlaylistInfo(source), [source]);
  const { data: playlistInfo } = useCachedContent(`playlist-info:${source.id}`, "playlist-info", loadInfo, EMPTY_PLAYLIST_INFO);

  // Continue Watching shelf: entries only store profileId/contentId/kind
  // (see profile-store.ts), so each one is resolved back into a
  // displayable title/image via the local catalog table's id-lookup
  // (getRecordsByIds — see catalog-store.ts) rather than loading a whole
  // source's catalog just to filter it, the way FavouritesScreen currently
  // has to for lack of that lookup. Entries whose stream was removed from
  // the provider resolve to nothing and are silently dropped, so a stale
  // entry never renders as a broken card.
  const [continueWatchingCards, setContinueWatchingCards] = useState<ContinueWatchingCard[]>([]);
  // Tracks this resolution's own in-flight state directly, rather than
  // inferring "done" from continueWatchingCards.length > 0 — entries that
  // all fail to resolve (every referenced stream removed from the
  // provider) would otherwise leave that inference permanently stuck at
  // "still loading", holding the hero skeleton up forever.
  const [isContinueWatchingLoading, setIsContinueWatchingLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setIsContinueWatchingLoading(true);
    const entries = loadContinueWatching(profile.id);
    if (entries.length === 0) {
      setContinueWatchingCards([]);
      setIsContinueWatchingLoading(false);
      return;
    }

    const movieIds = entries.filter((e) => e.contentKind === "movie").map((e) => e.contentId);
    const seriesIds = entries.filter((e) => e.contentKind === "series-episode").map((e) => e.contentId);

    Promise.all([
      movieIds.length > 0 ? getRecordsByIds(source.id, "vod", movieIds) : Promise.resolve([]),
      seriesIds.length > 0 ? getRecordsByIds(source.id, "series", seriesIds) : Promise.resolve([]),
    ])
      .then(([movies, series]) => {
        if (cancelled) return;
        const movieById = new Map(movies.map((m) => [m.id, m]));
        const seriesById = new Map(series.map((s) => [s.id, s]));
        const cards = entries
          .map((entry): ContinueWatchingCard | null => {
            if (entry.contentKind === "movie") {
              const movie = movieById.get(entry.contentId);
              return movie ? { entry, title: movie.name, imageUrl: movie.logoUrl } : null;
            }
            const series = seriesById.get(entry.contentId);
            return series ? { entry, title: series.name, imageUrl: series.posterUrl } : null;
          })
          .filter((card): card is ContinueWatchingCard => card !== null)
          .sort((a, b) => new Date(b.entry.updatedAt).getTime() - new Date(a.entry.updatedAt).getTime());
        setContinueWatchingCards(cards);
        setIsContinueWatchingLoading(false);
      })
      .catch(() => {
        // IndexedDB unavailable, or this source hasn't synced its local catalog yet — an empty shelf (collapsed, see Shelf.tsx) is the right fallback rather than an error.
        if (cancelled) return;
        setContinueWatchingCards([]);
        setIsContinueWatchingLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // continueWatchingVersion isn't read, only depended on — see its prop doc comment.
  }, [profile.id, source.id, continueWatchingVersion]);

  // Day-1 fallback shelf so Home never shows nothing but the hero before
  // any watch history exists (spec Scenario C's "smart promotion") — just
  // the first page of the local VOD catalog, newest-synced-first; see
  // home-curation.ts's pickRecentlyAdded doc comment for why this is
  // explicitly not a real "trending" signal.
  const [recentlyAdded, setRecentlyAdded] = useState<Channel[]>([]);
  useEffect(() => {
    let cancelled = false;
    getCatalogPage(source.id, "vod", { offset: 0, limit: 12 })
      .then((page) => {
        if (!cancelled) setRecentlyAdded(page);
      })
      .catch(() => {
        if (!cancelled) setRecentlyAdded([]);
      });
    return () => {
      cancelled = true;
    };
  }, [source.id]);

  const shelfRows = useMemo(() => {
    const rows: string[][] = [];
    if (continueWatchingCards.length > 0) rows.push(continueWatchingCards.map((card) => continueWatchingItemId(card.entry.contentId)));
    if (recentlyAdded.length > 0) rows.push(recentlyAdded.map((item) => recentlyAddedItemId(item.id)));
    return rows;
  }, [continueWatchingCards, recentlyAdded]);

  // Hero curation: ranks candidates from data this screen already has —
  // Continue Watching (resolved above), live channels + EPG read passively
  // from whatever LiveTvScreen/GuideScreen have already cached (never a
  // fresh fetch — Home never triggers its own live/EPG fetch), and the
  // Recently Added page. isHeroLoading mirrors Continue Watching's own
  // loading flag — the one genuinely async input; live/EPG/recently-added
  // are already available synchronously or start empty, so there's no
  // separate "still loading" state to track for them.
  const isHeroLoading = isContinueWatchingLoading;

  const heroCandidates = useMemo(() => {
    const liveChannels = getCachedContent<Channel[]>(`live:${source.id}`) ?? EMPTY_CHANNELS;
    const epgProgrammes = getCachedContent<EpgProgramme[]>(`guide-epg:${source.id}`) ?? EMPTY_PROGRAMMES;
    const continueWatchingContent = new Map(
      continueWatchingCards.map((card) => [card.entry.contentId, { title: card.title, backdropUrl: card.imageUrl }]),
    );
    return pickHeroRotation({
      continueWatching: continueWatchingCards.map((card) => card.entry),
      continueWatchingContent,
      liveChannels,
      epgGuides: buildChannelGuides(epgProgrammes),
      recentVod: recentlyAdded,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continueWatchingCards, recentlyAdded, source.id]);

  // Reset to the lead candidate whenever the ranked list's own top pick
  // changes (e.g. a fresh Continue Watching entry lands and should be shown
  // immediately, not after the rotation happens to cycle back to it).
  const [heroIndex, setHeroIndex] = useState(0);
  useEffect(() => {
    setHeroIndex(0);
  }, [heroCandidates.length > 0 ? heroCandidates[0].id : null]);
  const activeHeroCandidate = heroCandidates[heroIndex] ?? heroCandidates[0];

  // Hero and header nodes are registered in the same scope (SCOPE) — not a
  // separate one — since setGraph's initialFocusId is only honored against
  // its own call's node list (see focus-store.ts), so keeping them together
  // is what lets a single setGraph call reliably place initial focus on the
  // hero's Play button (or the header, if there's no hero) instead of
  // racing two scopes' registration order.
  const hasHero = heroCandidates.length > 0;
  // First thing below the header: the hero's Play button when present,
  // otherwise the first shelf row's first item, otherwise nothing (an
  // entirely empty Day-1 Home with no hero and no shelves yet).
  const belowHeaderId = hasHero ? HERO_PLAY_FOCUS_ID : shelfRows[0]?.[0];
  // Guards the one-time initial-focus override below — content should only
  // ever claim focus back from wherever the user currently is on the very
  // first mount, never on a later re-registration (e.g. a shelf finishing
  // its load shouldn't yank focus away mid-navigation).
  const hasSetInitialFocusRef = useRef(false);
  useEffect(() => {
    const headerNodes = buildHomeFocusGraph(onOpenProfiles, handleSystemAction, belowHeaderId, SIDEBAR_ACTIVE_ID);
    const heroNodes: FocusNode[] = hasHero
      ? [{ id: HERO_PLAY_FOCUS_ID, neighbors: { left: SIDEBAR_ACTIVE_ID, up: PROFILE_SWITCHER_FOCUS_ID, down: shelfRows[0]?.[0] } }]
      : [];
    const initialId = belowHeaderId ?? PROFILE_SWITCHER_FOCUS_ID;
    setGraph(SCOPE, [...headerNodes, ...heroNodes], initialId);
    // setGraph's own initialFocusId only wins when focusedId isn't already
    // valid in some other scope (see focus-store.ts) — HomeSidebar's sibling
    // effect registers around the same time and can otherwise win this race
    // non-deterministically depending on effect order. An explicit focus()
    // call makes content's claim to initial focus unconditional, once.
    if (!hasSetInitialFocusRef.current) {
      hasSetInitialFocusRef.current = true;
      useFocusStore.getState().focus(initialId);
    }
    return () => clearGraph(SCOPE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setGraph, clearGraph, onOpenProfiles, handleSystemAction, belowHeaderId, hasHero, shelfRows[0]?.[0]]);

  useEffect(() => {
    if (shelfRows.length === 0) return;
    const nodes = buildShelfFocusGraph(shelfRows).map((node, index) => {
      const isTopRow = index < shelfRows[0].length;
      const isLeftmostInRow = shelfRows.some((row) => row[0] === node.id);
      return {
        ...node,
        neighbors: {
          ...node.neighbors,
          up: isTopRow ? (hasHero ? HERO_PLAY_FOCUS_ID : PROFILE_SWITCHER_FOCUS_ID) : node.neighbors.up,
          left: isLeftmostInRow ? SIDEBAR_ACTIVE_ID : node.neighbors.left,
        },
      };
    });
    setGraph(SHELVES_SCOPE, nodes);
    return () => clearGraph(SHELVES_SCOPE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setGraph, clearGraph, shelfRows.map((r) => r.join(",")).join("|"), hasHero]);

  const handlePlayContinueWatching = useCallback(
    (card: ContinueWatchingCard) => {
      if (card.entry.contentKind === "movie") {
        onPlayMovie({ id: card.entry.contentId, name: card.title, logoUrl: card.imageUrl, streamUrl: "", kind: "movie" });
      } else {
        onOpenSeries(card.entry.contentId);
      }
    },
    [onPlayMovie, onOpenSeries],
  );

  // Details has no dedicated detail screen to land on for movies/live (this
  // app plays directly on select everywhere else too, see VodScreen) — for
  // a series it's meaningfully different (opens Series' episode list rather
  // than guessing which episode to resume), so only that case diverges from
  // Play; movie/live both just play, same as Play.
  const handleHeroAction = useCallback(
    (candidate: HeroCandidate | undefined) => {
      if (!candidate) return;
      if (candidate.contentKind === "series") {
        onOpenSeries(candidate.id);
      } else if (candidate.contentKind === "movie") {
        onPlayMovie({ id: candidate.id, name: candidate.title, logoUrl: candidate.backdropUrl, streamUrl: "", kind: "movie" });
      } else {
        const liveChannels = getCachedContent<Channel[]>(`live:${source.id}`) ?? EMPTY_CHANNELS;
        const channel = liveChannels.find((c) => c.id === candidate.id);
        if (channel) onPlayChannel(channel);
      }
    },
    [onPlayMovie, onOpenSeries, onPlayChannel, source.id],
  );

  useRemoteInput(platform, {
    onSelect: (focusedId) => {
      if (!focusedId || focusedId === PROFILE_SWITCHER_FOCUS_ID) return;
      // System-tile nodes carry their own onSelect (see buildHomeFocusGraph)
      // and are invoked by useFocusStore's select(); only content tiles and
      // shelf items are routed through here.
      const isSystemTile = SYSTEM_TILES.some((t) => t.id === focusedId);
      if (isSystemTile) return;

      if (focusedId.startsWith("home-cw:")) {
        const contentId = focusedId.slice("home-cw:".length);
        const card = continueWatchingCards.find((c) => c.entry.contentId === contentId);
        if (card) handlePlayContinueWatching(card);
        return;
      }
      if (focusedId.startsWith("home-recent:")) {
        const id = focusedId.slice("home-recent:".length);
        const movie = recentlyAdded.find((m) => m.id === id);
        if (movie) onPlayMovie(movie);
        return;
      }
      if (focusedId === HERO_PLAY_FOCUS_ID) {
        handleHeroAction(activeHeroCandidate);
        return;
      }

      onSelectTile(focusedId);
    },
  });

  return (
    <MeshBackground>
      {/*
       * Every size below this point is in rem, which scales proportionally
       * with viewport width via the root font-size set globally in
       * index.html's <style> block (`rem` always resolves against the
       * document root, not a nested ancestor, so the scaling has to be set
       * there rather than on this div — see that file's comment for the
       * detail). This makes the entire layout — cards, gaps, icons, text —
       * scale together as one unit at any resolution, instead of just the
       * outer margins being relative while everything inside stayed
       * fixed-px.
       */}
      <div
        style={{
          height: "100vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          // TV-safe-area inset: most TVs overscan (crop) a percentage of
          // the rendered frame at each edge, and hardware/firmware differs
          // in how much — 2.5% is the standard conservative allowance (a
          // common broadcast/TV-app convention) so the sidebar's leftmost
          // items, the hero's edges, and the footer's playlist text stay
          // inside every real display's visible area instead of being
          // clipped by the panel's own bezel-hiding crop.
          padding: "2.5vh 2.5vw",
          boxSizing: "border-box",
        }}
      >
        {/*
         * Top bar spans the full width (sidebar + content), not just the
         * content column — the profile chip sits above the sidebar's own
         * left edge, the clock is centered on the whole screen, and the
         * system icons stay top-right. Previously this row lived entirely
         * inside the content column, which put the profile chip above Home
         * TILE content instead of above the sidebar it actually switches —
         * see conversation history/screenshot.
         */}
        <header
          style={{
            position: "relative",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            flexShrink: 0,
            paddingBottom: "3rem",
          }}
        >
          <Focusable id={PROFILE_SWITCHER_FOCUS_ID}>
            <ProfileSwitcher profile={profile} onOpen={onOpenProfiles} />
          </Focusable>
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: 0,
              transform: "translateX(-50%)",
            }}
          >
            <Clock />
          </div>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            {SYSTEM_TILES.map((tile) => (
              <SystemIconButton
                key={tile.id}
                tile={tile}
                isSpinning={tile.id === "refresh" && isRefreshing}
                onSelect={() => handleSystemAction(tile.id)}
              />
            ))}
          </div>
        </header>

        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          <HomeSidebar
            destinations={SIDEBAR_DESTINATIONS}
            activeId={SIDEBAR_ACTIVE_ID}
            onSelect={onSelectTile}
            rightEntryId={belowHeaderId ?? PROFILE_SWITCHER_FOCUS_ID}
          />

          <div
            style={{
              flex: 1,
              minWidth: 0,
              height: "100%",
              overflowY: shelfRows.length > 0 ? "auto" : "hidden",
              overflowX: "hidden",
              // Right edge trimmed to roughly match the other three (was
              // 4.5rem, a pre-existing stand-in for a real safe-area before
              // this screen's outer 2.5vw/2.5vh inset above existed).
              padding: "0 1.75rem 0 1rem",
              display: "flex",
              flexDirection: "column",
            }}
          >
        {isHeroLoading ? (
          <HeroSkeleton />
        ) : (
          hasHero && (
            <Hero
              platform={platform}
              content={heroCandidates.map(heroCandidateToContent)}
              isLoading={false}
              activeIndex={heroIndex}
              onActiveIndexChange={setHeroIndex}
              onPlay={() => handleHeroAction(activeHeroCandidate)}
            />
          )
        )}

        {continueWatchingCards.length > 0 && (
          <Shelf
            title="Continue Watching"
            items={continueWatchingCards}
            getId={(card) => continueWatchingItemId(card.entry.contentId)}
            renderItem={(card) => (
              <FocusCard
                id={continueWatchingItemId(card.entry.contentId)}
                title={card.title}
                imageUrl={card.imageUrl}
                onSelect={() => handlePlayContinueWatching(card)}
                // Explicit rem width (unlike FocusCard's own 220px default —
                // see its width prop doc comment on why that default stays
                // fixed-px) so Home's shelves scale with the root font-size;
                // Shelf rows are free-flowing flex, not a fixed-column grid,
                // so there's no column-count math this needs to stay in
                // sync with the way VodScreen/SeriesScreen's grids do.
                width="13.75rem"
                progress={
                  card.entry.durationSeconds > 0 ? Math.min(1, Math.max(0, card.entry.positionSeconds / card.entry.durationSeconds)) : undefined
                }
              />
            )}
          />
        )}

        {recentlyAdded.length > 0 && (
          <Shelf
            title="Recently Added"
            items={recentlyAdded}
            getId={(item) => recentlyAddedItemId(item.id)}
            renderItem={(item) => (
              <FocusCard
                id={recentlyAddedItemId(item.id)}
                title={item.name}
                imageUrl={item.logoUrl}
                onSelect={() => onPlayMovie(item)}
                width="13.75rem"
              />
            )}
          />
        )}

        <footer
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              fontSize: "0.8125rem",
              fontWeight: 500,
              color: "var(--text-dim)",
              lineHeight: 1.6,
            }}
          >
            <div>Current Playlist: {playlistInfo.name || "—"}</div>
            <div>
              Current playlist expires: {formatExpiry(playlistInfo.expiresAt)}
            </div>
          </div>
          <div
            style={{
              fontSize: "0.8125rem",
              fontWeight: 500,
              color: "var(--text-dim)",
            }}
          >
            v{__APP_VERSION__}
          </div>
        </footer>
          </div>
        </div>
      </div>
    </MeshBackground>
  );
}

function formatExpiry(expiresAt: Date | null): string {
  if (expiresAt === null) return "Unlimited";
  return expiresAt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Header icon cluster (Refresh/Exit): system-level actions, distinct from
 * the left sidebar's content destinations (which now include Settings —
 * see SIDEBAR_DESTINATIONS). Small circular icon-only buttons.
 */
function SystemIconButton({ tile, isSpinning, onSelect }: { tile: HomeTile; isSpinning?: boolean; onSelect: () => void }): JSX.Element {
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
        <Icon
          size="1.1875rem"
          strokeWidth={1.75}
          color={isFocused ? "var(--accent)" : "var(--text)"}
          style={isSpinning ? { animation: "iptv-spin 900ms linear infinite" } : undefined}
        />
      </button>
      {isSpinning && (
        <style>{`@keyframes iptv-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      )}
    </Focusable>
  );
}
