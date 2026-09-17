import { useEffect, useMemo, useState } from "react";
import type { Channel } from "@core";
import { useFocusStore } from "../focus/focus-store.js";
import { buildGridFocusGraph } from "../focus/build-grid-graph.js";
import { Focusable } from "../focus/Focusable.js";

const ROW_HEIGHT_PX = 96;
const OVERSCAN_ROWS = 2;

export interface ChannelGridProps {
  channels: Channel[];
  columns?: number;
  /** Fired as the user's highlight moves, for channel-preload ("zap-ahead"). */
  onHighlight?: (channel: Channel) => void;
  onSelect?: (channel: Channel) => void;
  viewportHeightPx: number;
}

/**
 * Virtualized channel grid: only renders rows within the visible viewport
 * (plus a small overscan buffer), since provider playlists can list
 * 10,000+ channels and rendering them all would tank scroll/focus
 * performance on TV-class hardware.
 */
export function ChannelGrid({
  channels,
  columns = 4,
  onHighlight,
  onSelect,
  viewportHeightPx,
}: ChannelGridProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focusedId = useFocusStore((state) => state.focusedId);
  const [scrollTop, setScrollTop] = useState(0);

  const ids = useMemo(() => channels.map((c) => c.id), [channels]);

  useEffect(() => {
    setGraph("content", buildGridFocusGraph(ids, columns), ids[0]);
    return () => clearGraph("content");
  }, [ids, columns, setGraph, clearGraph]);

  useEffect(() => {
    const channel = channels.find((c) => c.id === focusedId);
    if (channel) onHighlight?.(channel);
  }, [focusedId, channels, onHighlight]);

  const totalRows = Math.ceil(channels.length / columns);
  const totalHeight = totalRows * ROW_HEIGHT_PX;

  const firstVisibleRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT_PX) - OVERSCAN_ROWS);
  const visibleRowCount = Math.ceil(viewportHeightPx / ROW_HEIGHT_PX) + OVERSCAN_ROWS * 2;
  const lastVisibleRow = Math.min(totalRows, firstVisibleRow + visibleRowCount);

  const startIndex = firstVisibleRow * columns;
  const endIndex = Math.min(channels.length, lastVisibleRow * columns);
  const visibleChannels = channels.slice(startIndex, endIndex);

  return (
    <div
      style={{ height: viewportHeightPx, overflowY: "auto", position: "relative" }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        <div
          style={{
            position: "absolute",
            top: firstVisibleRow * ROW_HEIGHT_PX,
            display: "grid",
            gridTemplateColumns: `repeat(${columns}, 1fr)`,
            width: "100%",
            gap: "8px",
          }}
        >
          {visibleChannels.map((channel) => (
            <Focusable key={channel.id} id={channel.id} className="channel-tile">
              <button
                type="button"
                onClick={() => onSelect?.(channel)}
                style={{ width: "100%", height: ROW_HEIGHT_PX - 8 }}
              >
                {channel.logoUrl && <img src={channel.logoUrl} alt="" loading="lazy" height={32} />}
                <span>{channel.name}</span>
              </button>
            </Focusable>
          ))}
        </div>
      </div>
    </div>
  );
}
