import { useEffect, useState } from "react";
import type { PlatformId, Profile } from "@core";
import { buildGridFocusGraph, Focusable, MeshBackground, PillButton, useFocusStore, useRemoteInput, type FocusNode, useIsFocused } from "@ui";
import { ProfileForm } from "./ProfileForm.js";

export interface ProfilesScreenProps {
  profiles: Profile[];
  platform: PlatformId;
  onSelectProfile: (profile: Profile) => void;
  onCreateProfile: (profile: Profile) => void;
  onManageProfiles: () => void;
}

const CREATE_ID = "create-profile";
const MANAGE_ID = "manage-profiles";

/**
 * Profile picker shown on launch, styled after Apple TV/Netflix profile
 * grids: large circular avatars, name below, focus scales the tile up.
 * "Manage Profiles" lives here (not as a corner dropdown on Home) since
 * this is the natural place to switch, create, or edit/delete profiles —
 * see conversation history for why the earlier Home dropdown was removed.
 *
 * Delegates entirely to either the picker grid or ProfileForm, holding no
 * useRemoteInput/focus-graph hooks of its own — a parent and child screen
 * both calling useRemoteInput simultaneously causes every D-pad "select" to
 * fire the focused node's onSelect twice (harmless for idempotent actions
 * like moving focus, but silently cancels out non-idempotent ones like
 * toggling a switch — see conversation history for the full trace).
 */
export function ProfilesScreen({ profiles, platform, onSelectProfile, onCreateProfile, onManageProfiles }: ProfilesScreenProps): JSX.Element {
  const [isCreating, setIsCreating] = useState(false);

  if (isCreating) {
    return (
      <ProfileForm
        platform={platform}
        title="New profile"
        saveLabel="Create"
        onCancel={() => setIsCreating(false)}
        onSave={(fields) => {
          onCreateProfile({
            id: crypto.randomUUID(),
            name: fields.name,
            avatarUrl: fields.avatarUrl,
          });
          setIsCreating(false);
        }}
      />
    );
  }

  return (
    <ProfilePickerGrid
      profiles={profiles}
      platform={platform}
      onSelectProfile={onSelectProfile}
      onManageProfiles={onManageProfiles}
      onStartCreate={() => setIsCreating(true)}
    />
  );
}

function ProfilePickerGrid({
  profiles,
  platform,
  onSelectProfile,
  onManageProfiles,
  onStartCreate,
}: {
  profiles: Profile[];
  platform: PlatformId;
  onSelectProfile: (profile: Profile) => void;
  onManageProfiles: () => void;
  onStartCreate: () => void;
}): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);

  const tileIds = [...profiles.map((p) => p.id), CREATE_ID];

  useEffect(() => {
    // Two rows: the profile/add-profile tiles, then Manage Profiles below —
    // buildGridFocusGraph alone can't express a second row with a different
    // item count, so the row's neighbors are built manually here (same
    // pattern as HomeScreen's buildHomeFocusGraph for its uneven rows).
    const tileNodes: FocusNode[] = buildGridFocusGraph(tileIds, tileIds.length).map((node) => ({
      ...node,
      neighbors: { ...node.neighbors, down: MANAGE_ID },
      onSelect: () => {
        if (node.id === CREATE_ID) onStartCreate();
        else {
          const profile = profiles.find((p) => p.id === node.id);
          if (profile) onSelectProfile(profile);
        }
      },
    }));
    const manageNode: FocusNode = { id: MANAGE_ID, neighbors: { up: tileIds[0] }, onSelect: onManageProfiles };
    setGraph("content", [...tileNodes, manageNode], tileIds[0]);
    return () => clearGraph("content");
    // tileIds is derived fresh each render from profiles; only re-run when the actual profile set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles.length, setGraph, clearGraph, onSelectProfile, onManageProfiles, onStartCreate]);

  useRemoteInput(platform, {});

  return (
    <MeshBackground>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", gap: 4 }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 4, color: "var(--text)" }}>Who's watching?</h1>
        <p style={{ marginBottom: 44, color: "var(--text-dim)" }}>Select a profile or add a new one.</p>
        <div style={{ display: "flex", gap: 40, marginBottom: 40 }}>
          {profiles.map((profile) => (
            <Focusable key={profile.id} id={profile.id}>
              <ProfileTile id={profile.id} avatarUrl={profile.avatarUrl} label={profile.name} onClick={() => onSelectProfile(profile)} />
            </Focusable>
          ))}
          <Focusable id={CREATE_ID}>
            <ProfileTile id={CREATE_ID} label="Add Profile" onClick={onStartCreate} isAdd />
          </Focusable>
        </div>

        <div style={{ display: "flex", justifyContent: "center" }}>
          <Focusable id={MANAGE_ID}>
            <ManageProfilesButton onClick={onManageProfiles} />
          </Focusable>
        </div>
      </div>
    </MeshBackground>
  );
}

function ManageProfilesButton({ onClick }: { onClick: () => void }): JSX.Element {
  const isFocused = useIsFocused(MANAGE_ID);
  return (
    <PillButton onClick={onClick} isFocused={isFocused}>
      Manage Profiles
    </PillButton>
  );
}

function ProfileTile({
  id,
  avatarUrl,
  label,
  onClick,
  isAdd,
}: {
  id: string;
  avatarUrl?: string;
  label: string;
  onClick: () => void;
  isAdd?: boolean;
}): JSX.Element {
  const isFocused = useIsFocused(id);

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        background: "transparent",
        border: "none",
        outline: "none",
      }}
    >
      <div
        style={{
          width: 128,
          height: 128,
          borderRadius: "50%",
          overflow: "hidden",
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
        {isAdd ? "+" : <img src={avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
      </div>
      <span style={{ fontSize: 16, fontWeight: isFocused ? 700 : 500, color: isFocused ? "var(--text)" : "var(--text-dim)" }}>
        {label}
      </span>
    </button>
  );
}
