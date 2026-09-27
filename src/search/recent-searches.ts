/**
 * What each profile recently searched for in each playlist, newest first —
 * the Search screen's empty state offers them again. Stored in localStorage
 * (`iptv.recent-searches.v1`), keyed `${profileId}|${sourceId}`. A query is
 * recorded when one of its results is opened, never per keystroke, so
 * half-typed queries don't show up.
 */

const RECENT_SEARCHES_KEY = "iptv.recent-searches.v1";

/** How many recent searches are kept per profile and playlist. */
export const RECENT_SEARCH_LIMIT = 10;

type RecentByScope = Record<string, string[]>;

const scopeKey = (profileId: string, sourceId: string) => `${profileId}|${sourceId}`;

function read(): RecentByScope {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    return raw ? (JSON.parse(raw) as RecentByScope) : {};
  } catch {
    return {};
  }
}

function write(value: RecentByScope): void {
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(value));
  } catch {
    // Storage full or unavailable — the empty state just shows fewer suggestions.
  }
}

export function loadRecentSearches(profileId: string, sourceId: string): string[] {
  return read()[scopeKey(profileId, sourceId)] ?? [];
}

export function recordRecentSearch(profileId: string, sourceId: string, query: string): void {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return;
  const all = read();
  const key = scopeKey(profileId, sourceId);
  all[key] = [normalized, ...(all[key] ?? []).filter((existing) => existing !== normalized)].slice(0, RECENT_SEARCH_LIMIT);
  write(all);
}

function removeScopesMatching(matches: (profileId: string, sourceId: string) => boolean): void {
  const all = read();
  const kept = Object.fromEntries(Object.entries(all).filter(([key]) => !matches(...(key.split("|") as [string, string]))));
  if (Object.keys(kept).length !== Object.keys(all).length) write(kept);
}

export function removeSourceRecentSearches(sourceId: string): void {
  removeScopesMatching((_profileId, id) => id === sourceId);
}

export function removeProfileRecentSearches(profileId: string): void {
  removeScopesMatching((id) => id === profileId);
}
