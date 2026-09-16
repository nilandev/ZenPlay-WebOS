import { useEffect, useMemo } from "react";
import type { Channel, EpgProgramme } from "@iptv/core";
import { Focusable } from "../focus/Focusable.js";
import { useFocusStore } from "../focus/focus-store.js";
import { buildGridFocusGraph } from "../focus/build-grid-graph.js";

const PIXELS_PER_MINUTE = 4;
const ROW_HEIGHT_PX = 64;
const CHANNEL_COLUMN_WIDTH_PX = 200;

export interface EpgGridProps {
  channels: Channel[];
  /** Programmes per channel id, e.g. from ChannelGuide.getProgrammesInRange(). */
  programmesByChannel: Map<string, EpgProgramme[]>;
  windowStart: Date;
  windowEnd: Date;
  onSelectProgramme?: (channel: Channel, programme: EpgProgramme) => void;
}

function focusIdFor(channelId: string, programmeIndex: number): string {
  return `epg:${channelId}:${programmeIndex}`;
}

/**
 * Timeline EPG grid (TiviMate/Smarters-style): channels down the left,
 * a horizontal time axis, programme blocks sized proportionally to their
 * duration. Only renders the given [windowStart, windowEnd) slice — the
 * screen composing this should page the window forward/back rather than
 * rendering a whole day at once, since a 500-channel x 24h grid is a lot
 * of DOM even before considering TV-class rendering budgets.
 */
export function EpgGrid({ channels, programmesByChannel, windowStart, windowEnd, onSelectProgramme }: EpgGridProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
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
      buildGridFocusGraph(rowIds, rowIds.length).map((node, colIndex) => ({
        ...node,
        neighbors: {
          ...node.neighbors,
          up: rowIndex > 0 ? focusIds[rowIndex - 1][0] : undefined,
          down: rowIndex < focusIds.length - 1 ? focusIds[rowIndex + 1][0] : undefined,
        },
      })),
    );
    setGraph("content", nodes, flatIds[0]);
    return () => clearGraph("content");
  }, [focusIds, setGraph, clearGraph]);

  return (
    <div style={{ display: "flex", overflow: "auto", height: "100%" }}>
      <div style={{ flex: "0 0 auto", position: "sticky", left: 0, zIndex: 1, background: "#0b0b0f" }}>
        {rows.map(({ channel }) => (
          <div
            key={channel.id}
            style={{
              width: CHANNEL_COLUMN_WIDTH_PX,
              height: ROW_HEIGHT_PX,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 12px",
              borderBottom: "1px solid #222",
            }}
          >
            {channel.logoUrl && <img src={channel.logoUrl} alt="" height={24} />}
            <span style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {channel.name}
            </span>
          </div>
        ))}
      </div>

      <div style={{ position: "relative", width: totalWidth }}>
        {rows.map(({ channel, programmes }, rowIndex) => (
          <div key={channel.id} style={{ position: "relative", height: ROW_HEIGHT_PX, borderBottom: "1px solid #222" }}>
            {programmes.map((programme, index) => {
              const startOffsetMin = Math.max(0, (programme.start.getTime() - windowStart.getTime()) / 60000);
              const endOffsetMin = Math.min(windowMinutes, (programme.stop.getTime() - windowStart.getTime()) / 60000);
              const left = startOffsetMin * PIXELS_PER_MINUTE;
              const width = Math.max(4, (endOffsetMin - startOffsetMin) * PIXELS_PER_MINUTE);
              const id = focusIds[rowIndex][index];

              return (
                <div key={id} style={{ position: "absolute", left, width, top: 4, bottom: 4 }}>
                  <Focusable id={id}>
                    <button
                      type="button"
                      onClick={() => onSelectProgramme?.(channel, programme)}
                      style={{
                        width: "100%",
                        height: "100%",
                        textAlign: "left",
                        padding: "4px 8px",
                        fontSize: 12,
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {programme.title}
                    </button>
                  </Focusable>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
