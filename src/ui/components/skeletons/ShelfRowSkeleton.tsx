import { Shimmer } from "../Shimmer.js";
import { SlowLoadHint } from "../SlowLoadHint.js";
import { BROWSE_CONTENT_LEFT, BROWSE_GAP, BROWSE_SIDE_PADDING, POSTER_COLUMNS, POSTER_WIDTH } from "../../tv-metrics.js";

export interface ShelfRowSkeletonProps {
  rows?: number;
  cardsPerRow?: number;
  cardWidth?: number | string;
  aspectRatio?: string;
}

/**
 * Mirrors Shelf/FocusCard's layout (title + horizontal poster row) for
 * Movies/Series loading states. Also carries a SlowLoadHint: this is the
 * skeleton shown while a fresh Xtream session authenticates and fetches its
 * first catalog, which can genuinely take several seconds on a slow
 * provider (compounded, before a fix — see conversation history — by
 * HomeScreen firing several concurrent authenticate() calls on first
 * mount). A shimmer with no further feedback for that long reads as the
 * app being stuck rather than still working.
 */
// Defaults mirror a real shelf at TV size (see tv-metrics.ts): same poster width, gap and margins, one extra card for the peek at the right edge.
export function ShelfRowSkeleton({ rows = 2, cardsPerRow = POSTER_COLUMNS + 1, cardWidth = POSTER_WIDTH, aspectRatio = "2 / 3" }: ShelfRowSkeletonProps): JSX.Element {
  return (
    <div style={{ paddingTop: "1.5rem" }}>
      <SlowLoadHint />
      {Array.from({ length: rows }, (_, rowIndex) => (
        <section key={rowIndex} style={{ marginBottom: "2rem" }}>
          <div style={{ margin: `0 0 1.25rem ${BROWSE_CONTENT_LEFT}` }}>
            <Shimmer width="14rem" height="1.75rem" />
          </div>
          <div style={{ display: "flex", gap: BROWSE_GAP, padding: `0 ${BROWSE_SIDE_PADDING} 0 ${BROWSE_CONTENT_LEFT}`, overflow: "hidden" }}>
            {Array.from({ length: cardsPerRow }, (_, cardIndex) => (
              <div key={cardIndex} style={{ flex: "0 0 auto", width: cardWidth }}>
                <Shimmer height="auto" borderRadius={16} style={{ width: cardWidth, aspectRatio }} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
