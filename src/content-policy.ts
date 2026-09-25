import { useMemo, useSyncExternalStore } from "react";
import {
  decideCategory,
  decideItem,
  getDefaultKidsRules,
  isKidsProfile,
  type Category,
  type CategoryState,
  type Channel,
  type CompiledKidsRules,
  type ItemState,
  type KidsContentKind,
  type ParentSourceRules,
  type Profile,
} from "@core";
import type { CatalogRecord, CatalogRecordPredicate } from "./core/storage/catalog-db.js";
import { getParentalRevision, loadKidsProfileRules, subscribeParental } from "./parental-store.js";

/**
 * The one content policy every browse surface filters through
 * (docs/kids-profile.md §6). A standard profile gets a pass-through policy
 * (`isKids: false`) and screens behave exactly as before; a Kids profile
 * gets a default-deny whitelist built from the bundled rules plus that
 * profile's parent decisions for the current playlist.
 */

/** Virtual Movies/Series categories a Kids profile sees: the parent's force-included titles… */
export const PARENT_PICKS_CATEGORY_ID = "__kids_parent_picks__";
/** …and kid-friendly titles from other categories (§3.3 step 5, when the parent allows it). */
export const MORE_FOR_KIDS_CATEGORY_ID = "__kids_more__";

export type CatalogKind = "vod" | "series";

export interface PolicyItem {
  id: string;
  name: string;
  /** The category id (Channel.groupTitle). */
  groupTitle?: string;
  genre?: string;
}

/** A Kids filter for catalog-table reads (see catalog-store.ts) — applied while the IndexedDB cursor walks. */
export interface CatalogFilter {
  /** Changes whenever the filter's answers can change — a memo/effect dependency. */
  key: string;
  accepts: CatalogRecordPredicate;
  isCategoryAllowed(categoryId: string | undefined): boolean;
  /** Stream ids the parent force-included, for the Picked by Parent category. */
  pickedIds: string[];
  /** Kid-friendly titles from other categories are allowed (the More for Kids category). */
  moreForKids: boolean;
}

export interface ContentPolicy {
  readonly isKids: boolean;
  /** Changes whenever any answer below can change — a memo/effect dependency. */
  readonly key: string;
  readonly allowOtherCategories: boolean;
  categoryState(kind: KidsContentKind, category: Category): CategoryState;
  itemState(kind: KidsContentKind, item: PolicyItem, categoriesById?: Map<string, Category>): ItemState;
  isItemAllowed(kind: KidsContentKind, item: PolicyItem, categoriesById?: Map<string, Category>): boolean;
  /** Movies/Series categories to list: Picked by Parent, the allowed categories, More for Kids. */
  visibleCatalogCategories(kind: CatalogKind, categories: Category[]): Category[];
  /** Allowed live channels (provider order kept). */
  filterLiveChannels(channels: Channel[], categories: Category[]): Channel[];
  /** The filter for catalog-table reads, or undefined when nothing is filtered (a standard profile). */
  catalogFilter(kind: CatalogKind, categories: Category[]): CatalogFilter | undefined;
  /** Ids the parent force-included for this kind. */
  parentPickIds(kind: KidsContentKind): string[];
}

const ALLOWED: ItemState = { allowed: true, reason: "standard", tags: [] };
const ALLOWED_CATEGORY: CategoryState = { allowed: true, verdict: "allow", reason: "standard", autoReason: "standard", tags: [] };

/** Standard profiles: nothing is filtered. */
export const PASS_THROUGH_POLICY: ContentPolicy = {
  isKids: false,
  key: "standard",
  allowOtherCategories: false,
  categoryState: () => ALLOWED_CATEGORY,
  itemState: () => ALLOWED,
  isItemAllowed: () => true,
  visibleCatalogCategories: (_kind, categories) => categories,
  filterLiveChannels: (channels) => channels,
  catalogFilter: () => undefined,
  parentPickIds: () => [],
};

function categoryName(categoryId: string | undefined, categoriesById: Map<string, Category> | undefined): string {
  if (!categoryId) return "";
  // M3U groups are their own names; an Xtream id with no loaded name classifies as nothing (hidden).
  return categoriesById?.get(categoryId)?.name ?? categoryId;
}

export interface KidsPolicyOptions {
  profileId: string;
  sourceId: string;
  parent: ParentSourceRules | undefined;
  allowOtherCategories: boolean;
  rules?: CompiledKidsRules;
  /** Folded into `key`. */
  revision?: number;
}

/** A Kids profile's policy for one playlist. Pure apart from its own memo caches. */
export function createKidsPolicy({ profileId, sourceId, parent, allowOtherCategories, rules = getDefaultKidsRules(), revision = 0 }: KidsPolicyOptions): ContentPolicy {
  const key = `kids:${profileId}:${sourceId}:${revision}`;
  // Category verdicts are asked for over and over during a cursor walk — cache per kind+id+name.
  const categoryCache = new Map<string, CategoryState>();
  const stateOf = (kind: KidsContentKind, id: string, name: string): CategoryState => {
    const cacheKey = `${kind}\u0000${id}\u0000${name}`;
    let state = categoryCache.get(cacheKey);
    if (!state) {
      state = decideCategory(rules, parent, kind, id, name);
      categoryCache.set(cacheKey, state);
    }
    return state;
  };

  const itemState = (kind: KidsContentKind, item: PolicyItem, categoriesById?: Map<string, Category>): ItemState => {
    const category = item.groupTitle ? stateOf(kind, item.groupTitle, categoryName(item.groupTitle, categoriesById)) : undefined;
    return decideItem(rules, parent, allowOtherCategories, { kind, id: item.id, name: item.name, genre: item.genre }, category);
  };

  const parentPickIds = (kind: KidsContentKind): string[] =>
    Object.entries(parent?.items?.[kind] ?? {})
      .filter(([, decision]) => decision === "include")
      .map(([id]) => id);

  return {
    isKids: true,
    key,
    allowOtherCategories,
    categoryState: (kind, category) => stateOf(kind, category.id, category.name),
    itemState,
    isItemAllowed: (kind, item, categoriesById) => itemState(kind, item, categoriesById).allowed,

    visibleCatalogCategories(kind, categories) {
      const streamKind = kind === "vod" ? "movie" : "series";
      const allowed = categories.filter((category) => stateOf(kind, category.id, category.name).allowed);
      return [
        ...(parentPickIds(kind).length > 0 ? [{ id: PARENT_PICKS_CATEGORY_ID, name: "Picked by Parent", kind: streamKind } as Category] : []),
        ...allowed,
        ...(allowOtherCategories ? [{ id: MORE_FOR_KIDS_CATEGORY_ID, name: "More for Kids", kind: streamKind } as Category] : []),
      ];
    },

    filterLiveChannels(channels, categories) {
      const byId = new Map(categories.map((category) => [category.id, category]));
      return channels.filter((channel) => itemState("live", channel, byId).allowed);
    },

    catalogFilter(kind, categories) {
      const byId = new Map(categories.map((category) => [category.id, category]));
      const recordItem = (record: CatalogRecord): PolicyItem => ({ id: record.streamId, name: record.name, groupTitle: record.groupTitle, genre: record.genre });
      return {
        key: `${key}:${kind}:${categories.length}`,
        accepts: (record) => itemState(kind, recordItem(record), byId).allowed,
        isCategoryAllowed: (categoryId) => (categoryId ? stateOf(kind, categoryId, categoryName(categoryId, byId)).allowed : false),
        pickedIds: parentPickIds(kind),
        moreForKids: allowOtherCategories,
      };
    },

    parentPickIds,
  };
}

/** Re-renders on every parental change (PIN, rules, disclaimer) and returns the change counter. */
export function useParentalRevision(): number {
  return useSyncExternalStore(subscribeParental, getParentalRevision);
}

/**
 * The active profile's policy for the active playlist — pass-through for a
 * standard profile, the Kids whitelist for a Kids profile. Rebuilt when the
 * parent changes anything, so an open screen re-filters at once.
 */
export function useContentPolicy(profile: Profile | null | undefined, sourceId: string | undefined): ContentPolicy {
  const revision = useParentalRevision();
  const isKids = isKidsProfile(profile);
  const profileId = profile?.id;
  return useMemo(() => {
    if (!isKids || !profileId || !sourceId) return PASS_THROUGH_POLICY;
    const rules = loadKidsProfileRules(profileId);
    return createKidsPolicy({
      profileId,
      sourceId,
      parent: rules.sources[sourceId],
      allowOtherCategories: rules.allowOtherCategories ?? false,
      revision,
    });
  }, [isKids, profileId, sourceId, revision]);
}
