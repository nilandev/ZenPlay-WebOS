import type { CSSProperties, ReactNode } from "react";
import { Focusable } from "../focus/Focusable.js";
import { useFocusStore } from "../focus/focus-store.js";

export interface FocusCardProps {
  id: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  width?: number;
  aspectRatio?: string;
  onSelect?: () => void;
  badge?: ReactNode;
}

/**
 * Apple TV-style poster/tile card: scales up and lifts with a glow ring on
 * focus (driven by the focus store, not native :focus), animated purely via
 * CSS transform/box-shadow so it stays GPU-composited on weak TV hardware —
 * see PLAN.md "Performance principles".
 */
export function FocusCard({
  id,
  title,
  subtitle,
  imageUrl,
  width = 220,
  aspectRatio = "2 / 3",
  onSelect,
  badge,
}: FocusCardProps): JSX.Element {
  const isFocused = useFocusStore((state) => state.focusedId === id);

  const style: CSSProperties = {
    width,
    transform: isFocused ? "scale(1.08) translateY(-4px)" : "scale(1)",
    transition: "transform 160ms ease-out, box-shadow 160ms ease-out",
    boxShadow: isFocused
      ? "0 12px 28px rgba(0,0,0,0.55), 0 0 0 3px rgba(255,255,255,0.9)"
      : "0 4px 10px rgba(0,0,0,0.35)",
    borderRadius: 12,
    overflow: "hidden",
    cursor: "pointer",
    background: "#1c1c22",
    willChange: "transform",
  };

  return (
    <Focusable id={id} className="focus-card">
      <div style={style} onClick={onSelect} role="button" tabIndex={-1}>
        <div style={{ position: "relative", width: "100%", aspectRatio }}>
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              loading="lazy"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#8b8b93",
                fontSize: 13,
                textAlign: "center",
                padding: 8,
              }}
            >
              {title}
            </div>
          )}
          {badge && <div style={{ position: "absolute", top: 8, right: 8 }}>{badge}</div>}
        </div>
        <div style={{ padding: "8px 10px" }}>
          <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {title}
          </div>
          {subtitle && <div style={{ fontSize: 12, color: "#a0a0a8" }}>{subtitle}</div>}
        </div>
      </div>
    </Focusable>
  );
}
