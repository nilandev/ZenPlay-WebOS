import { Focusable, LiftSurface, SECTION_ICONS, TV_TEXT, URLImage, useIsFocused } from "@ui";
import { X } from "lucide-react";

/** Red ✕ shown on every card while a list is in edit (remove) mode — My List and Recently Watched. */
export function RemoveBadge(): JSX.Element {
  return (
    <span
      aria-label="Remove"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "2.5rem",
        height: "2.5rem",
        borderRadius: 999,
        background: "#e0332f",
        color: "#fff",
        boxShadow: "0 0.25rem 0.75rem rgba(0,0,0,0.5)",
      }}
    >
      <X size="1.5rem" strokeWidth={3} />
    </span>
  );
}

/** A channel in a list: a wide tile with its logo and name (and an optional line under it), lifting on focus like every other card. */
export function ChannelTile({
  id,
  title,
  subtitle,
  imageUrl,
  seed,
  isEditing,
  onSelect,
}: {
  id: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  seed: string;
  isEditing: boolean;
  onSelect: () => void;
}): JSX.Element {
  const isFocused = useIsFocused(id);
  return (
    <Focusable id={id}>
      <LiftSurface
        isFocused={isFocused}
        radius="1rem"
        width="24rem"
        role="button"
        tabIndex={-1}
        onClick={onSelect}
        faceStyle={{
          aspectRatio: "16 / 9",
          display: "flex",
          flexDirection: "column",
          background: isFocused ? "linear-gradient(160deg, #3a3d48 0%, #262830 100%)" : "linear-gradient(160deg, #23252d 0%, #17181d 100%)",
        }}
      >
        <div style={{ flex: 1, minHeight: 0, padding: "1.25rem 2.5rem 0.5rem" }}>
          <URLImage src={imageUrl} alt="" seed={seed} objectFit="contain" placeholderIcon={SECTION_ICONS.live} />
        </div>
        <div style={{ padding: subtitle ? "0 1.25rem 0.25rem" : "0 1.25rem 1rem", fontSize: TV_TEXT, fontWeight: 700, color: "#fff", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ padding: "0 1.25rem 0.875rem", fontSize: "1.0625rem", color: "rgba(255,255,255,0.65)", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {subtitle}
          </div>
        )}
        {isEditing && (
          <div style={{ position: "absolute", top: "0.75rem", right: "0.75rem" }}>
            <RemoveBadge />
          </div>
        )}
      </LiftSurface>
    </Focusable>
  );
}
