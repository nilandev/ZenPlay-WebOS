export type RemoteAction =
  | "up"
  | "down"
  | "left"
  | "right"
  | "select"
  | "back"
  | "play-pause"
  | "channel-up"
  | "channel-down"
  | "unknown";

export type PlatformId = "webos" | "web";

/**
 * webOS's Magic Remote fires nonstandard keyCodes for the back key (and
 * some media keys) that never appear on a normal keyboard, so a plain
 * KeyboardEvent.key handler alone doesn't cover it. The app shell should
 * call `resolveRemoteAction(platform, event)` instead of inspecting
 * event.key/keyCode directly.
 */
export function resolveRemoteAction(platform: PlatformId, event: KeyboardEvent): RemoteAction {
  return platform === "webos" ? resolveWebOsKey(event) : resolveStandardKey(event);
}

function resolveStandardKey(event: KeyboardEvent): RemoteAction {
  switch (event.key) {
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    case "Enter":
      return "select";
    case "Escape":
    case "Backspace":
      return "back";
    case "MediaPlayPause":
      return "play-pause";
    case "ChannelUp":
      return "channel-up";
    case "ChannelDown":
      return "channel-down";
    default:
      return "unknown";
  }
}

// webOS Magic Remote back key reports keyCode 461 (LG's nonstandard code) —
// arrow keys, Enter, and media keys already come through with standard
// KeyboardEvent.key values on webOS's Chromium-based runtime, so only back
// needs special-casing here.
const WEBOS_BACK = 461;

function resolveWebOsKey(event: KeyboardEvent): RemoteAction {
  if (event.keyCode === WEBOS_BACK) return "back";
  return resolveStandardKey(event);
}
