import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Channel, EpgProgramme } from "@core";
import { Focusable, FocusScrollManagedContext } from "../focus/Focusable.js";
import { useFocusStore, useIsFocused, type FocusNode } from "../focus/focus-store.js";
import { readRemPx } from "../rem.js";
import { SECTION_ICONS } from "../section-icons.js";
import { URLImage } from "./URLImage.js";

export interface GuideSelection {
  channel: Channel;
  /** Null when the channel has no guide data (or it's still loading). */
  programme: EpgProgramme | null;
}

export interface ProgramGuideGridProps {
  channels: Channel[];
  numberById: Map<string, number>;
  /** Programmes per channel id; a missing entry means "not loaded yet". */
  programmesByChannel: Map<string, EpgProgramme[]>;
  /** Called with the channels currently rendered (on screen plus a little overscan) — the owner loads their guides. */
  onRenderedChannelsChange: (channels: Channel[]) => void;
  /** Called as focus moves between cells, for the details panel. */
  onFocusChange: (selection: GuideSelection) => void;
  onSelect: (selection: GuideSelection) => void;
  /** Called with the cell focus should enter at (e.g. Right from a category rail). */
  onEntryIdChange?: (id: string | undefined) => void;
  /** Where Left goes from a row's first programme — e.g. the category rail. */
  leftEntryId?: string;
}

const SCOPE = "content:program-guide";
const CHANNEL_COLUMN_REM = 22;
const HEADER_REM = 3.5;
const ROW_PITCH_REM = 5;
const ROW_HEIGHT_REM = 4.5;
/** Timeline scale: 0.5rem per minute — 15rem (240px at 1080p) for a half-hour programme. */
const REM_PER_MINUTE = 0.5;
const SLOT_MS = 30 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const OVERSCAN_ROWS = 2;
/** Fallbacks until measured (and in jsdom, which never lays out). */
const FALLBACK_AREA_WIDTH_PX = 1400;
const FALLBACK_BODY_HEIGHT_PX = 700;

const floorToSlot = (ms: number) => Math.floor(ms / SLOT_MS) * SLOT_MS;
const programmeCellId = (channelId: string, programme: EpgProgramme) => `epg:${channelId}:${programme.start.getTime()}`;
const emptyCellId = (channelId: string) => `epg:${channelId}:none`;

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(ms: number): string {
  const day = new Date(ms);
  const today = new Date();
  if (day.toDateString() === today.toDateString()) return "Today";
  const tomorrow = new Date(today.getTime() + 24 * 60 * MINUTE_MS);
  if (day.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return day.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

interface CellInfo {
  row: number;
  programme: EpgProgramme | null;
}

/**
 * Program Guide timeline ("swimlane") grid for TV: channels down the left,
 * time across the top in half-hour slots, each programme a block sized by
 * its duration, and a line at the current time.
 *
 * D-pad: Left/Right move between programmes on the same channel — the
 * timeline slides when focus reaches past its edge. Up/Down move to the
 * neighbouring channel, landing on the programme airing at the same moment
 * (the Android TV / TiviMate convention), so scrolling down a column keeps
 * you at "8pm". Left from a channel's first programme leaves the grid
 * (leftEntryId). OK calls onSelect.
 *
 * Scales to thousands of channels: only the rows on screen (plus a couple
 * either side) are rendered and registered as focus nodes, and only the
 * programmes overlapping the visible time window are rendered. Each cell
 * subscribes to its own focus, so a D-pad press re-renders two cells; the
 * grid itself re-renders only when the visible rows or time window change.
 */
export const ProgramGuideGrid = memo(function ProgramGuideGrid({
  channels,
  numberById,
  programmesByChannel,
  onRenderedChannelsChange,
  onFocusChange,
  onSelect,
  onEntryIdChange,
  leftEntryId,
}: ProgramGuideGridProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);

  const areaRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [remPx, setRemPx] = useState(readRemPx);
  const [areaWidth, setAreaWidth] = useState(FALLBACK_AREA_WIDTH_PX);
  const [bodyHeight, setBodyHeight] = useState(FALLBACK_BODY_HEIGHT_PX);
  const [now, setNow] = useState(() => Date.now());
  const [windowStart, setWindowStart] = useState(() => floorToSlot(Date.now()) - SLOT_MS);
  const [firstRow, setFirstRow] = useState(0);

  useLayoutEffect(() => {
    function measure(): void {
      setRemPx(readRemPx());
      const width = areaRef.current?.clientWidth ?? 0;
      const height = bodyRef.current?.clientHeight ?? 0;
      if (width > 0) setAreaWidth(width);
      if (height > 0) setBodyHeight(height);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => clearInterval(id);
  }, []);

  const pxPerMinute = REM_PER_MINUTE * remPx;
  const pxPerMs = pxPerMinute / MINUTE_MS;
  const rowPitchPx = ROW_PITCH_REM * remPx;
  const windowEnd = windowStart + areaWidth / pxPerMs;
  const visibleRows = Math.max(1, Math.floor(bodyHeight / rowPitchPx));
  const renderedStart = Math.max(0, firstRow - OVERSCAN_ROWS);
  const renderedEnd = Math.min(channels.length, firstRow + visibleRows + OVERSCAN_ROWS);

  // Programmes per channel, sorted by start — providers don't always send them in order.
  const sortedByChannel = useMemo(() => {
    const sorted = new Map<string, EpgProgramme[]>();
    for (const [channelId, programmes] of programmesByChannel) {
      sorted.set(channelId, [...programmes].sort((a, b) => a.start.getTime() - b.start.getTime()));
    }
    return sorted;
  }, [programmesByChannel]);

  // Latest values for the focus-follow subscription, without resubscribing on every change.
  const cellInfoRef = useRef(new Map<string, CellInfo>());
  const liveRef = useRef({ channels, firstRow, visibleRows, windowStart, windowEnd, onFocusChange, onSelect });
  liveRef.current = { channels, firstRow, visibleRows, windowStart, windowEnd, onFocusChange, onSelect };

  // A new channel list (category change) starts at the top, and focus moves into it.
  const claimFocusRef = useRef(true);
  useEffect(() => {
    setFirstRow(0);
    claimFocusRef.current = true;
  }, [channels]);

  useEffect(() => {
    onRenderedChannelsChange(channels.slice(renderedStart, renderedEnd));
  }, [channels, renderedStart, renderedEnd, onRenderedChannelsChange]);

  // Focus graph for the rendered rows. Up/Down pick the programme airing at
  // the focused programme's start (clamped into the visible window) in the
  // neighbouring row.
  useEffect(() => {
    const focusTime = Math.min(Math.max(now, windowStart), windowEnd - 1);

    function pickInRow(row: number, time: number): string | undefined {
      const channel = channels[row];
      if (!channel) return undefined;
      const programmes = sortedByChannel.get(channel.id);
      if (!programmes || programmes.length === 0) return emptyCellId(channel.id);
      const airing = programmes.find((p) => p.start.getTime() <= time && time < p.stop.getTime());
      const next = programmes.find((p) => p.start.getTime() > time);
      return programmeCellId(channel.id, airing ?? next ?? programmes[programmes.length - 1]);
    }

    const info = new Map<string, CellInfo>();
    const nodes: FocusNode[] = [];
    for (let row = renderedStart; row < renderedEnd; row++) {
      const channel = channels[row];
      const programmes = sortedByChannel.get(channel.id);
      if (!programmes || programmes.length === 0) {
        const id = emptyCellId(channel.id);
        info.set(id, { row, programme: null });
        nodes.push({
          id,
          neighbors: { left: leftEntryId, up: pickInRow(row - 1, focusTime), down: pickInRow(row + 1, focusTime) },
          onSelect: () => liveRef.current.onSelect({ channel, programme: null }),
        });
        continue;
      }
      programmes.forEach((programme, index) => {
        const id = programmeCellId(channel.id, programme);
        const anchor = Math.min(Math.max(programme.start.getTime(), windowStart), windowEnd - 1);
        info.set(id, { row, programme });
        nodes.push({
          id,
          neighbors: {
            left: index > 0 ? programmeCellId(channel.id, programmes[index - 1]) : leftEntryId,
            right: index < programmes.length - 1 ? programmeCellId(channel.id, programmes[index + 1]) : undefined,
            up: pickInRow(row - 1, anchor),
            down: pickInRow(row + 1, anchor),
          },
          onSelect: () => liveRef.current.onSelect({ channel, programme }),
        });
      });
    }

    // If the focused cell just disappeared (its row's guide finished loading,
    // replacing the placeholder), land on the same row at the same moment
    // rather than letting focus fall back to the first row.
    const focusedId = useFocusStore.getState().focusedId;
    const previous = focusedId ? cellInfoRef.current.get(focusedId) : undefined;
    const entryId = pickInRow(firstRow, focusTime);
    const initialId =
      previous && focusedId && !info.has(focusedId)
        ? pickInRow(previous.row, previous.programme ? Math.max(previous.programme.start.getTime(), windowStart) : focusTime)
        : entryId;

    cellInfoRef.current = info;
    setGraph(SCOPE, nodes, initialId);
    if (claimFocusRef.current && entryId) {
      claimFocusRef.current = false;
      useFocusStore.getState().focus(entryId);
    }
    onEntryIdChange?.(entryId);
  }, [channels, sortedByChannel, renderedStart, renderedEnd, firstRow, windowStart, windowEnd, now, leftEntryId, setGraph, onEntryIdChange]);

  useEffect(() => () => clearGraph(SCOPE), [clearGraph]);

  // Follow focus: keep its row on screen, slide the timeline for Left/Right
  // moves that reach past its edge, and report the selection.
  useEffect(() => {
    function follow(focusedId: string | null, previousId: string | null): void {
      const info = focusedId ? cellInfoRef.current.get(focusedId) : undefined;
      if (!info) return;
      const live = liveRef.current;

      if (info.row < live.firstRow) setFirstRow(info.row);
      else if (info.row >= live.firstRow + live.visibleRows) setFirstRow(info.row - live.visibleRows + 1);

      const previous = previousId ? cellInfoRef.current.get(previousId) : undefined;
      if (info.programme && previous && previous.row === info.row) {
        const start = info.programme.start.getTime();
        if (start < live.windowStart) setWindowStart(floorToSlot(start));
        else if (start >= live.windowEnd - SLOT_MS) setWindowStart(floorToSlot(start) - SLOT_MS);
      }

      const channel = live.channels[info.row];
      if (channel) live.onFocusChange({ channel, programme: info.programme });
    }

    return useFocusStore.subscribe((state, prev) => {
      if (state.focusedId !== prev.focusedId) follow(state.focusedId, prev.focusedId);
    });
  }, []);

  // Also report the cell focused when the graph first lands focus.
  useEffect(() => {
    const focusedId = useFocusStore.getState().focusedId;
    const info = focusedId ? cellInfoRef.current.get(focusedId) : undefined;
    const channel = info ? channels[info.row] : undefined;
    if (info && channel) onFocusChange({ channel, programme: info.programme });
    // Only when the rendered data changes, not on every callback identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, sortedByChannel]);

  const slots: number[] = [];
  for (let t = floorToSlot(windowStart) + (windowStart % SLOT_MS === 0 ? 0 : SLOT_MS); t < windowEnd; t += SLOT_MS) slots.push(t);
  const nowX = now >= windowStart && now < windowEnd ? (now - windowStart) * pxPerMs : null;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", height: `${HEADER_REM}rem`, flexShrink: 0, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ width: `${CHANNEL_COLUMN_REM}rem`, flexShrink: 0, display: "flex", alignItems: "center", padding: "0 1.5rem", fontSize: "1.375rem", fontWeight: 800, color: "#fff" }}>
          {dayLabel(windowStart)}
        </div>
        <div ref={areaRef} style={{ position: "relative", flex: 1, minWidth: 0, overflow: "hidden" }}>
          {/* Skip a label that would be cut off at the right edge. */}
          {slots.filter((t) => (t - windowStart) * pxPerMs < areaWidth - 8 * remPx).map((t) => (
            <div key={t} style={{ position: "absolute", left: (t - windowStart) * pxPerMs, top: 0, bottom: 0, display: "flex", alignItems: "center", gap: "0.5rem", whiteSpace: "nowrap" }}>
              <span style={{ width: 2, height: "1.25rem", background: "rgba(255,255,255,0.25)" }} />
              <span style={{ fontSize: "1.25rem", fontWeight: 600, color: "rgba(235,236,242,0.8)", fontVariantNumeric: "tabular-nums" }}>{formatTime(t)}</span>
            </div>
          ))}
          {nowX !== null && (
            <span
              style={{
                position: "absolute",
                left: nowX,
                bottom: 0,
                transform: "translateX(-50%)",
                padding: "0.125rem 0.5rem",
                borderRadius: "0.375rem",
                background: "var(--accent, #38bdf8)",
                color: "#062028",
                fontSize: "0.875rem",
                fontWeight: 800,
                letterSpacing: "0.06em",
              }}
            >
              NOW
            </span>
          )}
        </div>
      </div>

      <div ref={bodyRef} style={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden" }}>
        <FocusScrollManagedContext.Provider value={true}>
          {channels.slice(renderedStart, renderedEnd).map((channel, offset) => {
            const row = renderedStart + offset;
            return (
              <GuideRow
                key={channel.id}
                channel={channel}
                number={numberById.get(channel.id)}
                programmes={sortedByChannel.get(channel.id)}
                top={(row - firstRow) * rowPitchPx}
                windowStart={windowStart}
                windowEnd={windowEnd}
                pxPerMs={pxPerMs}
                now={now}
              />
            );
          })}
        </FocusScrollManagedContext.Provider>
        {nowX !== null && (
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `calc(${CHANNEL_COLUMN_REM}rem + ${nowX}px)`,
              width: 2,
              background: "var(--accent, #38bdf8)",
              boxShadow: "0 0 0.75rem rgba(56,189,248,0.6)",
              pointerEvents: "none",
            }}
          />
        )}
      </div>
    </div>
  );
});

interface GuideRowProps {
  channel: Channel;
  number?: number;
  programmes: EpgProgramme[] | undefined;
  top: number;
  windowStart: number;
  windowEnd: number;
  pxPerMs: number;
  now: number;
}

/** One channel's swimlane: its label, then the programmes overlapping the visible window. */
function GuideRow({ channel, number, programmes, top, windowStart, windowEnd, pxPerMs, now }: GuideRowProps): JSX.Element {
  const isRowFocused = useFocusStore((state) => state.focusedId?.startsWith(`epg:${channel.id}:`) ?? false);

  return (
    <div style={{ position: "absolute", top, left: 0, right: 0, height: `${ROW_HEIGHT_REM}rem`, display: "flex" }}>
      <div
        style={{
          width: `${CHANNEL_COLUMN_REM}rem`,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: "0.875rem",
          padding: "0 1.25rem 0 1.5rem",
          boxSizing: "border-box",
          color: isRowFocused ? "#ffffff" : "rgba(235,236,242,0.75)",
          fontWeight: isRowFocused ? 700 : 500,
        }}
      >
        {number !== undefined && (
          <span style={{ width: "2.75rem", flexShrink: 0, fontSize: "1.125rem", opacity: 0.6, fontVariantNumeric: "tabular-nums" }}>{number}</span>
        )}
        <div style={{ width: "3rem", height: "3rem", flexShrink: 0, borderRadius: "0.5rem", overflow: "hidden", background: "rgba(255,255,255,0.06)" }}>
          <URLImage src={channel.logoUrl} alt="" seed={channel.id} objectFit="contain" placeholderIcon={SECTION_ICONS.live} />
        </div>
        <span style={{ fontSize: "1.25rem", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{channel.name}</span>
      </div>

      <div style={{ position: "relative", flex: 1, minWidth: 0, overflow: "hidden" }}>
        {!programmes || programmes.length === 0 ? (
          <GuideCell
            id={emptyCellId(channel.id)}
            left={0}
            width={(windowEnd - windowStart) * pxPerMs}
            title={programmes ? "No programme information" : "Loading…"}
            timeLabel={undefined}
            tone="empty"
          />
        ) : (
          programmes
            .filter((p) => p.stop.getTime() > windowStart && p.start.getTime() < windowEnd)
            .map((programme) => {
              const start = Math.max(programme.start.getTime(), windowStart);
              const stop = Math.min(programme.stop.getTime(), windowEnd);
              const isLive = programme.start.getTime() <= now && now < programme.stop.getTime();
              const isPast = programme.stop.getTime() <= now;
              return (
                <GuideCell
                  key={programme.start.getTime()}
                  id={programmeCellId(channel.id, programme)}
                  left={(start - windowStart) * pxPerMs}
                  width={(stop - start) * pxPerMs}
                  title={(programme.start.getTime() < windowStart ? "‹ " : "") + programme.title}
                  timeLabel={`${formatTime(programme.start.getTime())} – ${formatTime(programme.stop.getTime())}`}
                  tone={isLive ? "live" : isPast ? "past" : "future"}
                />
              );
            })
        )}
      </div>
    </div>
  );
}

/**
 * One programme block. Focused: solid white (the app-wide focus style). The
 * programme on air now is a shade brighter than upcoming ones; finished
 * programmes are dimmed.
 */
const GuideCell = memo(function GuideCell({
  id,
  left,
  width,
  title,
  timeLabel,
  tone,
}: {
  id: string;
  left: number;
  width: number;
  title: string;
  timeLabel: string | undefined;
  tone: "live" | "future" | "past" | "empty";
}): JSX.Element {
  const isFocused = useIsFocused(id);
  const background = isFocused
    ? "rgba(255,255,255,0.95)"
    : tone === "live"
      ? "rgba(255,255,255,0.14)"
      : tone === "future"
        ? "rgba(255,255,255,0.08)"
        : "rgba(255,255,255,0.04)";
  const color = isFocused ? "#0b0c10" : tone === "past" || tone === "empty" ? "rgba(235,236,242,0.5)" : "#ffffff";

  return (
    <div style={{ position: "absolute", top: 0, bottom: 0, left: left + 2, width: Math.max(0, width - 4) }}>
      <Focusable id={id}>
        <div
          style={{
            height: "100%",
            boxSizing: "border-box",
            padding: "0.625rem 1rem",
            borderRadius: "0.75rem",
            background,
            color,
            overflow: "hidden",
            boxShadow: tone === "live" && !isFocused ? "inset 0.25rem 0 0 var(--accent, #38bdf8)" : undefined,
          }}
        >
          <div style={{ fontSize: "1.25rem", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
          {timeLabel && (
            <div style={{ fontSize: "1rem", marginTop: "0.25rem", opacity: 0.75, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>
              {timeLabel}
            </div>
          )}
        </div>
      </Focusable>
    </div>
  );
});
