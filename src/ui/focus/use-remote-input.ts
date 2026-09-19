import { useEffect, useRef } from "react";
import { resolveRemoteAction, type PlatformId } from "@core";
import { useFocusStore } from "./focus-store.js";

/** Holding Select this long counts as a long-press instead of a tap — see onLongSelect below. */
const LONG_PRESS_MS = 500;

export interface RemoteInputHandlers {
  onSelect?: (focusedId: string | null) => void;
  /** Fired instead of onSelect when Select is held for LONG_PRESS_MS — e.g. toggling a favourite without hijacking a second focus node per card (see conversation history). */
  onLongSelect?: (focusedId: string | null) => void;
  onBack?: () => void;
  onPlayPause?: () => void;
  onChannelUp?: () => void;
  onChannelDown?: () => void;
}

/**
 * Wires document-level keydown/keyup events to the focus store's move()
 * action plus screen-provided handlers for select/back/media keys. Owns
 * focus entirely in JS state rather than relying on native DOM
 * focus/:focus-visible, since webOS TV's WebKit builds behave
 * inconsistently there (see src/core/input/keymap.ts).
 *
 * Select is resolved on keyup rather than keydown (unlike every other
 * action here) specifically to support onLongSelect: a keydown-started
 * timer fires onLongSelect if Select is still held after LONG_PRESS_MS,
 * and keyup only fires the normal tap-select path if that timer never
 * went off. Browsers/TVs auto-repeat keydown while a key is held (each
 * repeat has event.repeat === true), so the timer is only armed on the
 * initial, non-repeat keydown.
 */
export function useRemoteInput(platform: PlatformId, handlers: RemoteInputHandlers = {}): void {
  const move = useFocusStore((state) => state.move);
  const select = useFocusStore((state) => state.select);
  const focusedId = useFocusStore((state) => state.focusedId);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);

  useEffect(() => {
    function clearLongPressTimer(): void {
      if (longPressTimerRef.current !== null) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }

    function onKeyDown(event: KeyboardEvent): void {
      const action = resolveRemoteAction(platform, event);

      switch (action) {
        case "up":
        case "down":
        case "left":
        case "right":
          event.preventDefault();
          move(action);
          break;
        case "select":
          event.preventDefault();
          if (event.repeat) return; // auto-repeat while held — the timer below already covers "held"
          longPressFiredRef.current = false;
          if (handlers.onLongSelect) {
            clearLongPressTimer();
            longPressTimerRef.current = setTimeout(() => {
              longPressFiredRef.current = true;
              handlers.onLongSelect?.(focusedId);
            }, LONG_PRESS_MS);
          }
          break;
        case "back":
          event.preventDefault();
          handlers.onBack?.();
          break;
        case "play-pause":
          handlers.onPlayPause?.();
          break;
        case "channel-up":
          handlers.onChannelUp?.();
          break;
        case "channel-down":
          handlers.onChannelDown?.();
          break;
        case "unknown":
          break;
      }
    }

    function onKeyUp(event: KeyboardEvent): void {
      if (resolveRemoteAction(platform, event) !== "select") return;
      clearLongPressTimer();
      if (longPressFiredRef.current) return; // onLongSelect already fired — don't also fire the tap action
      // Per-node onSelect (e.g. TopNav tabs) fires first; screens that
      // instead inspect focusedId themselves (e.g. VodScreen) still work
      // via the onSelect handler below.
      select();
      handlers.onSelect?.(focusedId);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      clearLongPressTimer();
    };
  }, [platform, move, select, focusedId, handlers]);
}
