/**
 * How often each profile opens each Movies/Series category, per playlist,
 * persisted in localStorage (`iptv.category-usage.v1`) — the category
 * rails show the most-used ones at the top under "Frequently used".
 *
 * Keyed `${profileId}|${sourceId}|${kind}` so a Kids profile's habits never
 * reorder a parent's rail, and removing a profile or playlist can drop its
 * entries (see profile-store.ts).
 */

const CATEGORY_USAGE_KEY = "iptv.category-usage.v1";

/** How many categories the "Frequently used" section shows at most. */
export const FREQUENT_CATEGORY_LIMIT = 5;

export type CategoryUsageKind = "vod" | "series";

interface CategoryUsage {
  count: number;
  /** Epoch ms — breaks ties, so of two equally used categories the more recent one ranks first. */
  lastUsedAt: number;
}

type UsageByScope = Record<string, Record<string, CategoryUsage>>;

const scopeKey = (profileId: string, sourceId: string, kind: CategoryUsageKind) => `${profileId}|${sourceId}|${kind}`;

function readUsage(): UsageByScope {
  try {
    const raw = localStorage.getItem(CATEGORY_USAGE_KEY);
    return raw ? (JSON.parse(raw) as UsageByScope) : {};
  } catch {
    return {};
  }
}

function writeUsage(usage: UsageByScope): void {
  try {
    localStorage.setItem(CATEGORY_USAGE_KEY, JSON.stringify(usage));
  } catch {
    // Storage full or unavailable — the rail just keeps its provider order.
  }
}

export function recordCategoryUse(profileId: string, sourceId: string, kind: CategoryUsageKind, categoryId: string): void {
  const usage = readUsage();
  const key = scopeKey(profileId, sourceId, kind);
  const scope = (usage[key] ??= {});
  scope[categoryId] = { count: (scope[categoryId]?.count ?? 0) + 1, lastUsedAt: Date.now() };
  writeUsage(usage);
}

/** Category ids, most used first, at most `limit`. May include categories that no longer exist — callers filter against the current list. */
export function frequentCategoryIds(profileId: string, sourceId: string, kind: CategoryUsageKind, limit = FREQUENT_CATEGORY_LIMIT): string[] {
  const scope = readUsage()[scopeKey(profileId, sourceId, kind)] ?? {};
  return Object.entries(scope)
    .sort(([, a], [, b]) => b.count - a.count || b.lastUsedAt - a.lastUsedAt)
    .slice(0, limit)
    .map(([id]) => id);
}

/**
 * Splits `categories` into the frequently used ones (in usage order) and
 * the rest (in their original order), so each appears exactly once.
 */
export function splitByFrequency<T extends { id: string }>(categories: T[], frequentIds: string[]): { frequent: T[]; rest: T[] } {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const frequent = frequentIds.map((id) => byId.get(id)).filter((c): c is T => c !== undefined);
  const promoted = new Set(frequent.map((c) => c.id));
  return { frequent, rest: categories.filter((c) => !promoted.has(c.id)) };
}

function removeScopesMatching(matches: (profileId: string, sourceId: string) => boolean): void {
  const usage = readUsage();
  const kept = Object.fromEntries(
    Object.entries(usage).filter(([key]) => {
      const [profileId, sourceId] = key.split("|");
      return !matches(profileId, sourceId);
    }),
  );
  if (Object.keys(kept).length !== Object.keys(usage).length) writeUsage(kept);
}

export function removeSourceCategoryUsage(sourceId: string): void {
  removeScopesMatching((_profileId, id) => id === sourceId);
}

export function removeProfileCategoryUsage(profileId: string): void {
  removeScopesMatching((id) => id === profileId);
}
