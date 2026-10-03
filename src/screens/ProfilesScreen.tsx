import { useEffect, useRef, useState } from "react";
import { isKidsProfile, type PlatformId, type Profile } from "@core";
import { MeshBackground, ProfileAvatarTile, TvButton, useFocusStore, useRemoteInput } from "@ui";
import { Pencil } from "lucide-react";
import { getDisclaimerAcknowledgedAt, requiresPin } from "../parental-store.js";
import { FirstKidsProfileSetup, PinGate } from "./ParentalFlows.js";
import { ProfileForm } from "./ProfileForm.js";
import { buildProfileGridGraph, ProfileGridLayout } from "./ProfileGridLayout.js";

export interface ProfilesScreenProps {
  profiles: Profile[];
  platform: PlatformId;
  onSelectProfile: (profile: Profile) => void;
  onCreateProfile: (profile: Profile) => void;
  onManageProfiles: () => void;
  /** The picker was opened from a Kids profile — choosing a standard profile asks for the parent PIN (locked mode). */
  isLeavingKids?: boolean;
}

interface PendingGate {
  title: string;
  subtitle?: string;
  action: () => void;
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
export function ProfilesScreen({ profiles, platform, onSelectProfile, onCreateProfile, onManageProfiles, isLeavingKids = false }: ProfilesScreenProps): JSX.Element {
  const [isCreating, setIsCreating] = useState(false);
  // A PIN-guarded action waiting for the parent PIN (docs/kids-profile.md §2.3).
  const [gate, setGate] = useState<PendingGate | null>(null);
  // A just-created first Kids profile, held back until the disclaimer/PIN step is answered.
  const [pendingKidsProfile, setPendingKidsProfile] = useState<Profile | null>(null);

  const hasKidsProfile = profiles.some(isKidsProfile);
  /** Runs `action` straight away in trust mode; in locked mode only after the PIN. */
  const guard = (needed: boolean, next: PendingGate) => {
    if (needed && requiresPin()) setGate(next);
    else next.action();
  };

  if (gate) {
    return (
      <PinGate
        platform={platform}
        title={gate.title}
        subtitle={gate.subtitle}
        onUnlock={() => {
          setGate(null);
          gate.action();
        }}
        onCancel={() => setGate(null)}
      />
    );
  }

  if (pendingKidsProfile) {
    return (
      <FirstKidsProfileSetup
        platform={platform}
        onFinished={() => {
          const profile = pendingKidsProfile;
          setPendingKidsProfile(null);
          onCreateProfile(profile);
        }}
      />
    );
  }

  if (isCreating) {
    return (
      <ProfileForm
        platform={platform}
        title="Add Profile"
        saveLabel="Create"
        defaultName={nextProfileName(profiles)}
        // The first profile must be a parent (standard) profile.
        canBeKids={profiles.some((p) => !isKidsProfile(p))}
        onCancel={() => setIsCreating(false)}
        onSave={(fields) => {
          const profile: Profile = {
            id: crypto.randomUUID(),
            name: fields.name,
            avatarUrl: fields.avatarUrl,
            ...(fields.kind === "kids" ? { kind: "kids" as const } : {}),
          };
          setIsCreating(false);
          if (fields.kind === "kids" && !getDisclaimerAcknowledgedAt()) setPendingKidsProfile(profile);
          else onCreateProfile(profile);
        }}
      />
    );
  }

  return (
    <ProfilePickerGrid
      profiles={profiles}
      platform={platform}
      onSelectProfile={(profile) =>
        guard(isLeavingKids && !isKidsProfile(profile), {
          title: `Switch to ${profile.name}`,
          subtitle: "Enter the parent PIN to leave the Kids profile",
          action: () => onSelectProfile(profile),
        })
      }
      onManageProfiles={() => guard(hasKidsProfile, { title: "Manage Profiles", action: onManageProfiles })}
      onStartCreate={() => guard(hasKidsProfile, { title: "Add Profile", action: () => setIsCreating(true) })}
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

  // The graph's callbacks read the latest props through a ref, so it's only
  // rebuilt when the set of profiles changes (in place — clearing on each
  // rebuild would drop focus).
  const latestRef = useRef({ profiles, onSelectProfile, onStartCreate, onManageProfiles });
  latestRef.current = { profiles, onSelectProfile, onStartCreate, onManageProfiles };
  const profileIdsKey = profiles.map((p) => p.id).join("|");

  useEffect(() => {
    const tileIds = [...latestRef.current.profiles.map((p) => p.id), CREATE_ID];
    const nodes = buildProfileGridGraph(
      tileIds,
      (id) => {
        const { profiles: current, onSelectProfile: select, onStartCreate: create } = latestRef.current;
        if (id === CREATE_ID) create();
        else {
          const profile = current.find((p) => p.id === id);
          if (profile) select(profile);
        }
      },
      { id: MANAGE_ID, onSelect: () => latestRef.current.onManageProfiles() },
    );
    setGraph("content", nodes, tileIds[0]);
  }, [profileIdsKey, setGraph]);

  useEffect(() => () => clearGraph("content"), [clearGraph]);

  useRemoteInput(platform, {});

  return (
    <MeshBackground>
      <ProfileGridLayout
        title="Who's watching?"
        subtitle="Choose your profile"
        tileCount={profiles.length + 1}
        action={<TvButton id={MANAGE_ID} label="Manage Profiles" icon={Pencil} onSelect={onManageProfiles} />}
      >
        {profiles.map((profile) => (
          <ProfileAvatarTile
            key={profile.id}
            id={profile.id}
            label={profile.name}
            avatarUrl={profile.avatarUrl}
            isKids={isKidsProfile(profile)}
            onSelect={() => onSelectProfile(profile)}
          />
        ))}
        <ProfileAvatarTile id={CREATE_ID} label="Add Profile" variant="add" onSelect={onStartCreate} />
      </ProfileGridLayout>
    </MeshBackground>
  );
}

/** "Profile 2", "Profile 3"… — the first number no existing profile already uses. */
function nextProfileName(profiles: Profile[]): string {
  const taken = new Set(profiles.map((p) => p.name.trim().toLowerCase()));
  let n = profiles.length + 1;
  while (taken.has(`profile ${n}`)) n += 1;
  return `Profile ${n}`;
}
