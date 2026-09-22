export interface LiveTvLogoProps {
  size?: "sidebar" | "large";
}

const RED = "#e0332f";

/**
 * "LIVE TV" wordmark badge: a red-outlined box with "LIVE" in red text and a
 * solid red "TV" block with white text, matching the brand reference image
 * supplied for the Live TV sidebar header — recreated in CSS rather than as
 * an image asset so it scales cleanly at any size/DPI.
 */
export function LiveTvLogo({ size = "sidebar" }: LiveTvLogoProps): JSX.Element {
  const isLarge = size === "large";
  const height = isLarge ? 40 : 28;
  const fontSize = isLarge ? 20 : 14;
  const paddingX = isLarge ? 14 : 10;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "stretch",
        height,
        borderRadius: isLarge ? 8 : 6,
        border: `2px solid ${RED}`,
        overflow: "hidden",
        background: "#fff",
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          padding: `0 ${paddingX}px`,
          fontSize,
          fontWeight: 800,
          fontStyle: "italic",
          letterSpacing: "0.02em",
          color: RED,
        }}
      >
        LIVE
      </span>
      <span
        style={{
          display: "flex",
          alignItems: "center",
          padding: `0 ${paddingX}px`,
          fontSize,
          fontWeight: 800,
          fontStyle: "italic",
          letterSpacing: "0.02em",
          color: "#fff",
          background: RED,
        }}
      >
        TV
      </span>
    </div>
  );
}
