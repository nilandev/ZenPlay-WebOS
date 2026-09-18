export interface PlaceholderScreenProps {
  title: string;
  icon: string;
}

/** Stand-in for a screen that isn't built yet, so a Home tile has somewhere to go without misrepresenting a real feature. */
export function PlaceholderScreen({ title, icon }: PlaceholderScreenProps): JSX.Element {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        color: "var(--text-dim)",
      }}
    >
      <span style={{ fontSize: 56 }}>{icon}</span>
      <h1 style={{ fontSize: 24, color: "var(--text)" }}>{title}</h1>
      <p>Coming soon.</p>
    </div>
  );
}
