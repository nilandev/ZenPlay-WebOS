import { useEffect, useState, type CSSProperties } from "react";

export interface SlowLoadHintProps {
  /** Milliseconds to wait before showing the hint — long enough that it never flashes on a normal, fast load. */
  delayMs?: number;
  message?: string;
  /** Overrides the default placement (inset at the top-left of a skeleton). */
  style?: CSSProperties;
}

const DEFAULT_DELAY_MS = 4000;
const DEFAULT_MESSAGE = "Still loading — this can take a moment on a slower connection…";

/**
 * Renders nothing until `delayMs` has passed since mount, then fades in a
 * small status line. Meant to sit inside a loading skeleton (see
 * ShelfRowSkeleton) so a load that's taking unusually long — a slow IPTV
 * provider, a cold connection, several requests contending at once (see
 * XtreamClient's authenticate() dedupe) — gets some feedback beyond a
 * shimmer that's been sitting still, which otherwise reads as the app being
 * stuck rather than genuinely still working. Never appears on a normal,
 * fast load since it mounts and unmounts within delayMs.
 */
export function SlowLoadHint({ delayMs = DEFAULT_DELAY_MS, message = DEFAULT_MESSAGE, style }: SlowLoadHintProps): JSX.Element | null {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);

  if (!isVisible) return null;

  return (
    <p
      style={{
        margin: "0 0 20px 40px",
        fontSize: 14,
        color: "var(--text-dim, #9a9aa4)",
        opacity: 0,
        animation: "iptv-slow-load-hint-fade-in 400ms ease-out forwards",
        ...style,
      }}
    >
      {message}
      <style>{`
        @keyframes iptv-slow-load-hint-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </p>
  );
}
