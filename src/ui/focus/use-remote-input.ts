import { useEffect, useRef } from "react";
import { resolveRemoteAction, type PlatformId } from "@core";
import { useFocusStore, type FocusDirection } from "./focus-store.js";
import { playUiSound } from "../ui-sounds.js";

/** Holding Select this long counts as a long-press instead of a tap — see onLongSelect below. */
const LONG_PRESS_MS = 500;

export interface RemoteInputHandlers {
  onSelect?: (focusedId: string | null) => void;
  /** Fired instead of onSelect when Select is held for LONG_PRESS_MS — e.g. toggling a favourite without hijacking a second focus node per card (see conversation history). */
  onLongSelect?: (focusedId: string | null) => void;
  onBack?: () => void;
  onPlayPause?: () => void;
  /** Dedicated Play / Pause keys — fall back to onPlayPause when a screen only handles the toggle. */
  onPlay?: () => void;
  onPause?: () => void;
  onStop?: () => void;
  /** Rewind / Fast-forward keys; event.repeat is true while the key is held. */
  onRewind?: (isRepeat: boolean) => void;
  onFastForward?: (isRepeat: boolean) => void;
  onChannelUp?: () => void;
  onChannelDown?: () => void;
  onMute?: () => void;
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
 *
 * Auto-repeat arrow presses (holding a D-pad direction) are capped at one
 * focus move per animation frame: a TV remote repeats every ~30-50ms, faster
 * than a weak TV CPU can render a focus change, so uncapped repeats queue
 * up and focus keeps sliding after the button is released. A first
 * (non-repeat) press always moves immediately.
 *
 * The listeners are registered once per platform/enabled change — the
 * current focusedId and handlers are read at event time (store getState() /
 * a ref) instead of being effect dependencies, which previously tore down
 * and re-added both document listeners on every render of the owning
 * screen, i.e. on every focus move.
 */
export function useRemoteInput(platform: PlatformId, handlers: RemoteInputHandlers = {}, enabled = true): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);

  useEffect(() => {
    // A screen underneath a fullscreen overlay (PlayerScreen) stays mounted
    // the whole time playback is open — without this, both the overlay's
    // and this screen's own document-level keydown listener would fire on
    // the same Back press, so e.g. closing the player would *also*
    // immediately navigate the screen underneath away. Callers pass
    // `enabled={!isPlaybackOpen}` so only the overlay's own useRemoteInput
    // call is live while it's covering the screen.
    if (!enabled) return;

    let repeatFrame = 0;
    let queuedRepeatMove: FocusDirection | null = null;

    function flushRepeatMove(): void {
      repeatFrame = 0;
      if (queuedRepeatMove === null) return;
      const direction = queuedRepeatMove;
      queuedRepeatMove = null;
      useFocusStore.getState().move(direction);
    }

    function clearLongPressTimer(): void {
      if (longPressTimerRef.current !== null) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }

    // A native <input>/<textarea> holding real DOM focus (e.g. a search box
    // — see SeriesScreen's search field) needs its own arrow
    // keys/Enter for text-cursor movement and form submission, not the
    // spatial focus graph's move()/select(). Only Back is still let through
    // globally, as the way to leave the field (its own onKeyDown, if any,
    // can still stop propagation before this document-level listener runs).
    function isTypingIntoTextField(): boolean {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement)) return false;
      return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
    }

    function onKeyDown(event: KeyboardEvent): void {
      const action = resolveRemoteAction(platform, event);

      if (isTypingIntoTextField() && (action !== "back" || event.key === "Backspace")) return; // Backspace deletes a character, it doesn't go back

      const currentHandlers = handlersRef.current;

      switch (action) {
        case "up":
        case "down":
        case "left":
        case "right":
          event.preventDefault();
          if (!event.repeat) {
            // A deliberate press always lands immediately and supersedes
            // anything still queued from a previous hold.
            queuedRepeatMove = null;
            useFocusStore.getState().move(action);
            break;
          }
          if (repeatFrame !== 0) {
            // Already moved once this frame — keep only the latest direction.
            queuedRepeatMove = action;
            break;
          }
          useFocusStore.getState().move(action);
          repeatFrame = requestAnimationFrame(flushRepeatMove);
          break;
        case "select":
          event.preventDefault();
          if (event.repeat) return; // auto-repeat while held — the timer below already covers "held"
          longPressFiredRef.current = false;
          if (currentHandlers.onLongSelect) {
            const focusedAtPress = useFocusStore.getState().focusedId;
            clearLongPressTimer();
            longPressTimerRef.current = setTimeout(() => {
              longPressFiredRef.current = true;
              playUiSound("select");
              handlersRef.current.onLongSelect?.(focusedAtPress);
            }, LONG_PRESS_MS);
          }
          break;
        case "back":
          event.preventDefault();
          // Holding Back would otherwise walk up several levels at once (and
          // on Home, close the app) — one press is one step back.
          if (event.repeat) break;
          if (currentHandlers.onBack) {
            playUiSound("back");
            currentHandlers.onBack();
          }
          break;
        case "play-pause":
          currentHandlers.onPlayPause?.();
          break;
        case "play":
          event.preventDefault();
          (currentHandlers.onPlay ?? currentHandlers.onPlayPause)?.();
          break;
        case "pause":
          event.preventDefault();
          (currentHandlers.onPause ?? currentHandlers.onPlayPause)?.();
          break;
        case "stop":
          event.preventDefault();
          currentHandlers.onStop?.();
          break;
        case "rewind":
          event.preventDefault();
          currentHandlers.onRewind?.(event.repeat);
          break;
        case "fast-forward":
          event.preventDefault();
          currentHandlers.onFastForward?.(event.repeat);
          break;
        case "channel-up":
          currentHandlers.onChannelUp?.();
          break;
        case "channel-down":
          currentHandlers.onChannelDown?.();
          break;
        case "mute":
          if (!currentHandlers.onMute) break; // unhandled: leave it to the TV's own volume
          event.preventDefault();
          currentHandlers.onMute();
          break;
        case "unknown":
          break;
      }
    }

    function onKeyUp(event: KeyboardEvent): void {
      if (resolveRemoteAction(platform, event) !== "select") return;
      if (isTypingIntoTextField()) return;
      clearLongPressTimer();
      if (longPressFiredRef.current) return; // onLongSelect already fired — don't also fire the tap action
      // Captured before select() runs, since a per-node onSelect may itself
      // move focus — the screen-level handler should see what was selected.
      const { focusedId, select } = useFocusStore.getState();
      if (focusedId !== null) playUiSound("select");
      // Per-node onSelect (e.g. TopNav tabs) fires first; screens that
      // instead inspect focusedId themselves (e.g. VodScreen) still work
      // via the onSelect handler below.
      select();
      handlersRef.current.onSelect?.(focusedId);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      if (repeatFrame !== 0) cancelAnimationFrame(repeatFrame);
      clearLongPressTimer();
    };
  }, [platform, enabled]);
}
