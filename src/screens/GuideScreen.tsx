import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { XtreamClient, buildChannelGuides, type Category, type Channel, type EpgProgramme, type PlatformId, type PlaylistSource } from "@core";
import { CategorySidebar, ChannelGridSkeleton, ChannelSidebar, EpgProgrammeList, MeshBackground, useFocusStore, useRemoteInput } from "@ui";
import { loadChannelsByKind, loadEpg, loadLiveCategories, loadStreamEpg } from "../content-loader.js";
import { useCachedContent } from "../use-cached-content.js";

export interface GuideScreenProps {
  source: PlaylistSource;
  platform: PlatformId;
  /** Live playback (programme is currently airing) or catch-up (past programme with an archive URL). */
  onPlay: (streamUrl: string) => void;
  onBack: () => void;
  /** True while PlayerScreen is open on top of this screen — disables this screen's own useRemoteInput so a single Back press doesn't both close the player and navigate this screen away. */
  isPlaybackOpen?: boolean;
}

const EMPTY_CHANNELS: Channel[] = [];
const EMPTY_CATEGORIES: Category[] = [];
const EMPTY_PROGRAMMES: EpgProgramme[] = [];
const ALL_CATEGORY_ID = "__all__";
/** Matches EpgProgrammeList's own internal id scheme (`epg-item:${index}`) so this screen can point the channel sidebar's right-neighbor at the list's first row without the list needing to expose its ids separately — same convention as LiveTvScreen's favoriteRowItemId. */
const epgListItemId = (index: number) => `epg-item:${index}`;
/** Delay before a highlighted channel's guide actually loads — same rationale as LiveTvScreen's PREVIEW_DEBOUNCE_MS: avoids firing a fetch (per-stream get_epg, or the M3U fallback) for every row a fast scroll passes through. */
const EPG_DEBOUNCE_MS = 300;

/** Client-side category grouping for M3U sources, which have no separate category API — same pattern as LiveTvScreen's groupByCategory. */
function groupByCategory(channels: Channel[]): Category[] {
  const seen = new Map<string, Category>();
  for (const channel of channels) {
    const key = channel.groupTitle ?? "Uncategorized";
    if (!seen.has(key)) seen.set(key, { id: key, name: key, kind: "live" });
  }
  return Array.from(seen.values());
}

export function GuideScreen({ source, platform, onPlay, onBack, isPlaybackOpen = false }: GuideScreenProps): JSX.Element {
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

  // M3U sources have no per-stream EPG endpoint — their guide comes from the
  // bulk xmltv.php/epgUrl export instead, fetched once up front and sliced
  // per channel client-side (see guidesByChannel below). Xtream sources skip
  // this entirely and fetch per-channel via loadStreamEpg as the user
  // browses column 2, so this stays disabled for them.
  const loadBulkEpg = useCallback(() => loadEpg(source), [source]);
  const { data: bulkProgrammes } = useCachedContent(`guide-epg:${source.id}`, "epg", loadBulkEpg, EMPTY_PROGRAMMES, {
    enabled: source.kind !== "xtream",
  });
  const bulkGuidesByChannel = useMemo(() => buildChannelGuides(bulkProgrammes), [bulkProgrammes]);

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
  const [guideChannel, setGuideChannel] = useState<Channel | null>(null);
  const [streamProgrammes, setStreamProgrammes] = useState<EpgProgramme[]>([]);
  const [isGuideLoading, setIsGuideLoading] = useState(false);

  const guideDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const guideRequestIdRef = useRef(0);
  const focus = useFocusStore((state) => state.focus);

  const visibleChannels = useMemo(() => {
    if (activeCategoryId === ALL_CATEGORY_ID) return channels;
    return channels.filter((c) => (c.groupTitle ?? "Uncategorized") === activeCategoryId || c.groupTitle === activeCategoryId);
  }, [activeCategoryId, channels]);

  // Loads the highlighted channel's guide — per-stream get_epg for Xtream,
  // or a slice of the bulk XMLTV export (keyed by epgChannelId, same lookup
  // GuideScreen used before this redesign) for M3U. A monotonically
  // increasing request id (rather than an AbortController — proxyFetch's
  // dev-proxy indirection makes aborting the underlying request unreliable)
  // discards a stale response that resolves after a newer highlight has
  // already superseded it.
  const loadGuideFor = useCallback(
    (channel: Channel) => {
      setGuideChannel(channel);
      if (source.kind !== "xtream") {
        const guide = bulkGuidesByChannel.get(channel.epgChannelId ?? channel.id);
        setStreamProgrammes(guide ? [...guide.getProgrammes()] : []);
        setIsGuideLoading(false);
        return;
      }
      const requestId = ++guideRequestIdRef.current;
      setIsGuideLoading(true);
      loadStreamEpg(source, channel.id)
        .then((programmes) => {
          if (guideRequestIdRef.current !== requestId) return;
          setStreamProgrammes(programmes);
        })
        .catch(() => {
          if (guideRequestIdRef.current !== requestId) return;
          setStreamProgrammes([]);
        })
        .finally(() => {
          if (guideRequestIdRef.current !== requestId) return;
          setIsGuideLoading(false);
        });
    },
    [source, bulkGuidesByChannel],
  );

  // Mirrors LiveTvScreen's visibleChannels effect: an actual category
  // switch (or initial load) commits its first channel's guide immediately,
  // no debounce — only row-to-row highlighting while browsing column 2
  // (handleHighlight below) goes through EPG_DEBOUNCE_MS.
  useEffect(() => {
    setSelectedChannel((current) => {
      const next = current && visibleChannels.some((c) => c.id === current.id) ? current : (visibleChannels[0] ?? null);
      if (next) loadGuideFor(next);
      else {
        setGuideChannel(null);
        setStreamProgrammes([]);
      }
      return next;
    });
    // loadGuideFor intentionally excluded: it's stable-enough (only changes when source/bulkGuidesByChannel change) and including it would re-run this on every guide fetch it triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleChannels]);

  useEffect(() => {
    return () => {
      if (guideDebounceRef.current) clearTimeout(guideDebounceRef.current);
    };
  }, []);

  const handleHighlight = useCallback(
    (channel: Channel) => {
      if (guideDebounceRef.current) clearTimeout(guideDebounceRef.current);
      guideDebounceRef.current = setTimeout(() => loadGuideFor(channel), EPG_DEBOUNCE_MS);
    },
    [loadGuideFor],
  );

  function handleSelectProgramme(programme: EpgProgramme): void {
    if (!guideChannel) return;
    const isPast = programme.stop.getTime() < Date.now();

    if (!isPast) {
      onPlay(guideChannel.streamUrl);
      return;
    }

    if (source.kind === "xtream" && guideChannel.hasArchive) {
      const client = new XtreamClient(source);
      const durationMinutes = Math.round((programme.stop.getTime() - programme.start.getTime()) / 60000);
      const catchupUrl = client.buildCatchupUrl(guideChannel.id, Math.floor(programme.start.getTime() / 1000), durationMinutes);
      onPlay(catchupUrl);
    }
    // Past programme with no archive support: nothing playable.
  }

  useRemoteInput(platform, { onBack }, !isPlaybackOpen);

  const isInitialLoading = isChannelsLoading || isCategoriesLoading;

  if (loadError && isInitialLoading) {
    return (
      <MeshBackground>
        <div role="alert" style={{ padding: 40, color: "var(--text, #f4f4f6)" }}>
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
      <div style={{ height: "100vh", display: "flex", overflow: "hidden" }}>
        <CategorySidebar
          items={categoryItems}
          activeId={activeCategoryId}
          onSelect={setActiveCategoryId}
          contentEntryId={visibleChannels.length > 0 ? visibleChannels[0].id : undefined}
        />

        <ChannelSidebar
          channels={visibleChannels}
          activeChannelId={selectedChannel?.id}
          onHighlight={handleHighlight}
          onSelect={(channel) => {
            setSelectedChannel(channel);
            loadGuideFor(channel);
            if (streamProgrammes.length > 0) focus(epgListItemId(0));
          }}
          leftEntryId={activeCategoryId}
          rightEntryId={streamProgrammes.length > 0 ? epgListItemId(0) : undefined}
        />

        <EpgProgrammeList
          channel={guideChannel}
          programmes={streamProgrammes}
          isLoading={isGuideLoading}
          onSelectProgramme={handleSelectProgramme}
          leftEntryId={selectedChannel?.id}
        />
      </div>
    </MeshBackground>
  );
}
