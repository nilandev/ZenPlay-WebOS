import type { PlaylistSource } from "@core";

const STORAGE_KEY = "iptv.playlist-sources.v1";
const ACTIVE_SOURCE_KEY = "iptv.active-playlist-source-id.v1";

/**
 * Minimal localStorage-backed persistence for configured playlist sources.
 * Swappable for IndexedDB (via idb/Dexie) later without changing callers —
 * kept this simple for the first runnable build since source lists are small.
 */
export function loadPlaylistSources(): PlaylistSource[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PlaylistSource[]) : [];
  } catch {
    return [];
  }
}

export function savePlaylistSources(sources: PlaylistSource[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sources));
}

export function addPlaylistSource(source: PlaylistSource): PlaylistSource[] {
  const sources = [...loadPlaylistSources(), source];
  savePlaylistSources(sources);
  return sources;
}

export function removePlaylistSource(sourceId: string): PlaylistSource[] {
  const sources = loadPlaylistSources().filter((s) => s.id !== sourceId);
  savePlaylistSources(sources);
  forgetSourceForProfiles(sourceId);
  return sources;
}

export function getActivePlaylistSourceId(): string | null {
  return localStorage.getItem(ACTIVE_SOURCE_KEY);
}

export function setActivePlaylistSourceId(sourceId: string): void {
  localStorage.setItem(ACTIVE_SOURCE_KEY, sourceId);
}

export function clearActivePlaylistSourceId(): void {
  localStorage.removeItem(ACTIVE_SOURCE_KEY);
}

// --- Per-profile playlist -------------------------------------------------------
//
// Each profile remembers the playlist it last used, so a household where
// people use different providers gets theirs back when they pick their
// profile (My List and Recently Watched are stored per profile *and*
// playlist, so they follow along). The global active id above still
// decides what plays before any profile is chosen.

const PROFILE_SOURCES_KEY = "iptv.profile-playlist.v1";

function readProfileSources(): Record<string, string> {
  try {
    const raw = localStorage.getItem(PROFILE_SOURCES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeProfileSources(map: Record<string, string>): void {
  try {
    localStorage.setItem(PROFILE_SOURCES_KEY, JSON.stringify(map));
  } catch {
    // Storage full or unavailable — the profile just won't remember its playlist.
  }
}

/** Remembers `sourceId` as the playlist `profileId` last used. */
export function rememberProfileSource(profileId: string, sourceId: string): void {
  const map = readProfileSources();
  if (map[profileId] === sourceId) return;
  writeProfileSources({ ...map, [profileId]: sourceId });
}

/**
 * The playlist a profile should open on: the one it last used, if that
 * playlist still exists — otherwise null (keep whatever is active).
 */
export function playlistForProfile(profileId: string, sources: PlaylistSource[]): string | null {
  const remembered = readProfileSources()[profileId];
  return remembered && sources.some((s) => s.id === remembered) ? remembered : null;
}

/** Drops a deleted profile's memory. */
export function forgetProfileSource(profileId: string): void {
  const { [profileId]: _removed, ...rest } = readProfileSources();
  writeProfileSources(rest);
}

/** Drops a removed playlist from every profile's memory (they fall back to whatever is active). */
export function forgetSourceForProfiles(sourceId: string): void {
  const map = readProfileSources();
  writeProfileSources(Object.fromEntries(Object.entries(map).filter(([, id]) => id !== sourceId)));
}
