import { useEffect } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { TV_TEXT } from "../tv-metrics.js";

export interface ToastProps {
  message: string;
  tone?: "success" | "error";
  /** Called once the toast has been on screen for durationMs — the owner removes it. */
  onDismiss: () => void;
  durationMs?: number;
}

/**
 * A short result message at the bottom of the screen (e.g. "Playlist
 * updated"). Deliberately never focusable and never in a focus graph: it
 * must not steal the D-pad from whatever the user is on, so it carries no
 * buttons — any follow-up action stays on the screen itself (the message
 * says where).
 */
export function Toast({ message, tone = "success", onDismiss, durationMs = 5000 }: ToastProps): JSX.Element {
  useEffect(() => {
    const timer = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(timer);
  }, [message, onDismiss, durationMs]);

  const Icon = tone === "error" ? AlertCircle : CheckCircle2;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      style={{
        position: "fixed",
        left: "50%",
        bottom: "6vh",
        transform: "translateX(-50%)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        gap: "0.875rem",
        maxWidth: "70vw",
        padding: "1rem 1.75rem",
        borderRadius: 999,
        background: "rgba(16,17,23,0.94)",
        boxShadow: `0 1.5rem 3rem rgba(0,0,0,0.5), inset 0 0 0 1px ${tone === "error" ? "rgba(255,138,138,0.45)" : "rgba(74,222,128,0.4)"}`,
        color: "#fff",
        fontSize: TV_TEXT,
        fontWeight: 600,
        pointerEvents: "none",
      }}
    >
      <Icon size="1.75rem" color={tone === "error" ? "#ff8a8a" : "#4ade80"} style={{ flexShrink: 0 }} />
      <span>{message}</span>
    </div>
  );
}
