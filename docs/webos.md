# Building and running on LG webOS TV

`apps/webos` is a Vite/React app packaged as a native webOS TV web app per
LG's official conventions (webostv.developer.lge.com). This doc covers the
one-time toolchain setup and the day-to-day build → package → install →
launch workflow.

## One-time setup

1. Install the [webOS TV CLI](https://webostv.developer.lge.com/develop/tools/cli-installation)
   (`ares-*` commands) and/or [webOS Studio](https://webostv.developer.lge.com/develop/tools/webos-studio-installation)
   (a VS Code extension that wraps the same CLI).
2. Optionally install the [webOS TV Simulator](https://webostv.developer.lge.com/develop/tools/simulator-installation)
   for iteration without real hardware — but validate on a real LG TV before
   considering a feature done; the Simulator's performance/WebKit behavior
   diverges from actual TV hardware.
3. Put your TV in **Developer Mode** (install the "Developer Mode" app from
   the LG Content Store, sign in, enable Dev Mode, note the IP address shown)
   or note the Simulator's connection details.
4. Register the device with the CLI:
   ```bash
   ares-setup-device --add myTV --info "host=<TV_IP>" --info "port=9922" --info "username=prisoner"
   ares-setup-device --list   # confirm it's registered
   ```
   (Port 9922 / user `prisoner` are the TV's defaults; the Simulator uses
   port 6622 / user `developer`.)

## Build, package, install, launch

These scripts work identically from the repo root or from `apps/webos/`
(the root `package.json` just forwards to `@iptv/webos`'s own scripts).
The device name is a **plain trailing argument**, not a flag — e.g.
`pnpm launch-device myTV`, not `--device=myTV` (npm/pnpm don't reliably
forward `--flag=value` config through nested `--filter` invocations, so
these scripts take positional args instead):

```bash
pnpm build                 # vite build, then copies webos-meta/ (appinfo.json + icons) into dist/
pnpm package                # ares-package dist -o webos-dist  →  produces an .ipk
pnpm install-device myTV    # finds the .ipk in webos-dist/, runs ares-install --device myTV <ipk>
pnpm launch-device myTV     # ares-launch com.nilandev.freeiptvplayer --device myTV
```

For fast iteration without packaging/installing every time, launch the
built `dist/` directly in "hosted" mode:

```bash
pnpm launch-hosted myTV
```

### Using the webOS TV Simulator specifically

The Simulator app's own drag-and-drop / "Install App" UI does **not**
unpack `.ipk` files — it expects the **unpacked app directory**, i.e.
`apps/webos/dist/` (which has `appinfo.json`, `index.html`, and the icons
directly at its root after `pnpm build`), not `apps/webos/webos-dist/`
(which only ever contains the packaged `.ipk`). Pointing the Simulator's
install UI at `webos-dist/` produces exactly the error
`Can not found 'appinfo.json' in .../webos-dist` — there's no bug in the
package itself, the Simulator is just looking in the wrong directory for
raw app files it doesn't unpack.

Two ways to run this app in the Simulator:

1. **Drag-and-drop `dist/`** (after running `pnpm build`, not `pnpm package`)
   directly onto the Simulator window, or use its "Install App" menu
   pointed at `apps/webos/dist/`.
2. **Treat the Simulator as a registered device** and use the normal
   `ares-cli` flow instead — register it once
   (`ares-setup-device --add mySimulator --info "host=127.0.0.1" --info "port=6622" --info "username=developer"`),
   then `pnpm install-device mySimulator` / `pnpm launch-device mySimulator`
   work exactly like they would against a real TV, and this path does use
   the `.ipk` correctly (`ares-install` unpacks it for you).

To inspect the running app (remote DevTools):

```bash
pnpm inspect-device myTV
```

## Project layout

- `apps/webos/src/` — the React app (screens, focus wiring, playback).
- `apps/webos/webos-meta/` — `appinfo.json` plus `icon.png` (80×80),
  `largeIcon.png` (130×130), and `splash.png` (1920×1080). These are
  **not** part of the Vite source bundle; `pnpm build` copies them into
  `dist/` after the Vite build finishes (see
  `apps/webos/scripts/copy-webos-meta.mjs`), since `ares-package` expects
  `appinfo.json` to sit alongside the built `index.html` at the root of
  the packaged directory — not nested under `src/` or `assets/`.
- `apps/webos/dist/` — build output, gitignored. This is what gets packaged.
- `apps/webos/webos-dist/` — the packaged `.ipk` output, gitignored.

The current icon/splash assets are auto-generated placeholders (dark
background, accent-colored wordmark) — replace
`apps/webos/webos-meta/{icon,largeIcon,splash}.png` with real artwork
before shipping.

## appinfo.json notes

- `id` (`com.nilandev.freeiptvplayer`) is the app's reverse-DNS identifier;
  change this if you fork the project, since it's what uniquely identifies
  the installed app on a TV.
- `requiredACG: []` is set explicitly (empty Access Control Group list) —
  this app makes no Luna Service Bus calls, only standard web APIs
  (`fetch`, `crypto.subtle`, DOM/keyboard events), so it needs no elevated
  permissions. `ares-package` warns if this field is missing entirely.
- `disableBackHistoryAPI: true` — the app manages the back key itself via
  `resolveRemoteAction`/`useRemoteInput` (see `packages/core/src/input/keymap.ts`
  and `packages/ui/src/focus/use-remote-input.ts`), rather than relying on
  the platform's default browser-history-based back behavior.

## Remote control input

webOS TV remotes deliver D-pad/Enter/media keys as standard
`KeyboardEvent` values (arrows, `Enter`) with one nonstandard exception:
the **back key reports `keyCode` 461**, which is handled in
`packages/core/src/input/keymap.ts`'s `resolveWebOsKey`. No special
manifest permission is needed to receive key events — they arrive as
ordinary DOM `keydown` events.

webOS remotes have two input modes: **Pointer mode** (cursor visible,
mouse-like clicks) and **5-way mode** (D-pad + Enter, cursor hidden,
switches in automatically on the first arrow-key press). Every interactive
element in this app must be reachable via 5-way/D-pad navigation, not just
pointer clicks — this is why the whole UI is built on the spatial-navigation
focus system in `packages/ui/src/focus/` rather than relying on hover/click
alone.

## Supported webOS TV versions

Targeting **webOS TV 6.0+** (2021 and newer LG TVs, Chromium 79+) as the
floor — this covers `fetch`, `crypto.subtle` (Web Crypto), ES2020 syntax,
and Flexbox/Grid without polyfills or transpilation workarounds.
`apps/webos/vite.config.ts` sets `build.target: "chrome79"` to match.
webOS TV 5.x and earlier (older Chromium, or pre-Blink WebKit on 1.x/2.x)
are not supported.

One specific thing to verify on real hardware: the "liquid glass" Live TV
overlay (`packages/ui/src/components/GlassPanel.tsx`) uses
`backdrop-filter: blur()`. This is supported from Chromium 76+ in
principle, but LG TV GPUs have historically had inconsistent
performance/rendering with backdrop-filter — if it looks wrong or tanks
performance on a real TV, the panel's solid gradient `background` is
already a reasonable fallback (drop the blur, keep the tinted background).

## Native player note

Unlike the earlier Android TV plan (which called for a native ExoPlayer
bridge), webOS TV's own Chromium-based `<video>` + MSE is already
hardware-accelerated, so `packages/player`'s `HlsPlayerEngine` (hls.js on
top of `<video>`) is expected to be sufficient without a native playback
bridge. Revisit only if real-device testing surfaces codec/DRM gaps that
hls.js + `<video>` can't cover.
