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

export type PlatformId = "android-tv" | "webos" | "tizen" | "web" | "desktop";

/**
 * webOS and Tizen remotes fire nonstandard keyCodes for back/channel/media
 * keys that never appear on a normal keyboard, so a single generic
 * KeyboardEvent handler cannot cover all three platforms. Each platform's
 * shell should call `resolveRemoteAction(platform, event)` instead of
 * inspecting event.key/keyCode directly.
 */
export function resolveRemoteAction(platform: PlatformId, event: KeyboardEvent): RemoteAction {
  switch (platform) {
    case "tizen":
      return resolveTizenKey(event);
    case "webos":
      return resolveWebOsKey(event);
    default:
      return resolveStandardKey(event);
  }
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

// Tizen TV remote keyCodes: https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/tvinputdevice-api.html
const TIZEN_BACK = 10009;
const TIZEN_CHANNEL_UP = 427;
const TIZEN_CHANNEL_DOWN = 428;
const TIZEN_PLAY_PAUSE = 10252;

function resolveTizenKey(event: KeyboardEvent): RemoteAction {
  switch (event.keyCode) {
    case TIZEN_BACK:
      return "back";
    case TIZEN_CHANNEL_UP:
      return "channel-up";
    case TIZEN_CHANNEL_DOWN:
      return "channel-down";
    case TIZEN_PLAY_PAUSE:
      return "play-pause";
    default:
      return resolveStandardKey(event);
  }
}

// webOS magic remote back key reports keyCode 461 (LG's nonstandard code).
const WEBOS_BACK = 461;

function resolveWebOsKey(event: KeyboardEvent): RemoteAction {
  switch (event.keyCode) {
    case WEBOS_BACK:
      return "back";
    default:
      return resolveStandardKey(event);
  }
}
