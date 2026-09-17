# Running on Android TV (Capacitor)

`apps/tv/android/` is a committed native Android Studio project (Capacitor's
generated wrapper around the web app), with two manifest customizations
already baked in — see "What's already customized" below. This machine has
Java but no Android SDK, so building/running it needs a machine with Android
Studio installed.

## Building and running

1. Install [Android Studio](https://developer.android.com/studio), open it once so it
   installs the SDK, then create/start an Android TV emulator via
   **Device Manager → Create Device → TV category** (e.g. "Android TV (1080p)").
2. From `apps/tv/`:
   ```bash
   pnpm build
   npx cap sync android
   ```
   `sync` copies the freshly built `dist/` into the native project and updates
   Capacitor's own config/plugin files — it does **not** touch
   `AndroidManifest.xml` or anything else hand-edited, so this is safe to run
   after every web-side change.
3. Open `apps/tv/android/` in Android Studio, or run directly:
   ```bash
   npx cap run android
   ```
   Select the Android TV emulator (or a real device with USB debugging enabled,
   e.g. an Nvidia Shield or a TCL/Sony Android TV in Developer Mode) as the target.

## What's already customized (and why)

`apps/tv/android/app/src/main/AndroidManifest.xml` has two changes beyond
Capacitor's defaults, both required for the app to actually work as an
Android TV IPTV player rather than just build:

**Leanback launcher** — `MainActivity`'s intent filter includes
`android.intent.category.LEANBACK_LAUNCHER`, and `android.software.leanback`
is declared as an optional feature, so the app appears on the Android TV
home screen's app row instead of only in a phone-style app drawer.

**Cleartext (HTTP) traffic allowed** — since Android 9 (API 28), apps block
plain HTTP network requests by default. Xtream Codes panels and self-hosted
M3U/XMLTV hosts are overwhelmingly plain `http://`, not `https://` — without
this, **every** screen fails to load with no content, because every request
the app makes (Xtream API, M3U playlist, XMLTV EPG) gets silently blocked at
the OS level before it ever reaches the app's code. `capacitor.config.ts`'s
`android.allowMixedContent` does **not** cover this — that setting only
affects mixed content *within* an already-loaded HTTPS page, not the
WebView's own outbound requests. The fix is
`apps/tv/android/app/src/main/res/xml/network_security_config.xml`
(cleartext permitted for all domains — not an allowlist, since the user
adds arbitrary provider URLs at runtime with no fixed domain set to know
ahead of time; the same approach IPTV Smarters/TiviMate use), referenced
from the manifest via `android:networkSecurityConfig` and
`android:usesCleartextTraffic="true"`.

If the `android/` project is ever regenerated from scratch (`rm -rf android
&& npx cap add android`), both of these are lost and must be reapplied —
`npx cap sync` alone never touches them, so this should only come up if
someone deliberately deletes and recreates the native project.

## Native ExoPlayer bridge (later milestone)

The plan calls for a custom Capacitor plugin wrapping ExoPlayer/Media3 for
hardware-accelerated decode and better raw-MPEG-TS compatibility than
Chromium's `<video>` element. Until that plugin exists, `apps/tv` runs on the
`HlsPlayerEngine` (hls.js inside the WebView) everywhere, including Android TV —
functionally correct, but revisit this once real-device testing shows
performance or compatibility gaps.
