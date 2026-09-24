import { buildGridFocusGraph, BROWSE_SIDE_PADDING, PROFILE_TILE_SIZE, TV_TEXT, type FocusNode } from "@ui";

/** Most tiles per row before the profile grid wraps (fits 1080p with room for the focus lift). */
const MAX_COLUMNS = 6;

export function profileGridColumns(tileCount: number): number {
  return Math.max(1, Math.min(tileCount, MAX_COLUMNS));
}

/**
 * Focus graph for a profile grid with one button centred below it: the
 * tiles form a grid, Down from the bottom row reaches the button, and Up
 * from the button returns to the start of the bottom row.
 */
export function buildProfileGridGraph(tileIds: string[], onSelectTile: (id: string) => void, button: { id: string; onSelect: () => void }): FocusNode[] {
  const columns = profileGridColumns(tileIds.length);
  const lastRowStart = Math.floor(Math.max(0, tileIds.length - 1) / columns) * columns;
  const tiles: FocusNode[] = buildGridFocusGraph(tileIds, columns).map((node) => ({
    ...node,
    neighbors: { ...node.neighbors, down: node.neighbors.down ?? button.id },
    onSelect: () => onSelectTile(node.id),
  }));
  return [...tiles, { id: button.id, neighbors: { up: tileIds[lastRowStart] }, onSelect: button.onSelect }];
}

/** Shared page for "Who's watching?" and Manage Profiles: big centred title, the avatar grid, one action below. */
export function ProfileGridLayout({
  title,
  subtitle,
  tileCount,
  children,
  action,
}: {
  title: string;
  subtitle: string;
  tileCount: number;
  children: React.ReactNode;
  action: React.ReactNode;
}): JSX.Element {
  return (
    <div
      style={{
        minHeight: "100vh",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: `4rem ${BROWSE_SIDE_PADDING}`,
      }}
    >
      <h1 style={{ fontSize: "3.5rem", fontWeight: 800, color: "#fff", margin: 0 }}>{title}</h1>
      <p style={{ fontSize: TV_TEXT, color: "var(--text-dim)", margin: "0.75rem 0 4rem" }}>{subtitle}</p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${profileGridColumns(tileCount)}, ${PROFILE_TILE_SIZE})`,
          columnGap: "3.5rem",
          rowGap: "3rem",
          marginBottom: "4.5rem",
        }}
      >
        {children}
      </div>
      {action}
    </div>
  );
}
