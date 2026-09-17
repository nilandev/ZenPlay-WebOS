import type { ContinueWatchingEntry, Profile } from "@core";

const PROFILES_KEY = "iptv.profiles.v1";
const ACTIVE_PROFILE_KEY = "iptv.active-profile-id.v1";
const CONTINUE_WATCHING_KEY = "iptv.continue-watching.v1";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function loadProfiles(): Profile[] {
  return readJson<Profile[]>(PROFILES_KEY, []);
}

export function saveProfiles(profiles: Profile[]): void {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

export function addProfile(profile: Profile): Profile[] {
  const profiles = [...loadProfiles(), profile];
  saveProfiles(profiles);
  return profiles;
}

export function updateProfile(profileId: string, patch: Partial<Profile>): Profile[] {
  const profiles = loadProfiles().map((p) => (p.id === profileId ? { ...p, ...patch } : p));
  saveProfiles(profiles);
  return profiles;
}

export function getActiveProfileId(): string | null {
  return localStorage.getItem(ACTIVE_PROFILE_KEY);
}

export function setActiveProfileId(profileId: string): void {
  localStorage.setItem(ACTIVE_PROFILE_KEY, profileId);
}

export function clearActiveProfile(): void {
  localStorage.removeItem(ACTIVE_PROFILE_KEY);
}

export function loadContinueWatching(profileId: string): ContinueWatchingEntry[] {
  return readJson<ContinueWatchingEntry[]>(CONTINUE_WATCHING_KEY, []).filter((e) => e.profileId === profileId);
}

export function upsertContinueWatching(entry: ContinueWatchingEntry): void {
  const all = readJson<ContinueWatchingEntry[]>(CONTINUE_WATCHING_KEY, []);
  const key = (e: ContinueWatchingEntry) => `${e.profileId}:${e.contentId}:${e.episodeId ?? ""}`;
  const filtered = all.filter((e) => key(e) !== key(entry));
  filtered.push(entry);
  localStorage.setItem(CONTINUE_WATCHING_KEY, JSON.stringify(filtered));
}
