# Open Source IPTV Player — Architecture & Tech Plan (Phase 1: LG webOS)

Target: an open-source IPTV player competitive with IPTV Smarters Pro /
TiviMate / Bob Player, for **LG webOS TV only** in this phase. Android TV,
Samsung Tizen, mobile, and desktop are deliberately out of scope for now —
see [PHASE2.md](./PHASE2.md) for that plan, preserved for when this project
expands beyond webOS. Concentrating on one platform means one real device
class to test against and a shippable, polished v1 instead of four
half-finished ports.

## 1. High-level architecture

Layers stay separated so webOS-specific concerns never leak into business
logic — this also happens to be what makes Phase 2 an addition, not a
rewrite, if it resumes.

```
┌─────────────────────────────────────────┐
│  Platform Shell: LG webOS TV (apps/webos) │
├─────────────────────────────────────────┤
│  Shared App Core                          │
│  UI (React) · State · Xtream/M3U/EPG      │
│  parsing · Player abstraction ·           │
│  Focus/remote-control navigation          │
├─────────────────────────────────────────┤
│  Playback Engine (hls.js in-browser)      │
└─────────────────────────────────────────┘
```

Package layout (pnpm workspace monorepo):

- `packages/core` — Xtream Codes client, M3U parser, XMLTV/EPG parser, playlist/profile/favorites models, catch-up logic, remote-input keymap. Pure TypeScript, zero UI/DOM dependency, unit-testable in isolation.
- `packages/player` — playback abstraction wrapping hls.js, exposing a common interface (`load`, `play`, `seek`, `getTracks`, `setAudioTrack`, bitrate stats).
- `packages/ui` — React component library: channel grid, EPG timeline grid, D-pad/remote-focus system, video overlay controls, settings screens. Built TV-first (10-foot UI, large hit targets, spatial navigation).
- `apps/webos` — the webOS TV app: Vite/React source plus `webos-meta/` (appinfo.json + icons) and packaging scripts. See [docs/webos.md](./docs/webos.md) for the build/package/install/launch workflow.

## 2. UI framework

**React + TypeScript**, compiled via Vite, deployed as a webOS TV web app.

- **Zustand** for state management (the focus store, primarily) — minimal re-render overhead matters on TV-class CPUs.
- Plain inline styles / CSS variables (see `apps/webos/index.html`'s `:root` tokens) rather than a runtime-cost CSS framework — TV rendering is GPU/CPU constrained; every layout thrash matters.
- Virtualized/windowed lists where channel counts can be large (`ChannelGrid`, `LiveOverlayGrid`'s 2-row sliding window) — provider playlists can list thousands of channels.

## 3. Spatial navigation (D-pad/remote) — the make-or-break layer

This is the single biggest differentiator between a "snappy" TV app and a
sluggish one.

- A custom focus management layer (`packages/ui/src/focus/`) precomputes focus graphs per screen (grid of channels, EPG grid, settings list) rather than doing DOM-geometry lookups on every keypress. Named **scopes** (`packages/ui/src/focus/focus-store.ts`) let persistent chrome (top nav, category sidebar) and the active screen's content coexist without one clobbering the other's registered graph.
- Focus state is **synchronous and predictable**, owned entirely by the `useFocusStore` Zustand store — never relying on native DOM `:focus`/`scrollIntoView` behavior alone, since webOS's WebKit has historically been inconsistent there (see `Focusable.tsx`'s explicit `width/height: 100%` fix and its regression test).
- webOS's Magic Remote fires standard `KeyboardEvent` values for arrows/Enter/media keys, with one nonstandard exception: the back key reports `keyCode` 461. This is isolated in `packages/core/src/input/keymap.ts`'s `resolveWebOsKey`.
- Every interactive element must be reachable via 5-way/D-pad navigation, not just pointer clicks — webOS remotes support both a pointer mode and a 5-way mode, and LG's own guidance is that D-pad-only navigation must always work.

## 4. Playback engine

- **hls.js** for HLS streams, running inside the shared player abstraction (`packages/player`), tuned for real-world IPTV provider stream irregularities (non-compliant MPEG-TS, irregular segment timing) via `maxBufferLength`/retry config.
- webOS TV ships a Chromium-based WebKit runtime with native `<video>` + MSE that's normally hardware-accelerated already — hls.js on top is expected to be sufficient without a native playback bridge (unlike the Android TV plan in Phase 2, which called for a custom ExoPlayer bridge). Revisit only if real-device testing surfaces specific codec/DRM gaps.
- Channel preloading/prebuffering (`ChannelPreloader` in `packages/player`) warms the highlighted-but-not-yet-selected channel so committing to a channel change feels instant — the "zap-ahead" pattern from TiviMate.

## 5. Platform: LG webOS TV

See [docs/webos.md](./docs/webos.md) for the full setup and workflow.
Summary: `ares-cli` (or webOS Studio) for `ares-package`/`ares-install`/
`ares-launch`; `appinfo.json` + icons live in `apps/webos/webos-meta/` and
get copied into `dist/` as part of `pnpm build`; targeting webOS TV 6.0+
(Chromium 79+) as the version floor.

## 6. Core feature set (implemented)

1. **Xtream Codes API client** — `player_api.php` login, live/VOD/series category+stream listing, EPG endpoint, catch-up/timeshift URL building.
2. **M3U/M3U8 playlist support** — URL import + local file import, `#EXTINF` attribute parsing (tvg-id, tvg-logo, group-title) for channel metadata.
3. **EPG** — XMLTV parsing (streaming-friendly, not full-DOM-load), timeline grid view with category sidebar, now/next lookup, programme preview panel, catch-up/timeshift playback for past programmes.
4. **VOD & Series** — shelf/poster browsing (Apple TV-inspired: focus-scaling cards, blurred ambient backdrop), categories, season/episode navigation.
5. **Multi-profile** — local profile switching (avatars), per-profile parental-control PIN and locked categories.
6. **Parental controls** — PIN-gated categories (SHA-256 hashed, never stored/compared in plaintext), enforced in the Live TV channel grid via a PIN-entry gate.
7. **Live TV overlay** — fullscreen video with a translucent "liquid glass" channel-strip overlay (2-row sliding window over the full channel list), auto-dismissing after inactivity or selection.
8. **Content caching** — per-session in-memory + sessionStorage cache so switching tabs or reloading shows cached content immediately while a fresh copy loads in the background, with matching loading-shimmer skeletons for genuine first loads.

Deferred to Phase 2 or later: cloud-sync favorites/continue-watching backend (currently local-only, which is intentional for v1 — no infrastructure to operate).

## 7. Data & storage

- **localStorage/sessionStorage** for now (playlists, profiles, content cache) — see `apps/webos/src/*-store.ts` and `content-cache.ts`. Works today; IndexedDB migration is noted in PHASE2.md as worth doing before/during broader multi-platform or much-larger-EPG-dataset scenarios, since sessionStorage is synchronous and size-limited.
- No backend required for core functionality — everything talks directly to the user's IPTV provider. This keeps the project unambiguously "player, not content" and avoids operating infrastructure.

## 8. Performance principles (the "snappy" requirement)

- **Cold start budget**: target under 2-3 seconds to first interactive frame on real webOS TV hardware — lazy-load everything except the channel list screen.
- **List virtualization/windowing** — never render more than what's on screen plus a small buffer (`ChannelGrid`, `LiveOverlayGrid`).
- **Avoid layout thrash in focus transitions** — animate with CSS transforms/opacity only (GPU-composited), never properties that trigger layout, per the focus-scaling cards/shelves throughout `packages/ui`.
- **Channel-switch prebuffering** via `ChannelPreloader` so navigating the channel grid feels instant.
- **Profile on real webOS TV hardware**, not just the Simulator or desktop Chrome DevTools' CPU throttling — the Simulator's performance characteristics diverge from actual TV hardware (see docs/webos.md).

## 9. Build order (Phase 1, webOS)

1. ~~`packages/core`: Xtream + M3U + XMLTV parsers~~ — **done**, tested (32 tests).
2. ~~`packages/player`: hls.js wrapper + channel preloader~~ — **done**, tested.
3. ~~`packages/ui` + spatial navigation~~ — **done**: focus store with scopes, grid/shelf graph builders, Apple TV-inspired components (FocusCard, Shelf, FocusBackdrop, TopNav, EpgGrid, CategorySidebar, ProgrammePreview, GlassPanel, LiveOverlayGrid), tested.
4. ~~EPG grid, VOD/series browsing, catch-up, profiles, parental controls, Live TV overlay~~ — **done** (see `apps/webos/src/screens/`).
5. ~~webOS packaging~~ — **done**: `appinfo.json`, icons, `ares-package`/`ares-install`/`ares-launch` scripts verified end-to-end (see docs/webos.md).
6. **Next**: real-device testing on an actual LG TV (not just the Simulator) — D-pad-only navigation through every screen, backdrop-filter rendering/performance check for the Live TV glass overlay, stream compatibility against real provider streams.
7. IndexedDB migration for persistence (currently localStorage/sessionStorage) if EPG dataset sizes or reliability needs outgrow it.

## 10. Licensing note

MIT license (see [LICENSE](./LICENSE)). The app is a generic player and
includes no bundled IPTV content, providers, or credentials, to keep the
project unambiguously on the legal side of "player, not content."
