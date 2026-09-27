import { Search } from "lucide-react";
import { Focusable } from "../focus/Focusable.js";
import { useIsFocused } from "../focus/focus-store.js";

export interface SearchButtonProps {
  /** Focus id — the owner wires it into its focus graph with `onSelect` as the node's onSelect. */
  id: string;
  onSelect: () => void;
}

/**
 * Opens the global Search screen. A button, not a text field: search always
 * covers the whole playlist, so it lives on its own screen rather than in a
 * header next to a category it doesn't filter. Styled like Home's playlist
 * chip, so the two sit together in Home's top bar and match the browse
 * screens' headers.
 */
export function SearchButton({ id, onSelect }: SearchButtonProps): JSX.Element {
  const isFocused = useIsFocused(id);
  return (
    <Focusable id={id} style={{ width: "auto", height: "auto" }}>
      <button
        type="button"
        onClick={onSelect}
        tabIndex={-1}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          border: "none",
          borderRadius: 999,
          background: isFocused
            ? "linear-gradient(160deg, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0.17) 100%)"
            : "linear-gradient(160deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.035) 100%)",
          boxShadow: isFocused
            ? "inset 0 1px 0 rgba(255,255,255,0.35), inset 0 0 0 1px rgba(255,255,255,0.14), 0 1rem 2rem -0.5rem rgba(0,0,0,0.6)"
            : "inset 0 1px 0 rgba(255,255,255,0.12), inset 0 0 0 1px rgba(255,255,255,0.06)",
          color: isFocused ? "#ffffff" : "rgba(235,236,242,0.85)",
          padding: "1.125rem 1.5rem",
          transform: isFocused ? "scale(1.08)" : "scale(1)",
          transition: "transform 300ms cubic-bezier(0.2, 0.9, 0.3, 1)",
          cursor: "pointer",
        }}
      >
        <Search size="1.75rem" style={{ flexShrink: 0 }} />
        <span style={{ fontSize: "1.375rem", fontWeight: 600, whiteSpace: "nowrap" }}>Search</span>
      </button>
    </Focusable>
  );
}
