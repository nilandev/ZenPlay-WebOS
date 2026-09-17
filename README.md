# Free IPTV Player

An open-source IPTV player for **LG webOS TV**. See [PLAN.md](./PLAN.md)
for the Phase 1 (webOS) architecture and tech-stack rationale, and
[PHASE2.md](./PHASE2.md) for the deferred multi-platform plan (Android TV,
Samsung Tizen, mobile, desktop).

## Repo layout

Single package, flat structure — no monorepo/workspace, since this project
targets webOS only:

- `src/core/` — Xtream Codes client, M3U parser, XMLTV/EPG parser (+ now/next lookup), profile/PIN models, shared models, remote-input keymap. Imported as `@core`.
- `src/player/` — hls.js-backed playback engine abstraction + channel preloader ("zap-ahead"). Imported as `@player`.
- `src/ui/` — React components: scoped spatial-navigation focus system, channel grid, EPG grid, Apple-TV-style focus cards/shelves/backdrop, top nav, Live TV liquid-glass overlay, video surface. Imported as `@ui`.
- `src/screens/`, `src/App.tsx`, etc. — the webOS TV app itself: profiles, live TV, EPG guide, movies, series, settings/parental controls.
- `webos-meta/` — webOS packaging metadata (`appinfo.json` + icons), copied into `dist/` as part of `pnpm build`.
- `docs/` — setup and testing guides.

`@core`/`@player`/`@ui` are path aliases (see `tsconfig.json`'s `paths` and
`vite.config.ts`'s `resolve.alias`) rather than separate npm packages —
kept as distinctly-named folders since the earlier packages/apps split
still describes clean boundaries, without workspace/build overhead for a
single-target app.

## Getting started

```bash
pnpm install
pnpm build       # vite build, then copies webos-meta/ into dist/
pnpm test        # unit tests
pnpm dev         # run the app in a browser at http://localhost:5173
```

See [docs/testing.md](./docs/testing.md) for the full testing guide and
[docs/webos.md](./docs/webos.md) for building/packaging/installing on an
actual LG TV or the webOS TV Simulator.

## Status

Core parsers, playback engine, spatial navigation, and the full v1 feature
set are implemented and tested: live TV (fullscreen video with a
translucent liquid-glass channel overlay), EPG guide with catch-up/timeshift
playback, movies and series browsing (Apple-TV-inspired shelves/backdrop),
multi-profile support, and parental-control PIN locks on categories. Screen
content is cached per session (in-memory + sessionStorage) with matching
loading-shimmer skeletons, so navigating between tabs or reloading doesn't
show an empty screen while data refetches. The webOS build/package/install
pipeline (`ares-package`/`ares-install`/`ares-launch`) has been verified
end-to-end.

Not yet done: real-device validation on an actual LG TV, IndexedDB
persistence (currently localStorage/sessionStorage), and replacing the
placeholder app icons/splash screen with real artwork (see docs/webos.md).
Android TV, Tizen, mobile, and desktop are intentionally out of scope for
now — see PHASE2.md.

## License

MIT. This project is a generic IPTV player; it ships with no bundled
channels, providers, or credentials.
