import { useEffect } from "react";
import { resolveRemoteAction, type PlatformId } from "@iptv/core";
import { useFocusStore } from "./focus-store.js";

export interface RemoteInputHandlers {
  onSelect?: (focusedId: string | null) => void;
  onBack?: () => void;
  onPlayPause?: () => void;
  onChannelUp?: () => void;
  onChannelDown?: () => void;
}

/**
 * Wires document-level keydown events to the focus store's move()/focus
 * actions plus screen-provided handlers for select/back/media keys.
 * Owns focus entirely in JS state rather than relying on native DOM
 * focus/:focus-visible, since Tizen/webOS WebKit builds behave
 * inconsistently there (see packages/core input/keymap.ts).
 */
export function useRemoteInput(platform: PlatformId, handlers: RemoteInputHandlers = {}): void {
  const move = useFocusStore((state) => state.move);
  const select = useFocusStore((state) => state.select);
  const focusedId = useFocusStore((state) => state.focusedId);

  useEffect(() => {
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
          // Per-node onSelect (e.g. TopNav tabs) fires first; screens that
          // instead inspect focusedId themselves (e.g. VodScreen) still work
          // via the onSelect handler below.
          select();
          handlers.onSelect?.(focusedId);
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
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [platform, move, select, focusedId, handlers]);
}
