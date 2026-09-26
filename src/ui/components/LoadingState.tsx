import { LoaderCircle } from "lucide-react";
import { SlowLoadHint } from "./SlowLoadHint.js";

export interface LoadingStateProps {
  /**
   * Centre on the screen (fixed to the viewport, so a sticky header or the
   * scroll position can't push it off-centre) rather than inside the
   * surrounding section — e.g. the episode row under a series' details.
   */
  centered?: boolean;
  /**
   * Show "Still loading…" if this takes a while — only for a first load
   * with nothing stored yet (a network fetch). Reads from the local tables
   * are quick, and a hint there would only suggest the app is struggling.
   */
  showSlowHint?: boolean;
}

/** A plain spinner with "Loading…" — what the Movies and Series screens show while there's nothing to render yet. */
export function LoadingState({ centered = false, showSlowHint = false }: LoadingStateProps): JSX.Element {
  return (
    <div
      role="status"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        ...(centered ? { position: "fixed", inset: 0, pointerEvents: "none" } : { minHeight: "40vh" }),
        color: "var(--text-dim, #9a9aa4)",
      }}
    >
      <LoaderCircle size="3rem" strokeWidth={2.25} style={{ animation: "iptv-spin 900ms linear infinite", color: "rgba(235,236,242,0.85)" }} />
      <span style={{ fontSize: "1.25rem", fontWeight: 600 }}>Loading…</span>
      {showSlowHint && <SlowLoadHint style={{ margin: 0, fontSize: "1rem", textAlign: "center" }} />}
      <style>{`@keyframes iptv-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
