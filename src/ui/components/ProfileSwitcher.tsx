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

  // Same Apple TV-style focus language as Home's menu tiles (see
  // HomeScreen's tileFaceStyle / LiftSurface): unfocused it's faint glass;
  // focused it becomes brighter glass with white text and lifts with a soft
  // shadow. No glow halo or accent ring, and only transform animates, so
  // the change runs on the compositor.
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: "0.875rem",
        border: "none",
        borderRadius: 999,
        background: isFocused
          ? "linear-gradient(160deg, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0.17) 100%)"
          : "linear-gradient(160deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.035) 100%)",
        boxShadow: isFocused
          ? "inset 0 1px 0 rgba(255,255,255,0.35), inset 0 0 0 1px rgba(255,255,255,0.14), 0 1rem 2rem -0.5rem rgba(0,0,0,0.6)"
          : "inset 0 1px 0 rgba(255,255,255,0.12), inset 0 0 0 1px rgba(255,255,255,0.06)",
        color: isFocused ? "#ffffff" : "rgba(235,236,242,0.85)",
        padding: "0.5rem 1.5rem 0.5rem 0.5rem",
        transform: isFocused ? "scale(1.08)" : "scale(1)",
        transition: "transform 300ms cubic-bezier(0.2, 0.9, 0.3, 1)",
        cursor: "pointer",
      }}
    >
      <AvatarBadge avatarUrl={profile.avatarUrl} size="3.75rem" />
      <span style={{ fontSize: "1.375rem", fontWeight: 600 }}>{profile.name}</span>
    </button>
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
