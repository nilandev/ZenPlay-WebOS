import { useEffect, useMemo, useRef } from "react";
import { Check, FastForward, ListVideo, Pause, Play, Plus, Rewind, SkipForward, Subtitles } from "lucide-react";
import type { NowNext } from "@core";
import type { AudioTrackInfo, SubtitleTrackInfo } from "@player";
import { buildShelfFocusGraph } from "../focus/build-shelf-graph.js";
import { Focusable, FocusScrollManagedContext } from "../focus/Focusable.js";
import { useFocusStore, useIsFocused, type FocusNode } from "../focus/focus-store.js";
import { BROWSE_SIDE_PADDING, TV_TEXT } from "../tv-metrics.js";
import { ChannelChip, NextProgrammeLine, OnNowTimeline } from "./LiveGuideInfo.js";
import { TvButton } from "./TvButton.js";

const SCOPE = "player-controls";
const MENU_SCOPE = "player-menu";

export const PLAYER_SEEK_ID = "seek-bar";
export const PLAYER_PLAY_PAUSE_ID = "play-pause";
export const PLAYER_AUDIO_SUBTITLES_ID = "audio-subtitles";
export const PLAYER_NEXT_EPISODE_ID = "next-episode";
export const PLAYER_EPISODES_ID = "player-episodes-button";
export const PLAYER_MY_LIST_ID = "player-my-list";

/** Seconds jumped per Left/Right press — the 10s convention of Netflix and most streaming apps. Holding the key speeds this up (see PlayerScreen). */
export const SEEK_STEP_SECONDS = 10;

/** Next Episode only appears once this many seconds remain — Netflix's timing, rather than being offered for the whole runtime. */
export const NEXT_EPISODE_WINDOW_SECONDS = 120;

const audioOptionId = (id: number) => `player-audio:${id}`;
const subtitleOptionId = (id: number | null) => `player-subtitle:${id ?? "off"}`;

export interface PlaybackControlsProps {
  title: string;
  subtitle?: string;
  isPlaying: boolean;
  positionSeconds: number;
  durationSeconds: number;
  /** Where a Left/Right scrub is heading before it's committed — the bar, times and seek badge preview it. null when not scrubbing. */
  pendingSeekSeconds: number | null;
  audioTracks: AudioTrackInfo[];
  activeAudioTrackId: number | null;
  subtitleTracks: SubtitleTrackInfo[];
  /** null means "off". */
  activeSubtitleTrackId: number | null;
  hasNextEpisode: boolean;
  /**
   * Live TV: no seek bar or scrubbing. Shown with the channel number and
   * what's on now from the guide — deliberately never "LIVE", since most
   * of what a channel airs is recorded.
   */
  isLive?: boolean;
  /** Live TV: the channel's number, for the channel chip. */
  channelNumber?: number;
  /** Live TV: what's on now and next, when the channel has guide data. */
  nowNext?: NowNext | null;
  /** Renders the Audio & Subtitles panel. */
  isMenuOpen: boolean;
  /** Any panel over the controls (Audio & Subtitles, Episodes) — the controls' own focus nodes are withdrawn meanwhile. */
  isPanelOpen: boolean;
  /** Where focus lands when the panel closes (the control that opened it). */
  returnFocusId?: string | null;
  onOpenMenu: () => void;
  /** Series only — adds an Episodes button. */
  onOpenEpisodes?: () => void;
  /** Adds a My List button (+ / ✓) for what's playing — the channel, film or series. */
  myList?: { isAdded: boolean; onToggle: () => void };
  onTogglePlayPause: () => void;
  onSelectAudioTrack: (id: number) => void;
  onSelectSubtitleTrack: (id: number | null) => void;
  onNextEpisode: () => void;
}

export function formatPlaybackTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * TV playback overlay in the Netflix / Prime Video layout: everything sits
 * in one bottom gradient — title (and "Ends at"), the seek bar with times,
 * then a row of buttons — so the picture stays clear above it. Sizes are
 * rem-based for 10-foot viewing; focus is the app's solid-white language.
 *
 * Remote model (keys are routed by PlayerScreen): focus starts on the seek
 * bar, where Left/Right scrub and OK plays/pauses; Down reaches the
 * buttons, where Left/Right move between them as usual. The Audio &
 * Subtitles panel is a focus scope of its own — while it's open the
 * controls' scope is emptied so nothing behind it is reachable.
 */
export function PlaybackControls(props: PlaybackControlsProps): JSX.Element {
  const {
    title,
    subtitle,
    isPlaying,
    positionSeconds,
    durationSeconds,
    pendingSeekSeconds,
    hasNextEpisode,
    isLive = false,
    isPanelOpen,
    isMenuOpen,
    onOpenMenu,
    onOpenEpisodes,
    onTogglePlayPause,
    onNextEpisode,
  } = props;

  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);

  const remainingSeconds = durationSeconds - positionSeconds;
  const isNextEpisodeDue = hasNextEpisode && durationSeconds > 0 && remainingSeconds <= NEXT_EPISODE_WINDOW_SECONDS;

  // The graph reads callbacks through a ref, so it's only rebuilt when its
  // shape changes — and in place (setGraph is atomic), keeping focus.
  const latestRef = useRef(props);
  latestRef.current = props;
  const wasPanelOpenRef = useRef(false);
  const hasEpisodes = Boolean(onOpenEpisodes);
  const hasMyList = Boolean(props.myList);

  const buttonRow = useMemo(
    () => [
      PLAYER_PLAY_PAUSE_ID,
      PLAYER_AUDIO_SUBTITLES_ID,
      ...(hasEpisodes ? [PLAYER_EPISODES_ID] : []),
      ...(hasMyList ? [PLAYER_MY_LIST_ID] : []),
      ...(isNextEpisodeDue ? [PLAYER_NEXT_EPISODE_ID] : []),
    ],
    [isNextEpisodeDue, hasEpisodes, hasMyList],
  );

  useEffect(() => {
    if (isPanelOpen) {
      wasPanelOpenRef.current = true;
      setGraph(SCOPE, []);
      return;
    }
    const rows = isLive ? [buttonRow] : [[PLAYER_SEEK_ID], buttonRow];
    const nodes: FocusNode[] = buildShelfFocusGraph(rows).map((node) => ({
      ...node,
      onSelect: () => {
        const current = latestRef.current;
        if (node.id === PLAYER_SEEK_ID || node.id === PLAYER_PLAY_PAUSE_ID) current.onTogglePlayPause();
        else if (node.id === PLAYER_AUDIO_SUBTITLES_ID) current.onOpenMenu();
        else if (node.id === PLAYER_EPISODES_ID) current.onOpenEpisodes?.();
        else if (node.id === PLAYER_MY_LIST_ID) current.myList?.onToggle();
        else if (node.id === PLAYER_NEXT_EPISODE_ID) current.onNextEpisode();
      },
    }));
    const defaultFocusId = isLive ? PLAYER_PLAY_PAUSE_ID : PLAYER_SEEK_ID;
    const returnTo = latestRef.current.returnFocusId;
    const initialFocusId = wasPanelOpenRef.current && returnTo && nodes.some((n) => n.id === returnTo) ? returnTo : defaultFocusId;
    wasPanelOpenRef.current = false;
    setGraph(SCOPE, nodes, initialFocusId);
    // setGraph keeps focus wherever it already is if that element still
    // exists — and the screen under the player (the series page, the Live
    // TV list) stays mounted, so focus would stay on the hidden card that
    // started playback and the D-pad would move around that page instead.
    // Take focus explicitly unless it's already on one of these controls.
    const { focusedId, focus } = useFocusStore.getState();
    if (!focusedId || !nodes.some((node) => node.id === focusedId)) focus(initialFocusId);
  }, [buttonRow, isLive, isPanelOpen, setGraph]);

  useEffect(() => () => clearGraph(SCOPE), [clearGraph]);

  // Live TV with guide data: the programme is the heading and the channel
  // moves into the chip ("CH 101 · BBC One HD"); without it, the channel name.
  const onNow = isLive ? props.nowNext?.now : undefined;
  const heading = onNow ? onNow.title : title;

  const shownPosition = pendingSeekSeconds ?? positionSeconds;
  const progressRatio = durationSeconds > 0 ? Math.min(1, Math.max(0, shownPosition / durationSeconds)) : 0;
  const shownRemaining = Math.max(0, durationSeconds - shownPosition);
  const endsAt = !isLive && durationSeconds > 0 ? formatClock(new Date(Date.now() + shownRemaining * 1000)) : null;

  return (
    <FocusScrollManagedContext.Provider value={true}>
      {pendingSeekSeconds !== null && <SeekBadge deltaSeconds={pendingSeekSeconds - positionSeconds} />}

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: `10rem ${BROWSE_SIDE_PADDING} 3rem`,
          background: "linear-gradient(0deg, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.65) 45%, rgba(0,0,0,0) 100%)",
          // A bottom panel (Episodes) takes this space; the side menu doesn't.
          visibility: isPanelOpen && !isMenuOpen ? "hidden" : "visible",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-end", gap: "2rem", marginBottom: "1.75rem" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {isLive && (
              <div style={{ marginBottom: "0.75rem" }}>
                <ChannelChip number={props.channelNumber} name={onNow ? title : undefined} />
              </div>
            )}
            <div
              style={{
                fontSize: "2.75rem",
                fontWeight: 800,
                color: "#fff",
                lineHeight: 1.15,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                textShadow: "0 0.125rem 0.75rem rgba(0,0,0,0.6)",
              }}
            >
              {heading}
            </div>
            {subtitle && <div style={{ fontSize: TV_TEXT, color: "rgba(255,255,255,0.75)", marginTop: "0.375rem" }}>{subtitle}</div>}
          </div>
          {endsAt && <div style={{ fontSize: TV_TEXT, color: "rgba(255,255,255,0.7)", flexShrink: 0 }}>Ends at {endsAt}</div>}
        </div>

        {isLive && (onNow || props.nowNext?.next) && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "2rem" }}>
            {onNow && <OnNowTimeline programme={onNow} barWidth="28rem" />}
            {props.nowNext?.next && <NextProgrammeLine programme={props.nowNext.next} />}
          </div>
        )}

        {!isLive && (
          <div style={{ display: "flex", alignItems: "center", gap: "1.5rem", marginBottom: "2rem" }}>
            <TimeLabel align="right">{formatPlaybackTime(shownPosition)}</TimeLabel>
            <SeekBar progressRatio={progressRatio} previewLabel={pendingSeekSeconds !== null ? formatPlaybackTime(pendingSeekSeconds) : null} />
            <TimeLabel align="left">-{formatPlaybackTime(shownRemaining)}</TimeLabel>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
          <TvButton id={PLAYER_PLAY_PAUSE_ID} label={isPlaying ? "Pause" : "Play"} icon={isPlaying ? Pause : Play} onSelect={onTogglePlayPause} />
          <TvButton id={PLAYER_AUDIO_SUBTITLES_ID} label="Audio & Subtitles" icon={Subtitles} onSelect={onOpenMenu} />
          {onOpenEpisodes && <TvButton id={PLAYER_EPISODES_ID} label="Episodes" icon={ListVideo} onSelect={onOpenEpisodes} />}
          {props.myList && (
            <TvButton id={PLAYER_MY_LIST_ID} label="My List" icon={props.myList.isAdded ? Check : Plus} onSelect={props.myList.onToggle} />
          )}
          <div style={{ flex: 1 }} />
          {isNextEpisodeDue && (
            <div style={{ animation: "player-next-episode-in 320ms cubic-bezier(0.2, 0.8, 0.3, 1)" }}>
              <TvButton id={PLAYER_NEXT_EPISODE_ID} label="Next Episode" icon={SkipForward} variant="primary" onSelect={onNextEpisode} />
              <style>{`
                @keyframes player-next-episode-in {
                  from { opacity: 0; transform: translateY(1rem); }
                  to { opacity: 1; transform: translateY(0); }
                }
              `}</style>
            </div>
          )}
        </div>
      </div>

      {isMenuOpen && <AudioSubtitlesPanel {...props} />}
    </FocusScrollManagedContext.Provider>
  );
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function TimeLabel({ align, children }: { align: "left" | "right"; children: React.ReactNode }): JSX.Element {
  return (
    <span style={{ minWidth: "5.5rem", textAlign: align, fontSize: TV_TEXT, fontWeight: 600, color: "#fff", fontVariantNumeric: "tabular-nums" }}>
      {children}
    </span>
  );
}

function SeekBar({ progressRatio, previewLabel }: { progressRatio: number; previewLabel: string | null }): JSX.Element {
  const isFocused = useIsFocused(PLAYER_SEEK_ID);
  const percent = `${progressRatio * 100}%`;
  return (
    <Focusable id={PLAYER_SEEK_ID} style={{ flex: 1, height: "2rem", display: "flex", alignItems: "center" }}>
      <div
        role="slider"
        aria-label="Playback position"
        aria-valuenow={Math.round(progressRatio * 100)}
        style={{
          position: "relative",
          width: "100%",
          height: isFocused ? "0.625rem" : "0.375rem",
          borderRadius: 999,
          background: "rgba(255,255,255,0.25)",
          transition: "height 140ms ease-out",
        }}
      >
        <div style={{ position: "absolute", inset: 0, width: percent, borderRadius: 999, background: "var(--accent)" }} />
        {isFocused && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: percent,
              width: "1.75rem",
              height: "1.75rem",
              borderRadius: "50%",
              background: "#fff",
              boxShadow: "0 0.25rem 1rem rgba(0,0,0,0.6)",
              transform: "translate(-50%, -50%)",
            }}
          />
        )}
        {previewLabel && (
          <div
            style={{
              position: "absolute",
              bottom: "2rem",
              left: percent,
              transform: "translateX(-50%)",
              padding: "0.5rem 1rem",
              borderRadius: "0.625rem",
              background: "#fff",
              color: "#0b0c10",
              fontSize: TV_TEXT,
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            {previewLabel}
          </div>
        )}
      </div>
    </Focusable>
  );
}

/** Big centred "« 30s" / "30s »" while scrubbing — the at-a-glance feedback Netflix gives for every Left/Right press. */
function SeekBadge({ deltaSeconds }: { deltaSeconds: number }): JSX.Element {
  const isBack = deltaSeconds < 0;
  const Icon = isBack ? Rewind : FastForward;
  const amount = Math.abs(Math.round(deltaSeconds));
  const label = amount >= 60 ? `${Math.floor(amount / 60)}m ${String(amount % 60).padStart(2, "0")}s` : `${amount}s`;
  return (
    <div
      aria-live="polite"
      style={{
        position: "absolute",
        top: "42%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        display: "flex",
        flexDirection: isBack ? "row" : "row-reverse",
        alignItems: "center",
        gap: "1rem",
        padding: "1.25rem 2rem",
        borderRadius: 999,
        background: "rgba(0,0,0,0.6)",
        color: "#fff",
        fontSize: "2.25rem",
        fontWeight: 800,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <Icon size="2.5rem" fill="currentColor" />
      {isBack ? "-" : "+"}
      {label}
    </div>
  );
}

/**
 * Netflix-style two-column Audio | Subtitles panel on the right. Its rows
 * are a focus scope of their own: Up/Down within a column, Left/Right
 * across at the same row, OK picks, Back (handled by PlayerScreen) closes.
 */
function AudioSubtitlesPanel({
  audioTracks,
  activeAudioTrackId,
  subtitleTracks,
  activeSubtitleTrackId,
  onSelectAudioTrack,
  onSelectSubtitleTrack,
}: PlaybackControlsProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focus = useFocusStore((state) => state.focus);

  // The engine doesn't report its starting audio track; until one is picked, the stream's default (first) track is the current one.
  const audioIds = audioTracks.map((track) => audioOptionId(track.id));
  const subtitleIds = [subtitleOptionId(null), ...subtitleTracks.map((track) => subtitleOptionId(track.id))];

  const latestRef = useRef({ audioTracks, subtitleTracks, onSelectAudioTrack, onSelectSubtitleTrack });
  latestRef.current = { audioTracks, subtitleTracks, onSelectAudioTrack, onSelectSubtitleTrack };
  const shapeKey = `${audioIds.join(",")}|${subtitleIds.join(",")}`;

  useEffect(() => {
    const column = (ids: string[], other: string[], side: "left" | "right"): FocusNode[] =>
      ids.map((id, index) => ({
        id,
        neighbors: {
          up: ids[index - 1],
          down: ids[index + 1],
          [side]: other.length > 0 ? other[Math.min(index, other.length - 1)] : undefined,
        },
        onSelect: () => {
          const current = latestRef.current;
          const audio = current.audioTracks.find((track) => audioOptionId(track.id) === id);
          if (audio) current.onSelectAudioTrack(audio.id);
          else current.onSelectSubtitleTrack(current.subtitleTracks.find((track) => subtitleOptionId(track.id) === id)?.id ?? null);
        },
      }));
    setGraph(MENU_SCOPE, [...column(audioIds, subtitleIds, "right"), ...column(subtitleIds, audioIds, "left")]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeKey, setGraph]);

  // Open on the current subtitle choice — the setting people change most.
  useEffect(() => {
    focus(subtitleOptionId(activeSubtitleTrackId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => clearGraph(MENU_SCOPE), [clearGraph]);

  return (
    <FocusScrollManagedContext.Provider value={false}>
      <div
        role="dialog"
        aria-label="Audio & Subtitles"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: "52rem",
          boxSizing: "border-box",
          padding: `3.5rem ${BROWSE_SIDE_PADDING} 3rem 3rem`,
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(270deg, rgba(10,11,15,0.97) 0%, rgba(10,11,15,0.93) 80%, rgba(10,11,15,0.8) 100%)",
          boxShadow: "-2rem 0 4rem rgba(0,0,0,0.5)",
          zIndex: 60,
        }}
      >
        <h2 style={{ fontSize: "2.25rem", fontWeight: 800, color: "#fff", margin: "0 0 0.5rem" }}>Audio &amp; Subtitles</h2>
        <p style={{ fontSize: "1.125rem", color: "var(--text-dim)", margin: "0 0 2.5rem" }}>Press Back to return to the video</p>
        <div style={{ display: "flex", gap: "2.5rem", flex: 1, minHeight: 0 }}>
          <MenuColumn title="Audio">
            {audioTracks.length === 0 ? (
              <div style={{ fontSize: TV_TEXT, color: "var(--text-dim)", padding: "0.875rem 1.25rem" }}>Default only</div>
            ) : (
              audioTracks.map((track) => (
                <MenuRow
                  key={track.id}
                  id={audioOptionId(track.id)}
                  label={track.label}
                  isActive={track.id === (activeAudioTrackId ?? audioTracks[0]?.id)}
                  onClick={() => onSelectAudioTrack(track.id)}
                />
              ))
            )}
          </MenuColumn>
          <MenuColumn title="Subtitles">
            <MenuRow id={subtitleOptionId(null)} label="Off" isActive={activeSubtitleTrackId === null} onClick={() => onSelectSubtitleTrack(null)} />
            {subtitleTracks.map((track) => (
              <MenuRow
                key={track.id}
                id={subtitleOptionId(track.id)}
                label={track.label}
                isActive={track.id === activeSubtitleTrackId}
                onClick={() => onSelectSubtitleTrack(track.id)}
              />
            ))}
          </MenuColumn>
        </div>
      </div>
    </FocusScrollManagedContext.Provider>
  );
}

function MenuColumn({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: "1.125rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: "1rem" }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem", overflowY: "auto", padding: "0.25rem" }}>{children}</div>
    </div>
  );
}

function MenuRow({ id, label, isActive, onClick }: { id: string; label: string; isActive: boolean; onClick: () => void }): JSX.Element {
  const isFocused = useIsFocused(id);
  return (
    <Focusable id={id} style={{ height: "auto", flexShrink: 0 }}>
      <button
        type="button"
        aria-pressed={isActive}
        onClick={onClick}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          width: "100%",
          padding: "0.875rem 1.25rem",
          border: "none",
          borderRadius: "0.75rem",
          textAlign: "left",
          background: isFocused ? "#ffffff" : "transparent",
          color: isFocused ? "#0b0c10" : isActive ? "#fff" : "rgba(255,255,255,0.7)",
          fontSize: TV_TEXT,
          fontWeight: isActive ? 700 : 500,
          cursor: "pointer",
        }}
      >
        <span style={{ width: "1.5rem", flexShrink: 0, display: "flex" }}>
          {isActive && <Check size="1.5rem" strokeWidth={3} color={isFocused ? "#0b0c10" : "var(--accent)"} />}
        </span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      </button>
    </Focusable>
  );
}
