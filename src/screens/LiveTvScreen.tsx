import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Category, Channel, PlatformId, PlaylistSource, Profile } from "@core";
import {
  CATEGORY_RAIL_COLLAPSED_WIDTH,
  CategoryRail,
  categoryRailItemId,
  ChannelGridSkeleton,
  ChannelSidebar,
  LiveChannelPreview,
  MeshBackground,
  SECTION_ICONS,
  TV_TEXT,
  useFocusStore,
  useIsFocused,
  useRemoteInput,
} from "@ui";
import { loadFavorites, toggleFavorite } from "../profile-store.js";
import { useContentPolicy } from "../content-policy.js";
import { usePolicyLiveChannels } from "../use-policy-live-channels.js";
import { useNowNext } from "../use-now-next.js";
import { liveStreamUrl } from "../live-stream-url.js";
import { withChannelNumbers, type ChannelLineup } from "../channel-lineup.js";
import { useFavoritesRevision } from "../use-favorites-revision.js";

export interface LiveTvScreenProps {
  source: PlaylistSource;
  platform: PlatformId;
  profile: Profile;
  onBack: () => void;
  /** Enters full-screen playback for the given channel — see App.tsx's playLive. The lineup lets the player change channel (CH+/CH−, number keys). */
  onPlay: (channel: Channel, lineup: ChannelLineup) => void;
  /** True while PlayerScreen is open on top of this screen — disables this screen's own useRemoteInput so a single Back press doesn't both close the player and navigate this screen away (see use-remote-input.ts's `enabled` doc comment). */
  isPlaybackOpen?: boolean;
}

const ALL_CATEGORY_ID = "__all__";
const FAVOURITES_CATEGORY_ID = "__favourites__";
/** Focus id of the favourite button in the preview's channel line. */
const FAVORITE_BUTTON_ID = "live-preview-favorite";
const FAVORITE_BUTTON_SCOPE = "content:live-favorite";
/**
 * How long the channel list must rest on a channel before the preview
 * switches to it. Each switch tears down and restarts the TV's video
 * decoder, so this waits for the user to stop, not just pause mid-scroll.
 */
const PREVIEW_DEBOUNCE_MS = 600;

/** The category each source was last browsed in (same idea as Movies/Series) — module-level so it outlives the screen, not an app restart. */
const lastCategoryBySource = new Map<string, string>();

/** Test-only: forgets remembered categories. */
export function __resetLiveCategoryMemoryForTests(): void {
  lastCategoryBySource.clear();
}

/** Client-side category grouping for M3U sources, which have no separate category API — same approach as GuideScreen's groupChannelsByCategory. */
function groupByCategory(channels: Channel[]): Category[] {
  const seen = new Map<string, Category>();
  for (const channel of channels) {
    const key = channel.groupTitle ?? "Uncategorized";
    if (!seen.has(key)) seen.set(key, { id: key, name: key, kind: "live" });
  }
  return Array.from(seen.values());
}

export function LiveTvScreen({ source, platform, profile, onBack, onPlay, isPlaybackOpen = false }: LiveTvScreenProps): JSX.Element {
  // Read from the local live table; fetched and parsed in the sync worker (see use-live-channels.ts).
  // A Kids profile sees only allowed channels, minus any airing something mature right now (docs/kids-profile.md §3.6).
  const policy = useContentPolicy(profile, source.id);
  const {
    channels,
    fetchedCategories,
    isInitialLoading: isChannelsLoading,
    isCategoriesLoading,
    error: loadError,
  } = usePolicyLiveChannels(source, policy);

  // Xtream sources get real provider categories; M3U sources (fetchedCategories
  // always empty there — see loadLiveCategories) fall back to grouping the
  // channel list itself by groupTitle, same as GuideScreen.
  const categories = useMemo(
    () => (fetchedCategories.length > 0 ? fetchedCategories : groupByCategory(channels)),
    [fetchedCategories, channels],
  );

  // Provider channel number when there is one, otherwise the channel's
  // position in the full list — so every row has a stable number to show.
  const numberById = useMemo(() => new Map(channels.map((channel, index) => [channel.id, channel.number ?? index + 1])), [channels]);

  // Remembered per profile, so a Kids profile never reopens a category a parent was browsing.
  const memoryKey = `${profile.id}:${source.id}`;
  const [activeCategoryId, setActiveCategoryId] = useState(() => lastCategoryBySource.get(memoryKey) ?? ALL_CATEGORY_ID);
  useEffect(() => {
    lastCategoryBySource.set(memoryKey, activeCategoryId);
  }, [memoryKey, activeCategoryId]);
  const [previewChannel, setPreviewChannel] = useState<Channel | null>(null);
  // Bumped on every favourite toggle to force a re-read of localStorage —
  // toggleFavorite persists synchronously but isn't itself reactive state,
  // same pattern as FavouritesScreen's own favoritesVersion.
  const [favoritesVersion, setFavoritesVersion] = useState(0);
  const favoritesRevision = useFavoritesRevision(); // My List changed elsewhere (e.g. from the player)

  const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const favoriteIds = useMemo(() => {
    void favoritesVersion;
    return new Set(
      loadFavorites(profile.id)
        .filter((f) => f.sourceId === source.id && f.contentKind === "live")
        .map((f) => f.contentId),
    );
  }, [profile.id, source.id, favoritesVersion, favoritesRevision]);
  const favoriteChannels = useMemo(() => channels.filter((c) => favoriteIds.has(c.id)), [channels, favoriteIds]);

  // Rail rows: My List (the user's favourite channels) and All Channels first, then the provider's categories.
  const categoryItems = useMemo(
    () => [
      { id: FAVOURITES_CATEGORY_ID, label: "My List", icon: SECTION_ICONS.favourites, count: favoriteChannels.length },
      { id: ALL_CATEGORY_ID, label: "All Channels", count: channels.length },
      ...categories.map((c) => ({ id: c.id, label: c.name })),
    ],
    [categories, channels.length, favoriteChannels.length],
  );
  const activeCategoryLabel = categoryItems.find((c) => c.id === activeCategoryId)?.label ?? "All Channels";

  const visibleChannels = useMemo(() => {
    if (activeCategoryId === ALL_CATEGORY_ID) return channels;
    if (activeCategoryId === FAVOURITES_CATEGORY_ID) return favoriteChannels;
    return channels.filter((c) => (c.groupTitle ?? "Uncategorized") === activeCategoryId || c.groupTitle === activeCategoryId);
  }, [activeCategoryId, channels, favoriteChannels]);

  // A new category previews its first channel straight away (no debounce);
  // row-to-row browsing within it goes through PREVIEW_DEBOUNCE_MS.
  useEffect(() => {
    setPreviewChannel((current) => (current && visibleChannels.some((c) => c.id === current.id) ? current : visibleChannels[0] ?? null));
  }, [visibleChannels]);

  useEffect(() => {
    return () => {
      if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
    };
  }, []);

  // The last channel the list highlighted — may be ahead of previewChannel
  // while the preview debounce is still waiting.
  const lastHighlightedRef = useRef<Channel | null>(null);
  const handleHighlight = useCallback((channel: Channel) => {
    lastHighlightedRef.current = channel;
    if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
    previewDebounceRef.current = setTimeout(() => setPreviewChannel(channel), PREVIEW_DEBOUNCE_MS);
  }, []);

  // Moving onto the favourite button settles the preview on the channel the
  // user just left, immediately — otherwise pressing Right within the
  // debounce window would favourite whatever the preview happened to show.
  const isFavoriteButtonFocused = useIsFocused(FAVORITE_BUTTON_ID);
  useEffect(() => {
    if (!isFavoriteButtonFocused) return;
    if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
    const pending = lastHighlightedRef.current;
    if (pending) setPreviewChannel(pending);
  }, [isFavoriteButtonFocused]);

  const handleToggleFavorite = useCallback(() => {
    if (!previewChannel) return;
    toggleFavorite(profile.id, source.id, "live", previewChannel.id);
    setFavoritesVersion((v) => v + 1);
  }, [profile.id, source.id, previewChannel]);

  // The button's node: Left goes back to the previewed channel's row.
  // Passive, so it never takes the screen's initial focus.
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  useEffect(() => {
    setGraph(
      FAVORITE_BUTTON_SCOPE,
      [{ id: FAVORITE_BUTTON_ID, neighbors: { left: previewChannel?.id }, onSelect: handleToggleFavorite }],
      undefined,
      { passive: true },
    );
  }, [previewChannel, handleToggleFavorite, setGraph]);
  useEffect(() => () => clearGraph(FAVORITE_BUTTON_SCOPE), [clearGraph]);

  // OK on a channel plays it full screen straight away — the preview is
  // already showing it, so a second "focus the preview, press OK" step
  // would just be friction.
  // Numbered like the list shows them, so number keys in the player match.
  const numberedChannels = useMemo(() => withChannelNumbers(channels), [channels]);
  const handleSelectChannel = useCallback(
    (channel: Channel) => {
      const byId = new Map(numberedChannels.map((c) => [c.id, c]));
      const lineup = visibleChannels.map((c) => byId.get(c.id) ?? c);
      onPlay(byId.get(channel.id) ?? channel, { lineup, directory: numberedChannels });
    },
    [onPlay, numberedChannels, visibleChannels],
  );

  const activeCategoryIdRef = useRef(activeCategoryId);
  activeCategoryIdRef.current = activeCategoryId;
  const selectCategory = useCallback((id: string) => {
    if (id === activeCategoryIdRef.current) {
      // Already showing: hand focus back to the channel list.
      const current = useFocusStore.getState();
      const firstChannelId = Object.keys(current.scopes["content:channel-sidebar"] ?? {})[0];
      if (firstChannelId) current.focus(firstChannelId);
      return;
    }
    // ChannelSidebar focuses the new list's first channel when its channels change.
    setActiveCategoryId(id);
  }, []);

  const { nowNext, isLoading: isGuideLoading } = useNowNext(source, isPlaybackOpen ? null : previewChannel);

  useRemoteInput(
    platform,
    {
      // Back from the favourite button returns to the channel list; from the
      // channel list it opens the category rail; from the rail it leaves
      // Live TV.
      onBack: () => {
        const { focusedId, focus } = useFocusStore.getState();
        if (focusedId === FAVORITE_BUTTON_ID && previewChannel) focus(previewChannel.id);
        else if (focusedId?.startsWith("rail:")) onBack();
        else focus(categoryRailItemId(activeCategoryIdRef.current));
      },
      onLongSelect: (focusedId) => {
        const channel = channels.find((c) => c.id === focusedId);
        if (!channel) return;
        toggleFavorite(profile.id, source.id, "live", channel.id);
        setFavoritesVersion((v) => v + 1);
      },
    },
    !isPlaybackOpen,
  );

  // Suspended while PlayerScreen is open on top: this screen stays mounted
  // underneath, and without this its preview would keep streaming and
  // decoding the same channel in parallel with the fullscreen player —
  // two MSE pipelines competing for the TV's few hardware decoders.
  const previewStreamUrl = isPlaybackOpen || !previewChannel ? null : liveStreamUrl(previewChannel, source.id);

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
        title="Live TV"
        items={categoryItems}
        activeId={activeCategoryId}
        onSelect={selectCategory}
        sectionBreakAt={2}
      />
      <div style={{ height: "100vh", display: "flex", overflow: "hidden", paddingLeft: CATEGORY_RAIL_COLLAPSED_WIDTH, boxSizing: "border-box" }}>
        <div style={{ width: "36rem", flexShrink: 0, display: "flex", flexDirection: "column", borderRight: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ padding: "2rem 1.75rem 1rem" }}>
            <div style={{ fontSize: "2.25rem", fontWeight: 800, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {activeCategoryLabel}
            </div>
            <div style={{ fontSize: "1.125rem", fontWeight: 500, color: "var(--text-dim)", marginTop: "0.25rem" }}>
              {visibleChannels.length} {visibleChannels.length === 1 ? "channel" : "channels"}
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            {visibleChannels.length === 0 ? (
              <p style={{ padding: "0 1.75rem", fontSize: TV_TEXT, color: "var(--text-dim)" }}>
                {activeCategoryId === FAVOURITES_CATEGORY_ID ? "Your list is empty — press Right on a channel and choose + My List." : "No channels in this category."}
              </p>
            ) : (
              <ChannelSidebar
                channels={visibleChannels}
                activeChannelId={previewChannel?.id}
                numberById={numberById}
                width="100%"
                onHighlight={handleHighlight}
                onSelect={handleSelectChannel}
                leftEntryId={categoryRailItemId(activeCategoryId)}
                rightEntryId={previewChannel ? FAVORITE_BUTTON_ID : undefined}
              />
            )}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0, padding: "2rem 3.5rem 2rem 2.5rem", overflow: "hidden" }}>
          <LiveChannelPreview
            channel={previewChannel}
            streamUrl={previewStreamUrl}
            channelNumber={previewChannel ? numberById.get(previewChannel.id) : undefined}
            isFavorite={previewChannel ? favoriteIds.has(previewChannel.id) : false}
            nowNext={nowNext}
            isGuideLoading={isGuideLoading}
            favoriteButtonId={FAVORITE_BUTTON_ID}
            onToggleFavorite={handleToggleFavorite}
          />
        </div>
      </div>
    </MeshBackground>
  );
}
