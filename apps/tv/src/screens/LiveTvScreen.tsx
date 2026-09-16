import { useEffect, useMemo, useRef, useState } from "react";
import type { Channel, PlaylistSource, PlatformId, Profile } from "@iptv/core";
import { ChannelPreloader } from "@iptv/player";
import { ChannelGrid, useRemoteInput, VideoSurface } from "@iptv/ui";
import { loadChannelsByKind } from "../content-loader.js";
import { PinGate } from "./PinGate.js";

export interface LiveTvScreenProps {
  source: PlaylistSource;
  platform: PlatformId;
  profile: Profile;
}

export function LiveTvScreen({ source, platform, profile }: LiveTvScreenProps): JSX.Element {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingUnlock, setPendingUnlock] = useState<Channel | null>(null);
  const [unlockedCategoryIds, setUnlockedCategoryIds] = useState<Set<string>>(new Set());
  const preloaderRef = useRef(new ChannelPreloader());

  useEffect(() => {
    let cancelled = false;
    loadChannelsByKind(source, "live")
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

  function isLocked(channel: Channel): boolean {
    if (!profile.pinHash || !channel.groupTitle) return false;
    return profile.lockedCategoryIds.includes(channel.groupTitle) && !unlockedCategoryIds.has(channel.groupTitle);
  }

  function handleSelect(channel: Channel): void {
    if (isLocked(channel)) {
      setPendingUnlock(channel);
      return;
    }
    setActiveChannel(channel);
  }

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
        onHighlight={(channel) => !isLocked(channel) && preloaderRef.current.warm(channel.streamUrl)}
        onSelect={handleSelect}
      />
      {pendingUnlock && profile.pinHash && (
        <PinGate
          pinHash={profile.pinHash}
          title={`Unlock ${pendingUnlock.groupTitle}`}
          onUnlock={() => {
            setUnlockedCategoryIds((prev) => new Set(prev).add(pendingUnlock.groupTitle!));
            setActiveChannel(pendingUnlock);
            setPendingUnlock(null);
          }}
          onCancel={() => setPendingUnlock(null)}
        />
      )}
    </div>
  );
}
