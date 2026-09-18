import type { Profile } from "@core";
import { useFocusStore } from "../focus/focus-store.js";

export interface ProfileSwitcherProps {
  profile: Profile;
  onOpen: () => void;
}

/** Shared with callers (e.g. HomeScreen's focus graph) so the id used to register this in useFocusStore always matches the id it reads its own focus state from. */
export const PROFILE_SWITCHER_FOCUS_ID = "profile-switcher";

/**
 * Top-left profile chip: current avatar + name. Selecting it (click or
 * D-pad select) navigates straight to the full "Who's watching?" screen —
 * there's no in-place dropdown to switch profiles or manage them, since
 * that screen already exists and is a more natural place for both actions
 * (matches Netflix/Disney+/Apple TV, which don't have a corner dropdown
 * either). An earlier version of this component had its own dropdown with
 * per-node D-pad focus wiring; removed in favor of this simpler flow — see
 * conversation history.
 */
export function ProfileSwitcher({ profile, onOpen }: ProfileSwitcherProps): JSX.Element {
  const isFocused = useFocusStore((state) => state.focusedId === PROFILE_SWITCHER_FOCUS_ID);

  return (
    <div style={{ position: "relative" }}>
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: "-1.25rem",
          borderRadius: 999,
          background: "radial-gradient(closest-side, rgba(130,190,255,0.7) 0%, rgba(130,190,255,0.25) 45%, rgba(130,190,255,0) 75%)",
          filter: "blur(0.75rem)",
          opacity: isFocused ? 1 : 0,
          transform: isFocused ? "scale(1)" : "scale(0.8)",
          transition: "opacity 260ms ease-out, transform 260ms ease-out",
          pointerEvents: "none",
        }}
      />
      <button
        type="button"
        onClick={onOpen}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: "0.625rem",
          border: isFocused ? "1px solid rgba(255,255,255,0.6)" : "1px solid rgba(255,255,255,0.08)",
          borderRadius: 999,
          background: isFocused
            ? "linear-gradient(160deg, rgba(52,54,60,0.7) 0%, rgba(20,21,25,0.75) 100%)"
            : "linear-gradient(160deg, rgba(30,31,36,0.55) 0%, rgba(12,13,16,0.6) 100%)",
          backdropFilter: "blur(20px) saturate(120%)",
          WebkitBackdropFilter: "blur(20px) saturate(120%)",
          boxShadow: isFocused
            ? "inset 0 1px 0 rgba(255,255,255,0.4), 0 0 0 0.1875rem var(--accent), 0 0.75rem 1.75rem -0.625rem rgba(0,0,0,0.55)"
            : "inset 0 1px 0 rgba(255,255,255,0.08), 0 0.25rem 0.75rem -0.375rem rgba(0,0,0,0.4)",
          padding: "0.375rem 1.125rem 0.375rem 0.375rem",
          transform: isFocused ? "scale(1.08)" : "scale(1)",
          transition: "transform 180ms ease-out, box-shadow 180ms ease-out, border-color 180ms ease-out, background 180ms ease-out",
          cursor: "pointer",
        }}
      >
        <AvatarBadge avatarUrl={profile.avatarUrl} size="2.5rem" />
        <span style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--text)" }}>{profile.name}</span>
      </button>
    </div>
  );
}

function AvatarBadge({ avatarUrl, size }: { avatarUrl: string; size: string }): JSX.Element {
  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: "50%",
        overflow: "hidden",
        background: "linear-gradient(160deg, var(--surface-raised), var(--surface))",
        border: "1px solid var(--border)",
      }}
    >
      <img src={avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
    </div>
  );
}
