import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { useIsFocused } from "./focus-store.js";

/**
 * Set to true by a container that scrolls its own focused child into view
 * (Shelf, ChannelSidebar's windowed list) so Focusable skips its own
 * scrollIntoView. Two independent scroll requests per key press — the
 * container's and Focusable's — used to fight each other (an instant
 * "nearest" scroll cancelling an in-flight smooth one), and each one forces
 * a synchronous layout, which is expensive on TV-class CPUs.
 */
export const FocusScrollManagedContext = createContext(false);

export interface FocusableProps {
  id: string;
  children: ReactNode;
  className?: string;
  focusedClassName?: string;
  /**
   * Overrides the default `width: 100%; height: 100%` sizing — pass `{ height: "auto" }`
   * (or similar) for a plain vertical list row whose height should come from its own
   * content/padding instead of stretching to fill a definite-height scroll container
   * (e.g. CategorySidebar/ChannelSidebar). Leave unset for grid/shelf cells that rely on
   * the 100%-height default to fill a pre-sized cell — see the class doc comment below.
   */
  style?: React.CSSProperties;
}

/**
 * Renders a focusable tile whose visual "focused" state is driven purely by
 * the focus store (not native DOM focus), and scrolls itself into view when
 * it becomes focused so keyboard/remote navigation through long lists works
 * without relying on browser auto-scroll behavior (unreliable on older webOS TV WebKit).
 */
export function Focusable({ id, children, className, focusedClassName, style }: FocusableProps): JSX.Element {
  const isFocused = useIsFocused(id);
  const ref = useRef<HTMLDivElement>(null);
  const isScrollManaged = useContext(FocusScrollManagedContext);

  useEffect(() => {
    if (isFocused && !isScrollManaged) {
      ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [isFocused, isScrollManaged]);

  const classes = [className, isFocused ? (focusedClassName ?? "is-focused") : ""].filter(Boolean).join(" ");

  return (
    <div
      ref={ref}
      className={classes}
      data-focus-id={id}
      data-focused={isFocused}
      // width/height: 100% so a child sized with height: 100% (e.g.
      // EpgGrid's programme cell button) resolves against Focusable's own
      // parent instead of collapsing to 0 — percentage heights don't
      // resolve against this div's default auto height. Not display:
      // contents, since that has historically been unreliable for
      // scrollIntoView/focus on older webOS TV WebKit.
      style={{ width: "100%", height: "100%", ...style }}
    >
      {children}
    </div>
  );
}
