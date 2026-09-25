/**
 * Text normalization and whole-word phrase matching for the Kids content
 * engine (see docs/kids-profile.md §3.2). Pure and DOM-free — it also runs
 * inside the sync worker, tagging every catalog record as it's written.
 *
 * Provider category and title strings are noisy ("|FR| ✪ ANIMATION",
 * "UK: Nick Jr HD", "Kids-Animation 4K"), so both the rules and the text
 * they're matched against go through the same normalize() before matching,
 * and matching is by whole tokens only — "Sex" must never match "Sussex".
 */

/** Quality/packaging decorations providers bolt onto names — dropped so "Kids 4K" matches the rule "Kids". */
const DECORATION_TOKENS = new Set(["4k", "8k", "uhd", "fhd", "hd", "sd", "hevc", "h265", "vip", "raw"]);

/** Arabic letter variants folded together, and diacritics/tatweel dropped, so "أطفال" and "اطفال" are one word. */
function foldArabic(text: string): string {
  return text
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
}

/**
 * Lowercased tokens with punctuation, emoji and decorations removed. `+` is
 * kept as part of a token so "18+" and "+18" survive; "24/7" is dropped as
 * a whole (it's a channel decoration, and splitting it would leave "24" and
 * "7" tokens that match unrelated names).
 */
export function tokenize(text: string): string[] {
  const cleaned = foldArabic(text.normalize("NFKC").toLowerCase())
    .replace(/24\s*\/\s*7/g, " ")
    .replace(/[^\p{L}\p{N}+]+/gu, " ");
  const tokens: string[] = [];
  for (const token of cleaned.split(" ")) {
    if (token && token !== "+" && !DECORATION_TOKENS.has(token)) tokens.push(token);
  }
  return tokens;
}

/** tokenize() joined back into one string — the canonical form exact category-name rules compare against. */
export function normalize(text: string): string {
  return tokenize(text).join(" ");
}

/**
 * A precompiled set of phrases, matched as whole token sequences. Indexed by
 * each phrase's first token so a lookup costs one Map probe per token of
 * the text, whatever the number of phrases — this runs over every title in
 * a 100k-title catalog during sync.
 */
export class PhraseMatcher<T> {
  private readonly byFirstToken = new Map<string, Array<{ tokens: string[]; value: T }>>();

  constructor(entries: Array<[phrase: string, value: T]>) {
    for (const [phrase, value] of entries) {
      const tokens = tokenize(phrase);
      if (tokens.length === 0) continue;
      const list = this.byFirstToken.get(tokens[0]) ?? [];
      list.push({ tokens, value });
      // Longest phrase first, so "adult swim" is reported rather than "adult".
      list.sort((a, b) => b.tokens.length - a.tokens.length);
      this.byFirstToken.set(tokens[0], list);
    }
  }

  /** Indexes of `tokens` covered by any phrase — see CompiledKidsRules' safe phrases. */
  coveredIndexes(tokens: string[]): Set<number> {
    const covered = new Set<number>();
    for (let i = 0; i < tokens.length; i++) {
      for (const candidate of this.byFirstToken.get(tokens[i]) ?? []) {
        if (!startsAt(tokens, i, candidate.tokens)) continue;
        for (let j = 0; j < candidate.tokens.length; j++) covered.add(i + j);
        break;
      }
    }
    return covered;
  }

  /** Every phrase found in `tokens`, in order of appearance (a phrase is reported once). */
  matchAll(tokens: string[]): Array<{ phrase: string; value: T }> {
    const found: Array<{ phrase: string; value: T }> = [];
    const seen = new Set<string>();
    for (let i = 0; i < tokens.length; i++) {
      const candidates = this.byFirstToken.get(tokens[i]);
      if (!candidates) continue;
      for (const candidate of candidates) {
        if (!startsAt(tokens, i, candidate.tokens)) continue;
        const phrase = candidate.tokens.join(" ");
        if (seen.has(phrase)) continue;
        seen.add(phrase);
        found.push({ phrase, value: candidate.value });
      }
    }
    return found;
  }

  /** The first phrase found in `tokens`, or undefined. */
  matchFirst(tokens: string[]): { phrase: string; value: T } | undefined {
    for (let i = 0; i < tokens.length; i++) {
      const candidates = this.byFirstToken.get(tokens[i]);
      if (!candidates) continue;
      for (const candidate of candidates) {
        if (startsAt(tokens, i, candidate.tokens)) return { phrase: candidate.tokens.join(" "), value: candidate.value };
      }
    }
    return undefined;
  }
}

function startsAt(tokens: string[], index: number, phrase: string[]): boolean {
  if (index + phrase.length > tokens.length) return false;
  for (let j = 0; j < phrase.length; j++) {
    if (tokens[index + j] !== phrase[j]) return false;
  }
  return true;
}
