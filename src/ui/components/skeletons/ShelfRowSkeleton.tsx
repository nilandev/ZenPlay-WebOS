import { Shimmer } from "../Shimmer.js";
import { SlowLoadHint } from "../SlowLoadHint.js";

export interface ShelfRowSkeletonProps {
  rows?: number;
  cardsPerRow?: number;
  cardWidth?: number;
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
export function ShelfRowSkeleton({ rows = 2, cardsPerRow = 6, cardWidth = 220, aspectRatio = "2 / 3" }: ShelfRowSkeletonProps): JSX.Element {
  return (
    <div style={{ paddingTop: 24 }}>
      <SlowLoadHint />
      {Array.from({ length: rows }, (_, rowIndex) => (
        <section key={rowIndex} style={{ marginBottom: 32 }}>
          <div style={{ margin: "0 0 12px 40px" }}>
            <Shimmer width={160} height={20} />
          </div>
          <div style={{ display: "flex", gap: 16, padding: "0 40px", overflow: "hidden" }}>
            {Array.from({ length: cardsPerRow }, (_, cardIndex) => (
              <div key={cardIndex} style={{ flex: "0 0 auto", width: cardWidth }}>
                <Shimmer height="auto" borderRadius={12} style={{ width: cardWidth, aspectRatio }} />
                <div style={{ marginTop: 8 }}>
                  <Shimmer width="80%" height={14} />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
