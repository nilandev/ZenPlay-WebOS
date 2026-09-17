import type { PlaylistSource } from "@core";

const STORAGE_KEY = "iptv.playlist-sources.v1";

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
