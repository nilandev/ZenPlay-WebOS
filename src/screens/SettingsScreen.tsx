import { useEffect } from "react";
import type { PlatformId, Profile } from "@core";
import { Focusable, MeshBackground, PillButton, useFocusStore, useRemoteInput, type FocusNode } from "@ui";
import { LogOut } from "lucide-react";

const SWITCH_PROFILE_ID = "settings-switch-profile";

function useIsFocused(id: string): boolean {
  return useFocusStore((state) => state.focusedId === id);
}

export interface SettingsScreenProps {
  platform: PlatformId;
  profile: Profile;
  onSwitchProfile: () => void;
  onBack: () => void;
}

/**
 * Profile settings — currently just Switch Profile, matching the visual
 * language of ProfilesScreen/ProfileForm (MeshBackground, avatar header,
 * glass-tile rows).
 */
export function SettingsScreen({ platform, profile, onSwitchProfile, onBack }: SettingsScreenProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focus = useFocusStore((state) => state.focus);

  useEffect(() => {
    const switchProfileNode: FocusNode = {
      id: SWITCH_PROFILE_ID,
      neighbors: {},
      onSelect: onSwitchProfile,
    };
    setGraph("settings", [switchProfileNode], SWITCH_PROFILE_ID);
    // setGraph only defaults focus to a scope's first node when the
    // currently focused id is no longer valid anywhere — TopNav's own
    // "chrome" scope still has a valid focused tab id at this point, so
    // focus must be forced into the content explicitly (same fix as
    // ProfileForm's confirm dialog — see conversation history).
    focus(SWITCH_PROFILE_ID);
    return () => clearGraph("settings");
  }, [setGraph, clearGraph, focus, onSwitchProfile]);

  useRemoteInput(platform, { onBack });

  return (
    <MeshBackground>
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", padding: "56px 48px", gap: 40 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: "50%",
              overflow: "hidden",
              border: "3px solid var(--accent)",
              boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
            }}
          >
            <img src={profile.avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--text)" }}>Settings — {profile.name}</h1>
        </div>

        <div style={{ width: "100%", maxWidth: 1100, display: "flex", flexDirection: "column", gap: 28 }}>
          <Focusable id={SWITCH_PROFILE_ID}>
            <SwitchProfileButton onClick={onSwitchProfile} />
          </Focusable>
        </div>
      </div>
    </MeshBackground>
  );
}

function SwitchProfileButton({ onClick }: { onClick: () => void }): JSX.Element {
  const isFocused = useIsFocused(SWITCH_PROFILE_ID);

  return (
    <div style={{ display: "flex", justifyContent: "flex-end" }}>
      <PillButton onClick={onClick} isFocused={isFocused}>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <LogOut size={17} strokeWidth={2} />
          Switch profile
        </span>
      </PillButton>
    </div>
  );
}
