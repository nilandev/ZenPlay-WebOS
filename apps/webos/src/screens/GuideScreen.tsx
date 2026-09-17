import { useCallback, useMemo, useState } from "react";
import { XtreamClient, buildChannelGuides, type Channel, type EpgProgramme, type PlatformId, type PlaylistSource } from "@iptv/core";
import { CategorySidebar, EpgGrid, EpgGridSkeleton, ProgrammePreview, useRemoteInput } from "@iptv/ui";
import { loadChannelsByKind, loadEpg } from "../content-loader.js";
import { useCachedContent } from "../use-cached-content.js";

export interface GuideScreenProps {
  source: PlaylistSource;
  platform: PlatformId;
  /** Live playback (programme is currently airing) or catch-up (past programme with an archive URL). */
  onPlay: (streamUrl: string) => void;
}

const WINDOW_HOURS = 3;
const ALL_CATEGORY_ID = "__all__";
const EMPTY_CHANNELS: Channel[] = [];
const EMPTY_PROGRAMMES: EpgProgramme[] = [];

function groupChannelsByCategory(channels: Channel[]): Array<{ id: string; label: string; channels: Channel[] }> {
  const byGroup = new Map<string, Channel[]>();
  for (const channel of channels) {
    const key = channel.groupTitle ?? "Uncategorized";
    const list = byGroup.get(key);
    if (list) list.push(channel);
    else byGroup.set(key, [channel]);
  }
  return Array.from(byGroup.entries()).map(([label, groupChannels]) => ({ id: label, label, channels: groupChannels }));
}

export function GuideScreen({ source, platform, onPlay }: GuideScreenProps): JSX.Element {
  const loadChannels = useCallback(() => loadChannelsByKind(source, "live"), [source]);
  const { data: channels, isInitialLoading: isChannelsLoading } = useCachedContent(
    `guide-channels:${source.id}`,
    loadChannels,
    EMPTY_CHANNELS,
  );

  const loadProgrammes = useCallback(() => loadEpg(source), [source]);
  const { data: programmes, isInitialLoading: isEpgLoading } = useCachedContent(
    `guide-epg:${source.id}`,
    loadProgrammes,
    EMPTY_PROGRAMMES,
  );

  const [windowStart, setWindowStart] = useState(() => roundDownToHalfHour(new Date()));
  const [activeCategoryId, setActiveCategoryId] = useState(ALL_CATEGORY_ID);
  const [focused, setFocused] = useState<{ channel: Channel; programme: EpgProgramme } | null>(null);

  const categories = useMemo(() => groupChannelsByCategory(channels), [channels]);
  const categoryItems = useMemo(
    () => [
      { id: ALL_CATEGORY_ID, label: "All Channels", count: channels.length },
      ...categories.map((c) => ({ id: c.id, label: c.label, count: c.channels.length })),
    ],
    [categories, channels.length],
  );

  const visibleChannels = useMemo(() => {
    if (activeCategoryId === ALL_CATEGORY_ID) return channels;
    return categories.find((c) => c.id === activeCategoryId)?.channels ?? [];
  }, [activeCategoryId, categories, channels]);

  const guidesByChannel = useMemo(() => buildChannelGuides(programmes), [programmes]);
  const windowEnd = useMemo(() => new Date(windowStart.getTime() + WINDOW_HOURS * 3600_000), [windowStart]);

  const programmesByChannel = useMemo(() => {
    const map = new Map<string, EpgProgramme[]>();
    for (const channel of visibleChannels) {
      const key = channel.epgChannelId ?? channel.id;
      const guide = guidesByChannel.get(key);
      if (guide) map.set(channel.id, guide.getProgrammesInRange(windowStart, windowEnd));
    }
    return map;
  }, [visibleChannels, guidesByChannel, windowStart, windowEnd]);

  useRemoteInput(platform, {
    onChannelUp: () => setWindowStart((prev) => new Date(prev.getTime() - WINDOW_HOURS * 3600_000)),
    onChannelDown: () => setWindowStart((prev) => new Date(prev.getTime() + WINDOW_HOURS * 3600_000)),
  });

  function handleSelectProgramme(channel: Channel, programme: EpgProgramme): void {
    const isPast = programme.stop.getTime() < Date.now();

    if (!isPast) {
      onPlay(channel.streamUrl);
      return;
    }

    if (source.kind === "xtream" && channel.hasArchive) {
      const client = new XtreamClient(source);
      const durationMinutes = Math.round((programme.stop.getTime() - programme.start.getTime()) / 60000);
      const catchupUrl = client.buildCatchupUrl(channel.id, Math.floor(programme.start.getTime() / 1000), durationMinutes);
      onPlay(catchupUrl);
    }
    // Past programme with no archive support: nothing playable — the preview
    // panel already explains this (see ProgrammePreview's isPast branch).
  }

  const isInitialLoading = isChannelsLoading || isEpgLoading;

  return (
    <div style={{ height: "calc(100vh - 76px)", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "16px 40px 12px", display: "flex", alignItems: "baseline", gap: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Guide</h1>
        <span style={{ fontSize: 14, color: "var(--text-dim)" }}>
          {windowStart.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} ·{" "}
          {windowStart.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} –{" "}
          {windowEnd.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button type="button" onClick={() => setWindowStart((prev) => new Date(prev.getTime() - WINDOW_HOURS * 3600_000))}>
            ← Earlier
          </button>
          <button type="button" onClick={() => setWindowStart((prev) => new Date(prev.getTime() + WINDOW_HOURS * 3600_000))}>
            Later →
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden", borderTop: "1px solid var(--border)" }}>
        {isInitialLoading ? (
          <EpgGridSkeleton />
        ) : (
          <>
            <CategorySidebar
              items={categoryItems}
              activeId={activeCategoryId}
              onSelect={setActiveCategoryId}
              contentEntryId={visibleChannels.length > 0 ? `epg:${visibleChannels[0].id}:0` : undefined}
            />

            <div style={{ flex: 1, overflow: "hidden" }}>
              <EpgGrid
                channels={visibleChannels}
                programmesByChannel={programmesByChannel}
                windowStart={windowStart}
                windowEnd={windowEnd}
                onFocusProgramme={(channel, programme) => setFocused({ channel, programme })}
                onSelectProgramme={handleSelectProgramme}
                sidebarEntryId={activeCategoryId}
              />
            </div>

            <ProgrammePreview channel={focused?.channel ?? null} programme={focused?.programme ?? null} />
          </>
        )}
      </div>
    </div>
  );
}

function roundDownToHalfHour(date: Date): Date {
  const rounded = new Date(date);
  rounded.setMinutes(date.getMinutes() < 30 ? 0 : 30, 0, 0);
  return rounded;
}
