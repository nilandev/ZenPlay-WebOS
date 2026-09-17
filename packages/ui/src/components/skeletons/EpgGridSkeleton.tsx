import { Shimmer } from "../Shimmer.js";

export interface EpgGridSkeletonProps {
  rows?: number;
}

/** Mirrors EpgGrid's channel-column + timeline-row layout for the guide's loading state. */
export function EpgGridSkeleton({ rows = 8 }: EpgGridSkeletonProps): JSX.Element {
  return (
    <div style={{ display: "flex", height: "100%" }}>
      <div style={{ width: 220, flexShrink: 0, borderRight: "1px solid var(--border, #313139)" }}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} style={{ height: 72, display: "flex", alignItems: "center", padding: "0 14px", gap: 10 }}>
            <Shimmer width={28} height={28} borderRadius={6} />
            <Shimmer width={100} height={13} />
          </div>
        ))}
      </div>
      <div style={{ flex: 1, padding: "0 16px" }}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} style={{ height: 72, display: "flex", alignItems: "center", gap: 8 }}>
            <Shimmer width={`${30 + ((i * 13) % 40)}%`} height={48} borderRadius={6} />
            <Shimmer width={`${15 + ((i * 7) % 25)}%`} height={48} borderRadius={6} />
            <Shimmer width={`${20 + ((i * 11) % 30)}%`} height={48} borderRadius={6} />
          </div>
        ))}
      </div>
    </div>
  );
}
