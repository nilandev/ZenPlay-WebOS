import type { EpgProgramme } from "@core";
import { Tv } from "lucide-react";
import { TV_TEXT } from "../tv-metrics.js";

export function formatGuideTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Neutral channel marker for live TV ("📺 CH 101 · BBC One HD") —
 * identifies the channel without claiming the programme is live (most of
 * what a channel airs is recorded).
 */
export function ChannelChip({ number, name }: { number?: number; name?: string }): JSX.Element {
  const label = [number !== undefined ? `CH ${number}` : null, name].filter(Boolean).join(" · ") || "TV Channel";
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.625rem",
        maxWidth: "100%",
        padding: "0.375rem 1rem",
        borderRadius: "0.5rem",
        background: "rgba(255,255,255,0.14)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.2)",
        color: "#fff",
        fontSize: "1.125rem",
        fontWeight: 700,
        boxSizing: "border-box",
      }}
    >
      <Tv size="1.25rem" strokeWidth={2.25} aria-hidden style={{ flexShrink: 0 }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
    </div>
  );
}

/** "On Now · 9:00–10:00 PM ━━━━░░ 34 min left" for the programme a channel is showing. */
export function OnNowTimeline({ programme, barWidth = "24rem", fontSize = TV_TEXT }: { programme: EpgProgramme; barWidth?: string; fontSize?: string }): JSX.Element {
  const start = programme.start.getTime();
  const stop = programme.stop.getTime();
  const now = Date.now();
  const ratio = stop > start ? Math.min(1, Math.max(0, (now - start) / (stop - start))) : 0;
  const minutesLeft = Math.max(0, Math.round((stop - now) / 60_000));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "1rem", fontSize, color: "rgba(255,255,255,0.75)", whiteSpace: "nowrap" }}>
      <span>
        <span style={{ fontWeight: 800, color: "#fff" }}>On Now</span> · {formatGuideTime(programme.start)}–{formatGuideTime(programme.stop)}
      </span>
      <div style={{ width: barWidth, flexShrink: 1, minWidth: "4rem", height: "0.375rem", borderRadius: 999, background: "rgba(255,255,255,0.22)", overflow: "hidden" }}>
        <div style={{ width: `${ratio * 100}%`, height: "100%", background: "var(--accent)" }} />
      </div>
      <span>{minutesLeft} min left</span>
    </div>
  );
}

/** "Next · 10:00 PM Panorama". */
export function NextProgrammeLine({ programme, fontSize = "1.125rem" }: { programme: EpgProgramme; fontSize?: string }): JSX.Element {
  return (
    <div style={{ fontSize, color: "rgba(255,255,255,0.65)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      <span style={{ fontWeight: 700 }}>Next</span> · {formatGuideTime(programme.start)} {programme.title}
    </div>
  );
}
