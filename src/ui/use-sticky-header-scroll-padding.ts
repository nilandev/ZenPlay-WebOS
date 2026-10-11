import { useCallback, useEffect, useRef } from "react";

/**
 * Room kept above and below a focused card when it's scrolled into view, so
 * its LiftSurface growth (scale 1.1 on a poster plus its caption is ~1.5rem
 * each way) doesn't poke under the header or off the bottom of the screen.
 */
const LIFT_ALLOWANCE = "1.75rem";

/**
 * Keeps focus scrolling clear of a screen's sticky header. Every focus
 * scroll in the browse screens is a scrollIntoView({ block: "nearest" })
 * (Focusable for grid cards, Shelf for rows), and on its own that lines a
 * row's top up with the top of the viewport — underneath the sticky header,
 * so scrolling back up left the first row hidden behind the title and the
 * Refresh/Search buttons. scroll-padding on the document's scroll root
 * shrinks the area scrollIntoView aligns to, so rows stop just below the
 * header instead (and the first row lands back in its original place).
 *
 * Returns a callback ref for the sticky header. The header's height changes
 * (the count/updated line comes and goes, and rem scales with the TV's
 * resolution), so it's measured rather than hard-coded; and the padding is
 * cleared whenever the header unmounts (e.g. Series opening a show's
 * detail page), so screens without a sticky header aren't affected.
 */
export function useStickyHeaderScrollPadding(): (header: HTMLElement | null) => void {
  const cleanupRef = useRef<(() => void) | null>(null);

  const ref = useCallback((header: HTMLElement | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (!header) return;

    const root = document.documentElement;
    const apply = (): void => {
      root.style.scrollPaddingTop = `calc(${header.offsetHeight}px + ${LIFT_ALLOWANCE})`;
    };
    apply();
    root.style.scrollPaddingBottom = LIFT_ALLOWANCE;

    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(apply);
    observer?.observe(header);
    cleanupRef.current = () => {
      observer?.disconnect();
      root.style.scrollPaddingTop = "";
      root.style.scrollPaddingBottom = "";
    };
  }, []);

  useEffect(() => () => cleanupRef.current?.(), []);

  return ref;
}
