import { Heart } from "lucide-react";

export interface FavoriteHeartProps {
  isFavorite: boolean;
  size?: number;
}

/**
 * Visual-only favourited indicator — no onClick of its own. Favouriting is
 * triggered by long-pressing Select on the card itself (see
 * useRemoteInput's onLongSelect), not by a separately focusable heart, so
 * every grid's existing one-focus-node-per-item wiring (ChannelGrid,
 * LiveOverlayGrid, Shelf+FocusCard) needs no restructuring — see
 * conversation history.
 */
export function FavoriteHeart({ isFavorite, size = 16 }: FavoriteHeartProps): JSX.Element | null {
  if (!isFavorite) return null;

  return (
    <div
      aria-hidden
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size + 12,
        height: size + 12,
        borderRadius: "50%",
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
    >
      <Heart size={size} strokeWidth={2} color="#ff6b6b" fill="#ff6b6b" />
    </div>
  );
}
