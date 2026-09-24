import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, Pause, Play, SkipForward, Subtitles } from "lucide-react";
import type { AudioTrackInfo, SubtitleTrackInfo } from "@player";
import { buildShelfFocusGraph } from "../focus/build-shelf-graph.js";
import { useFocusStore } from "../focus/focus-store.js";
import { glassBlur } from "../perf-tier.js";

const SCOPE = "player-controls";

const BACK_ID = "player-back";
const SEEK_ROW_ID = "seek-bar";
const PLAY_PAUSE_ID = "play-pause";
const AUDIO_SUBTITLES_ID = "audio-subtitles";
const NEXT_EPISODE_ID = "next-episode";

/** Seconds jumped per left/right D-pad press — matches Netflix/most streaming apps' 10s convention. */
export const SEEK_STEP_SECONDS = 10;

/**
 * Shared focus indicator for every control in this overlay (buttons, the
 * seek bar, the Next Episode card): a crisp accent ring plus a soft outer
 * glow, not the ring alone. The ring by itself (a thin 3px accent-colored
 * line) reads fine against a plain mockup background but gets lost against
 * bright/high-contrast real video content behind a translucent gradient —
 * the added blurred glow keeps the focused control legible regardless of
 * what's playing behind it, which is what a TV-distance viewer actually
 * needs to tell "this one is selected" at a glance.
 */
const FOCUS_RING = "0 0 0 3px var(--accent), 0 0 0 8px rgba(56,189,248,0.35), 0 0 24px 4px rgba(56,189,248,0.45)";

/** Next Episode only appears once this many seconds remain — matches Netflix's "next episode" timing rather than being available for the whole runtime. */
export const NEXT_EPISODE_WINDOW_SECONDS = 120;

export interface PlaybackControlsProps {
  title: string;
  subtitle?: string;
  isPlaying: boolean;
  positionSeconds: number;
  durationSeconds: number;
  audioTracks: AudioTrackInfo[];
  activeAudioTrackId: number | null;
  subtitleTracks: SubtitleTrackInfo[];
  /** null means "off". */
  activeSubtitleTrackId: number | null;
  hasNextEpisode: boolean;
  /** Live TV/catch-up-at-live-edge: hides the scrubbable seek bar/time and left/right seeking, showing a "LIVE" badge next to Play/Pause instead. */
  isLive?: boolean;
  onBack: () => void;
  onTogglePlayPause: () => void;
  onSeekBy: (deltaSeconds: number) => void;
  onSeekTo: (seconds: number) => void;
  onSelectAudioTrack: (id: number) => void;
  onSelectSubtitleTrack: (id: number | null) => void;
  onNextEpisode: () => void;
  /** Any focus/select activity inside the overlay counts as user activity — used by PlayerScreen to reset its auto-hide timer. */
  onActivity: () => void;
}

function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Netflix-style playback overlay for VOD/series: a top bar (back + title)
 * and a bottom bar (play/pause + scrubbable progress row), both drawn as
 * subtle gradient fades rather than a solid/blurred card — the video stays
 * fully visible through them, same as Netflix's own TV player chrome. The
 * two bars fade in/out together (driven by the parent's areControlsVisible),
 * but are visually and structurally independent, matching "show player
 * control both top and bottom section" rather than one combined panel.
 *
 * Left/right D-pad always seeks by SEEK_STEP_SECONDS while a menu isn't
 * open — not just while the seek bar itself has focus — mirroring Netflix's
 * own player, where left/right is a global scrub shortcut rather than
 * something that only works on one focused row. Up/down still move D-pad
 * focus between the back button, the seek bar, and the button row normally.
 */
export function PlaybackControls(props: PlaybackControlsProps): JSX.Element {
  const {
    title,
    subtitle,
    isPlaying,
    positionSeconds,
    durationSeconds,
    audioTracks,
    activeAudioTrackId,
    subtitleTracks,
    activeSubtitleTrackId,
    hasNextEpisode,
    isLive = false,
    onBack,
    onTogglePlayPause,
    onSeekBy,
    onSeekTo,
    onSelectAudioTrack,
    onSelectSubtitleTrack,
    onNextEpisode,
    onActivity,
  } = props;

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focusedId = useFocusStore((state) => state.focusedId);
  const focus = useFocusStore((state) => state.focus);

  const remainingSeconds = durationSeconds - positionSeconds;
  const isNextEpisodeDue = hasNextEpisode && Number.isFinite(remainingSeconds) && remainingSeconds <= NEXT_EPISODE_WINDOW_SECONDS;

  // Next Episode's node lives in this same graph-building effect/scope
  // (rather than registering its own separate scope from within
  // NextEpisodeCard) specifically so it can never race
  // PlaybackControls' own registration for "who gets initial focus" —
  // setGraph only falls back to a scope's first node when nothing is
  // currently focused anywhere, and two sibling effects mounting in the
  // same React commit (which does happen here) can't be relied on to run
  // in a particular order relative to each other. One scope, one
  // registration, PLAY_PAUSE_ID always wins initial focus.
  const buttonRow = useMemo(() => {
    const row = [PLAY_PAUSE_ID, AUDIO_SUBTITLES_ID];
    if (isNextEpisodeDue) row.push(NEXT_EPISODE_ID);
    return row;
  }, [isNextEpisodeDue]);

  useEffect(() => {
    const rows = isLive ? [[BACK_ID], buttonRow] : [[BACK_ID], [SEEK_ROW_ID], buttonRow];
    const nodes = buildShelfFocusGraph(rows);
    const withSelect = nodes.map((node) => ({
      ...node,
      onSelect: () => {
        onActivity();
        switch (node.id) {
          case BACK_ID:
            onBack();
            break;
          case PLAY_PAUSE_ID:
            onTogglePlayPause();
            break;
          case AUDIO_SUBTITLES_ID:
            setIsMenuOpen(true);
            break;
          case NEXT_EPISODE_ID:
            onNextEpisode();
            break;
          default:
            break;
        }
      },
    }));
    setGraph(SCOPE, withSelect, PLAY_PAUSE_ID);
    return () => clearGraph(SCOPE);
    // onActivity/onTogglePlayPause/etc. are stable-enough closures recreated
    // each render from PlayerScreen's own state; re-registering the graph
    // every render is cheap (a handful of nodes) and keeps handlers current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buttonRow, isLive, setGraph, clearGraph]);

  // Left/right always nudges playback position by SEEK_STEP_SECONDS,
  // regardless of which control has focus — this is what makes rewind/
  // fast-forward feel like Netflix's own remote-driven scrubbing rather
  // than something that only works on one specific row. Only suppressed
  // while the Audio & Subtitles menu owns arrow-key input (it uses
  // up/down for its own list navigation and has no left/right meaning),
  // and while Next Episode is focused (so left/right there behaves like
  // any other single-item row instead of double-booking the same keys).
  useEffect(() => {
    if (isLive || isMenuOpen || focusedId === NEXT_EPISODE_ID) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onActivity();
        onSeekBy(-SEEK_STEP_SECONDS);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        onActivity();
        onSeekBy(SEEK_STEP_SECONDS);
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [isLive, isMenuOpen, focusedId, onSeekBy, onActivity]);

  const progressRatio = durationSeconds > 0 ? Math.min(1, Math.max(0, positionSeconds / durationSeconds)) : 0;

  return (
    <>
      <TopBar isBackFocused={focusedId === BACK_ID} title={title} subtitle={subtitle} onBack={onBack} />

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: "72px 48px 32px",
          background: "linear-gradient(0deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.45) 55%, rgba(0,0,0,0) 100%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <IconButton id={PLAY_PAUSE_ID} isFocused={focusedId === PLAY_PAUSE_ID} onClick={onTogglePlayPause} label={isPlaying ? "Pause" : "Play"} big>
            {isPlaying ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" />}
          </IconButton>

          {isLive ? (
            <>
              <LiveBadge />
              <div style={{ flex: 1 }} />
            </>
          ) : (
            <>
              <span style={{ fontSize: 15, color: "var(--text-dim)", minWidth: 44, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {formatTime(positionSeconds)}
              </span>

              <div style={{ flex: 1 }}>
                <SeekBar
                  isFocused={focusedId === SEEK_ROW_ID}
                  progressRatio={progressRatio}
                  onScrub={(ratio) => {
                    onActivity();
                    onSeekTo(ratio * durationSeconds);
                  }}
                />
              </div>

              <span style={{ fontSize: 15, color: "var(--text-dim)", minWidth: 44, fontVariantNumeric: "tabular-nums" }}>
                {Number.isFinite(remainingSeconds) ? `-${formatTime(Math.max(0, remainingSeconds))}` : formatTime(durationSeconds)}
              </span>
            </>
          )}

          <IconButton
            id={AUDIO_SUBTITLES_ID}
            isFocused={focusedId === AUDIO_SUBTITLES_ID}
            onClick={() => setIsMenuOpen(true)}
            label="Audio & Subtitles"
          >
            <Subtitles size={22} />
          </IconButton>
        </div>
      </div>

      {isNextEpisodeDue && (
        <NextEpisodeCard isFocused={focusedId === NEXT_EPISODE_ID} onClick={onNextEpisode} />
      )}

      {isMenuOpen && (
        <AudioSubtitlesMenu
          audioTracks={audioTracks}
          activeAudioTrackId={activeAudioTrackId}
          subtitleTracks={subtitleTracks}
          activeSubtitleTrackId={activeSubtitleTrackId}
          onSelectAudioTrack={(id) => {
            onActivity();
            onSelectAudioTrack(id);
          }}
          onSelectSubtitleTrack={(id) => {
            onActivity();
            onSelectSubtitleTrack(id);
          }}
          onClose={() => {
            setIsMenuOpen(false);
            focus(AUDIO_SUBTITLES_ID);
          }}
        />
      )}
    </>
  );
}

/**
 * Netflix's own player chrome puts a back chevron at top-left and the
 * title/episode name stacked at top-right — a two-line layout (show
 * title, then episode name) rather than the single title+subtitle line
 * the bottom bar used to carry. Same subtle top-down gradient fade as the
 * bottom bar, not a solid panel.
 */
function TopBar({
  isBackFocused,
  title,
  subtitle,
  onBack,
}: {
  isBackFocused: boolean;
  title: string;
  subtitle?: string;
  onBack: () => void;
}): JSX.Element {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        padding: "28px 48px",
        background: "linear-gradient(180deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.35) 60%, rgba(0,0,0,0) 100%)",
      }}
    >
      <button
        type="button"
        aria-label="Back"
        data-focus-id={BACK_ID}
        onClick={onBack}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 44,
          height: 44,
          borderRadius: "50%",
          border: isBackFocused ? "1px solid rgba(255,255,255,0.7)" : "1px solid rgba(255,255,255,0.14)",
          background: isBackFocused ? "rgba(255,255,255,0.16)" : "transparent",
          color: "var(--text)",
          transform: isBackFocused ? "scale(1.1)" : "scale(1)",
          boxShadow: isBackFocused ? FOCUS_RING : "none",
          transition: "transform 140ms ease-out, box-shadow 140ms ease-out, background 140ms ease-out",
          flexShrink: 0,
        }}
      >
        <ArrowLeft size={22} />
      </button>

      <div style={{ textAlign: "right", maxWidth: "70%" }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}>{title}</div>
        {subtitle && (
          <div style={{ fontSize: 15, color: "var(--text-dim)", marginTop: 4, textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}>{subtitle}</div>
        )}
      </div>
    </div>
  );
}

function IconButton({
  id,
  isFocused,
  onClick,
  label,
  children,
  big,
}: {
  id: string;
  isFocused: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  big?: boolean;
}): JSX.Element {
  const size = big ? 56 : 44;
  return (
    <button
      type="button"
      aria-label={label}
      data-focus-id={id}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        border: isFocused ? "1px solid rgba(255,255,255,0.7)" : "1px solid rgba(255,255,255,0.14)",
        background: isFocused ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.06)",
        color: "var(--text)",
        transform: isFocused ? "scale(1.1)" : "scale(1)",
        boxShadow: isFocused ? FOCUS_RING : "none",
        transition: "transform 140ms ease-out, box-shadow 140ms ease-out, background 140ms ease-out",
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

function SeekBar({
  isFocused,
  progressRatio,
  onScrub,
}: {
  isFocused: boolean;
  progressRatio: number;
  onScrub: (ratio: number) => void;
}): JSX.Element {
  return (
    <div
      data-focus-id={SEEK_ROW_ID}
      role="slider"
      aria-valuenow={Math.round(progressRatio * 100)}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        onScrub((event.clientX - rect.left) / rect.width);
      }}
      style={{
        position: "relative",
        width: "100%",
        height: isFocused ? 8 : 5,
        borderRadius: 999,
        background: "rgba(255,255,255,0.22)",
        cursor: "pointer",
        // The bar's own height/thumb-size change (below) reads too subtly
        // on its own — same FOCUS_RING glow the buttons use, applied to the
        // track itself, so "the seek row is focused" is as unambiguous as
        // any button being focused rather than needing a much closer look.
        boxShadow: isFocused ? FOCUS_RING : "none",
        transition: "height 120ms ease-out, box-shadow 140ms ease-out",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          width: `${progressRatio * 100}%`,
          borderRadius: 999,
          background: "var(--accent)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: `${progressRatio * 100}%`,
          width: isFocused ? 18 : 0,
          height: isFocused ? 18 : 0,
          borderRadius: "50%",
          background: "var(--accent)",
          boxShadow: isFocused ? "0 0 0 3px rgba(255,255,255,0.5)" : "none",
          transform: "translate(-50%, -50%)",
          transition: "width 120ms ease-out, height 120ms ease-out",
        }}
      />
    </div>
  );
}

/**
 * Tag-style "LIVE" indicator shown next to Play/Pause in place of the seek
 * bar for live streams — a red badge with a glowing dot, distinct from
 * FavoriteHeart's icon-only pill (this one carries text, since "LIVE" itself
 * is the signal, not an icon standing in for it).
 */
function LiveBadge(): JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 16px",
        borderRadius: 999,
        background: "rgba(220,38,38,0.18)",
        border: "1px solid rgba(248,113,113,0.5)",
        flexShrink: 0,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "#f87171",
          boxShadow: "0 0 8px 2px rgba(248,113,113,0.8)",
        }}
      />
      <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.06em", color: "#f87171" }}>LIVE</span>
    </div>
  );
}

/**
 * Netflix-style "next episode" card: slides/fades in from the bottom-right
 * once NEXT_EPISODE_WINDOW_SECONDS remain (see isNextEpisodeDue above),
 * rather than sitting in the button row for the whole runtime. Pure
 * rendering component — its focus node (NEXT_EPISODE_ID) is registered
 * alongside the rest of the button row in PlaybackControls' own single
 * graph-building effect (see buttonRow above), not from a separate effect
 * here, so it can never race that registration for initial D-pad focus.
 */
function NextEpisodeCard({ isFocused, onClick }: { isFocused: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      data-focus-id={NEXT_EPISODE_ID}
      onClick={onClick}
      style={{
        position: "absolute",
        right: 48,
        bottom: 140,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 22px",
        borderRadius: 10,
        border: isFocused ? "1px solid rgba(255,255,255,0.8)" : "1px solid rgba(255,255,255,0.2)",
        background: isFocused ? "rgba(255,255,255,0.95)" : "rgba(20,20,24,0.7)",
        color: isFocused ? "#0b0b0f" : "var(--text)",
        fontSize: 16,
        fontWeight: 700,
        boxShadow: isFocused ? `0 12px 32px -8px rgba(0,0,0,0.6), ${FOCUS_RING}` : "0 8px 24px -8px rgba(0,0,0,0.5)",
        transform: isFocused ? "scale(1.04)" : "scale(1)",
        transition: "transform 160ms ease-out, box-shadow 160ms ease-out, background 160ms ease-out, color 160ms ease-out",
        animation: "player-next-episode-in 320ms cubic-bezier(0.2, 0.8, 0.3, 1)",
      }}
    >
      Next Episode <SkipForward size={18} fill="currentColor" />
      <style>{`
        @keyframes player-next-episode-in {
          from { opacity: 0; transform: translateY(16px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </button>
  );
}

function AudioSubtitlesMenu({
  audioTracks,
  activeAudioTrackId,
  subtitleTracks,
  activeSubtitleTrackId,
  onSelectAudioTrack,
  onSelectSubtitleTrack,
  onClose,
}: {
  audioTracks: AudioTrackInfo[];
  activeAudioTrackId: number | null;
  subtitleTracks: SubtitleTrackInfo[];
  activeSubtitleTrackId: number | null;
  onSelectAudioTrack: (id: number) => void;
  onSelectSubtitleTrack: (id: number | null) => void;
  onClose: () => void;
}): JSX.Element {
  type MenuOption = { key: string; label: string; isActive: boolean; onSelect: () => void };
  const audioOptions: MenuOption[] = audioTracks.map((track) => ({
    key: `audio:${track.id}`,
    label: track.label,
    isActive: track.id === activeAudioTrackId,
    onSelect: () => onSelectAudioTrack(track.id),
  }));
  const subtitleOptions: MenuOption[] = [
    { key: "subtitle:off", label: "Off", isActive: activeSubtitleTrackId === null, onSelect: () => onSelectSubtitleTrack(null) },
    ...subtitleTracks.map((track) => ({
      key: `subtitle:${track.id}`,
      label: track.label,
      isActive: track.id === activeSubtitleTrackId,
      onSelect: () => onSelectSubtitleTrack(track.id),
    })),
  ];

  const allIds = ["close", ...audioOptions.map((o) => o.key), ...subtitleOptions.map((o) => o.key)];
  const [focusedKey, setFocusedKey] = useState(allIds[0]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const index = allIds.indexOf(focusedKey);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setFocusedKey(allIds[Math.min(allIds.length - 1, index + 1)]);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setFocusedKey(allIds[Math.max(0, index - 1)]);
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (focusedKey === "close") {
          onClose();
          return;
        }
        [...audioOptions, ...subtitleOptions].find((o) => o.key === focusedKey)?.onSelect();
      } else if (event.key === "Escape" || event.key === "Backspace") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedKey, allIds.join(","), onClose]);

  return (
    <div
      style={{
        position: "absolute",
        right: 48,
        bottom: 160,
        width: 320,
        maxHeight: "60vh",
        overflowY: "auto",
        padding: 16,
        borderRadius: 16,
        background: "linear-gradient(160deg, rgba(32,32,38,0.92) 0%, rgba(18,18,22,0.96) 100%)",
        ...glassBlur("blur(24px) saturate(160%)"),
        border: "1px solid rgba(255,255,255,0.16)",
        boxShadow: "0 20px 60px -12px rgba(0,0,0,0.7)",
        zIndex: 60,
      }}
    >
      <MenuHeader isFocused={focusedKey === "close"} onClick={onClose} />

      <MenuSection title="Audio">
        {audioOptions.length === 0 ? (
          <MenuEmpty />
        ) : (
          audioOptions.map((option) => (
            <MenuRow key={option.key} option={option} isFocused={focusedKey === option.key} onHover={() => setFocusedKey(option.key)} />
          ))
        )}
      </MenuSection>

      <MenuSection title="Subtitles">
        {subtitleOptions.map((option) => (
          <MenuRow key={option.key} option={option} isFocused={focusedKey === option.key} onHover={() => setFocusedKey(option.key)} />
        ))}
      </MenuSection>
    </div>
  );
}

function MenuHeader({ isFocused, onClick }: { isFocused: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        width: "100%",
        padding: "6px 4px",
        marginBottom: 8,
        borderRadius: 8,
        border: "none",
        background: isFocused ? "rgba(255,255,255,0.12)" : "transparent",
        color: "var(--text)",
        fontSize: 14,
        fontWeight: 600,
      }}
    >
      <ChevronLeft size={18} /> Audio &amp; Subtitles
    </button>
  );
}

function MenuSection({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-dim)", padding: "4px 4px" }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function MenuEmpty(): JSX.Element {
  return <div style={{ padding: "6px 4px", fontSize: 13, color: "var(--text-dim)" }}>Not available</div>;
}

function MenuRow({
  option,
  isFocused,
  onHover,
}: {
  option: { label: string; isActive: boolean; onSelect: () => void };
  isFocused: boolean;
  onHover: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={option.onSelect}
      onMouseEnter={onHover}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        padding: "10px 10px",
        borderRadius: 8,
        border: "none",
        background: isFocused ? "rgba(255,255,255,0.14)" : "transparent",
        color: option.isActive ? "var(--accent)" : "var(--text)",
        fontSize: 14,
        fontWeight: option.isActive ? 700 : 500,
        textAlign: "left",
      }}
    >
      <span>{option.label}</span>
      {option.isActive && <span>●</span>}
    </button>
  );
}
