import defaultRulesJson from "./default-rules.json";
import { normalize, PhraseMatcher, tokenize } from "./normalize.js";

/**
 * The Kids content rules (docs/kids-profile.md §3.2), compiled once into
 * matchers. Everything here is a pure function of text, so it runs the
 * same on the main thread (category verdicts, read-time filtering) and in
 * the sync worker (title tags written into the catalog table).
 */

/** The tag vocabulary: one tag per keyword group in the rules JSON. */
export type KidsTag = "animation" | "learning" | "family" | "kids";
export const KIDS_TAGS: KidsTag[] = ["animation", "family", "learning", "kids"];

const TAG_BY_GROUP: Record<string, KidsTag> = {
  animation_and_children: "animation",
  educational_and_learning: "learning",
  family_friendly_genres: "family",
  kids_general: "kids",
};

export interface KidsRulesJson {
  version: number;
  inclusion: {
    categories: string[];
    review_before_including: string[];
    kids_channels: Record<string, string[]>;
    keywords: Record<string, string[]>;
    tag_only_keywords: string[];
  };
  exclusion: {
    categories_to_review_or_drop: string[];
    keywords: string[];
    ratings: string[];
    /** Phrases whose words never count as mature keywords ("Young Adult" isn't adult content). */
    safe_phrases?: string[];
  };
}

/** A category's automatic verdict, before any parent decision. */
export type CategoryVerdict = "allow" | "review" | "block" | "none";

export interface CategoryClassification {
  verdict: CategoryVerdict;
  /** Why, for the whitelist picker — e.g. "category:kids series", "keyword:cartoon", "mature:horror". */
  reason: string;
  tags: KidsTag[];
}

export interface TextTags {
  tags: KidsTag[];
  /** The mature keyword found, or null. */
  mature: string | null;
}

export interface ProgrammeText {
  title: string;
  description?: string;
  categories?: string[];
  rating?: string;
}

export interface CompiledKidsRules {
  readonly version: number;
  classifyCategory(name: string): CategoryClassification;
  /** Tags and mature flag for a title (plus genre, when the provider gives one). */
  tagText(text: string): TextTags;
  /** The known kids channel whose name appears in `channelName`, or null. */
  matchKidsChannel(channelName: string): string | null;
  /** Why a programme is unsuitable (a mature keyword or adult rating), or null when it's fine. */
  matureProgrammeReason(programme: ProgrammeText): string | null;
}

export function compileKidsRules(json: KidsRulesJson): CompiledKidsRules {
  const exactAllow = new Set(json.inclusion.categories.map(normalize));
  const review = new PhraseMatcher(json.inclusion.review_before_including.map((phrase) => [phrase, phrase] as [string, string]));
  const block = new PhraseMatcher(json.exclusion.categories_to_review_or_drop.map((phrase) => [phrase, phrase] as [string, string]));
  const matureKeywords = new PhraseMatcher(json.exclusion.keywords.map((phrase) => [phrase, phrase] as [string, string]));
  const safePhrases = new PhraseMatcher((json.exclusion.safe_phrases ?? []).map((phrase) => [phrase, phrase] as [string, string]));
  /** A mature keyword in `tokens`, ignoring words that are part of a safe phrase. */
  const mature = {
    matchFirst(tokens: string[]) {
      const covered = safePhrases.coveredIndexes(tokens);
      return matureKeywords.matchFirst(covered.size === 0 ? tokens : tokens.map((token, i) => (covered.has(i) ? "" : token)));
    },
  };
  const matureRatings = new Set(json.exclusion.ratings.map(normalize));
  const tagOnly = new Set(json.inclusion.tag_only_keywords.map(normalize));

  const keywordEntries: Array<[string, KidsTag]> = [];
  for (const [group, words] of Object.entries(json.inclusion.keywords)) {
    const tag = TAG_BY_GROUP[group];
    if (!tag) continue;
    for (const word of words) keywordEntries.push([word, tag]);
  }
  const keywords = new PhraseMatcher(keywordEntries);
  const categoryKeywords = new PhraseMatcher(keywordEntries.filter(([word]) => !tagOnly.has(normalize(word))));
  const kidsChannels = new PhraseMatcher(Object.values(json.inclusion.kids_channels).flat().map((name) => [name, name] as [string, string]));

  const uniqueTags = (found: Array<{ value: KidsTag }>): KidsTag[] => Array.from(new Set(found.map((f) => f.value)));

  return {
    version: json.version,

    classifyCategory(name) {
      const tokens = tokenize(name);
      const normalized = tokens.join(" ");
      const tags = uniqueTags(keywords.matchAll(tokens));
      const matureHit = mature.matchFirst(tokens);
      if (matureHit) return { verdict: "block", reason: `mature:${matureHit.phrase}`, tags };
      if (exactAllow.has(normalized)) return { verdict: "allow", reason: `category:${normalized}`, tags };
      const keywordHit = categoryKeywords.matchFirst(tokens);
      if (keywordHit) return { verdict: "allow", reason: `keyword:${keywordHit.phrase}`, tags };
      const reviewHit = review.matchFirst(tokens);
      if (reviewHit) return { verdict: "review", reason: `review:${reviewHit.phrase}`, tags };
      const blockHit = block.matchFirst(tokens);
      if (blockHit) return { verdict: "block", reason: `blocked:${blockHit.phrase}`, tags };
      return { verdict: "none", reason: "no-match", tags };
    },

    tagText(text) {
      const tokens = tokenize(text);
      return { tags: uniqueTags(keywords.matchAll(tokens)), mature: mature.matchFirst(tokens)?.phrase ?? null };
    },

    matchKidsChannel(channelName) {
      return kidsChannels.matchFirst(tokenize(channelName))?.phrase ?? null;
    },

    matureProgrammeReason(programme) {
      if (programme.rating && matureRatings.has(normalize(programme.rating))) return `rating:${programme.rating}`;
      const texts = [programme.title, programme.description ?? "", ...(programme.categories ?? [])];
      for (const text of texts) {
        const hit = mature.matchFirst(tokenize(text));
        if (hit) return `mature:${hit.phrase}`;
      }
      return null;
    },
  };
}

let defaultRules: CompiledKidsRules | undefined;

/** The bundled rule set (src/core/kids/default-rules.json), compiled on first use. */
export function getDefaultKidsRules(): CompiledKidsRules {
  defaultRules ??= compileKidsRules(defaultRulesJson as KidsRulesJson);
  return defaultRules;
}

/** Bumped with the bundled rules — a catalog tagged under an older version is re-synced (see catalog-sync.ts). */
export const KIDS_RULES_VERSION: number = (defaultRulesJson as KidsRulesJson).version;
