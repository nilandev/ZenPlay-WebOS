import { useEffect, useState } from "react";
import type { PlatformId, Profile } from "@core";
import { Focusable, buildGridFocusGraph, useFocusStore, useRemoteInput } from "@ui";

function useIsFocused(id: string): boolean {
  return useFocusStore((state) => state.focusedId === id);
}

const AVATAR_CHOICES = ["🙂", "🐱", "🐶", "🚀", "🎬", "⭐", "🎮", "🦖"];

export interface ProfilesScreenProps {
  profiles: Profile[];
  platform: PlatformId;
  onSelectProfile: (profile: Profile) => void;
  onCreateProfile: (profile: Profile) => void;
}

const CREATE_ID = "create-profile";

/**
 * Profile picker shown on launch, styled after Apple TV/Netflix profile
 * grids: large circular avatars, name below, focus scales the tile up.
 */
export function ProfilesScreen({ profiles, platform, onSelectProfile, onCreateProfile }: ProfilesScreenProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const [isCreating, setIsCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftAvatar, setDraftAvatar] = useState(AVATAR_CHOICES[0]);
  const [draftIsKids, setDraftIsKids] = useState(false);

  const ids = [...profiles.map((p) => p.id), CREATE_ID];

  useEffect(() => {
    if (isCreating) return;
    setGraph("content", buildGridFocusGraph(ids, ids.length), ids[0]);
    return () => clearGraph("content");
    // ids is derived fresh each render from profiles; only re-run when the actual profile set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles.length, isCreating, setGraph, clearGraph]);

  useRemoteInput(platform, {
    onSelect: (focusedId) => {
      if (!focusedId) return;
      if (focusedId === CREATE_ID) {
        setIsCreating(true);
        return;
      }
      const profile = profiles.find((p) => p.id === focusedId);
      if (profile) onSelectProfile(profile);
    },
  });

  if (isCreating) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            width: 440,
            maxWidth: "92vw",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 16,
            padding: 36,
            boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
          }}
        >
          <h1 style={{ fontSize: 22, marginBottom: 20 }}>New profile</h1>

          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "var(--text-dim)", marginBottom: 16 }}>
            Name
            <input value={draftName} onChange={(e) => setDraftName(e.target.value)} autoFocus style={{ width: "100%" }} />
          </label>

          <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 8 }}>Avatar</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
            {AVATAR_CHOICES.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => setDraftAvatar(emoji)}
                style={{
                  width: 48,
                  height: 48,
                  fontSize: 22,
                  borderRadius: "50%",
                  border: "2px solid transparent",
                  background: "var(--surface-raised)",
                  boxShadow: draftAvatar === emoji ? "0 0 0 3px var(--accent)" : "none",
                }}
              >
                {emoji}
              </button>
            ))}
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24, fontSize: 14 }}>
            <input type="checkbox" checked={draftIsKids} onChange={(e) => setDraftIsKids(e.target.checked)} />
            Kids profile
          </label>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              style={{
                flex: 1,
                padding: "12px 0",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text)",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onCreateProfile({
                  id: crypto.randomUUID(),
                  name: draftName || "New Profile",
                  avatarEmoji: draftAvatar,
                  isKidsProfile: draftIsKids,
                  lockedCategoryIds: [],
                  favoriteChannelIds: [],
                });
                setIsCreating(false);
                setDraftName("");
              }}
              style={{
                flex: 1,
                padding: "12px 0",
                borderRadius: 10,
                border: "none",
                background: "var(--accent)",
                color: "#062028",
                fontWeight: 700,
              }}
            >
              Create
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: 4 }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 4 }}>Who's watching?</h1>
      <p style={{ marginBottom: 44 }}>Select a profile or add a new one.</p>
      <div style={{ display: "flex", gap: 40 }}>
        {profiles.map((profile) => (
          <Focusable key={profile.id} id={profile.id}>
            <ProfileTile id={profile.id} emoji={profile.avatarEmoji} label={profile.name} onClick={() => onSelectProfile(profile)} />
          </Focusable>
        ))}
        <Focusable id={CREATE_ID}>
          <ProfileTile id={CREATE_ID} emoji="+" label="Add Profile" onClick={() => setIsCreating(true)} isAdd />
        </Focusable>
      </div>
    </div>
  );
}

function ProfileTile({
  id,
  emoji,
  label,
  onClick,
  isAdd,
}: {
  id: string;
  emoji: string;
  label: string;
  onClick: () => void;
  isAdd?: boolean;
}): JSX.Element {
  const isFocused = useIsFocused(id);

  return (
    <button
      type="button"
      onClick={onClick}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, background: "transparent", border: "none" }}
    >
      <div
        style={{
          width: 128,
          height: 128,
          borderRadius: "50%",
          background: isAdd ? "transparent" : "linear-gradient(160deg, var(--surface-raised), var(--surface))",
          border: isAdd ? "2px dashed var(--border)" : "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 52,
          transform: isFocused ? "scale(1.1)" : "scale(1)",
          boxShadow: isFocused ? "0 0 0 4px var(--accent), 0 12px 28px rgba(0,0,0,0.5)" : "none",
          transition: "transform 160ms ease-out, box-shadow 160ms ease-out",
        }}
      >
        {emoji}
      </div>
      <span style={{ fontSize: 16, fontWeight: isFocused ? 700 : 500, color: isFocused ? "var(--text)" : "var(--text-dim)" }}>
        {label}
      </span>
    </button>
  );
}
