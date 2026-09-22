import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Category, Channel, PlatformId, PlaylistSource, Profile } from "@core";
import { ChannelPreloader } from "@player";
import {
  CategorySidebar,
  ChannelGridSkeleton,
  ChannelSidebar,
  FavouriteChannelsRow,
  LiveChannelPreview,
  LiveTvLogo,
  useFocusStore,
  useRemoteInput,
} from "@ui";
import { loadChannelsByKind, loadLiveCategories } from "../content-loader.js";
import { isFavorite as checkIsFavorite, loadFavorites, toggleFavorite } from "../profile-store.js";
import { useCachedContent } from "../use-cached-content.js";

export interface LiveTvScreenProps {
  source: PlaylistSource;
  platform: PlatformId;
  profile: Profile;
  onBack: () => void;
  /** Enters full-screen playback for the given channel — see App.tsx's playLive. */
  onPlay: (channel: Channel) => void;
}

const EMPTY_CHANNELS: Channel[] = [];
const EMPTY_CATEGORIES: Category[] = [];
const ALL_CATEGORY_ID = "__all__";
const PREVIEW_FOCUS_ID = "live-preview";
const FAVORITE_BUTTON_FOCUS_ID = "live-preview-favorite";
/** Matches FavouriteChannelsRow's own internal id scheme (`fav-channel:${id}`) so this screen can point the favourite-toggle button's down-neighbor at the row's first tile without the row needing to expose its ids separately. */
const favoriteRowItemId = (channelId: string) => `fav-channel:${channelId}`;
/** Delay before a highlighted channel's stream actually loads into the preview player — avoids starting/tearing down HLS instances on every row a fast scroll passes through (AC3, spec's ~300ms debounce). */
const PREVIEW_DEBOUNCE_MS = 300;

/** Client-side category grouping for M3U sources, which have no separate category API — same approach as GuideScreen's groupChannelsByCategory. */
function groupByCategory(channels: Channel[]): Category[] {
  const seen = new Map<string, Category>();
  for (const channel of channels) {
    const key = channel.groupTitle ?? "Uncategorized";
    if (!seen.has(key)) seen.set(key, { id: key, name: key, kind: "live" });
  }
  return Array.from(seen.values());
}

export function LiveTvScreen({ source, platform, profile, onBack, onPlay }: LiveTvScreenProps): JSX.Element {
  const loadChannels = useCallback(() => loadChannelsByKind(source, "live"), [source]);
  const { data: channels, isInitialLoading: isChannelsLoading, error: loadError } = useCachedContent(
    `live:${source.id}`,
    "catalog",
    loadChannels,
    EMPTY_CHANNELS,
  );

  const loadCategories = useCallback(() => loadLiveCategories(source), [source]);
  const { data: fetchedCategories, isInitialLoading: isCategoriesLoading } = useCachedContent(
    `live-categories:${source.id}`,
    "category",
    loadCategories,
    EMPTY_CATEGORIES,
  );

  // Xtream sources get real provider categories; M3U sources (fetchedCategories
  // always empty there — see loadLiveCategories) fall back to grouping the
  // channel list itself by groupTitle, same as GuideScreen.
  const categories = useMemo(
    () => (fetchedCategories.length > 0 ? fetchedCategories : groupByCategory(channels)),
    [fetchedCategories, channels],
  );
  const categoryItems = useMemo(
    () => [{ id: ALL_CATEGORY_ID, label: "All Channels", count: channels.length }, ...categories.map((c) => ({ id: c.id, label: c.name }))],
    [categories, channels.length],
  );

  const [activeCategoryId, setActiveCategoryId] = useState(ALL_CATEGORY_ID);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [previewChannel, setPreviewChannel] = useState<Channel | null>(null);
  // Bumped on every favourite toggle to force a re-read of localStorage —
  // toggleFavorite persists synchronously but isn't itself reactive state,
  // same pattern as FavouritesScreen's own favoritesVersion.
  const [favoritesVersion, setFavoritesVersion] = useState(0);

  const preloaderRef = useRef(new ChannelPreloader());
  const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focus = useFocusStore((state) => state.focus);

  const favoriteChannels = useMemo(() => {
    void favoritesVersion;
    const favoriteIds = new Set(
      loadFavorites(profile.id)
        .filter((f) => f.sourceId === source.id && f.contentKind === "live")
        .map((f) => f.contentId),
    );
    return channels.filter((c) => favoriteIds.has(c.id));
  }, [profile.id, source.id, channels, favoritesVersion]);

  const isPreviewFavorite = useMemo(() => {
    void favoritesVersion;
    return previewChannel ? checkIsFavorite(profile.id, source.id, "live", previewChannel.id) : false;
  }, [profile.id, source.id, previewChannel, favoritesVersion]);

  const handleToggleFavorite = useCallback(() => {
    if (!previewChannel) return;
    toggleFavorite(profile.id, source.id, "live", previewChannel.id);
    setFavoritesVersion((v) => v + 1);
  }, [profile.id, source.id, previewChannel]);

  const visibleChannels = useMemo(() => {
    if (activeCategoryId === ALL_CATEGORY_ID) return channels;
    return channels.filter((c) => (c.groupTitle ?? "Uncategorized") === activeCategoryId || c.groupTitle === activeCategoryId);
  }, [activeCategoryId, channels]);

  useEffect(() => {
    setSelectedChannel((current) => (current && visibleChannels.some((c) => c.id === current.id) ? current : visibleChannels[0] ?? null));
    setPreviewChannel((current) => (current && visibleChannels.some((c) => c.id === current.id) ? current : visibleChannels[0] ?? null));
  }, [visibleChannels]);

  useEffect(() => {
    const preloader = preloaderRef.current;
    return () => preloader.dispose();
  }, []);

  useEffect(() => {
    return () => {
      if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
    };
  }, []);

  const handleHighlight = useCallback((channel: Channel) => {
    preloaderRef.current.warm(channel.streamUrl);
    if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
    previewDebounceRef.current = setTimeout(() => setPreviewChannel(channel), PREVIEW_DEBOUNCE_MS);
  }, []);

  useRemoteInput(platform, {
    onBack,
    onLongSelect: (focusedId) => {
      const channel = channels.find((c) => c.id === focusedId);
      if (!channel) return;
      toggleFavorite(profile.id, source.id, "live", channel.id);
      setFavoritesVersion((v) => v + 1);
    },
  });

  const previewStreamUrl = previewChannel?.streamUrl ?? null;

  const isInitialLoading = isChannelsLoading || isCategoriesLoading;

  if (loadError && isInitialLoading) {
    return <div role="alert">Failed to load channels: {loadError}</div>;
  }

  if (isInitialLoading) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <ChannelGridSkeleton columns={5} rows={2} />
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", display: "flex", overflow: "hidden" }}>
      <CategorySidebar
        items={categoryItems}
        activeId={activeCategoryId}
        onSelect={setActiveCategoryId}
        contentEntryId={visibleChannels.length > 0 ? visibleChannels[0].id : undefined}
        header={<LiveTvLogo />}
      />

      <ChannelSidebar
        channels={visibleChannels}
        activeChannelId={selectedChannel?.id}
        onHighlight={handleHighlight}
        onSelect={(channel) => {
          // OK on a channel row commits it as the preview's channel and
          // hands focus to column 3 — actually entering full-screen is
          // reserved for selecting the preview itself (AC4).
          setSelectedChannel(channel);
          setPreviewChannel(channel);
          focus(PREVIEW_FOCUS_ID);
        }}
        leftEntryId={activeCategoryId}
        rightEntryId={PREVIEW_FOCUS_ID}
      />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
        <LiveChannelPreview
          channel={previewChannel}
          streamUrl={previewStreamUrl}
          focusId={PREVIEW_FOCUS_ID}
          onEnterFullScreen={() => {
            if (previewChannel) onPlay(previewChannel);
          }}
          isFavorite={isPreviewFavorite}
          onToggleFavorite={handleToggleFavorite}
          favoriteButtonFocusId={FAVORITE_BUTTON_FOCUS_ID}
          belowFocusId={favoriteChannels.length > 0 ? favoriteRowItemId(favoriteChannels[0].id) : undefined}
        />

        <FavouriteChannelsRow
          channels={favoriteChannels}
          onSelect={(channel) => {
            setSelectedChannel(channel);
            setPreviewChannel(channel);
            focus(FAVORITE_BUTTON_FOCUS_ID);
          }}
          aboveFocusId={FAVORITE_BUTTON_FOCUS_ID}
        />
      </div>
    </div>
  );
}
