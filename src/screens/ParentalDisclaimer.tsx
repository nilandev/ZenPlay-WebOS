import { Info } from "lucide-react";
import { TV_TEXT } from "@ui";

/** docs/kids-profile.md §5.1 — shown word for word wherever the disclaimer appears. */
export const PARENTAL_DISCLAIMER_TITLE = "Parental Discretion Disclaimer";
export const PARENTAL_DISCLAIMER =
  "The automated inclusion and exclusion filters are provided as recommendations only. Due to the variable nature of third-party streaming content metadata, automated filtering may occasionally miss mature content or misclassify items. Parental discretion and regular monitoring are advised.";

/**
 * The Parental Discretion Disclaimer panel (docs/kids-profile.md §5): an
 * info icon and semibold heading over body text at the app's standard TV
 * size, on a muted raised surface so it reads as information, not an
 * error. Never focusable and never dismissible — it's shown only on
 * parent-facing screens (the Kids profile form, the first Kids profile
 * confirmation and Parental Controls).
 */
export function ParentalDisclaimer({ compact = false }: { compact?: boolean }): JSX.Element {
  return (
    <aside
      aria-label={PARENTAL_DISCLAIMER_TITLE}
      style={{
        display: "flex",
        gap: "1rem",
        alignItems: "flex-start",
        padding: compact ? "1rem 1.25rem" : "1.25rem 1.5rem",
        borderRadius: "1rem",
        background: "rgba(255,255,255,0.06)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
        color: "var(--text-dim)",
      }}
    >
      <Info size="1.75rem" strokeWidth={2} style={{ flexShrink: 0, marginTop: "0.125rem" }} aria-hidden />
      <div>
        <div style={{ fontSize: TV_TEXT, fontWeight: 600, color: "rgba(235,236,242,0.9)", marginBottom: "0.375rem" }}>{PARENTAL_DISCLAIMER_TITLE}</div>
        <p style={{ margin: 0, fontSize: TV_TEXT, lineHeight: 1.45 }}>{PARENTAL_DISCLAIMER}</p>
      </div>
    </aside>
  );
}
