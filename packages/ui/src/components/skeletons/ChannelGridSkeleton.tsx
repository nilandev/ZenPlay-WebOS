import { Shimmer } from "../Shimmer.js";

export interface ChannelGridSkeletonProps {
  columns?: number;
  rows?: number;
}

/** Mirrors ChannelGrid's tile layout so the shimmer-to-content swap doesn't jump. */
export function ChannelGridSkeleton({ columns = 5, rows = 3 }: ChannelGridSkeletonProps): JSX.Element {
  const count = columns * rows;
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 8, padding: 16 }}>
      {Array.from({ length: count }, (_, i) => (
        <Shimmer key={i} height={88} borderRadius={8} />
      ))}
    </div>
  );
}
