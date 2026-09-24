export type RemoteAction =
  | "up"
  | "down"
  | "left"
  | "right"
  | "select"
  | "back"
  | "play-pause"
  | "play"
  | "pause"
  | "stop"
  | "rewind"
  | "fast-forward"
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
 *
 * The webOS back-key check runs regardless of `platform`, not just when
 * `platform === "webos"`. `platform` comes from detecting `window.webOS`
 * (see src/platform.ts), which is not reliably present in the webOS TV
 * Simulator — confirmed via on-device logging that the Simulator delivers a
 * real `keyCode 461` "GoBack" event while `detectPlatform()` still reports
 * "web", so gating on `platform` silently dropped Back. A keyCode/key of
 * 461/"GoBack" never occurs on a real keyboard, so checking it
 * unconditionally is safe. See conversation history ("back buttons are not
 * working in all pages").
 */
export function resolveRemoteAction(platform: PlatformId, event: KeyboardEvent): RemoteAction {
  const webOsBack = resolveWebOsBackKey(event);
  if (webOsBack === "back") return webOsBack;
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
    case "MediaPlay":
      return "play";
    case "MediaPause":
      return "pause";
    case "MediaStop":
      return "stop";
    case "MediaRewind":
      return "rewind";
    case "MediaFastForward":
      return "fast-forward";
    case "ChannelUp":
    case "PageUp": // LG remotes report CH+ as PageUp (keyCode 33)
      return "channel-up";
    case "ChannelDown":
    case "PageDown": // …and CH− as PageDown (keyCode 34)
      return "channel-down";
    default:
      return "unknown";
  }
}

// webOS Magic Remote back key reports keyCode 461 (LG's nonstandard code,
// documented at https://webostv.developer.lge.com/develop/guides/back-button)
// — arrow keys, Enter, and media keys already come through with standard
// KeyboardEvent.key values on webOS's Chromium-based runtime, so only back
// needs special-casing here.
//
// keyCode is a deprecated DOM property; LG's own docs rely on it for this
// exact purpose, but it's been unreliable in the wild on some webOS
// firmware/remote combinations (reported as 0 or a different value instead
// of 461). event.key/event.code are checked as a second, independent
// signal so a firmware quirk in one doesn't leave the back button
// completely dead — see conversation history ("back buttons are not
// working in all pages").
const WEBOS_BACK_KEYCODE = 461;
const WEBOS_BACK_KEY_VALUES = new Set(["GoBack", "BrowserBack"]);
const WEBOS_BACK_CODE_VALUES = new Set(["GoBack", "BrowserBack"]);

/** Platform-independent: a keyCode/key of 461/"GoBack" only ever comes from a webOS remote. */
function resolveWebOsBackKey(event: KeyboardEvent): RemoteAction {
  if (event.keyCode === WEBOS_BACK_KEYCODE) return "back";
  if (WEBOS_BACK_KEY_VALUES.has(event.key)) return "back";
  if (WEBOS_BACK_CODE_VALUES.has(event.code)) return "back";
  return "unknown";
}

/**
 * LG remote media keys by keyCode — some webOS firmware reports these with
 * an empty or "Unidentified" event.key, so the code is the reliable signal.
 * https://webostv.developer.lge.com/develop/guides/magic-remote
 */
const WEBOS_MEDIA_KEYCODES: Record<number, RemoteAction> = {
  33: "channel-up",
  34: "channel-down",
  415: "play",
  19: "pause",
  413: "stop",
  412: "rewind",
  417: "fast-forward",
};

function resolveWebOsKey(event: KeyboardEvent): RemoteAction {
  if (resolveWebOsBackKey(event) === "back") return "back";
  const standard = resolveStandardKey(event);
  if (standard !== "unknown") return standard;
  return WEBOS_MEDIA_KEYCODES[event.keyCode] ?? "unknown";
}

/** The number a digit key stands for (top-row or keypad digits, by key or keyCode), or null for any other key — for tuning channels by number. */
export function resolveDigitKey(event: KeyboardEvent): number | null {
  if (/^[0-9]$/.test(event.key)) return Number(event.key);
  if (event.keyCode >= 48 && event.keyCode <= 57) return event.keyCode - 48;
  if (event.keyCode >= 96 && event.keyCode <= 105) return event.keyCode - 96;
  return null;
}
