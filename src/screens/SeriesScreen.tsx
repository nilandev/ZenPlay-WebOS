import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlatformId, PlaylistSource, Profile, SeriesEpisode } from "@core";
import { Play, RotateCcw, Search, Star, X } from "lucide-react";
import {
  CATEGORY_DROPDOWN_TRIGGER_ID,
  CategoryDropdown,
  FavoriteHeart,
  FocusBackdrop,
  FocusTrackingBackdrop,
  FocusCard,
  Focusable,
  PillButton,
  Shelf,
  ShelfRowSkeleton,
  Shimmer,
  URLImage,
  buildGridFocusGraph,
  buildShelfFocusGraph,
  useFocusStore,
  useRemoteInput,
  glassBlur,
} from "@ui";
import { loadSeriesCategories, loadSeriesDetails, loadSeriesList } from "../content-loader.js";
import { toggleFavorite, isFavorite as checkIsFavorite, loadContinueWatching } from "../profile-store.js";
import { useCachedContent } from "../use-cached-content.js";
import { useSeriesCatalogPage } from "../use-catalog-page.js";
import { useLocalCatalogReady } from "../use-local-catalog-ready.js";
import { useCatalogShelves } from "../use-catalog-shelves.js";
import { getCatalogPage } from "../catalog-store.js";

export interface SeriesScreenProps {
  source: PlaylistSource;
  platform: PlatformId;
  profile: Profile;
  /** allEpisodes is every episode across all seasons for this series (not just the current season) — lets the caller (App.tsx) compute the next episode for the player's Next Episode control. */
  onPlayEpisode: (episode: SeriesEpisode, allEpisodes: SeriesEpisode[]) => void;
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
const GRID_GAP = 16; // matches Shelf's card-to-card gap, so the single-category grid reads the same as the "All Categories" shelf rows.
const GRID_CARD_WIDTH = 220; // FocusCard's own default width — the grid packs cards at this fixed size via auto-fill rather than stretching them, see its gridTemplateColumns comment.
const GRID_SIDE_PADDING = 40; // matches the grid's own left+right padding below.

/**
 * How many cards actually fit per row in the auto-fill grid below, computed
 * the same way the browser's own grid layout would (available width minus
 * side padding, divided into GRID_CARD_WIDTH + gap slots) — needed because
 * buildGridFocusGraph must be told a concrete column count to wire up/down
 * neighbors correctly, and auto-fill's real column count depends on
 * viewport width rather than being some fixed number this code also
 * controls. webOS TV runs at a fixed resolution (no runtime window
 * resizing), so reading window.innerWidth once here — rather than
 * subscribing to a resize observer — is enough to stay in sync with what
 * the grid actually renders.
 */
function computeGridColumns(): number {
  const available = window.innerWidth - GRID_SIDE_PADDING * 2;
  return Math.max(1, Math.floor((available + GRID_GAP) / (GRID_CARD_WIDTH + GRID_GAP)));
}
const gridItemId = (seriesId: string) => `series-grid:${seriesId}`;
const TRIGGER_UP_TARGET = CATEGORY_DROPDOWN_TRIGGER_ID;
const SEARCH_INPUT_ID = "series-search-input";

/**
 * Groups series into shelves by category, labeling each shelf with the real
 * category name rather than the raw category_id that SeriesSummary.groupTitle
 * actually holds (see XtreamClient.getSeriesList — groupTitle is
 * s.category_id, not a display name). categoryNameById comes from the
 * separate get_series_categories call; a category missing from it (or an
 * M3U source, which has none at all) falls back to the id itself so the
 * shelf still gets *a* label instead of being blank.
 */
function groupByCategory(
  list: SeriesSummary[],
  categoryNameById: Map<string, string>,
): Array<{ id: string; title: string; items: SeriesSummary[] }> {
  const byGroup = new Map<string, SeriesSummary[]>();
  for (const series of list) {
    const key = series.groupTitle ?? "Series";
    const items = byGroup.get(key);
    if (items) items.push(series);
    else byGroup.set(key, [series]);
  }
  return Array.from(byGroup.entries()).map(([id, items]) => ({ id, title: categoryNameById.get(id) ?? id, items }));
}

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
  const [activeCategoryId, setActiveCategoryId] = useState(ALL_CATEGORIES_ID);
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const isAllCategories = activeCategoryId === ALL_CATEGORIES_ID;

  // Once catalog-sync.ts has completed at least one background sync for this
  // source, every read below comes from the local paginated table instead
  // of a live player_api.php fetch — see VodScreen's identical comment and
  // use-local-catalog-ready.ts's doc comment for the three-state
  // checking/ready/not-synced shape.
  const localCatalogStatus = useLocalCatalogReady(source.id, "series");
  const isLocalCatalogReady = localCatalogStatus === "ready";
  const isCheckingLocalCatalog = localCatalogStatus === "checking";

  // Same category-lazy split as VodScreen (see its identical comment): the
  // "All Categories" shelf browser and search both need the full list, but
  // a single selected category is fetched straight from the provider's
  // server-side category filter instead, so picking one category never
  // depends on the full series catalog having been fetched at all. Only
  // relevant to the legacy fallback path — the local table never needs to
  // hold the full catalog in memory at all.
  const needsFullCatalog = localCatalogStatus === "not-synced" && (isAllCategories || trimmedQuery.length > 0);
  const loadList = useCallback(() => loadSeriesList(source), [source]);
  const { data: legacySeriesList, isInitialLoading: isLegacyListLoading } = useCachedContent(
    `series-list:${source.id}`,
    "catalog",
    loadList,
    EMPTY_SERIES,
    { enabled: needsFullCatalog },
  );

  const loadCategorySeries = useCallback(
    () => loadSeriesList(source, isAllCategories ? undefined : activeCategoryId),
    [source, isAllCategories, activeCategoryId],
  );
  const { data: legacyCategorySeries, isInitialLoading: isLegacyCategoryListLoading } = useCachedContent(
    isAllCategories ? "series-list:none" : `series-list:${source.id}:cat:${activeCategoryId}`,
    "catalog",
    loadCategorySeries,
    EMPTY_SERIES,
    { enabled: localCatalogStatus === "not-synced" && !isAllCategories },
  );

  // Local-table path: paginated grid/search reads, grown on demand (see
  // use-catalog-page.ts) — this is what lets the grid render a very large
  // catalog without ever holding it all in memory.
  const {
    items: localGridSeries,
    isInitialLoading: isLocalGridLoading,
    hasMore: localGridHasMore,
    loadMore: loadMoreLocalGrid,
  } = useSeriesCatalogPage(source.id, {
    categoryId: isAllCategories ? undefined : activeCategoryId,
    namePrefix: trimmedQuery || undefined,
    enabled: isLocalCatalogReady && (!isAllCategories || trimmedQuery.length > 0),
  });

  const gridColumns = useMemo(() => computeGridColumns(), []);

  const loadCategories = useCallback(() => loadSeriesCategories(source), [source]);
  const { data: categories } = useCachedContent(`series-categories:${source.id}`, "category", loadCategories, EMPTY_CATEGORIES);

  // "All Categories" shelf browser, local-table path: one bounded query per
  // category (see use-catalog-shelves.ts) instead of loading the whole
  // catalog and grouping it client-side.
  const mapShelfPage = useCallback(
    (categoryId: string, limit: number) => getCatalogPage(source.id, "series", { categoryId, offset: 0, limit }),
    [source.id],
  );
  const { shelves: localShelves, isLoading: isLocalShelvesLoading } = useCatalogShelves(
    source.id,
    "series",
    categories,
    mapShelfPage,
    isLocalCatalogReady && isAllCategories && !trimmedQuery,
  );

  const setSelected = useCallback(
    (seriesId: string | null) => {
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

  const categoryNameById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  // Legacy fallback path's shelves — only ever needs the full catalog (no
  // per-shelf lazy fetch), so this naturally reads [] while a single
  // category is selected — fine since shelves aren't rendered in that mode
  // anyway (see gridSeries below).
  const legacyShelves = useMemo(() => groupByCategory(legacySeriesList, categoryNameById), [legacySeriesList, categoryNameById]);
  const shelves = isLocalCatalogReady ? localShelves : legacyShelves;

  // "All Categories" row's count is only meaningful on the legacy fallback
  // path — see VodScreen's identical comment.
  const categoryItems = useMemo(
    () => [
      { id: ALL_CATEGORIES_ID, label: "All Categories", count: isLocalCatalogReady ? undefined : legacySeriesList.length },
      ...categories.map((c) => ({ id: c.id, label: c.name, count: undefined as number | undefined })),
    ],
    [isLocalCatalogReady, legacySeriesList.length, categories],
  );
  const activeCategoryLabel = categoryItems.find((c) => c.id === activeCategoryId)?.label ?? "All Categories";

  // A category other than "All Categories", or a non-empty search query,
  // replaces the shelf browser with a single flat, vertically-scrolling
  // grid — Netflix's own "browsing a category"/search-results behavior,
  // versus shelves' one-row-per-category layout which doesn't make sense
  // once there's only one category (or an arbitrary text match) to show.
  // Search takes priority over the category filter when both are active,
  // searching within the selected category rather than across all series.
  // On the legacy fallback path this filters an already-fetched array in
  // memory; on the local-table path (localGridSeries) the filtering already
  // happened inside useSeriesCatalogPage's IndexedDB query.
  const legacyGridSeries = useMemo(() => {
    const withinCategory = isAllCategories ? legacySeriesList : legacyCategorySeries;
    if (trimmedQuery) return withinCategory.filter((item) => item.name.toLowerCase().includes(trimmedQuery));
    return isAllCategories ? null : withinCategory;
  }, [isAllCategories, legacyCategorySeries, legacySeriesList, trimmedQuery]);
  const gridSeries = isLocalCatalogReady ? (isAllCategories && !trimmedQuery ? null : localGridSeries) : legacyGridSeries;

  const isBrowseLoading = isCheckingLocalCatalog
    ? true
    : isLocalCatalogReady
      ? isAllCategories && !trimmedQuery
        ? isLocalShelvesLoading
        : isLocalGridLoading
      : isAllCategories
        ? isLegacyListLoading
        : isLegacyCategoryListLoading;

  // isBrowseLoading briefly flips true again on the local-table path on
  // every query change (each keystroke while searching, or a new category)
  // — see VodScreen's identical hasEverShownContentRef comment for why
  // gating the whole screen (search input included) on that would reset
  // mid-keystroke instead of showing an in-place update.
  const hasEverShownBrowseRef = useRef(false);
  if (!isBrowseLoading) hasEverShownBrowseRef.current = true;
  const showFullScreenBrowseSkeleton = isBrowseLoading && !hasEverShownBrowseRef.current;

  const seasons = useMemo(() => Array.from(new Set(episodes.map((ep) => ep.season))).sort((a, b) => a - b), [episodes]);
  const currentSeason = activeSeason ?? seasons[0] ?? null;
  const seasonEpisodes = useMemo(
    () => episodes.filter((ep) => ep.season === currentSeason).sort((a, b) => a.episode - b.episode),
    [episodes, currentSeason],
  );

  // Lookups (open detail/favourite/backdrop) need to search whichever list
  // is actually on screen — the local-table grid/shelves when synced, or
  // the legacy fallback's full catalog/category-scoped fetch otherwise (see
  // needsFullCatalog above).
  const visibleSeries = useMemo(() => gridSeries ?? shelves.flatMap((shelf) => shelf.items), [gridSeries, shelves]);

  const series = visibleSeries.find((s) => s.id === selected);
  const continueEntry = useMemo(
    () => (selected ? loadContinueWatching(profile.id).find((e) => e.contentId === selected) : undefined),
    // continueWatchingVersion isn't read, only depended on — see its prop doc comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, profile.id, continueWatchingVersion],
  );
  const resumeEpisode = continueEntry ? episodes.find((ep) => ep.id === continueEntry.episodeId) : undefined;

  // Search input's proxy focus node — see SeriesSearchInput's doc comment
  // for why a native <input> needs a Focusable stand-in rather than being a
  // spatial-nav node itself. Sits to the right of the category dropdown's
  // trigger in the same sticky bar.
  useEffect(() => {
    if (selected) return;
    const node = { id: SEARCH_INPUT_ID, neighbors: { left: TRIGGER_UP_TARGET }, onSelect: () => searchInputRef.current?.focus() };
    setGraph("chrome:series-search", [node]);
    return () => clearGraph("chrome:series-search");
  }, [selected, setGraph, clearGraph]);

  // Browse mode's focus graph: either the shelf browser (one row per
  // category, "All Categories") or a single flat grid (one category picked
  // from the dropdown, or a search in progress) — never both, so only one
  // of these branches ever runs. The top row's "up" links back to the
  // category dropdown's trigger (a separate scope CategoryDropdown itself
  // registers) so it's always reachable by pressing Up from the very first
  // row, regardless of which mode is showing.
  useEffect(() => {
    if (selected || isCategoryDropdownOpen) return;

    if (gridSeries) {
      const ids = gridSeries.map((item) => gridItemId(item.id));
      if (ids.length === 0) return;
      const nodes = buildGridFocusGraph(ids, gridColumns).map((node, index) => ({
        ...node,
        neighbors: { ...node.neighbors, up: index < gridColumns ? TRIGGER_UP_TARGET : node.neighbors.up },
      }));
      setGraph(CONTENT_ENTRY_SCOPE, nodes, ids[0]);
      return () => clearGraph(CONTENT_ENTRY_SCOPE);
    }

    const rows = shelves.map((shelf) => shelf.items.map((item) => item.id));
    if (rows.length === 0 || rows.every((r) => r.length === 0)) return;
    const nodes = buildShelfFocusGraph(rows).map((node, index) =>
      index < rows[0].length ? { ...node, neighbors: { ...node.neighbors, up: TRIGGER_UP_TARGET } } : node,
    );
    setGraph(CONTENT_ENTRY_SCOPE, nodes, rows[0][0]);
    return () => clearGraph(CONTENT_ENTRY_SCOPE);
  }, [shelves, gridSeries, selected, isCategoryDropdownOpen, gridColumns, setGraph, clearGraph]);

  // Detail view's focus graph spans three visual rows — hero actions, season
  // tabs, episode grid — built together so up/down chains across all three
  // instead of each row only wiring its own internal left/right (which is
  // all SeasonTabs/the episode grid could do registering independently).
  useEffect(() => {
    if (!selected) return;

    const heroIds = ["series-hero-play", "series-hero-favorite"];
    const heroNodes = buildGridFocusGraph(heroIds, heroIds.length);

    const seasonIds = seasons.map((s) => `season-tab:${s}`);
    const seasonNodes = buildGridFocusGraph(seasonIds, Math.max(seasonIds.length, 1)).map((node, index) => ({
      ...node,
      onSelect: () => setActiveSeason(seasons[index]),
    }));

    const episodeIds = seasonEpisodes.map((ep) => ep.id);
    const episodeNodes = buildGridFocusGraph(episodeIds, 3);

    const firstEpisodeRowStart = 0;
    const firstSeasonTabId = seasonIds[0];
    const lastHeroRowId = heroIds[0];

    // Link hero <-> season tabs <-> first episode row vertically.
    if (seasonNodes.length > 0) {
      for (const node of heroNodes) node.neighbors.down = firstSeasonTabId;
      for (const node of seasonNodes) node.neighbors.up = lastHeroRowId;
      if (episodeNodes.length > 0) {
        for (const node of seasonNodes) node.neighbors.down = episodeIds[firstEpisodeRowStart];
        episodeNodes[0].neighbors.up = firstSeasonTabId;
      }
    } else if (episodeNodes.length > 0) {
      for (const node of heroNodes) node.neighbors.down = episodeIds[0];
      episodeNodes[0].neighbors.up = lastHeroRowId;
    }

    setGraph(CONTENT_ENTRY_SCOPE, [...heroNodes, ...seasonNodes, ...episodeNodes], heroIds[0]);
    return () => clearGraph(CONTENT_ENTRY_SCOPE);
  }, [selected, seasons, seasonEpisodes, setGraph, clearGraph]);

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
    if (isFocusInGridEndZone && localGridHasMore) loadMoreLocalGrid();
  }, [isFocusInGridEndZone, gridSeries, localGridHasMore, loadMoreLocalGrid]);

  const posterUrlBySeriesId = useMemo(() => new Map(visibleSeries.map((s) => [s.id, s.posterUrl])), [visibleSeries]);
  const getBackdropUrl = useCallback(
    (focusedId: string | null) => (focusedId ? posterUrlBySeriesId.get(resolveSeriesIdFromFocusId(focusedId)) : undefined),
    [posterUrlBySeriesId, resolveSeriesIdFromFocusId],
  );

  useRemoteInput(
    platform,
    {
      onSelect: (id) => {
        if (!id) return;
        if (selected) {
          const episode = seasonEpisodes.find((ep) => ep.id === id);
          if (episode) onPlayEpisode(episode, episodes);
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
        if (isCategoryDropdownOpen) setIsCategoryDropdownOpen(false);
        else if (selected) setSelected(null);
        else onBack();
      },
    },
    !isPlaybackOpen,
  );

  if (selected) {
    const isFavorited = (() => {
      void favoritesVersion; // re-evaluate on every toggle — see favoritesVersion's declaration
      return checkIsFavorite(profile.id, source.id, "series", selected);
    })();
    const playTarget = resumeEpisode ?? seasonEpisodes[0];
    const backdropUrl = details.backdropUrl ?? series?.posterUrl;

    return (
      <div style={{ paddingBottom: 48 }}>
        <SeriesHero
          name={series?.name ?? "Series"}
          posterUrl={series?.posterUrl}
          backdropUrl={backdropUrl}
          details={details}
          seasonCount={seasons.length}
          isLoading={isEpisodesLoading}
          isFavorited={isFavorited}
          canResume={Boolean(resumeEpisode)}
          onPlay={() => playTarget && onPlayEpisode(playTarget, episodes)}
          onToggleFavorite={() => {
            toggleFavorite(profile.id, source.id, "series", selected);
            setFavoritesVersion((v) => v + 1);
          }}
        />

        <div style={{ padding: "0 40px" }}>
          {isEpisodesLoading ? (
            <ShelfRowSkeleton rows={1} cardWidth={320} aspectRatio="16 / 9" />
          ) : seasons.length === 0 ? (
            <p style={{ color: "var(--text-dim)", marginTop: 24 }}>No episodes available for this series yet.</p>
          ) : (
            <>
              <SeasonTabs seasons={seasons} activeSeason={currentSeason} onSelect={setActiveSeason} />
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
                  gap: 20,
                  marginTop: 20,
                }}
              >
                {seasonEpisodes.map((episode) => (
                  <EpisodeCard key={episode.id} episode={episode} onSelect={() => onPlayEpisode(episode, episodes)} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  if (showFullScreenBrowseSkeleton) return <ShelfRowSkeleton />;

  const firstContentId = gridSeries ? (gridSeries[0] ? gridItemId(gridSeries[0].id) : undefined) : shelves[0]?.items[0]?.id;

  return (
    <div style={{ paddingTop: 24, paddingBottom: 40 }}>
      <FocusTrackingBackdrop getImageUrl={getBackdropUrl} />

      {/* Sticky so the category filter and search stay reachable/visible while shelves or a long grid scroll underneath, instead of scrolling away with the content. */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "16px 40px",
          marginBottom: 12,
          background: "linear-gradient(180deg, var(--bg, #0b0b0f) 70%, rgba(11,11,15,0) 100%)",
        }}
      >
        <CategoryDropdown
          items={categoryItems}
          activeId={activeCategoryId}
          activeLabel={activeCategoryLabel}
          isOpen={isCategoryDropdownOpen}
          onOpen={() => setIsCategoryDropdownOpen(true)}
          onClose={() => setIsCategoryDropdownOpen(false)}
          onSelect={(id) => {
            setActiveCategoryId(id);
            setIsCategoryDropdownOpen(false);
          }}
          contentEntryId={firstContentId}
          rightEntryId={SEARCH_INPUT_ID}
        />
        <div style={{ marginLeft: "auto", width: "100%", maxWidth: 420 }}>
          <SeriesSearchInput ref={searchInputRef} value={searchQuery} onChange={setSearchQuery} />
        </div>
      </div>

      {gridSeries ? (
        gridSeries.length === 0 ? (
          <p style={{ color: "var(--text-dim)", padding: "0 40px" }}>
            {trimmedQuery ? `No series match "${searchQuery.trim()}".` : "No series in this category."}
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              // auto-fill at FocusCard's own fixed width (220px, its
              // default) rather than repeat(N, 1fr) — 1fr stretches each
              // cell wider than the card itself on a real TV-width screen,
              // so the card sits left-aligned inside a much wider cell and
              // the *visual* gap between cards ends up far bigger than
              // GRID_GAP even though the grid's own `gap` is correct. This
              // packs cards at their natural width with just GRID_GAP
              // between them, matching Shelf's row exactly.
              gridTemplateColumns: `repeat(auto-fill, ${GRID_CARD_WIDTH}px)`,
              gap: GRID_GAP,
              padding: `0 ${GRID_SIDE_PADDING}px`,
            }}
          >
            {gridSeries.map((item) => (
              <FocusCard
                key={item.id}
                id={gridItemId(item.id)}
                title={item.name}
                imageUrl={item.posterUrl}
                onSelect={() => setSelected(item.id)}
                badge={
                  <FavoriteHeart
                    isFavorite={(() => {
                      void favoritesVersion; // re-evaluate on every toggle — see favoritesVersion's declaration
                      return checkIsFavorite(profile.id, source.id, "series", item.id);
                    })()}
                  />
                }
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
            renderItem={(item) => (
              <FocusCard
                id={item.id}
                title={item.name}
                imageUrl={item.posterUrl}
                onSelect={() => setSelected(item.id)}
                badge={
                  <FavoriteHeart
                    isFavorite={(() => {
                      void favoritesVersion; // re-evaluate on every toggle — see favoritesVersion's declaration
                      return checkIsFavorite(profile.id, source.id, "series", item.id);
                    })()}
                  />
                }
              />
            )}
          />
        ))
      )}
    </div>
  );
}

interface SeriesHeroProps {
  name: string;
  posterUrl?: string;
  backdropUrl?: string;
  details: { plot?: string; genre?: string[]; cast?: string[]; director?: string[]; rating?: number; releaseDate?: string };
  seasonCount: number;
  isLoading: boolean;
  isFavorited: boolean;
  canResume: boolean;
  onPlay: () => void;
  onToggleFavorite: () => void;
}

/**
 * Full-bleed hero for the series detail view, Netflix/Apple-TV-style: a
 * blurred backdrop crossfade (reusing FocusBackdrop) with a bottom gradient
 * scrim holding title, rating/genre/year metadata, plot, and primary
 * actions. Every metadata row is independently optional — providers
 * (especially non-Xtream/M3U sources, or sparse Xtream panels) frequently
 * omit plot/cast/genre/rating, so each row renders nothing rather than an
 * empty/"undefined" line when its data is missing.
 */
function SeriesHero({
  name,
  posterUrl,
  backdropUrl,
  details,
  seasonCount,
  isLoading,
  isFavorited,
  canResume,
  onPlay,
  onToggleFavorite,
}: SeriesHeroProps): JSX.Element {
  const year = details.releaseDate ? new Date(details.releaseDate).getFullYear() : undefined;
  const hasMetaRow = Boolean(details.rating || year || (details.genre && details.genre.length > 0) || seasonCount > 0);

  return (
    <div style={{ position: "relative", minHeight: 420, display: "flex", alignItems: "flex-end", marginBottom: 8 }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: backdropUrl ? `url(${backdropUrl})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center 20%",
          background: backdropUrl ? undefined : "linear-gradient(160deg, #26262e 0%, #16161a 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg, rgba(11,11,15,0.15) 0%, rgba(11,11,15,0.55) 55%, var(--bg, #0b0b0f) 100%)",
        }}
      />
      <div style={{ position: "relative", padding: "40px 40px 32px", display: "flex", gap: 28, alignItems: "flex-end", width: "100%" }}>
        <div style={{ width: 160, aspectRatio: "2 / 3", borderRadius: 10, overflow: "hidden", boxShadow: "0 12px 32px rgba(0,0,0,0.5)", flexShrink: 0 }}>
          <URLImage src={posterUrl} alt="" seed={name} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {isLoading ? (
            <>
              <Shimmer width={320} height={36} style={{ marginBottom: 12 }} />
              <Shimmer width={220} height={16} style={{ marginBottom: 16 }} />
              <Shimmer width="60%" height={14} />
            </>
          ) : (
            <>
              <h1 style={{ fontSize: 36, fontWeight: 800, margin: "0 0 10px", textShadow: "0 2px 12px rgba(0,0,0,0.6)" }}>{name}</h1>

              {hasMetaRow && (
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, fontSize: 16, color: "var(--text-dim)" }}>
                  {details.rating !== undefined && (
                    <span style={{ display: "flex", alignItems: "center", gap: 5, color: "#f5c518", fontWeight: 700 }}>
                      <Star size={17} fill="#f5c518" strokeWidth={0} />
                      {details.rating.toFixed(1)}
                    </span>
                  )}
                  {year && <span>{year}</span>}
                  {seasonCount > 0 && <span>{seasonCount} Season{seasonCount === 1 ? "" : "s"}</span>}
                  {details.genre && details.genre.length > 0 && (
                    <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {details.genre.map((g) => (
                        <span
                          key={g}
                          style={{ padding: "3px 12px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.25)", fontSize: 14 }}
                        >
                          {g}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              )}

              {details.plot && (
                <p
                  style={{
                    maxWidth: 640,
                    fontSize: 17,
                    lineHeight: 1.5,
                    color: "var(--text-dim)",
                    margin: "0 0 10px",
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {details.plot}
                </p>
              )}

              {(details.cast?.length || details.director?.length) && (
                <p style={{ fontSize: 15, color: "var(--text-dim)", margin: "0 0 20px", opacity: 0.85 }}>
                  {details.director?.length ? <>Director: {details.director.join(", ")}. </> : null}
                  {details.cast?.length ? <>Cast: {details.cast.slice(0, 5).join(", ")}</> : null}
                </p>
              )}

              <div style={{ display: "flex", gap: 12, marginTop: details.plot ? 4 : 20 }}>
                <Focusable id="series-hero-play">
                  <HeroPlayButton canResume={canResume} onPlay={onPlay} />
                </Focusable>
                <Focusable id="series-hero-favorite">
                  <HeroFavoriteButton isFavorited={isFavorited} onToggle={onToggleFavorite} />
                </Focusable>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Wraps PillButton with the hero's own focus id rather than relying on grid focus, since the hero sits above the episode grid in its own row. */
function HeroPlayButton({ canResume, onPlay }: { canResume: boolean; onPlay: () => void }): JSX.Element {
  const isFocused = useFocusStore((state) => state.focusedId === "series-hero-play");
  return (
    <PillButton isFocused={isFocused} onClick={onPlay}>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {canResume ? <RotateCcw size={16} /> : <Play size={16} fill="currentColor" />}
        {canResume ? "Resume" : "Play"}
      </span>
    </PillButton>
  );
}

function HeroFavoriteButton({ isFavorited, onToggle }: { isFavorited: boolean; onToggle: () => void }): JSX.Element {
  const isFocused = useFocusStore((state) => state.focusedId === "series-hero-favorite");
  return (
    <PillButton isFocused={isFocused} onClick={onToggle}>
      {isFavorited ? "✓ My List" : "+ My List"}
    </PillButton>
  );
}

interface SeasonTabsProps {
  seasons: number[];
  activeSeason: number | null;
  onSelect: (season: number) => void;
}

/**
 * Netflix-style horizontal pill row for picking which season's episodes are
 * shown below. Purely a rendering component — its focus nodes are built
 * alongside the hero/episode grid's in the parent's single consolidated
 * effect so up/down chains correctly across all three rows (see that
 * effect's comment).
 */
function SeasonTabs({ seasons, activeSeason, onSelect }: SeasonTabsProps): JSX.Element {
  const focusedId = useFocusStore((state) => state.focusedId);

  if (seasons.length <= 1) return <></>;

  return (
    <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
      {seasons.map((season) => {
        const id = `season-tab:${season}`;
        const isFocused = focusedId === id;
        const isActive = activeSeason === season;
        return (
          <Focusable key={id} id={id}>
            <button
              type="button"
              onClick={() => onSelect(season)}
              style={{
                padding: "8px 20px",
                borderRadius: 999,
                border: "1px solid " + (isFocused ? "rgba(255,255,255,0.6)" : "transparent"),
                background: isActive ? "var(--text, #f4f4f6)" : "var(--surface-raised, #24242c)",
                color: isActive ? "#0b0b0f" : "var(--text, #f4f4f6)",
                fontWeight: 700,
                fontSize: 17,
                transform: isFocused ? "scale(1.06)" : "scale(1)",
                transition: "transform 120ms ease-out",
                whiteSpace: "nowrap",
              }}
            >
              Season {season}
            </button>
          </Focusable>
        );
      })}
    </div>
  );
}

/** Wide 16:9 episode tile with number, title, duration, and synopsis — Netflix's episode-list style, versus the old poster-shaped FocusCard grid. */
function EpisodeCard({ episode, onSelect }: { episode: SeriesEpisode; onSelect: () => void }): JSX.Element {
  const isFocused = useFocusStore((state) => state.focusedId === episode.id);
  const minutes = episode.durationSeconds ? Math.round(episode.durationSeconds / 60) : undefined;

  return (
    <Focusable id={episode.id}>
      <div
        onClick={onSelect}
        role="button"
        tabIndex={-1}
        style={{
          cursor: "pointer",
          borderRadius: 12,
          overflow: "hidden",
          background: "var(--surface, #1a1a20)",
          boxShadow: isFocused ? "0 0 0 3px var(--accent, #38bdf8), 0 12px 28px rgba(0,0,0,0.5)" : "0 4px 10px rgba(0,0,0,0.3)",
          transform: isFocused ? "scale(1.03)" : "scale(1)",
          transition: "transform 160ms ease-out, box-shadow 160ms ease-out",
        }}
      >
        <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", background: "#0f0f13" }}>
          {episode.posterUrl ? (
            <img src={episode.posterUrl} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          ) : (
            <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#8b8b93" }}>
              <Play size={28} />
            </div>
          )}
          {minutes && (
            <span
              style={{
                position: "absolute",
                bottom: 8,
                right: 8,
                background: "rgba(0,0,0,0.7)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                padding: "4px 9px",
                borderRadius: 6,
              }}
            >
              {minutes}m
            </span>
          )}
        </div>
        <div style={{ padding: "14px 16px" }}>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 5 }}>
            E{episode.episode}. {episode.title}
          </div>
          {episode.plot && (
            <p
              style={{
                fontSize: 14,
                color: "var(--text-dim)",
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
      </div>
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
  const isFocused = useFocusStore((state) => state.focusedId === SEARCH_INPUT_ID);

  return (
    <Focusable id={SEARCH_INPUT_ID}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          padding: "10px 16px",
          borderRadius: 999,
          border: isFocused ? "1px solid rgba(255,255,255,0.6)" : "1px solid rgba(255,255,255,0.16)",
          background: "rgba(28,28,34,0.7)",
          ...glassBlur("blur(16px) saturate(140%)"),
          boxShadow: isFocused ? "0 0 0 3px var(--accent, #38bdf8)" : undefined,
          transition: "box-shadow 160ms ease-out, border-color 160ms ease-out",
        }}
      >
        <Search size={18} color="var(--text-dim, #9a9aa4)" style={{ flexShrink: 0 }} />
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
            fontSize: 16,
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
            <X size={16} />
          </button>
        )}
      </div>
    </Focusable>
  );
});
