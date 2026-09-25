import type { LucideIcon } from "lucide-react";
import { Focusable } from "../focus/Focusable.js";
import { useIsFocused } from "../focus/focus-store.js";
import { TV_TEXT } from "../tv-metrics.js";

export interface TvButtonProps {
  /** Focus id — the owner wires it into its focus graph. */
  id: string;
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  /** "primary" fills the idle button with the accent (the screen's main action); "danger" tints it red (Delete). Focus is always solid white. */
  variant?: "default" | "primary" | "danger";
  /** Rendered dimmed and not focusable (the owner should leave it out of the graph). */
  disabled?: boolean;
  /** Work in progress (e.g. "Connecting…"): the icon spins and presses are ignored, but the button keeps focus so the D-pad doesn't lose its place. */
  busy?: boolean;
}

/**
 * The app's standard TV pill button: translucent when idle, solid white with
 * dark text and a slight lift when focused (the same language as the series
 * detail actions, "+ My List" and "Edit My List"). Only transform animates.
 * The Focusable is sized to the button, not the default 100% width.
 */
export function TvButton({ id, label, icon: Icon, onSelect, variant = "default", disabled = false, busy = false }: TvButtonProps): JSX.Element {
  const isFocused = useIsFocused(id);
  const idleBackground = variant === "danger" ? "rgba(224,51,47,0.2)" : variant === "primary" ? "var(--accent)" : "rgba(255,255,255,0.12)";
  const idleColor = variant === "danger" ? "#ff8a8a" : variant === "primary" ? "#062028" : "#ffffff";

  const button = (
    <button
      type="button"
      onClick={disabled || busy ? undefined : onSelect}
      disabled={disabled}
      aria-busy={busy || undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.625rem",
        padding: "0.875rem 1.75rem",
        border: "none",
        borderRadius: 999,
        fontSize: TV_TEXT,
        fontWeight: 700,
        whiteSpace: "nowrap",
        background: isFocused ? "#ffffff" : idleBackground,
        color: isFocused ? (variant === "danger" ? "#b3261e" : "#0b0c10") : idleColor,
        boxShadow: isFocused ? "0 1rem 2rem -0.5rem rgba(0,0,0,0.6)" : "inset 0 0 0 1px rgba(255,255,255,0.08)",
        transform: isFocused ? "scale(1.06)" : "scale(1)",
        transition: "transform 200ms cubic-bezier(0.2, 0.9, 0.3, 1)",
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {Icon && <Icon size="1.5rem" strokeWidth={2.25} style={busy ? { animation: "iptv-spin 900ms linear infinite" } : undefined} />}
      {label}
    </button>
  );

  if (disabled) return button;
  return (
    <Focusable id={id} style={{ width: "auto", height: "auto", flexShrink: 0 }}>
      {button}
    </Focusable>
  );
}
