import { useEffect, useRef } from "react";
import type { Channel, EpgProgramme } from "@core";
import { Focusable } from "../focus/Focusable.js";
import { buildListFocusGraph } from "../focus/build-grid-graph.js";
import { useFocusStore } from "../focus/focus-store.js";
import { Shimmer } from "./Shimmer.js";
import { URLImage } from "./URLImage.js";

export interface EpgProgrammeListProps {
  channel: Channel | null;
  /** Already sorted by start time and scoped to one channel — see ChannelGuide.getProgrammes(). */
  programmes: EpgProgramme[];
  isLoading: boolean;
  onSelectProgramme: (programme: EpgProgramme) => void;
  /** Focus id to jump to when the user presses left from any row — the channel sidebar's currently-focused id. */
  leftEntryId?: string;
}

const SCOPE = "content:epg-programme-list";
const ITEM_PREFIX = "epg-item:";
const LIVE_RED = "#e0332f";
const FOCUS_RING = "0 0 0 3px var(--accent), 0 0 0 8px rgba(56,189,248,0.35), 0 0 24px 4px rgba(56,189,248,0.45)";

function formatTimeRange(programme: EpgProgramme): string {
  const fmt = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${fmt(programme.start)} – ${fmt(programme.stop)}`;
}

function programmeStatus(programme: EpgProgramme): "live" | "past" | "upcoming" {
  const now = Date.now();
  if (programme.stop.getTime() <= now) return "past";
  if (programme.start.getTime() <= now) return "live";
  return "upcoming";
}

/**
 * Column 3 of the redesigned Guide screen: one channel's full programme
 * list (chronological, whatever loadStreamEpg/loadEpg returned), scrolling
 * rather than a horizontal timeline — mirrors LiveChannelPreview's role as
 * "column 3 follows column 2's highlight" but shows a list instead of
 * video, since there's no stream to preview here. Selecting a currently-
 * airing programme plays the channel live; a past programme on an
 * archive-enabled channel plays catch-up; a future programme has no action
 * (nothing to tune into yet).
 */
export function EpgProgrammeList({ channel, programmes, isLoading, onSelectProgramme, leftEntryId }: EpgProgrammeListProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focusedId = useFocusStore((state) => state.focusedId);

  const onSelectRef = useRef(onSelectProgramme);
  onSelectRef.current = onSelectProgramme;

  const ids = programmes.map((_, index) => `${ITEM_PREFIX}${index}`);

  useEffect(() => {
    if (ids.length === 0) {
      clearGraph(SCOPE);
      return;
    }
    const nodes = buildListFocusGraph(ids).map((node, index) => ({
      ...node,
      neighbors: { ...node.neighbors, left: leftEntryId },
      onSelect: () => onSelectRef.current(programmes[index]),
    }));
    setGraph(SCOPE, nodes);
    return () => clearGraph(SCOPE);
    // programmes is recreated per fetch, not per render — ids.join keeps this from re-registering (and resetting scroll/focus) on every unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(","), leftEntryId, setGraph, clearGraph]);

  if (!channel) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim, #9a9aa4)" }}>
        <p>Select a channel to see its guide.</p>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
      <ChannelHeader channel={channel} />

      <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px" }}>
        {isLoading ? (
          <EpgListSkeleton />
        ) : programmes.length === 0 ? (
          <p style={{ color: "var(--text-dim, #9a9aa4)", padding: "24px 8px" }}>No guide data available for this channel.</p>
        ) : (
          programmes.map((programme, index) => {
            const id = `${ITEM_PREFIX}${index}`;
            const isFocused = focusedId === id;
            const status = programmeStatus(programme);
            return (
              <Focusable key={id} id={id} style={{ height: "auto" }}>
                <button
                  type="button"
                  onClick={() => onSelectProgramme(programme)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    width: "100%",
                    textAlign: "left",
                    padding: "14px 16px",
                    marginBottom: 8,
                    borderRadius: 10,
                    border: status === "live" ? `1px solid ${LIVE_RED}` : "1px solid var(--border, #313139)",
                    background: isFocused ? "var(--surface-raised, #24242c)" : "transparent",
                    boxShadow: isFocused ? FOCUS_RING : "none",
                    opacity: status === "past" ? 0.6 : 1,
                    transition: "background 140ms ease-out, box-shadow 140ms ease-out",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {status === "live" && <LiveBadge />}
                    <span style={{ fontSize: 13, color: "var(--text-dim, #9a9aa4)", fontVariantNumeric: "tabular-nums" }}>
                      {formatTimeRange(programme)}
                    </span>
                  </div>
                  <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text, #f4f4f6)" }}>{programme.title}</span>
                  {programme.description && (
                    <span
                      style={{
                        fontSize: 13,
                        color: "var(--text-dim, #9a9aa4)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                      }}
                    >
                      {programme.description}
                    </span>
                  )}
                </button>
              </Focusable>
            );
          })
        )}
      </div>
    </div>
  );
}

function ChannelHeader({ channel }: { channel: Channel }): JSX.Element {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 16px 12px" }}>
      <div style={{ width: 48, height: 48, borderRadius: 8, flexShrink: 0, background: "rgba(255,255,255,0.06)" }}>
        <URLImage src={channel.logoUrl} alt="" seed={channel.id} objectFit="contain" />
      </div>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text, #f4f4f6)" }}>{channel.name}</div>
        <div style={{ fontSize: 13, color: "var(--text-dim, #9a9aa4)" }}>
          {new Date().toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}
        </div>
      </div>
    </div>
  );
}

function LiveBadge(): JSX.Element {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        flexShrink: 0,
        padding: "2px 8px",
        borderRadius: 999,
        background: "rgba(224,51,47,0.15)",
        border: `1px solid ${LIVE_RED}`,
      }}
    >
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: LIVE_RED, boxShadow: `0 0 6px 1px ${LIVE_RED}` }} />
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", color: LIVE_RED }}>NOW</span>
    </span>
  );
}

function EpgListSkeleton(): JSX.Element {
  return (
    <div>
      {Array.from({ length: 5 }, (_, i) => (
        <Shimmer key={i} height={76} borderRadius={10} style={{ marginBottom: 8 }} />
      ))}
    </div>
  );
}
