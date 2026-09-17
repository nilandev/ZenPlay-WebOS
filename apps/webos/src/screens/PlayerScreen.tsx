import type { PlatformId } from "@iptv/core";
import { VideoSurface, useRemoteInput } from "@iptv/ui";

export interface PlayerScreenProps {
  streamUrl: string;
  platform: PlatformId;
  onClose: () => void;
}

/** Fullscreen playback overlay for VOD/series/catch-up streams, dismissed with back. */
export function PlayerScreen({ streamUrl, platform, onClose }: PlayerScreenProps): JSX.Element {
  useRemoteInput(platform, { onBack: onClose });

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 50 }}>
      <VideoSurface streamUrl={streamUrl} />
    </div>
  );
}
