import { Shimmer } from "../Shimmer.js";

/**
 * Mirrors Hero's layout (full-bleed backdrop block, title, subtitle, two
 * pill buttons) — same shimmer-block approach as ShelfRowSkeleton, shown
 * while home-curation.ts's first pass is still resolving (Continue
 * Watching/EPG/catalog reads) so the hero area never renders as a blank
 * gap before the real hero or its fallback banner takes over.
 */
export function HeroSkeleton(): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        // Matches Hero.tsx's own minHeight floor — see its comment on why
        // 0 lets a column flex container with overflow-y: auto shrink this
        // indefinitely instead of ever actually scrolling.
        minHeight: "20rem",
        marginBottom: "1.5rem",
        borderRadius: "1.75rem",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <Shimmer width="100%" height="100%" borderRadius={0} style={{ position: "absolute", inset: 0 }} />
      <div style={{ position: "absolute", left: "2.5rem", bottom: "2rem", display: "flex", flexDirection: "column", gap: "0.75rem", maxWidth: "50%" }}>
        <Shimmer width={320} height={36} borderRadius={8} />
        <Shimmer width={200} height={18} borderRadius={6} />
        <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
          <Shimmer width={120} height={44} borderRadius={999} />
          <Shimmer width={120} height={44} borderRadius={999} />
        </div>
      </div>
    </div>
  );
}
