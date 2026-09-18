import type { PlatformId } from "@core";
import { useRemoteInput } from "@ui";

export interface PlaceholderScreenProps {
  title: string;
  icon: string;
  platform: PlatformId;
  onBack: () => void;
}

/** Stand-in for a screen that isn't built yet, so a Home tile has somewhere to go without misrepresenting a real feature. */
export function PlaceholderScreen({ title, icon, platform, onBack }: PlaceholderScreenProps): JSX.Element {
  useRemoteInput(platform, { onBack });

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
