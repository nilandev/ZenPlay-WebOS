import type { Channel, EpgProgramme } from "@core";

export interface ProgrammePreviewProps {
  channel: Channel | null;
  programme: EpgProgramme | null;
  width?: number;
}

function formatTimeRange(programme: EpgProgramme): string {
  const fmt = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${fmt(programme.start)} – ${fmt(programme.stop)}`;
}

function formatDuration(programme: EpgProgramme): string {
  const minutes = Math.round((programme.stop.getTime() - programme.start.getTime()) / 60000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${rest}m` : `${rest}m`;
}

/**
 * Right-side detail panel for whatever programme currently has focus in the
 * EPG grid — channel identity, title, time range/duration, and synopsis.
 * Purely presentational; the owning screen decides what's focused and
 * passes it down (see GuideScreen's onFocusProgramme wiring to EpgGrid).
 */
export function ProgrammePreview({ channel, programme, width = 340 }: ProgrammePreviewProps): JSX.Element {
  if (!channel || !programme) {
    return (
      <div style={{ width, flexShrink: 0, padding: 24, color: "var(--text-dim, #9a9aa4)" }}>
        <p>Select a programme to see details.</p>
      </div>
    );
  }

  const isLive = programme.start.getTime() <= Date.now() && Date.now() < programme.stop.getTime();
  const isPast = programme.stop.getTime() < Date.now();

  return (
    <div
      style={{
        width,
        flexShrink: 0,
        borderLeft: "1px solid var(--border, #313139)",
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        overflowY: "auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {channel.logoUrl ? (
          <img src={channel.logoUrl} alt="" height={32} style={{ objectFit: "contain" }} />
        ) : (
          <div style={{ width: 32, height: 32, borderRadius: 6, background: "var(--surface-raised, #24242c)" }} />
        )}
        <span style={{ fontSize: 13, color: "var(--text-dim, #9a9aa4)" }}>{channel.name}</span>
      </div>

      {isLive && (
        <span
          style={{
            alignSelf: "flex-start",
            fontSize: 11,
            fontWeight: 700,
            color: "#062028",
            background: "var(--accent, #38bdf8)",
            borderRadius: 4,
            padding: "2px 8px",
          }}
        >
          ON NOW
        </span>
      )}

      <h2 style={{ fontSize: 20, lineHeight: 1.3 }}>{programme.title}</h2>

      <div style={{ fontSize: 13, color: "var(--text-dim, #9a9aa4)" }}>
        {formatTimeRange(programme)} · {formatDuration(programme)}
      </div>

      {programme.description && (
        <p style={{ fontSize: 14, color: "var(--text, #f4f4f6)", lineHeight: 1.6 }}>{programme.description}</p>
      )}

      {isPast && !channel.hasArchive && (
        <p style={{ fontSize: 12, color: "var(--text-dim, #9a9aa4)", fontStyle: "italic" }}>
          This programme has already aired and catch-up isn't available for this channel.
        </p>
      )}
    </div>
  );
}
