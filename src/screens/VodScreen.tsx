import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Channel, PlatformId, PlaylistSource, Profile } from "@core";
import { Search, X } from "lucide-react";
import {
  CategoryRail,
  categoryRailItemId,
  SeeAllCard,
  FavoriteHeart,
  Focusable,
  MeshBackground,
  FocusCard,
  Shelf,
  ShelfRowSkeleton,
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
  SECTION_ICONS,
} from "@ui";
import { loadChannelsByKind, loadVodCategories } from "../content-loader.js";
import { loadFavorites, toggleFavorite } from "../profile-store.js";
import { useSearchQuery } from "../use-debounced-value.js";
import { useIncrementalList } from "../use-incremental-list.js";
import { useCachedContent } from "../use-cached-content.js";
import { useVodCatalogPage } from "../use-catalog-page.js";
import { startCatalogBackgroundSync } from "../catalog-sync.js";
import { useLocalCatalogReady } from "../use-local-catalog-ready.js";
import { useCatalogShelves } from "../use-catalog-shelves.js";
import { getCatalogPage } from "../catalog-store.js";
import { useFavoritesRevision } from "../use-favorites-revision.js";

export interface VodScreenProps {
  source: PlaylistSource;
  platform: PlatformId;
  profile: Profile;
  onPlay: (movie: Channel) => void;
  onBack: () => void;
  /** True while PlayerScreen is open on top of this screen — disables this screen's own useRemoteInput so a single Back press doesn't both close the player and navigate this screen away. */
  isPlaybackOpen?: boolean;
}

const EMPTY_MOVIES: Channel[] = [];
const EMPTY_CATEGORIES: Awaited<ReturnType<typeof loadVodCategories>> = [];
const CONTENT_ENTRY_SCOPE = "content";
const ALL_CATEGORIES_ID = "__all__";
const gridItemId = (movieId: string) => `vod-grid:${movieId}`;
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
const SEARCH_INPUT_ID = "vod-search-input";
/** Legacy-path shelves are capped like the local-table path's (see use-catalog-shelves.ts's SHELF_SIZE); the full category is one dropdown pick away. */
const LEGACY_SHELF_LIMIT = 20;

/**
 * Groups movies into shelves by category, labeling each shelf with the real
 * category name rather than the raw category_id that Channel.groupTitle
 * actually holds (see XtreamClient.getVodStreams — groupTitle is
 * s.category_id, not a display name — same quirk SeriesScreen's
 * groupByCategory works around). categoryNameById comes from the separate
 * get_vod_categories call; a category missing from it (or an M3U source,
 * which has none at all) falls back to the id itself so the shelf still
 * gets *a* label instead of being blank.
 */
function groupByCategory(movies: Channel[], categoryNameById: Map<string, string>, limitPerShelf: number): Array<{ id: string; title: string; items: Channel[] }> {
  const byGroup = new Map<string, Channel[]>();
  for (const movie of movies) {
    const key = movie.groupTitle ?? "Movies";
    const list = byGroup.get(key);
    if (!list) byGroup.set(key, [movie]);
    else if (list.length < limitPerShelf) list.push(movie);
  }
  return Array.from(byGroup.entries()).map(([id, items]) => ({ id, title: categoryNameById.get(id) ?? id, items }));
}

export function VodScreen({ source, platform, profile, onPlay, onBack, isPlaybackOpen = false }: VodScreenProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const [activeCategoryId, setActiveCategoryId] = useState(() => lastCategoryBySource.get(source.id) ?? ALL_CATEGORIES_ID);
  useEffect(() => {
    lastCategoryBySource.set(source.id, activeCategoryId);
  }, [source.id, activeCategoryId]);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // The query that actually runs: debounced and ignored below 2 characters
  // (see useSearchQuery), so typing doesn't refilter/re-render the catalog
  // on every keystroke. searchQuery itself only drives the input's text.
  const trimmedQuery = useSearchQuery(searchQuery);
  const isAllCategories = activeCategoryId === ALL_CATEGORIES_ID;

  // Once catalog-sync.ts has completed at least one background sync for this
  // source, every read below comes from the local paginated table
  // (use-catalog-page.ts/use-catalog-shelves.ts) instead of a live
  // player_api.php fetch — see those hooks' doc comments. A brand-new source
  // that's never synced yet ("not-synced") falls back to the pre-existing
  // full-catalog fetch path (the useCachedContent calls further down) so it
  // isn't blocked on a first sync it hasn't had time to run. While the
  // check itself is still in flight ("checking"), *neither* path fetches —
  // see use-local-catalog-ready.ts's doc comment for why a plain
  // defaults-to-false boolean would wrongly fire the legacy fetch on every
  // mount, even for a source that turns out to already be synced.
  const localCatalogStatus = useLocalCatalogReady(source.id, "vod");

  // Builds (first visit) or refreshes (daily) this screen's local catalog
  // table while the screen is open. Until the first sync lands the screen
  // runs on the capped legacy path below; once it does, the sync bumps
  // useLocalCatalogReady's version and the screen switches to the local
  // paginated reads without remounting.
  useEffect(() => startCatalogBackgroundSync(() => source, ["vod"]), [source]);
  const isLocalCatalogReady = localCatalogStatus === "ready";
  const isCheckingLocalCatalog = localCatalogStatus === "checking";

  // The "All Categories" shelf browser and search both need the whole
  // catalog (building N shelves, or searching across everything, both need
  // every movie in hand) — but a single selected category doesn't, so this
  // fetch is skipped (enabled: false) while one is active and no search is
  // in progress, which is exactly when the category-scoped fetch below runs
  // instead. This is what makes browsing straight into one category, on a
  // catalog nobody has ever fully loaded this session, avoid a full-catalog
  // fetch entirely. Only relevant to the legacy fallback path — the local
  // table never needs to hold the full catalog in memory at all.
  const needsFullCatalog = localCatalogStatus === "not-synced" && (isAllCategories || trimmedQuery.length > 0);
  const load = useCallback(() => loadChannelsByKind(source, "movie"), [source]);
  const {
    data: legacyMovies,
    isInitialLoading: isLegacyMoviesLoading,
    error,
    isStale,
  } = useCachedContent(`vod:${source.id}`, "catalog", load, EMPTY_MOVIES, { enabled: needsFullCatalog });

  // Powers the single-category grid on the legacy fallback path: fetched
  // straight from the provider's server-side category filter (see
  // content-loader.ts's categoryId passthrough) rather than derived by
  // filtering the full catalog, so selecting one category never depends on
  // the full catalog having been fetched at all.
  const loadCategoryMovies = useCallback(
    () => loadChannelsByKind(source, "movie", isAllCategories ? undefined : activeCategoryId),
    [source, isAllCategories, activeCategoryId],
  );
  const { data: legacyCategoryMovies, isInitialLoading: isLegacyCategoryLoading } = useCachedContent(
    isAllCategories ? "vod:none" : `vod:${source.id}:cat:${activeCategoryId}`,
    "catalog",
    loadCategoryMovies,
    EMPTY_MOVIES,
    { enabled: localCatalogStatus === "not-synced" && !isAllCategories },
  );

  // Local-table path: paginated grid/search reads, grown on demand (see
  // use-catalog-page.ts) — this is what lets the grid render 100k+ catalogs
  // without ever holding them all in memory.
  const {
    items: localGridMovies,
    isInitialLoading: isLocalGridLoading,
    hasMore: localGridHasMore,
    loadMore: loadMoreLocalGrid,
    total: localGridTotal,
  } = useVodCatalogPage(source.id, {
    categoryId: isAllCategories ? undefined : activeCategoryId,
    namePrefix: trimmedQuery || undefined,
    enabled: isLocalCatalogReady && (!isAllCategories || trimmedQuery.length > 0),
  });

  // Fixed TV poster density (see tv-metrics.ts) — the grid and the D-pad focus graph share this column count.
  const gridColumns = POSTER_COLUMNS;

  const loadCategories = useCallback(() => loadVodCategories(source), [source]);
  const { data: categories } = useCachedContent(`vod-categories:${source.id}`, "category", loadCategories, EMPTY_CATEGORIES);

  // Bumped on every favourite toggle to force each FocusCard's heart badge
  // to re-render — see LiveTvScreen's identical comment for why this is
  // needed (toggleFavorite persists to localStorage but isn't itself
  // reactive state).
  const [favoritesVersion, setFavoritesVersion] = useState(0);
  const favoritesRevision = useFavoritesRevision(); // My List changed elsewhere (e.g. from the player)
  // Read once per toggle rather than once per card per render (each lookup
  // parses the whole favourites list from localStorage).
  const favoriteMovieIds = useMemo(() => {
    void favoritesVersion;
    return new Set(
      loadFavorites(profile.id)
        .filter((f) => f.sourceId === source.id && f.contentKind === "movie")
        .map((f) => f.contentId),
    );
  }, [profile.id, source.id, favoritesVersion, favoritesRevision]);

  const categoryNameById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  // "All Categories" shelf browser, local-table path: one bounded query per
  // category (see use-catalog-shelves.ts) instead of loading the whole
  // catalog and grouping it client-side.
  const mapShelfPage = useCallback((categoryId: string, limit: number) => getCatalogPage(source.id, "vod", { categoryId, offset: 0, limit }), [source.id]);
  const { shelves: localShelves, isLoading: isLocalShelvesLoading } = useCatalogShelves(
    source.id,
    "vod",
    categories,
    mapShelfPage,
    isLocalCatalogReady && isAllCategories && !trimmedQuery,
  );

  // Legacy fallback path's shelves — only ever needs the full catalog (there's
  // no per-shelf lazy fetch), so this naturally reads [] while a single
  // category is selected, which is fine since shelves aren't rendered in
  // that mode anyway (see gridMovies/the render branch below).
  const legacyShelves = useMemo(() => groupByCategory(legacyMovies, categoryNameById, LEGACY_SHELF_LIMIT), [legacyMovies, categoryNameById]);
  const shelves = isLocalCatalogReady ? localShelves : legacyShelves;

  // "All Categories" row's count is only meaningful on the legacy fallback
  // path (the full array is in hand there); the local-table path shows no
  // count for it rather than paying for a full-table count query just for
  // this label — categories' own per-category counts were never shown
  // either (count: undefined below), so this isn't a regression in what's
  // actually rendered (see CategoryRail's item type).
  const categoryItems = useMemo(
    () => [
      { id: ALL_CATEGORIES_ID, label: "Browse", count: isLocalCatalogReady ? undefined : legacyMovies.length },
      ...categories.map((c) => ({ id: c.id, label: c.name, count: undefined as number | undefined })),
    ],
    [isLocalCatalogReady, legacyMovies.length, categories],
  );
  const activeCategoryLabel = categoryItems.find((c) => c.id === activeCategoryId)?.label ?? "Browse";

  // A category other than "All Categories", or a non-empty search query,
  // replaces the shelf browser with a single flat, vertically-scrolling
  // grid — same behavior as SeriesScreen's browse page. Search takes
  // priority over the category filter when both are active, searching
  // within the selected category rather than across all movies. On the
  // legacy fallback path this filters an already-fetched array in memory;
  // on the local-table path (localGridMovies) the filtering already
  // happened inside useVodCatalogPage's IndexedDB query, so this is just
  // picking which source to read.
  const legacyGridMovies = useMemo(() => {
    const withinCategory = isAllCategories ? legacyMovies : legacyCategoryMovies;
    if (trimmedQuery) return withinCategory.filter((item) => item.name.toLowerCase().includes(trimmedQuery));
    return isAllCategories ? null : withinCategory;
  }, [isAllCategories, legacyCategoryMovies, legacyMovies, trimmedQuery]);
  // The legacy path has the whole category/search result in memory, but
  // renders it a page at a time like the local-table path does — mounting
  // thousands of cards at once is what made category picks and search lag.
  const legacyGridPage = useIncrementalList(isLocalCatalogReady ? null : legacyGridMovies);
  const gridMovies = isLocalCatalogReady ? (isAllCategories && !trimmedQuery ? null : localGridMovies) : (legacyGridPage?.visible ?? null);
  const gridHasMore = isLocalCatalogReady ? localGridHasMore : (legacyGridPage?.hasMore ?? false);
  const loadMoreGrid = isLocalCatalogReady ? loadMoreLocalGrid : legacyGridPage?.loadMore;

  const isInitialLoading = isCheckingLocalCatalog
    ? true
    : isLocalCatalogReady
      ? isAllCategories && !trimmedQuery
        ? isLocalShelvesLoading
        : isLocalGridLoading
      : isAllCategories
        ? isLegacyMoviesLoading
        : isLegacyCategoryLoading;

  // isInitialLoading briefly flips true again on the local-table path every
  // time the query changes (each keystroke while searching, or picking a
  // new category) — useVodCatalogPage's own isInitialLoading resets for
  // each new filter, unlike the legacy path where search/category
  // switching only ever re-filters an already-fetched in-memory array.
  // Gating the *entire* screen (including the search input the user is
  // mid-keystroke in, and the category dropdown) on that would unmount and
  // reset them on every character typed — hasEverShownContent latches once
  // the shell has rendered at least once, so only the true first paint
  // (nothing to show at all yet) blocks on the full-screen skeleton; a
  // requery after that renders the existing shell with an in-place grid
  // loading state instead (see the grid's own isInitialLoading check below).
  const hasEverShownContentRef = useRef(false);
  if (!isInitialLoading) hasEverShownContentRef.current = true;
  const showFullScreenSkeleton = isInitialLoading && !hasEverShownContentRef.current;

  // Header for the content area: the category (or search) being shown and,
  // for a single category, how many titles it holds.
  const headerTitle = trimmedQuery ? `Results for "${trimmedQuery}"` : isAllCategories ? "Movies" : activeCategoryLabel;
  const headerCount = gridMovies ? (isLocalCatalogReady ? localGridTotal : legacyGridMovies?.length) : null;

  const firstContentId = gridMovies ? (gridMovies[0] ? gridItemId(gridMovies[0].id) : undefined) : shelves[0]?.items[0]?.id;
  const firstContentIdRef = useRef(firstContentId);
  firstContentIdRef.current = firstContentId;
  const activeCategoryIdRef = useRef(activeCategoryId);
  activeCategoryIdRef.current = activeCategoryId;
  // Set when a category is picked from the rail (or a "See all" card), so
  // focus follows into the new content once its focus graph registers —
  // see the browse graph effect below.
  const focusContentOnNextGraphRef = useRef(false);

  const selectCategory = useCallback((id: string) => {
    if (id === activeCategoryIdRef.current) {
      // Already showing: just hand focus back to the content.
      const first = firstContentIdRef.current;
      if (first) useFocusStore.getState().focus(first);
      return;
    }
    focusContentOnNextGraphRef.current = true;
    setActiveCategoryId(id);
  }, []);

  /** Moves focus into the category rail (which expands it), leaving the search box's native focus if it had it. */
  const openCategoryRail = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    useFocusStore.getState().focus(categoryRailItemId(activeCategoryIdRef.current));
  }, []);

  // Search input's proxy focus node — see VodSearchInput's doc comment for
  // why a native <input> needs a Focusable stand-in rather than being a
  // spatial-nav node itself. Sits to the right of the category dropdown's
  // trigger in the same sticky bar.
  useEffect(() => {
    const node = { id: SEARCH_INPUT_ID, neighbors: { left: categoryRailItemId(activeCategoryId), down: firstContentId }, onSelect: () => searchInputRef.current?.focus() };
    setGraph("chrome:vod-search", [node], undefined, { passive: true });
  }, [activeCategoryId, firstContentId, setGraph, clearGraph]);
  // Rebuilds above replace the scope in place (setGraph is atomic); clearing
  // it on every rebuild would drop focus for an instant and snap it back to
  // the first node. Clear only when this component goes away.
  useEffect(() => () => clearGraph("chrome:vod-search"), [clearGraph]);


  // Browse mode's focus graph: either the shelf browser (one row per
  // category, plus a trailing "See all" card) or a single flat grid (one
  // category from the rail, or a search) — never both. Up from the top row
  // reaches the search box; Left from the first column opens the category
  // rail on the active category.
  useEffect(() => {
    const railEntryId = categoryRailItemId(activeCategoryId);
    const claimFocus = (id: string) => {
      if (!focusContentOnNextGraphRef.current) return;
      focusContentOnNextGraphRef.current = false;
      useFocusStore.getState().focus(id);
    };

    if (gridMovies) {
      const ids = gridMovies.map((item) => gridItemId(item.id));
      if (ids.length === 0) {
        setGraph(CONTENT_ENTRY_SCOPE, []);
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
  }, [shelves, gridMovies, gridColumns, activeCategoryId, selectCategory, setGraph, clearGraph]);

  // Rebuilds above replace the scope in place (setGraph is atomic); clearing
  // it on every rebuild would drop focus for an instant and snap it back to
  // the first node. Clear only when this component goes away.
  useEffect(() => () => clearGraph(CONTENT_ENTRY_SCOPE), [clearGraph]);


  // Grid mode's cards register under a gridItemId(...)-prefixed id (see its
  // effect above) so they can't collide with the same movie's id as used by
  // the shelf browser's own focus nodes if both were ever registered at
  // once — resolve back to the raw movie id here before lookups.
  const resolveMovieIdFromFocusId = useCallback((id: string) => (id.startsWith("vod-grid:") ? id.slice("vod-grid:".length) : id), []);

  // Grows the grid (local-table or legacy, see gridHasMore) as focus approaches its current end, rather
  // than requiring an explicit "Load more" button — the last full row (or
  // fewer, on a short final page) is treated as the trigger zone. This is
  // what keeps a paginated grid compatible with spatial navigation's need
  // for a concrete, finite id list (see use-catalog-page.ts's doc comment):
  // the graph only ever holds what's actually loaded, and grows a page at a
  // time just ahead of where the user is browsing.
  //
  // Subscribes to a boolean ("is focus in the trigger zone?") rather than
  // focusedId itself, so this screen — and its whole grid/shelf tree — only
  // re-renders when focus crosses into or out of the zone, not on every
  // D-pad press. gridMovies is an effect dependency so a page that lands
  // while focus is still in the zone immediately checks for the next one.
  const gridEndZoneIds = useMemo(
    () => (gridMovies ? new Set(gridMovies.slice(Math.max(0, gridMovies.length - gridColumns)).map((item) => gridItemId(item.id))) : null),
    [gridMovies, gridColumns],
  );
  const isFocusInGridEndZone = useFocusStore((state) => state.focusedId !== null && (gridEndZoneIds?.has(state.focusedId) ?? false));
  useEffect(() => {
    if (isFocusInGridEndZone && gridHasMore) loadMoreGrid?.();
  }, [isFocusInGridEndZone, gridMovies, gridHasMore, loadMoreGrid]);

  // Lookups (play/favourite/backdrop) need to search whichever list is
  // actually on screen — the local-table grid/shelves when synced, or the
  // legacy fallback's full catalog/category-scoped fetch otherwise (see
  // needsFullCatalog above).
  const visibleMovies = useMemo(() => gridMovies ?? shelves.flatMap((shelf) => shelf.items), [gridMovies, shelves]);

  useRemoteInput(
    platform,
    {
      onSelect: (id) => {
        if (!id) return;
        const movie = visibleMovies.find((m) => m.id === resolveMovieIdFromFocusId(id));
        if (movie) onPlay(movie);
      },
      onLongSelect: (id) => {
        if (!id) return;
        const movie = visibleMovies.find((m) => m.id === resolveMovieIdFromFocusId(id));
        if (!movie) return;
        toggleFavorite(profile.id, source.id, "movie", movie.id);
        setFavoritesVersion((v) => v + 1);
      },
      onBack: () => {
        // Back from the content opens the category rail first; Back from the
        // rail leaves the screen.
        if (useFocusStore.getState().focusedId?.startsWith("rail:")) onBack();
        else openCategoryRail();
      },
    },
    !isPlaybackOpen,
  );


  // The grid/shelves, memoised so screen-level state that doesn't change
  // them — the category menu opening/closing, each raw keystroke in the
  // search box — doesn't re-render every card on screen.
  const browseContent = useMemo(
    () => (
      <>
          {gridMovies ? (
            gridMovies.length === 0 ? (
              <p style={{ color: "var(--text-dim)", padding: `0 ${BROWSE_SIDE_PADDING} 0 ${BROWSE_CONTENT_LEFT}`, fontSize: TV_TEXT }}>
                {trimmedQuery ? `No movies match "${trimmedQuery}".` : "No movies in this category."}
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
                {gridMovies.map((item) => (
                  <FocusCard
                    placeholderIcon={SECTION_ICONS.movies}
                    key={item.id}
                    width="100%"
                    id={gridItemId(item.id)}
                    title={item.name}
                    imageUrl={item.logoUrl}
                    onSelect={() => onPlay(item)}
                    badge={<FavoriteHeart isFavorite={favoriteMovieIds.has(item.id)} />}
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
                    placeholderIcon={SECTION_ICONS.movies}
                    id={item.id}
                    width={POSTER_WIDTH}
                    title={item.name}
                    imageUrl={item.logoUrl}
                    onSelect={() => onPlay(item)}
                    badge={<FavoriteHeart isFavorite={favoriteMovieIds.has(item.id)} />}
                  />
                )}
              />
            ))
          )}
      </>
    ),
    [gridMovies, shelves, trimmedQuery, favoriteMovieIds, onPlay, selectCategory],
  );

  // Only a fetch failure with nothing to show at all is a hard error — a
  // failed background refresh with a good (possibly stale) cache hit
  // already in `movies` should keep rendering that content rather than
  // discarding a perfectly good screen (see useCachedContent's isStale doc
  // comment). isStale is available here if a "couldn't refresh" affordance
  // is wanted later; for now this just stops the false-positive hard error.
  if (error && isInitialLoading) {
    return (
      <MeshBackground>
        <div role="alert" style={{ padding: "3rem 3.5rem", fontSize: TV_TEXT, color: "var(--text)" }}>
          Failed to load movies: {error}
        </div>
      </MeshBackground>
    );
  }
  void isStale;

  if (showFullScreenSkeleton) {
    return (
      <MeshBackground>
        <ShelfRowSkeleton />
      </MeshBackground>
    );
  }


  return (
    // Same backdrop as Live TV and the Program Guide (static on TVs — see
    // MeshBackground), so every browse section reads as one app.
    <MeshBackground>
    {/* No top padding: the sticky bar's fade must start at the very top, or a strip of brighter background shows above it. */}
    <div style={{ paddingBottom: 40 }}>
      <CategoryRail
        title="Movies"
        items={categoryItems}
        activeId={activeCategoryId}
        onSelect={selectCategory}
        rightEntryId={firstContentId}
        sectionBreakAt={1}
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
          <VodSearchInput ref={searchInputRef} value={searchQuery} onChange={setSearchQuery} />
        </div>
      </div>

      {browseContent}
    </div>
    </MeshBackground>
  );
}

interface VodSearchInputProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Plain native <input> for filtering movies by title — same pattern as
 * SeriesScreen's SeriesSearchInput (see its doc comment for the full
 * rationale: text entry goes through the platform's on-screen keyboard once
 * the input has native focus, useRemoteInput steps aside from arrow
 * keys/Enter while a text field has focus, and the SEARCH_INPUT_ID
 * Focusable is a thin proxy that hands off to the real input via ref).
 */
const VodSearchInput = forwardRef<HTMLInputElement, VodSearchInputProps>(function VodSearchInput({ value, onChange }, ref) {
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
          placeholder="Search movies"
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
