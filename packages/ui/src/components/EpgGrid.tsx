import { useEffect, useMemo } from "react";
import type { Channel, EpgProgramme } from "@iptv/core";
import { Focusable } from "../focus/Focusable.js";
import { useFocusStore } from "../focus/focus-store.js";
import { buildGridFocusGraph } from "../focus/build-grid-graph.js";

const PIXELS_PER_MINUTE = 4;
const ROW_HEIGHT_PX = 72;
const CHANNEL_COLUMN_WIDTH_PX = 220;

export interface EpgGridProps {
  channels: Channel[];
  /** Programmes per channel id, e.g. from ChannelGuide.getProgrammesInRange(). */
  programmesByChannel: Map<string, EpgProgramme[]>;
  windowStart: Date;
  windowEnd: Date;
  onFocusProgramme?: (channel: Channel, programme: EpgProgramme) => void;
  onSelectProgramme?: (channel: Channel, programme: EpgProgramme) => void;
  /** Focus id to jump to when the user presses left from the first column of any row — typically the active category sidebar item. */
  sidebarEntryId?: string;
}

function focusIdFor(channelId: string, programmeIndex: number): string {
  return `epg:${channelId}:${programmeIndex}`;
}

function formatTimeRange(programme: EpgProgramme): string {
  const fmt = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${fmt(programme.start)} – ${fmt(programme.stop)}`;
}

/**
 * Timeline EPG grid (TiviMate/Smarters-style): channels down the left,
 * a horizontal time axis, programme blocks sized proportionally to their
 * duration. Only renders the given [windowStart, windowEnd) slice — the
 * screen composing this should page the window forward/back rather than
 * rendering a whole day at once, since a 500-channel x 24h grid is a lot
 * of DOM even before considering TV-class rendering budgets.
 *
 * Registers its own "content" focus scope with a real visible focus ring
 * per programme cell (scale + glow, matching FocusCard/Shelf elsewhere) —
 * a plain Focusable with no styling is invisible even though focus state
 * moves correctly, which is what made earlier versions of this grid look
 * "not navigable" despite arrow keys technically working.
 */
export function EpgGrid({
  channels,
  programmesByChannel,
  windowStart,
  windowEnd,
  onFocusProgramme,
  onSelectProgramme,
  sidebarEntryId,
}: EpgGridProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focusedId = useFocusStore((state) => state.focusedId);
  const windowMinutes = (windowEnd.getTime() - windowStart.getTime()) / 60000;
  const totalWidth = windowMinutes * PIXELS_PER_MINUTE;

  const rows = useMemo(
    () =>
      channels.map((channel) => ({
        channel,
        programmes: programmesByChannel.get(channel.epgChannelId ?? channel.id) ?? [],
      })),
    [channels, programmesByChannel],
  );

  const focusIds = useMemo(
    () => rows.map((row) => row.programmes.map((_, i) => focusIdFor(row.channel.id, i))),
    [rows],
  );

  useEffect(() => {
    const flatIds = focusIds.flat();
    if (flatIds.length === 0) return;
    // Each row can have a different number of programmes, so a plain
    // rectangular grid graph doesn't fit; build row-local left/right chains
    // and only wire up/down to the first visible programme in each row.
    const nodes = focusIds.flatMap((rowIds, rowIndex) =>
      buildGridFocusGraph(rowIds, rowIds.length).map((node, colIndex) => {
        const [, channelId, programmeIndexStr] = node.id.split(":");
        const programmeIndex = Number(programmeIndexStr);
        const channel = rows[rowIndex].channel;
        const programme = rows[rowIndex].programmes[programmeIndex];
        return {
          ...node,
          neighbors: {
            ...node.neighbors,
            left: colIndex === 0 ? sidebarEntryId : node.neighbors.left,
            up: rowIndex > 0 ? focusIds[rowIndex - 1][0] : undefined,
            down: rowIndex < focusIds.length - 1 ? focusIds[rowIndex + 1][0] : undefined,
          },
          onSelect: () => onSelectProgramme?.(channel, programme),
        };
      }),
    );
    setGraph("content", nodes, flatIds[0]);
    return () => clearGraph("content");
    // onSelectProgramme is expected to be a stable callback from the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIds, rows, sidebarEntryId, setGraph, clearGraph]);

  useEffect(() => {
    if (!focusedId?.startsWith("epg:")) return;
    const [, channelId, programmeIndexStr] = focusedId.split(":");
    const row = rows.find((r) => r.channel.id === channelId);
    const programme = row?.programmes[Number(programmeIndexStr)];
    if (row && programme) onFocusProgramme?.(row.channel, programme);
    // onFocusProgramme is expected to be a stable callback from the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedId, rows]);

  return (
    <div style={{ display: "flex", overflow: "auto", height: "100%" }}>
      <div style={{ flex: "0 0 auto", position: "sticky", left: 0, zIndex: 1, background: "var(--bg, #0b0b0f)" }}>
        {rows.map(({ channel }) => (
          <div
            key={channel.id}
            style={{
              width: CHANNEL_COLUMN_WIDTH_PX,
              height: ROW_HEIGHT_PX,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "0 14px",
              borderBottom: "1px solid var(--border, #222)",
            }}
          >
            {channel.logoUrl ? (
              <img src={channel.logoUrl} alt="" height={28} style={{ objectFit: "contain" }} />
            ) : (
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  background: "var(--surface-raised, #24242c)",
                  flexShrink: 0,
                }}
              />
            )}
            <span style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {channel.name}
            </span>
          </div>
        ))}
      </div>

      <div style={{ position: "relative", width: totalWidth }}>
        {rows.map(({ channel, programmes }, rowIndex) => (
          <div
            key={channel.id}
            style={{ position: "relative", height: ROW_HEIGHT_PX, borderBottom: "1px solid var(--border, #222)" }}
          >
            {programmes.map((programme, index) => {
              const startOffsetMin = Math.max(0, (programme.start.getTime() - windowStart.getTime()) / 60000);
              const endOffsetMin = Math.min(windowMinutes, (programme.stop.getTime() - windowStart.getTime()) / 60000);
              const left = startOffsetMin * PIXELS_PER_MINUTE;
              const width = Math.max(4, (endOffsetMin - startOffsetMin) * PIXELS_PER_MINUTE);
              const id = focusIds[rowIndex][index];
              const isLive = programme.start.getTime() <= Date.now() && Date.now() < programme.stop.getTime();

              return (
                <div key={id} style={{ position: "absolute", left, width, top: 4, bottom: 4 }}>
                  <ProgrammeCell
                    id={id}
                    title={programme.title}
                    isLive={isLive}
                    timeRange={formatTimeRange(programme)}
                    onClick={() => onSelectProgramme?.(channel, programme)}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function ProgrammeCell({
  id,
  title,
  isLive,
  timeRange,
  onClick,
}: {
  id: string;
  title: string;
  isLive: boolean;
  timeRange: string;
  onClick: () => void;
}): JSX.Element {
  const isFocused = useFocusStore((state) => state.focusedId === id);
  const focus = useFocusStore((state) => state.focus);

  return (
    <Focusable id={id}>
      <button
        type="button"
        onClick={() => {
          focus(id);
          onClick();
        }}
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 6,
          padding: "6px 10px",
          overflow: "hidden",
          textAlign: "left",
          background: isFocused ? "var(--accent, #6ee7ff)" : isLive ? "var(--surface-raised, #24242c)" : "var(--surface, #1a1a20)",
          color: isFocused ? "#062028" : "var(--text, #f4f4f6)",
          border: isLive && !isFocused ? "1px solid var(--accent-dim, #3a8fa3)" : "1px solid transparent",
          transform: isFocused ? "scale(1.03)" : "scale(1)",
          boxShadow: isFocused ? "0 6px 18px rgba(0,0,0,0.4)" : "none",
          transition: "transform 120ms ease-out, background 120ms ease-out, box-shadow 120ms ease-out",
          cursor: "pointer",
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: isFocused ? 700 : 500,
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            overflow: "hidden",
          }}
        >
          {title}
        </div>
        <div style={{ fontSize: 10, opacity: 0.75, whiteSpace: "nowrap" }}>{timeRange}</div>
      </button>
    </Focusable>
  );
}
