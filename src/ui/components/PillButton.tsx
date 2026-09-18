import type { ReactNode } from "react";

export interface PillButtonProps {
  onClick: () => void;
  isFocused: boolean;
  children: ReactNode;
}

/**
 * Rounded glass-chip button (Back, Manage Profiles, etc.) used over
 * MeshBackground's animated color wash. Unlike a plain transparent/outlined
 * button, this always carries its own frosted-glass fill + blur so it stays
 * readable regardless of which color happens to be drifting behind it at
 * the moment — a transparent background there let the light patches of the
 * wash wash out the border/text (see conversation history).
 */
export function PillButton({ onClick, isFocused, children }: PillButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "10px 24px",
        borderRadius: 999,
        border: isFocused ? "1px solid rgba(255,255,255,0.6)" : "1px solid rgba(255,255,255,0.16)",
        background: isFocused
          ? "linear-gradient(160deg, rgba(70,74,84,0.75) 0%, rgba(38,40,48,0.8) 100%)"
          : "linear-gradient(160deg, rgba(55,58,68,0.55) 0%, rgba(28,30,36,0.6) 100%)",
        backdropFilter: "blur(16px) saturate(140%)",
        WebkitBackdropFilter: "blur(16px) saturate(140%)",
        color: isFocused ? "var(--text)" : "var(--text-dim)",
        fontSize: 14,
        fontWeight: 600,
        transform: isFocused ? "scale(1.05)" : "scale(1)",
        boxShadow: isFocused
          ? "inset 0 1px 0 rgba(255,255,255,0.3), 0 0 0 3px var(--accent), 0 12px 28px -8px rgba(0,0,0,0.6)"
          : "inset 0 1px 0 rgba(255,255,255,0.1), 0 6px 16px -6px rgba(0,0,0,0.5)",
        transition: "transform 160ms ease-out, box-shadow 160ms ease-out, background 160ms ease-out, color 160ms ease-out",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
