import { Pencil, Plus } from "lucide-react";
import { Focusable } from "../focus/Focusable.js";
import { useIsFocused } from "../focus/focus-store.js";
import { TV_HEADING } from "../tv-metrics.js";

/** Avatar diameter on the profile picker / Manage Profiles grids. */
export const PROFILE_TILE_SIZE = "11rem";

export interface ProfileAvatarTileProps {
  id: string;
  label: string;
  onSelect: () => void;
  avatarUrl?: string;
  /** "add" draws the dashed "+" circle; "edit" adds a pencil badge (Manage Profiles). */
  variant?: "profile" | "add" | "edit";
}

/**
 * A large round profile avatar with its name below — tvOS-style: focus lifts
 * the avatar with a white ring and brightens the name. Only transform and
 * box-shadow change, so focus moves stay cheap on TV hardware.
 */
export function ProfileAvatarTile({ id, label, onSelect, avatarUrl, variant = "profile" }: ProfileAvatarTileProps): JSX.Element {
  const isFocused = useIsFocused(id);
  const isAdd = variant === "add";

  return (
    <Focusable id={id} style={{ width: PROFILE_TILE_SIZE, height: "auto" }}>
      <button
        type="button"
        onClick={onSelect}
        style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1.25rem", width: "100%", padding: 0, background: "transparent", border: "none" }}
      >
        <span
          style={{
            position: "relative",
            display: "block",
            width: PROFILE_TILE_SIZE,
            height: PROFILE_TILE_SIZE,
            transform: isFocused ? "scale(1.12)" : "scale(1)",
            transition: "transform 200ms cubic-bezier(0.2, 0.9, 0.3, 1)",
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              height: "100%",
              borderRadius: "50%",
              overflow: "hidden",
              background: isAdd ? (isFocused ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.06)") : "rgba(255,255,255,0.08)",
              border: isAdd ? "0.1875rem dashed rgba(255,255,255,0.35)" : "none",
              boxSizing: "border-box",
              boxShadow: isFocused ? "0 0 0 0.3125rem #ffffff, 0 1.5rem 3rem -0.75rem rgba(0,0,0,0.7)" : "0 0.75rem 1.5rem -0.75rem rgba(0,0,0,0.5)",
            }}
          >
            {isAdd ? (
              <Plus size="4rem" strokeWidth={1.75} color={isFocused ? "#fff" : "rgba(255,255,255,0.7)"} />
            ) : (
              <img src={avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            )}
          </span>
          {variant === "edit" && (
            <span
              style={{
                position: "absolute",
                right: "0.25rem",
                bottom: "0.25rem",
                width: "3rem",
                height: "3rem",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: isFocused ? "#ffffff" : "rgba(20,21,27,0.92)",
                boxShadow: "0 0.5rem 1rem rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.15)",
              }}
            >
              <Pencil size="1.375rem" strokeWidth={2.25} color={isFocused ? "#0b0c10" : "#fff"} />
            </span>
          )}
        </span>
        <span
          style={{
            maxWidth: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: TV_HEADING,
            fontWeight: isFocused ? 700 : 500,
            color: isFocused ? "#fff" : "var(--text-dim)",
          }}
        >
          {label}
        </span>
      </button>
    </Focusable>
  );
}
