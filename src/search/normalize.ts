/**
 * How titles and queries are turned into search words, and how well a title
 * matches a query — shared by the background indexer (search-indexer.ts, in
 * its worker) and the query side (search-index.ts), so both always agree.
 * Pure functions, no I/O.
 */

/**
 * Provider tags a title can start with: `EN |`, `FR:`, `[4K]`, `(MULTI)`,
 * `4K`, `HD`… Only a leading run of them is stripped. The `XX:`/`XX |` form
 * must be upper-case in the original title, so a real word such as "Up:"
 * isn't mistaken for one.
 */
const BRACKETED_TAG = /^[[(][^\])]{1,12}[\])]\s*[-|:]?\s*/;
const CODE_TAG = /^[A-Z0-9]{2,4}\s*[|:]\s*/;
const CODE_TAG_PIPE = /^[a-zA-Z0-9]{2,4}\s*\|\s*/;
const QUALITY_TAG = /^(?:4k|uhd|fhd|hd|sd|hevc|vip|multi)(?=[\s\-|:]|$)\s*[-|:]?\s*/i;

/** Words that carry no meaning in a title search; left out of the index and of queries. */
const STOPWORDS = new Set(["the", "a", "an", "le", "la", "les", "el", "los", "las", "der", "die", "das"]);

/** A title's index gets at most this many words, so a very long name can't bloat the index. */
const MAX_TOKENS = 12;

/** Removes a leading run of provider tags; returns the title unchanged if that would leave nothing. */
export function stripProviderTags(title: string): string {
  let rest = title.trim();
  for (;;) {
    const match = BRACKETED_TAG.exec(rest) ?? CODE_TAG.exec(rest) ?? CODE_TAG_PIPE.exec(rest) ?? QUALITY_TAG.exec(rest);
    if (!match || match[0].length === 0 || match[0].length >= rest.length) break;
    rest = rest.slice(match[0].length);
  }
  return rest.length > 0 ? rest : title.trim();
}

/** Lower-cased, with accents removed ("Amélie" → "amelie"). */
export function foldCase(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();
}

function words(text: string): string[] {
  return foldCase(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
}

/** A title's words in order, provider tags and stopwords removed. */
export function titleTokens(title: string): string[] {
  const all = words(stripProviderTags(title));
  const meaningful = all.filter((word) => !STOPWORDS.has(word));
  return meaningful.length > 0 ? meaningful : all;
}

/** The distinct words a title is indexed under. */
export function indexTokens(title: string): string[] {
  return [...new Set(titleTokens(title))].slice(0, MAX_TOKENS);
}

/** A query's words in order, stopwords removed (unless that leaves nothing). */
export function queryTokens(query: string): string[] {
  const all = words(query);
  const meaningful = all.filter((word) => !STOPWORDS.has(word));
  return meaningful.length > 0 ? meaningful : all;
}

export const SCORE_EXACT = 100;
export const SCORE_STARTS_WITH = 80;
export const SCORE_WORDS_IN_ORDER = 60;
export const SCORE_WORDS_ANY_ORDER = 40;

/**
 * How well `title` matches the query's words (every query word is treated
 * as the start of a word, since the last one is usually still being typed):
 *
 * - 100: the title is the query
 * - 80: the title starts with the query
 * - 60: every query word starts a title word, in order
 * - 40: every query word starts a title word, in any order
 * - 0: no match
 */
export function scoreTitle(query: string[], title: string): number {
  if (query.length === 0) return 0;
  const tokens = titleTokens(title);
  const joinedTitle = tokens.join(" ");
  const joinedQuery = query.join(" ");
  if (joinedTitle === joinedQuery) return SCORE_EXACT;
  if (joinedTitle.startsWith(joinedQuery)) return SCORE_STARTS_WITH;

  let from = 0;
  let inOrder = true;
  for (const word of query) {
    const at = tokens.findIndex((token, index) => index >= from && token.startsWith(word));
    if (at === -1) {
      inOrder = false;
      break;
    }
    from = at + 1;
  }
  if (inOrder) return SCORE_WORDS_IN_ORDER;
  return query.every((word) => tokens.some((token) => token.startsWith(word))) ? SCORE_WORDS_ANY_ORDER : 0;
}
