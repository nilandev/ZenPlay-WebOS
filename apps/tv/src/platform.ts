import type { PlatformId } from "@iptv/core";

/**
 * Detects which shell the web bundle is currently running inside.
 * Capacitor injects window.Capacitor; webOS/Tizen expose their own globals.
 * Falls back to "web" for plain browser/dev usage.
 */
export function detectPlatform(): PlatformId {
  if (typeof window === "undefined") return "web";
  const w = window as unknown as { webOS?: unknown; tizen?: unknown; Capacitor?: { getPlatform?: () => string } };

  if (w.webOS) return "webos";
  if (w.tizen) return "tizen";
  if (w.Capacitor?.getPlatform) {
    return w.Capacitor.getPlatform() === "android" ? "android-tv" : "web";
  }
  return "web";
}
