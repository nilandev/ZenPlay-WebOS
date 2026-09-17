# Phase 2 — Multi-platform expansion (planned, not active)

Phase 1 (current, see [PLAN.md](./PLAN.md)) targets **LG webOS TV only**.
Everything below was the original multi-platform vision for this project —
Android TV, Samsung Tizen, mobile, and desktop — deliberately deferred so
Phase 1 can ship a single, well-tested platform first instead of spreading
effort thin across four. This doc preserves that plan so it can be picked
up later without re-deriving the architecture from scratch.

The core packages (`packages/core`, `packages/player`, `packages/ui`) were
built platform-agnostic from the start specifically so this expansion is
additive — a new `apps/<platform>` shell, not a rewrite of business logic.

## Why webOS first

Concentrating on one platform means: one real device class to test
against, one set of remote-input/WebKit quirks to chase down, and a
shippable, polished v1 instead of four half-finished ports. Everything in
`packages/core`/`packages/player`/`packages/ui` remains reusable when this
phase resumes.

## Target platforms (deferred)

| Platform | Approach | Notes |
|---|---|---|
| Android TV / Google TV | Capacitor Android build + custom ExoPlayer plugin | Also installable on Nvidia Shield, Sony/TCL/Hisense Android TVs. Needs the `LEANBACK_LAUNCHER` intent category and a network security config permitting cleartext (HTTP) traffic — most Xtream/M3U providers aren't HTTPS. Both of these were previously implemented and committed, then removed when this project pivoted to webOS-only; recoverable from git history (search for "Android TV" in the commit log) if this phase resumes. |
| Samsung Tizen | Native Tizen app (Tizen Studio, `.wgt` package) wrapping the same web bundle | Tizen's WebKit version varies significantly by TV model year — pin a conservative JS/CSS baseline (avoid bleeding-edge ES features without polyfill). Tizen remotes report different nonstandard keyCodes than webOS (see `packages/core/src/input/keymap.ts`'s git history for the previously-implemented `resolveTizenKey` — also removed in the webOS pivot, also recoverable). |
| Mobile (Android/iOS) | Capacitor mobile build of a new `apps/mobile` (touch-oriented layout variant) | Reuses `packages/core` and `packages/player` entirely; UI swaps spatial-nav for touch gestures — the focus-store's `select()`/`move()` model would need a touch-friendly parallel path, or `packages/ui` components would need touch event handlers alongside their existing focus-store wiring. |
| Desktop (Win/Mac) | Electron build of a new `apps/desktop` | Mostly for convenience/dev-testing and power users; lowest priority polish-wise. Keyboard input already works today via the `"web"` platform fallback in `resolveRemoteAction` — an Electron shell is mostly packaging, not new input handling. |

## Architectural notes for resuming this phase

- **`PlatformId`** in `packages/core/src/input/keymap.ts` is currently
  `"webos" | "web"`. Re-adding a platform means adding its id back to the
  union, writing a `resolve<Platform>Key` function for its nonstandard
  keyCodes (back button, channel up/down, color keys — whatever that
  platform's remote sends outside standard `KeyboardEvent.key` values),
  and wiring it into `resolveRemoteAction`'s switch.
- **`detectPlatform()`** in each app shell's `src/platform.ts` checks for
  a platform-specific global (`window.webOS`, `window.tizen`,
  Capacitor's `window.Capacitor`, etc.) — this pattern extends
  straightforwardly per new shell.
- **Native playback bridge**: only Android TV was ever expected to need
  one (a custom Capacitor plugin wrapping ExoPlayer/Media3, for
  hardware-accelerated decode and wider raw-MPEG-TS/codec support than
  Chromium's `<video>` guarantees). webOS, Tizen, and Electron/desktop all
  ship Chromium- or WebKit-based `<video>` + MSE that's normally
  sufficient with `packages/player`'s existing `HlsPlayerEngine` — only
  reach for a native bridge if real-device testing surfaces a specific
  gap.
- **Persistence**: Phase 1 uses `localStorage`/`sessionStorage`
  (`apps/webos/src/*-store.ts`, `content-cache.ts`). Before or during a
  true multi-platform phase, this should move to IndexedDB (via `idb` or
  Dexie.js) — it works identically across every target's WebKit/Chromium
  runtime and handles larger EPG datasets more gracefully than
  synchronous `sessionStorage`.
- **UI adaptation for touch (mobile) and mouse (desktop)**: the entire UI
  in `packages/ui` is built around the spatial-navigation focus store
  (`packages/ui/src/focus/focus-store.ts`) as the source of truth for
  "what's focused," with components reading `focusedId` for their visual
  state. Touch/mouse-primary platforms would layer `onClick`/gesture
  handlers alongside this rather than replacing it — every component
  already has a working `onClick` path (see the EPG programme-cell fix in
  project history) precisely so pointer and D-pad input can coexist.

## Re-adding a platform shell (rough checklist)

1. Scaffold `apps/<platform>` alongside `apps/webos` — same Vite/React
   setup, importing `@iptv/core`, `@iptv/player`, `@iptv/ui`.
2. Add the platform's id to `PlatformId` and a `resolve<Platform>Key`
   function in `packages/core/src/input/keymap.ts`.
3. Write `apps/<platform>/src/platform.ts`'s `detectPlatform()`.
4. Add the platform-specific packaging layer (Capacitor config +
   generated native project for Android TV/mobile; Tizen Studio project
   for Tizen; Electron main process for desktop).
5. Re-verify the "every interactive element reachable via D-pad, not just
   pointer" invariant on that platform's actual remote/input method.
6. Write a `docs/<platform>.md` mirroring `docs/webos.md`'s structure
   (one-time setup, build/package/install/launch, remote input specifics,
   version-targeting floor).
