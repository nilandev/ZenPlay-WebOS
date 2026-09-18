import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Channel, PlaylistSource, PlatformId } from "@core";
import { ChannelPreloader } from "@player";
import { ChannelGridSkeleton, GlassPanel, LiveOverlayGrid, useRemoteInput, VideoSurface } from "@ui";
import { loadChannelsByKind } from "../content-loader.js";
import { useCachedContent } from "../use-cached-content.js";

export interface LiveTvScreenProps {
  source: PlaylistSource;
  platform: PlatformId;
  onBack: () => void;
}

const EMPTY_CHANNELS: Channel[] = [];
const OVERLAY_DISMISS_MS = 30_000;

export function LiveTvScreen({ source, platform, onBack }: LiveTvScreenProps): JSX.Element {
  const load = useCallback(() => loadChannelsByKind(source, "live"), [source]);
  const { data: channels, isInitialLoading, error: loadError } = useCachedContent(`live:${source.id}`, load, EMPTY_CHANNELS);

  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [isOverlayVisible, setIsOverlayVisible] = useState(true);
  const preloaderRef = useRef(new ChannelPreloader());
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setActiveChannel((current) => current ?? channels[0] ?? null);
  }, [channels]);

  useEffect(() => {
    const preloader = preloaderRef.current;
    return () => preloader.dispose();
  }, []);

  // Any highlight change (arrow-key navigation across the overlay's cards)
  // counts as activity: it both keeps the panel visible and pushes the
  // 30-second inactivity dismissal back out.
  const registerActivity = useCallback(() => {
    setIsOverlayVisible(true);
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => setIsOverlayVisible(false), OVERLAY_DISMISS_MS);
  }, []);

  useEffect(() => {
    registerActivity();
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [registerActivity]);

  useRemoteInput(platform, {
    onBack: () => {
      if (isOverlayVisible) {
        setIsOverlayVisible(false);
      } else {
        onBack();
      }
    },
  });

  const streamUrl = useMemo(() => activeChannel?.streamUrl ?? null, [activeChannel]);

  function handleSelect(channel: Channel): void {
    setActiveChannel(channel);
    setIsOverlayVisible(false);
  }

  if (loadError) {
    return <div role="alert">Failed to load channels: {loadError}</div>;
  }

  if (isInitialLoading) {
    return (
      <div style={{ position: "relative", height: "100vh" }}>
        <div style={{ position: "absolute", inset: 0, background: "#000" }} />
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "20px 40px" }}>
          <ChannelGridSkeleton columns={5} rows={2} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", height: "100vh", overflow: "hidden" }}>
      <VideoSurface streamUrl={streamUrl} />

      <GlassPanel visible={isOverlayVisible}>
        <LiveOverlayGrid
          channels={channels}
          columns={5}
          onHighlight={(channel) => {
            registerActivity();
            preloaderRef.current.warm(channel.streamUrl);
          }}
          onSelect={handleSelect}
        />
      </GlassPanel>
    </div>
  );
}
