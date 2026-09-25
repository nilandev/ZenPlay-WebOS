import type { CategoryVerdict, CompiledKidsRules, KidsTag } from "./rules.js";

/**
 * The Kids decision precedence (docs/kids-profile.md §3.3), as pure
 * functions over the compiled rules and one Kids profile's parent
 * decisions. Everything unknown is excluded — the Kids profile is a
 * whitelist over the catalog.
 */

export type KidsContentKind = "live" | "vod" | "series";
export type ParentCategoryDecision = "approve" | "reject";
export type ParentItemDecision = "include" | "exclude";

/** One Kids profile's parent decisions for one playlist. */
export interface ParentSourceRules {
  categories?: Partial<Record<KidsContentKind, Record<string, ParentCategoryDecision>>>;
  items?: Partial<Record<KidsContentKind, Record<string, ParentItemDecision>>>;
}

export interface CategoryState {
  allowed: boolean;
  /** The automatic verdict, before the parent's decision. */
  verdict: CategoryVerdict;
  decision?: ParentCategoryDecision;
  /** "parent:approve", "category:kids series", "mature:horror", … */
  reason: string;
  /** The automatic verdict's reason, even when a parent decision overrides it. */
  autoReason: string;
  tags: KidsTag[];
}

export function decideCategory(
  rules: CompiledKidsRules,
  parent: ParentSourceRules | undefined,
  kind: KidsContentKind,
  categoryId: string,
  categoryName: string,
): CategoryState {
  const auto = rules.classifyCategory(categoryName);
  const decision = parent?.categories?.[kind]?.[categoryId];
  if (decision) return { allowed: decision === "approve", verdict: auto.verdict, decision, reason: `parent:${decision}`, autoReason: auto.reason, tags: auto.tags };
  return { allowed: auto.verdict === "allow", verdict: auto.verdict, reason: auto.reason, autoReason: auto.reason, tags: auto.tags };
}

export interface KidsItem {
  kind: KidsContentKind;
  id: string;
  name: string;
  /** Genre text when the provider has it (series lists) — tagged and checked for mature words like the title. */
  genre?: string;
}

export interface ItemState {
  allowed: boolean;
  reason: string;
  /** Allowed only by §3.3 step 5 (a kid-friendly title outside the allowed categories). */
  fromOtherCategory?: boolean;
  tags: KidsTag[];
}

/**
 * Whether one title or channel is shown in a Kids profile. `category` is
 * that item's category state (decideCategory), or undefined when the item
 * has no category at all.
 */
export function decideItem(
  rules: CompiledKidsRules,
  parent: ParentSourceRules | undefined,
  allowOtherCategories: boolean,
  item: KidsItem,
  category: CategoryState | undefined,
): ItemState {
  const text = item.genre ? `${item.name} ${item.genre}` : item.name;
  const { tags: titleTags, mature } = rules.tagText(text);
  const tags = Array.from(new Set([...(category?.tags ?? []), ...titleTags]));

  // 1. The parent's decision on this item is final.
  const itemDecision = parent?.items?.[item.kind]?.[item.id];
  if (itemDecision) return { allowed: itemDecision === "include", reason: `parent:${itemDecision}`, tags };

  // 3. A mature title is excluded even inside an allowed (or parent-approved) category.
  if (mature) return { allowed: false, reason: `mature:${mature}`, tags };

  // 2 + 4. The category's state — the parent's approve/reject, else the automatic verdict.
  if (category?.allowed) return { allowed: true, reason: category.reason, tags };
  if (item.kind === "live") {
    const channel = rules.matchKidsChannel(item.name);
    if (channel && category?.decision !== "reject") return { allowed: true, reason: `channel:${channel}`, tags };
  }

  // 5. Kid-friendly titles from other categories, only when the parent turned it on.
  const categoryRejected = category?.decision === "reject" || (category?.verdict === "block" && !category.decision);
  if (allowOtherCategories && titleTags.length > 0 && !categoryRejected) {
    return { allowed: true, reason: "other-category", fromOtherCategory: true, tags };
  }

  // 6. Default deny.
  return { allowed: false, reason: category ? category.reason : "no-category", tags };
}
