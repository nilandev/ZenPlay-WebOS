/** Empty brackets, as a panel leaves them when it builds "Title (Year)" for a title with no year: "()", "( )", "[]", "{ }". */
const EMPTY_BRACKETS = /\s*(?:\(\s*\)|\[\s*\]|\{\s*\})/g;

/**
 * A provider-supplied title as it should be shown: empty brackets removed
 * ("Heat ()" → "Heat", "Heat () [4K]" → "Heat [4K]") and the ends trimmed.
 * Falls back to the raw title if cleaning would leave nothing.
 */
export function cleanTitle(title: string | null | undefined): string {
  const raw = typeof title === "string" ? title : title == null ? "" : String(title);
  const cleaned = raw.replace(EMPTY_BRACKETS, "").trim();
  return cleaned || raw.trim();
}
