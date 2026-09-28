import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Channel, PlatformId, PlaylistSource, Profile } from "@core";
import {
  CategoryRail,
  categoryRailItemId,
  SeeAllCard,
  FavoriteHeart,
  MeshBackground,
  FocusCard,
  Shelf,
  LoadingState,
  buildGridFocusGraph,
  buildShelfFocusGraph,
  useFocusStore,
  useRemoteInput,
  SearchButton,
  HeaderButton,
  Toast,
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
import { useIncrementalList } from "../use-incremental-list.js";
import { useCachedContent } from "../use-cached-content.js";
import { useVodCatalogPage } from "../use-catalog-page.js";
import { syncSource } from "../sync/sync-manager.js";
import { useSourceSyncState } from "../sync/sync-store.js";
import { frequentCategoryIds, recordCategoryUse, splitByFrequency } from "../category-usage-store.js";
import { useLocalCatalogReady } from "../use-local-catalog-ready.js";
import { useCatalogFreshness } from "../use-catalog-freshness.js";
import { useCatalogShelves } from "../use-catalog-shelves.js";
import { getCatalogPage } from "../catalog-store.js";
import { useFavoritesRevision } from "../use-favorites-revision.js";
import { useContentPolicy } from "../content-policy.js";
import { SyncNotice } from "./SyncNotice.js";

export interface VodScreenProps {
  source: PlaylistSource;
  platform: PlatformId;
  profile: Profile;
  onPlay: (movie: Channel) => void;
  onBack: () => void;
  /** Opens the global Search screen (the header's Search button). */
  onOpenSearch: () => void;
  /** True while PlayerScreen is open on top of this screen — disables this screen's own useRemoteInput so a single Back press doesn't both close the player and navigate this screen away. */
  isPlaybackOpen?: boolean;
}

const EMPTY_MOVIES: Channel[] = [];
const EMPTY_CATEGORIES: Awaited<ReturnType<typeof loadVodCategories>> = [];
const CONTENT_ENTRY_SCOPE = "content";
const ALL_CATEGORIES_ID = "__all__";
const gridItemId = (movieId: string) => `vod-grid:${movieId}`;
/**
 * The category each profile last browsed in each source, so coming back to
 * this screen (it remounts on every tab switch — see App.tsx) reopens where
 * the user was. Module-level on purpose: it should outlive the screen, not
 * an app restart. Per profile, so a Kids profile never reopens a category
 * a parent was browsing.
 */
const lastCategoryBySource = new Map<string, string>();

/** Test-only: forgets remembered categories so each test starts on Browse. */
export function __resetCategoryMemoryForTests(): void {
  lastCategoryBySource.clear();
}
/** Focus id of a shelf's trailing "See all" card. */
const seeAllId = (categoryId: string) => `seeall:${categoryId}`;
const SEARCH_BUTTON_ID = "vod-search-button";
const REFRESH_BUTTON_ID = "vod-refresh-button";

export function VodScreen({ source, platform, profile, onPlay, onBack, onOpenSearch, isPlaybackOpen = false }: VodScreenProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const memoryKey = `${profile.id}:${source.id}`;
  const [activeCategoryId, setActiveCategoryId] = useState(() => lastCategoryBySource.get(memoryKey) ?? ALL_CATEGORIES_ID);
  useEffect(() => {
    lastCategoryBySource.set(memoryKey, activeCategoryId);
  }, [memoryKey, activeCategoryId]);
  // Kids profiles only see what the content policy allows (docs/kids-profile.md §6); a standard profile's policy passes everything.
  const policy = useContentPolicy(profile, source.id);
  const isAllCategories = activeCategoryId === ALL_CATEGORIES_ID;

  // Every read below comes from the local movie table (use-catalog-page.ts/
  // use-catalog-shelves.ts), which the sync manager builds and refreshes —
  // this screen never downloads the whole catalog itself. While the
  // existence check is in flight ("checking") nothing is shown; a source
  // whose table hasn't been built yet ("not-synced") asks the sync manager
  // for it (joining the launch sync if one is already running) and shows
  // its progress instead — see useLocalCatalogReady's doc comment.
  const localCatalogStatus = useLocalCatalogReady(source.id, "vod");
  const isLocalCatalogReady = localCatalogStatus === "ready";
  const isCheckingLocalCatalog = localCatalogStatus === "checking";
  const isAwaitingSync = localCatalogStatus === "not-synced";
  // An M3U playlist's movies come from the same download as its channels (see live-sync-core.ts).
  const syncStage = source.kind === "xtream" ? "vod" : "live";
  useEffect(() => {
    if (isAwaitingSync) void syncSource(source, { trigger: "first-run", stages: [syncStage] });
  }, [source, isAwaitingSync, syncStage]);
  const syncState = useSourceSyncState(source.id).stages[syncStage];

  // The one exception while the table is still being built: a single
  // category on an Xtream source, fetched with the provider's own
  // category_id filter — small, and it means picking a category isn't a
  // dead end during a first sync.
  // Never for a Kids profile: unfiltered provider data must not render while the table is built.
  const useCategoryFetch = isAwaitingSync && !isAllCategories && source.kind === "xtream" && !policy.isKids;
  const loadCategoryMovies = useCallback(
    () => loadChannelsByKind(source, "movie", isAllCategories ? undefined : activeCategoryId),
    [source, isAllCategories, activeCategoryId],
  );
  const {
    data: categoryFetchMovies,
    isInitialLoading: isCategoryFetchLoading,
    error,
  } = useCachedContent(isAllCategories ? "vod:none" : `vod:${source.id}:cat:${activeCategoryId}`, "catalog", loadCategoryMovies, EMPTY_MOVIES, {
    enabled: useCategoryFetch,
  });

  const loadCategories = useCallback(() => loadVodCategories(source), [source]);
  const { data: categories } = useCachedContent(`vod-categories:${source.id}`, "category", loadCategories, EMPTY_CATEGORIES);
  const visibleCategories = useMemo(() => policy.visibleCatalogCategories("vod", categories), [policy, categories]);
  const catalogFilter = useMemo(() => policy.catalogFilter("vod", categories), [policy, categories]);

  // Local-table path: paginated category grid reads, grown on demand (see
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
    filter: catalogFilter,
    enabled: isLocalCatalogReady && !isAllCategories,
  });

  // Fixed TV poster density (see tv-metrics.ts) — the grid and the D-pad focus graph share this column count.
  const gridColumns = POSTER_COLUMNS;


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

  // "All Categories" shelf browser: one bounded query per category (see
  // use-catalog-shelves.ts) instead of loading the whole catalog.
  const mapShelfPage = useCallback(
    (categoryId: string, limit: number) => getCatalogPage(source.id, "vod", { categoryId, offset: 0, limit, filter: catalogFilter }),
    [source.id, catalogFilter],
  );
  const { shelves, isLoading: isLocalShelvesLoading } = useCatalogShelves(
    source.id,
    "vod",
    visibleCategories,
    mapShelfPage,
    isLocalCatalogReady && isAllCategories,
  );

  // Most-opened categories first, under "Frequently used". Read once per
  // visit (the screen remounts on every tab switch) so the rail doesn't
  // reshuffle under the user while they browse.
  const frequentIds = useMemo(() => frequentCategoryIds(profile.id, source.id, "vod"), [profile.id, source.id]);
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

  // A category other than "All Categories" replaces the shelf browser with
  // a single flat, vertically-scrolling grid — same behavior as
  // SeriesScreen's browse page. The filtering happens inside
  // useVodCatalogPage's IndexedDB query; the category fetch (see
  // useCategoryFetch) is rendered a page at a time like the table path.
  // Searching is the Search screen's job (the header's Search button).
  const categoryFetchPage = useIncrementalList(useCategoryFetch ? categoryFetchMovies : null);
  const gridMovies = isLocalCatalogReady ? (isAllCategories ? null : localGridMovies) : (categoryFetchPage?.visible ?? null);
  const gridHasMore = isLocalCatalogReady ? localGridHasMore : (categoryFetchPage?.hasMore ?? false);
  const loadMoreGrid = isLocalCatalogReady ? loadMoreLocalGrid : categoryFetchPage?.loadMore;
  // The grid's query hasn't answered yet — a spinner, never a premature "No movies in this category".
  const isGridLoading = isLocalCatalogReady ? isLocalGridLoading : useCategoryFetch && isCategoryFetchLoading;
  const isShelvesLoading = isLocalCatalogReady && isLocalShelvesLoading && shelves.length === 0;

  // Nothing to browse yet: the table is still being built and this isn't the category-fetch exception.
  const showSyncNotice = isAwaitingSync && !useCategoryFetch;

  // Nothing to render until the local-catalog check answers. The screen's
  // shell (category rail, Search button, Back) is always up meanwhile — a
  // full-screen loader with nothing focusable left the user stuck while a
  // sync kept the table busy.
  const isInitialLoading = isCheckingLocalCatalog
    ? true
    : isLocalCatalogReady
      ? isAllCategories
        ? isLocalShelvesLoading
        : isLocalGridLoading
      : useCategoryFetch && isCategoryFetchLoading;

  // Header for the content area: the category being shown and,
  // for a single category, how many titles it holds.
  const headerTitle = isAllCategories ? "Movies" : activeCategoryLabel;
  const headerCount = gridMovies ? (isLocalCatalogReady ? localGridTotal : categoryFetchMovies.length) : null;
  // "Updated 3h ago", and a Refresh for the one category on screen.
  const freshness = useCatalogFreshness(source, "vod", isAllCategories ? undefined : activeCategoryId, isLocalCatalogReady);
  const { canRefresh, refresh: refreshCategory } = freshness;
  const headerDetail = [headerCount != null ? `${headerCount} ${headerCount === 1 ? "title" : "titles"}` : null, freshness.updatedLabel].filter(Boolean).join(" · ");

  const firstContentId = gridMovies ? (gridMovies[0] ? gridItemId(gridMovies[0].id) : undefined) : shelves[0]?.items[0]?.id;
  const firstContentIdRef = useRef(firstContentId);
  firstContentIdRef.current = firstContentId;
  const activeCategoryIdRef = useRef(activeCategoryId);
  activeCategoryIdRef.current = activeCategoryId;
  // Set when a category is picked from the rail (or a "See all" card), so
  // focus follows into the new content once its focus graph registers —
  // see the browse graph effect below.
  const focusContentOnNextGraphRef = useRef(false);
  // Set when focus was parked on the Search button because there was nothing else to hold it (still loading).
  const focusParkedRef = useRef(false);

  const selectCategory = useCallback((id: string) => {
    if (id === activeCategoryIdRef.current) {
      // Already showing: just hand focus back to the content.
      const first = firstContentIdRef.current;
      if (first) useFocusStore.getState().focus(first);
      return;
    }
    if (id !== ALL_CATEGORIES_ID) recordCategoryUse(profile.id, source.id, "vod", id);
    focusContentOnNextGraphRef.current = true;
    setActiveCategoryId(id);
  }, [profile.id, source.id]);

  /** Moves focus into the category rail (which expands it). */
  const openCategoryRail = useCallback(() => {
    useFocusStore.getState().focus(categoryRailItemId(activeCategoryIdRef.current));
  }, []);

  // The header's buttons, beside the title — Refresh (one category shown) then Search: Left toward the category rail, Down into the content.
  useEffect(() => {
    const railEntryId = categoryRailItemId(activeCategoryId);
    const search = { id: SEARCH_BUTTON_ID, neighbors: { left: canRefresh ? REFRESH_BUTTON_ID : railEntryId, down: firstContentId }, onSelect: onOpenSearch };
    const nodes = canRefresh
      ? [{ id: REFRESH_BUTTON_ID, neighbors: { left: railEntryId, right: SEARCH_BUTTON_ID, down: firstContentId }, onSelect: refreshCategory }, search]
      : [search];
    setGraph("chrome:vod-search", nodes, undefined, { passive: true });
  }, [activeCategoryId, firstContentId, onOpenSearch, canRefresh, refreshCategory, setGraph, clearGraph]);
  // Rebuilds above replace the scope in place (setGraph is atomic); clearing
  // it on every rebuild would drop focus for an instant and snap it back to
  // the first node. Clear only when this component goes away.
  useEffect(() => () => clearGraph("chrome:vod-search"), [clearGraph]);


  // Browse mode's focus graph: either the shelf browser (one row per
  // category, plus a trailing "See all" card) or a single flat grid (one
  // category from the rail) — never both. Up from the top row reaches the
  // Search button; Left from the first column opens the category
  // rail on the active category.
  useEffect(() => {
    const railEntryId = categoryRailItemId(activeCategoryId);
    const claimFocus = (id: string) => {
      const parked = focusParkedRef.current && useFocusStore.getState().focusedId === SEARCH_BUTTON_ID;
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
      if (focusedId !== null && !(focusParkedRef.current && focusedId === SEARCH_BUTTON_ID)) return;
      if (showSyncNotice) {
        focusParkedRef.current = false;
        useFocusStore.getState().focus(railEntryId);
        return;
      }
      useFocusStore.getState().focus(SEARCH_BUTTON_ID);
      focusParkedRef.current = true;
    };

    if (gridMovies) {
      const ids = gridMovies.map((item) => gridItemId(item.id));
      if (ids.length === 0) {
        setGraph(CONTENT_ENTRY_SCOPE, []);
        parkFocus();
        return;
      }
      const nodes = buildGridFocusGraph(ids, gridColumns).map((node, index) => ({
        ...node,
        neighbors: {
          ...node.neighbors,
          up: index < gridColumns ? SEARCH_BUTTON_ID : node.neighbors.up,
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
          up: index < rows[0].length ? SEARCH_BUTTON_ID : node.neighbors.up,
          left: rowStarts.has(node.id) ? railEntryId : node.neighbors.left,
        },
        onSelect: seeAllCategory ? () => selectCategory(seeAllCategory) : undefined,
      };
    });
    setGraph(CONTENT_ENTRY_SCOPE, nodes, rows[0][0]);
    claimFocus(rows[0][0]);
  }, [shelves, gridMovies, gridColumns, activeCategoryId, selectCategory, setGraph, clearGraph, showSyncNotice]);

  // Rebuilds above replace the scope in place (setGraph is atomic); clearing
  // it on every rebuild would drop focus for an instant and snap it back to
  // the first node. Clear only when this component goes away.
  useEffect(() => () => clearGraph(CONTENT_ENTRY_SCOPE), [clearGraph]);


  // Grid mode's cards register under a gridItemId(...)-prefixed id (see its
  // effect above) so they can't collide with the same movie's id as used by
  // the shelf browser's own focus nodes if both were ever registered at
  // once — resolve back to the raw movie id here before lookups.
  const resolveMovieIdFromFocusId = useCallback((id: string) => (id.startsWith("vod-grid:") ? id.slice("vod-grid:".length) : id), []);

  // Grows the grid (local table or category fetch, see gridHasMore) as focus approaches its current end, rather
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

  // Lookups (play/favourite) look in whichever list is actually on screen.
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
  // them — e.g. the category menu opening/closing — doesn't re-render every
  // card on screen.
  const browseContent = useMemo(
    () => (
      <>
          {showSyncNotice ? (
            <SyncNotice what="movies" state={syncState} canPickCategory={source.kind === "xtream"} />
          ) : isCheckingLocalCatalog || (gridMovies && isGridLoading) || (!gridMovies && isShelvesLoading) ? (
            <LoadingState centered showSlowHint={useCategoryFetch} />
          ) : gridMovies ? (
            gridMovies.length === 0 ? (
              <p style={{ color: "var(--text-dim)", padding: `0 ${BROWSE_SIDE_PADDING} 0 ${BROWSE_CONTENT_LEFT}`, fontSize: TV_TEXT }}>
                No movies in this category.
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
    [gridMovies, shelves, favoriteMovieIds, onPlay, selectCategory, showSyncNotice, syncState, source.kind, isGridLoading, isShelvesLoading, isCheckingLocalCatalog, useCategoryFetch],
  );

  // Only a category fetch that failed with nothing to show is a hard error.
  if (error && isInitialLoading) {
    return (
      <MeshBackground>
        <div role="alert" style={{ padding: "3rem 3.5rem", fontSize: TV_TEXT, color: "var(--text)" }}>
          Failed to load movies: {error}
        </div>
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
        sections={railSections}
      />

      {/* Sticky so the title and Search button stay visible while shelves or a long grid scroll underneath, instead of scrolling away with the content. */}
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
          // bar stay out of the title while the mesh still shows.
          background: "linear-gradient(180deg, rgba(8,9,11,0.85) 0%, rgba(8,9,11,0.6) 65%, rgba(8,9,11,0) 100%)",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "2.25rem", fontWeight: 800, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{headerTitle}</div>
          {headerDetail && (
            <div style={{ fontSize: "1.125rem", fontWeight: 500, color: "var(--text-dim)", marginTop: "0.25rem" }}>{headerDetail}</div>
          )}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: BROWSE_GAP }}>
          {canRefresh && (
            <HeaderButton
              id={REFRESH_BUTTON_ID}
              label={freshness.isRefreshing ? "Refreshing…" : "Refresh"}
              icon={RefreshCw}
              busy={freshness.isRefreshing}
              onSelect={refreshCategory}
            />
          )}
          <SearchButton id={SEARCH_BUTTON_ID} onSelect={onOpenSearch} />
        </div>
      </div>

      {browseContent}
    </div>
    {freshness.result && <Toast message={freshness.result.message} tone={freshness.result.tone} onDismiss={freshness.dismissResult} />}
    </MeshBackground>
  );
}
