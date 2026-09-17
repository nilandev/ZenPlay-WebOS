import { useEffect, useMemo, useState } from "react";
import type { Channel } from "@core";
import { useFocusStore } from "../focus/focus-store.js";
import { buildGridFocusGraph } from "../focus/build-grid-graph.js";
import { Focusable } from "../focus/Focusable.js";

const VISIBLE_ROWS = 2;
const CARD_HEIGHT_PX = 84;
const ROW_GAP_PX = 12;

export interface LiveOverlayGridProps {
  channels: Channel[];
  columns?: number;
  /** Fired as the user's highlight moves, for channel-preload ("zap-ahead") and glass-panel dismiss-timer resets. */
  onHighlight?: (channel: Channel) => void;
  onSelect?: (channel: Channel) => void;
}

/**
 * Full grid focus graph over every channel (not just the visible window) —
 * up/down/left/right neighbors are computed across the whole list, so
 * keyboard/remote navigation works uniformly. Which two rows are actually
 * rendered ("the window") is a separate, purely visual concern layered on
 * top: whenever focus lands on a row outside the current window, the
 * window slides just enough to bring it back into view — this is what
 * gives the classic TV channel-strip feel of "press down past the bottom
 * row to reveal the next one" without needing a special direction-blocked
 * signal from the focus store itself.
 */
export function LiveOverlayGrid({ channels, columns = 5, onHighlight, onSelect }: LiveOverlayGridProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focusedId = useFocusStore((state) => state.focusedId);
  const [windowStartRow, setWindowStartRow] = useState(0);

  const ids = useMemo(() => channels.map((c) => c.id), [channels]);
  const totalRows = Math.max(1, Math.ceil(channels.length / columns));

  useEffect(() => {
    setGraph("content", buildGridFocusGraph(ids, columns), ids[0]);
    return () => clearGraph("content");
  }, [ids, columns, setGraph, clearGraph]);

  useEffect(() => {
    const index = channels.findIndex((c) => c.id === focusedId);
    if (index === -1) return;

    const channel = channels[index];
    onHighlight?.(channel);

    const focusedRow = Math.floor(index / columns);
    setWindowStartRow((current) => {
      if (focusedRow < current) return focusedRow;
      if (focusedRow > current + VISIBLE_ROWS - 1) return focusedRow - VISIBLE_ROWS + 1;
      return current;
    });
    // channels is a fresh array each render from the caller; only re-run on actual focus/column changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedId, columns, onHighlight]);

  const clampedWindowStart = Math.min(windowStartRow, Math.max(0, totalRows - VISIBLE_ROWS));
  const startIndex = clampedWindowStart * columns;
  const endIndex = Math.min(channels.length, (clampedWindowStart + VISIBLE_ROWS) * columns);
  const visibleChannels = channels.slice(startIndex, endIndex);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gridAutoRows: CARD_HEIGHT_PX,
        gap: ROW_GAP_PX,
        height: VISIBLE_ROWS * CARD_HEIGHT_PX + (VISIBLE_ROWS - 1) * ROW_GAP_PX,
        overflow: "hidden",
      }}
    >
      {visibleChannels.map((channel) => (
        <Focusable key={channel.id} id={channel.id}>
          <ChannelCard channel={channel} isFocused={focusedId === channel.id} onSelect={() => onSelect?.(channel)} />
        </Focusable>
      ))}
    </div>
  );
}

function ChannelCard({ channel, isFocused, onSelect }: { channel: Channel; isFocused: boolean; onSelect: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "8px 6px",
        borderRadius: 14,
        border: isFocused ? "1.5px solid rgba(255,255,255,0.9)" : "1px solid rgba(255,255,255,0.14)",
        background: isFocused ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.08)",
        backdropFilter: "blur(6px)",
        boxShadow: isFocused ? "0 8px 24px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(255,255,255,0.2)" : "none",
        transform: isFocused ? "scale(1.06)" : "scale(1)",
        transition: "transform 140ms ease-out, background 140ms ease-out, box-shadow 140ms ease-out",
        overflow: "hidden",
      }}
    >
      {channel.logoUrl ? (
        <img src={channel.logoUrl} alt="" style={{ height: 28, maxWidth: "70%", objectFit: "contain" }} />
      ) : (
        <div style={{ height: 28, display: "flex", alignItems: "center", fontSize: 11, fontWeight: 700, opacity: 0.8 }}>
          {channel.name.slice(0, 3).toUpperCase()}
        </div>
      )}
      <span
        style={{
          fontSize: 11,
          color: "#fff",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: "100%",
        }}
      >
        {channel.name}
      </span>
    </button>
  );
}
