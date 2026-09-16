import { useEffect, useRef, type ReactNode } from "react";
import { useFocusStore } from "./focus-store.js";

export interface FocusableProps {
  id: string;
  children: ReactNode;
  className?: string;
  focusedClassName?: string;
}

/**
 * Renders a focusable tile whose visual "focused" state is driven purely by
 * the focus store (not native DOM focus), and scrolls itself into view when
 * it becomes focused so keyboard/remote navigation through long lists works
 * without relying on browser auto-scroll behavior (unreliable on Tizen/webOS).
 */
export function Focusable({ id, children, className, focusedClassName }: FocusableProps): JSX.Element {
  const isFocused = useFocusStore((state) => state.focusedId === id);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isFocused) {
      ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [isFocused]);

  const classes = [className, isFocused ? (focusedClassName ?? "is-focused") : ""].filter(Boolean).join(" ");

  return (
    <div ref={ref} className={classes} data-focus-id={id} data-focused={isFocused}>
      {children}
    </div>
  );
}
