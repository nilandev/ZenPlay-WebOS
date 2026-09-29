import { useState } from "react";
import { resolveRemoteAction, type PlatformId } from "@core";
import { Focusable } from "../focus/Focusable.js";
import { useFocusStore, useIsFocused } from "../focus/focus-store.js";
import { swallowNextKeyUp } from "../focus/swallow-key-up.js";
import { TV_TEXT } from "../tv-metrics.js";

export interface TvTextFieldProps {
  /** Focus id — the owner wires it into its focus graph with `onSelect: () => focusTvTextField(id)`. */
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  platform: PlatformId;
  placeholder?: string;
  type?: "text" | "password";
}

/** Hands DOM focus to a TvTextField's input, which opens the TV's on-screen keyboard. */
export function focusTvTextField(id: string): void {
  document.querySelector<HTMLInputElement>(`input[data-tv-field="${id}"]`)?.focus();
}

/**
 * A labelled text field for the remote. The Focusable is a proxy around a
 * native input: D-pad focus lands on the field (white ring, "Press OK to
 * type"), and OK — via the owner's graph node calling focusTvTextField —
 * gives the input DOM focus so the platform keyboard opens (accent ring).
 * While typing, the document-level remote handler steps aside and this
 * input's own key handler takes over: OK or Up/Down leave the field and
 * move focus on, Back only closes the keyboard (not the screen), and
 * Backspace just deletes.
 */
export function TvTextField({ id, label, value, onChange, platform, placeholder, type = "text" }: TvTextFieldProps): JSX.Element {
  const isFocused = useIsFocused(id);
  const [isEditing, setIsEditing] = useState(false);
  const ring = isEditing ? "var(--accent)" : isFocused ? "#ffffff" : "transparent";

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Backspace") return; // deletes a character (the web keymap otherwise reads it as Back)
    const action = resolveRemoteAction(platform, event.nativeEvent);
    if (action === "back") {
      event.preventDefault();
      event.stopPropagation(); // close the keyboard, stay on the form
      event.currentTarget.blur();
      return;
    }
    if (action === "select" || action === "down" || action === "up") {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.blur();
      if (action === "select") swallowNextKeyUp();
      useFocusStore.getState().move(action === "up" ? "up" : "down");
    }
  }

  return (
    <Focusable id={id} style={{ height: "auto" }}>
      <label style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
        <span style={{ fontSize: TV_TEXT, fontWeight: 600, color: isFocused ? "#fff" : "var(--text-dim)" }}>{label}</span>
        <span
          style={{ position: "relative", display: "block", borderRadius: "0.875rem", boxShadow: `0 0 0 3px ${ring}`, transition: "box-shadow 160ms ease-out" }}
        >
          <input
            data-tv-field={id}
            type={type}
            value={value}
            placeholder={placeholder}
            autoCapitalize="off"
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => {
              useFocusStore.getState().focus(id);
              setIsEditing(true);
            }}
            onBlur={() => setIsEditing(false)}
            onKeyDown={handleKeyDown}
            style={{
              width: "100%",
              boxSizing: "border-box",
              fontSize: "1.5rem",
              padding: isFocused ? "1rem 13rem 1rem 1.25rem" : "1rem 1.25rem",
              borderRadius: "0.875rem",
              border: "none",
              background: "rgba(255,255,255,0.08)",
              color: "#fff",
              boxShadow: "none",
              outline: "none",
            }}
          />
          {/* The hint sits inside the field, next to where the eye already is. */}
          {isFocused && (
            <span
              aria-hidden
              style={{
                position: "absolute",
                right: "1.25rem",
                top: "50%",
                transform: "translateY(-50%)",
                fontSize: "1.125rem",
                fontWeight: 500,
                color: "var(--text-dim)",
                pointerEvents: "none",
              }}
            >
              {isEditing ? "OK when done" : "Press OK to type"}
            </span>
          )}
        </span>
      </label>
    </Focusable>
  );
}
