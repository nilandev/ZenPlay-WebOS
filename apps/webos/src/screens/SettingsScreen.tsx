import { useState } from "react";
import { hashPin, type Category, type Profile } from "@iptv/core";

export interface SettingsScreenProps {
  profile: Profile;
  categories: Category[];
  onUpdateProfile: (patch: Partial<Profile>) => void;
  onSwitchProfile: () => void;
}

/**
 * Parental-control + profile settings. PIN is set once per profile and
 * gates any category toggled into lockedCategoryIds — enforced by callers
 * (VodScreen/SeriesScreen/live channel list) filtering against it, since
 * this screen is only responsible for configuring the lock, not enforcing
 * it during browsing.
 */
export function SettingsScreen({ profile, categories, onUpdateProfile, onSwitchProfile }: SettingsScreenProps): JSX.Element {
  const [newPin, setNewPin] = useState("");

  async function handleSetPin(): Promise<void> {
    if (newPin.length < 4) return;
    onUpdateProfile({ pinHash: await hashPin(newPin) });
    setNewPin("");
  }

  function toggleLockedCategory(categoryId: string): void {
    const isLocked = profile.lockedCategoryIds.includes(categoryId);
    const updated = isLocked
      ? profile.lockedCategoryIds.filter((id) => id !== categoryId)
      : [...profile.lockedCategoryIds, categoryId];
    onUpdateProfile({ lockedCategoryIds: updated });
  }

  return (
    <div style={{ padding: "24px 40px", maxWidth: 560 }}>
      <h1>Settings — {profile.name}</h1>

      <section style={{ marginBottom: 32 }}>
        <h2>Parental controls</h2>
        <p>{profile.pinHash ? "A PIN is set for this profile." : "No PIN set — locked categories are not enforced."}</p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="password"
            inputMode="numeric"
            placeholder="New 4+ digit PIN"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
          />
          <button type="button" onClick={handleSetPin}>
            {profile.pinHash ? "Change PIN" : "Set PIN"}
          </button>
        </div>

        <h3 style={{ marginTop: 20 }}>Locked categories</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {categories.map((category) => (
            <label key={category.id}>
              <input
                type="checkbox"
                checked={profile.lockedCategoryIds.includes(category.id)}
                onChange={() => toggleLockedCategory(category.id)}
              />{" "}
              {category.name}
            </label>
          ))}
        </div>
      </section>

      <button type="button" onClick={onSwitchProfile}>
        Switch profile
      </button>
    </div>
  );
}
