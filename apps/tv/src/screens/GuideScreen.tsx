import { useEffect, useMemo, useState } from "react";
import { XtreamClient, buildChannelGuides, type Channel, type EpgProgramme, type PlatformId, type PlaylistSource } from "@iptv/core";
import { EpgGrid, useRemoteInput } from "@iptv/ui";
import { loadChannelsByKind, loadEpg } from "../content-loader.js";

export interface GuideScreenProps {
  source: PlaylistSource;
  platform: PlatformId;
  /** Live playback (programme is currently airing) or catch-up (past programme with an archive URL). */
  onPlay: (streamUrl: string) => void;
}

const WINDOW_HOURS = 3;

export function GuideScreen({ source, platform, onPlay }: GuideScreenProps): JSX.Element {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [programmes, setProgrammes] = useState<EpgProgramme[]>([]);
  const [windowStart, setWindowStart] = useState(() => roundDownToHalfHour(new Date()));

  useEffect(() => {
    loadChannelsByKind(source, "live").then(setChannels);
    loadEpg(source).then(setProgrammes);
  }, [source]);

  const guidesByChannel = useMemo(() => buildChannelGuides(programmes), [programmes]);
  const windowEnd = useMemo(() => new Date(windowStart.getTime() + WINDOW_HOURS * 3600_000), [windowStart]);

  const programmesByChannel = useMemo(() => {
    const map = new Map<string, EpgProgramme[]>();
    for (const channel of channels) {
      const key = channel.epgChannelId ?? channel.id;
      const guide = guidesByChannel.get(key);
      if (guide) map.set(channel.id, guide.getProgrammesInRange(windowStart, windowEnd));
    }
    return map;
  }, [channels, guidesByChannel, windowStart, windowEnd]);

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
    // Past programme with no archive support: nothing playable, so this is a no-op.
    // A real UI would show a toast; deferred until the design pass on this screen.
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "16px 40px 0" }}>
        <h1 style={{ fontSize: 20 }}>Guide — {windowStart.toLocaleString()}</h1>
      </div>
      <div style={{ flex: 1, overflow: "hidden" }}>
        <EpgGrid
          channels={channels}
          programmesByChannel={programmesByChannel}
          windowStart={windowStart}
          windowEnd={windowEnd}
          onSelectProgramme={handleSelectProgramme}
        />
      </div>
    </div>
  );
}

function roundDownToHalfHour(date: Date): Date {
  const rounded = new Date(date);
  rounded.setMinutes(date.getMinutes() < 30 ? 0 : 30, 0, 0);
  return rounded;
}
