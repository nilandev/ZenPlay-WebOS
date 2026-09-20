import { useRef } from "react";
import type { PlatformId } from "@core";
import type { PlaybackProgress } from "@player";
import { VideoSurface, useRemoteInput } from "@ui";
import { upsertContinueWatching } from "../profile-store.js";

/** Identifies what's playing for Continue Watching persistence — omitted entirely for content that shouldn't be resumed (live TV, catch-up). */
export interface PlaybackIdentity {
  profileId: string;
  contentId: string;
  contentKind: "movie" | "series-episode";
  /** Required when contentKind is "series-episode" — the episode's own id; contentId is the parent series id. */
  episodeId?: string;
}

export interface PlayerScreenProps {
  streamUrl: string;
  platform: PlatformId;
  onClose: () => void;
  /** VOD/series identity for resume tracking. Left unset for content Continue Watching doesn't apply to (live TV). */
  identity?: PlaybackIdentity;
}

/** How often a timeupdate tick is allowed to write to localStorage — timeupdate fires several times a second, far more often than resume position needs to be durable. */
const PROGRESS_WRITE_INTERVAL_MS = 5000;

/** Fullscreen playback overlay for VOD/series/catch-up streams, dismissed with back. */
export function PlayerScreen({ streamUrl, platform, onClose, identity }: PlayerScreenProps): JSX.Element {
  useRemoteInput(platform, { onBack: onClose });
  const lastWriteRef = useRef(0);

  const handleProgress = (progress: PlaybackProgress): void => {
    if (!identity) return;
    // A live/unknown-length stream has no meaningful "resume position".
    if (!Number.isFinite(progress.durationSeconds) || progress.durationSeconds <= 0) return;

    const now = Date.now();
    if (now - lastWriteRef.current < PROGRESS_WRITE_INTERVAL_MS) return;
    lastWriteRef.current = now;

    upsertContinueWatching({
      profileId: identity.profileId,
      contentId: identity.contentId,
      contentKind: identity.contentKind,
      episodeId: identity.episodeId,
      positionSeconds: progress.positionSeconds,
      durationSeconds: progress.durationSeconds,
      updatedAt: new Date().toISOString(),
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 50 }}>
      <VideoSurface streamUrl={streamUrl} onProgress={identity ? handleProgress : undefined} />
    </div>
  );
}
