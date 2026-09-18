import { useEffect, useState } from "react";
import type { PlatformId, Profile } from "@core";
import { buildGridFocusGraph, Focusable, MeshBackground, PillButton, useFocusStore, useRemoteInput, type FocusNode } from "@ui";
import { Pencil } from "lucide-react";
import { ProfileForm } from "./ProfileForm.js";

const BACK_ID = "manage-profiles-back";

function useIsFocused(id: string): boolean {
  return useFocusStore((state) => state.focusedId === id);
}

export interface ManageProfilesScreenProps {
  profiles: Profile[];
  platform: PlatformId;
  onBack: () => void;
  onUpdateProfile: (profileId: string, patch: Partial<Profile>) => void;
  onDeleteProfile: (profileId: string) => void;
}

/**
 * Profile edit/delete screen, reached from "Who's watching?" → Manage
 * Profiles. Delegates entirely to either the grid view or ProfileForm —
 * deliberately holds no useRemoteInput/focus-graph hooks of its own, since
 * a parent and child screen both calling useRemoteInput simultaneously
 * causes every D-pad "select" to fire the focused node's onSelect twice
 * (harmless for idempotent actions like moving focus, but silently
 * cancels out non-idempotent ones like toggling a switch — see
 * conversation history for the full trace of that bug). Splitting the
 * grid view into its own component below is what makes it safe for that
 * component to own input while ProfileForm is inactive, and vice versa.
 */
export function ManageProfilesScreen({ profiles, platform, onBack, onUpdateProfile, onDeleteProfile }: ManageProfilesScreenProps): JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingProfile = profiles.find((p) => p.id === editingId) ?? null;

  if (editingProfile) {
    return (
      <ProfileForm
        platform={platform}
        profile={editingProfile}
        title="Edit profile"
        saveLabel="Save"
        canDelete={profiles.length > 1}
        onSave={(fields) => {
          onUpdateProfile(editingProfile.id, fields);
          setEditingId(null);
        }}
        onDelete={() => {
          onDeleteProfile(editingProfile.id);
          setEditingId(null);
        }}
        onCancel={() => setEditingId(null)}
      />
    );
  }

  return <ManageProfilesGrid profiles={profiles} platform={platform} onBack={onBack} onSelectProfile={(id) => setEditingId(id)} />;
}

function ManageProfilesGrid({
  profiles,
  platform,
  onBack,
  onSelectProfile,
}: {
  profiles: Profile[];
  platform: PlatformId;
  onBack: () => void;
  onSelectProfile: (profileId: string) => void;
}): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);

  const tileIds = profiles.map((p) => p.id);

  useEffect(() => {
    const tileNodes: FocusNode[] = buildGridFocusGraph(tileIds, tileIds.length).map((node) => ({
      ...node,
      neighbors: { ...node.neighbors, down: BACK_ID },
      onSelect: () => onSelectProfile(node.id),
    }));
    const backNode: FocusNode = { id: BACK_ID, neighbors: { up: tileIds[0] }, onSelect: onBack };
    setGraph("manage-grid", [...tileNodes, backNode], tileIds[0] ?? BACK_ID);
    return () => clearGraph("manage-grid");
    // tileIds is derived fresh each render from profiles; only re-run when the actual profile set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles.length, setGraph, clearGraph, onBack, onSelectProfile]);

  useRemoteInput(platform, { onBack });

  return (
    <MeshBackground>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", gap: 4 }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 4, color: "var(--text)" }}>Manage Profiles</h1>
        <p style={{ marginBottom: 44, color: "var(--text-dim)" }}>Select a profile to edit or delete.</p>

        <div style={{ display: "flex", gap: 40, marginBottom: 40 }}>
          {profiles.map((profile) => (
            <Focusable key={profile.id} id={profile.id}>
              <EditableProfileTile id={profile.id} avatarUrl={profile.avatarUrl} label={profile.name} onClick={() => onSelectProfile(profile.id)} />
            </Focusable>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "center" }}>
          <Focusable id={BACK_ID}>
            <BackButton onClick={onBack} />
          </Focusable>
        </div>
      </div>
    </MeshBackground>
  );
}

function EditableProfileTile({ id, avatarUrl, label, onClick }: { id: string; avatarUrl: string; label: string; onClick: () => void }): JSX.Element {
  const isFocused = useIsFocused(id);

  return (
    <button
      type="button"
      onClick={onClick}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, background: "transparent", border: "none", outline: "none" }}
    >
      <div style={{ position: "relative" }}>
        <div
          style={{
            width: 128,
            height: 128,
            borderRadius: "50%",
            overflow: "hidden",
            background: "linear-gradient(160deg, var(--surface-raised), var(--surface))",
            border: "1px solid var(--border)",
            transform: isFocused ? "scale(1.1)" : "scale(1)",
            boxShadow: isFocused ? "0 0 0 4px var(--accent), 0 12px 28px rgba(0,0,0,0.5)" : "none",
            transition: "transform 160ms ease-out, box-shadow 160ms ease-out",
          }}
        >
          <img src={avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
        <div
          style={{
            position: "absolute",
            bottom: 4,
            right: 4,
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "var(--surface-raised)",
            border: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Pencil size={15} strokeWidth={2} color="var(--text)" />
        </div>
      </div>
      <span style={{ fontSize: 16, fontWeight: isFocused ? 700 : 500, color: isFocused ? "var(--text)" : "var(--text-dim)" }}>{label}</span>
    </button>
  );
}

function BackButton({ onClick }: { onClick: () => void }): JSX.Element {
  const isFocused = useIsFocused(BACK_ID);
  return (
    <PillButton onClick={onClick} isFocused={isFocused}>
      Back
    </PillButton>
  );
}
