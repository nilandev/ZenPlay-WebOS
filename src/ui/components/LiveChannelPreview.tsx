import { useEffect, useRef } from "react";
import type { Channel } from "@core";
import { Heart, Tv } from "lucide-react";
import { Focusable } from "../focus/Focusable.js";
import { useFocusStore } from "../focus/focus-store.js";
import { URLImage } from "./URLImage.js";
import { VideoSurface } from "./VideoSurface.js";

export interface LiveChannelPreviewProps {
  channel: Channel | null;
  streamUrl: string | null;
  onEnterFullScreen: () => void;
  /** Focus id assigned to this panel's single node — passed to ChannelSidebar as its rightEntryId. */
  focusId: string;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  /** Focus id assigned to the favourite-toggle button, directly below the preview — passed down to a favourites row below this panel, if any, as its up-neighbor entry point. */
  favoriteButtonFocusId: string;
  /** Focus id to jump to when pressing down from the favourite-toggle button — typically a favourites row's first item. */
  belowFocusId?: string;
}

const SCOPE = "content:live-preview";
const LIVE_RED = "#e0332f";
const FOCUS_RING = "0 0 0 3px var(--accent), 0 0 0 8px rgba(56,189,248,0.35), 0 0 24px 4px rgba(56,189,248,0.45)";

/**
 * Column 3 of the Live TV browse layout: a live preview of the channel
 * currently highlighted in column 2 (ChannelSidebar), registered as a single
 * focusable node so pressing OK/Select here (AC4) enters full-screen
 * playback via onEnterFullScreen. Directly below it, a channel info bar
 * (icon + name + favourite CTA + LIVE badge) and its own focusable
 * favourite-toggle button.
 */
export function LiveChannelPreview({
  channel,
  streamUrl,
  onEnterFullScreen,
  focusId,
  isFavorite,
  onToggleFavorite,
  favoriteButtonFocusId,
  belowFocusId,
}: LiveChannelPreviewProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focusedId = useFocusStore((state) => state.focusedId);

  // onEnterFullScreen/onToggleFavorite are recreated every render by the
  // owning screen (LiveTvScreen), which would otherwise force the graph
  // effect below to re-run on every render — including ones triggered by
  // focus itself moving within this same scope. clearGraph followed by
  // setGraph is not atomic from the store's point of view: the moment
  // clearGraph removes this scope, the currently-focused node (e.g. the
  // favourite button) briefly doesn't exist anywhere, so its
  // currentStillValid check fails and focusedId resets to null — then the
  // immediately-following setGraph falls back to its first node, snapping
  // focus back to the preview box every time. Reading the latest callbacks
  // from refs instead keeps onSelect current without making them effect
  // dependencies, so the graph is only rebuilt when the actual node shape
  // (ids) changes.
  const onEnterFullScreenRef = useRef(onEnterFullScreen);
  onEnterFullScreenRef.current = onEnterFullScreen;
  const onToggleFavoriteRef = useRef(onToggleFavorite);
  onToggleFavoriteRef.current = onToggleFavorite;

  useEffect(() => {
    setGraph(SCOPE, [
      { id: focusId, neighbors: { down: favoriteButtonFocusId }, onSelect: () => onEnterFullScreenRef.current() },
      { id: favoriteButtonFocusId, neighbors: { up: focusId, down: belowFocusId }, onSelect: () => onToggleFavoriteRef.current() },
    ]);
    return () => clearGraph(SCOPE);
  }, [focusId, favoriteButtonFocusId, belowFocusId, setGraph, clearGraph]);

  const isPreviewFocused = focusedId === focusId;
  const isFavoriteButtonFocused = focusedId === favoriteButtonFocusId;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <Focusable id={focusId} style={{ height: "auto" }}>
        <div
          onClick={onEnterFullScreen}
          style={{
            position: "relative",
            aspectRatio: "16 / 9",
            margin: "16px 16px 0",
            borderRadius: 12,
            overflow: "hidden",
            background: "linear-gradient(160deg, #1a1a20 0%, #0e0e12 100%)",
            cursor: "pointer",
            boxShadow: isPreviewFocused ? FOCUS_RING : "none",
            transition: "box-shadow 140ms ease-out",
          }}
        >
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Tv size={64} strokeWidth={1.25} color="rgba(255,255,255,0.18)" />
          </div>
          <VideoSurface streamUrl={streamUrl} />
        </div>
      </Focusable>

      {channel && (
        <ChannelInfoBar
          channel={channel}
          isFavorite={isFavorite}
          onToggleFavorite={onToggleFavorite}
          isFavoriteButtonFocused={isFavoriteButtonFocused}
        />
      )}
    </div>
  );
}

/**
 * Sits directly below the preview player (not overlaid on the video) —
 * channel icon + name + favourite CTA on the left, a "LIVE" badge on the
 * right, matching the LiveTvLogo wordmark's red so both read as the same
 * brand.
 */
function ChannelInfoBar({
  channel,
  isFavorite,
  onToggleFavorite,
  isFavoriteButtonFocused,
}: {
  channel: Channel;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  isFavoriteButtonFocused: boolean;
}): JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        margin: "12px 16px 0",
        padding: "10px 16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 8,
            flexShrink: 0,
            background: "rgba(255,255,255,0.06)",
          }}
        >
          <URLImage src={channel.logoUrl} alt="" seed={channel.id} objectFit="contain" />
        </div>
        <span
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: "var(--text, #f4f4f6)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {channel.name}
        </span>

        <button
          type="button"
          aria-label={isFavorite ? "Remove from favourites" : "Add to favourites"}
          onClick={onToggleFavorite}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 40,
            height: 40,
            borderRadius: "50%",
            flexShrink: 0,
            border: isFavoriteButtonFocused ? "1px solid rgba(255,255,255,0.7)" : "1px solid var(--border, #313139)",
            background: isFavoriteButtonFocused ? "rgba(255,255,255,0.14)" : "transparent",
            boxShadow: isFavoriteButtonFocused ? FOCUS_RING : "none",
            transform: isFavoriteButtonFocused ? "scale(1.08)" : "scale(1)",
            transition: "transform 140ms ease-out, box-shadow 140ms ease-out, background 140ms ease-out",
          }}
        >
          <Heart size={18} strokeWidth={2} color={isFavorite ? "#ff6b6b" : "var(--text-dim, #9a9aa4)"} fill={isFavorite ? "#ff6b6b" : "none"} />
        </button>
      </div>

      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexShrink: 0,
          padding: "5px 12px",
          borderRadius: 999,
          background: "rgba(224,51,47,0.15)",
          border: `1px solid ${LIVE_RED}`,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: LIVE_RED,
            boxShadow: `0 0 6px 1px ${LIVE_RED}`,
          }}
        />
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", color: LIVE_RED }}>LIVE</span>
      </span>
    </div>
  );
}
