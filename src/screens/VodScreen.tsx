import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Channel, PlatformId, PlaylistSource, Profile } from "@core";
import { Search, X } from "lucide-react";
import {
  CATEGORY_DROPDOWN_TRIGGER_ID,
  CategoryDropdown,
  FavoriteHeart,
  Focusable,
  FocusTrackingBackdrop,
  FocusCard,
  Shelf,
  ShelfRowSkeleton,
  buildGridFocusGraph,
  buildShelfFocusGraph,
  useFocusStore,
  useRemoteInput,
  glassBlur,
} from "@ui";
import { loadChannelsByKind, loadVodCategories } from "../content-loader.js";
import { toggleFavorite, isFavorite as checkIsFavorite } from "../profile-store.js";
import { useCachedContent } from "../use-cached-content.js";
import { useVodCatalogPage } from "../use-catalog-page.js";
import { useLocalCatalogReady } from "../use-local-catalog-ready.js";
import { useCatalogShelves } from "../use-catalog-shelves.js";
import { getCatalogPage } from "../catalog-store.js";

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
const GRID_GAP = 16; // matches Shelf's card-to-card gap, so the single-category grid reads the same as the "All Categories" shelf rows.
const GRID_CARD_WIDTH = 220; // FocusCard's own default width — the grid packs cards at this fixed size via auto-fill rather than stretching them, see its gridTemplateColumns comment.
const GRID_SIDE_PADDING = 40; // matches the grid's own left+right padding below.

/**
 * How many cards actually fit per row in the auto-fill grid below, computed
 * the same way the browser's own grid layout would — see SeriesScreen's
 * identical computeGridColumns for the full rationale (buildGridFocusGraph
 * needs a concrete column count, and auto-fill's real column count depends
 * on viewport width rather than a fixed constant this code also controls).
 */
function computeGridColumns(): number {
  const available = window.innerWidth - GRID_SIDE_PADDING * 2;
  return Math.max(1, Math.floor((available + GRID_GAP) / (GRID_CARD_WIDTH + GRID_GAP)));
}
const gridItemId = (movieId: string) => `vod-grid:${movieId}`;
const TRIGGER_UP_TARGET = CATEGORY_DROPDOWN_TRIGGER_ID;
const SEARCH_INPUT_ID = "vod-search-input";

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
function groupByCategory(movies: Channel[], categoryNameById: Map<string, string>): Array<{ id: string; title: string; items: Channel[] }> {
  const byGroup = new Map<string, Channel[]>();
  for (const movie of movies) {
    const key = movie.groupTitle ?? "Movies";
    const list = byGroup.get(key);
    if (list) list.push(movie);
    else byGroup.set(key, [movie]);
  }
  return Array.from(byGroup.entries()).map(([id, items]) => ({ id, title: categoryNameById.get(id) ?? id, items }));
}

export function VodScreen({ source, platform, profile, onPlay, onBack, isPlaybackOpen = false }: VodScreenProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const [activeCategoryId, setActiveCategoryId] = useState(ALL_CATEGORIES_ID);
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const trimmedQuery = searchQuery.trim().toLowerCase();
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
  } = useVodCatalogPage(source.id, {
    categoryId: isAllCategories ? undefined : activeCategoryId,
    namePrefix: trimmedQuery || undefined,
    enabled: isLocalCatalogReady && (!isAllCategories || trimmedQuery.length > 0),
  });

  const gridColumns = useMemo(() => computeGridColumns(), []);

  const loadCategories = useCallback(() => loadVodCategories(source), [source]);
  const { data: categories } = useCachedContent(`vod-categories:${source.id}`, "category", loadCategories, EMPTY_CATEGORIES);

  // Bumped on every favourite toggle to force each FocusCard's heart badge
  // to re-render — see LiveTvScreen's identical comment for why this is
  // needed (toggleFavorite persists to localStorage but isn't itself
  // reactive state).
  const [favoritesVersion, setFavoritesVersion] = useState(0);

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
  const legacyShelves = useMemo(() => groupByCategory(legacyMovies, categoryNameById), [legacyMovies, categoryNameById]);
  const shelves = isLocalCatalogReady ? localShelves : legacyShelves;

  // "All Categories" row's count is only meaningful on the legacy fallback
  // path (the full array is in hand there); the local-table path shows no
  // count for it rather than paying for a full-table count query just for
  // this label — categories' own per-category counts were never shown
  // either (count: undefined below), so this isn't a regression in what's
  // actually rendered (see CategoryDropdown's item type).
  const categoryItems = useMemo(
    () => [
      { id: ALL_CATEGORIES_ID, label: "All Categories", count: isLocalCatalogReady ? undefined : legacyMovies.length },
      ...categories.map((c) => ({ id: c.id, label: c.name, count: undefined as number | undefined })),
    ],
    [isLocalCatalogReady, legacyMovies.length, categories],
  );
  const activeCategoryLabel = categoryItems.find((c) => c.id === activeCategoryId)?.label ?? "All Categories";

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
  const gridMovies = isLocalCatalogReady ? (isAllCategories && !trimmedQuery ? null : localGridMovies) : legacyGridMovies;

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

  // Search input's proxy focus node — see VodSearchInput's doc comment for
  // why a native <input> needs a Focusable stand-in rather than being a
  // spatial-nav node itself. Sits to the right of the category dropdown's
  // trigger in the same sticky bar.
  useEffect(() => {
    const node = { id: SEARCH_INPUT_ID, neighbors: { left: TRIGGER_UP_TARGET }, onSelect: () => searchInputRef.current?.focus() };
    setGraph("chrome:vod-search", [node]);
    return () => clearGraph("chrome:vod-search");
  }, [setGraph, clearGraph]);

  // Browse mode's focus graph: either the shelf browser (one row per
  // category, "All Categories") or a single flat grid (one category picked
  // from the dropdown, or a search in progress) — never both, so only one
  // of these branches ever runs. The top row's "up" links back to the
  // category dropdown's trigger so it's always reachable by pressing Up
  // from the very first row, regardless of which mode is showing.
  useEffect(() => {
    if (isCategoryDropdownOpen) return;

    if (gridMovies) {
      const ids = gridMovies.map((item) => gridItemId(item.id));
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
  }, [shelves, gridMovies, isCategoryDropdownOpen, gridColumns, setGraph, clearGraph]);

  // Grid mode's cards register under a gridItemId(...)-prefixed id (see its
  // effect above) so they can't collide with the same movie's id as used by
  // the shelf browser's own focus nodes if both were ever registered at
  // once — resolve back to the raw movie id here before lookups.
  const resolveMovieIdFromFocusId = useCallback((id: string) => (id.startsWith("vod-grid:") ? id.slice("vod-grid:".length) : id), []);

  // Grows the local-table grid as focus approaches its current end, rather
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
    if (isFocusInGridEndZone && localGridHasMore) loadMoreLocalGrid();
  }, [isFocusInGridEndZone, gridMovies, localGridHasMore, loadMoreLocalGrid]);

  // Lookups (play/favourite/backdrop) need to search whichever list is
  // actually on screen — the local-table grid/shelves when synced, or the
  // legacy fallback's full catalog/category-scoped fetch otherwise (see
  // needsFullCatalog above).
  const visibleMovies = useMemo(() => gridMovies ?? shelves.flatMap((shelf) => shelf.items), [gridMovies, shelves]);
  const logoUrlByMovieId = useMemo(() => new Map(visibleMovies.map((movie) => [movie.id, movie.logoUrl])), [visibleMovies]);
  const getBackdropUrl = useCallback(
    (focusedId: string | null) => (focusedId ? logoUrlByMovieId.get(resolveMovieIdFromFocusId(focusedId)) : undefined),
    [logoUrlByMovieId, resolveMovieIdFromFocusId],
  );

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
        if (isCategoryDropdownOpen) setIsCategoryDropdownOpen(false);
        else onBack();
      },
    },
    !isPlaybackOpen,
  );


  // Only a fetch failure with nothing to show at all is a hard error — a
  // failed background refresh with a good (possibly stale) cache hit
  // already in `movies` should keep rendering that content rather than
  // discarding a perfectly good screen (see useCachedContent's isStale doc
  // comment). isStale is available here if a "couldn't refresh" affordance
  // is wanted later; for now this just stops the false-positive hard error.
  if (error && isInitialLoading) return <div role="alert">Failed to load movies: {error}</div>;
  void isStale;

  if (showFullScreenSkeleton) return <ShelfRowSkeleton />;

  const firstContentId = gridMovies ? (gridMovies[0] ? gridItemId(gridMovies[0].id) : undefined) : shelves[0]?.items[0]?.id;

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
          <VodSearchInput ref={searchInputRef} value={searchQuery} onChange={setSearchQuery} />
        </div>
      </div>

      {gridMovies ? (
        gridMovies.length === 0 ? (
          <p style={{ color: "var(--text-dim)", padding: "0 40px" }}>
            {trimmedQuery ? `No movies match "${searchQuery.trim()}".` : "No movies in this category."}
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(auto-fill, ${GRID_CARD_WIDTH}px)`,
              gap: GRID_GAP,
              padding: `0 ${GRID_SIDE_PADDING}px`,
            }}
          >
            {gridMovies.map((item) => (
              <FocusCard
                key={item.id}
                id={gridItemId(item.id)}
                title={item.name}
                imageUrl={item.logoUrl}
                onSelect={() => onPlay(item)}
                badge={
                  <FavoriteHeart
                    isFavorite={(() => {
                      void favoritesVersion; // re-evaluate on every toggle — see favoritesVersion's declaration
                      return checkIsFavorite(profile.id, source.id, "movie", item.id);
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
                imageUrl={item.logoUrl}
                onSelect={() => onPlay(item)}
                badge={
                  <FavoriteHeart
                    isFavorite={(() => {
                      void favoritesVersion; // re-evaluate on every toggle — see favoritesVersion's declaration
                      return checkIsFavorite(profile.id, source.id, "movie", item.id);
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
          placeholder="Search movies"
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
