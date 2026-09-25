import { RefreshCw } from "lucide-react";

/**
 * Small "Syncing Movies… 12,400" badge in the top-right corner of browse
 * screens while a background sync runs. Purely informational: not
 * focusable, ignores pointer input, and sits inside the TV-safe area.
 */
export function SyncPill({ label }: { label: string }): JSX.Element {
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        top: "2.5vh",
        right: "2.5vw",
        zIndex: 900,
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.5rem 1rem",
        borderRadius: 999,
        background: "rgba(16,17,23,0.82)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1)",
        color: "rgba(235,236,242,0.85)",
        fontSize: "1rem",
        fontWeight: 600,
        pointerEvents: "none",
      }}
    >
      <RefreshCw size="1rem" style={{ animation: "iptv-spin 900ms linear infinite" }} />
      {label}
    </div>
  );
}
