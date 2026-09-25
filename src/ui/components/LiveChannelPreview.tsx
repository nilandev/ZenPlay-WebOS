import type { Channel, EpgProgramme, NowNext } from "@core";
import { Check, Plus, Tv } from "lucide-react";
import { Focusable } from "../focus/Focusable.js";
import { useIsFocused } from "../focus/focus-store.js";
import { SECTION_ICONS } from "../section-icons.js";
import { TV_TEXT } from "../tv-metrics.js";
import { Shimmer } from "./Shimmer.js";
import { URLImage } from "./URLImage.js";
import { VideoSurface } from "./VideoSurface.js";

export interface LiveChannelPreviewProps {
  channel: Channel | null;
  streamUrl: string | null;
  channelNumber?: number;
  isFavorite: boolean;
  /** What's on now/next for `channel`, or null when there's no guide data. */
  nowNext: NowNext | null;
  isGuideLoading: boolean;
  /** Focus id for the channel line's favourite button — the owner wires it into the focus graph (Right from the channel list). */
  favoriteButtonId: string;
  onToggleFavorite: () => void;
}

/**
 * Right-hand column of Live TV: a live 16:9 preview of the channel the list
 * has settled on, the channel line (number, logo, name, favourite, On Now),
 * and a Now & Next panel — what the viewer most wants to know while
 * flicking through channels. The video itself isn't a focus stop (OK on a
 * channel row plays it full screen); the one focusable control is the
 * favourite button in the channel line, reached with Right from the list.
 */
export function LiveChannelPreview({
  channel,
  streamUrl,
  channelNumber,
  isFavorite,
  nowNext,
  isGuideLoading,
  favoriteButtonId,
  onToggleFavorite,
}: LiveChannelPreviewProps): JSX.Element {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem", minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "flex-end", maxWidth: "70rem", marginBottom: "-0.75rem" }}>
        <OnNowBadge />
      </div>
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: "70rem",
          aspectRatio: "16 / 9",
          borderRadius: "1.25rem",
          overflow: "hidden",
          background: "linear-gradient(160deg, #1a1a20 0%, #0e0e12 100%)",
          boxShadow: "0 1.5rem 3rem rgba(0,0,0,0.45)",
        }}
      >
        {/* Just the dark frame behind the video — VideoSurface draws its own loading animation, so no placeholder icon here. */}
        <VideoSurface streamUrl={streamUrl} />
      </div>

      {channel && (
        <div style={{ maxWidth: "70rem" }}>
          <ChannelLine
            channel={channel}
            channelNumber={channelNumber}
            isFavorite={isFavorite}
            favoriteButtonId={favoriteButtonId}
            onToggleFavorite={onToggleFavorite}
          />
          <NowNextPanel nowNext={nowNext} isLoading={isGuideLoading} />
        </div>
      )}
    </div>
  );
}

function ChannelLine({
  channel,
  channelNumber,
  isFavorite,
  favoriteButtonId,
  onToggleFavorite,
}: {
  channel: Channel;
  channelNumber?: number;
  isFavorite: boolean;
  favoriteButtonId: string;
  onToggleFavorite: () => void;
}): JSX.Element {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
      <div style={{ width: "4.5rem", height: "4.5rem", borderRadius: "0.75rem", flexShrink: 0, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
        <URLImage src={channel.logoUrl} alt="" seed={channel.id} objectFit="contain" placeholderIcon={SECTION_ICONS.live} />
      </div>
      {channelNumber !== undefined && (
        <span style={{ fontSize: "1.75rem", fontWeight: 700, color: "rgba(235,236,242,0.55)", fontVariantNumeric: "tabular-nums" }}>{channelNumber}</span>
      )}
      <span style={{ fontSize: "2rem", fontWeight: 800, color: "#fff", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {channel.name}
      </span>
      <FavoriteButton id={favoriteButtonId} isFavorite={isFavorite} onToggle={onToggleFavorite} />
    </div>
  );
}

/**
 * "+ My List" / "✓ My List": adds or removes the previewed channel from the
 * user's favourites — same wording and icons as the series detail page's
 * My List button. Sits at the right end of the channel line. Solid white
 * when focused (the app's primary-button style). The Focusable is sized to the button — its default 100%
 * width would stretch it across the line.
 */
function FavoriteButton({ id, isFavorite, onToggle }: { id: string; isFavorite: boolean; onToggle: () => void }): JSX.Element {
  const isFocused = useIsFocused(id);
  return (
    <Focusable id={id} style={{ width: "auto", height: "auto", flexShrink: 0, marginLeft: "auto" }}>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={isFavorite}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.625rem",
          padding: "0.75rem 1.5rem",
          border: "none",
          borderRadius: 999,
          fontSize: TV_TEXT,
          fontWeight: 700,
          whiteSpace: "nowrap",
          background: isFocused ? "#ffffff" : "rgba(255,255,255,0.12)",
          color: isFocused ? "#0b0c10" : "#ffffff",
          boxShadow: isFocused ? "0 1rem 2rem -0.5rem rgba(0,0,0,0.6)" : "inset 0 0 0 1px rgba(255,255,255,0.1)",
          transform: isFocused ? "scale(1.06)" : "scale(1)",
          transition: "transform 200ms cubic-bezier(0.2, 0.9, 0.3, 1)",
          cursor: "pointer",
        }}
      >
        {isFavorite ? <Check size="1.5rem" strokeWidth={2.5} /> : <Plus size="1.5rem" strokeWidth={2.5} />}
        My List
      </button>
    </Focusable>
  );
}

/**
 * "On Now" marker above the preview's top-right corner (not over the
 * picture, where broadcasters put their own logo). Deliberately not "LIVE"
 * with a red dot: that signals a live event, and most of what a channel
 * airs is recorded — what's true is that this is what the channel is
 * showing right now.
 */
function OnNowBadge(): JSX.Element {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.375rem 1rem",
        borderRadius: 999,
        background: "rgba(255,255,255,0.12)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.2)",
      }}
    >
      <Tv size="1.25rem" strokeWidth={2.25} color="#fff" aria-hidden />
      <span style={{ fontSize: "1.125rem", fontWeight: 700, color: "#fff" }}>On Now</span>
    </span>
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * NOW: time range, title, a progress bar through the programme and a
 * two-line synopsis. NEXT: start time and title. Renders nothing when the
 * channel has no guide data, so channels without EPG just show their line.
 */
function NowNextPanel({ nowNext, isLoading }: { nowNext: NowNext | null; isLoading: boolean }): JSX.Element | null {
  if (isLoading) {
    return (
      <div style={{ marginTop: "1.75rem" }}>
        <Shimmer width="30rem" height="1.75rem" style={{ marginBottom: "1rem" }} />
        <Shimmer width="46rem" height="1.25rem" />
      </div>
    );
  }
  if (!nowNext) return null;
  const { now, next } = nowNext;

  return (
    <div style={{ marginTop: "1.75rem" }}>
      {now && <NowProgramme programme={now} />}
      {next && (
        <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", marginTop: now ? "1.25rem" : 0, fontSize: TV_TEXT, color: "rgba(235,236,242,0.7)" }}>
          <ProgrammeLabel text="NEXT" />
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatTime(next.start)}</span>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#fff", fontWeight: 600 }}>{next.title}</span>
        </div>
      )}
    </div>
  );
}

function NowProgramme({ programme }: { programme: EpgProgramme }): JSX.Element {
  const total = programme.stop.getTime() - programme.start.getTime();
  const progress = total > 0 ? Math.min(1, Math.max(0, (Date.now() - programme.start.getTime()) / total)) : 0;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "1rem" }}>
        <ProgrammeLabel text="NOW" accent />
        <span style={{ fontSize: TV_TEXT, color: "rgba(235,236,242,0.7)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
          {formatTime(programme.start)} – {formatTime(programme.stop)}
        </span>
        <span style={{ fontSize: "1.75rem", fontWeight: 800, color: "#fff", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {programme.title}
        </span>
      </div>
      <div aria-hidden style={{ marginTop: "0.875rem", height: "0.375rem", borderRadius: 999, background: "rgba(255,255,255,0.15)", overflow: "hidden" }}>
        <div style={{ width: `${progress * 100}%`, height: "100%", borderRadius: 999, background: "var(--accent, #38bdf8)" }} />
      </div>
      {programme.description && (
        <p
          style={{
            margin: "0.875rem 0 0",
            fontSize: TV_TEXT,
            lineHeight: 1.45,
            color: "rgba(235,236,242,0.75)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {programme.description}
        </p>
      )}
    </div>
  );
}

function ProgrammeLabel({ text, accent = false }: { text: string; accent?: boolean }): JSX.Element {
  return (
    <span
      style={{
        flexShrink: 0,
        fontSize: "1rem",
        fontWeight: 800,
        letterSpacing: "0.08em",
        padding: "0.25rem 0.625rem",
        borderRadius: "0.375rem",
        background: accent ? "var(--accent, #38bdf8)" : "rgba(255,255,255,0.12)",
        color: accent ? "#062028" : "rgba(235,236,242,0.85)",
      }}
    >
      {text}
    </span>
  );
}
