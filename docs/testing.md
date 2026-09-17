# Testing this project

## 1. Unit tests (fast, run constantly)

```bash
pnpm test          # everything, single vitest run
```

Currently covers: M3U parsing edge cases (CRLF, missing attributes, malformed
directives), XMLTV timestamp/entity parsing, now/next EPG lookups, PIN
hashing/verification, Xtream API response mapping and auth-failure handling,
spatial-navigation grid/shelf graph construction (including ragged rows,
edge-of-grid behavior, and multi-shelf column clamping), focus-store scope
composition (chrome vs. content scopes coexisting, per-node `onSelect`
dispatch), the Live TV overlay's 2-row sliding window, and the content
cache's sessionStorage round-tripping (including Date revival and graceful
fallback when sessionStorage throws on quota). Run a subset with vitest's
own filtering, e.g. `pnpm test -- epg` or `pnpm test -- src/ui`.

Also run before trusting any change:

```bash
pnpm typecheck     # tsc --noEmit
pnpm build         # vite build, then copies webos-meta/ into dist/
```

This is a single flat package — `src/core`, `src/player`, `src/ui`, and the
app itself (`src/screens/`, `src/App.tsx`, etc.) all typecheck and build
together in one pass, no dependency-ordered multi-package build needed.

## 2. Browser dev testing (fastest feedback for UI/focus/playback logic)

```bash
pnpm dev
```

Open `http://localhost:5173` in a desktop browser. You can fully exercise:

- Add-source form → Xtream login or M3U URL import
- Channel grid rendering, virtualization (try a playlist with 500+ channels)
- **Arrow-key navigation** — this is the D-pad emulation; the focus store
  reacts to plain `ArrowUp/Down/Left/Right` + `Enter`/`Escape` in a browser
  exactly as it would to webOS's Magic Remote, since `resolveRemoteAction`
  falls back to standard `KeyboardEvent.key` values on the `"web"` platform.
- Playback via hls.js against a real HLS test stream, e.g.:
  `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`
- Channel-switch responsiveness (the preloader warms the highlighted channel
  ~250ms after you stop moving — watch Network tab for the prefetch request)
- **Live TV overlay** — the video should fill the entire screen, with a
  translucent "liquid glass" channel strip overlaid on the bottom third
  (`src/ui/components/GlassPanel.tsx` + `LiveOverlayGrid.tsx`),
  showing only 2 rows at a time. Arrow keys move between cards; pressing
  down past the bottom visible row should slide both rows down by one
  (and back up in reverse) rather than scrolling the whole page. Selecting
  a channel or waiting 30 seconds with no arrow-key activity should dismiss
  the panel down to just the video; any arrow key press afterward brings it
  back. Back/Escape while the panel is visible dismisses it first; pressing
  Back again with the panel already hidden exits the channel (clears
  `activeChannel`).
- **Profile picker** — create a profile, confirm it persists across a page
  reload (`localStorage`), and that "Switch profile" from Settings returns
  to the picker without losing the configured playlist source.
- **Top nav ↔ content focus handoff** — arrow up from the top row of a
  content screen should not currently move focus into the tab bar (up/down
  is scoped to content-only for now); left/right across the tab bar and
  pressing select on a tab should switch screens. This is the one place to
  watch closely since chrome and content are separate focus-store scopes
  (see `src/ui/focus/focus-store.ts`) — confirm switching screens
  doesn't leave two content scopes registered at once (no stray focusable
  elements from the previous screen still reachable via arrow keys).
- **Movies/Series shelves** — confirm the blurred backdrop crossfades as you
  move focus between cards, and that up/down between shelves of different
  lengths lands on a sensible column (not out of bounds).
- **EPG guide** — arrow keys move between programme cells (focused cell
  should visibly scale/highlight — if focus looks like it's "not moving,"
  check that `GuideScreen` still calls `useRemoteInput`; that hook is what
  wires arrow keys to `move()` at all, and its earlier absence was the root
  cause of the guide being unnavigable). Press left from the leftmost
  column to jump into the category sidebar, and right from the sidebar to
  jump back into the grid at the first channel's first programme. Press
  channel-up/down (`ChannelUp`/`ChannelDown` keys if your keyboard/browser
  sends them, otherwise test this one on-device) to page the 3-hour time
  window forward and back. Confirm the right-side preview panel updates as
  focus moves — title, time range, description, channel logo — and that
  selecting a live (currently-airing) programme tunes the channel while a
  past programme on a catch-up-enabled channel plays the timeshift URL.
- **Parental controls** — in Settings, set a PIN and lock a live category,
  then confirm selecting a channel in that category from the Live TV screen
  prompts for the PIN before playing, and that entering it once unlocks the
  category for the rest of the session.
- **Loading shimmer + cache** — on a hard reload (or first visit to a tab
  this session), Live TV/Guide/Movies/Series should show a skeleton shimmer
  matching that screen's real layout (`ChannelGridSkeleton`,
  `EpgGridSkeleton`, `ShelfRowSkeleton` — see `src/ui/components/skeletons/`)
  instead of an empty screen, until the first load completes. Switch tabs
  away and back, or reload the page: content should now appear **instantly**
  with no shimmer, since `src/use-cached-content.ts` served it
  from cache while a fresh copy loads silently in the background — open
  DevTools → Application → Session Storage and look for `iptv.cache.v1:*`
  keys to confirm what's cached. If a screen looks stuck on the shimmer
  forever, check the console for a load error first (the cache only masks
  *slow* loads, not failed ones — `error` is still surfaced separately).

To test against a real Xtream Codes provider or M3U playlist, use your own
credentials/URL in the Add Source screen — never commit real provider
credentials to the repo.

**CORS in the browser dev server**: your Xtream/M3U/XMLTV provider almost
certainly doesn't send `Access-Control-Allow-Origin`, so a plain browser tab
blocks `fetch()` calls to it as cross-origin — you'll see a same-origin
policy error in the console. This is normal for a provider you don't
control and can't be fixed from the app's code. `vite-dev-proxy.ts`
adds a `/__iptv-proxy?url=...` dev-server route (wired into
`vite.config.ts`) that fetches server-side (Node has no CORS) and streams
the response back same-origin; `src/proxy-fetch.ts` routes
`content-loader.ts`'s and `XtreamClient`'s requests through it automatically
whenever `import.meta.env.DEV` is true. It's inert in production builds —
the webOS TV runtime doesn't run through Vite's dev server, so there's
nothing to proxy there and the dev-only code is dropped by the production
bundler (verify with `grep -c "__iptv-proxy" dist/assets/*.js`
after `pnpm build` — should be 0). If you add a new raw `fetch()` call
against a provider URL anywhere in `src/`, route it through
`proxyFetch` the same way, or it'll work on-device but fail in the browser
dev server.

## 3. webOS TV testing

See [webos.md](./webos.md) for the full one-time setup (ares-cli, device
registration) and the build → package → install → launch workflow. Once
running on an actual LG TV or the webOS TV Simulator:

- Navigate the entire UI using only **D-pad/remote input** (the Simulator's
  window can be D-pad-driven with arrow keys) — never the mouse. This is
  the actual test of the spatial-navigation layer; pointer interaction
  hides D-pad-only bugs. webOS remotes support both a pointer mode and a
  5-way (D-pad) mode — confirm every interactive element works in 5-way
  mode specifically.
- Confirm the back key (`keyCode` 461) does the expected thing at each
  screen level: dismiss the Live TV overlay first, then exit the channel;
  back out of a series' episode list to the series shelf; etc.
- Check the Live TV overlay's `backdrop-filter` blur actually renders
  (rather than showing as a flat, unblurred panel) and doesn't visibly
  drop frames while scrolling/focus-moving — LG TV GPUs have historically
  had inconsistent backdrop-filter support/performance; see docs/webos.md's
  fallback note if it looks wrong.
- Test channel-switching latency and stream compatibility on a **real TV**,
  not just the Simulator — its performance and WebKit behavior diverge
  from actual hardware.
- Use `ares-inspect` (`pnpm inspect-device <name>`) to open remote
  DevTools and watch for console errors during normal use.

## 4. Regression checklist before calling a feature "done"

- [ ] Unit tests pass (`pnpm test`)
- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Production build succeeds (`pnpm build`)
- [ ] Feature works via keyboard-only navigation in the browser dev server
- [ ] Feature works via D-pad-only navigation on a real LG TV (or at minimum the webOS TV Simulator)
- [ ] No new console errors/warnings (`ares-inspect`)
- [ ] Tested against at least one real IPTV stream, not just a mocked one
