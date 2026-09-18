import { useEffect, useRef, useState } from "react";
import type { Profile } from "@core";

export interface ProfileSwitcherProps {
  profile: Profile;
  profiles: Profile[];
  onSelectProfile: (profile: Profile) => void;
  onManageProfiles: () => void;
}

/**
 * Top-left profile control, styled after Netflix's "who's watching" account
 * menu: current avatar + name with a caret, opening a dropdown of the other
 * profiles plus a "Manage profiles" escape hatch. Opens/closes on click
 * rather than hover since hover has no equivalent on a remote.
 */
export function ProfileSwitcher({ profile, profiles, onSelectProfile, onManageProfiles }: ProfileSwitcherProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function onPointerDown(event: PointerEvent): void {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [isOpen]);

  const otherProfiles = profiles.filter((p) => p.id !== profile.id);

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "transparent",
          border: "none",
          padding: "6px 10px 6px 6px",
          borderRadius: 10,
          cursor: "pointer",
        }}
      >
        <AvatarBadge emoji={profile.avatarEmoji} size={40} />
        <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>{profile.name}</span>
        <Caret direction={isOpen ? "up" : "down"} />
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            minWidth: 220,
            background: "rgba(26,26,32,0.85)",
            backdropFilter: "blur(24px) saturate(160%)",
            WebkitBackdropFilter: "blur(24px) saturate(160%)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 14,
            padding: 8,
            boxShadow: "0 20px 48px rgba(0,0,0,0.5)",
            zIndex: 20,
          }}
        >
          {otherProfiles.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onSelectProfile(p);
                setIsOpen(false);
              }}
              style={dropdownItemStyle}
            >
              <AvatarBadge emoji={p.avatarEmoji} size={30} />
              <span>{p.name}</span>
            </button>
          ))}

          {otherProfiles.length > 0 && <div style={{ height: 1, background: "rgba(255,255,255,0.1)", margin: "6px 4px" }} />}

          <button
            type="button"
            onClick={() => {
              onManageProfiles();
              setIsOpen(false);
            }}
            style={dropdownItemStyle}
          >
            <span style={{ width: 30, textAlign: "center", fontSize: 16, color: "var(--text-dim)" }}>⚙</span>
            <span>Manage profiles</span>
          </button>
        </div>
      )}
    </div>
  );
}

const dropdownItemStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "8px 8px",
  background: "transparent",
  border: "none",
  borderRadius: 8,
  color: "var(--text)",
  fontSize: 14,
  cursor: "pointer",
  textAlign: "left" as const,
};

function AvatarBadge({ emoji, size }: { emoji: string; size: number }): JSX.Element {
  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: "50%",
        background: "linear-gradient(160deg, var(--surface-raised), var(--surface))",
        border: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.5,
      }}
    >
      {emoji}
    </div>
  );
}

function Caret({ direction }: { direction: "up" | "down" }): JSX.Element {
  return (
    <svg
      width="10"
      height="6"
      viewBox="0 0 10 6"
      style={{ transform: direction === "up" ? "rotate(180deg)" : "none", transition: "transform 140ms ease-out" }}
    >
      <path d="M1 1L5 5L9 1" stroke="var(--text-dim)" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
