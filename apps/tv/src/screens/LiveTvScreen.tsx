import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Channel, PlaylistSource, PlatformId, Profile } from "@iptv/core";
import { ChannelPreloader } from "@iptv/player";
import { ChannelGrid, ChannelGridSkeleton, useRemoteInput, VideoSurface } from "@iptv/ui";
import { loadChannelsByKind } from "../content-loader.js";
import { useCachedContent } from "../use-cached-content.js";
import { PinGate } from "./PinGate.js";

export interface LiveTvScreenProps {
  source: PlaylistSource;
  platform: PlatformId;
  profile: Profile;
}

const EMPTY_CHANNELS: Channel[] = [];

export function LiveTvScreen({ source, platform, profile }: LiveTvScreenProps): JSX.Element {
  const load = useCallback(() => loadChannelsByKind(source, "live"), [source]);
  const { data: channels, isInitialLoading, error: loadError } = useCachedContent(`live:${source.id}`, load, EMPTY_CHANNELS);

  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [pendingUnlock, setPendingUnlock] = useState<Channel | null>(null);
  const [unlockedCategoryIds, setUnlockedCategoryIds] = useState<Set<string>>(new Set());
  const preloaderRef = useRef(new ChannelPreloader());

  useEffect(() => {
    setActiveChannel((current) => current ?? channels[0] ?? null);
  }, [channels]);

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

  if (isInitialLoading) {
    return (
      <div style={{ display: "grid", gridTemplateRows: "60vh 1fr", height: "100vh" }}>
        <div style={{ background: "#000" }} />
        <ChannelGridSkeleton columns={5} />
      </div>
    );
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
