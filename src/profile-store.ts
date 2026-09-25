import { migrateAvatarUrl, type ContinueWatchingEntry, type FavoriteEntry, type FavoriteKind, type Profile, type WatchHistoryEntry } from "@core";
import { removeKidsProfileRules } from "./parental-store.js";

const PROFILES_KEY = "iptv.profiles.v1";
const ACTIVE_PROFILE_KEY = "iptv.active-profile-id.v1";
const CONTINUE_WATCHING_KEY = "iptv.continue-watching.v1";
const FAVORITES_KEY = "iptv.favorites.v1";
const WATCH_HISTORY_KEY = "iptv.watch-history.v1";

/** Recently Watched keeps this many titles per profile and playlist; older ones drop off. */
export const WATCH_HISTORY_LIMIT = 50;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function loadProfiles(): Profile[] {
  const stored = readJson<Profile[]>(PROFILES_KEY, []);
  // Old static avatars move to their animated counterparts, saved once so this only ever runs one time.
  const profiles = stored.map((p) => ({ ...p, avatarUrl: migrateAvatarUrl(p.avatarUrl) }));
  if (profiles.some((p, i) => p.avatarUrl !== stored[i].avatarUrl)) {
    try {
      saveProfiles(profiles);
    } catch {
      // Storage unavailable — the mapping still applies on every read.
    }
  }
  return profiles;
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

export function deleteProfile(profileId: string): Profile[] {
  const profiles = loadProfiles().filter((p) => p.id !== profileId);
  saveProfiles(profiles);
  writeWatchHistory(readWatchHistory().filter((e) => e.profileId !== profileId));
  removeKidsProfileRules(profileId);
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

/** Positions this close to the start aren't worth offering to resume. */
const RESUME_MIN_SECONDS = 30;
/** Positions this close to the end count as finished (credits) — play from the start instead. */
const RESUME_END_MARGIN_SECONDS = 90;

export interface ResumePoint {
  positionSeconds: number;
  durationSeconds: number;
}

/** Where to offer resuming a film or episode, or null to just start from the beginning. */
export function getResumePoint(profileId: string, contentId: string, episodeId?: string): ResumePoint | null {
  const entry = loadContinueWatching(profileId).find((e) => e.contentId === contentId && (e.episodeId ?? undefined) === episodeId);
  if (!entry || !Number.isFinite(entry.durationSeconds) || entry.durationSeconds <= 0) return null;
  const { positionSeconds, durationSeconds } = entry;
  if (positionSeconds < RESUME_MIN_SECONDS || positionSeconds > durationSeconds - RESUME_END_MARGIN_SECONDS) return null;
  return { positionSeconds, durationSeconds };
}

function favoriteKey(e: Pick<FavoriteEntry, "profileId" | "sourceId" | "contentKind" | "contentId">): string {
  return `${e.profileId}:${e.sourceId}:${e.contentKind}:${e.contentId}`;
}

export function loadFavorites(profileId: string): FavoriteEntry[] {
  return readJson<FavoriteEntry[]>(FAVORITES_KEY, []).filter((f) => f.profileId === profileId);
}

export function isFavorite(profileId: string, sourceId: string, contentKind: FavoriteKind, contentId: string): boolean {
  const target = favoriteKey({ profileId, sourceId, contentKind, contentId });
  return readJson<FavoriteEntry[]>(FAVORITES_KEY, []).some((f) => favoriteKey(f) === target);
}

/** Adds the entry if not already favourited, removes it if it is. Returns the new favourited state. */
export function toggleFavorite(profileId: string, sourceId: string, contentKind: FavoriteKind, contentId: string): boolean {
  const all = readJson<FavoriteEntry[]>(FAVORITES_KEY, []);
  const target = favoriteKey({ profileId, sourceId, contentKind, contentId });
  const exists = all.some((f) => favoriteKey(f) === target);

  const next = exists
    ? all.filter((f) => favoriteKey(f) !== target)
    : [...all, { profileId, sourceId, contentKind, contentId, addedAt: new Date().toISOString() }];

  localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
  favoritesRevision += 1;
  for (const listener of favoriteListeners) listener();
  return !exists;
}

// Change notification for My List, so every screen that shows it (the
// browse screens under the player, My List itself) re-reads after a change
// made anywhere — e.g. the player's "My List" button.
let favoritesRevision = 0;
const favoriteListeners = new Set<() => void>();

export function subscribeFavorites(listener: () => void): () => void {
  favoriteListeners.add(listener);
  return () => favoriteListeners.delete(listener);
}

/** Increments on every My List change — use as a memo dependency (see useFavoritesRevision). */
export function getFavoritesRevision(): number {
  return favoritesRevision;
}

function readWatchHistory(): WatchHistoryEntry[] {
  return readJson<WatchHistoryEntry[]>(WATCH_HISTORY_KEY, []);
}

function writeWatchHistory(entries: WatchHistoryEntry[]): void {
  try {
    localStorage.setItem(WATCH_HISTORY_KEY, JSON.stringify(entries));
  } catch {
    // Storage full or unavailable — history is a convenience, never worth failing playback over.
  }
}

const historyKey = (e: Pick<WatchHistoryEntry, "profileId" | "sourceId" | "kind" | "contentId">) => `${e.profileId}:${e.sourceId}:${e.kind}:${e.contentId}`;

/**
 * A profile's Recently Watched for one playlist, newest first. The stored
 * list is kept in write order (recording moves a title to the end), which
 * is the recency order — no reliance on timestamps, which can tie.
 */
export function loadWatchHistory(profileId: string, sourceId: string): WatchHistoryEntry[] {
  return readWatchHistory()
    .filter((e) => e.profileId === profileId && e.sourceId === sourceId)
    .reverse();
}

/** Adds or refreshes a title (moving it to the front) and trims the oldest beyond WATCH_HISTORY_LIMIT for that profile and playlist. */
export function recordWatchHistory(entry: Omit<WatchHistoryEntry, "updatedAt">): void {
  const key = historyKey(entry);
  const next: WatchHistoryEntry = { ...entry, updatedAt: new Date().toISOString() };
  const others = readWatchHistory().filter((e) => historyKey(e) !== key);
  const sameList = others.filter((e) => e.profileId === entry.profileId && e.sourceId === entry.sourceId).reverse(); // newest first
  const dropped = new Set(sameList.slice(WATCH_HISTORY_LIMIT - 1).map(historyKey));
  writeWatchHistory([...others.filter((e) => !dropped.has(historyKey(e))), next]);
}

export function removeWatchHistory(entry: Pick<WatchHistoryEntry, "profileId" | "sourceId" | "kind" | "contentId">): void {
  const key = historyKey(entry);
  writeWatchHistory(readWatchHistory().filter((e) => historyKey(e) !== key));
}

export function clearWatchHistory(profileId: string, sourceId: string): void {
  writeWatchHistory(readWatchHistory().filter((e) => !(e.profileId === profileId && e.sourceId === sourceId)));
}

/**
 * Removes one playlist's favourites and Recently Watched entries for every
 * profile — used when the playlist itself is removed (see sync/purge.ts).
 * Continue Watching entries don't record their playlist, so they stay; a
 * resume point for a title that no longer exists is simply never offered.
 */
export function removeSourceUserData(sourceId: string): void {
  const favorites = readJson<FavoriteEntry[]>(FAVORITES_KEY, []);
  const keptFavorites = favorites.filter((f) => f.sourceId !== sourceId);
  if (keptFavorites.length !== favorites.length) {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(keptFavorites));
    favoritesRevision += 1;
    for (const listener of favoriteListeners) listener();
  }
  writeWatchHistory(readWatchHistory().filter((e) => e.sourceId !== sourceId));
}
