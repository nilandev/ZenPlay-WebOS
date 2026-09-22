import { useEffect } from "react";
import type { Channel } from "@core";
import { Focusable } from "../focus/Focusable.js";
import { buildListFocusGraph } from "../focus/build-grid-graph.js";
import { useFocusStore } from "../focus/focus-store.js";
import { MarqueeText } from "./MarqueeText.js";
import { URLImage } from "./URLImage.js";

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

/**
 * Column 2 of the Live TV browse layout: a vertical list of channels
 * belonging to the currently selected category (column 1). Mirrors
 * CategorySidebar's own list-graph/scope wiring, but reports every focus
 * change via onHighlight (not just onSelect) — the spec's column 3 preview
 * player is meant to follow highlight, debounced, not wait for a commit.
 */
export function ChannelSidebar({ channels, activeChannelId, onHighlight, onSelect, width = 340, leftEntryId, rightEntryId }: ChannelSidebarProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focusedId = useFocusStore((state) => state.focusedId);
  const focus = useFocusStore((state) => state.focus);

  useEffect(() => {
    const ids = channels.map((channel) => channel.id);
    const nodes = buildListFocusGraph(ids).map((node, index) => ({
      ...node,
      neighbors: { ...node.neighbors, left: leftEntryId, right: rightEntryId },
      onSelect: () => onSelect(channels[index]),
    }));
    setGraph(SCOPE, nodes);
    return () => clearGraph(SCOPE);
    // channels/onSelect are expected to be stable-enough references from the owning screen, same convention as CategorySidebar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, leftEntryId, rightEntryId, setGraph, clearGraph]);

  // Re-focus the first row whenever the channel list itself changes (i.e.
  // the user picked a different category) — without this, focusedId would
  // keep pointing at a row id from the previous category that no longer
  // exists in this scope, and the store's setGraph() fallback would only
  // catch that on the very first registration, not a later category switch.
  useEffect(() => {
    if (channels.length > 0) focus(channels[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels]);

  useEffect(() => {
    if (!focusedId) return;
    const channel = channels.find((c) => c.id === focusedId);
    if (channel) onHighlight(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedId, channels]);

  return (
    <div
      style={{
        width,
        flexShrink: 0,
        borderRight: "1px solid var(--border, #313139)",
        overflowY: "auto",
        padding: "12px 8px",
      }}
    >
      {channels.map((channel) => {
        const isFocused = focusedId === channel.id;
        const isActive = activeChannelId === channel.id;
        return (
          <Focusable key={channel.id} id={channel.id} style={{ height: "auto" }}>
            <button
              type="button"
              onClick={() => onSelect(channel)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: "100%",
                textAlign: "left",
                padding: "10px 12px",
                marginBottom: 6,
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
              />
              <MarqueeText text={channel.name} active={isFocused} style={{ minWidth: 0, flex: 1 }} />
            </button>
          </Focusable>
        );
      })}
    </div>
  );
}
