import { useEffect, useRef } from "react";
import { Delete, Space, X } from "lucide-react";
import { Focusable } from "../focus/Focusable.js";
import { useFocusStore, useIsFocused, type FocusNode } from "../focus/focus-store.js";

const SCOPE = "search-keyboard";
const COLUMNS = 6;
const CHARACTERS = "abcdefghijklmnopqrstuvwxyz0123456789".split("");
const ACTIONS = ["space", "delete", "clear"] as const;
type KeyboardAction = (typeof ACTIONS)[number];

/** Focus id of a key: a character (`"a"`, `"7"`) or one of the bottom-row actions. */
export function searchKeyId(key: string): string {
  return `kb:${key}`;
}

export interface SearchKeyboardProps {
  onInput: (character: string) => void;
  onDelete: () => void;
  onClear: () => void;
  /** Where Right goes from the keyboard's right edge — the first result, when there is one. */
  rightExitId?: string;
}

/**
 * On-screen A–Z/0–9 keyboard for the Search screen — six keys a row, then
 * Space, Delete and Clear, each two columns wide. Used instead of the TV's
 * own on-screen keyboard, which covers half the screen and hides the results
 * that update as the user types.
 */
export function SearchKeyboard({ onInput, onDelete, onClear, rightExitId }: SearchKeyboardProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const handlersRef = useRef({ onInput, onDelete, onClear });
  handlersRef.current = { onInput, onDelete, onClear };

  useEffect(() => {
    setGraph(SCOPE, buildKeyboardGraph(handlersRef, rightExitId), undefined, { passive: true });
  }, [setGraph, rightExitId]);
  useEffect(() => () => clearGraph(SCOPE), [clearGraph]);

  return (
    <div role="group" aria-label="Keyboard" style={{ display: "grid", gridTemplateColumns: `repeat(${COLUMNS}, 1fr)`, gap: "0.5rem" }}>
      {CHARACTERS.map((character) => (
        <Key key={character} id={searchKeyId(character)} label={character.toUpperCase()} onSelect={() => onInput(character)} />
      ))}
      <Key id={searchKeyId("space")} label="Space" icon={<Space size="1.5rem" />} span={2} onSelect={() => onInput(" ")} />
      <Key id={searchKeyId("delete")} label="Delete" icon={<Delete size="1.5rem" />} span={2} onSelect={onDelete} />
      <Key id={searchKeyId("clear")} label="Clear" icon={<X size="1.5rem" />} span={2} onSelect={onClear} />
    </div>
  );
}

function buildKeyboardGraph(
  handlersRef: React.MutableRefObject<{ onInput: (character: string) => void; onDelete: () => void; onClear: () => void }>,
  rightExitId: string | undefined,
): FocusNode[] {
  const rows = Math.ceil(CHARACTERS.length / COLUMNS);
  const at = (row: number, column: number) => searchKeyId(CHARACTERS[row * COLUMNS + column]);
  const actionId = (column: number) => searchKeyId(ACTIONS[Math.floor(column / 2)]);

  const characterNodes: FocusNode[] = CHARACTERS.map((character, index) => {
    const row = Math.floor(index / COLUMNS);
    const column = index % COLUMNS;
    return {
      id: searchKeyId(character),
      neighbors: {
        up: row > 0 ? at(row - 1, column) : undefined,
        down: row < rows - 1 ? at(row + 1, column) : actionId(column),
        left: column > 0 ? at(row, column - 1) : undefined,
        right: column < COLUMNS - 1 ? at(row, column + 1) : rightExitId,
      },
      onSelect: () => handlersRef.current.onInput(character),
    };
  });

  const actionNodes: FocusNode[] = ACTIONS.map((action: KeyboardAction, index) => ({
    id: searchKeyId(action),
    neighbors: {
      up: at(rows - 1, index * 2),
      left: index > 0 ? searchKeyId(ACTIONS[index - 1]) : undefined,
      right: index < ACTIONS.length - 1 ? searchKeyId(ACTIONS[index + 1]) : rightExitId,
    },
    onSelect: () => {
      if (action === "space") handlersRef.current.onInput(" ");
      else if (action === "delete") handlersRef.current.onDelete();
      else handlersRef.current.onClear();
    },
  }));

  return [...characterNodes, ...actionNodes];
}

function Key({ id, label, icon, span = 1, onSelect }: { id: string; label: string; icon?: React.ReactNode; span?: number; onSelect: () => void }): JSX.Element {
  const isFocused = useIsFocused(id);
  return (
    <Focusable id={id} style={{ gridColumn: `span ${span}`, width: "auto", height: "auto" }}>
      <button
        type="button"
        tabIndex={-1}
        aria-label={label}
        onClick={onSelect}
        style={{
          width: "100%",
          height: "3.75rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.5rem",
          border: "none",
          borderRadius: "0.75rem",
          background: isFocused ? "#ffffff" : "rgba(255,255,255,0.08)",
          color: isFocused ? "#0b0c10" : "rgba(235,236,242,0.9)",
          fontSize: "1.5rem",
          fontWeight: 700,
          transform: isFocused ? "scale(1.06)" : "scale(1)",
          transition: "transform 160ms ease-out",
          cursor: "pointer",
        }}
      >
        {icon ?? label}
      </button>
    </Focusable>
  );
}
