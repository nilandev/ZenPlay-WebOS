import type { PlatformId } from "@iptv/core";

/**
 * Detects whether the app is running inside the real webOS TV runtime
 * (which injects a global `webOS` object) or a plain browser during local
 * dev (`vite dev`, or the webOS TV Simulator's own Chromium shell, which
 * also exposes `webOS` since it's just LG's actual runtime).
 */
export function detectPlatform(): PlatformId {
  if (typeof window === "undefined") return "web";
  const w = window as unknown as { webOS?: unknown };
  return w.webOS ? "webos" : "web";
}
