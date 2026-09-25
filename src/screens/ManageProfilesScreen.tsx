import { useEffect, useRef, useState } from "react";
import { isKidsProfile, type PlatformId, type Profile } from "@core";
import { MeshBackground, ProfileAvatarTile, TvButton, useFocusStore, useRemoteInput } from "@ui";
import { Check } from "lucide-react";
import { getDisclaimerAcknowledgedAt } from "../parental-store.js";
import { FirstKidsProfileSetup } from "./ParentalFlows.js";
import { ProfileForm } from "./ProfileForm.js";
import { buildProfileGridGraph, ProfileGridLayout } from "./ProfileGridLayout.js";

const DONE_ID = "manage-profiles-done";

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
  const [isConfirmingKids, setIsConfirmingKids] = useState(false);
  const editingProfile = profiles.find((p) => p.id === editingId) ?? null;

  if (isConfirmingKids) {
    return <FirstKidsProfileSetup platform={platform} onFinished={() => setIsConfirmingKids(false)} />;
  }

  if (editingProfile) {
    // At least one standard profile must remain, so a parent can always get back in (docs/kids-profile.md §2.1).
    const hasOtherStandard = profiles.some((p) => p.id !== editingProfile.id && !isKidsProfile(p));
    return (
      <ProfileForm
        platform={platform}
        profile={editingProfile}
        title="Edit Profile"
        saveLabel="Save"
        canDelete={profiles.length > 1 && (isKidsProfile(editingProfile) || hasOtherStandard)}
        canBeKids={hasOtherStandard}
        onSave={(fields) => {
          onUpdateProfile(editingProfile.id, fields);
          setEditingId(null);
          if (fields.kind === "kids" && !getDisclaimerAcknowledgedAt()) setIsConfirmingKids(true);
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

  // Callbacks via a ref so the graph is only rebuilt (in place) when the set of profiles changes.
  const latestRef = useRef({ onBack, onSelectProfile });
  latestRef.current = { onBack, onSelectProfile };
  const tileIds = profiles.map((p) => p.id);
  const profileIdsKey = tileIds.join("|");

  useEffect(() => {
    const nodes = buildProfileGridGraph(tileIds, (id) => latestRef.current.onSelectProfile(id), {
      id: DONE_ID,
      onSelect: () => latestRef.current.onBack(),
    });
    setGraph("manage-grid", nodes, tileIds[0] ?? DONE_ID);
    // tileIds is fresh each render; profileIdsKey tracks its contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileIdsKey, setGraph]);

  useEffect(() => () => clearGraph("manage-grid"), [clearGraph]);

  useRemoteInput(platform, { onBack });

  return (
    <MeshBackground>
      <ProfileGridLayout
        title="Manage Profiles"
        subtitle="Choose a profile to edit or delete"
        tileCount={profiles.length}
        action={<TvButton id={DONE_ID} label="Done" icon={Check} onSelect={onBack} />}
      >
        {profiles.map((profile) => (
          <ProfileAvatarTile
            key={profile.id}
            id={profile.id}
            label={profile.name}
            avatarUrl={profile.avatarUrl}
            isKids={isKidsProfile(profile)}
            variant="edit"
            onSelect={() => onSelectProfile(profile.id)}
          />
        ))}
      </ProfileGridLayout>
    </MeshBackground>
  );
}
