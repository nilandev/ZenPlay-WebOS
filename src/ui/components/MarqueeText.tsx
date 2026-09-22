import { useEffect, useRef, useState } from "react";

export interface MarqueeTextProps {
  text: string;
  /** Only animate while true (e.g. the row is D-pad-focused) — a static row still ellipsizes normally when this is false, so unfocused overflowing labels don't turn into a wall of simultaneously moving text. */
  active: boolean;
  style?: React.CSSProperties;
}

/** How long the text pauses at each end before reversing — long enough to actually read the start/end, not just a flicker. */
const EDGE_PAUSE_MS = 900;
/** Pixels per second the text travels — slow enough to read comfortably at TV viewing distance. */
const PIXELS_PER_SECOND = 40;

/**
 * Single-line label that ellipsizes normally (via CSS) until `active`, at
 * which point — only if the text actually overflows its container — it
 * scrolls right-to-left to reveal the clipped end, pauses, then scrolls back
 * (bounces) to the start and pauses again, looping for as long as `active`
 * stays true. Pure CSS transform animation (translateX), not JS-driven
 * per-frame updates, so it stays cheap on weak TV CPUs — see
 * PlaybackControls.tsx's similar GPU-composited-transform convention.
 */
export function MarqueeText({ text, active, style }: MarqueeTextProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflowPx, setOverflowPx] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    const textEl = textRef.current;
    if (!container || !textEl) return;
    // Measured only when becoming active (and on text change while active)
    // — an inactive row is plain ellipsized CSS with nothing to measure.
    const overflow = textEl.scrollWidth - container.clientWidth;
    setOverflowPx(overflow > 0 ? overflow : 0);
  }, [active, text]);

  const shouldScroll = active && overflowPx > 0;
  const distancePx = overflowPx;
  const travelMs = shouldScroll ? (distancePx / PIXELS_PER_SECOND) * 1000 : 0;
  const cycleMs = shouldScroll ? travelMs * 2 + EDGE_PAUSE_MS * 2 : 0;
  const pauseFraction = shouldScroll ? EDGE_PAUSE_MS / cycleMs : 0;
  const travelFraction = shouldScroll ? travelMs / cycleMs : 0;

  return (
    <div ref={containerRef} style={{ overflow: "hidden", whiteSpace: "nowrap", ...style }}>
      <span
        ref={textRef}
        style={{
          display: "inline-block",
          willChange: shouldScroll ? "transform" : undefined,
          animation: shouldScroll ? `marquee-scroll-${Math.round(distancePx)} ${cycleMs}ms ease-in-out infinite` : "none",
          textOverflow: shouldScroll ? "clip" : "ellipsis",
          overflow: shouldScroll ? "visible" : "hidden",
          maxWidth: shouldScroll ? "none" : "100%",
        }}
      >
        {text}
      </span>
      {shouldScroll && (
        <style>{`
          @keyframes marquee-scroll-${Math.round(distancePx)} {
            0% { transform: translateX(0); }
            ${(pauseFraction * 100).toFixed(2)}% { transform: translateX(0); }
            ${((pauseFraction + travelFraction) * 100).toFixed(2)}% { transform: translateX(-${distancePx}px); }
            ${((2 * pauseFraction + travelFraction) * 100).toFixed(2)}% { transform: translateX(-${distancePx}px); }
            100% { transform: translateX(0); }
          }
        `}</style>
      )}
    </div>
  );
}
