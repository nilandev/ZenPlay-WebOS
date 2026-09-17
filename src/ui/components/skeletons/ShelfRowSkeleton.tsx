import { Shimmer } from "../Shimmer.js";

export interface ShelfRowSkeletonProps {
  rows?: number;
  cardsPerRow?: number;
  cardWidth?: number;
  aspectRatio?: string;
}

/** Mirrors Shelf/FocusCard's layout (title + horizontal poster row) for Movies/Series loading states. */
export function ShelfRowSkeleton({ rows = 2, cardsPerRow = 6, cardWidth = 220, aspectRatio = "2 / 3" }: ShelfRowSkeletonProps): JSX.Element {
  return (
    <div style={{ paddingTop: 24 }}>
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
