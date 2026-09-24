import { useEffect, useState } from "react";

/**
 * Returns `value`, but only after it has stopped changing for `delayMs` —
 * e.g. a search box's text, so a query runs once the user pauses typing
 * rather than on every keystroke. A delay of 0 passes changes straight
 * through (still one render later, via the effect).
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (delayMs <= 0) {
      setDebounced(value);
      return;
    }
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}

/** How long search waits after the last keystroke before querying. */
export const SEARCH_DEBOUNCE_MS = 300;
/** Queries shorter than this don't search — one letter matches nearly the whole catalog. */
export const MIN_SEARCH_CHARS = 2;

/**
 * The search query screens should actually run: lowercased and trimmed,
 * debounced by SEARCH_DEBOUNCE_MS, and empty ("no search") until it's at
 * least MIN_SEARCH_CHARS long. Clearing the box takes effect immediately.
 */
export function useSearchQuery(rawInput: string): string {
  const normalized = rawInput.trim().toLowerCase();
  const debounced = useDebouncedValue(normalized, normalized ? SEARCH_DEBOUNCE_MS : 0);
  return debounced.length >= MIN_SEARCH_CHARS ? debounced : "";
}
