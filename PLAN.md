# Open Source IPTV Player — Architecture & Tech Plan

Target: an open-source IPTV player competitive with IPTV Smarters Pro / TiviMate / Bob Player, running on Android TV, LG webOS, Samsung Tizen, plus mobile (Android/iOS) and desktop (Windows/Mac), from a single shared codebase.

## 1. High-level architecture

Three layers, strictly separated so platform quirks never leak into business logic:

```
┌─────────────────────────────────────────────────────────┐
│  Platform Shells (thin, per-target)                      │
│  Android TV (Capacitor) | webOS | Tizen | Desktop (Electron) │
├─────────────────────────────────────────────────────────┤
│  Shared App Core (single codebase, ~90% of the code)      │
│  UI (React/Preact) · State · Xtream/M3U/EPG parsing ·      │
│  Player abstraction · Focus/remote-control navigation      │
├─────────────────────────────────────────────────────────┤
│  Playback Engine (hls.js/shaka in-browser, native bridges  │
│  to ExoPlayer/Media3 where a platform shell provides one)  │
└─────────────────────────────────────────────────────────┘
```

Package layout (monorepo, pnpm workspaces or Turborepo):

- `packages/core` — Xtream Codes client, M3U parser, XMLTV/EPG parser, playlist/profile/favorites models, catch-up logic. Pure TypeScript, zero UI/DOM dependency, unit-testable in isolation.
- `packages/player` — playback abstraction. Wraps hls.js + shaka-player for web targets; exposes a common interface (`load`, `play`, `seek`, `getTracks`, `setAudioTrack`, bitrate stats) that a native ExoPlayer bridge can also implement on Android TV.
- `packages/ui` — React component library: channel grid, EPG timeline grid, D-pad/remote-focus system, video overlay controls, settings screens. Built TV-first (10-foot UI, large hit targets, spatial navigation) then adapted down for touch/mouse.
- `apps/tv` — the shared TV app shell (Android TV + entry point reused by webOS/Tizen builds).
- `apps/mobile` — phone/tablet-specific shell (touch UI variant of `packages/ui`).
- `apps/desktop` — Electron shell.
- `platform/webos`, `platform/tizen` — native project wrappers (config.xml/appinfo.json, native plugin glue, packaging scripts) that embed the built web bundle.

## 2. UI framework

**Preact (or React) + TypeScript**, compiled once, deployed everywhere as a web bundle.

- Preact over React if bundle size / startup time on low-RAM TV boxes becomes a bottleneck (webOS/Tizen devices often have 1-1.5GB RAM total) — API-compatible enough to switch late if needed.
- **Zustand** or **Jotai** for state management — minimal re-render overhead matters a lot on TV-class CPUs (dual/quad-core ARM at ~1.5GHz is common). Avoid Redux-style boilerplate and heavy re-render trees.
- **No CSS framework with runtime cost** (avoid Tailwind's JIT at runtime — precompile). Use CSS Modules or vanilla-extract for zero-runtime styling. TV rendering is GPU/CPU constrained; every layout thrash matters.
- Virtualized lists everywhere (channel lists can be 10,000+ entries) — `react-window` or a custom virtualizer tuned for spatial nav.

## 3. Spatial navigation (D-pad/remote) — the make-or-break layer

This is the single biggest differentiator between a "snappy" TV app and a sluggish one.

- Build (or adopt) a **focus management layer** modeled on [Norigin Spatial Navigation](https://github.com/NoriginMedia/Norigin-Spatial-Navigation) or [react-tv-space-navigation](https://github.com/bam-tech/react-tv-space-navigation) — both are proven on Android TV/webOS/Tizen simultaneously.
- Focus state must be **synchronous and predictable**: precompute focus graphs per screen (grid of channels, EPG grid, settings list) rather than doing DOM-geometry lookups on every keypress — geometry-based fallback is fine for edge cases only.
- Never rely on native browser focus outlines/behavior across Tizen/webOS — their WebKit builds have very inconsistent `:focus` and scroll-into-view behavior. Own it entirely in JS/CSS with a manually tracked "currently focused id" in state.
- Key input handling must special-case each platform's remote key codes (webOS/Tizen fire different keyCodes for back/channel-up-down/color buttons than a standard `KeyboardEvent`) — isolate this in a `packages/core/src/input/keymap.ts` per-platform adapter.

## 4. Playback engine

- **hls.js** for HLS streams, **shaka-player** for DASH/Widevine DRM cases, both running inside the shared player abstraction (`packages/player`).
- Many IPTV provider streams are non-compliant MPEG-TS over HLS with irregular segment timing — expect to tune hls.js's `maxBufferLength`, error-recovery hooks, and manifest-parsing tolerance. Budget real QA time against live provider streams, not just test streams.
- **Android TV native bridge**: wrap ExoPlayer/Media3 via a custom Capacitor plugin for hardware-accelerated decode, better low-latency live behavior, and wider codec/container support (raw MPEG-TS, more audio codecs) than Chromium's `<video>` can guarantee. Expose it behind the same `packages/player` interface so UI code never branches on platform.
- **webOS/Tizen**: both ship Chromium-based WebKit runtimes with native `<video>` + MSE that is usually hardware-accelerated already — hls.js/shaka on top is normally sufficient; only reach for their native AVPlay/media APIs if you hit specific codec/DRM gaps.
- Preload/prebuffer the *next* channel when the user is navigating a channel list (zap-ahead), the way TiviMate does — this is what makes channel switching feel instant instead of laggy.

## 5. Platform shells

| Platform | Approach | Notes |
|---|---|---|
| Android TV / Google TV | Capacitor Android build + custom ExoPlayer plugin | Also installable on Nvidia Shield, Sony/TCL/Hisense Android TVs. Target Android TV input/leanback intents in the manifest. |
| LG webOS | Native webOS app (webOS CLI: `ares-package`/`ares-deploy`) wrapping the same web bundle | webOS has its own back-button/magic-remote quirks; test on actual LG hardware or the free webOS TV Simulator early. |
| Samsung Tizen | Native Tizen app (Tizen Studio, `.wgt` package) wrapping the same web bundle | Tizen's WebKit version varies significantly by TV model year — pin a conservative JS/CSS baseline (avoid bleeding-edge ES features without polyfill). |
| Mobile (Android/iOS) | Capacitor mobile build of `apps/mobile` (touch-oriented layout variant) | Reuses `packages/core` and `packages/player` entirely; UI swaps spatial-nav for touch gestures. |
| Desktop (Win/Mac) | Electron build of `apps/desktop` | Mostly for convenience/dev-testing and power users; lowest priority polish-wise. |

## 6. Core feature set (v1 scope, as requested)

1. **Xtream Codes API client** — `player_api.php` login, live/VOD/series category+stream listing, EPG-short endpoint.
2. **M3U/M3U8 playlist support** — URL import + local file import, `#EXTINF` attribute parsing (tvg-id, tvg-logo, group-title) for channel metadata.
3. **EPG** — XMLTV parsing (streamed/chunked parser, not full-DOM-load — guide files can be 50MB+), timeline grid view, now/next banner, per-channel program list.
4. **VOD & Series** — poster-grid browsing, categories, season/episode navigation, resume-position tracking.
5. **Catch-up/Timeshift** — where the provider's Xtream API exposes `tv_archive`, build the timeshift seek bar against the archive URL pattern.
6. **Multi-profile** — local profile switching (avatars, per-profile favorites/continue-watching), stored client-side (no auth server needed for this).
7. **Parental controls** — PIN-gated categories, stored hashed locally.
8. **Favorites & continue-watching**, stored in local storage/IndexedDB, structured so a future optional cloud-sync backend could slot in without a rewrite.

## 7. Data & storage

- **IndexedDB** (via `idb` or Dexie.js) as the local database on all web-based targets — playlists, EPG cache, favorites, watch history, profiles. Works identically across Capacitor/Electron/webOS/Tizen WebKit.
- Cache parsed EPG/playlist data aggressively with TTL + manual refresh — re-parsing a large M3U or XMLTV file on every app launch is a common source of "slow to start" complaints in existing players.
- No backend required for core functionality — everything talks directly to the user's IPTV provider. Keep it that way for v1 (matches the open-source, self-hosted-friendly spirit and avoids operating infrastructure).

## 8. Performance principles (the "snappy" requirement)

- **Cold start budget**: target under 2-3 seconds to first interactive frame on Tizen/webOS hardware — lazy-load everything except the channel list screen; code-split settings/VOD/series screens.
- **List virtualization everywhere** — never render more than what's on screen plus a small overscan buffer.
- **Avoid layout thrash in focus transitions** — animate with CSS transforms/opacity only (GPU-composited), never animate properties that trigger layout (`width`/`top`/`left`) on TV GPUs.
- **Debounce/throttle rapid remote key repeats** (holding down/up on a D-pad fires fast) so focus movement and rendering don't queue up a backlog.
- **Image handling**: channel logos/VOD posters should be lazy-loaded, sized appropriately (don't ship 4K posters into a 200px tile), and cached to IndexedDB/blob cache to avoid re-fetching on every screen visit.
- **Profile on real hardware early** — a mid-tier Tizen 2021 TV or an actual LG webOS unit, not just desktop Chrome DevTools' CPU throttling. webOS/Tizen Simulators are useful for iteration but their performance characteristics diverge from real hardware.

## 9. Suggested build order

1. `packages/core`: Xtream + M3U + XMLTV parsers, with unit tests against real (anonymized) provider samples.
2. `packages/player`: hls.js/shaka wrapper with a mock UI, validate against several live provider streams for the messy-stream edge cases.
3. `packages/ui` + spatial navigation: channel grid + video overlay, get D-pad navigation feeling instant in a plain browser first.
4. `apps/tv` on Capacitor targeting Android TV — first real device target, includes the ExoPlayer native bridge. *(App shell scaffolded; native ExoPlayer bridge still pending — see docs/android-tv.md.)*
5. ~~EPG grid, VOD/series browsing, catch-up, profiles, parental controls~~ — **done**, ahead of the platform port (see `apps/tv/src/screens/`: GuideScreen, VodScreen, SeriesScreen, ProfilesScreen, SettingsScreen/PinGate). UI follows an Apple TV-inspired language: focus-scaling cards, horizontal shelves, blurred ambient backdrop (`packages/ui/src/components/FocusCard.tsx`, `Shelf.tsx`, `FocusBackdrop.tsx`). Persistence is currently `localStorage`, not yet the IndexedDB layer described in section 7 — fine for dev, revisit before considering this production-ready (large EPG datasets in particular).
6. Port to webOS and Tizen shells — this is where most platform-specific bugs surface (remote key codes, WebKit quirks, back-button behavior). Not yet started.
7. Mobile + desktop shells last — they reuse nearly everything and mainly need a touch-oriented layout pass.

## 10. Licensing note

Since this is open source: pick a license early (MIT/Apache-2.0 are friendliest for community contribution and for others building on it). Be explicit in the README that the app is a generic player and includes no IPTV content/provider credentials itself, to keep the project unambiguously on the legal side of "player, not content."
