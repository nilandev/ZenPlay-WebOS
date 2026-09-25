import type { KidsContentKind } from "./eligibility.js";
import { KIDS_TAGS, type KidsTag } from "./rules.js";

/**
 * Kids Home recommendations (docs/kids-profile.md §3.5): deterministic,
 * on-device and explainable — no ML, no network. The caller gathers what
 * the profile is allowed to see; this module only orders it into rails.
 */

export interface RecItem {
  kind: KidsContentKind;
  id: string;
  name: string;
  imageUrl?: string;
  categoryId?: string;
  tags: KidsTag[];
}

export interface RecHistoryEntry {
  kind: KidsContentKind;
  id: string;
  title: string;
  categoryId?: string;
  tags: KidsTag[];
  updatedAt: string;
  /** 0–1 of the title watched (1 when finished). */
  completion: number;
  finished: boolean;
}

export type RailId = "continue" | "parent-picks" | "because" | `tag:${KidsTag}` | "live-now";

export interface Rail<T = RecItem> {
  id: RailId;
  title: string;
  items: T[];
}

export const RAIL_SIZE = 20;
/** At most this many titles from one category in a single rail, so one big category can't fill it. */
export const MAX_PER_CATEGORY = 4;
/** Watch history counts half as much after this long. */
const HALF_LIFE_DAYS = 7;
/** Cold start (no history): the fixed order from the requirement. */
const COLD_START_ORDER: KidsTag[] = ["animation", "family", "learning", "kids"];

export const TAG_RAIL_TITLES: Record<KidsTag, string> = {
  animation: "Cartoons & Animation",
  learning: "Learn & Discover",
  family: "Family Favourites",
  kids: "Kids Favourites",
};

/** Σ recencyDecay × completion over the history, per tag. */
export function tagAffinity(history: RecHistoryEntry[], now: number): Record<KidsTag, number> {
  const affinity = Object.fromEntries(KIDS_TAGS.map((tag) => [tag, 0])) as Record<KidsTag, number>;
  for (const entry of history) {
    const ageDays = Math.max(0, (now - Date.parse(entry.updatedAt)) / 86_400_000);
    const weight = Math.pow(0.5, ageDays / HALF_LIFE_DAYS) * Math.max(0, Math.min(1, entry.completion));
    for (const tag of entry.tags) affinity[tag] += weight;
  }
  return affinity;
}

/** Tags by affinity, strongest first; ties (and a profile with no history) keep the cold-start order. */
export function rankTags(affinity: Record<KidsTag, number>): KidsTag[] {
  return [...COLD_START_ORDER].sort((a, b) => affinity[b] - affinity[a] || COLD_START_ORDER.indexOf(a) - COLD_START_ORDER.indexOf(b));
}

export const itemKey = (item: Pick<RecItem, "kind" | "id">): string => `${item.kind}:${item.id}`;

/**
 * Takes items round-robin across categories (so a rail mixes categories),
 * at most MAX_PER_CATEGORY from each and RAIL_SIZE in all, skipping
 * anything already shown in an earlier rail.
 */
function diversify<T extends RecItem>(pools: T[][], seen: Set<string>, exclude: Set<string> = new Set()): T[] {
  const picked: T[] = [];
  const perCategory = new Map<string, number>();
  const cursors = pools.map(() => 0);
  let progressed = true;
  while (picked.length < RAIL_SIZE && progressed) {
    progressed = false;
    for (let p = 0; p < pools.length && picked.length < RAIL_SIZE; p++) {
      const pool = pools[p];
      while (cursors[p] < pool.length) {
        const item = pool[cursors[p]++];
        const key = itemKey(item);
        if (seen.has(key) || exclude.has(key)) continue;
        const category = item.categoryId ?? "";
        const count = perCategory.get(category) ?? 0;
        if (count >= MAX_PER_CATEGORY) continue;
        perCategory.set(category, count + 1);
        seen.add(key);
        picked.push(item);
        progressed = true;
        break;
      }
    }
  }
  return picked;
}

function takeUnseen<T extends RecItem>(items: T[], seen: Set<string>): T[] {
  const picked: T[] = [];
  for (const item of items) {
    if (picked.length >= RAIL_SIZE) break;
    const key = itemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(item);
  }
  return picked;
}

export interface KidsRailsInput<T extends RecItem = RecItem> {
  now: number;
  /** The profile's allowed history, newest first. */
  history: RecHistoryEntry[];
  /** In-progress titles, newest first (already built from history). */
  continueWatching: T[];
  parentPicks: T[];
  /** Sample titles from each allowed category, keyed by category id, in category order. */
  byCategory: Map<string, T[]>;
  /** Allowed live channels (already without any airing something mature). */
  liveNow: T[];
}

/**
 * The Kids Home rails, in the requirement's order: Continue Watching,
 * Picked by Parent, Because you watched ‹title›, one rail per tag (ranked
 * by the profile's tag affinity), Kids Live Now. Empty rails are dropped,
 * and a title appears in at most one rail.
 */
export function buildKidsRails<T extends RecItem>(input: KidsRailsInput<T>): Array<Rail<T>> {
  const seen = new Set<string>();
  const rails: Array<Rail<T>> = [];
  const push = (rail: Rail<T>) => {
    if (rail.items.length > 0) rails.push(rail);
  };

  push({ id: "continue", title: "Continue Watching", items: takeUnseen(input.continueWatching, seen) });
  push({ id: "parent-picks", title: "Picked by Parent", items: takeUnseen(input.parentPicks, seen) });

  // Because you watched: the most recent title with a known category, and more from that category.
  const seed = input.history.find((entry) => entry.kind !== "live" && entry.categoryId && input.byCategory.has(entry.categoryId));
  if (seed?.categoryId) {
    const finished = new Set(input.history.filter((e) => e.finished).map((e) => `${e.kind}:${e.id}`));
    finished.add(`${seed.kind}:${seed.id}`);
    const pool = input.byCategory.get(seed.categoryId) ?? [];
    const items = diversify([pool], seen, finished);
    push({ id: "because", title: `Because you watched ${seed.title}`, items });
  }

  const categoryPools = Array.from(input.byCategory.values());
  for (const tag of rankTags(tagAffinity(input.history, input.now))) {
    const pools = categoryPools.map((pool) => pool.filter((item) => item.tags.includes(tag)));
    push({ id: `tag:${tag}`, title: TAG_RAIL_TITLES[tag], items: diversify(pools, seen) });
  }

  push({ id: "live-now", title: "Kids Live Now", items: takeUnseen(input.liveNow, seen) });
  return rails;
}
