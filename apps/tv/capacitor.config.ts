import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "dev.nilan.freeiptvplayer",
  appName: "Free IPTV Player",
  webDir: "dist",
  android: {
    // Android TV launches via a LEANBACK_LAUNCHER intent, added to
    // AndroidManifest.xml after `npx cap add android` (see docs/android-tv.md).
    allowMixedContent: true,
  },
};

export default config;
