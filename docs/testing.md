# Testing this project

## 1. Unit tests (fast, run constantly)

```bash
pnpm test          # all packages
pnpm --filter @iptv/core test     # M3U/XMLTV/Xtream parsers
pnpm --filter @iptv/player test   # channel preloader
pnpm --filter @iptv/ui test       # focus graph + focus store
```

Currently covers: M3U parsing edge cases (CRLF, missing attributes, malformed
directives), XMLTV timestamp/entity parsing, Xtream API response mapping and
auth-failure handling, spatial-navigation grid graph construction (including
ragged rows and edge-of-grid behavior), and focus store transitions.

Also run before trusting any change:

```bash
pnpm typecheck     # tsc --noEmit across all packages
pnpm build         # must succeed in dependency order: core → player → ui → apps/tv
```

`packages/ui` depends on the compiled `dist/` output of `core` and `player`
(not their source), so after editing core/player, rebuild them before
typechecking/running ui or apps/tv — `pnpm build` at the repo root does this
in the correct order automatically.

## 2. Browser dev testing (fastest feedback for UI/focus/playback logic)

```bash
pnpm --filter @iptv/tv dev
```

Open `http://localhost:5173` in a desktop browser. You can fully exercise:

- Add-source form → Xtream login or M3U URL import
- Channel grid rendering, virtualization (try a playlist with 500+ channels)
- **Arrow-key navigation** — this is the D-pad emulation; the focus store
  reacts to plain `ArrowUp/Down/Left/Right` + `Enter`/`Escape` in a browser
  exactly as it would to a remote's D-pad, since `resolveRemoteAction`
  falls back to standard `KeyboardEvent.key` values on the "web" platform.
- Playback via hls.js against a real HLS test stream, e.g.:
  `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`
- Channel-switch responsiveness (the preloader warms the highlighted channel
  ~250ms after you stop moving — watch Network tab for the prefetch request)

To test against a real Xtream Codes provider or M3U playlist, use your own
credentials/URL in the Add Source screen — never commit real provider
credentials to the repo.

To sanity-check webOS/Tizen-specific input handling without the actual SDKs,
temporarily hardcode `detectPlatform()` in `apps/tv/src/platform.ts` to
return `"tizen"` or `"webos"` and confirm `resolveRemoteAction` in
`packages/core/src/input/keymap.ts` still resolves arrow keys correctly
(it falls through to `resolveStandardKey` for anything not in the
platform-specific keyCode table).

## 3. Android TV testing

See [android-tv.md](./android-tv.md) for the one-time Android Studio +
Capacitor setup. Once running on an emulator or real device:

- Confirm the app appears on the **Android TV home screen's app row**
  (requires the `LEANBACK_LAUNCHER` manifest intent — see the doc), not just
  in the phone-style app drawer.
- Navigate the entire UI using only the emulator's **D-pad control**
  (Android Studio's emulator toolbar has a D-pad view) or a real remote —
  never the mouse. This is the actual test of the spatial-navigation layer;
  mouse/touch interaction hides D-pad-only bugs.
- Test channel switching latency on a real (not emulated) Android TV device
  if possible — emulator GPU/network characteristics don't reflect a $30
  Android TV stick's actual constraints.
- Watch for WebView console errors via `chrome://inspect` (Chrome desktop
  connected to the same network/USB) — Capacitor's WebView is inspectable
  this way.

## 4. webOS / Tizen testing (once those platform shells are scaffolded)

Not yet implemented in this repo (`platform/webos`, `platform/tizen` are
placeholders). When scaffolding them:

- LG provides the free **webOS TV Simulator** (part of the webOS TV SDK) for
  initial iteration, but performance characteristics diverge from real
  hardware — validate on an actual LG TV (Developer Mode app) before
  considering a feature done.
- Samsung's **Tizen Studio** includes a TV emulator profile; same caveat
  applies — validate on a real Samsung TV via Samsung's Developer Mode.
- Both platforms' WebKit versions vary significantly by TV model year.
  Test on the oldest TV model year you intend to support, not just the
  newest simulator image.

## 5. Regression checklist before calling a feature "done"

- [ ] Unit tests pass (`pnpm test`)
- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Production build succeeds (`pnpm build`)
- [ ] Feature works via keyboard-only navigation in the browser dev server
- [ ] Feature works via D-pad-only navigation on an Android TV emulator/device
- [ ] No new console errors/warnings in the WebView (`chrome://inspect`)
- [ ] Tested against at least one real IPTV stream, not just a mocked one
