import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Channel } from "@core";
import { Focusable, FocusScrollManagedContext } from "../focus/Focusable.js";
import { buildListFocusGraph } from "../focus/build-grid-graph.js";
import { useFocusStore, useIsFocused } from "../focus/focus-store.js";
import { readRemPx } from "../rem.js";
import { SECTION_ICONS } from "../section-icons.js";
import { TV_TEXT } from "../tv-metrics.js";
import { MarqueeText } from "./MarqueeText.js";
import { URLImage } from "./URLImage.js";

export interface ChannelSidebarProps {
  channels: Channel[];
  /** The channel currently playing/selected (e.g. in the Live TV preview) — marked with an "on air" dot. */
  activeChannelId?: string;
  onHighlight: (channel: Channel) => void;
  onSelect: (channel: Channel) => void;
  /** CSS width of the column. */
  width?: number | string;
  /** Channel number per channel id; when given, each row shows its number. */
  numberById?: Map<string, number>;
  /** Focus id to jump to when the user presses left from any row — e.g. the category rail. */
  leftEntryId?: string;
  /** Focus id to jump to when the user presses right from any row, if anything sits to the right. */
  rightEntryId?: string;
}

const SCOPE = "content:channel-sidebar";
/** Row pitch and height in rem — rows scale with the TV like everything else; windowing converts to px with the live root font size. */
const ROW_PITCH_REM = 5;
const ROW_HEIGHT_REM = 4.5;
const LIST_PADDING_REM = 0.75;
/** Rows rendered beyond each edge of the viewport, so a D-pad step always lands on an already-mounted row. */
const OVERSCAN_ROWS = 6;
/** Used until the list has been laid out (and in jsdom, which never lays out) — a full 1080p screen's worth of rows. */
const FALLBACK_VIEWPORT_PX = 1080;

/**
 * Vertical channel list (Live TV, Program Guide), sized for the 10-foot view:
 * large rows with the channel number, logo and name; the focused row is a
 * solid white bar (the app-wide list focus style) and the channel on air in
 * the preview carries a red dot, so "where focus is" and "what's playing"
 * are never confused. Every focus change is reported via onHighlight (the
 * preview follows highlight, debounced by the owner); Select calls onSelect.
 *
 * Windowed: an "All Channels" list can run to thousands of rows, so only
 * the rows in (or near) the viewport are mounted, absolutely positioned at
 * their fixed-pitch offsets inside a full-height spacer. The focus graph
 * still covers every channel; this component follows focus via a store
 * subscription (not render state) and scrolls the target row into range
 * itself, so a D-pad press re-renders just the two rows whose focused state
 * changed instead of the whole list.
 */
export function ChannelSidebar({
  channels,
  activeChannelId,
  onHighlight,
  onSelect,
  width = "34rem",
  numberById,
  leftEntryId,
  rightEntryId,
}: ChannelSidebarProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focus = useFocusStore((state) => state.focus);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(FALLBACK_VIEWPORT_PX);
  const [remPx, setRemPx] = useState(readRemPx);

  const rowPitchPx = ROW_PITCH_REM * remPx;
  const listPaddingPx = LIST_PADDING_REM * remPx;
  const rowGapPx = (ROW_PITCH_REM - ROW_HEIGHT_REM) * remPx;

  const onHighlightRef = useRef(onHighlight);
  onHighlightRef.current = onHighlight;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const handleRowSelect = useCallback((channel: Channel) => onSelectRef.current(channel), []);

  const indexById = useMemo(() => new Map(channels.map((channel, index) => [channel.id, index])), [channels]);

  // The previous list's ids, and whether the last list change happened while
  // focus was on one of its rows — the same list refreshed underneath the
  // user (a sync, or a Kids channel hidden in real time) rather than a new
  // category picked from the rail.
  const previousIdsRef = useRef<string[] | null>(null);
  const keepFocusRef = useRef(false);

  useEffect(() => {
    const ids = channels.map((channel) => channel.id);
    const focusedBefore = useFocusStore.getState().focusedId;
    const previousIndex = focusedBefore && previousIdsRef.current ? previousIdsRef.current.indexOf(focusedBefore) : -1;
    previousIdsRef.current = ids;
    const nodes = buildListFocusGraph(ids).map((node, index) => ({
      ...node,
      neighbors: { ...node.neighbors, left: leftEntryId, right: rightEntryId },
      onSelect: () => onSelectRef.current(channels[index]),
    }));
    setGraph(SCOPE, nodes);
    keepFocusRef.current = previousIndex >= 0 && ids.length > 0;
    // The focused row went away: its neighbour (whatever now sits at its place) takes focus, not the top of the list.
    if (keepFocusRef.current && focusedBefore && !ids.includes(focusedBefore)) focus(ids[Math.min(previousIndex, ids.length - 1)]);
  }, [channels, leftEntryId, rightEntryId, setGraph, focus]);

  // Rebuilds above replace the scope in place (setGraph is atomic); clearing
  // it on every rebuild would drop focus for an instant and snap it back to
  // the first node. Clear only when this component goes away.
  useEffect(() => () => clearGraph(SCOPE), [clearGraph]);

  useLayoutEffect(() => {
    function measure(): void {
      const height = scrollRef.current?.clientHeight ?? 0;
      if (height > 0) setViewportHeight(height);
      setRemPx(readRemPx());
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Follows focus: reports the highlighted channel, and scrolls just far
  // enough to bring its row fully into view (the "nearest" behaviour
  // Focusable's scrollIntoView used to provide — which can't work here, since
  // a row outside the window isn't mounted to scroll to).
  useEffect(() => {
    function onFocusChange(focusedId: string | null): void {
      const index = focusedId ? indexById.get(focusedId) : undefined;
      if (index === undefined) return;
      onHighlightRef.current(channels[index]);

      const el = scrollRef.current;
      if (!el) return;
      const viewport = el.clientHeight || FALLBACK_VIEWPORT_PX;
      const rowTop = listPaddingPx + index * rowPitchPx;
      const rowBottom = rowTop + rowPitchPx - rowGapPx;
      let next = el.scrollTop;
      if (rowTop - listPaddingPx < next) next = rowTop - listPaddingPx;
      else if (rowBottom + listPaddingPx > next + viewport) next = rowBottom + listPaddingPx - viewport;
      if (next !== el.scrollTop) {
        el.scrollTop = next;
        setScrollTop(next);
      }
    }

    onFocusChange(useFocusStore.getState().focusedId);
    return useFocusStore.subscribe((state, prev) => {
      if (state.focusedId !== prev.focusedId) onFocusChange(state.focusedId);
    });
  }, [channels, indexById, rowPitchPx, listPaddingPx, rowGapPx]);

  // Re-focus the first row whenever the channel list itself changes (i.e.
  // the user picked a different category) — without this, focusedId would
  // keep pointing at a row id from the previous category that no longer
  // exists in this scope, and the store's setGraph() fallback would only
  // catch that on the very first registration, not a later category switch.
  //
  // Not when the list only refreshed while the user was on it (see
  // keepFocusRef above) — focus then stays where it was.
  useEffect(() => {
    if (keepFocusRef.current) {
      keepFocusRef.current = false;
      return;
    }
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setScrollTop(0);
    if (channels.length > 0) focus(channels[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels]);

  const firstIndex = Math.max(0, Math.floor((scrollTop - listPaddingPx) / rowPitchPx) - OVERSCAN_ROWS);
  const lastIndex = Math.min(channels.length, Math.ceil((scrollTop + viewportHeight) / rowPitchPx) + OVERSCAN_ROWS);

  return (
    <div
      ref={scrollRef}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      style={{
        width,
        height: "100%",
        flexShrink: 0,
        overflowY: "auto",
        padding: `${LIST_PADDING_REM}rem 0.75rem`,
        boxSizing: "border-box",
      }}
    >
      <FocusScrollManagedContext.Provider value={true}>
        <div style={{ position: "relative", height: channels.length * rowPitchPx }}>
          {channels.slice(firstIndex, lastIndex).map((channel, offset) => (
            <div
              key={channel.id}
              style={{
                position: "absolute",
                top: (firstIndex + offset) * rowPitchPx,
                left: 0,
                right: 0,
                height: `${ROW_HEIGHT_REM}rem`,
              }}
            >
              <ChannelRow
                channel={channel}
                number={numberById?.get(channel.id)}
                isActive={activeChannelId === channel.id}
                onSelect={handleRowSelect}
              />
            </div>
          ))}
        </div>
      </FocusScrollManagedContext.Provider>
    </div>
  );
}

/** One channel row — subscribes to its own focused state, so a focus move re-renders only the rows it leaves and enters. */
const ChannelRow = memo(function ChannelRow({
  channel,
  number,
  isActive,
  onSelect,
}: {
  channel: Channel;
  number?: number;
  isActive: boolean;
  onSelect: (channel: Channel) => void;
}): JSX.Element {
  const isFocused = useIsFocused(channel.id);

  return (
    <Focusable id={channel.id}>
      <button
        type="button"
        onClick={() => onSelect(channel)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          width: "100%",
          height: "100%",
          textAlign: "left",
          padding: "0 1rem",
          borderRadius: "0.875rem",
          border: "none",
          background: isFocused ? "rgba(255,255,255,0.94)" : isActive ? "rgba(255,255,255,0.08)" : "transparent",
          color: isFocused ? "#0b0c10" : isActive ? "#ffffff" : "rgba(235,236,242,0.78)",
          fontWeight: isActive || isFocused ? 700 : 500,
          fontSize: TV_TEXT,
          cursor: "pointer",
        }}
      >
        {number !== undefined && (
          <span style={{ width: "3.25rem", flexShrink: 0, fontSize: "1.125rem", fontWeight: 600, opacity: isFocused ? 0.7 : 0.55, fontVariantNumeric: "tabular-nums" }}>
            {number}
          </span>
        )}
        <URLImage
          src={channel.logoUrl}
          alt=""
          seed={channel.id}
          objectFit="contain"
          placeholderIcon={SECTION_ICONS.live}
          style={{ width: "3.5rem", height: "3.5rem", borderRadius: "0.5rem", flexShrink: 0, background: isFocused ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.06)" }}
        />
        <MarqueeText text={channel.name} active={isFocused} style={{ minWidth: 0, flex: 1 }} />
        {isActive && (
          <span
            aria-label="On air"
            style={{ width: "0.625rem", height: "0.625rem", borderRadius: 999, background: "#e0332f", boxShadow: "0 0 0.5rem #e0332f", flexShrink: 0 }}
          />
        )}
      </button>
    </Focusable>
  );
});
