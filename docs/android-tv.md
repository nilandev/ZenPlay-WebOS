# Running on Android TV (Capacitor)

This machine has Java but no Android SDK, so the native Android project
must be added and run from a machine with Android Studio installed
(this is a one-time setup per dev machine).

## One-time setup

1. Install [Android Studio](https://developer.android.com/studio), open it once so it
   installs the SDK, then create/start an Android TV emulator via
   **Device Manager → Create Device → TV category** (e.g. "Android TV (1080p)").
2. From `apps/tv/`:
   ```bash
   pnpm build
   npx cap add android
   npx cap sync android
   ```
   This generates `apps/tv/android/`, a full native Android Studio project wrapping
   the `dist/` web bundle.
3. Open `apps/tv/android/` in Android Studio, or run directly:
   ```bash
   npx cap run android
   ```
   Select the Android TV emulator (or a real device with USB debugging enabled,
   e.g. an Nvidia Shield or a TCL/Sony Android TV in Developer Mode) as the target.

## Making it launch like a TV app, not a phone app

After the first `npx cap add android`, edit
`apps/tv/android/app/src/main/AndroidManifest.xml` to add a leanback launcher
intent filter to the main activity, and declare `android.software.leanback`:

```xml
<application ... android:banner="@drawable/tv_banner">
  <activity android:name=".MainActivity" ...>
    <intent-filter>
      <action android:name="android.intent.action.MAIN" />
      <category android:name="android.intent.category.LAUNCHER" />
      <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
    </intent-filter>
  </activity>
</application>
<uses-feature android:name="android.software.leanback" android:required="false" />
<uses-feature android:name="android.hardware.touchscreen" android:required="false" />
```

Re-run `npx cap sync android` after web bundle changes; the manifest edit only
needs to be done once (Capacitor won't overwrite it on sync).

## Native ExoPlayer bridge (later milestone)

The plan calls for a custom Capacitor plugin wrapping ExoPlayer/Media3 for
hardware-accelerated decode and better raw-MPEG-TS compatibility than
Chromium's `<video>` element. Until that plugin exists, `apps/tv` runs on the
`HlsPlayerEngine` (hls.js inside the WebView) everywhere, including Android TV —
functionally correct, but revisit this once real-device testing shows
performance or compatibility gaps.
