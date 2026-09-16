import { useEffect, useMemo, useRef, useState } from "react";
import {
  parseM3u,
  XtreamClient,
  type Channel,
  type PlaylistSource,
  type PlatformId,
} from "@iptv/core";
import { ChannelPreloader } from "@iptv/player";
import { ChannelGrid, useRemoteInput, VideoSurface } from "@iptv/ui";

export interface LiveTvScreenProps {
  source: PlaylistSource;
  platform: PlatformId;
}

async function loadChannelsForSource(source: PlaylistSource): Promise<Channel[]> {
  if (source.kind === "xtream") {
    const client = new XtreamClient(source);
    await client.authenticate();
    return client.getLiveChannels();
  }

  if (source.kind === "m3u-file") {
    return parseM3u(source.content).filter((c) => c.kind === "live");
  }

  const response = await fetch(source.url);
  const content = await response.text();
  return parseM3u(content).filter((c) => c.kind === "live");
}

export function LiveTvScreen({ source, platform }: LiveTvScreenProps): JSX.Element {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const preloaderRef = useRef(new ChannelPreloader());

  useEffect(() => {
    let cancelled = false;
    loadChannelsForSource(source)
      .then((loaded) => {
        if (!cancelled) {
          setChannels(loaded);
          setActiveChannel((current) => current ?? loaded[0] ?? null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  useEffect(() => {
    const preloader = preloaderRef.current;
    return () => preloader.dispose();
  }, []);

  useRemoteInput(platform, {
    onBack: () => setActiveChannel(null),
  });

  const streamUrl = useMemo(() => activeChannel?.streamUrl ?? null, [activeChannel]);

  if (loadError) {
    return <div role="alert">Failed to load channels: {loadError}</div>;
  }

  return (
    <div style={{ display: "grid", gridTemplateRows: "60vh 1fr", height: "100vh" }}>
      <VideoSurface streamUrl={streamUrl} />
      <ChannelGrid
        channels={channels}
        columns={5}
        viewportHeightPx={window.innerHeight * 0.4}
        onHighlight={(channel) => preloaderRef.current.warm(channel.streamUrl)}
        onSelect={(channel) => setActiveChannel(channel)}
      />
    </div>
  );
}
