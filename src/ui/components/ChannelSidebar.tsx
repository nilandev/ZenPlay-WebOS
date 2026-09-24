import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Channel } from "@core";
import { Focusable, FocusScrollManagedContext } from "../focus/Focusable.js";
import { buildListFocusGraph } from "../focus/build-grid-graph.js";
import { useFocusStore, useIsFocused } from "../focus/focus-store.js";
import { MarqueeText } from "./MarqueeText.js";
import { URLImage } from "./URLImage.js";
import { SECTION_ICONS } from "../section-icons.js";

export interface ChannelSidebarProps {
  channels: Channel[];
  activeChannelId?: string;
  onHighlight: (channel: Channel) => void;
  onSelect: (channel: Channel) => void;
  width?: number;
  /** Focus id to jump to when the user presses left from any row — the category sidebar's currently-focused id. */
  leftEntryId?: string;
  /** Focus id to jump to when the user presses right from any row — the preview panel's single focus node. */
  rightEntryId?: string;
}

const SCOPE = "content:channel-sidebar";
/** Fixed row pitch (60px row + 6px gap) — windowing needs every row's position to be computable without measuring. */
const ROW_HEIGHT_PX = 66;
const ROW_GAP_PX = 6;
const LIST_PADDING_PX = 12;
/** Rows rendered beyond each edge of the viewport, so a D-pad step always lands on an already-mounted row. */
const OVERSCAN_ROWS = 6;
/** Used until the list has been laid out (and in jsdom, which never lays out) — a full 1080p screen's worth of rows. */
const FALLBACK_VIEWPORT_PX = 1080;

/**
 * Column 2 of the Live TV browse layout: a vertical list of channels
 * belonging to the currently selected category (column 1). Mirrors
 * CategorySidebar's own list-graph/scope wiring, but reports every focus
 * change via onHighlight (not just onSelect) — the spec's column 3 preview
 * player is meant to follow highlight, debounced, not wait for a commit.
 *
 * Windowed: an "All Channels" list can run to thousands of rows, so only
 * the rows in (or near) the viewport are mounted, absolutely positioned at
 * their fixed-pitch offsets inside a full-height spacer. The focus graph
 * still covers every channel; this component follows focus via a store
 * subscription (not render state) and scrolls the target row into range
 * itself, so a D-pad press re-renders just the two rows whose focused state
 * changed instead of the whole list.
 */
export function ChannelSidebar({ channels, activeChannelId, onHighlight, onSelect, width = 340, leftEntryId, rightEntryId }: ChannelSidebarProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focus = useFocusStore((state) => state.focus);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(FALLBACK_VIEWPORT_PX);

  const onHighlightRef = useRef(onHighlight);
  onHighlightRef.current = onHighlight;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const handleRowSelect = useCallback((channel: Channel) => onSelectRef.current(channel), []);

  const indexById = useMemo(() => new Map(channels.map((channel, index) => [channel.id, index])), [channels]);

  useEffect(() => {
    const ids = channels.map((channel) => channel.id);
    const nodes = buildListFocusGraph(ids).map((node, index) => ({
      ...node,
      neighbors: { ...node.neighbors, left: leftEntryId, right: rightEntryId },
      onSelect: () => onSelectRef.current(channels[index]),
    }));
    setGraph(SCOPE, nodes);
  }, [channels, leftEntryId, rightEntryId, setGraph, clearGraph]);
  // Rebuilds above replace the scope in place (setGraph is atomic); clearing
  // it on every rebuild would drop focus for an instant and snap it back to
  // the first node. Clear only when this component goes away.
  useEffect(() => () => clearGraph(SCOPE), [clearGraph]);


  useLayoutEffect(() => {
    function measure(): void {
      const height = scrollRef.current?.clientHeight ?? 0;
      if (height > 0) setViewportHeight(height);
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
      const rowTop = LIST_PADDING_PX + index * ROW_HEIGHT_PX;
      const rowBottom = rowTop + ROW_HEIGHT_PX - ROW_GAP_PX;
      let next = el.scrollTop;
      if (rowTop - LIST_PADDING_PX < next) next = rowTop - LIST_PADDING_PX;
      else if (rowBottom + LIST_PADDING_PX > next + viewport) next = rowBottom + LIST_PADDING_PX - viewport;
      if (next !== el.scrollTop) {
        el.scrollTop = next;
        setScrollTop(next);
      }
    }

    onFocusChange(useFocusStore.getState().focusedId);
    return useFocusStore.subscribe((state, prev) => {
      if (state.focusedId !== prev.focusedId) onFocusChange(state.focusedId);
    });
  }, [channels, indexById]);

  // Re-focus the first row whenever the channel list itself changes (i.e.
  // the user picked a different category) — without this, focusedId would
  // keep pointing at a row id from the previous category that no longer
  // exists in this scope, and the store's setGraph() fallback would only
  // catch that on the very first registration, not a later category switch.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setScrollTop(0);
    if (channels.length > 0) focus(channels[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels]);

  const firstIndex = Math.max(0, Math.floor((scrollTop - LIST_PADDING_PX) / ROW_HEIGHT_PX) - OVERSCAN_ROWS);
  const lastIndex = Math.min(channels.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT_PX) + OVERSCAN_ROWS);

  return (
    <div
      ref={scrollRef}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      style={{
        width,
        flexShrink: 0,
        borderRight: "1px solid var(--border, #313139)",
        overflowY: "auto",
        padding: `${LIST_PADDING_PX}px 8px`,
      }}
    >
      <FocusScrollManagedContext.Provider value={true}>
        <div style={{ position: "relative", height: channels.length * ROW_HEIGHT_PX }}>
          {channels.slice(firstIndex, lastIndex).map((channel, offset) => (
            <div
              key={channel.id}
              style={{
                position: "absolute",
                top: (firstIndex + offset) * ROW_HEIGHT_PX,
                left: 0,
                right: 0,
                height: ROW_HEIGHT_PX - ROW_GAP_PX,
              }}
            >
              <ChannelRow channel={channel} isActive={activeChannelId === channel.id} onSelect={handleRowSelect} />
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
  isActive,
  onSelect,
}: {
  channel: Channel;
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
          gap: 12,
          width: "100%",
          height: "100%",
          textAlign: "left",
          padding: "10px 12px",
          borderRadius: 8,
          border: "none",
          background: isFocused ? "var(--accent, #38bdf8)" : isActive ? "var(--surface-raised, #24242c)" : "transparent",
          color: isFocused ? "#062028" : isActive ? "var(--text, #f4f4f6)" : "var(--text-dim, #9a9aa4)",
          fontWeight: isActive || isFocused ? 700 : 500,
          fontSize: 16,
          transform: isFocused ? "scale(1.03)" : "scale(1)",
          transition: "transform 120ms ease-out, background 120ms ease-out",
        }}
      >
        <URLImage
          src={channel.logoUrl}
          alt=""
          seed={channel.id}
          objectFit="contain"
          style={{ width: 40, height: 40, borderRadius: 6, flexShrink: 0, background: "rgba(255,255,255,0.06)" }}
        placeholderIcon={SECTION_ICONS.live}
          />
        <MarqueeText text={channel.name} active={isFocused} style={{ minWidth: 0, flex: 1 }} />
      </button>
    </Focusable>
  );
});
