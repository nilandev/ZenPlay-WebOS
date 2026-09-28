import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Channel, PlatformId, PlaylistSource, Profile, SeriesInfo, WatchHistoryEntry } from "@core";
import { Search } from "lucide-react";
import {
  FocusCard,
  Focusable,
  LoadingState,
  MeshBackground,
  SearchKeyboard,
  SECTION_ICONS,
  SeeAllCard,
  Shelf,
  buildGridFocusGraph,
  buildShelfFocusGraph,
  searchKeyId,
  useFocusStore,
  useIsFocused,
  useRemoteInput,
  BROWSE_GAP,
  BROWSE_ROW_GAP,
  TV_HEADING,
  TV_TEXT,
  type FocusNode,
} from "@ui";
import { withChannelNumbers, type ChannelLineup } from "../channel-lineup.js";
import { loadSeriesCategories, loadVodCategories } from "../content-loader.js";
import { useContentPolicy } from "../content-policy.js";
import { loadWatchHistory } from "../profile-store.js";
import { loadRecentSearches, recordRecentSearch } from "../search/recent-searches.js";
import { searchCatalog, searchChannels, type SearchCatalogResult } from "../search/search-index.js";
import { useCachedContent } from "../use-cached-content.js";
import { useSearchQuery } from "../use-debounced-value.js";
import { useKidsAllowedKeys } from "../use-kids-allowed.js";
import { useLocalCatalogReady } from "../use-local-catalog-ready.js";
import { useNowNext } from "../use-now-next.js";
import { usePolicyLiveChannels } from "../use-policy-live-channels.js";
import { ChannelTile } from "./ListTiles.js";

export interface SearchScreenProps {
  source: PlaylistSource;
  platform: PlatformId;
  profile: Profile;
  onPlayMovie: (movie: Channel, options?: { resume?: boolean }) => void;
  onPlayChannel: (channel: Channel, lineup: ChannelLineup) => void;
  onOpenSeries: (seriesId: string) => void;
  /** Recently Watched: carries on with a series' next episode. */
  onContinueSeries: (entry: WatchHistoryEntry) => void;
  onBack: () => void;
  /** True while PlayerScreen is open on top of this screen — see VodScreen's identical prop. */
  isPlaybackOpen?: boolean;
}

type SeriesSummary = Pick<SeriesInfo, "id" | "name" | "posterUrl" | "groupTitle">;
/** The three kinds of result, each its own row. */
type ResultKind = "live" | "vod" | "series";
type ResultItem = Channel | SeriesSummary;

interface ResultRow<T> {
  items: T[];
  hasMore: boolean;
  bestScore: number;
  isLoading: boolean;
}

const ROW_LIMIT = 20;
/** A See all grid shows up to this many matches, best first. */
const SEE_ALL_LIMIT = 200;
const POSTER_CARD_WIDTH = "12rem";
const CHANNEL_TILE_WIDTH = "18rem";
const KEYBOARD_PANEL_WIDTH = "30rem";
/**
 * Left inset of everything in the results column. A result row scrolls
 * sideways, so it clips whatever sticks out of it — the inset is what gives
 * the first card room to grow when it's focused (as BROWSE_CONTENT_LEFT
 * does on the browse pages).
 */
const RESULTS_INSET = "2rem";
const CONTENT_SCOPE = "content";
const EMPTY_CATEGORIES: Awaited<ReturnType<typeof loadVodCategories>> = [];
const EMPTY_ROW: ResultRow<never> = { items: [], hasMore: false, bestScore: 0, isLoading: false };
/** Rows tied on their best match keep this order. */
const KIND_ORDER: ResultKind[] = ["live", "vod", "series"];
const KIND_TITLES: Record<ResultKind, string> = { live: "Live TV", vod: "Movies", series: "Series" };
const GRID_COLUMNS: Record<ResultKind, number> = { live: 3, vod: 5, series: 5 };
const RECENTLY_WATCHED_LIMIT = 20;

const resultId = (kind: ResultKind, id: string) => `search:${kind}:${id}`;
const seeAllId = (kind: ResultKind) => `search:see-all:${kind}`;
const gridId = (kind: ResultKind, id: string) => `search-grid:${kind}:${id}`;
const recentId = (index: number) => `search:recent:${index}`;
const historyId = (entry: WatchHistoryEntry) => `search:history:${entry.kind}:${entry.contentId}`;

function historyChannel(entry: WatchHistoryEntry): Channel {
  return { id: entry.contentId, name: entry.title, streamUrl: entry.streamUrl ?? "", logoUrl: entry.imageUrl, kind: "live", number: entry.channelNumber };
}

/**
 * What each profile last searched in each playlist, and the result it had
 * focused — so returning from a series' detail page (or the player) puts
 * the user back where they were. Module-level, like VodScreen's category
 * memory: it outlives the screen, not an app restart.
 */
const searchMemory = new Map<string, { query: string; focusId: string | null }>();

/** Test-only. */
export function __resetSearchMemoryForTests(): void {
  searchMemory.clear();
}

/**
 * Global search: one place to find Live TV channels, Movies and Series in
 * the active playlist, reached from Home's top bar, Kids Home's first tile,
 * and the Search button on the Movies and Series pages (see
 * docs/global-search-plan.md).
 *
 * An on-screen keyboard on the left, results on the right updating as the
 * user types — one row per kind, the row with the best match first, each
 * ending in a See all card that opens that kind's full result grid. Before
 * anything is typed: this profile's recent searches in this playlist, and
 * its Recently Watched. Reads only local data; a kind that isn't
 * downloaded yet is left out rather than fetched.
 */
export function SearchScreen({ source, platform, profile, onPlayMovie, onPlayChannel, onOpenSeries, onContinueSeries, onBack, isPlaybackOpen = false }: SearchScreenProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const memoryKey = `${profile.id}:${source.id}`;
  const [query, setQuery] = useState(() => searchMemory.get(memoryKey)?.query ?? "");
  const returnFocusIdRef = useRef<string | null>(searchMemory.get(memoryKey)?.focusId ?? null);
  const activeQuery = useSearchQuery(query);
  const [seeAll, setSeeAll] = useState<ResultKind | null>(null);

  useEffect(() => {
    const previous = searchMemory.get(memoryKey);
    searchMemory.set(memoryKey, { query, focusId: previous?.focusId ?? null });
  }, [memoryKey, query]);

  // Kids profiles only find what they're allowed to browse (docs/kids-profile.md §6).
  const policy = useContentPolicy(profile, source.id);
  const hasSeriesApi = source.kind === "xtream";
  const loadMovieCategories = useCallback(() => loadVodCategories(source), [source]);
  const loadShowCategories = useCallback(() => loadSeriesCategories(source), [source]);
  const { data: movieCategories } = useCachedContent(`vod-categories:${source.id}`, "category", loadMovieCategories, EMPTY_CATEGORIES);
  const { data: seriesCategories } = useCachedContent(`series-categories:${source.id}`, "category", loadShowCategories, EMPTY_CATEGORIES, {
    enabled: hasSeriesApi,
  });
  const movieFilter = useMemo(() => policy.catalogFilter("vod", movieCategories), [policy, movieCategories]);
  const seriesFilter = useMemo(() => policy.catalogFilter("series", seriesCategories), [policy, seriesCategories]);
  const { channels: allowedChannels } = usePolicyLiveChannels(source, policy);
  const channels = useMemo(() => withChannelNumbers(allowedChannels), [allowedChannels]);

  const moviesStatus = useLocalCatalogReady(source.id, "vod");
  const seriesStatus = useLocalCatalogReady(source.id, "series");
  const canSearch: Record<ResultKind, boolean> = {
    live: channels.length > 0,
    vod: moviesStatus === "ready",
    series: hasSeriesApi && seriesStatus === "ready",
  };
  const isCheckingTables = moviesStatus === "checking" || (hasSeriesApi && seriesStatus === "checking");

  // Result rows, and the See all grid (the same search with a higher limit).
  const runSearch = useCallback(
    (kind: ResultKind, limit: number): Promise<SearchCatalogResult<ResultItem>> => {
      if (kind === "live") return searchChannels(source.id, channels, activeQuery, { limit });
      if (kind === "vod") return searchCatalog(source.id, "vod", activeQuery, { limit, filter: movieFilter });
      return searchCatalog(source.id, "series", activeQuery, { limit, filter: seriesFilter });
    },
    [source.id, channels, activeQuery, movieFilter, seriesFilter],
  );
  const filterKey = `${movieFilter?.key ?? ""}|${seriesFilter?.key ?? ""}|${channels.length}`;
  const live = useResult(runSearch, "live", ROW_LIMIT, canSearch.live && seeAll === null, activeQuery, filterKey);
  const movies = useResult(runSearch, "vod", ROW_LIMIT, canSearch.vod && seeAll === null, activeQuery, filterKey);
  const series = useResult(runSearch, "series", ROW_LIMIT, canSearch.series && seeAll === null, activeQuery, filterKey);
  const grid = useResult(runSearch, seeAll ?? "vod", SEE_ALL_LIMIT, seeAll !== null, activeQuery, filterKey);

  // A new query always starts from the result rows.
  useEffect(() => setSeeAll(null), [activeQuery]);

  // Before anything is typed: recent searches, and Recently Watched (Kids-filtered, like the Recently Watched page).
  const recentSearches = useMemo(() => (activeQuery ? [] : loadRecentSearches(profile.id, source.id)), [profile.id, source.id, activeQuery]);
  const fullHistory = useMemo(() => loadWatchHistory(profile.id, source.id), [profile.id, source.id]);
  const savedItems = useMemo(() => fullHistory.map((e) => ({ kind: e.kind, id: e.contentId })), [fullHistory]);
  const allowedHistoryKeys = useKidsAllowedKeys(source, policy, savedItems);
  const recentlyWatched = useMemo(
    () => (allowedHistoryKeys ? fullHistory.filter((e) => allowedHistoryKeys.has(`${e.kind}:${e.contentId}`)) : fullHistory).slice(0, RECENTLY_WATCHED_LIMIT),
    [fullHistory, allowedHistoryKeys],
  );

  // Opening anything: remember the query and the focused result for coming back, and the query as a recent search.
  const beforeOpening = useCallback(() => {
    searchMemory.set(memoryKey, { query, focusId: useFocusStore.getState().focusedId });
    if (activeQuery) recordRecentSearch(profile.id, source.id, activeQuery);
  }, [memoryKey, query, activeQuery, profile.id, source.id]);
  const directory = channels;
  const openResult = useCallback(
    (kind: ResultKind, item: ResultItem, lineup: Channel[]) => {
      beforeOpening();
      if (kind === "live") onPlayChannel(item as Channel, { lineup, directory });
      else if (kind === "vod") onPlayMovie(item as Channel);
      else onOpenSeries(item.id);
    },
    [beforeOpening, onPlayChannel, onPlayMovie, onOpenSeries, directory],
  );
  const openHistory = useCallback(
    (entry: WatchHistoryEntry) => {
      beforeOpening();
      if (entry.kind === "live") {
        const recentChannels = recentlyWatched.filter((e) => e.kind === "live").map(historyChannel);
        onPlayChannel(historyChannel(entry), { lineup: recentChannels, directory: recentChannels });
      } else if (entry.kind === "movie") {
        onPlayMovie({ id: entry.contentId, name: entry.title, streamUrl: entry.streamUrl ?? "", logoUrl: entry.imageUrl, kind: "movie" }, { resume: !entry.finished });
      } else if (entry.finished) {
        onOpenSeries(entry.contentId);
      } else {
        onContinueSeries(entry);
      }
    },
    [beforeOpening, recentlyWatched, onPlayChannel, onPlayMovie, onOpenSeries, onContinueSeries],
  );

  const typeCharacter = useCallback((character: string) => setQuery((current) => (current.length === 0 && character === " " ? current : current + character)), []);
  const deleteCharacter = useCallback(() => setQuery((current) => current.slice(0, -1)), []);
  const clearQuery = useCallback(() => setQuery(""), []);

  // Rows with matches, the best match first; ties keep Live TV, Movies, Series.
  const rows = useMemo(() => {
    const byKind: Record<ResultKind, ResultRow<ResultItem>> = { live, vod: movies, series };
    return KIND_ORDER.filter((kind) => byKind[kind].items.length > 0)
      .map((kind) => ({ kind, ...byKind[kind] }))
      .sort((a, b) => b.bestScore - a.bestScore || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  }, [live, movies, series]);

  const showEmptyState = activeQuery.length === 0 && seeAll === null;
  const gridIds = useMemo(() => (seeAll ? grid.items.map((item) => gridId(seeAll, item.id)) : []), [grid, seeAll]);

  // The focusable content right of the keyboard, as rows of ids with what each does.
  const contentRows = useMemo((): Array<Array<{ id: string; onSelect: () => void }>> => {
    if (seeAll) {
      const columns = GRID_COLUMNS[seeAll];
      const cells = grid.items.map((item) => ({ id: gridId(seeAll, item.id), onSelect: () => openResult(seeAll, item, grid.items as Channel[]) }));
      return Array.from({ length: Math.ceil(cells.length / columns) }, (_, row) => cells.slice(row * columns, (row + 1) * columns));
    }
    if (showEmptyState) {
      return [
        recentSearches.map((term, index) => ({ id: recentId(index), onSelect: () => setQuery(term) })),
        recentlyWatched.map((entry) => ({ id: historyId(entry), onSelect: () => openHistory(entry) })),
      ].filter((row) => row.length > 0);
    }
    return rows.map((row) => [
      ...row.items.map((item) => ({ id: resultId(row.kind, item.id), onSelect: () => openResult(row.kind, item, row.items as Channel[]) })),
      ...(row.hasMore ? [{ id: seeAllId(row.kind), onSelect: () => setSeeAll(row.kind) }] : []),
    ]);
  }, [seeAll, grid, showEmptyState, recentSearches, recentlyWatched, rows, openResult, openHistory]);
  const firstContentId = contentRows[0]?.[0]?.id;

  // Focus graph right of the keyboard: Left from each row's first item goes back to the keyboard.
  useEffect(() => {
    const keyboardEdge = (row: number) => searchKeyId("abcdefghijklmnopqrstuvwxyz0123456789"[Math.min(row, 5) * 6 + 5]);
    const actions = new Map(contentRows.flat().map((cell) => [cell.id, cell.onSelect]));
    const base: FocusNode[] = seeAll ? buildGridFocusGraph(gridIds, GRID_COLUMNS[seeAll]) : buildShelfFocusGraph(contentRows.map((row) => row.map((cell) => cell.id)));
    const rowOf = new Map(contentRows.flatMap((row, index) => row.map((cell) => [cell.id, index] as const)));
    const rowStarts = new Set(contentRows.map((row) => row[0]?.id));
    const nodes = base.map((node) => ({
      ...node,
      neighbors: { ...node.neighbors, left: rowStarts.has(node.id) ? keyboardEdge(rowOf.get(node.id) ?? 0) : node.neighbors.left },
      onSelect: actions.get(node.id),
    }));
    setGraph(CONTENT_SCOPE, nodes);

    const { focusedId, nodes: registered } = useFocusStore.getState();
    const returnTo = returnFocusIdRef.current;
    if (returnTo && registered[returnTo]) {
      returnFocusIdRef.current = null;
      useFocusStore.getState().focus(returnTo);
    } else if (focusedId === null || !registered[focusedId]) {
      // Opening the screen, or the focused result just dropped out of the results: back to the keyboard.
      useFocusStore.getState().focus(searchKeyId("a"));
    }
  }, [contentRows, seeAll, gridIds, setGraph]);
  useEffect(() => () => clearGraph(CONTENT_SCOPE), [clearGraph]);

  // A physical keyboard (a desktop browser, or one paired with the TV) types straight into the query.
  useEffect(() => {
    if (isPlaybackOpen) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Backspace") {
        if (query.length === 0) return; // an empty query: Backspace goes Back as usual
        event.preventDefault();
        event.stopImmediatePropagation();
        deleteCharacter();
        return;
      }
      if (/^[a-z0-9 ]$/i.test(event.key)) {
        event.preventDefault();
        typeCharacter(event.key.toLowerCase());
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isPlaybackOpen, query, deleteCharacter, typeCharacter]);

  useRemoteInput(
    platform,
    {
      onBack: () => {
        if (seeAll) {
          const kind = seeAll;
          setSeeAll(null);
          returnFocusIdRef.current = seeAllId(kind);
          return;
        }
        searchMemory.set(memoryKey, { query, focusId: null });
        onBack();
      },
    },
    !isPlaybackOpen,
  );

  const isWaitingForResults = activeQuery.length > 0 && (live.isLoading || movies.isLoading || series.isLoading) && rows.length === 0;
  const nothingSearchable = !isCheckingTables && !canSearch.live && !canSearch.vod && !canSearch.series;
  const searchableKinds = hasSeriesApi ? "channels, movies and series" : "channels and movies";

  let results: JSX.Element;
  if (seeAll) {
    results = <SeeAllGrid source={source} kind={seeAll} query={activeQuery} items={grid.items} hasMore={grid.hasMore} isLoading={grid.isLoading} />;
  } else if (nothingSearchable) {
    results = <Message>Your playlist is still downloading. You can search it once it's ready.</Message>;
  } else if (activeQuery.length === 0 && query.trim().length > 0) {
    results = <Message>Keep typing…</Message>;
  } else if (showEmptyState) {
    results = (
      <>
        <Message>{`Search ${searchableKinds} by title.`}</Message>
        {recentSearches.length > 0 && (
          <section style={{ marginTop: "2rem", paddingLeft: RESULTS_INSET }}>
            <h2 style={{ fontSize: TV_HEADING, fontWeight: 700, margin: "0 0 1rem" }}>Recent searches</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
              {recentSearches.map((term, index) => (
                <RecentSearchChip key={term} id={recentId(index)} term={term} onSelect={() => setQuery(term)} />
              ))}
            </div>
          </section>
        )}
        {recentlyWatched.length > 0 && (
          <div style={{ marginTop: "2rem" }}>
            <Shelf
              title="Recently Watched"
              items={recentlyWatched}
              getId={historyId}
              leftInset={RESULTS_INSET}
              renderItem={(entry) =>
                entry.kind === "live" ? (
                  <ChannelTile id={historyId(entry)} title={entry.title} imageUrl={entry.imageUrl} seed={entry.contentId} width={CHANNEL_TILE_WIDTH} isEditing={false} onSelect={() => openHistory(entry)} />
                ) : (
                  <FocusCard
                    id={historyId(entry)}
                    title={entry.title}
                    subtitle={entry.kind === "series" ? entry.subtitle : undefined}
                    imageUrl={entry.imageUrl}
                    width={POSTER_CARD_WIDTH}
                    placeholderIcon={entry.kind === "movie" ? SECTION_ICONS.movies : SECTION_ICONS.series}
                    onSelect={() => openHistory(entry)}
                  />
                )
              }
            />
          </div>
        )}
      </>
    );
  } else if (isCheckingTables || isWaitingForResults) {
    results = <LoadingState />;
  } else if (rows.length === 0) {
    results = <Message>{`No matches for “${activeQuery}” in ${source.name}. Check the spelling or try fewer letters.`}</Message>;
  } else {
    results = (
      <>
        {rows.map((row) => (
          <Shelf
            key={row.kind}
            title={KIND_TITLES[row.kind]}
            items={row.items}
            getId={(item) => resultId(row.kind, item.id)}
            leftInset={RESULTS_INSET}
            trailing={
              row.hasMore ? (
                <SeeAllCard
                  id={seeAllId(row.kind)}
                  label={KIND_TITLES[row.kind]}
                  width={row.kind === "live" ? CHANNEL_TILE_WIDTH : POSTER_CARD_WIDTH}
                  shape={row.kind === "live" ? "wide" : "poster"}
                  onSelect={() => setSeeAll(row.kind)}
                />
              ) : undefined
            }
            trailingId={row.hasMore ? seeAllId(row.kind) : undefined}
            renderItem={(item) => <ResultCard source={source} kind={row.kind} id={resultId(row.kind, item.id)} item={item} onSelect={() => openResult(row.kind, item, row.items as Channel[])} />}
          />
        ))}
      </>
    );
  }

  return (
    <MeshBackground>
      {/* The gap plus RESULTS_INSET is the space between the keyboard and the results. */}
      <div style={{ display: "flex", minHeight: "100vh", padding: "2.5vh 2.5vw", boxSizing: "border-box", gap: "1rem" }}>
        <aside style={{ width: KEYBOARD_PANEL_WIDTH, flexShrink: 0, display: "flex", flexDirection: "column", gap: "1.5rem", paddingTop: "1.5rem" }}>
          <h1 style={{ fontSize: "2.25rem", fontWeight: 800, color: "#fff" }}>Search</h1>
          <div
            role="searchbox"
            aria-label="Search query"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              minHeight: "4rem",
              padding: "0 1.25rem",
              borderRadius: "0.75rem",
              background: "rgba(255,255,255,0.08)",
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)",
              fontSize: "1.75rem",
              fontWeight: 600,
              color: "#fff",
            }}
          >
            <Search size="1.75rem" color="var(--text-dim)" style={{ flexShrink: 0 }} />
            {/* The caret sits right after the text — its own flex item would get the row's gap and look like a typed space. */}
            <span style={{ display: "flex", alignItems: "center", minWidth: 0, overflow: "hidden" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "pre" }}>{query}</span>
              <span aria-hidden style={{ flexShrink: 0, width: 2, height: "2rem", marginLeft: 1, background: "#fff", animation: "search-caret 1s steps(1) infinite" }} />
            </span>
          </div>
          <SearchKeyboard onInput={typeCharacter} onDelete={deleteCharacter} onClear={clearQuery} rightExitId={firstContentId} />
          <style>{`@keyframes search-caret { 50% { opacity: 0; } }`}</style>
        </aside>

        <main style={{ flex: 1, minWidth: 0, paddingTop: "1.5rem" }}>
          <p style={{ margin: `0 0 1.5rem ${RESULTS_INSET}`, fontSize: "1.25rem", color: "var(--text-dim)" }}>Searching “{source.name}”</p>
          {results}
        </main>
      </div>
    </MeshBackground>
  );
}

/** One kind's matches for the query (a row, or with a higher limit a See all grid) — see search-index.ts. */
function useResult(
  run: (kind: ResultKind, limit: number) => Promise<SearchCatalogResult<ResultItem>>,
  kind: ResultKind,
  limit: number,
  enabled: boolean,
  query: string,
  filterKey: string,
): ResultRow<ResultItem> {
  const [row, setRow] = useState<ResultRow<ResultItem>>(EMPTY_ROW);
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    if (!enabled || query.length === 0) {
      setRow(EMPTY_ROW);
      return;
    }
    let cancelled = false;
    setRow((current) => ({ ...current, isLoading: true }));
    runRef
      .current(kind, limit)
      .then(({ items, hasMore, bestScore }) => {
        if (!cancelled) setRow({ items, hasMore, bestScore, isLoading: false });
      })
      .catch(() => {
        if (!cancelled) setRow(EMPTY_ROW);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, limit, enabled, query, filterKey]);

  return row;
}

/** A result: a channel tile with what's on now, or a movie or series poster. */
function ResultCard({ source, kind, id, item, onSelect, fill = false }: { source: PlaylistSource; kind: ResultKind; id: string; item: ResultItem; onSelect: () => void; fill?: boolean }): JSX.Element {
  if (kind === "live") return <LiveResultTile source={source} id={id} channel={item as Channel} onSelect={onSelect} width={fill ? "100%" : CHANNEL_TILE_WIDTH} />;
  return (
    <FocusCard
      id={id}
      title={item.name}
      imageUrl={kind === "vod" ? (item as Channel).logoUrl : (item as SeriesSummary).posterUrl}
      width={fill ? "100%" : POSTER_CARD_WIDTH}
      placeholderIcon={kind === "vod" ? SECTION_ICONS.movies : SECTION_ICONS.series}
      onSelect={onSelect}
    />
  );
}

function LiveResultTile({ source, id, channel, onSelect, width }: { source: PlaylistSource; id: string; channel: Channel; onSelect: () => void; width: string }): JSX.Element {
  const { nowNext } = useNowNext(source, channel);
  const number = channel.number !== undefined ? `CH ${channel.number}` : null;
  const now = nowNext?.now?.title ? `Now: ${nowNext.now.title}` : null;
  return <ChannelTile id={id} title={channel.name} subtitle={[number, now].filter(Boolean).join(" · ") || undefined} imageUrl={channel.logoUrl} seed={channel.id} width={width} isEditing={false} onSelect={onSelect} />;
}

function RecentSearchChip({ id, term, onSelect }: { id: string; term: string; onSelect: () => void }): JSX.Element {
  const isFocused = useIsFocused(id);
  return (
    <Focusable id={id} style={{ width: "auto", height: "auto" }}>
      <button
        type="button"
        tabIndex={-1}
        onClick={onSelect}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          border: "none",
          borderRadius: 999,
          padding: "0.75rem 1.25rem",
          fontSize: "1.25rem",
          fontWeight: 600,
          background: isFocused ? "#ffffff" : "rgba(255,255,255,0.08)",
          color: isFocused ? "#0b0c10" : "rgba(235,236,242,0.9)",
          transform: isFocused ? "scale(1.06)" : "scale(1)",
          transition: "transform 160ms ease-out",
          cursor: "pointer",
        }}
      >
        <Search size="1.25rem" />
        {term}
      </button>
    </Focusable>
  );
}

function Message({ children }: { children: React.ReactNode }): JSX.Element {
  return <p style={{ margin: `0 0 0 ${RESULTS_INSET}`, fontSize: TV_TEXT, color: "var(--text-dim)", maxWidth: "48rem" }}>{children}</p>;
}

/** Every match of one kind (the best SEE_ALL_LIMIT) — what a row's See all card opens. */
function SeeAllGrid({ source, kind, query, items, hasMore, isLoading }: { source: PlaylistSource; kind: ResultKind; query: string; items: ResultItem[]; hasMore: boolean; isLoading: boolean }): JSX.Element {
  return (
    <section style={{ paddingLeft: RESULTS_INSET }}>
      <h2 style={{ fontSize: TV_HEADING, fontWeight: 700, margin: "0 0 0.25rem" }}>{KIND_TITLES[kind]}</h2>
      <p style={{ margin: "0 0 1.5rem", fontSize: "1.125rem", color: "var(--text-dim)" }}>
        {isLoading && items.length === 0
          ? `Matches for “${query}”`
          : `${hasMore ? `The best ${items.length}` : items.length} ${items.length === 1 ? "match" : "matches"} for “${query}”`}
      </p>
      {isLoading && items.length === 0 ? (
        <LoadingState />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${GRID_COLUMNS[kind]}, minmax(0, 1fr))`, columnGap: BROWSE_GAP, rowGap: BROWSE_ROW_GAP }}>
          {/* Selecting goes through the focus graph (see contentRows), so the cards here only render. */}
          {items.map((item) => (
            <ResultCard key={item.id} source={source} kind={kind} id={gridId(kind, item.id)} item={item} onSelect={() => {}} fill />
          ))}
        </div>
      )}
    </section>
  );
}
