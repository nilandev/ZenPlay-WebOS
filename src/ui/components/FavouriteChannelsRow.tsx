import { useEffect } from "react";
import type { Channel } from "@core";
import { Heart } from "lucide-react";
import { Focusable } from "../focus/Focusable.js";
import { buildGridFocusGraph } from "../focus/build-grid-graph.js";
import { useFocusStore } from "../focus/focus-store.js";
import { URLImage } from "./URLImage.js";

export interface FavouriteChannelsRowProps {
  channels: Channel[];
  onSelect: (channel: Channel) => void;
  /** Focus id to jump to when pressing up from the grid's first item — typically the preview panel's favourite-toggle button. */
  aboveFocusId?: string;
}

const SCOPE = "content:favourite-channels-row";
const ITEM_PREFIX = "fav-channel:";
const FOCUS_RING = "0 0 0 3px var(--accent), 0 0 0 8px rgba(56,189,248,0.35), 0 0 24px 4px rgba(56,189,248,0.45)";
/** Fixed grid shape — 2 rows of 5 columns — rather than sizing columns to however many favourites exist, so a single favourite renders as one normal-width tile in a 5-column grid instead of stretching to fill the whole row. */
const COLUMNS = 5;
const ROWS = 2;
const MAX_VISIBLE = COLUMNS * ROWS;

/**
 * Fixed 2-row-by-5-column grid of the profile's favourited live channels,
 * shown below the preview panel/info bar. Column width is always `1/5` of
 * the container regardless of how many favourites exist — a single
 * favourite still occupies just one column-width tile, not the whole grid
 * — and the grid stretches to fill whatever vertical space its flex parent
 * gives it (see LiveTvScreen's `flex: 1` wrapper) so it never needs its own
 * scrollbar.
 */
export function FavouriteChannelsRow({ channels, onSelect, aboveFocusId }: FavouriteChannelsRowProps): JSX.Element | null {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focusedId = useFocusStore((state) => state.focusedId);

  const visibleChannels = channels.slice(0, MAX_VISIBLE);
  const ids = visibleChannels.map((c) => `${ITEM_PREFIX}${c.id}`);

  useEffect(() => {
    if (ids.length === 0) {
      clearGraph(SCOPE);
      return;
    }
    const nodes = buildGridFocusGraph(ids, COLUMNS).map((node, index) => ({
      ...node,
      neighbors: { ...node.neighbors, up: node.neighbors.up ?? aboveFocusId },
      onSelect: () => onSelect(visibleChannels[index]),
    }));
    setGraph(SCOPE, nodes);
    return () => clearGraph(SCOPE);
    // channels/onSelect are expected to be stable-enough references from the owning screen, same convention as the other Live TV columns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(","), aboveFocusId, setGraph, clearGraph]);

  if (visibleChannels.length === 0) return null;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, margin: "16px 16px 16px" }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-dim, #9a9aa4)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10, flexShrink: 0 }}>
        Favourites
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${ROWS}, minmax(0, 1fr))`,
          gap: 12,
        }}
      >
        {visibleChannels.map((channel) => {
          const id = `${ITEM_PREFIX}${channel.id}`;
          const isFocused = focusedId === id;
          return (
            <Focusable key={id} id={id}>
              <button
                type="button"
                onClick={() => onSelect(channel)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  width: "100%",
                  height: "100%",
                  padding: "12px 10px",
                  borderRadius: 10,
                  border: "1px solid var(--border, #313139)",
                  background: isFocused ? "var(--surface-raised, #24242c)" : "transparent",
                  boxShadow: isFocused ? FOCUS_RING : "none",
                  transform: isFocused ? "scale(1.04)" : "scale(1)",
                  transition: "transform 140ms ease-out, box-shadow 140ms ease-out, background 140ms ease-out",
                }}
              >
                <div style={{ position: "relative", width: 48, height: 48, flexShrink: 0 }}>
                  <URLImage src={channel.logoUrl} alt="" seed={channel.id} objectFit="contain" />
                  <Heart
                    size={14}
                    strokeWidth={2}
                    color="#ff6b6b"
                    fill="#ff6b6b"
                    style={{ position: "absolute", top: -4, right: -4 }}
                  />
                </div>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: isFocused ? "var(--text, #f4f4f6)" : "var(--text-dim, #9a9aa4)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: "100%",
                  }}
                >
                  {channel.name}
                </span>
              </button>
            </Focusable>
          );
        })}
      </div>
    </div>
  );
}
