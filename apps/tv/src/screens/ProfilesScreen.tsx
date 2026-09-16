import { useEffect, useState } from "react";
import type { Profile } from "@iptv/core";
import { Focusable, buildGridFocusGraph, useFocusStore, useRemoteInput } from "@iptv/ui";
import type { PlatformId } from "@iptv/core";

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
    setGraph("content", buildGridFocusGraph(ids, ids.length), ids[0]);
    return () => clearGraph("content");
    // ids is derived fresh each render from profiles; only re-run when the actual profile set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles.length, setGraph, clearGraph]);

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
      <div style={{ padding: 40, maxWidth: 480 }}>
        <h1>New profile</h1>
        <input
          placeholder="Name"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          style={{ display: "block", marginBottom: 12, width: "100%" }}
        />
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {AVATAR_CHOICES.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => setDraftAvatar(emoji)}
              style={{ fontSize: 24, border: draftAvatar === emoji ? "2px solid #6ee7ff" : "2px solid transparent" }}
            >
              {emoji}
            </button>
          ))}
        </div>
        <label style={{ display: "block", marginBottom: 16 }}>
          <input type="checkbox" checked={draftIsKids} onChange={(e) => setDraftIsKids(e.target.checked)} /> Kids profile
        </label>
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
        >
          Create
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh" }}>
      <h1 style={{ marginBottom: 40 }}>Who's watching?</h1>
      <div style={{ display: "flex", gap: 32 }}>
        {profiles.map((profile) => (
          <Focusable key={profile.id} id={profile.id}>
            <ProfileTile emoji={profile.avatarEmoji} label={profile.name} onClick={() => onSelectProfile(profile)} />
          </Focusable>
        ))}
        <Focusable id={CREATE_ID}>
          <ProfileTile emoji="+" label="Add Profile" onClick={() => setIsCreating(true)} />
        </Focusable>
      </div>
    </div>
  );
}

function ProfileTile({ emoji, label, onClick }: { emoji: string; label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, background: "transparent", border: "none" }}
    >
      <div
        style={{
          width: 120,
          height: 120,
          borderRadius: "50%",
          background: "#1c1c22",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 48,
        }}
      >
        {emoji}
      </div>
      <span style={{ fontSize: 16 }}>{label}</span>
    </button>
  );
}
