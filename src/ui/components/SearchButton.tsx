import { Search } from "lucide-react";
import { HeaderButton } from "./HeaderButton.js";

export interface SearchButtonProps {
  /** Focus id — the owner wires it into its focus graph with `onSelect` as the node's onSelect. */
  id: string;
  onSelect: () => void;
}

/**
 * Opens the global Search screen. A button, not a text field: search always
 * covers the whole playlist, so it lives on its own screen rather than in a
 * header next to a category it doesn't filter.
 */
export function SearchButton({ id, onSelect }: SearchButtonProps): JSX.Element {
  return <HeaderButton id={id} label="Search" icon={Search} onSelect={onSelect} />;
}
