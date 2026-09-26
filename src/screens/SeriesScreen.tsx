import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlatformId, PlaylistSource, Profile, SeriesDetails, SeriesEpisode } from "@core";
import type { FocusNode } from "@ui";
import { Check, Play, Plus, RotateCcw, Search, Star, X } from "lucide-react";
import {
  CategoryRail,
  categoryRailItemId,
  SeeAllCard,
  FavoriteHeart,
  MeshBackground,
  FocusCard,
  Focusable,
  LiftSurface,
  Shelf,
  LoadingState,
  URLImage,
  buildGridFocusGraph,
  buildShelfFocusGraph,
  useFocusStore,
  useRemoteInput,
  glassBlur,
  useIsFocused,
  BROWSE_CONTENT_LEFT,
  BROWSE_GAP,
  BROWSE_ROW_GAP,
  BROWSE_SIDE_PADDING,
  POSTER_COLUMNS,
  POSTER_WIDTH,
  TV_TEXT,
  TV_HEADING,
  EPISODE_WIDTH,
  SECTION_ICONS,
} from "@ui";
import { loadSeriesCategories, loadSeriesDetails, loadSeriesList } from "../content-loader.js";
import { toggleFavorite, loadContinueWatching, loadFavorites } from "../profile-store.js";
import { useSearchQuery } from "../use-debounced-value.js";
import { useIncrementalList } from "../use-incremental-list.js";
import { useCachedContent } from "../use-cached-content.js";
import { useSeriesCatalogPage } from "../use-catalog-page.js";
import { syncSource } from "../sync/sync-manager.js";
import { useSourceSyncState } from "../sync/sync-store.js";
import { SyncNotice } from "./SyncNotice.js";
import { frequentCategoryIds, recordCategoryUse, splitByFrequency } from "../category-usage-store.js";
import { useLocalCatalogReady } from "../use-local-catalog-ready.js";
import { useCatalogShelves } from "../use-catalog-shelves.js";
import { getCatalogPage } from "../catalog-store.js";
import { useFavoritesRevision } from "../use-favorites-revision.js";
import { useContentPolicy } from "../content-policy.js";

/** The series around an episode being played — the player's title, artwork and "You're watching" details. */
export interface EpisodePlayContext {
  seriesName?: string;
  posterUrl?: string;
  details?: SeriesDetails;
  /** The viewer chose Resume on the series page — the player starts at the saved position without asking again. */
  resume?: boolean;
  /** The series' category, when known — recorded in Recently Watched for Kids recommendations. */
  categoryId?: string;
}

export interface SeriesScreenProps {
  source: PlaylistSource;
  platform: PlatformId;
  profile: Profile;
  /** allEpisodes is every episode across all seasons for this series (not just the current season) — lets the caller (App.tsx) compute the next episode for the player's Next Episode control and fill its Episodes panel. */
  onPlayEpisode: (episode: SeriesEpisode, allEpisodes: SeriesEpisode[], context: EpisodePlayContext) => void;
  onBack: () => void;
  /** Opens directly into this series' episode list instead of the shelf browser — used when arriving from My Favourite, or when returning to a series left open before the tab was switched away (see App.tsx's seriesSelectionId). */
  initialSelectedId?: string;
  /** Fired whenever the open series changes (selecting one, or backing out to the shelf browser passes null) — lets App.tsx remember the last-viewed series across this screen's unmount/remount on tab switches. */
  onSelectionChange?: (seriesId: string | null) => void;
  /** Bumped by App.tsx every time the player overlay closes after resumable playback — triggers re-reading Continue Watching, which upsertContinueWatching wrote to localStorage during playback without this screen (which stayed mounted underneath the overlay) otherwise finding out. */
  continueWatchingVersion?: number;
  /** True while PlayerScreen is open on top of this screen — disables this screen's own useRemoteInput so a single Back press doesn't both close the player and navigate this screen away. */
  isPlaybackOpen?: boolean;
}

type SeriesSummary = Awaited<ReturnType<typeof loadSeriesList>>[number];

type SeriesDetailsResult = Awaited<ReturnType<typeof loadSeriesDetails>>;

const EMPTY_SERIES: SeriesSummary[] = [];
const EMPTY_CATEGORIES: Awaited<ReturnType<typeof loadSeriesCategories>> = [];
const EMPTY_SERIES_DETAILS: SeriesDetailsResult = { details: {}, episodes: [] };
const CONTENT_ENTRY_SCOPE = "content";
const ALL_CATEGORIES_ID = "__all__";
const gridItemId = (seriesId: string) => `series-grid:${seriesId}`;
/**
 * The category each source was last browsed in, so coming back to this
 * screen (it remounts on every tab switch — see App.tsx) reopens where the
 * user was. Module-level on purpose: it should outlive the screen, not an
 * app restart.
 */
const lastCategoryBySource = new Map<string, string>();

/** Test-only: forgets remembered categories so each test starts on Browse. */
export function __resetCategoryMemoryForTests(): void {
  lastCategoryBySource.clear();
}
/** Focus id of a shelf's trailing "See all" card. */
const seeAllId = (categoryId: string) => `seeall:${categoryId}`;
const SEARCH_INPUT_ID = "series-search-input";

export function SeriesScreen({
  source,
  platform,
  profile,
  onPlayEpisode,
  onBack,
  initialSelectedId,
  onSelectionChange,
  continueWatchingVersion,
  isPlaybackOpen = false,
}: SeriesScreenProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const [selected, setSelectedState] = useState<string | null>(initialSelectedId ?? null);
  const [activeSeason, setActiveSeason] = useState<number | null>(null);
  // Remembered per profile, so a Kids profile never reopens a category a parent was browsing.
  const memoryKey = `${profile.id}:${source.id}`;
  const [activeCategoryId, setActiveCategoryId] = useState(() => lastCategoryBySource.get(memoryKey) ?? ALL_CATEGORIES_ID);
  useEffect(() => {
    lastCategoryBySource.set(memoryKey, activeCategoryId);
  }, [memoryKey, activeCategoryId]);
  // Kids profiles only see what the content policy allows (docs/kids-profile.md §6); a standard profile's policy passes everything.
  const policy = useContentPolicy(profile, source.id);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // The query that actually runs: debounced and ignored below 2 characters
  // (see useSearchQuery), so typing doesn't refilter/re-render the catalog
  // on every keystroke. searchQuery itself only drives the input's text.
  const trimmedQuery = useSearchQuery(searchQuery);
  const isAllCategories = activeCategoryId === ALL_CATEGORIES_ID;

  // Every read below comes from the local series table, which the sync
  // manager builds and refreshes — see VodScreen's identical comment. M3U
  // playlists have no series at all, so there's nothing to wait for there.
  const localCatalogStatus = useLocalCatalogReady(source.id, "series");
  const isLocalCatalogReady = localCatalogStatus === "ready";
  const isCheckingLocalCatalog = localCatalogStatus === "checking";
  const hasSeriesApi = source.kind === "xtream";
  const isAwaitingSync = localCatalogStatus === "not-synced" && hasSeriesApi;
  useEffect(() => {
    if (isAwaitingSync) void syncSource(source, { trigger: "first-run", stages: ["series"] });
  }, [source, isAwaitingSync]);
  const syncState = useSourceSyncState(source.id).stages.series;

  // While the table is still being built, a single category is fetched with
  // the provider's own category filter — see VodScreen's useCategoryFetch.
  // Never for a Kids profile: unfiltered provider data must not render while the table is built.
  const useCategoryFetch = isAwaitingSync && !isAllCategories && !trimmedQuery && !policy.isKids;
  const loadCategorySeries = useCallback(
    () => loadSeriesList(source, isAllCategories ? undefined : activeCategoryId),
    [source, isAllCategories, activeCategoryId],
  );
  const { data: categoryFetchSeries, isInitialLoading: isCategoryFetchLoading } = useCachedContent(
    isAllCategories ? "series-list:none" : `series-list:${source.id}:cat:${activeCategoryId}`,
    "catalog",
    loadCategorySeries,
    EMPTY_SERIES,
    { enabled: useCategoryFetch },
  );

  const loadCategories = useCallback(() => loadSeriesCategories(source), [source]);
  const { data: categories } = useCachedContent(`series-categories:${source.id}`, "category", loadCategories, EMPTY_CATEGORIES);
  const visibleCategories = useMemo(() => policy.visibleCatalogCategories("series", categories), [policy, categories]);
  const catalogFilter = useMemo(() => policy.catalogFilter("series", categories), [policy, categories]);

  // Local-table path: paginated grid/search reads, grown on demand (see
  // use-catalog-page.ts) — this is what lets the grid render a very large
  // catalog without ever holding it all in memory.
  const {
    items: localGridSeries,
    isInitialLoading: isLocalGridLoading,
    hasMore: localGridHasMore,
    loadMore: loadMoreLocalGrid,
    total: localGridTotal,
  } = useSeriesCatalogPage(source.id, {
    categoryId: isAllCategories ? undefined : activeCategoryId,
    namePrefix: trimmedQuery || undefined,
    filter: catalogFilter,
    enabled: isLocalCatalogReady && (!isAllCategories || trimmedQuery.length > 0),
  });

  // Fixed TV poster density (see tv-metrics.ts) — the grid and the D-pad focus graph share this column count.
  const gridColumns = POSTER_COLUMNS;


  // "All Categories" shelf browser, local-table path: one bounded query per
  // category (see use-catalog-shelves.ts) instead of loading the whole
  // catalog and grouping it client-side.
  const mapShelfPage = useCallback(
    (categoryId: string, limit: number) => getCatalogPage(source.id, "series", { categoryId, offset: 0, limit, filter: catalogFilter }),
    [source.id, catalogFilter],
  );
  const { shelves, isLoading: isLocalShelvesLoading } = useCatalogShelves(
    source.id,
    "series",
    visibleCategories,
    mapShelfPage,
    isLocalCatalogReady && isAllCategories && !trimmedQuery,
  );

  // The browse card that opened the detail page, so Back returns focus to
  // it instead of dropping the user at the top of the list.
  const returnFocusIdRef = useRef<string | null>(null);
  const setSelected = useCallback(
    (seriesId: string | null) => {
      if (seriesId) returnFocusIdRef.current = useFocusStore.getState().focusedId;
      setSelectedState(seriesId);
      setActiveSeason(null);
      onSelectionChange?.(seriesId);
    },
    [onSelectionChange],
  );

  // Bumped on every favourite toggle to force each FocusCard's heart badge
  // to re-render — see LiveTvScreen's identical comment for why this is
  // needed (toggleFavorite persists to localStorage but isn't itself
  // reactive state).
  const [favoritesVersion, setFavoritesVersion] = useState(0);
  const favoritesRevision = useFavoritesRevision(); // My List changed elsewhere (e.g. from the player)
  // Read once per toggle rather than once per card per render (each lookup
  // parses the whole favourites list from localStorage).
  const favoriteSeriesIds = useMemo(() => {
    void favoritesVersion;
    return new Set(
      loadFavorites(profile.id)
        .filter((f) => f.sourceId === source.id && f.contentKind === "series")
        .map((f) => f.contentId),
    );
  }, [profile.id, source.id, favoritesVersion, favoritesRevision]);

  const loadDetails = useCallback(
    () => (selected ? loadSeriesDetails(source, selected) : Promise.resolve(EMPTY_SERIES_DETAILS)),
    [source, selected],
  );
  const { data: seriesData, isInitialLoading: isEpisodesLoading } = useCachedContent(
    selected ? `series-details:${source.id}:${selected}` : "series-details:none",
    "catalog",
    loadDetails,
    EMPTY_SERIES_DETAILS,
  );
  const { details, episodes } = seriesData;

  // Most-opened categories first, under "Frequently used". Read once per
  // visit (the screen remounts on every tab switch) so the rail doesn't
  // reshuffle under the user while they browse.
  const frequentIds = useMemo(() => frequentCategoryIds(profile.id, source.id, "series"), [profile.id, source.id]);
  const { categoryItems, railSections } = useMemo(() => {
    const { frequent, rest } = splitByFrequency(visibleCategories, frequentIds);
    const toItem = (c: { id: string; name: string }) => ({ id: c.id, label: c.name, count: undefined as number | undefined });
    return {
      categoryItems: [{ id: ALL_CATEGORIES_ID, label: "Browse", count: undefined as number | undefined }, ...frequent.map(toItem), ...rest.map(toItem)],
      railSections: frequent.length > 0 ? [{ at: 1, label: "Frequently used" }, { at: 1 + frequent.length, label: "Categories" }] : [{ at: 1, label: "Categories" }],
    };
  }, [visibleCategories, frequentIds]);
  const activeCategoryLabel = categoryItems.find((c) => c.id === activeCategoryId)?.label ?? "Browse";

  // A remembered category a parent has since hidden falls back to Browse.
  useEffect(() => {
    if (!policy.isKids || isAllCategories || categories.length === 0) return;
    if (!visibleCategories.some((c) => c.id === activeCategoryId)) setActiveCategoryId(ALL_CATEGORIES_ID);
  }, [policy.isKids, isAllCategories, categories.length, visibleCategories, activeCategoryId]);

  // A category other than "All Categories", or a non-empty search query,
  // replaces the shelf browser with a single flat, vertically-scrolling
  // grid — Netflix's own "browsing a category"/search-results behavior,
  // versus shelves' one-row-per-category layout which doesn't make sense
  // once there's only one category (or an arbitrary text match) to show.
  // Search takes priority over the category filter when both are active,
  // searching within the selected category rather than across all series.
  // The filtering happens inside useSeriesCatalogPage's IndexedDB query;
  // the category fetch is rendered a page at a time like the table path.
  const categoryFetchPage = useIncrementalList(useCategoryFetch ? categoryFetchSeries : null);
  const gridSeries = isLocalCatalogReady ? (isAllCategories && !trimmedQuery ? null : localGridSeries) : (categoryFetchPage?.visible ?? null);
  const gridHasMore = isLocalCatalogReady ? localGridHasMore : (categoryFetchPage?.hasMore ?? false);
  const loadMoreGrid = isLocalCatalogReady ? loadMoreLocalGrid : categoryFetchPage?.loadMore;
  // The grid's query hasn't answered yet — a spinner, never a premature "No series in this category".
  const isGridLoading = isLocalCatalogReady ? isLocalGridLoading : useCategoryFetch && isCategoryFetchLoading;
  const isShelvesLoading = isLocalCatalogReady && isLocalShelvesLoading && shelves.length === 0;

  // Nothing to browse yet: the table is still being built (Xtream), or the playlist simply has no series (M3U).
  const showSyncNotice = isAwaitingSync && !useCategoryFetch;
  const showNoSeries = localCatalogStatus === "not-synced" && !hasSeriesApi;


  const seasons = useMemo(() => Array.from(new Set(episodes.map((ep) => ep.season))).sort((a, b) => a - b), [episodes]);
  const currentSeason = activeSeason ?? seasons[0] ?? null;
  const seasonEpisodes = useMemo(
    () => episodes.filter((ep) => ep.season === currentSeason).sort((a, b) => a.episode - b.episode),
    [episodes, currentSeason],
  );

  // Lookups (open detail/favourite/backdrop) search whichever list is actually on screen.
  const visibleSeries = useMemo(() => gridSeries ?? shelves.flatMap((shelf) => shelf.items), [gridSeries, shelves]);

  const series = visibleSeries.find((s) => s.id === selected);
  const continueEntry = useMemo(
    () => (selected ? loadContinueWatching(profile.id).find((e) => e.contentId === selected) : undefined),
    // continueWatchingVersion isn't read, only depended on — see its prop doc comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, profile.id, continueWatchingVersion],
  );
  const resumeEpisode = continueEntry ? episodes.find((ep) => ep.id === continueEntry.episodeId) : undefined;
  const playEpisode = (episode: SeriesEpisode, resume = false): void =>
    onPlayEpisode(episode, episodes, { seriesName: series?.name, posterUrl: series?.posterUrl, categoryId: series?.groupTitle, details, resume });

  // The detail page's Play and My List actions — shared by the buttons'
  // click (touch/pointer) and their focus nodes' onSelect (D-pad OK), which
  // read them through detailActionsRef so the focus graph isn't rebuilt on
  // every render.
  const playTarget = resumeEpisode ?? seasonEpisodes[0];
  const handleDetailPlay = (): void => {
    if (playTarget) playEpisode(playTarget, playTarget.id === resumeEpisode?.id);
  };
  const handleDetailToggleFavorite = (): void => {
    if (!selected) return;
    toggleFavorite(profile.id, source.id, "series", selected);
    setFavoritesVersion((v) => v + 1);
  };
  const detailActionsRef = useRef({ play: handleDetailPlay, toggleFavorite: handleDetailToggleFavorite });
  detailActionsRef.current = { play: handleDetailPlay, toggleFavorite: handleDetailToggleFavorite };

  // Header for the content area: the category (or search) being shown and,
  // for a single category, how many titles it holds.
  const headerTitle = trimmedQuery ? `Results for "${trimmedQuery}"` : isAllCategories ? "Series" : activeCategoryLabel;
  const headerCount = gridSeries ? (isLocalCatalogReady ? localGridTotal : categoryFetchSeries.length) : null;

  const firstContentId = gridSeries ? (gridSeries[0] ? gridItemId(gridSeries[0].id) : undefined) : shelves[0]?.items[0]?.id;
  const firstContentIdRef = useRef(firstContentId);
  firstContentIdRef.current = firstContentId;
  const activeCategoryIdRef = useRef(activeCategoryId);
  activeCategoryIdRef.current = activeCategoryId;
  // Set when a category is picked from the rail (or a "See all" card), so
  // focus follows into the new content once its focus graph registers —
  // see the browse graph effect below.
  const focusContentOnNextGraphRef = useRef(false);
  // Set when focus was parked on the search box because there was nothing else to hold it (still loading).
  const focusParkedRef = useRef(false);

  const selectCategory = useCallback((id: string) => {
    if (id === activeCategoryIdRef.current) {
      // Already showing: just hand focus back to the content.
      const first = firstContentIdRef.current;
      if (first) useFocusStore.getState().focus(first);
      return;
    }
    if (id !== ALL_CATEGORIES_ID) recordCategoryUse(profile.id, source.id, "series", id);
    focusContentOnNextGraphRef.current = true;
    setActiveCategoryId(id);
  }, [profile.id, source.id]);

  /** Moves focus into the category rail (which expands it), leaving the search box's native focus if it had it. */
  const openCategoryRail = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    useFocusStore.getState().focus(categoryRailItemId(activeCategoryIdRef.current));
  }, []);

  // Search input's proxy focus node — see SeriesSearchInput's doc comment
  // for why a native <input> needs a Focusable stand-in rather than being a
  // spatial-nav node itself. Sits to the right of the category dropdown's
  // trigger in the same sticky bar.
  useEffect(() => {
    if (selected) {
      clearGraph("chrome:series-search"); // no search box on the detail page
      return;
    }
    const node = { id: SEARCH_INPUT_ID, neighbors: { left: categoryRailItemId(activeCategoryId), down: firstContentId }, onSelect: () => searchInputRef.current?.focus() };
    setGraph("chrome:series-search", [node], undefined, { passive: true });
  }, [selected, activeCategoryId, firstContentId, setGraph, clearGraph]);
  // Rebuilds above replace the scope in place (setGraph is atomic); clearing
  // it on every rebuild would drop focus for an instant and snap it back to
  // the first node. Clear only when this component goes away.
  useEffect(() => () => clearGraph("chrome:series-search"), [clearGraph]);


  // Browse mode's focus graph: either the shelf browser (one row per
  // category, plus a trailing "See all" card) or a single flat grid (one
  // category from the rail, or a search) — never both. Up from the top row
  // reaches the search box; Left from the first column opens the category
  // rail on the active category.
  useEffect(() => {
    if (selected) return;

    const railEntryId = categoryRailItemId(activeCategoryId);
    const claimFocus = (id: string) => {
      const returnTo = returnFocusIdRef.current;
      if (returnTo && useFocusStore.getState().nodes[returnTo]) {
        returnFocusIdRef.current = null;
        useFocusStore.getState().focus(returnTo);
        return;
      }
      const parked = focusParkedRef.current && useFocusStore.getState().focusedId === SEARCH_INPUT_ID;
      focusParkedRef.current = false;
      if (!focusContentOnNextGraphRef.current && !parked) return;
      focusContentOnNextGraphRef.current = false;
      useFocusStore.getState().focus(id);
    };
    // Nothing to focus in the content yet: hold focus in the top bar so Left
    // (category rail) and Back still work, and hand it to the content once it loads.
    const parkFocus = () => {
      const { focusedId } = useFocusStore.getState();
      // Only take focus nobody holds — or move focus this screen parked itself.
      if (focusedId !== null && !(focusParkedRef.current && focusedId === SEARCH_INPUT_ID)) return;
      if (showSyncNotice || showNoSeries) {
        focusParkedRef.current = false;
        useFocusStore.getState().focus(railEntryId);
        return;
      }
      useFocusStore.getState().focus(SEARCH_INPUT_ID);
      focusParkedRef.current = true;
    };

    if (gridSeries) {
      const ids = gridSeries.map((item) => gridItemId(item.id));
      if (ids.length === 0) {
        setGraph(CONTENT_ENTRY_SCOPE, []);
        parkFocus();
        return;
      }
      const nodes = buildGridFocusGraph(ids, gridColumns).map((node, index) => ({
        ...node,
        neighbors: {
          ...node.neighbors,
          up: index < gridColumns ? SEARCH_INPUT_ID : node.neighbors.up,
          left: index % gridColumns === 0 ? railEntryId : node.neighbors.left,
        },
      }));
      setGraph(CONTENT_ENTRY_SCOPE, nodes, ids[0]);
      claimFocus(ids[0]);
      return;
    }

    const rows = shelves.map((shelf) => [...shelf.items.map((item) => item.id), seeAllId(shelf.id)]);
    if (rows.length === 0) {
      setGraph(CONTENT_ENTRY_SCOPE, []);
      parkFocus();
      return;
    }
    const categoryBySeeAllId = new Map(shelves.map((shelf) => [seeAllId(shelf.id), shelf.id]));
    const rowStarts = new Set(rows.map((row) => row[0]));
    const nodes = buildShelfFocusGraph(rows).map((node, index) => {
      const seeAllCategory = categoryBySeeAllId.get(node.id);
      return {
        ...node,
        neighbors: {
          ...node.neighbors,
          up: index < rows[0].length ? SEARCH_INPUT_ID : node.neighbors.up,
          left: rowStarts.has(node.id) ? railEntryId : node.neighbors.left,
        },
        onSelect: seeAllCategory ? () => selectCategory(seeAllCategory) : undefined,
      };
    });
    setGraph(CONTENT_ENTRY_SCOPE, nodes, rows[0][0]);
    claimFocus(rows[0][0]);
  }, [shelves, gridSeries, selected, gridColumns, activeCategoryId, selectCategory, setGraph, clearGraph, showSyncNotice, showNoSeries]);

  // Rebuilds above replace the scope in place (setGraph is atomic); clearing
  // it on every rebuild would drop focus for an instant and snap it back to
  // the first node. Clear only when this component goes away.
  useEffect(() => () => clearGraph(CONTENT_ENTRY_SCOPE), [clearGraph]);


  // Detail view's focus graph: three rows — actions (Play, My List),
  // season tabs, and the episode row — chained so Up/Down move between
  // rows: into the episodes from the tab of the season on screen, and back
  // up to that same tab. Starts on Play.
  useEffect(() => {
    if (!selected) return;

    const episodeIds = seasonEpisodes.map((ep) => ep.id);
    const hasSeasonTabs = seasons.length > 1;
    const activeTabId = hasSeasonTabs && currentSeason !== null ? seasonTabId(currentSeason) : undefined;
    const belowActions = activeTabId ?? episodeIds[0];

    const actionNodes: FocusNode[] = [
      { id: DETAIL_PLAY_ID, neighbors: { right: DETAIL_FAVORITE_ID, down: belowActions }, onSelect: () => detailActionsRef.current.play() },
      { id: DETAIL_FAVORITE_ID, neighbors: { left: DETAIL_PLAY_ID, down: belowActions }, onSelect: () => detailActionsRef.current.toggleFavorite() },
    ];
    const seasonNodes: FocusNode[] = hasSeasonTabs
      ? seasons.map((season, index) => ({
          id: seasonTabId(season),
          neighbors: {
            left: index > 0 ? seasonTabId(seasons[index - 1]) : undefined,
            right: index < seasons.length - 1 ? seasonTabId(seasons[index + 1]) : undefined,
            up: DETAIL_PLAY_ID,
            down: episodeIds[0],
          },
          onSelect: () => setActiveSeason(season),
        }))
      : [];
    const episodeNodes: FocusNode[] = episodeIds.map((id, index) => ({
      id,
      neighbors: { left: episodeIds[index - 1], right: episodeIds[index + 1], up: activeTabId ?? DETAIL_PLAY_ID },
    }));

    setGraph(CONTENT_ENTRY_SCOPE, [...actionNodes, ...seasonNodes, ...episodeNodes], DETAIL_PLAY_ID);
  }, [selected, seasons, seasonEpisodes, currentSeason, setGraph, clearGraph]);


  // Grid mode's cards register under a gridItemId(...)-prefixed id (see its
  // effect above) so they can't collide with the same series' id as used by
  // the shelf browser's own focus nodes if both were ever registered at
  // once — resolve back to the raw series id here before lookups.
  const resolveSeriesIdFromFocusId = useCallback(
    (id: string) => (id.startsWith("series-grid:") ? id.slice("series-grid:".length) : id),
    [],
  );

  // Grows the local-table grid as focus approaches its current end — see
  // VodScreen's identical effect for the full rationale (spatial navigation
  // needs a concrete, finite id list, so this is what keeps a paginated
  // grid compatible with it).
  //
  // Like VodScreen, this subscribes to a trigger-zone boolean rather than
  // focusedId so the screen doesn't re-render on every D-pad press.
  const gridEndZoneIds = useMemo(
    () => (gridSeries ? new Set(gridSeries.slice(Math.max(0, gridSeries.length - gridColumns)).map((item) => gridItemId(item.id))) : null),
    [gridSeries, gridColumns],
  );
  const isFocusInGridEndZone = useFocusStore((state) => state.focusedId !== null && (gridEndZoneIds?.has(state.focusedId) ?? false));
  useEffect(() => {
    if (isFocusInGridEndZone && gridHasMore) loadMoreGrid?.();
  }, [isFocusInGridEndZone, gridSeries, gridHasMore, loadMoreGrid]);


  useRemoteInput(
    platform,
    {
      onSelect: (id) => {
        if (!id) return;
        if (selected) {
          const episode = seasonEpisodes.find((ep) => ep.id === id);
          if (episode) playEpisode(episode);
          return;
        }
        const s = visibleSeries.find((item) => item.id === resolveSeriesIdFromFocusId(id));
        if (s) setSelected(s.id);
      },
      onLongSelect: (id) => {
        // Favouriting applies to the series as a whole, not individual
        // episodes — only act while browsing the series list.
        if (!id || selected) return;
        const s = visibleSeries.find((item) => item.id === resolveSeriesIdFromFocusId(id));
        if (!s) return;
        toggleFavorite(profile.id, source.id, "series", s.id);
        setFavoritesVersion((v) => v + 1);
      },
      onBack: () => {
        // Detail view → back to browsing. Browsing: Back from the content
        // opens the category rail first; Back from the rail leaves the screen.
        if (selected) setSelected(null);
        else if (useFocusStore.getState().focusedId?.startsWith("rail:")) onBack();
        else openCategoryRail();
      },
    },
    !isPlaybackOpen,
  );

  // The browse grid/shelves, memoised so screen-level state that doesn't
  // change them — the category menu opening/closing, each raw keystroke in
  // the search box — doesn't re-render every card on screen.
  const browseContent = useMemo(
    () => (
      <>
          {showSyncNotice ? (
            <SyncNotice what="series" state={syncState} isSearching={trimmedQuery.length > 0} canPickCategory />
          ) : showNoSeries ? (
            <p style={{ color: "var(--text-dim)", padding: `0 ${BROWSE_SIDE_PADDING} 0 ${BROWSE_CONTENT_LEFT}`, fontSize: TV_TEXT }}>This playlist has no series.</p>
          ) : isCheckingLocalCatalog || (gridSeries && isGridLoading) || (!gridSeries && isShelvesLoading) ? (
            <LoadingState centered showSlowHint={useCategoryFetch} />
          ) : gridSeries ? (
            gridSeries.length === 0 ? (
              <p style={{ color: "var(--text-dim)", padding: `0 ${BROWSE_SIDE_PADDING} 0 ${BROWSE_CONTENT_LEFT}`, fontSize: TV_TEXT }}>
                {trimmedQuery ? `No series match "${trimmedQuery}".` : "No series in this category."}
              </p>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${POSTER_COLUMNS}, minmax(0, 1fr))`,
                  columnGap: BROWSE_GAP,
                  rowGap: BROWSE_ROW_GAP,
                  padding: `0 ${BROWSE_SIDE_PADDING} 0 ${BROWSE_CONTENT_LEFT}`,
                }}
              >
                {gridSeries.map((item) => (
                  <FocusCard
                    placeholderIcon={SECTION_ICONS.series}
                    key={item.id}
                    width="100%"
                    id={gridItemId(item.id)}
                    title={item.name}
                    imageUrl={item.posterUrl}
                    onSelect={() => setSelected(item.id)}
                    badge={<FavoriteHeart isFavorite={favoriteSeriesIds.has(item.id)} />}
                  />
                ))}
              </div>
            )
          ) : (
            shelves.map((shelf) => (
              <Shelf
                key={shelf.id}
                title={shelf.title}
                items={shelf.items}
                getId={(item) => item.id}
                trailing={<SeeAllCard id={seeAllId(shelf.id)} label={shelf.title} onSelect={() => selectCategory(shelf.id)} />}
                trailingId={seeAllId(shelf.id)}
                renderItem={(item) => (
                  <FocusCard
                    placeholderIcon={SECTION_ICONS.series}
                    id={item.id}
                    width={POSTER_WIDTH}
                    title={item.name}
                    imageUrl={item.posterUrl}
                    onSelect={() => setSelected(item.id)}
                    badge={<FavoriteHeart isFavorite={favoriteSeriesIds.has(item.id)} />}
                  />
                )}
              />
            ))
          )}
      </>
    ),
    [gridSeries, shelves, trimmedQuery, favoriteSeriesIds, setSelected, selectCategory, showSyncNotice, showNoSeries, syncState, isGridLoading, isShelvesLoading, isCheckingLocalCatalog, useCategoryFetch],
  );

  if (selected) {
    const isFavorited = favoriteSeriesIds.has(selected);
    const playLabel = playTarget ? `${resumeEpisode ? "Resume" : "Play"} S${playTarget.season} E${playTarget.episode}` : "Play";
    const resumeProgress =
      continueEntry && continueEntry.durationSeconds > 0 ? continueEntry.positionSeconds / continueEntry.durationSeconds : undefined;

    return (
      <div style={{ paddingBottom: "2rem" }}>
        <SeriesHero
          name={series?.name ?? "Series"}
          posterUrl={series?.posterUrl}
          backdropUrl={details.backdropUrl}
          details={details}
          seasonCount={seasons.length}
          isLoading={isEpisodesLoading}
          isFavorited={isFavorited}
          playLabel={playLabel}
          canResume={Boolean(resumeEpisode)}
          onPlay={handleDetailPlay}
          onToggleFavorite={handleDetailToggleFavorite}
        />

        <div style={{ padding: `2.5rem ${BROWSE_SIDE_PADDING} 0` }}>
          {isEpisodesLoading ? (
            <LoadingState showSlowHint />
          ) : seasons.length === 0 ? (
            <p style={{ color: "var(--text-dim)", fontSize: TV_TEXT, margin: 0 }}>No episodes available for this series yet.</p>
          ) : (
            <SeasonTabs seasons={seasons} activeSeason={currentSeason} episodeCount={seasonEpisodes.length} onSelect={setActiveSeason} />
          )}
        </div>
        {!isEpisodesLoading && seasonEpisodes.length > 0 && (
          <Shelf
            items={seasonEpisodes}
            getId={(episode) => episode.id}
            leftInset={BROWSE_SIDE_PADDING}
            renderItem={(episode) => (
              <EpisodeCard
                episode={episode}
                progress={episode.id === resumeEpisode?.id ? resumeProgress : undefined}
                onSelect={() => playEpisode(episode)}
              />
            )}
          />
        )}
      </div>
    );
  }



  return (
    // Same backdrop as Live TV and the Program Guide (static on TVs — see
    // MeshBackground), so every browse section reads as one app.
    <MeshBackground>
    {/* No top padding: the sticky bar's fade must start at the very top, or a strip of brighter background shows above it. */}
    <div style={{ paddingBottom: 40 }}>
      <CategoryRail
        title="Series"
        items={categoryItems}
        activeId={activeCategoryId}
        onSelect={selectCategory}
        rightEntryId={firstContentId}
        sections={railSections}
      />

      {/* Sticky so the title and search stay visible while shelves or a long grid scroll underneath, instead of scrolling away with the content. */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: BROWSE_GAP,
          padding: `1.5rem ${BROWSE_SIDE_PADDING} 1.5rem ${BROWSE_CONTENT_LEFT}`,
          marginBottom: "0.5rem",
          // A soft fade (not a solid band) so posters scrolling under the
          // bar stay out of the title/search while the mesh still shows.
          background: "linear-gradient(180deg, rgba(8,9,11,0.85) 0%, rgba(8,9,11,0.6) 65%, rgba(8,9,11,0) 100%)",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "2.25rem", fontWeight: 800, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{headerTitle}</div>
          {headerCount != null && (
            <div style={{ fontSize: "1.125rem", fontWeight: 500, color: "var(--text-dim)", marginTop: "0.25rem" }}>
              {headerCount} {headerCount === 1 ? "title" : "titles"}
            </div>
          )}
        </div>
        <div style={{ marginLeft: "auto", width: "100%", maxWidth: "32rem" }}>
          <SeriesSearchInput ref={searchInputRef} value={searchQuery} onChange={setSearchQuery} />
        </div>
      </div>

      {browseContent}
    </div>
    </MeshBackground>
  );
}

/** Focus ids of the detail page's two action buttons. */
const DETAIL_PLAY_ID = "series-hero-play";
const DETAIL_FAVORITE_ID = "series-hero-favorite";
const seasonTabId = (season: number) => `season-tab:${season}`;

interface SeriesHeroProps {
  name: string;
  posterUrl?: string;
  /** A real landscape backdrop — omitted (no backdrop layer) when the provider only has a poster, rather than stretching a portrait poster across the screen. */
  backdropUrl?: string;
  details: { plot?: string; genre?: string[]; cast?: string[]; director?: string[]; rating?: number; releaseDate?: string };
  seasonCount: number;
  isLoading: boolean;
  isFavorited: boolean;
  /** e.g. "Resume S2 E4" / "Play S1 E1" — says exactly what Select will start. */
  playLabel: string;
  canResume: boolean;
  onPlay: () => void;
  onToggleFavorite: () => void;
}

/**
 * Top of the series detail page, sized for the 10-foot view: the backdrop
 * sits on the right and fades into the page (left and bottom) so text over
 * it stays readable, with a large poster and the title, metadata, plot,
 * credits and actions beside it. Every metadata row is independently
 * optional — providers frequently omit plot/cast/genre/rating — so a
 * missing field renders nothing rather than an empty line.
 */
function SeriesHero({
  name,
  posterUrl,
  backdropUrl,
  details,
  seasonCount,
  isLoading,
  isFavorited,
  playLabel,
  canResume,
  onPlay,
  onToggleFavorite,
}: SeriesHeroProps): JSX.Element {
  const year = details.releaseDate ? new Date(details.releaseDate).getFullYear() : undefined;
  const hasMetaRow = Boolean(details.rating || year || (details.genre && details.genre.length > 0) || seasonCount > 0);
  const credits = [
    details.director?.length ? `Director: ${details.director.join(", ")}` : null,
    details.cast?.length ? `Cast: ${details.cast.slice(0, 5).join(", ")}` : null,
  ].filter(Boolean);

  return (
    <div style={{ position: "relative", paddingTop: "4.5rem" }}>
      {backdropUrl && (
        <div aria-hidden style={{ position: "absolute", top: 0, right: 0, width: "72%", height: "44rem", overflow: "hidden" }}>
          <URLImage src={backdropUrl} alt="" seed={name} placeholderIcon={SECTION_ICONS.series} />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                // Solid behind the text column, clearing to the right; plus a
                // fade into the page at the bottom.
                "linear-gradient(90deg, rgba(8,9,11,1) 0%, rgba(8,9,11,0.88) 30%, rgba(8,9,11,0.4) 55%, rgba(8,9,11,0) 80%), linear-gradient(0deg, rgba(8,9,11,1) 0%, rgba(8,9,11,0) 45%)",
            }}
          />
        </div>
      )}

      <div style={{ position: "relative", display: "flex", gap: "3rem", alignItems: "flex-end", padding: `0 ${BROWSE_SIDE_PADDING}` }}>
        <div style={{ width: "15rem", aspectRatio: "2 / 3", borderRadius: "1rem", overflow: "hidden", boxShadow: "0 1.5rem 3rem rgba(0,0,0,0.55)", flexShrink: 0 }}>
          <URLImage src={posterUrl} alt="" seed={name} placeholderIcon={SECTION_ICONS.series} />
        </div>

        <div style={{ flex: 1, minWidth: 0, maxWidth: "58rem" }}>
          <h1
            style={{
              fontSize: "3.25rem",
              fontWeight: 800,
              lineHeight: 1.1,
              margin: "0 0 1rem",
              textShadow: "0 2px 12px rgba(0,0,0,0.6)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {name}
          </h1>

          {isLoading ? null : (
            <>
              {hasMetaRow && (
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "1.25rem", marginBottom: "1.25rem", fontSize: TV_TEXT, color: "rgba(235,236,242,0.8)" }}>
                  {details.rating !== undefined && (
                    <span style={{ display: "flex", alignItems: "center", gap: "0.375rem", color: "#f5c518", fontWeight: 700 }}>
                      <Star size="1.375rem" fill="#f5c518" strokeWidth={0} />
                      {details.rating.toFixed(1)}
                    </span>
                  )}
                  {year && <span>{year}</span>}
                  {seasonCount > 0 && <span>{seasonCount} Season{seasonCount === 1 ? "" : "s"}</span>}
                  {details.genre?.map((g) => (
                    <span key={g} style={{ padding: "0.25rem 0.875rem", borderRadius: 999, border: "1px solid rgba(255,255,255,0.3)", fontSize: "1.125rem" }}>
                      {g}
                    </span>
                  ))}
                </div>
              )}

              {details.plot && (
                <p
                  style={{
                    maxWidth: "52rem",
                    fontSize: TV_TEXT,
                    lineHeight: 1.5,
                    color: "rgba(235,236,242,0.85)",
                    margin: "0 0 0.75rem",
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {details.plot}
                </p>
              )}

              {credits.length > 0 && (
                <p style={{ fontSize: "1.125rem", color: "var(--text-dim)", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {credits.join(" · ")}
                </p>
              )}
            </>
          )}

          <div style={{ display: "flex", gap: "1.25rem", marginTop: "2rem" }}>
            <DetailActionButton id={DETAIL_PLAY_ID} icon={canResume ? RotateCcw : Play} label={playLabel} onSelect={onPlay} />
            <DetailActionButton id={DETAIL_FAVORITE_ID} icon={isFavorited ? Check : Plus} label="My List" onSelect={onToggleFavorite} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Large pill action button for the detail page. Focused: solid white with
 * dark text and a slight lift (the tvOS primary-button convention); idle:
 * translucent. Only transform animates. The Focusable is sized to the
 * button — its default 100% width would stretch it across the row.
 */
function DetailActionButton({ id, icon: Icon, label, onSelect }: { id: string; icon: typeof Play; label: string; onSelect: () => void }): JSX.Element {
  const isFocused = useIsFocused(id);
  return (
    <Focusable id={id} style={{ width: "auto", height: "auto" }}>
      <button
        type="button"
        onClick={onSelect}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "1rem 2.25rem",
          border: "none",
          borderRadius: 999,
          fontSize: TV_TEXT,
          fontWeight: 700,
          whiteSpace: "nowrap",
          background: isFocused ? "#ffffff" : "rgba(255,255,255,0.14)",
          color: isFocused ? "#0b0c10" : "#ffffff",
          boxShadow: isFocused ? "0 1rem 2rem -0.5rem rgba(0,0,0,0.6)" : "inset 0 0 0 1px rgba(255,255,255,0.1)",
          transform: isFocused ? "scale(1.06)" : "scale(1)",
          transition: "transform 200ms cubic-bezier(0.2, 0.9, 0.3, 1)",
          cursor: "pointer",
        }}
      >
        <Icon size="1.625rem" strokeWidth={2.25} fill={Icon === Play && isFocused ? "currentColor" : "none"} />
        {label}
      </button>
    </Focusable>
  );
}

interface SeasonTabsProps {
  seasons: number[];
  activeSeason: number | null;
  episodeCount: number;
  onSelect: (season: number) => void;
}

/**
 * Season picker above the episode row: large pill tabs (focused = solid
 * white, like the action buttons; the season on screen = soft fill). A
 * single-season series gets a plain "Episodes" heading instead of one lone
 * tab. Focus wiring lives in the parent's detail graph so Up/Down chain
 * across actions → seasons → episodes.
 */
function SeasonTabs({ seasons, activeSeason, episodeCount, onSelect }: SeasonTabsProps): JSX.Element {
  if (seasons.length <= 1) {
    return (
      <h2 style={{ fontSize: TV_HEADING, fontWeight: 700, margin: 0 }}>
        Episodes <span style={{ fontSize: TV_TEXT, fontWeight: 500, color: "var(--text-dim)", marginLeft: "0.5rem" }}>{episodeCount}</span>
      </h2>
    );
  }
  return (
    <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
      {seasons.map((season) => (
        <SeasonTab key={season} season={season} isActive={activeSeason === season} onSelect={onSelect} />
      ))}
    </div>
  );
}

function SeasonTab({ season, isActive, onSelect }: { season: number; isActive: boolean; onSelect: (season: number) => void }): JSX.Element {
  const isFocused = useIsFocused(seasonTabId(season));
  return (
    <Focusable id={seasonTabId(season)} style={{ width: "auto", height: "auto" }}>
      <button
        type="button"
        onClick={() => onSelect(season)}
        style={{
          padding: "0.75rem 1.75rem",
          border: "none",
          borderRadius: 999,
          fontSize: TV_TEXT,
          fontWeight: isActive || isFocused ? 700 : 500,
          whiteSpace: "nowrap",
          background: isFocused ? "#ffffff" : isActive ? "rgba(255,255,255,0.16)" : "transparent",
          color: isFocused ? "#0b0c10" : isActive ? "#ffffff" : "rgba(235,236,242,0.7)",
          transform: isFocused ? "scale(1.05)" : "scale(1)",
          transition: "transform 200ms cubic-bezier(0.2, 0.9, 0.3, 1)",
          cursor: "pointer",
        }}
      >
        Season {season}
      </button>
    </Focusable>
  );
}

/**
 * Landscape episode card for the detail page's episode row: 16:9 thumbnail
 * (with duration and, for the episode being resumed, a progress bar) over
 * the episode number/title and a two-line synopsis. Lifts on focus like
 * every other card in the app (LiftSurface) — no outline ring.
 */
function EpisodeCard({ episode, progress, onSelect }: { episode: SeriesEpisode; progress?: number; onSelect: () => void }): JSX.Element {
  const isFocused = useIsFocused(episode.id);
  const minutes = episode.durationSeconds ? Math.round(episode.durationSeconds / 60) : undefined;

  return (
    <Focusable id={episode.id}>
      <LiftSurface
        isFocused={isFocused}
        radius="1rem"
        width={EPISODE_WIDTH}
        focusedScale={1.08}
        role="button"
        tabIndex={-1}
        onClick={onSelect}
        faceStyle={{ background: isFocused ? "#23252d" : "#16171d" }}
      >
        <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", background: "#0f0f13" }}>
          <URLImage src={episode.posterUrl} alt="" seed={episode.id} placeholderIcon={SECTION_ICONS.series} />
          {minutes !== undefined && (
            <span
              style={{
                position: "absolute",
                bottom: "0.75rem",
                right: "0.75rem",
                background: "rgba(0,0,0,0.75)",
                color: "#fff",
                fontSize: "1rem",
                fontWeight: 700,
                padding: "0.25rem 0.625rem",
                borderRadius: "0.5rem",
              }}
            >
              {minutes}m
            </span>
          )}
          {progress !== undefined && (
            <div aria-hidden style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "0.3rem", background: "rgba(255,255,255,0.25)" }}>
              <div style={{ width: `${Math.min(1, Math.max(0, progress)) * 100}%`, height: "100%", background: "var(--accent, #38bdf8)" }} />
            </div>
          )}
        </div>
        <div style={{ padding: "1rem 1.25rem 1.25rem", minHeight: "7.25rem", boxSizing: "border-box" }}>
          <div style={{ fontSize: TV_TEXT, fontWeight: 700, color: "#fff", marginBottom: "0.375rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {episode.episode}. {episode.title}
          </div>
          {episode.plot && (
            <p
              style={{
                fontSize: "1.125rem",
                lineHeight: 1.4,
                color: "rgba(235,236,242,0.7)",
                margin: 0,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {episode.plot}
            </p>
          )}
        </div>
      </LiftSurface>
    </Focusable>
  );
}

interface SeriesSearchInputProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Plain native <input> for filtering series by title — kept as a normal
 * focusable form control rather than a spatial-nav tile, same as
 * AddSourceScreen/ProfileForm's text fields: text entry on a TV remote goes
 * through the platform's own on-screen keyboard once the input has native
 * focus, and useRemoteInput steps aside from arrow keys/Enter while a text
 * field has focus (see its isTypingIntoTextField guard) so typing a query
 * doesn't fight D-pad navigation.
 *
 * The SEARCH_INPUT_ID Focusable is a thin proxy: pressing Select while it's
 * spatially focused hands off to the real input via its ref (same pattern
 * as ProfileForm's name field), rather than the input being a graph node
 * itself.
 */
const SeriesSearchInput = forwardRef<HTMLInputElement, SeriesSearchInputProps>(function SeriesSearchInput({ value, onChange }, ref) {
  const isFocused = useIsFocused(SEARCH_INPUT_ID);

  return (
    <Focusable id={SEARCH_INPUT_ID}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          width: "100%",
          padding: "0.875rem 1.5rem",
          borderRadius: 999,
          border: isFocused ? "1px solid rgba(255,255,255,0.6)" : "1px solid rgba(255,255,255,0.16)",
          background: "rgba(28,28,34,0.7)",
          ...glassBlur("blur(16px) saturate(140%)"),
          boxShadow: isFocused ? "0 0 0 3px var(--accent, #38bdf8)" : undefined,
          transition: "box-shadow 160ms ease-out, border-color 160ms ease-out",
        }}
      >
        <Search size="1.5rem" color="var(--text-dim, #9a9aa4)" style={{ flexShrink: 0 }} />
        <input
          ref={ref}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search series"
          style={{
            flex: 1,
            border: "none",
            background: "transparent",
            padding: 0,
            fontSize: TV_TEXT,
            color: "var(--text, #f4f4f6)",
          }}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear search"
            style={{ display: "flex", background: "none", border: "none", padding: 2, color: "var(--text-dim, #9a9aa4)" }}
          >
            <X size="1.375rem" />
          </button>
        )}
      </div>
    </Focusable>
  );
});
